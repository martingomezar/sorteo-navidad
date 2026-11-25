const { list, put, del } = require('@vercel/blob');

function normalizeGroupSlug(group) {
  const clean = String(group || 'familia')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return clean || 'familia';
}

const CONFIG_PREFIX = 'state/groups/';
const REQUESTS_PREFIX = 'state/requests/';
const ADMIN_PIN = '2904';

function getConfigPrefix(groupSlug) {
  return `state/groups/${groupSlug}/config/`;
}

function getSeenPrefix(groupSlug, seed) {
  const cleanSeed = String(seed || '2512').replace(/[^0-9]/g, '') || '2512';
  return `state/groups/${groupSlug}/seen-${cleanSeed}/`;
}

async function readLatestJson(prefix, fallback) {
  const { blobs } = await list({ prefix, limit: 100 });
  if (!blobs || blobs.length === 0) return fallback;

  const sorted = [...blobs].sort((a, b) => b.pathname.localeCompare(a.pathname));
  const latest = sorted[0];

  const res = await fetch(latest.url, { cache: 'no-store' });
  if (!res.ok) return fallback;
  return await res.json();
}

async function writeVersionedJson(prefix, data) {
  const stamp = String(Date.now()).padStart(15, '0');
  const rand = Math.random().toString(36).slice(2, 8);
  const pathname = `${prefix}${stamp}-${rand}.json`;

  const created = await put(pathname, JSON.stringify(data), {
    access: 'public',
    addRandomSuffix: false,
    contentType: 'application/json',
    cacheControlMaxAge: 0
  });

  try {
    const { blobs } = await list({ prefix, limit: 100 });
    const oldUrls = blobs
      .filter((b) => b.pathname !== created.pathname)
      .map((b) => b.url);
    if (oldUrls.length > 0) {
      await del(oldUrls);
    }
  } catch (_) {
    // No bloquear si falla la limpieza
  }

  return data;
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    return res.status(503).json({ error: 'Blob storage not configured' });
  }

  try {
    if (req.method === 'GET') {
      if (req.query.action === 'list_requests') {
        if (req.query.adminPin !== ADMIN_PIN) {
          return res.status(403).json({ error: 'Unauthorized' });
        }
        const { blobs } = await list({ prefix: REQUESTS_PREFIX, limit: 50 });
        const sorted = [...(blobs || [])].sort((a, b) => b.pathname.localeCompare(a.pathname));
        const requests = [];
        for (const b of sorted.slice(0, 20)) {
          try {
            const r = await fetch(b.url, { cache: 'no-store' });
            if (r.ok) requests.push(await r.json());
          } catch (_) {
            // Ignorar
          }
        }
        return res.status(200).json({ requests });
      }

      const groupSlug = normalizeGroupSlug(req.query.group);
      const config = await readLatestJson(getConfigPrefix(groupSlug), null);
      const effectiveSeed = (config && config.seed) ? config.seed : req.query.seed;
      const seenPrefix = getSeenPrefix(groupSlug, effectiveSeed);
      const seenRaw = await readLatestJson(seenPrefix, []);
      const seen = Array.isArray(seenRaw) ? seenRaw : [];
      return res.status(200).json({ group: groupSlug, seen, config });
    }

    if (req.method === 'POST') {
      const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
      const action = body.action || 'mark';

      if (action === 'request_access') {
        const email = typeof body.email === 'string' ? body.email.trim() : '';
        const group = typeof body.group === 'string' ? body.group.trim() : '';
        if (!email || !group) {
          return res.status(400).json({ error: 'Faltan datos' });
        }
        const stamp = String(Date.now()).padStart(15, '0');
        const rand = Math.random().toString(36).slice(2, 8);
        await put(
          `${REQUESTS_PREFIX}${stamp}-${rand}.json`,
          JSON.stringify({ email, group, createdAt: new Date().toISOString() }),
          { access: 'public', addRandomSuffix: false, contentType: 'application/json' }
        );
        return res.status(200).json({ ok: true });
      }

      const groupSlug = normalizeGroupSlug(body.group || (body.config && body.config.groupSlug) || (body.config && body.config.groupName));

      if (action === 'save_config') {
        const config = body.config;
        if (!config || !Array.isArray(config.participants) || config.participants.length < 2) {
          return res.status(400).json({ error: 'Se necesitan al menos 2 participantes' });
        }
        const normalizedConfig = {
          ...config,
          groupSlug
        };
        await writeVersionedJson(getConfigPrefix(groupSlug), normalizedConfig);
        const seenPrefix = getSeenPrefix(groupSlug, normalizedConfig.seed);
        await writeVersionedJson(seenPrefix, []);
        return res.status(200).json({ ok: true, group: groupSlug, config: normalizedConfig, seen: [] });
      }

      const seenPrefix = getSeenPrefix(groupSlug, body.seed);

      if (action === 'reset') {
        await writeVersionedJson(seenPrefix, []);
        return res.status(200).json({ group: groupSlug, seen: [] });
      }

      const name = typeof body.name === 'string' ? body.name.trim() : '';
      if (!name) {
        return res.status(400).json({ error: 'Missing participant name' });
      }

      const seenRaw = await readLatestJson(seenPrefix, []);
      const seen = Array.isArray(seenRaw) ? seenRaw : [];
      if (!seen.includes(name)) {
        seen.push(name);
        await writeVersionedJson(seenPrefix, seen);
      }
      return res.status(200).json({ group: groupSlug, seen });
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    console.error('Error in /api/seen:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
};
