export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const { action } = req.query;
  const apiKey = req.headers['x-higgsfield-key'];
  if (!apiKey) return res.status(400).json({ error: 'Missing API key header' });

  const BASE = 'https://cloud.higgsfield.ai';
  const headers = { 'Authorization': `Key ${apiKey}`, 'Content-Type': 'application/json' };

  try {
    if (action === 'upload-init') {
      const { filename, content_type } = req.body;
      const r = await fetch(`${BASE}/v1/media/upload`, {
        method: 'POST', headers,
        body: JSON.stringify({ filename, content_type })
      });
      const data = await r.json();
      if (!r.ok) return res.status(r.status).json(data);
      return res.json(data);
    }

    if (action === 'upload-file') {
      const { upload_url, content_type } = req.query;
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      const body = Buffer.concat(chunks);
      const r = await fetch(upload_url, {
        method: 'PUT',
        headers: { 'Content-Type': content_type },
        body
      });
      if (!r.ok) {
        const txt = await r.text();
        return res.status(r.status).json({ error: txt });
      }
      return res.json({ success: true });
    }

    if (action === 'upload-confirm') {
      const { media_id } = req.body;
      const r = await fetch(`${BASE}/v1/media/confirm`, {
        method: 'POST', headers,
        body: JSON.stringify({ media_id, type: 'image' })
      });
      const data = await r.json();
      if (!r.ok) return res.status(r.status).json(data);
      return res.json(data);
    }

    if (action === 'job-submit') {
      const r = await fetch(`${BASE}/v1/jobs`, {
        method: 'POST', headers,
        body: JSON.stringify(req.body)
      });
      const data = await r.json();
      if (!r.ok) return res.status(r.status).json(data);
      return res.json(data);
    }

    if (action === 'job-status') {
      const { job_id } = req.query;
      const r = await fetch(`${BASE}/v1/jobs/${job_id}`, { headers });
      const data = await r.json();
      if (!r.ok) return res.status(r.status).json(data);
      return res.json(data);
    }

    return res.status(400).json({ error: `Unknown action: ${action}` });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}

export const config = { api: { bodyParser: false } };
