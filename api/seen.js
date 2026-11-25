const { list, put } = require('@vercel/blob');

const CONFIG_KEY = 'config.json';

function getSeenKey(seed) {
  const cleanSeed = String(seed || '2512').replace(/[^0-9]/g, '') || '2512';
  return `seen-${cleanSeed}.json`;
}

async function readJsonBlob(key, fallback) {
  const { blobs } = await list({ prefix: key, limit: 5 });
  const exact = blobs.find((b) => b.pathname === key);
  if (!exact) return fallback;

  const res = await fetch(`${exact.url}?t=${Date.now()}`, { cache: 'no-store' });
  if (!res.ok) return fallback;
  return await res.json();
}

async function writeJsonBlob(key, data) {
  await put(key, JSON.stringify(data), {
    access: 'public',
    addRandomSuffix: false,
    allowOverwrite: true,
    contentType: 'application/json',
    cacheControlMaxAge: 0
  });
}

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');

  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    return res.status(503).json({ error: 'Blob storage not configured' });
  }

  try {
    if (req.method === 'GET') {
      const config = await readJsonBlob(CONFIG_KEY, null);
      const effectiveSeed = (config && config.seed) ? config.seed : req.query.seed;
      const seenKey = getSeenKey(effectiveSeed);
      const seenRaw = await readJsonBlob(seenKey, []);
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
        await writeJsonBlob(CONFIG_KEY, config);
        const seenKey = getSeenKey(config.seed);
        await writeJsonBlob(seenKey, []);
        return res.status(200).json({ ok: true, config, seen: [] });
      }

      const seenKey = getSeenKey(body.seed);

      if (action === 'reset') {
        await writeJsonBlob(seenKey, []);
        return res.status(200).json({ seen: [] });
      }

      const name = typeof body.name === 'string' ? body.name.trim() : '';
      if (!name) {
        return res.status(400).json({ error: 'Missing participant name' });
      }

      const seenRaw = await readJsonBlob(seenKey, []);
      const seen = Array.isArray(seenRaw) ? seenRaw : [];
      if (!seen.includes(name)) {
        seen.push(name);
        await writeJsonBlob(seenKey, seen);
      }
      return res.status(200).json({ seen });
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    console.error('Error in /api/seen:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
};
