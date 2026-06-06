export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', '*');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const { action } = req.query;
  const apiKey = req.headers['x-higgsfield-key'] || req.query.key;
  if (!apiKey) return res.status(400).json({ error: 'Missing API key' });

  const BASE = 'https://api.higgsfield.ai';
  const authHeaders = { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' };

  try {
    // 1. Get upload URL
    if (action === 'upload-init') {
      const { filename, content_type } = req.query;
      const r = await fetch(`${BASE}/v1/media/upload`, {
        method: 'POST', headers: authHeaders,
        body: JSON.stringify({ filename, content_type })
      });
      const text = await r.text();
      if (!r.ok) return res.status(r.status).json({ error: text });
      return res.status(200).json(JSON.parse(text));
    }

    // 2. Proxy file upload to S3
    if (action === 'upload-file') {
      const { upload_url, content_type } = req.query;
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      const fileBody = Buffer.concat(chunks);
      const r = await fetch(decodeURIComponent(upload_url), {
        method: 'PUT',
        headers: { 'Content-Type': decodeURIComponent(content_type) },
        body: fileBody
      });
      if (!r.ok) return res.status(r.status).json({ error: await r.text() });
      return res.status(200).json({ success: true });
    }

    // 3. Confirm upload
    if (action === 'upload-confirm') {
      const { media_id } = req.query;
      const r = await fetch(`${BASE}/v1/media/confirm`, {
        method: 'POST', headers: authHeaders,
        body: JSON.stringify({ media_id, type: 'image' })
      });
      const text = await r.text();
      if (!r.ok) return res.status(r.status).json({ error: text });
      return res.status(200).json(JSON.parse(text));
    }

    // 4. Submit job
    if (action === 'job-submit') {
      const raw = await readBody(req);
      const r = await fetch(`${BASE}/v1/jobs`, {
        method: 'POST', headers: authHeaders, body: raw
      });
      const text = await r.text();
      if (!r.ok) return res.status(r.status).json({ error: text });
      return res.status(200).json(JSON.parse(text));
    }

    // 5. Poll job
    if (action === 'job-status') {
      const { job_id } = req.query;
      const r = await fetch(`${BASE}/v1/jobs/${job_id}`, { headers: authHeaders });
      const text = await r.text();
      if (!r.ok) return res.status(r.status).json({ error: text });
      return res.status(200).json(JSON.parse(text));
    }

    return res.status(400).json({ error: `Unknown action: ${action}` });

  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', c => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks).toString().trim() || '{}'));
    req.on('error', reject);
  });
}

export const config = { api: { bodyParser: false } };
