export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', '*');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const { action, key } = req.query;
  const apiKey = key || req.headers['x-higgsfield-key'];
  if (!apiKey) return res.status(400).json({ error: 'Missing API key' });

  const BASE = 'https://cloud.higgsfield.ai';
  const auth = { 'Authorization': `Key ${apiKey}`, 'Content-Type': 'application/json' };

  try {
    // Get presigned upload URL — browser will PUT directly to S3
    if (action === 'upload-init') {
      const { filename, content_type } = req.query;
      const r = await fetch(`${BASE}/v1/media/upload`, {
        method: 'POST', headers: auth,
        body: JSON.stringify({ filename, content_type })
      });
      const text = await r.text();
      if (!r.ok) return res.status(r.status).json({ error: text });
      return res.status(200).json(JSON.parse(text));
    }

    // Confirm after browser uploads directly to S3
    if (action === 'upload-confirm') {
      const { media_id } = req.query;
      const r = await fetch(`${BASE}/v1/media/confirm`, {
        method: 'POST', headers: auth,
        body: JSON.stringify({ media_id, type: 'image' })
      });
      const text = await r.text();
      if (!r.ok) return res.status(r.status).json({ error: text });
      return res.status(200).json(JSON.parse(text));
    }

    // Submit generation job
    if (action === 'job-submit') {
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      const body = Buffer.concat(chunks).toString() || '{}';
      const r = await fetch(`${BASE}/v1/jobs`, {
        method: 'POST', headers: auth, body
      });
      const text = await r.text();
      if (!r.ok) return res.status(r.status).json({ error: text });
      return res.status(200).json(JSON.parse(text));
    }

    // Poll job status
    if (action === 'job-status') {
      const { job_id } = req.query;
      const r = await fetch(`${BASE}/v1/jobs/${job_id}`, { headers: auth });
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
