const { list, put, del } = require('@vercel/blob');

function getSeenPrefix(seed) {
  const cleanSeed = String(seed || '2512').replace(/[^0-9]/g, '') || '2512';
  return `state/seen-${cleanSeed}/`;
}

const CONFIG_PREFIX = 'state/config/';

async function readLatestJson(prefix, fallback) {
  const { blobs } = await list({ prefix, limit: 100 });
  if (!blobs || blobs.length === 0) return fallback;

  // Ordenar por pathname descendente (contiene timestamp padded) para obtener siempre el más reciente
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

  // Limpiar versiones viejas para mantener el store liviano
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
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');

  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    return res.status(503).json({ error: 'Blob storage not configured' });
  }

  try {
    if (req.method === 'GET') {
      const config = await readLatestJson(CONFIG_PREFIX, null);
      const effectiveSeed = (config && config.seed) ? config.seed : req.query.seed;
      const seenPrefix = getSeenPrefix(effectiveSeed);
      const seenRaw = await readLatestJson(seenPrefix, []);
      const seen = Array.isArray(seenRaw) ? seenRaw : [];
      return res.status(200).json({ seen, config });
    }

    if (req.method === 'POST') {
      const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
      const action = body.action || 'mark';

      if (action === 'save_config') {
        const config = body.config;
        if (!config || !Array.isArray(config.participants) || config.participants.length < 2) {
          return res.status(400).json({ error: 'Se necesitan al menos 2 participantes' });
        }
        await writeVersionedJson(CONFIG_PREFIX, config);
        const seenPrefix = getSeenPrefix(config.seed);
        await writeVersionedJson(seenPrefix, []);
        return res.status(200).json({ ok: true, config, seen: [] });
      }

      const seenPrefix = getSeenPrefix(body.seed);

      if (action === 'reset') {
        await writeVersionedJson(seenPrefix, []);
        return res.status(200).json({ seen: [] });
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
      return res.status(200).json({ seen });
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    console.error('Error in /api/seen:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
};
