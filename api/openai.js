const PROMPTS = {
  polish: (company) =>
    `You edit internship application notes. Clean up the markdown below for ${company || "a company"}: fix grammar, tighten wording, keep all facts. Return only valid markdown, no code fences.`,
  expand: (company) =>
    `Expand these internship prep notes for ${company || "a company"} with useful markdown bullets (role research, talking points, questions to ask). Return only markdown.`,
  summarize: (company) =>
    `Summarize these notes for ${company || "a company"} into short markdown bullet points. Return only markdown.`,
};

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    res.status(200).end();
    return;
  }
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    res.status(500).json({ error: "OPENAI_API_KEY not configured on server" });
    return;
  }

  const { action, text, company } = req.body || {};
  if (!action || !text) {
    res.status(400).json({ error: "action and text required" });
    return;
  }
  const prompt = PROMPTS[action];
  if (!prompt) {
    res.status(400).json({ error: "Unknown action" });
    return;
  }

  try {
    const upstream = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        temperature: 0.4,
        messages: [
          { role: "system", content: prompt(company) },
          { role: "user", content: String(text).slice(0, 12000) },
        ],
      }),
    });
    const data = await upstream.json();
    if (!upstream.ok) {
      res.status(upstream.status).json({
        error: data.error?.message || "OpenAI request failed",
      });
      return;
    }
    const out = data.choices?.[0]?.message?.content?.trim() || "";
    res.status(200).json({ text: out });
  } catch (e) {
    res.status(502).json({ error: String(e.message || e) });
  }
}
