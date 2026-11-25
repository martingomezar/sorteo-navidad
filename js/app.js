/* ==========================================================================
   SORTEO DE NAVIDAD — LÓGICA PRINCIPAL
   - Sorteo determinista por semilla (sin cruce de parejas ni auto-regalos)
   - Nieve en Canvas + Sonido navideño sintetizado (Web Audio API)
   - Flujo PIN -> Selección de Nombre -> Caja de Regalo 3D -> Panel Admin
   ========================================================================== */

(() => {
  'use strict';

  // -------------------- CONFIGURACIÓN DEL SORTEO --------------------
  const DEFAULT_PIN = '2512';
  const VALID_PINS = ['2512', '2026'];
  const ADMIN_PINS = ['9999', '2512'];
  const DEFAULT_SEED = 2512;
  const STORAGE_LAST_GROUP_KEY = 'sorteo_navidad_last_group_v2';
  const STORAGE_CONFIG_PREFIX = 'sorteo_navidad_config_v2_';
  const STORAGE_SEEN_PREFIX = 'sorteo_navidad_seen_v2_';
  const AVATAR_POOL = ['🎅', '🤶', '🦌', '⭐', '🎄', '🕯️', '🧝', '⛄', '🎁', '🔔', '❄️', '🍪'];

  // Participantes y exclusiones por defecto (grupo Familia)
  const DEFAULT_PARTICIPANTS = [
    { name: 'Martin',  avatar: '🎅' },
    { name: 'Valeria', avatar: '🤶' },
    { name: 'Marcelo', avatar: '🦌' },
    { name: 'Julieta', avatar: '⭐' },
    { name: 'Marina',  avatar: '🎄' },
    { name: 'Alicia',  avatar: '🕯️' },
    { name: 'Jorge',   avatar: '🧝' }
  ];

  const DEFAULT_EXCLUSIONS = [
    ['Martin', 'Valeria'],
    ['Marcelo', 'Julieta'],
    ['Alicia', 'Jorge']
  ];

  function normalizeGroupSlug(name) {
    const clean = String(name || 'Familia')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');
    return clean || 'familia';
  }

  function loadInitialGroupName() {
    const params = new URLSearchParams(window.location.search);
    const urlGroup = params.get('g');
    if (urlGroup && urlGroup.trim()) return urlGroup.trim();
    try {
      const saved = localStorage.getItem(STORAGE_LAST_GROUP_KEY);
      if (saved && saved.trim()) return saved.trim();
    } catch (_) {
      // Ignorar
    }
    return 'Familia';
  }

  // -------------------- ESTADO DE LA APLICACIÓN --------------------
  let currentGroupName = loadInitialGroupName();
  let currentGroupSlug = normalizeGroupSlug(currentGroupName);
  const initialConfig = loadLocalConfig(currentGroupSlug);
  let currentGroupPin = initialConfig.pin;
  let participants = initialConfig.participants;
  let exclusions = initialConfig.exclusions;
  let currentSeed = loadInitialSeed(initialConfig.seed);
  let assignments = generateValidDraw(currentSeed, participants, exclusions) || {};
  let seenUsersCache = loadLocalSeenUsers();
  let seenPollTimer = null;
  let pinBuffer = '';
  let selectedUser = null;
  let isOpeningGift = false;
  let draftParticipants = [];
  let draftExclusions = [];

  // -------------------- ELEMENTOS DEL DOM --------------------
  const screens = {
    pin: document.getElementById('screenPin'),
    names: document.getElementById('screenNames'),
    reveal: document.getElementById('screenReveal')
  };

  // Pantalla 1: PIN
  const groupNameInput = document.getElementById('groupNameInput');
  const pinDots = Array.from(document.querySelectorAll('#pinDots .dot'));
  const pinInput = document.getElementById('pinInput');
  const pinErrorMsg = document.getElementById('pinErrorMsg');
  const numBtns = document.querySelectorAll('.num-btn[data-val]');
  const btnClearPin = document.getElementById('btnClearPin');
  const btnSubmitPin = document.getElementById('btnSubmitPin');
  const btnOpenAdminFromPin = document.getElementById('btnOpenAdminFromPin');

  // Pantalla 2: Nombres
  const activeGroupBadge = document.getElementById('activeGroupBadge');
  const participantsGrid = document.getElementById('participantsGrid');
  const btnLockApp = document.getElementById('btnLockApp');
  const btnOpenAdmin = document.getElementById('btnOpenAdmin');

  // Pantalla 3: Revelación
  const revealUserName = document.getElementById('revealUserName');
  const giftBoxState = document.getElementById('giftBoxState');
  const giftRevealedState = document.getElementById('giftRevealedState');
  const clickableGiftBox = document.getElementById('clickableGiftBox');
  const btnOpenGift = document.getElementById('btnOpenGift');
  const assignedPersonName = document.getElementById('assignedPersonName');
  const btnHideSecret = document.getElementById('btnHideSecret');

  // Modal Administrador
  const adminModal = document.getElementById('adminModal');
  const btnCloseAdmin = document.getElementById('btnCloseAdmin');
  const adminAuthBody = document.getElementById('adminAuthBody');
  const adminContentBody = document.getElementById('adminContentBody');
  const adminPinInput = document.getElementById('adminPinInput');
  const btnVerifyAdmin = document.getElementById('btnVerifyAdmin');
  const adminPinError = document.getElementById('adminPinError');
  const adminPairsList = document.getElementById('adminPairsList');
  const adminBannerGroup = document.getElementById('adminBannerGroup');
  const adminBannerSeed = document.getElementById('adminBannerSeed');
  const adminGroupNameInput = document.getElementById('adminGroupNameInput');
  const btnLoadGroup = document.getElementById('btnLoadGroup');
  const adminGroupPinInput = document.getElementById('adminGroupPinInput');
  const btnShareWhatsApp = document.getElementById('btnShareWhatsApp');
  const btnResetSeen = document.getElementById('btnResetSeen');
  const btnReshuffle = document.getElementById('btnReshuffle');
  const adminParticipantCount = document.getElementById('adminParticipantCount');
  const newParticipantInput = document.getElementById('newParticipantInput');
  const btnAddParticipant = document.getElementById('btnAddParticipant');
  const adminParticipantsList = document.getElementById('adminParticipantsList');
  const exclSelectA = document.getElementById('exclSelectA');
  const exclSelectB = document.getElementById('exclSelectB');
  const btnAddExclusion = document.getElementById('btnAddExclusion');
  const adminExclusionsList = document.getElementById('adminExclusionsList');
  const adminConfigError = document.getElementById('adminConfigError');
  const btnSaveAndDraw = document.getElementById('btnSaveAndDraw');

  // -------------------- PRNG DETERMINISTA Y ALGORITMO DE SORTEO --------------------
  function mulberry32(seed) {
    let a = seed >>> 0;
    return function () {
      a |= 0;
      a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function loadLocalConfig(groupSlug = currentGroupSlug) {
    try {
      const raw = localStorage.getItem(`${STORAGE_CONFIG_PREFIX}${groupSlug}`);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && Array.isArray(parsed.participants) && parsed.participants.length >= 2) {
          return {
            groupName: parsed.groupName || currentGroupName,
            groupSlug,
            pin: parsed.pin || DEFAULT_PIN,
            participants: parsed.participants,
            exclusions: Array.isArray(parsed.exclusions) ? parsed.exclusions : [],
            seed: parsed.seed || DEFAULT_SEED
          };
        }
      }
    } catch (_) {
      // Ignorar si localStorage no está disponible
    }
    return {
      groupName: groupSlug === 'familia' ? 'Familia' : currentGroupName,
      groupSlug,
      pin: DEFAULT_PIN,
      participants: DEFAULT_PARTICIPANTS.map((p) => ({ ...p })),
      exclusions: DEFAULT_EXCLUSIONS.map((e) => [...e]),
      seed: DEFAULT_SEED
    };
  }

  function saveLocalConfig(cfg) {
    const slug = cfg.groupSlug || normalizeGroupSlug(cfg.groupName);
    try {
      localStorage.setItem(`${STORAGE_CONFIG_PREFIX}${slug}`, JSON.stringify(cfg));
      localStorage.setItem(STORAGE_LAST_GROUP_KEY, cfg.groupName || slug);
    } catch (_) {
      // Ignorar si localStorage no está disponible
    }
  }

  function loadInitialSeed(configSeed) {
    const params = new URLSearchParams(window.location.search);
    const urlSeed = parseInt(params.get('s'), 10);
    if (!Number.isNaN(urlSeed) && urlSeed > 0) {
      return urlSeed;
    }
    if (configSeed && !Number.isNaN(Number(configSeed))) {
      return Number(configSeed);
    }
    return DEFAULT_SEED;
  }

  function saveSeed(seed) {
    currentSeed = seed;
  }

  function loadLocalSeenUsers() {
    try {
      const raw = localStorage.getItem(`${STORAGE_SEEN_PREFIX}${currentGroupSlug}_${currentSeed}`);
      const parsed = raw ? JSON.parse(raw) : [];
      return Array.isArray(parsed) ? parsed : [];
    } catch (_) {
      return [];
    }
  }

  function saveLocalSeenUsers(list) {
    seenUsersCache = Array.isArray(list) ? list : [];
    try {
      localStorage.setItem(
        `${STORAGE_SEEN_PREFIX}${currentGroupSlug}_${currentSeed}`,
        JSON.stringify(seenUsersCache)
      );
    } catch (_) {
      // Ignorar si localStorage no está disponible
    }
  }

  function getSeenUsers() {
    return seenUsersCache;
  }

  function applyRemoteConfig(remoteCfg) {
    const remoteSeed = Number(remoteCfg.seed) || DEFAULT_SEED;
    const remoteSlug = remoteCfg.groupSlug || normalizeGroupSlug(remoteCfg.groupName);
    const sameParticipants =
      JSON.stringify(remoteCfg.participants) === JSON.stringify(participants);
    const sameExclusions =
      JSON.stringify(remoteCfg.exclusions || []) === JSON.stringify(exclusions);

    const changed =
      remoteSlug !== currentGroupSlug ||
      remoteSeed !== currentSeed ||
      remoteCfg.pin !== currentGroupPin ||
      !sameParticipants ||
      !sameExclusions;

    currentGroupSlug = remoteSlug;
    currentGroupName = remoteCfg.groupName || remoteSlug;
    currentGroupPin = remoteCfg.pin || DEFAULT_PIN;
    participants = remoteCfg.participants;
    exclusions = Array.isArray(remoteCfg.exclusions) ? remoteCfg.exclusions : [];
    saveSeed(remoteSeed);
    saveLocalConfig({
      groupName: currentGroupName,
      groupSlug: currentGroupSlug,
      pin: currentGroupPin,
      participants,
      exclusions,
      seed: remoteSeed
    });
    assignments = generateValidDraw(currentSeed, participants, exclusions) || {};
    if (activeGroupBadge) activeGroupBadge.textContent = currentGroupName;
    return changed;
  }

  async function syncSeenFromServer(targetGroupSlug = currentGroupSlug) {
    try {
      const res = await fetch(
        `/api/seen?group=${encodeURIComponent(targetGroupSlug)}&seed=${encodeURIComponent(currentSeed)}&t=${Date.now()}`,
        { cache: 'no-store' }
      );
      if (!res.ok) return seenUsersCache;
      const data = await res.json();

      let configChanged = false;
      if (data.config && Array.isArray(data.config.participants) && data.config.participants.length >= 2) {
        configChanged = applyRemoteConfig(data.config);
      }

      if (Array.isArray(data.seen)) {
        const merged = Array.from(new Set(data.seen));
        const seenChanged =
          merged.length !== seenUsersCache.length ||
          merged.some((u, idx) => u !== seenUsersCache[idx]);
        saveLocalSeenUsers(merged);
        if ((seenChanged || configChanged) && screens.names.classList.contains('active')) {
          renderParticipants();
        }
      } else if (configChanged && screens.names.classList.contains('active')) {
        renderParticipants();
      }
    } catch (_) {
      // Fallback silencioso a localStorage si no hay backend disponible
    }
    return seenUsersCache;
  }

  async function markUserAsSeen(name) {
    if (!name) return;
    if (!seenUsersCache.includes(name)) {
      saveLocalSeenUsers([...seenUsersCache, name]);
    }
    try {
      const res = await fetch('/api/seen', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          group: currentGroupSlug,
          seed: currentSeed,
          action: 'mark',
          name
        })
      });
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data.seen)) {
          saveLocalSeenUsers(data.seen);
        }
      }
    } catch (_) {
      // Ya quedó guardado en localStorage como respaldo
    }
  }

  /**
   * Genera un sorteo válido usando la semilla dada, lista de participantes y exclusiones.
   * Garantiza:
   * 1. Todos regalan a exactamente 1 persona y todos reciben exactamente 1 regalo.
   * 2. Nadie se regala a sí mismo (siempre activo).
   * 3. Ningún par excluido se regala entre sí.
   * Devuelve null si las restricciones hacen imposible el sorteo.
   */
  function isPairExcluded(giver, receiver, exclusionsList) {
    if (giver === receiver) return true;
    return exclusionsList.some(
      ([a, b]) => (giver === a && receiver === b) || (giver === b && receiver === a)
    );
  }

  function generateValidDraw(seed, participantsList = participants, exclusionsList = exclusions) {
    const givers = participantsList.map((p) => p.name);
    if (givers.length < 2) return null;

    const rng = mulberry32(seed);

    // Intento rápido por shuffle determinista
    for (let attempt = 0; attempt < 1500; attempt++) {
      const receivers = [...givers];
      for (let i = receivers.length - 1; i > 0; i--) {
        const j = Math.floor(rng() * (i + 1));
        [receivers[i], receivers[j]] = [receivers[j], receivers[i]];
      }

      let valid = true;
      for (let i = 0; i < givers.length; i++) {
        if (isPairExcluded(givers[i], receivers[i], exclusionsList)) {
          valid = false;
          break;
        }
      }

      if (valid) {
        const map = {};
        for (let i = 0; i < givers.length; i++) {
          map[givers[i]] = receivers[i];
        }
        return map;
      }
    }

    // Respaldo exacto con backtracking determinista para restricciones muy ajustadas
    const orderedGivers = [...givers].sort((a, b) => {
      const allowedA = givers.filter((r) => !isPairExcluded(a, r, exclusionsList)).length;
      const allowedB = givers.filter((r) => !isPairExcluded(b, r, exclusionsList)).length;
      return allowedA - allowedB;
    });

    const used = new Set();
    const result = {};

    function backtrack(idx) {
      if (idx === orderedGivers.length) return true;
      const giver = orderedGivers[idx];
      const candidates = givers.filter(
        (r) => !used.has(r) && !isPairExcluded(giver, r, exclusionsList)
      );
      for (let i = candidates.length - 1; i > 0; i--) {
        const j = Math.floor(rng() * (i + 1));
        [candidates[i], candidates[j]] = [candidates[j], candidates[i]];
      }
      for (const candidate of candidates) {
        used.add(candidate);
        result[giver] = candidate;
        if (backtrack(idx + 1)) return true;
        used.delete(candidate);
      }
      return false;
    }

    return backtrack(0) ? result : null;
  }

  // -------------------- NAVEGACIÓN ENTRE PANTALLAS --------------------
  function showScreen(name) {
    Object.entries(screens).forEach(([key, el]) => {
      if (key === name) {
        el.classList.add('active');
      } else {
        el.classList.remove('active');
      }
    });

    clearInterval(seenPollTimer);
    if (name === 'names') {
      syncSeenFromServer();
      seenPollTimer = setInterval(syncSeenFromServer, 4000);
    }
  }

  // -------------------- PANTALLA 1: LÓGICA DEL PIN --------------------
  function updatePinDots() {
    pinDots.forEach((dot, idx) => {
      if (idx < pinBuffer.length) {
        dot.classList.add('filled');
      } else {
        dot.classList.remove('filled');
      }
    });
    pinInput.value = pinBuffer;
  }

  function appendPinDigit(digit) {
    if (pinBuffer.length >= 4) return;
    pinErrorMsg.style.display = 'none';
    pinBuffer += digit;
    updatePinDots();
    playTickSound();

    if (pinBuffer.length === 4) {
      setTimeout(verifyPin, 140);
    }
  }

  function clearPinDigit() {
    if (pinBuffer.length === 0) return;
    pinBuffer = pinBuffer.slice(0, -1);
    updatePinDots();
    pinErrorMsg.style.display = 'none';
  }

  function resetPin() {
    pinBuffer = '';
    updatePinDots();
    pinErrorMsg.style.display = 'none';
  }

  async function verifyPin() {
    const typedGroup = (groupNameInput ? groupNameInput.value.trim() : '') || 'Familia';
    const slug = normalizeGroupSlug(typedGroup);

    // Consultar grupo en el servidor
    let remoteConfig = null;
    let remoteSeen = null;
    try {
      const res = await fetch(`/api/seen?group=${encodeURIComponent(slug)}&t=${Date.now()}`, {
        cache: 'no-store'
      });
      if (res.ok) {
        const data = await res.json();
        remoteConfig = data.config || null;
        if (Array.isArray(data.seen)) remoteSeen = data.seen;
      }
    } catch (_) {
      // Fallback local si no hay conexión
    }

    let isAllowed = false;
    if (remoteConfig) {
      if (pinBuffer === String(remoteConfig.pin || '')) {
        applyRemoteConfig(remoteConfig);
        if (remoteSeen) saveLocalSeenUsers(remoteSeen);
        isAllowed = true;
      }
    } else if (slug === 'familia' && VALID_PINS.includes(pinBuffer)) {
      currentGroupSlug = 'familia';
      currentGroupName = 'Familia';
      currentGroupPin = DEFAULT_PIN;
      const localCfg = loadLocalConfig('familia');
      participants = localCfg.participants;
      exclusions = localCfg.exclusions;
      currentSeed = localCfg.seed || DEFAULT_SEED;
      assignments = generateValidDraw(currentSeed, participants, exclusions) || {};
      if (remoteSeen) saveLocalSeenUsers(remoteSeen);
      if (activeGroupBadge) activeGroupBadge.textContent = currentGroupName;
      isAllowed = true;
    } else {
      const localCfg = loadLocalConfig(slug);
      if (localCfg && localCfg.groupSlug === slug && localCfg.pin === pinBuffer && slug !== 'familia') {
        currentGroupSlug = slug;
        currentGroupName = localCfg.groupName;
        currentGroupPin = localCfg.pin;
        participants = localCfg.participants;
        exclusions = localCfg.exclusions;
        currentSeed = localCfg.seed || DEFAULT_SEED;
        assignments = generateValidDraw(currentSeed, participants, exclusions) || {};
        if (activeGroupBadge) activeGroupBadge.textContent = currentGroupName;
        isAllowed = true;
      }
    }

    if (isAllowed) {
      playSuccessChime();
      renderParticipants();
      showScreen('names');
      resetPin();
    } else {
      pinErrorMsg.textContent = remoteConfig
        ? `🎅 PIN incorrecto para el grupo "${remoteConfig.groupName || typedGroup}".`
        : `🎅 Grupo "${typedGroup}" o PIN incorrecto.`;
      pinErrorMsg.style.display = 'block';
      pinErrorMsg.style.animation = 'none';
      void pinErrorMsg.offsetWidth;
      pinErrorMsg.style.animation = '';
      playErrorTone();
      setTimeout(() => {
        pinBuffer = '';
        updatePinDots();
      }, 350);
    }
  }

  numBtns.forEach((btn) => {
    btn.addEventListener('click', () => {
      appendPinDigit(btn.dataset.val);
    });
  });

  btnClearPin.addEventListener('click', clearPinDigit);
  btnSubmitPin.addEventListener('click', verifyPin);

  pinInput.addEventListener('input', (e) => {
    const cleaned = e.target.value.replace(/\D/g, '').slice(0, 4);
    pinBuffer = cleaned;
    updatePinDots();
    if (pinBuffer.length === 4) {
      setTimeout(verifyPin, 140);
    }
  });

  document.addEventListener('keydown', (e) => {
    if (!screens.pin.classList.contains('active') || adminModal.style.display !== 'none') {
      return;
    }
    if (document.activeElement === pinInput || document.activeElement === groupNameInput) return;

    if (/^[0-9]$/.test(e.key)) {
      appendPinDigit(e.key);
    } else if (e.key === 'Backspace') {
      clearPinDigit();
    } else if (e.key === 'Enter') {
      verifyPin();
    }
  });

  // -------------------- PANTALLA 2: PARTICIPANTES --------------------
  function renderParticipants() {
    const seenUsers = getSeenUsers();
    participantsGrid.innerHTML = '';
    participants.forEach((person) => {
      const isSeen = seenUsers.includes(person.name);
      const card = document.createElement('button');
      card.type = 'button';
      card.className = isSeen ? 'participant-card seen' : 'participant-card';
      card.disabled = isSeen;
      card.innerHTML = `
        <span class="p-avatar" aria-hidden="true">${person.avatar}</span>
        <span class="p-name">${person.name}</span>
        <span class="p-hint">${isSeen ? '🔒 Ya lo vio' : 'Tocar para ver'}</span>
      `;
      if (!isSeen) {
        card.addEventListener('click', () => selectParticipant(person.name));
      }
      participantsGrid.appendChild(card);
    });
  }

  async function selectParticipant(name) {
    await syncSeenFromServer();
    if (getSeenUsers().includes(name)) {
      renderParticipants();
      showToast(`🔒 ${name} ya descubrió a quién le regala`);
      return;
    }
    selectedUser = name;
    isOpeningGift = false;
    revealUserName.textContent = name;
    assignedPersonName.textContent = assignments[name] || '—';

    // Reiniciar estado de la caja cerrada
    clickableGiftBox.classList.remove('opened');
    giftBoxState.style.display = 'flex';
    giftRevealedState.style.display = 'none';

    playTickSound();
    showScreen('reveal');
  }

  btnLockApp.addEventListener('click', () => {
    selectedUser = null;
    resetPin();
    showScreen('pin');
  });

  // -------------------- PANTALLA 3: CAJA DE REGALO 3D --------------------
  function openGift() {
    if (isOpeningGift) return;
    isOpeningGift = true;

    markUserAsSeen(selectedUser);
    clickableGiftBox.classList.add('opened');
    playFestiveJingle();

    setTimeout(() => {
      giftBoxState.style.display = 'none';
      giftRevealedState.style.display = 'block';
      launchGoldSparkles();
    }, 550);
  }

  clickableGiftBox.addEventListener('click', openGift);
  clickableGiftBox.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      openGift();
    }
  });
  btnOpenGift.addEventListener('click', openGift);

  btnHideSecret.addEventListener('click', () => {
    selectedUser = null;
    isOpeningGift = false;
    resetPin();
    showScreen('pin');
  });

  // -------------------- MODAL DE ADMINISTRADOR --------------------
  function openAdminModal() {
    adminPinInput.value = '';
    adminPinError.style.display = 'none';
    adminAuthBody.style.display = 'block';
    adminContentBody.style.display = 'none';
    adminModal.style.display = 'flex';
    setTimeout(() => adminPinInput.focus(), 80);
  }

  function closeAdminModal() {
    adminModal.style.display = 'none';
  }

  async function verifyAdmin() {
    const val = adminPinInput.value.trim();
    if (ADMIN_PINS.includes(val)) {
      adminPinError.style.display = 'none';
      adminAuthBody.style.display = 'none';
      adminContentBody.style.display = 'block';
      await syncSeenFromServer();
      adminGroupNameInput.value = currentGroupName;
      adminGroupPinInput.value = currentGroupPin;
      draftParticipants = participants.map((p) => ({ ...p }));
      draftExclusions = exclusions.map((e) => [...e]);
      adminConfigError.style.display = 'none';
      renderAdminConfig();
      renderAdminMatrix();
      playSuccessChime();
    } else {
      adminPinError.style.display = 'block';
      playErrorTone();
    }
  }

  async function loadAdminGroup() {
    const rawName = adminGroupNameInput.value.trim();
    if (!rawName) return;
    const slug = normalizeGroupSlug(rawName);
    adminConfigError.style.display = 'none';

    try {
      const res = await fetch(`/api/seen?group=${encodeURIComponent(slug)}&t=${Date.now()}`, {
        cache: 'no-store'
      });
      if (res.ok) {
        const data = await res.json();
        if (data.config && Array.isArray(data.config.participants)) {
          applyRemoteConfig(data.config);
          if (Array.isArray(data.seen)) saveLocalSeenUsers(data.seen);
          adminGroupNameInput.value = currentGroupName;
          adminGroupPinInput.value = currentGroupPin;
          draftParticipants = participants.map((p) => ({ ...p }));
          draftExclusions = exclusions.map((e) => [...e]);
          renderAdminConfig();
          renderAdminMatrix();
          showToast(`📂 Grupo "${currentGroupName}" cargado`);
          return;
        }
      }
    } catch (_) {
      // Ignorar
    }

    showToast(`✨ "${rawName}" es un grupo nuevo: editá participantes y guardá`);
  }

  function renderAdminConfig() {
    adminParticipantCount.textContent = draftParticipants.length;
    adminParticipantsList.innerHTML = '';
    draftParticipants.forEach((p, idx) => {
      const chip = document.createElement('span');
      chip.className = 'admin-chip';
      chip.innerHTML = `${p.avatar} ${p.name} <button type="button" class="chip-remove" title="Quitar a ${p.name}" aria-label="Quitar a ${p.name}">&times;</button>`;
      chip.querySelector('.chip-remove').addEventListener('click', () => removeDraftParticipant(idx));
      adminParticipantsList.appendChild(chip);
    });

    // Poblar selects de exclusión
    const prevA = exclSelectA.value;
    const prevB = exclSelectB.value;
    exclSelectA.innerHTML = '';
    exclSelectB.innerHTML = '';
    draftParticipants.forEach((p) => {
      const optA = document.createElement('option');
      optA.value = p.name;
      optA.textContent = p.name;
      exclSelectA.appendChild(optA);

      const optB = document.createElement('option');
      optB.value = p.name;
      optB.textContent = p.name;
      exclSelectB.appendChild(optB);
    });
    if (draftParticipants.some((p) => p.name === prevA)) exclSelectA.value = prevA;
    if (draftParticipants.some((p) => p.name === prevB)) {
      exclSelectB.value = prevB;
    } else if (draftParticipants.length > 1) {
      exclSelectB.selectedIndex = 1;
    }

    adminExclusionsList.innerHTML = '';
    if (draftExclusions.length === 0) {
      const empty = document.createElement('span');
      empty.className = 'admin-helper-text';
      empty.textContent = 'Sin restricciones adicionales (solo se evita el auto-regalo).';
      adminExclusionsList.appendChild(empty);
    } else {
      draftExclusions.forEach(([a, b], idx) => {
        const chip = document.createElement('span');
        chip.className = 'admin-chip excl-chip';
        chip.innerHTML = `${a} ↔ ${b} <button type="button" class="chip-remove" title="Quitar restricción">&times;</button>`;
        chip.querySelector('.chip-remove').addEventListener('click', () => {
          draftExclusions.splice(idx, 1);
          adminConfigError.style.display = 'none';
          renderAdminConfig();
        });
        adminExclusionsList.appendChild(chip);
      });
    }
  }

  function addDraftParticipant() {
    const raw = newParticipantInput.value.trim();
    if (!raw) return;
    const norm = (s) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
    if (draftParticipants.some((p) => norm(p.name) === norm(raw))) {
      adminConfigError.textContent = `⚠️ "${raw}" ya está en la lista.`;
      adminConfigError.style.display = 'block';
      return;
    }
    const avatar = AVATAR_POOL[draftParticipants.length % AVATAR_POOL.length];
    draftParticipants.push({ name: raw, avatar });
    newParticipantInput.value = '';
    adminConfigError.style.display = 'none';
    renderAdminConfig();
  }

  function removeDraftParticipant(idx) {
    if (draftParticipants.length <= 2) {
      adminConfigError.textContent = '⚠️ Debe haber al menos 2 participantes.';
      adminConfigError.style.display = 'block';
      return;
    }
    const removed = draftParticipants[idx].name;
    draftParticipants.splice(idx, 1);
    draftExclusions = draftExclusions.filter(([a, b]) => a !== removed && b !== removed);
    adminConfigError.style.display = 'none';
    renderAdminConfig();
  }

  function addDraftExclusion() {
    const a = exclSelectA.value;
    const b = exclSelectB.value;
    if (!a || !b || a === b) {
      adminConfigError.textContent = '⚠️ Elegí dos personas distintas (el auto-regalo ya está bloqueado).';
      adminConfigError.style.display = 'block';
      return;
    }
    const exists = draftExclusions.some(
      ([x, y]) => (x === a && y === b) || (x === b && y === a)
    );
    if (exists) return;
    draftExclusions.push([a, b]);
    adminConfigError.style.display = 'none';
    renderAdminConfig();
  }

  async function saveConfigAndDraw(customSeed) {
    const rawGroupName = adminGroupNameInput.value.trim();
    const rawGroupPin = adminGroupPinInput.value.replace(/\D/g, '').slice(0, 4);

    if (!rawGroupName) {
      adminConfigError.textContent = '⚠️ Ingresá un nombre para el grupo.';
      adminConfigError.style.display = 'block';
      return;
    }
    if (rawGroupPin.length !== 4) {
      adminConfigError.textContent = '⚠️ El PIN del grupo debe tener 4 dígitos numéricos.';
      adminConfigError.style.display = 'block';
      return;
    }
    if (draftParticipants.length < 2) {
      adminConfigError.textContent = '⚠️ Se necesitan al menos 2 participantes.';
      adminConfigError.style.display = 'block';
      return;
    }
    const newSeed = customSeed || Math.floor(1000 + Math.random() * 9000);
    const nextAssignments = generateValidDraw(newSeed, draftParticipants, draftExclusions);
    if (!nextAssignments) {
      adminConfigError.textContent = '⚠️ Con esas exclusiones es imposible sortear sin que alguien quede afuera o se autoregale. Quitá alguna restricción.';
      adminConfigError.style.display = 'block';
      playErrorTone();
      return;
    }

    adminConfigError.style.display = 'none';
    currentGroupName = rawGroupName;
    currentGroupSlug = normalizeGroupSlug(rawGroupName);
    currentGroupPin = rawGroupPin;
    if (groupNameInput) groupNameInput.value = currentGroupName;
    if (activeGroupBadge) activeGroupBadge.textContent = currentGroupName;

    participants = draftParticipants.map((p) => ({ ...p }));
    exclusions = draftExclusions.map((e) => [...e]);
    saveSeed(newSeed);
    const cfg = {
      groupName: currentGroupName,
      groupSlug: currentGroupSlug,
      pin: currentGroupPin,
      participants,
      exclusions,
      seed: newSeed
    };
    saveLocalConfig(cfg);
    saveLocalSeenUsers([]);
    assignments = nextAssignments;

    try {
      await fetch('/api/seen', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ group: currentGroupSlug, action: 'save_config', config: cfg })
      });
    } catch (_) {
      // Guardado localmente como respaldo
    }

    renderParticipants();
    renderAdminMatrix();
    playFestiveJingle();
    showToast(`💾 Grupo "${currentGroupName}" guardado (PIN: ${currentGroupPin})`);
  }

  function renderAdminMatrix() {
    if (adminBannerGroup) adminBannerGroup.textContent = currentGroupName;
    if (adminBannerSeed) adminBannerSeed.textContent = currentSeed;
    adminPairsList.innerHTML = '';
    participants.forEach((p) => {
      const row = document.createElement('div');
      row.className = 'admin-pair-row';
      row.innerHTML = `
        <span class="admin-pair-giver">${p.avatar} ${p.name}</span>
        <span class="admin-pair-arrow">🎁 ➔</span>
        <span class="admin-pair-receiver">${assignments[p.name] || '—'}</span>
      `;
      adminPairsList.appendChild(row);
    });
  }

  function copyWhatsAppLinks() {
    const baseUrl = `${window.location.origin}${window.location.pathname}`;
    const lines = [
      `🎄 *Sorteo de Navidad — Grupo: ${currentGroupName}* 🎁`,
      `Ingresá con Grupo: *${currentGroupName}* | PIN: *${currentGroupPin}*`,
      'O tocá tu enlace personal directo:',
      ''
    ];
    participants.forEach((p) => {
      const link = `${baseUrl}?g=${encodeURIComponent(currentGroupSlug)}&u=${encodeURIComponent(p.name)}&p=${currentGroupPin}&s=${currentSeed}`;
      lines.push(`• *${p.name}*: ${link}`);
    });
    const text = lines.join('\n');

    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(() => {
        showToast('📲 Enlaces de WhatsApp copiados al portapapeles');
      }).catch(() => {
        fallbackCopy(text);
      });
    } else {
      fallbackCopy(text);
    }
  }

  function fallbackCopy(text) {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    try {
      document.execCommand('copy');
      showToast('📲 Enlaces de WhatsApp copiados al portapapeles');
    } catch (_) {
      showToast('⚠️ No se pudo copiar automáticamente');
    }
    document.body.removeChild(ta);
  }

  async function resetSeenUsers() {
    saveLocalSeenUsers([]);
    try {
      await fetch('/api/seen', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ group: currentGroupSlug, seed: currentSeed, action: 'reset' })
      });
    } catch (_) {
      // Ignorar si no hay backend disponible
    }
    renderParticipants();
    showToast('🔄 Nombres tachados reiniciados para todos');
  }

  function reshuffleDraw() {
    saveConfigAndDraw();
  }

  btnOpenAdmin.addEventListener('click', openAdminModal);
  if (btnOpenAdminFromPin) btnOpenAdminFromPin.addEventListener('click', openAdminModal);
  if (btnLoadGroup) btnLoadGroup.addEventListener('click', loadAdminGroup);
  btnCloseAdmin.addEventListener('click', closeAdminModal);
  adminModal.addEventListener('click', (e) => {
    if (e.target === adminModal) closeAdminModal();
  });
  btnVerifyAdmin.addEventListener('click', verifyAdmin);
  adminPinInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') verifyAdmin();
  });
  btnAddParticipant.addEventListener('click', addDraftParticipant);
  newParticipantInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      addDraftParticipant();
    }
  });
  btnAddExclusion.addEventListener('click', addDraftExclusion);
  btnSaveAndDraw.addEventListener('click', () => saveConfigAndDraw());
  btnShareWhatsApp.addEventListener('click', copyWhatsAppLinks);
  if (btnResetSeen) btnResetSeen.addEventListener('click', resetSeenUsers);
  btnReshuffle.addEventListener('click', reshuffleDraw);

  // -------------------- TOAST --------------------
  let toastTimer = null;
  function showToast(message) {
    let toast = document.getElementById('appToast');
    if (!toast) {
      toast = document.createElement('div');
      toast.id = 'appToast';
      toast.className = 'toast';
      document.body.appendChild(toast);
    }
    toast.textContent = message;
    toast.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      toast.classList.remove('show');
    }, 3000);
  }

  // -------------------- WEB AUDIO API (SONIDOS NAVIDEÑOS) --------------------
  let audioCtx = null;

  function getAudioContext() {
    if (!audioCtx) {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (Ctx) audioCtx = new Ctx();
    }
    if (audioCtx && audioCtx.state === 'suspended') {
      audioCtx.resume().catch(() => {});
    }
    return audioCtx;
  }

  function playNote(freq, startTime, duration, type = 'sine', volume = 0.12) {
    const ctx = getAudioContext();
    if (!ctx) return;

    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, startTime);

    gain.gain.setValueAtTime(0.001, startTime);
    gain.gain.exponentialRampToValueAtTime(volume, startTime + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.001, startTime + duration);

    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(startTime);
    osc.stop(startTime + duration + 0.02);
  }

  function playTickSound() {
    const ctx = getAudioContext();
    if (!ctx) return;
    playNote(880, ctx.currentTime, 0.06, 'sine', 0.06);
  }

  function playErrorTone() {
    const ctx = getAudioContext();
    if (!ctx) return;
    const now = ctx.currentTime;
    playNote(220, now, 0.14, 'triangle', 0.12);
    playNote(185, now + 0.12, 0.2, 'triangle', 0.12);
  }

  function playSuccessChime() {
    const ctx = getAudioContext();
    if (!ctx) return;
    const now = ctx.currentTime;
    playNote(523.25, now, 0.15, 'sine', 0.1);       // C5
    playNote(659.25, now + 0.08, 0.18, 'sine', 0.1); // E5
    playNote(783.99, now + 0.16, 0.28, 'sine', 0.12);// G5
  }

  function playFestiveJingle() {
    const ctx = getAudioContext();
    if (!ctx) return;
    const now = ctx.currentTime;
    // Pequeña melodía festiva tipo cascabeles
    const notes = [
      { f: 659.25, t: 0.00, d: 0.16 }, // E5
      { f: 659.25, t: 0.16, d: 0.16 }, // E5
      { f: 659.25, t: 0.32, d: 0.28 }, // E5
      { f: 783.99, t: 0.52, d: 0.18 }, // G5
      { f: 1046.50, t: 0.68, d: 0.45 } // C6
    ];
    notes.forEach((n) => playNote(n.f, now + n.t, n.d, 'triangle', 0.14));
  }

  // -------------------- NIEVE ANIMADA Y DESTELLOS EN CANVAS --------------------
  const snowCanvas = document.getElementById('snowCanvas');
  const ctx = snowCanvas.getContext('2d');
  let snowflakes = [];
  let sparkles = [];

  function resizeCanvas() {
    snowCanvas.width = window.innerWidth;
    snowCanvas.height = window.innerHeight;
  }

  function initSnow() {
    resizeCanvas();
    const count = Math.min(85, Math.max(45, Math.floor(window.innerWidth / 12)));
    snowflakes = Array.from({ length: count }, () => ({
      x: Math.random() * snowCanvas.width,
      y: Math.random() * snowCanvas.height,
      r: 1.2 + Math.random() * 2.8,
      speedY: 0.5 + Math.random() * 1.4,
      speedX: (Math.random() - 0.5) * 0.6,
      alpha: 0.35 + Math.random() * 0.55
    }));
  }

  function launchGoldSparkles() {
    const cx = snowCanvas.width / 2;
    const cy = snowCanvas.height / 2;
    const colors = ['#FCE28A', '#D4AF37', '#FFFFFF', '#FF4D6D', '#2ECC71'];
    for (let i = 0; i < 65; i++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = 2 + Math.random() * 6;
      sparkles.push({
        x: cx,
        y: cy,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed - 2,
        size: 2.5 + Math.random() * 4,
        color: colors[i % colors.length],
        life: 1.0
      });
    }
  }

  function animateCanvas() {
    ctx.clearRect(0, 0, snowCanvas.width, snowCanvas.height);

    // Dibujar nieve
    for (const flake of snowflakes) {
      flake.y += flake.speedY;
      flake.x += flake.speedX + Math.sin(flake.y * 0.015) * 0.3;

      if (flake.y > snowCanvas.height + 5) {
        flake.y = -5;
        flake.x = Math.random() * snowCanvas.width;
      }
      if (flake.x > snowCanvas.width + 5) flake.x = -5;
      if (flake.x < -5) flake.x = snowCanvas.width + 5;

      ctx.beginPath();
      ctx.arc(flake.x, flake.y, flake.r, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(255, 255, 255, ${flake.alpha})`;
      ctx.fill();
    }

    // Dibujar destellos al abrir regalo
    for (let i = sparkles.length - 1; i >= 0; i--) {
      const s = sparkles[i];
      s.x += s.vx;
      s.y += s.vy;
      s.vy += 0.12; // gravedad
      s.life -= 0.018;

      if (s.life <= 0) {
        sparkles.splice(i, 1);
        continue;
      }

      ctx.globalAlpha = s.life;
      ctx.fillStyle = s.color;
      ctx.fillRect(s.x, s.y, s.size, s.size);
      ctx.globalAlpha = 1;
    }

    requestAnimationFrame(animateCanvas);
  }

  window.addEventListener('resize', resizeCanvas);

  // -------------------- AUTO-LOGIN POR URL (?g=Grupo&u=Nombre&p=2512) --------------------
  async function checkDirectUrlAccess() {
    if (groupNameInput) groupNameInput.value = currentGroupName;
    if (activeGroupBadge) activeGroupBadge.textContent = currentGroupName;

    const params = new URLSearchParams(window.location.search);
    const groupParam = params.get('g');
    const userParam = params.get('u');
    const pinParam = params.get('p');

    const targetSlug = groupParam ? normalizeGroupSlug(groupParam) : currentGroupSlug;
    await syncSeenFromServer(targetSlug);

    if (userParam && (pinParam === currentGroupPin || VALID_PINS.includes(pinParam))) {
      const normalize = (str) =>
        str.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
      const match = participants.find(
        (p) => normalize(p.name) === normalize(userParam)
      );
      if (match) {
        renderParticipants();
        selectParticipant(match.name);
      }
    }
  }

  // -------------------- INICIALIZACIÓN --------------------
  initSnow();
  animateCanvas();
  checkDirectUrlAccess();
})();
