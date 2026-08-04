export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', '*');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const KEY_ID = process.env.HF_KEY_ID;
  const KEY_SECRET = process.env.HF_KEY_SECRET;
  if (!KEY_ID || !KEY_SECRET) return res.status(500).json({ error: 'Missing HF_KEY_ID or HF_KEY_SECRET' });

  const HF_HEADERS = {
    'Content-Type': 'application/json',
    'hf-api-key': KEY_ID,
    'hf-secret': KEY_SECRET
  };

  const BASE = 'https://platform.higgsfield.ai';

  async function pollJob(jobId, maxWaitMs = 240000) {
    const start = Date.now();
    while (Date.now() - start < maxWaitMs) {
      await new Promise(r => setTimeout(r, 4000));
      const r = await fetch(`${BASE}/v1/requests/${jobId}/status`, { headers: HF_HEADERS });
      if (!r.ok) throw new Error(`Poll error: ${r.status}`);
      const data = await r.json();
      const status = data?.status || data?.data?.status;
      if (status === 'completed' || status === 'success') {
        return data?.result_url || data?.data?.result_url || data?.output_url || data?.data?.output_url;
      }
      if (status === 'failed' || status === 'error') {
        throw new Error('Job failed: ' + JSON.stringify(data));
      }
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

    // Step 1: Import image URL into Higgsfield
    const importRes = await fetch(`${BASE}/files/import-url`, {
      method: 'POST',
      headers: HF_HEADERS,
      body: JSON.stringify({ url: imageUrl, type: 'image' })
    });
    if (!importRes.ok) throw new Error(`Import failed: ${importRes.status} ${await importRes.text()}`);
    const importData = await importRes.json();
    const mediaId = importData?.id || importData?.data?.id || importData?.media_id;
    if (!mediaId) throw new Error('No media_id from import: ' + JSON.stringify(importData));

    // Step 2: Generate image with nano_banana_2
    const imgRes = await fetch(`${BASE}/v1/generate/image`, {
      method: 'POST',
      headers: HF_HEADERS,
      body: JSON.stringify({
        model: 'nano_banana_2',
        prompt: imagePrompt,
        aspect_ratio: aspectRatio,
        medias: [{ value: mediaId, role: 'image' }]
      })
    });
    if (!imgRes.ok) throw new Error(`Image gen failed: ${imgRes.status} ${await imgRes.text()}`);
    const imgData = await imgRes.json();
    const imgJobId = imgData?.id || imgData?.data?.id || imgData?.job_id;
    if (!imgJobId) throw new Error('No job_id from image gen: ' + JSON.stringify(imgData));

    // Step 3: Poll for image result
    const imageResultUrl = await pollJob(imgJobId);
    if (!imageResultUrl) throw new Error('No image result URL after polling');

    // Step 4: Generate video with kling3_0
    const vidRes = await fetch(`${BASE}/v1/generate/video`, {
      method: 'POST',
      headers: HF_HEADERS,
      body: JSON.stringify({
        model: 'kling3_0',
        prompt: videoPrompt,
        aspect_ratio: aspectRatio,
        duration: 5,
        sound: 'off',
        medias: [{ value: imgJobId, role: 'start_image' }]
      })
    });
    if (!vidRes.ok) throw new Error(`Video gen failed: ${vidRes.status} ${await vidRes.text()}`);
    const vidData = await vidRes.json();
    const vidJobId = vidData?.id || vidData?.data?.id || vidData?.job_id;
    if (!vidJobId) throw new Error('No job_id from video gen: ' + JSON.stringify(vidData));

    // Step 5: Poll for video result
    const videoResultUrl = await pollJob(vidJobId);
    if (!videoResultUrl) throw new Error('No video result URL after polling');

    return res.status(200).json({ success: true, image_url: imageResultUrl, video_url: videoResultUrl });

  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}

export const config = { api: { bodyParser: false } };
