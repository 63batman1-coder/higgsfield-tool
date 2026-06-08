export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', '*');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const { action, key } = req.query;
  const apiKey = key || req.headers['x-higgsfield-key'];
  if (!apiKey) return res.status(400).json({ error: 'Missing API key' });

  const [keyId, keySecret] = apiKey.includes(':') ? apiKey.split(':') : [apiKey, apiKey];

  const BASE = 'https://platform.higgsfield.ai';
  const auth = {
    'hf-api-key': keyId,
    'hf-secret': keySecret,
    'Content-Type': 'application/json'
  };

  try {
    // Get presigned upload URL
    if (action === 'upload-init') {
      const { content_type } = req.query;
      const r = await fetch(`${BASE}/files/generate-upload-url`, {
        method: 'POST', headers: auth,
        body: JSON.stringify({ content_type })
      });
      const text = await r.text();
      if (!r.ok) return res.status(r.status).json({ error: text });
      const data = JSON.parse(text);
      return res.status(200).json(data);
    }

    // Confirm upload after browser PUT to S3
    if (action === 'upload-confirm') {
      const { media_id } = req.query;
      const r = await fetch(`${BASE}/files/confirm`, {
        method: 'POST', headers: auth,
        body: JSON.stringify({ media_id })
      });
      const text = await r.text();
      // Confirm may return empty 200 - that's OK
      if (!r.ok) return res.status(r.status).json({ error: text });
      return res.status(200).json(text ? JSON.parse(text) : { media_id, confirmed: true });
    }

    // Submit generation job
    if (action === 'job-submit') {
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      const body = JSON.parse(Buffer.concat(chunks).toString() || '{}');
      const { model, prompt, medias, aspect_ratio } = body;

      let endpoint, payload;
      if (model === 'nano_banana_2') {
        endpoint = '/v1/image-to-image/nano-banana';
        payload = {
          params: {
            prompt,
            input_images: medias?.map(m => ({ type: 'image_url', image_url: m.value }))
          }
        };
      } else if (model === 'kling3_0') {
        endpoint = '/v1/image-to-video/kling/v3';
        payload = {
          params: {
            prompt,
            aspect_ratio,
            mode: 'std',
            sound: 'off',
            input_images: medias?.map(m => ({ type: 'image_url', image_url: m.value }))
          }
        };
      } else {
        endpoint = `/v1/${model}`;
        payload = { params: body };
      }

      const r = await fetch(`${BASE}${endpoint}`, {
        method: 'POST', headers: auth,
        body: JSON.stringify(payload)
      });
      const text = await r.text();
      if (!r.ok) return res.status(r.status).json({ error: text, endpoint });
      const data = JSON.parse(text);
      return res.status(200).json({ id: data.id || data.job_id || data.request_id, ...data });
    }

    // Poll job status
    if (action === 'job-status') {
      const { job_id } = req.query;
      const r = await fetch(`${BASE}/v1/requests/${job_id}/status`, { headers: auth });
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
