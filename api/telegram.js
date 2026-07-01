export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    res.status(200).end();
    return;
  }
  if (req.method !== "POST") {
    res.status(405).json({ ok: false, description: "Method not allowed" });
    return;
  }

  const { token: clientToken, method, params } = req.body || {};
  const token = process.env.TELEGRAM_BOT_TOKEN || clientToken;
  if (!token || !method) {
    res.status(400).json({ ok: false, description: "method required (server token missing)" });
    return;
  }

  const chatId = params && params.chat_id ? params.chat_id : process.env.TELEGRAM_CHAT_ID;
  const finalParams = chatId ? { ...(params || {}), chat_id: chatId } : (params || {});

  try {
    const upstream = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(finalParams),
    });
    const data = await upstream.json();
    res.status(upstream.status).json(data);
  } catch (e) {
    res.status(502).json({ ok: false, description: String(e.message || e) });
  }
}
