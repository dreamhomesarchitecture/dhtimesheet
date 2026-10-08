import http.server
import json
import os
import urllib.parse

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PORT = int(os.environ.get("PORT", 8935))
ADMIN_PASSWORD = "admin"


def entry(i, month, hours, cost, project="234", phase="DSP"):
    return {
        "id": f"e{i}", "projectId": project, "phaseId": phase, "hours": hours, "cost": cost,
        "date": f"2026-{month:02d}-10", "note": "ukázkový záznam",
    }


STORE = {
    "config": json.dumps({
        "employees": [
            {"id": "emp_anna", "name": "Anna Demo", "password": "anna", "canSeeAllHours": True, "vacationDays": 25, "rates": [{"id": "r1", "from": "2020-01-01", "amount": 500}]},
            {"id": "emp_bara", "name": "Bara Demo", "password": "bara", "rates": [{"id": "r2", "from": "2020-01-01", "amount": 450}]},
        ],
        "projects": [
            {"id": "000", "name": "DH", "phaseless": True, "phaseIds": []},
            {"id": "234", "name": "Demo projekt Rohy", "location": "Rohy", "phaseIds": ["DSP", "I"], "phaseBudgets": {"DSP": 187500, "I": 31000},
             "billingProfiles": [{"id": "c1", "name": "Jan Novák", "address": "Rohy 4, 675 05 Rohy"}]},
            {"id": "235", "name": "Demo projekt Brno", "location": "Brno", "phaseIds": ["DSP"]},
        ],
        "phases": [{"id": "DSP", "name": "Dokumentace pro stavební povolení"}, {"id": "I", "name": "Inženýring"}],
        "billingProfiles": [{"id": "s1", "name": "DREAM HOMES ARCHITECTURE s.r.o.", "vatRate": 21}],
    }),
    "entries:emp_anna": json.dumps([entry(1, 1, 150, 0), entry(2, 2, 140, 200), entry(3, 3, 170, 0), entry(4, 4, 160, 1500), entry(5, 5, 168, 0), entry(6, 6, 120, 0), entry(7, 10, 12, 3000, "235"), entry(8, 8, 24, 0, "000", "DOV"), entry(9, 10, 8, 0, "000", "DOV")]),
    "entries:emp_bara": json.dumps([entry(11, 1, 100, 500), entry(12, 3, 80, 0), entry(13, 4, 120, 0), entry(14, 10, 40, 250, "235")]),
    "costs": json.dumps([
        {"id": "k1", "date": "2026-10-02", "projectId": "234", "phaseId": "DSP", "amount": 1200, "paymentMethod": "hotově", "note": "Tisk dokumentace"},
        {"id": "k2", "date": "2026-10-03", "projectId": "234", "phaseId": "I", "amount": 300, "paymentMethod": "kartou", "note": "Kolky"},
    ]),
}
TOKENS = {}


def sanitized_config():
    cfg = json.loads(STORE["config"])
    cfg.pop("billingProfiles", None)
    for e in cfg["employees"]:
        e.pop("rates", None)
        e.pop("password", None)
    for p in cfg["projects"]:
        for k in ("phaseBudgets", "phaseBudgetItems", "phaseBudgetPayments", "clientBillableRates"):
            p.pop(k, None)
    return json.dumps(cfg)


class Handler(http.server.BaseHTTPRequestHandler):
    def _json(self, obj, status=200):
        data = json.dumps(obj).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.end_headers()
        self.wfile.write(data)

    def _admin(self):
        return self.headers.get("X-Admin-Password") == ADMIN_PASSWORD

    def _allowed_entries(self, key):
        emp_id = key[len("entries:"):]
        return self._admin() or (TOKENS.get(emp_id) and self.headers.get("X-Employee-Token") == TOKENS[emp_id])

    def _body(self):
        length = int(self.headers.get("Content-Length", 0))
        return json.loads(self.rfile.read(length) or b"{}")

    def do_GET(self):
        parsed = urllib.parse.urlparse(self.path)
        if parsed.path == "/api/timesheet":
            key = urllib.parse.parse_qs(parsed.query).get("key", [""])[0]
            admin = self._admin()
            if key == "costs" and not admin:
                return self._json({"error": "forbidden"}, 403)
            if key.startswith("entries:") and not self._allowed_entries(key):
                return self._json({"error": "forbidden"}, 403)
            if key not in STORE:
                return self._json({"found": False}, 404)
            value = STORE[key] if (key != "config" or admin) else sanitized_config()
            return self._json({"found": True, "value": value, "admin": admin})
        path = parsed.path
        if path == "/":
            path = "/DH_timesheet.html"
        file_path = os.path.join(ROOT, path.lstrip("/"))
        if not os.path.isfile(file_path):
            self.send_response(404)
            self.end_headers()
            return
        self.send_response(200)
        self.send_header("Content-Type", "text/html; charset=utf-8" if file_path.endswith(".html") else "application/octet-stream")
        self.end_headers()
        with open(file_path, "rb") as f:
            self.wfile.write(f.read())

    def do_PUT(self):
        parsed = urllib.parse.urlparse(self.path)
        key = urllib.parse.parse_qs(parsed.query).get("key", [""])[0]
        if key in ("config", "costs") and not self._admin():
            return self._json({"error": "forbidden"}, 403)
        if key.startswith("entries:") and not self._allowed_entries(key):
            return self._json({"error": "forbidden"}, 403)
        STORE[key] = self._body().get("value", "")
        self._json({"ok": True})

    def do_DELETE(self):
        parsed = urllib.parse.urlparse(self.path)
        key = urllib.parse.parse_qs(parsed.query).get("key", [""])[0]
        if (key in ("config", "costs") and not self._admin()) or (key.startswith("entries:") and not self._allowed_entries(key)):
            return self._json({"error": "forbidden"}, 403)
        STORE.pop(key, None)
        self._json({"ok": True})

    def do_POST(self):
        if urllib.parse.urlparse(self.path).path != "/api/employee-auth":
            return self._json({"error": "not found"}, 404)
        body = self._body()
        cfg = json.loads(STORE["config"])
        emp = next((e for e in cfg["employees"] if e["id"] == body.get("employeeId")), None)
        action = body.get("action")
        if action == "login":
            if not emp or emp.get("password") != body.get("password"):
                return self._json({"ok": False}, 401)
            TOKENS[emp["id"]] = "demo-token-" + emp["id"]
            return self._json({"ok": True, "token": TOKENS[emp["id"]]})
        if not emp or TOKENS.get(emp["id"]) != body.get("token"):
            return self._json({"error": "forbidden"}, 403)
        if action == "change-password":
            emp["password"] = (body.get("newPassword") or "").strip()
            STORE["config"] = json.dumps(cfg)
            return self._json({"ok": True})
        if action == "all-hours":
            if not emp.get("canSeeAllHours"):
                return self._json({"error": "forbidden"}, 403)
            entries = []
            for e in cfg["employees"]:
                for en in json.loads(STORE.get(f"entries:{e['id']}", "[]")):
                    entries.append({"projectId": en["projectId"], "phaseId": en["phaseId"], "hours": en["hours"]})
            return self._json({"ok": True, "entries": entries})
        self._json({"error": "unknown action"}, 400)

    def log_message(self, *args):
        pass


http.server.ThreadingHTTPServer(("127.0.0.1", PORT), Handler).serve_forever()
