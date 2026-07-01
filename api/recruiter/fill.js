const EMAIL_TEMPLATE = `Hi [Name]!

Great meeting you at [Event] — I really enjoyed hearing about [team's project/need]. It reminded me of [article/resource], which took a similar approach — [1 clause tying it to attached article].
I've applied for [Role/Internship] and would love to connect with someone on the engineering team in the future.

Really enjoyed our conversation — it was lovely hearing about [topic talked about]. Thanks again for your time!
[Your Name]`;

const SYSTEM_PROMPT = `You write post-career-fair follow-up messages for students reaching out to recruiters.

Rules:
- Use ONLY facts from the user's conversation context and optional overrides. Never invent employers, people, or projects not supported by the input.
- Warm, professional, concise — not salesy.
- For article/resource: suggest ONE real, well-known article, talk, paper, or blog post that plausibly relates to what they discussed (name it specifically). Tie it in with one short clause.
- If a field is unknown and cannot be inferred, use a natural generic phrase or omit gracefully.
- Return valid JSON only: {"message":"..."}`;

function buildUserPrompt(mode, context, overrides) {
  const parts = [
    `Mode: ${mode}`,
    "",
    "Conversation context:",
    context.trim(),
    "",
    "Optional overrides (use these when provided):",
    `- Recruiter name: ${overrides.name || "(infer from context)"}`,
    `- Event: ${overrides.event || "(infer from context)"}`,
    `- Role/Internship: ${overrides.role || "(infer from context)"}`,
    `- Your name: ${overrides.your_name || "(infer from context or use a placeholder)"}`,
  ];

  if (mode === "linkedin") {
    parts.push(
      "",
      "Write a LinkedIn connection request note.",
      "HARD LIMIT: 300 characters including spaces. Count carefully.",
      "Mention the event, one specific detail from the conversation, and interest in connecting. Include role if known.",
      "No subject line. Plain text only.",
    );
  } else {
    parts.push(
      "",
      "Fill in this email template. Keep the structure and line breaks. Replace every bracketed placeholder:",
      EMAIL_TEMPLATE,
    );
  }

  return parts.join("\n");
}

module.exports = async function handler(req, res) {
  if (req.method === "OPTIONS") {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
    return res.status(204).end();
  }

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return res.status(503).json({
      error: "OPENAI_API_KEY is not configured. Set it in Vercel environment variables.",
    });
  }

  let body = req.body;
  if (typeof body === "string") {
    try {
      body = JSON.parse(body);
    } catch {
      return res.status(400).json({ error: "Invalid JSON body" });
    }
  }

  const mode = body?.mode === "linkedin" ? "linkedin" : "email";
  const context = String(body?.context || "").trim();
  if (!context) {
    return res.status(400).json({ error: "Conversation context is required." });
  }

  const overrides = {
    name: String(body?.name || "").trim(),
    event: String(body?.event || "").trim(),
    role: String(body?.role || "").trim(),
    your_name: String(body?.your_name || "").trim(),
  };

  try {
    const r = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: process.env.OPENAI_MODEL || "gpt-4o-mini",
        temperature: 0.6,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: buildUserPrompt(mode, context, overrides) },
        ],
      }),
    });

    const data = await r.json();
    if (!r.ok) {
      const msg = data?.error?.message || "OpenAI request failed";
      return res.status(r.status >= 500 ? 502 : 400).json({ error: msg });
    }

    const raw = data?.choices?.[0]?.message?.content || "";
    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return res.status(502).json({ error: "Model returned invalid JSON. Try again." });
    }

    let message = String(parsed.message || "").trim();
    if (!message) {
      return res.status(502).json({ error: "Model returned an empty message." });
    }

    if (mode === "linkedin" && message.length > 300) {
      message = message.slice(0, 300).replace(/\s+\S*$/, "").trim();
    }

    res.setHeader("Access-Control-Allow-Origin", "*");
    return res.status(200).json({ message, mode, char_count: message.length });
  } catch (e) {
    return res.status(502).json({ error: e.message || "Generation failed" });
  }
};
