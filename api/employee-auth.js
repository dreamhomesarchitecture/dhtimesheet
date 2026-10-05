const { GITHUB_TOKEN, getRaw, putRaw, signEmployeeToken, verifyEmployeeToken } = require("./_store");

module.exports = async (req, res) => {
  try {
    if (!GITHUB_TOKEN) return res.status(500).json({ error: "GITHUB_TOKEN not configured" });
    if (req.method !== "POST") {
      res.setHeader("Allow", "POST");
      return res.status(405).json({ error: "method not allowed" });
    }

    const body = req.body || {};
    const action = body.action;

    const configResult = await getRaw("config");
    if (!configResult.found) return res.status(404).json({ error: "no config" });
    const config = JSON.parse(configResult.value);
    const employees = config.employees || [];

    if (action === "login") {
      const employeeId = body.employeeId;
      const password = body.password;
      const emp = employees.find((e) => e.id === employeeId);
      if (!emp || typeof password !== "string" || emp.password !== password) {
        return res.status(401).json({ ok: false });
      }
      return res.status(200).json({ ok: true, token: signEmployeeToken(employeeId) });
    }

    if (action === "change-password") {
      const employeeId = body.employeeId;
      const token = body.token;
      const newPassword = typeof body.newPassword === "string" ? body.newPassword.trim() : "";
      if (!verifyEmployeeToken(token, employeeId)) return res.status(403).json({ error: "forbidden" });
      if (!newPassword) return res.status(400).json({ error: "missing password" });
      const emp = employees.find((e) => e.id === employeeId);
      if (!emp) return res.status(404).json({ error: "not found" });
      emp.password = newPassword;
      await putRaw("config", JSON.stringify(config), `Zmena hesla zamestnance (${employeeId})`);
      return res.status(200).json({ ok: true });
    }

    if (action === "all-hours") {
      const employeeId = body.employeeId;
      if (!verifyEmployeeToken(body.token, employeeId)) return res.status(403).json({ error: "forbidden" });
      const emp = employees.find((e) => e.id === employeeId);
      if (!emp || !emp.canSeeAllHours) return res.status(403).json({ error: "forbidden" });
      const perEmployee = await Promise.all(
        employees.map(async (e) => {
          const r = await getRaw(`entries:${e.id}`);
          if (!r.found) return [];
          try {
            const list = JSON.parse(r.value);
            return Array.isArray(list) ? list : [];
          } catch (err) {
            return [];
          }
        })
      );
      // Only project, phase and hours are returned - never costs, notes or dates.
      const entries = perEmployee.flat().map((en) => ({
        projectId: en.projectId,
        phaseId: en.phaseId,
        hours: Number(en.hours) || 0
      }));
      return res.status(200).json({ ok: true, entries });
    }

    return res.status(400).json({ error: "unknown action" });
  } catch (e) {
    return res.status(500).json({ error: String(e) });
  }
};
