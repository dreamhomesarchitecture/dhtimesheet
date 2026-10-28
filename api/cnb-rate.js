// Kurz ČNB k datu: /api/cnb-rate?cur=EUR&date=2026-01-23 → { cur, date, rate } (Kč za 1 jednotku měny).
// O víkendu a ve svátek ČNB vrací kurz posledního pracovního dne.
module.exports = async (req, res) => {
  try {
    const q = req.query || {};
    const cur = String(q.cur || "EUR").toUpperCase();
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(q.date || ""));
    if (!/^[A-Z]{3}$/.test(cur) || !m) return res.status(400).json({ error: "bad request" });
    const url = `https://www.cnb.cz/cs/financni-trhy/devizovy-trh/kurzy-devizoveho-trhu/kurzy-devizoveho-trhu/denni_kurz.txt?date=${m[3]}.${m[2]}.${m[1]}`;
    const r = await fetch(url);
    if (!r.ok) return res.status(502).json({ error: "cnb unavailable" });
    const text = await r.text();
    const row = text.split("\n").map((l) => l.trim().split("|")).find((p) => p[3] === cur);
    if (!row) return res.status(404).json({ error: "currency not found" });
    const amount = Number(row[2]);
    const rate = Number(String(row[4]).replace(",", "."));
    if (!(amount > 0) || !(rate > 0)) return res.status(502).json({ error: "bad data" });
    res.setHeader("Cache-Control", "public, max-age=86400");
    return res.status(200).json({ cur, date: m[0], rate: rate / amount });
  } catch (err) {
    return res.status(500).json({ error: "failed" });
  }
};
