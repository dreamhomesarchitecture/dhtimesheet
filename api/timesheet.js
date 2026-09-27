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
  return JSON.stringify(config);
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
      await putRaw(key, value);
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
