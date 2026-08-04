export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', '*');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;
  if (!ANTHROPIC_KEY) return res.status(500).json({ error: 'Missing ANTHROPIC_API_KEY' });

  const HIGGSFIELD_TOKEN = process.env.HIGGSFIELD_TOKEN;
  if (!HIGGSFIELD_TOKEN) return res.status(500).json({ error: 'Missing HIGGSFIELD_TOKEN' });

  try {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const body = JSON.parse(Buffer.concat(chunks).toString());
    const { imageUrl, imagePrompt, videoPrompt, aspectRatio = '9:16' } = body;

    if (!imageUrl || !imagePrompt || !videoPrompt) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    // Check if it's a base64 data URL (pasted image) or a regular URL
    const isDataUrl = imageUrl.startsWith('data:image/');

    let claudeContent;
    if (isDataUrl) {
      // Extract base64 data and media type
      const matches = imageUrl.match(/^data:(image\/[^;]+);base64,(.+)$/);
      if (!matches) return res.status(400).json({ error: 'Invalid image data' });
      const mediaType = matches[1];
      const base64Data = matches[2];

      claudeContent = [
        {
          type: 'image',
          source: { type: 'base64', media_type: mediaType, data: base64Data }
        },
        {
          type: 'text',
          text: `You have access to Higgsfield MCP tools. The image above is the product image. Run this pipeline and return ONLY a JSON object.

Steps:
1. Upload this image to Higgsfield using media_upload_widget or by calling media_import_url — since this is a base64 image, use the Higgsfield upload tools to get a media_id
2. Call generate_image with model "nano_banana_2", prompt "${imagePrompt}", using the uploaded media_id as medias[0].value with role "image", aspect_ratio "${aspectRatio}"
3. Wait for image job to complete with jobs_wait
4. Call generate_video with model "kling3_0", prompt "${videoPrompt}", using the image job_id as medias[0].value with role "start_image", aspect_ratio "${aspectRatio}", duration 5, sound "off"
5. Wait for video job to complete with jobs_wait
6. Return ONLY: {"success":true,"image_url":"<result image url>","video_url":"<result video url>"}
   On error: {"success":false,"error":"<what went wrong>"}

Return ONLY the JSON. No markdown, no explanation.`
        }
      ];
    } else {
      claudeContent = `You have access to Higgsfield MCP tools. Run this pipeline and return ONLY a JSON object.

Steps:
1. Call media_import_url with url="${imageUrl}" and type="image" to get a media_id
2. Call generate_image with model "nano_banana_2", prompt "${imagePrompt}", the media_id as medias[0].value with role "image", aspect_ratio "${aspectRatio}"
3. Wait for image job to complete with jobs_wait
4. Call generate_video with model "kling3_0", prompt "${videoPrompt}", the image job_id as medias[0].value with role "start_image", aspect_ratio "${aspectRatio}", duration 5, sound "off"
5. Wait for video job to complete with jobs_wait
6. Return ONLY: {"success":true,"image_url":"<result image url>","video_url":"<result video url>"}
   On error: {"success":false,"error":"<what went wrong>"}

Return ONLY the JSON. No markdown, no explanation.`;
    }

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ANTHROPIC_KEY,
        'anthropic-version': '2023-06-01',
        'anthropic-beta': 'mcp-client-2025-04-04'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-5',
        max_tokens: 2048,
        mcp_servers: [{ type: 'url', url: 'https://mcp.higgsfield.ai/mcp', name: 'higgsfield', authorization_token: HIGGSFIELD_TOKEN }],
        messages: [{ role: 'user', content: claudeContent }]
      })
    });

    if (!response.ok) throw new Error(`Claude API error: ${response.status} ${await response.text()}`);

    const data = await response.json();
    const text = data.content?.filter(b => b.type === 'text').map(b => b.text).join('') || '';
    const clean = text.replace(/```json\n?|```\n?/g, '').trim();

    try {
      return res.status(200).json(JSON.parse(clean));
    } catch {
      return res.status(500).json({ error: 'Bad response: ' + text.slice(0, 300) });
    }
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}

export const config = { api: { bodyParser: false, sizeLimit: '10mb' } };
