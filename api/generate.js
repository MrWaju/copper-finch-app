const rateLimitMap = new Map();

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).send('Method Not Allowed');

  // LAYER 4: RATE LIMITING (50 Uses Per IP)
  const ip = req.headers['x-forwarded-for'] || 'unknown_ip';
  const currentTime = Date.now();
  
  if (!rateLimitMap.has(ip)) {
    rateLimitMap.set(ip, { count: 1, firstRequest: currentTime });
  } else {
    const data = rateLimitMap.get(ip);
    if (currentTime - data.firstRequest > 86400000) { 
      rateLimitMap.set(ip, { count: 1, firstRequest: currentTime });
    } else if (data.count >= 50) {
      return res.status(429).json({ error: 'Daily safety limit reached.' });
    } else {
      data.count += 1;
      rateLimitMap.set(ip, data);
    }
  }

  const { role, task, context, format } = req.body;

  const systemPrompt = `You are an elite prompt engineer. A user wants to build a master prompt based on:
Role: ${role} | Task: ${task} | Context: ${context} | Format: ${format}. 
Combine and enhance these into one single, highly detailed, expert-level prompt the user can copy/paste. Output ONLY the final prompt. No conversational filler.`;

  try {
    const apiKey = process.env.GEMINI_API_KEY;
    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ contents: [{ parts: [{ text: systemPrompt }] }] })
    });
    
    const data = await response.json();
    const resultText = data.candidates[0].content.parts[0].text;
    res.status(200).json({ prompt: resultText });
  } catch (error) {
    res.status(500).json({ error: 'System failure.' });
  }
}
