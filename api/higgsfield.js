export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', '*');
  res.setHeader('Access-Control-Max-Age', '86400');
  
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  const { action } = req.query;
  const apiKey = req.headers['x-higgsfield-key'] || req.query.key;
  
  if (!apiKey) return res.status(400).json({ error: 'Missing API key' });

  const BASE = 'https://cloud.higgsfield.ai';
  const authHeaders = { 
    'Authorization': `Key ${apiKey}`, 
    'Content-Type': 'application/json' 
  };

  try {
    if (action === 'upload-init') {
      const body = await readBody(req);
      const parsed = JSON.parse(body);
      const r = await fetch(`${BASE}/v1/media/upload`, {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify({ filename: parsed.filename, content_type: parsed.content_type })
      });
      const text = await r.text();
      if (!r.ok) return res.status(r.status).json({ error: text });
      return res.status(200).json(JSON.parse(text));
    }

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
      if (!r.ok) {
        const txt = await r.text();
        return res.status(r.status).json({ error: txt });
      }
      return res.status(200).json({ success: true });
    }

    if (action === 'upload-confirm') {
      const body = await readBody(req);
      const parsed = JSON.parse(body);
      const r = await fetch(`${BASE}/v1/media/confirm`, {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify({ media_id: parsed.media_id, type: 'image' })
      });
      const text = await r.text();
      if (!r.ok) return res.status(r.status).json({ error: text });
      return res.status(200).json(JSON.parse(text));
    }

    if (action === 'job-submit') {
      const body = await readBody(req);
      const r = await fetch(`${BASE}/v1/jobs`, {
        method: 'POST',
        headers: authHeaders,
        body: body
      });
      const text = await r.text();
      if (!r.ok) return res.status(r.status).json({ error: text });
      return res.status(200).json(JSON.parse(text));
    }

    if (action === 'job-status') {
      const { job_id } = req.query;
      const r = await fetch(`${BASE}/v1/jobs/${job_id}`, { headers: authHeaders });
      const text = await r.text();
      if (!r.ok) return res.status(r.status).json({ error: text });
      return res.status(200).json(JSON.parse(text));
    }

    return res.status(400).json({ error: `Unknown action: ${action}` });

  } catch (err) {
    return res.status(500).json({ error: err.message, stack: err.stack });
  }
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', chunk => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks).toString()));
    req.on('error', reject);
  });
}

export const config = { api: { bodyParser: false } };
