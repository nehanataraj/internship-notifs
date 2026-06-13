export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    res.status(200).end();
    return;
  }

  const base = (process.env.RESUME_API_URL || "https://resume-tailor.fly.dev").replace(/\/$/, "");
  const segments = req.query.path;
  const path = Array.isArray(segments) ? segments.join("/") : (segments || "");
  const url = `${base}/api/${path}`;

  const headers = { "Content-Type": "application/json" };
  const init = { method: req.method, headers };

  if (req.method !== "GET" && req.method !== "HEAD" && req.body) {
    init.body = JSON.stringify(req.body);
  }

  try {
    const upstream = await fetch(url, init);
    res.status(upstream.status);
    const respCt = upstream.headers.get("content-type") || "";
    if (respCt) res.setHeader("Content-Type", respCt);
    const cd = upstream.headers.get("content-disposition");
    if (cd) res.setHeader("Content-Disposition", cd);

    if (respCt.includes("application/pdf")) {
      const buf = Buffer.from(await upstream.arrayBuffer());
      res.send(buf);
      return;
    }
    const text = await upstream.text();
    try {
      res.json(JSON.parse(text));
    } catch {
      res.send(text);
    }
  } catch (e) {
    res.status(502).json({ error: String(e.message || e) });
  }
}
