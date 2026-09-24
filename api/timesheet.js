const GITHUB_REPO = process.env.GITHUB_REPO || "dreamhomesarchitecture/dhtimesheet";
const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || null;
const DIR = "data";

function pathForKey(key) {
  const safeKey = String(key || "").replace(/[^a-zA-Z0-9_-]/g, "_");
  return `${DIR}/${safeKey}.json`;
}

function isAdminRequest(req) {
  if (!ADMIN_PASSWORD) return false;
  const provided = req.headers["x-admin-password"];
  return typeof provided === "string" && provided === ADMIN_PASSWORD;
}

// Keys that only an authenticated admin may read or write at all.
const ADMIN_ONLY_KEYS = new Set(["costs"]);

// For "config", everyone may GET, but non-admins get pricing/cost/secret
// fields stripped out first. Writes to "config" always require admin.
function sanitizeConfig(rawValue) {
  let config;
  try {
    config = JSON.parse(rawValue);
  } catch (e) {
    return rawValue;
  }
  delete config.adminPassword;
  (config.employees || []).forEach((e) => {
    delete e.rates;
  });
  (config.projects || []).forEach((p) => {
    delete p.phaseBudgets;
    delete p.phaseBudgetItems;
    delete p.phaseBudgetPayments;
    delete p.clientBillableRates;
  });
  delete config.billingProfiles;
  return JSON.stringify(config);
}

module.exports = async (req, res) => {
  try {
    if (!GITHUB_TOKEN) return res.status(500).json({ error: "GITHUB_TOKEN not configured" });

    const key = req.query && req.query.key;
    if (!key) return res.status(400).json({ error: "missing key" });
    const path = pathForKey(key);
    const admin = isAdminRequest(req);
    const writeNeedsAdmin = key === "config" || ADMIN_ONLY_KEYS.has(key);
    const readNeedsAdmin = ADMIN_ONLY_KEYS.has(key);

    if (req.method === "GET") {
      if (readNeedsAdmin && !admin) return res.status(403).json({ error: "forbidden" });
      const getRes = await fetch(`https://api.github.com/repos/${GITHUB_REPO}/contents/${path}`, {
        headers: { Authorization: `token ${GITHUB_TOKEN}`, Accept: "application/vnd.github+json" }
      });
      if (getRes.status === 404) return res.status(404).json({ found: false });
      if (!getRes.ok) return res.status(502).json({ error: "get failed" });
      const fileData = await getRes.json();
      let value = Buffer.from(fileData.content, "base64").toString("utf-8");
      if (key === "config" && !admin) value = sanitizeConfig(value);
      return res.status(200).json({ found: true, value, admin });
    }

    if (req.method === "PUT") {
      if (writeNeedsAdmin && !admin) return res.status(403).json({ error: "forbidden" });
      const value = req.body && req.body.value;
      if (typeof value !== "string") return res.status(400).json({ error: "missing value" });
      const getRes = await fetch(`https://api.github.com/repos/${GITHUB_REPO}/contents/${path}`, {
        headers: { Authorization: `token ${GITHUB_TOKEN}`, Accept: "application/vnd.github+json" }
      });
      const existing = getRes.ok ? await getRes.json() : null;
      const body = {
        message: `Aktualizace vykazu (${path})`,
        content: Buffer.from(value, "utf-8").toString("base64")
      };
      if (existing) body.sha = existing.sha;
      const putRes = await fetch(`https://api.github.com/repos/${GITHUB_REPO}/contents/${path}`, {
        method: "PUT",
        headers: {
          Authorization: `token ${GITHUB_TOKEN}`,
          Accept: "application/vnd.github+json",
          "Content-Type": "application/json"
        },
        body: JSON.stringify(body)
      });
      if (!putRes.ok) return res.status(502).json({ error: "put failed", detail: await putRes.text() });
      return res.status(200).json({ ok: true });
    }

    if (req.method === "DELETE") {
      if (writeNeedsAdmin && !admin) return res.status(403).json({ error: "forbidden" });
      const getRes = await fetch(`https://api.github.com/repos/${GITHUB_REPO}/contents/${path}`, {
        headers: { Authorization: `token ${GITHUB_TOKEN}`, Accept: "application/vnd.github+json" }
      });
      if (getRes.status === 404) return res.status(200).json({ ok: true });
      if (!getRes.ok) return res.status(502).json({ error: "get failed" });
      const fileData = await getRes.json();
      const delRes = await fetch(`https://api.github.com/repos/${GITHUB_REPO}/contents/${path}`, {
        method: "DELETE",
        headers: {
          Authorization: `token ${GITHUB_TOKEN}`,
          Accept: "application/vnd.github+json",
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ message: `Smazani vykazu (${path})`, sha: fileData.sha })
      });
      if (!delRes.ok) return res.status(502).json({ error: "delete failed", detail: await delRes.text() });
      return res.status(200).json({ ok: true });
    }

    res.setHeader("Allow", "GET, PUT, DELETE");
    return res.status(405).json({ error: "method not allowed" });
  } catch (e) {
    return res.status(500).json({ error: String(e) });
  }
};
