/**
 * Copper Finch — Prompt Sharpener (server side)
 * ---------------------------------------------------------------
 * Deploy to Vercel or Netlify as a serverless function.
 *
 * WHY THIS FILE EXISTS:
 * The API key must NEVER live in the web page — anyone can read a
 * page's code and steal it. This file runs on the server, where the
 * key stays private. The page talks to THIS, and this talks to Google.
 *
 * SETUP (one-time):
 *  1. Revoke the key you pasted into chat. Create a fresh one.
 *  2. In your hosting dashboard, add an environment variable:
 *        Name:  GEMINI_API_KEY
 *        Value: <your new key>
 *  3. Deploy. Never put the key in any file you commit or upload.
 *
 * MODEL NAME: verify the current model name in Google AI Studio and
 * update MODEL below if needed — Google renames these periodically.
 */

const MODEL = 'gemini-2.0-flash';
const HOURLY_LIMIT = 10;        // per visitor, matches the message on the page
const DAILY_GLOBAL_CAP = 2000;  // hard ceiling so no bill can run away

// Simple in-memory counters. NOTE: these reset whenever the server
// restarts or scales, so treat them as a safety net rather than
// perfect enforcement. At your volumes that is fine — the daily cap
// is the real protection against a runaway bill.
const visitors = new Map();
let globalCount = 0;
let globalDay = new Date().toDateString();

const SYSTEM_INSTRUCTION = `You are a prompt engineering expert. The user has drafted a prompt using a ROLE / TASK / CONTEXT / FORMAT framework.

Rewrite it to be significantly more effective:
- Sharpen the role into a specific, credible expert persona
- Make the task a precise instruction with clear success criteria
- Tighten the context so nothing essential is assumed
- Make the format unambiguous and machine-followable

Rules:
- Keep any [square bracket] placeholders exactly as they are — they are the user's own fill-ins
- Keep any pasted material markers intact
- Do not answer the prompt. Return ONLY the improved prompt itself
- No preamble, no explanation, no markdown code fences
- Keep it roughly the same length or shorter`;

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // --- reset the global counter each day ---
  const today = new Date().toDateString();
  if (today !== globalDay) { globalDay = today; globalCount = 0; }

  if (globalCount >= DAILY_GLOBAL_CAP) {
    return res.status(429).json({ error: 'Daily capacity reached' });
  }

  // --- per-visitor hourly limit ---
  const ip = (req.headers['x-forwarded-for'] || 'unknown').split(',')[0].trim();
  const now = Date.now();
  const recent = (visitors.get(ip) || []).filter(t => now - t < 60 * 60 * 1000);

  if (recent.length >= HOURLY_LIMIT) {
    return res.status(429).json({ error: 'Hourly limit reached' });
  }

  // --- validate input ---
  const { prompt } = req.body || {};
  if (!prompt || typeof prompt !== 'string' || prompt.length > 4000) {
    return res.status(400).json({ error: 'Invalid prompt' });
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: 'Server not configured' });
  }

  try {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          system_instruction: { parts: [{ text: SYSTEM_INSTRUCTION }] },
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { temperature: 0.4, maxOutputTokens: 1200 }
        })
      }
    );

    if (!response.ok) {
      return res.status(502).json({ error: 'Upstream error' });
    }

    const data = await response.json();
    const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;

    if (!text) {
      return res.status(502).json({ error: 'Empty response' });
    }

    // only count successful calls
    recent.push(now);
    visitors.set(ip, recent);
    globalCount++;

    return res.status(200).json({ prompt: text.trim() });

  } catch (err) {
    return res.status(502).json({ error: 'Upstream error' });
  }
}
