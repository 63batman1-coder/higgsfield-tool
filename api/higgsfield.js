export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', '*');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;
  if (!ANTHROPIC_KEY) return res.status(500).json({ error: 'Missing ANTHROPIC_API_KEY environment variable' });

  try {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const { imageUrl, imagePrompt, videoPrompt, aspectRatio = '9:16' } = JSON.parse(Buffer.concat(chunks).toString());

    if (!imageUrl || !imagePrompt || !videoPrompt) {
      return res.status(400).json({ error: 'Missing imageUrl, imagePrompt, or videoPrompt' });
    }

    const prompt = `You have access to Higgsfield MCP tools. Run this exact pipeline and return ONLY a JSON object.

Steps:
1. Call media_import_url with url="${imageUrl}" and type="image" to get a media_id
2. Call generate_image with model "nano_banana_2", prompt "${imagePrompt}", the media_id as medias[0].value with role "image", aspect_ratio "${aspectRatio}"
3. Wait for image job to complete with jobs_wait
4. Call generate_video with model "kling3_0", prompt "${videoPrompt}", the image job_id as medias[0].value with role "start_image", aspect_ratio "${aspectRatio}", duration 5, sound "off"
5. Wait for video job to complete with jobs_wait
6. Return ONLY this JSON: {"success":true,"image_url":"<result image url>","video_url":"<result video url>"}
   On any error return: {"success":false,"error":"<what went wrong>"}

Return ONLY the JSON object. No explanation, no markdown, no other text.`;

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
        mcp_servers: [{
          type: 'url',
          url: 'https://mcp.higgsfield.ai/mcp',
          name: 'higgsfield'
        }],
        messages: [{ role: 'user', content: prompt }]
      })
    });

    if (!response.ok) {
      const errText = await response.text();
      return res.status(500).json({ error: `Claude API error: ${response.status} ${errText}` });
    }

    const data = await response.json();
    const text = data.content?.filter(b => b.type === 'text').map(b => b.text).join('') || '';
    const clean = text.replace(/```json\n?|```\n?/g, '').trim();

    try {
      const result = JSON.parse(clean);
      return res.status(200).json(result);
    } catch {
      return res.status(500).json({ error: 'Bad response from Claude: ' + text.slice(0, 300) });
    }

  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}

export const config = { api: { bodyParser: false } };
