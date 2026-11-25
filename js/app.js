/* ==========================================================================
   SORTEO DE NAVIDAD — LÓGICA PRINCIPAL
   - Sorteo determinista por semilla (sin cruce de parejas ni auto-regalos)
   - Nieve en Canvas + Sonido navideño sintetizado (Web Audio API)
   - Flujo PIN -> Selección de Nombre -> Caja de Regalo 3D -> Panel Admin
   ========================================================================== */

(() => {
  'use strict';

  // -------------------- CONFIGURACIÓN DEL SORTEO --------------------
  const VALID_PINS = ['2512', '2026'];
  const ADMIN_PINS = ['9999', '2512'];
  const DEFAULT_SEED = 2512;
  const STORAGE_SEED_KEY = 'sorteo_navidad_seed_v1';

  // Participantes y sus parejas (no pueden regalarse entre sí ni a sí mismos)
  const PARTICIPANTS = [
    { name: 'Martin',  partner: 'Valeria', avatar: '🎅' },
    { name: 'Valeria', partner: 'Martin',  avatar: '🤶' },
    { name: 'Marcelo', partner: 'Julieta', avatar: '🦌' },
    { name: 'Julieta', partner: 'Marcelo', avatar: '⭐' },
    { name: 'Marina',  partner: 'Pablo',   avatar: '🎄' },
    { name: 'Pablo',   partner: 'Marina',  avatar: '⛄' },
    { name: 'Alicia',  partner: 'Jorge',   avatar: '🕯️' },
    { name: 'Jorge',   partner: 'Alicia',  avatar: '🧝' }
  ];

  // -------------------- ESTADO DE LA APLICACIÓN --------------------
  let currentSeed = loadInitialSeed();
  let assignments = generateValidDraw(currentSeed);
  let pinBuffer = '';
  let selectedUser = null;
  let isOpeningGift = false;

  // -------------------- ELEMENTOS DEL DOM --------------------
  const screens = {
    pin: document.getElementById('screenPin'),
    names: document.getElementById('screenNames'),
    reveal: document.getElementById('screenReveal')
  };

  // Pantalla 1: PIN
  const pinDots = Array.from(document.querySelectorAll('#pinDots .dot'));
  const pinInput = document.getElementById('pinInput');
  const pinErrorMsg = document.getElementById('pinErrorMsg');
  const numBtns = document.querySelectorAll('.num-btn[data-val]');
  const btnClearPin = document.getElementById('btnClearPin');
  const btnSubmitPin = document.getElementById('btnSubmitPin');

  // Pantalla 2: Nombres
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
  const adminStatBanner = document.querySelector('.admin-stat-banner span');
  const btnShareWhatsApp = document.getElementById('btnShareWhatsApp');
  const btnReshuffle = document.getElementById('btnReshuffle');

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

  function loadInitialSeed() {
    const params = new URLSearchParams(window.location.search);
    const urlSeed = parseInt(params.get('s'), 10);
    if (!Number.isNaN(urlSeed) && urlSeed > 0) {
      return urlSeed;
    }
    try {
      const saved = parseInt(localStorage.getItem(STORAGE_SEED_KEY), 10);
      if (!Number.isNaN(saved) && saved > 0) {
        return saved;
      }
    } catch (_) {
      // Ignorar si localStorage no está disponible
    }
    return DEFAULT_SEED;
  }

  function saveSeed(seed) {
    currentSeed = seed;
    try {
      localStorage.setItem(STORAGE_SEED_KEY, String(seed));
    } catch (_) {
      // Ignorar si localStorage no está disponible
    }
  }

  /**
   * Genera un sorteo válido usando la semilla dada.
   * Garantiza:
   * 1. Todos regalan a exactamente 1 persona y todos reciben exactamente 1 regalo.
   * 2. Nadie se regala a sí mismo.
   * 3. Ninguna pareja se regala entre sí.
   */
  function generateValidDraw(seed) {
    const rng = mulberry32(seed);
    const givers = PARTICIPANTS.map((p) => p.name);
    const partnerMap = Object.fromEntries(PARTICIPANTS.map((p) => [p.name, p.partner]));

    for (let attempt = 0; attempt < 5000; attempt++) {
      const receivers = [...givers];
      // Fisher-Yates shuffle determinista
      for (let i = receivers.length - 1; i > 0; i--) {
        const j = Math.floor(rng() * (i + 1));
        [receivers[i], receivers[j]] = [receivers[j], receivers[i]];
      }

      let valid = true;
      for (let i = 0; i < givers.length; i++) {
        const giver = givers[i];
        const receiver = receivers[i];
        if (giver === receiver || partnerMap[giver] === receiver) {
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

    // Fallback determinista garantizado (ciclo único válido)
    return {
      Alicia: 'Marcelo',
      Marcelo: 'Pablo',
      Pablo: 'Valeria',
      Valeria: 'Julieta',
      Julieta: 'Martin',
      Martin: 'Jorge',
      Jorge: 'Marina',
      Marina: 'Alicia'
    };
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

  function verifyPin() {
    if (VALID_PINS.includes(pinBuffer)) {
      playSuccessChime();
      renderParticipants();
      showScreen('names');
      resetPin();
    } else {
      pinErrorMsg.style.display = 'block';
      // Re-disparar animación shake
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
    if (document.activeElement === pinInput) return;

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
    participantsGrid.innerHTML = '';
    PARTICIPANTS.forEach((person) => {
      const card = document.createElement('button');
      card.type = 'button';
      card.className = 'participant-card';
      card.innerHTML = `
        <span class="p-avatar" aria-hidden="true">${person.avatar}</span>
        <span class="p-name">${person.name}</span>
        <span class="p-hint">Tocar para ver</span>
      `;
      card.addEventListener('click', () => selectParticipant(person.name));
      participantsGrid.appendChild(card);
    });
  }

  function selectParticipant(name) {
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

  function verifyAdmin() {
    const val = adminPinInput.value.trim();
    if (ADMIN_PINS.includes(val)) {
      adminPinError.style.display = 'none';
      adminAuthBody.style.display = 'none';
      adminContentBody.style.display = 'block';
      renderAdminMatrix();
      playSuccessChime();
    } else {
      adminPinError.style.display = 'block';
      playErrorTone();
    }
  }

  function renderAdminMatrix() {
    if (adminStatBanner) {
      adminStatBanner.innerHTML = `🎄 Sorteo Activo: <strong>Semilla #${currentSeed}</strong>`;
    }
    adminPairsList.innerHTML = '';
    PARTICIPANTS.forEach((p) => {
      const row = document.createElement('div');
      row.className = 'admin-pair-row';
      row.innerHTML = `
        <span class="admin-pair-giver">${p.avatar} ${p.name}</span>
        <span class="admin-pair-arrow">🎁 ➔</span>
        <span class="admin-pair-receiver">${assignments[p.name]}</span>
      `;
      adminPairsList.appendChild(row);
    });
  }

  function copyWhatsAppLinks() {
    const baseUrl = `${window.location.origin}${window.location.pathname}`;
    const lines = [
      '🎄 *Sorteo de Navidad Familiar* 🎁',
      'Tocá tu enlace personal para descubrir a quién te toca regalarle (¡sin que nadie espíe!):',
      ''
    ];
    PARTICIPANTS.forEach((p) => {
      const link = `${baseUrl}?u=${encodeURIComponent(p.name)}&p=${VALID_PINS[0]}&s=${currentSeed}`;
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

  function reshuffleDraw() {
    const newSeed = Math.floor(1000 + Math.random() * 9000);
    saveSeed(newSeed);
    assignments = generateValidDraw(newSeed);
    renderAdminMatrix();
    playFestiveJingle();
    showToast(`🎲 Nuevo sorteo generado (Semilla #${newSeed})`);
  }

  btnOpenAdmin.addEventListener('click', openAdminModal);
  btnCloseAdmin.addEventListener('click', closeAdminModal);
  adminModal.addEventListener('click', (e) => {
    if (e.target === adminModal) closeAdminModal();
  });
  btnVerifyAdmin.addEventListener('click', verifyAdmin);
  adminPinInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') verifyAdmin();
  });
  btnShareWhatsApp.addEventListener('click', copyWhatsAppLinks);
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

  // -------------------- AUTO-LOGIN POR URL (?u=Nombre&p=2512) --------------------
  function checkDirectUrlAccess() {
    const params = new URLSearchParams(window.location.search);
    const userParam = params.get('u');
    const pinParam = params.get('p');

    if (userParam && VALID_PINS.includes(pinParam)) {
      const normalize = (str) =>
        str.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
      const match = PARTICIPANTS.find(
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
