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
      if (!r.ok) throw new Error(`Poll error: ${r.status} ${await r.text()}`);
      const data = await r.json();
      const status = data?.status || data?.data?.status;
      const resultUrl = data?.result_url || data?.data?.result_url || data?.output_url || data?.data?.output_url;
      if (status === 'completed' || status === 'success') return resultUrl;
      if (status === 'failed' || status === 'error') throw new Error('Job failed: ' + JSON.stringify(data));
    }
    throw new Error('Job timed out');
  }

  async function getMediaId(imageUrl) {
    const isBase64 = imageUrl.startsWith('data:image/');

    // Get presigned upload URL
    const uploadUrlRes = await fetch(`${BASE}/files/generate-upload-url`, {
      method: 'POST',
      headers: HF_HEADERS,
      body: JSON.stringify({ file_name: 'product.jpg', content_type: 'image/jpeg' })
    });
    if (!uploadUrlRes.ok) throw new Error(`Upload URL failed: ${uploadUrlRes.status} ${await uploadUrlRes.text()}`);
    const uploadData = await uploadUrlRes.json();
    const uploadUrl = uploadData?.upload_url || uploadData?.data?.upload_url;
    const mediaId = uploadData?.id || uploadData?.data?.id || uploadData?.file_id || uploadData?.data?.file_id;
    if (!uploadUrl) throw new Error('No upload_url in response: ' + JSON.stringify(uploadData));

    let imageBuffer;
    if (isBase64) {
      const base64Data = imageUrl.split(',')[1];
      const binary = atob(base64Data);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
      imageBuffer = bytes.buffer;
    } else {
      const imgFetch = await fetch(imageUrl);
      if (!imgFetch.ok) throw new Error(`Could not fetch image: ${imgFetch.status}`);
      imageBuffer = await imgFetch.arrayBuffer();
    }

    // Upload to S3
    const putRes = await fetch(uploadUrl, {
      method: 'PUT',
      headers: { 'Content-Type': 'image/jpeg' },
      body: imageBuffer
    });
    if (!putRes.ok) throw new Error(`S3 upload failed: ${putRes.status}`);

    if (mediaId) return mediaId;

    // If no ID in upload response, confirm the upload
    const confirmRes = await fetch(`${BASE}/files/confirm-upload`, {
      method: 'POST',
      headers: HF_HEADERS,
      body: JSON.stringify({ upload_url: uploadUrl })
    });
    if (confirmRes.ok) {
      const confirmData = await confirmRes.json();
      const confirmedId = confirmData?.id || confirmData?.data?.id || confirmData?.file_id;
      if (confirmedId) return confirmedId;
    }

    throw new Error('Could not get media_id after upload. Upload response: ' + JSON.stringify(uploadData));
  }

  try {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const body = JSON.parse(Buffer.concat(chunks).toString());
    const { imageUrl, imagePrompt, videoPrompt, aspectRatio = '9:16' } = body;

    if (!imageUrl || !imagePrompt || !videoPrompt) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    const mediaId = await getMediaId(imageUrl);

    // Generate image with nano_banana_2
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

    const imageResultUrl = await pollJob(imgJobId);
    if (!imageResultUrl) throw new Error('No image result URL after polling');

    // Generate video with kling3_0
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

    const videoResultUrl = await pollJob(vidJobId);
    if (!videoResultUrl) throw new Error('No video result URL after polling');

    return res.status(200).json({ success: true, image_url: imageResultUrl, video_url: videoResultUrl });

  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}

export const config = { api: { bodyParser: false } };
