const { list, put } = require('@vercel/blob');

function getKey(seed) {
  const cleanSeed = String(seed || '2512').replace(/[^0-9]/g, '') || '2512';
  return `seen-${cleanSeed}.json`;
}

async function readSeenList(key) {
  const { blobs } = await list({ prefix: key, limit: 5 });
  const exact = blobs.find((b) => b.pathname === key);
  if (!exact) return [];

  const res = await fetch(`${exact.url}?t=${Date.now()}`, { cache: 'no-store' });
  if (!res.ok) return [];
  const data = await res.json();
  return Array.isArray(data) ? data : [];
}

async function writeSeenList(key, seen) {
  await put(key, JSON.stringify(seen), {
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
      const key = getKey(req.query.seed);
      const seen = await readSeenList(key);
      return res.status(200).json({ seen });
    }

    if (req.method === 'POST') {
      const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
      const key = getKey(body.seed);
      const action = body.action || 'mark';

      if (action === 'reset') {
        await writeSeenList(key, []);
        return res.status(200).json({ seen: [] });
      }

      const name = typeof body.name === 'string' ? body.name.trim() : '';
      if (!name) {
        return res.status(400).json({ error: 'Missing participant name' });
      }

      const seen = await readSeenList(key);
      if (!seen.includes(name)) {
        seen.push(name);
        await writeSeenList(key, seen);
      }
      return res.status(200).json({ seen });
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    console.error('Error in /api/seen:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
};
