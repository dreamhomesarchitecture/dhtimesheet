const GITHUB_REPO = process.env.GITHUB_REPO || "dreamhomesarchitecture/dhtimesheet";
const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const DIR = "data";

function pathForKey(key) {
  const safeKey = String(key || "").replace(/[^a-zA-Z0-9_-]/g, "_");
  return `${DIR}/${safeKey}.json`;
}

module.exports = async (req, res) => {
  try {
    if (!GITHUB_TOKEN) return res.status(500).json({ error: "GITHUB_TOKEN not configured" });

    const key = req.query && req.query.key;
    if (!key) return res.status(400).json({ error: "missing key" });
    const path = pathForKey(key);

    if (req.method === "GET") {
      const getRes = await fetch(`https://api.github.com/repos/${GITHUB_REPO}/contents/${path}`, {
        headers: { Authorization: `token ${GITHUB_TOKEN}`, Accept: "application/vnd.github+json" }
      });
      if (getRes.status === 404) return res.status(404).json({ found: false });
      if (!getRes.ok) return res.status(502).json({ error: "get failed" });
      const fileData = await getRes.json();
      const value = Buffer.from(fileData.content, "base64").toString("utf-8");
      return res.status(200).json({ found: true, value });
    }

    if (req.method === "PUT") {
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
