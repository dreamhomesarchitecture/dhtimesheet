const crypto = require("crypto");

const GITHUB_REPO = process.env.GITHUB_REPO || "dreamhomesarchitecture/dhtimesheet";
const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const DIR = "data";

function pathForKey(key) {
  const safeKey = String(key || "").replace(/[^a-zA-Z0-9_-]/g, "_");
  return `${DIR}/${safeKey}.json`;
}

async function getRaw(key) {
  const path = pathForKey(key);
  const r = await fetch(`https://api.github.com/repos/${GITHUB_REPO}/contents/${path}`, {
    headers: { Authorization: `token ${GITHUB_TOKEN}`, Accept: "application/vnd.github+json" }
  });
  if (r.status === 404) return { found: false };
  if (!r.ok) throw new Error(`get failed: ${r.status}`);
  const data = await r.json();
  const value = Buffer.from(data.content, "base64").toString("utf-8");
  return { found: true, value, sha: data.sha };
}

async function putRaw(key, value, message) {
  const path = pathForKey(key);
  const existing = await getRaw(key);
  const body = {
    message: message || `Aktualizace vykazu (${path})`,
    content: Buffer.from(value, "utf-8").toString("base64")
  };
  if (existing.found) body.sha = existing.sha;
  const r = await fetch(`https://api.github.com/repos/${GITHUB_REPO}/contents/${path}`, {
    method: "PUT",
    headers: {
      Authorization: `token ${GITHUB_TOKEN}`,
      Accept: "application/vnd.github+json",
      "Content-Type": "application/json"
    },
    body: JSON.stringify(body)
  });
  if (!r.ok) throw new Error(`put failed: ${await r.text()}`);
  return true;
}

async function deleteRaw(key, message) {
  const path = pathForKey(key);
  const existing = await getRaw(key);
  if (!existing.found) return true;
  const r = await fetch(`https://api.github.com/repos/${GITHUB_REPO}/contents/${path}`, {
    method: "DELETE",
    headers: {
      Authorization: `token ${GITHUB_TOKEN}`,
      Accept: "application/vnd.github+json",
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ message: message || `Smazani vykazu (${path})`, sha: existing.sha })
  });
  if (!r.ok) throw new Error(`delete failed: ${await r.text()}`);
  return true;
}

// Employee session tokens are HMAC-signed using GITHUB_TOKEN as the server
// secret (it's already a private, high-entropy env var, so this avoids
// needing yet another secret just for token signing).
const TOKEN_SECRET = GITHUB_TOKEN || "";
const TOKEN_MAX_AGE_MS = 96 * 3600000;

function signEmployeeToken(employeeId) {
  const expiry = Date.now() + TOKEN_MAX_AGE_MS;
  const payload = `${employeeId}.${expiry}`;
  const sig = crypto.createHmac("sha256", TOKEN_SECRET).update(payload).digest("hex");
  return `${payload}.${sig}`;
}

function verifyEmployeeToken(token, employeeId) {
  if (!token || typeof token !== "string") return false;
  const parts = token.split(".");
  if (parts.length !== 3) return false;
  const [tokEmployeeId, expiryStr, sig] = parts;
  if (tokEmployeeId !== employeeId) return false;
  const expiry = Number(expiryStr);
  if (!expiry || Date.now() > expiry) return false;
  const expected = crypto.createHmac("sha256", TOKEN_SECRET).update(`${tokEmployeeId}.${expiryStr}`).digest("hex");
  const sigBuf = Buffer.from(sig, "hex");
  const expectedBuf = Buffer.from(expected, "hex");
  if (sigBuf.length !== expectedBuf.length) return false;
  return crypto.timingSafeEqual(sigBuf, expectedBuf);
}

module.exports = {
  GITHUB_TOKEN,
  pathForKey,
  getRaw,
  putRaw,
  deleteRaw,
  signEmployeeToken,
  verifyEmployeeToken,
  TOKEN_MAX_AGE_MS
};
