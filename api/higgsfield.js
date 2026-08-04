export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', '*');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const KEY_ID = process.env.HF_KEY_ID;
  const KEY_SECRET = process.env.HF_KEY_SECRET;
  if (!KEY_ID || !KEY_SECRET) return res.status(500).json({ error: 'Missing HF_KEY_ID or HF_KEY_SECRET' });

  const GW = 'https://fnf-api-gw.higgsfield.ai';

  // Get a fresh JWT token using platform credentials
  async function getToken() {
    const r = await fetch(`${GW}/auth/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key_id: KEY_ID, key_secret: KEY_SECRET })
    });
    if (!r.ok) throw new Error(`Auth failed: ${r.status} ${await r.text()}`);
    const data = await r.json();
    const token = data?.token || data?.access_token || data?.jwt;
    if (!token) throw new Error('No token in auth response: ' + JSON.stringify(data));
    return token;
  }

  async function gw(token, path, method = 'GET', body = null) {
    const opts = {
      method,
      headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' }
    };
    if (body) opts.body = JSON.stringify(body);
    const r = await fetch(`${GW}${path}`, opts);
    if (!r.ok) throw new Error(`${method} ${path} failed: ${r.status} ${await r.text()}`);
    return r.json();
  }

  async function pollJob(token, jobId, maxWaitMs = 240000) {
    const start = Date.now();
    while (Date.now() - start < maxWaitMs) {
      await new Promise(r => setTimeout(r, 5000));
      const data = await gw(token, `/v1/requests/${jobId}/status`);
      const status = data?.status || data?.data?.status;
      const resultUrl = data?.result_url || data?.data?.result_url || data?.output_url || data?.data?.output_url;
      if (status === 'completed' || status === 'success') return resultUrl;
      if (status === 'failed' || status === 'error') throw new Error('Job failed: ' + JSON.stringify(data));
    }
    throw new Error('Job timed out');
  }

  try {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const body = JSON.parse(Buffer.concat(chunks).toString());
    const { imageUrl, imagePrompt, videoPrompt, aspectRatio = '9:16' } = body;

    if (!imageUrl || !imagePrompt || !videoPrompt) {
      return res.status(400).json({ error: 'Missing required fields' });
    }
    if (imageUrl.startsWith('data:image/')) {
      return res.status(400).json({ error: 'Pasted screenshots are not supported — use "Copy Image Address" to get a URL.' });
    }

    const token = await getToken();

    // Import image URL
    const importData = await gw(token, '/fnf/media/import-url', 'POST', { url: imageUrl, type: 'image' });
    const mediaId = importData?.id || importData?.data?.id || importData?.media_id || importData?.data?.media_id;
    if (!mediaId) throw new Error('No media_id from import: ' + JSON.stringify(importData));

    // Generate image with nano_banana_2
    const imgData = await gw(token, '/v1/generate/image', 'POST', {
      model: 'nano_banana_2',
      prompt: imagePrompt,
      aspect_ratio: aspectRatio,
      medias: [{ value: mediaId, role: 'image' }]
    });
    const imgJobId = imgData?.id || imgData?.data?.id || imgData?.job_id;
    if (!imgJobId) throw new Error('No job_id from image gen: ' + JSON.stringify(imgData));

    const imageResultUrl = await pollJob(token, imgJobId);
    if (!imageResultUrl) throw new Error('No image result URL after polling');

    // Generate video with kling3_0
    const vidData = await gw(token, '/v1/generate/video', 'POST', {
      model: 'kling3_0',
      prompt: videoPrompt,
      aspect_ratio: aspectRatio,
      duration: 5,
      sound: 'off',
      medias: [{ value: imgJobId, role: 'start_image' }]
    });
    const vidJobId = vidData?.id || vidData?.data?.id || vidData?.job_id;
    if (!vidJobId) throw new Error('No job_id from video gen: ' + JSON.stringify(vidData));

    const videoResultUrl = await pollJob(token, vidJobId);
    if (!videoResultUrl) throw new Error('No video result URL after polling');

    return res.status(200).json({ success: true, image_url: imageResultUrl, video_url: videoResultUrl });

  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}

export const config = { api: { bodyParser: false } };
