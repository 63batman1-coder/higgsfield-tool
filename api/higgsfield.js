export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', '*');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const { action, key } = req.query;
  const apiKey = key || req.headers['x-higgsfield-key'];
  if (!apiKey) return res.status(400).json({ error: 'Missing API key' });

  const BASE = 'https://platform.higgsfield.ai';
  const auth = { 'Authorization': `Key ${apiKey}`, 'Content-Type': 'application/json' };

  try {
    // Get presigned upload URL
    if (action === 'upload-init') {
      const { filename, content_type } = req.query;
      const r = await fetch(`${BASE}/media/batch`, {
        method: 'POST', headers: auth,
        body: JSON.stringify([{ filename, content_type }])
      });
      const text = await r.text();
      if (!r.ok) return res.status(r.status).json({ error: text, endpoint: '/media/batch' });
      const data = JSON.parse(text);
      // batch returns array, normalize to single object with media_id and upload_url
      const item = Array.isArray(data) ? data[0] : data;
      return res.status(200).json({
        media_id: item.media_id || item.id,
        upload_url: item.upload_url || item.presigned_url || item.url
      });
    }

    // Confirm upload
    if (action === 'upload-confirm') {
      const { media_id } = req.query;
      const r = await fetch(`${BASE}/media/${media_id}/confirm`, {
        method: 'POST', headers: auth,
        body: JSON.stringify({ type: 'image' })
      });
      const text = await r.text();
      if (!r.ok) return res.status(r.status).json({ error: text });
      return res.status(200).json(text ? JSON.parse(text) : { media_id });
    }

    // Submit job
    if (action === 'job-submit') {
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      const body = Buffer.concat(chunks).toString() || '{}';
      const parsed = JSON.parse(body);
      const model = parsed.model;
      // Jobs use model path as endpoint
      const r = await fetch(`${BASE}/jobs/v2/${model}`, {
        method: 'POST', headers: auth,
        body: JSON.stringify({ params: parsed })
      });
      const text = await r.text();
      if (!r.ok) return res.status(r.status).json({ error: text });
      return res.status(200).json(JSON.parse(text));
    }

    // Poll job status
    if (action === 'job-status') {
      const { job_id } = req.query;
      const r = await fetch(`${BASE}/jobs/${job_id}`, { headers: auth });
      const text = await r.text();
      if (!r.ok) return res.status(r.status).json({ error: text });
      return res.status(200).json(JSON.parse(text));
    }

    return res.status(400).json({ error: `Unknown action: ${action}` });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}

export const config = { api: { bodyParser: false } };
