const { GITHUB_TOKEN, getRaw, putRaw, deleteRaw, verifyEmployeeToken } = require("./_store");
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || null;

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
    delete e.password;
  });
  (config.projects || []).forEach((p) => {
    delete p.phaseBudgets;
    delete p.phaseBudgetItems;
    delete p.phaseBudgetPayments;
    delete p.clientBillableRates;
  });
  delete config.billingProfiles;
  delete config.suppliers;
  return JSON.stringify(config);
}

// Zápis konfigurace přichází z administrace jako CELÝ soubor. Pokud má admin otevřenou
// starší kopii, přepsal by tím hesla, která si mezitím změnili zaměstnanci. Proto se
// u zaměstnanců, kteří už v uloženém souboru jsou, vždy ponechá uložené heslo — admin
// ho měnit neumí (jen zakládá nové zaměstnance). Nové heslo projde jen s novějším
// passwordChangedAt.
async function mergeConfigPasswords(incomingValue) {
  let incoming;
  try {
    incoming = JSON.parse(incomingValue);
  } catch (e) {
    return incomingValue;
  }
  const existing = await getRaw("config");
  if (!existing.found) return incomingValue;
  let stored;
  try {
    stored = JSON.parse(existing.value);
  } catch (e) {
    return incomingValue;
  }
  const storedById = {};
  (stored.employees || []).forEach((e) => {
    storedById[e.id] = e;
  });
  (incoming.employees || []).forEach((e) => {
    const s = storedById[e.id];
    if (!s || typeof s.password !== "string") return;
    if (Number(e.passwordChangedAt || 0) > Number(s.passwordChangedAt || 0)) return;
    e.password = s.password;
    if (s.passwordChangedAt) e.passwordChangedAt = s.passwordChangedAt;
    else delete e.passwordChangedAt;
  });
  return JSON.stringify(incoming);
}

module.exports = async (req, res) => {
  try {
    if (!GITHUB_TOKEN) return res.status(500).json({ error: "GITHUB_TOKEN not configured" });

    const key = req.query && req.query.key;
    if (!key) return res.status(400).json({ error: "missing key" });
    const admin = isAdminRequest(req);

    // entries:<employeeId> may be accessed by an admin, or by that specific
    // employee's own signed session token — nobody else.
    const entriesEmployeeId = key.startsWith("entries:") ? key.slice("entries:".length) : null;
    const authorizedForEntries =
      entriesEmployeeId !== null && (admin || verifyEmployeeToken(req.headers["x-employee-token"], entriesEmployeeId));

    const writeNeedsAdmin = key === "config" || ADMIN_ONLY_KEYS.has(key);
    const readNeedsAdmin = ADMIN_ONLY_KEYS.has(key);

    if (req.method === "GET") {
      if (readNeedsAdmin && !admin) return res.status(403).json({ error: "forbidden" });
      if (entriesEmployeeId !== null && !authorizedForEntries) return res.status(403).json({ error: "forbidden" });
      const result = await getRaw(key);
      if (!result.found) return res.status(404).json({ found: false });
      let value = result.value;
      if (key === "config" && !admin) value = sanitizeConfig(value);
      return res.status(200).json({ found: true, value, admin });
    }

    if (req.method === "PUT") {
      if (writeNeedsAdmin && !admin) return res.status(403).json({ error: "forbidden" });
      if (entriesEmployeeId !== null && !authorizedForEntries) return res.status(403).json({ error: "forbidden" });
      const value = req.body && req.body.value;
      if (typeof value !== "string") return res.status(400).json({ error: "missing value" });
      const toWrite = key === "config" ? await mergeConfigPasswords(value) : value;
      await putRaw(key, toWrite);
      return res.status(200).json({ ok: true });
    }

    if (req.method === "DELETE") {
      if (writeNeedsAdmin && !admin) return res.status(403).json({ error: "forbidden" });
      if (entriesEmployeeId !== null && !authorizedForEntries) return res.status(403).json({ error: "forbidden" });
      await deleteRaw(key);
      return res.status(200).json({ ok: true });
    }

    res.setHeader("Allow", "GET, PUT, DELETE");
    return res.status(405).json({ error: "method not allowed" });
  } catch (e) {
    return res.status(500).json({ error: String(e) });
  }
};
