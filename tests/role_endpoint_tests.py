"""
Role x endpoint security test matrix for the Christell Wellness Console.

For every API endpoint it checks what happens with: no token, Front Desk, Manager, Admin.
  - No token            -> must be refused (401)
  - A role not allowed  -> must be refused (403)
  - A role allowed      -> must get through (200, or 400 where we deliberately send an
                           empty body so nothing is written to the database)
Plus data-protection checks (NIC masking, NIC search, spend hidden from Front Desk)
and login checks.

Nothing is changed in the database, except: each login creates a session (all are
signed out at the end), and, only if you answer "y", one real Re-score run.

Standard library only. Passwords are typed when asked and are not shown or saved.
Usage:
    python role_endpoint_tests.py
    python role_endpoint_tests.py http://localhost/php-backend/api
"""
import csv
import getpass
import json
import sys
import urllib.error
import urllib.parse
import urllib.request

BASE = (sys.argv[1] if len(sys.argv) > 1 else "http://localhost/php-backend/api").rstrip("/")
OUT_FILE = "role_endpoint_results.csv"
ROLES = ["frontdesk", "manager", "admin"]
ROLE_LABEL = {"none": "No token", "bad": "Invalid token", "frontdesk": "Front Desk", "manager": "Manager", "admin": "Admin"}


def call(method, path, token=None, body=None, query=None):
    url = f"{BASE}/{path}"
    if query:
        url += "?" + urllib.parse.urlencode(query)
    data = json.dumps(body).encode("utf-8") if body is not None else (b"{}" if method == "POST" else None)
    headers = {"Content-Type": "application/json"}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    req = urllib.request.Request(url, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            status, raw = r.status, r.read().decode("utf-8", "replace")
    except urllib.error.HTTPError as e:
        status, raw = e.code, e.read().decode("utf-8", "replace")
    except Exception as e:
        return 0, {"message": f"Could not connect: {e}"}
    try:
        return status, json.loads(raw)
    except ValueError:
        return status, {"message": "Not JSON (PHP warning?): " + raw[:120].replace("\n", " ")}


results = []


def record(test_id, area, check, caller, expected, actual, passed, note=""):
    results.append({
        "id": test_id, "area": area, "check": check, "caller": ROLE_LABEL.get(caller, caller),
        "expected": expected, "actual": actual, "result": "PASS" if passed else "FAIL", "note": note,
    })
    mark = "PASS" if passed else "FAIL"
    print(f"  {mark}  {test_id:<6} {check:<44} {ROLE_LABEL.get(caller, caller):<13} expected {expected:<10} got {actual}  {note}")


# ---------------------------------------------------------------- sign in
print(f"API: {BASE}\n")
print("Enter a TEST account for each role. Leave the username blank to skip a role.\n")
tokens = {}
for role in ROLES:
    user = input(f"{ROLE_LABEL[role]} username: ").strip()
    if not user:
        print(f"  (skipping {ROLE_LABEL[role]})\n")
        continue
    pw = getpass.getpass(f"{ROLE_LABEL[role]} password (hidden): ")
    status, body = call("POST", "login.php", body={"username": user, "password": pw})
    data = body.get("data") or {}
    got_role = (data.get("admin") or {}).get("role")
    if status == 200 and data.get("token") and got_role == role:
        tokens[role] = data["token"]
        print(f"  signed in as {ROLE_LABEL[role]}\n")
    elif status == 200 and data.get("token"):
        print(f"  That account's role is '{got_role}', not '{role}'. Skipping.\n")
        call("POST", "logout.php", token=data["token"])
    else:
        print(f"  Sign-in failed (HTTP {status}): {body.get('message')}\n")

if "manager" not in tokens and "admin" not in tokens:
    sys.exit("A Manager or Admin account is needed to look up a sample patient. Stopping.")
lookup = tokens.get("manager") or tokens.get("admin")

do_rescore = input("Also run ONE real Re-score as Manager/Admin to test score_all_churn? (y/N): ").strip().lower() == "y"

# ---------------------------------------------------------------- sample patient
_, sc = call("GET", "get_churn_scores.php", token=lookup)
scored = ((sc.get("data") or {}).get("scores")) or []
us_status, us = call("GET", "get_users.php", token=lookup, query={"page": 1, "limit": 1})
users = ((us.get("data") or {}).get("users")) or []
if not users:
    sys.exit(f"Could not read any patients as Manager/Admin (HTTP {us_status}: {us.get('message')}). Stopping.")
sample_id = scored[0]["user_id"] if scored else users[0]["user_id"]
sample_nic = str(users[0].get("nic") or "")
print(f"\nSample patient user_id {sample_id}\n")

# ---------------------------------------------------------------- access matrix
ALL = ["frontdesk", "manager", "admin"]
MGR = ["manager", "admin"]
# (id, endpoint, method, allowed roles, query, body, expected status for an allowed role)
ENDPOINTS = [
    ("A01", "get_meta.php", "GET", ALL, None, None, 200),
    ("A02", "get_users.php", "GET", ALL, {"page": 1, "limit": 1}, None, 200),
    ("A03", "get_user_details.php", "GET", ALL, {"user_id": sample_id}, None, 200),
    ("A04", "get_bookings.php", "GET", ALL, {"limit": 1}, None, 200),
    ("A05", "get_churn_scores.php", "GET", ALL, None, None, 200),
    ("A06", "get_retention_actions.php", "GET", ALL, {"user_id": sample_id}, None, 200),
    ("A07", "predict_churn.php", "POST", ALL, None, {"user_id": sample_id}, 200),
    ("A08", "log_retention_action.php", "POST", ALL, None, {}, 400),      # empty body: validated, nothing written
    ("A09", "update_booking_status.php", "POST", ALL, None, {}, 400),     # empty body: validated, nothing written
    ("A10", "get_dashboard_stats.php", "GET", MGR, None, None, 200),
    ("A11", "get_doctors.php", "GET", MGR, None, None, 200),
    ("A12", "get_retention_report.php", "GET", MGR, None, None, 200),
    ("A13", "get_early_warning_features.php", "POST", MGR, None, {"user_id": sample_id}, 200),
    ("A14", "score_all_churn.php", "POST", MGR, None, None, 200),
]

print("ACCESS CONTROL")
for tid, path, method, allowed, query, body, ok_code in ENDPOINTS:
    s, b = call(method, path, token=None, body=body, query=query)
    record(tid, "Access", path, "none", "401", s, s == 401)
    for role in ROLES:
        if role not in tokens:
            continue
        if path == "score_all_churn.php" and role in allowed:
            if not do_rescore or role != ("manager" if "manager" in tokens else "admin"):
                continue  # only one real Re-score, and only if asked
        s, b = call(method, path, token=tokens[role], body=body, query=query)
        if role in allowed:
            note = ""
            if path == "predict_churn.php" and s == 502:
                note = "(access OK, but the Flask service did not answer)"
            passed = s == ok_code or (path == "predict_churn.php" and s == 502)
            if not passed and s not in (401, 403):
                note = (b.get("message") or "")[:70]
            record(tid, "Access", path, role, str(ok_code), s, passed, note)
        else:
            record(tid, "Access", path, role, "403", s, s == 403)

print("\nREQUEST CHECKS")
s, _ = call("GET", "get_users.php", token="0" * 64)
record("R01", "Session", "get_users.php with an invalid token", "bad", "401", s, s == 401)
s, _ = call("GET", "predict_churn.php", token=lookup)
record("R02", "Method", "predict_churn.php called with GET", "manager", "405", s, s == 405)
s1, b1 = call("POST", "login.php", body={"username": "no_such_user_xyz", "password": "wrong"})
record("R03", "Login", "Unknown username", "none", "401", s1, s1 == 401)

# ---------------------------------------------------------------- data protection
print("\nDATA PROTECTION")
if "frontdesk" in tokens:
    _, b = call("GET", "get_users.php", token=tokens["frontdesk"], query={"page": 1, "limit": 5})
    nics = [str(u.get("nic") or "") for u in ((b.get("data") or {}).get("users") or [])]
    masked = bool(nics) and all("*" in n for n in nics if len(n) > 4)
    record("D01", "Privacy", "NIC masked in patient list", "frontdesk", "masked", "masked" if masked else "visible", masked)

    if sample_nic and "*" not in sample_nic:
        _, b = call("GET", "get_users.php", token=tokens["frontdesk"], query={"search": sample_nic})
        total = ((b.get("data") or {}).get("pagination") or {}).get("total")
        record("D02", "Privacy", "Search by full NIC finds nobody", "frontdesk", "0 results", f"{total} results", total == 0)

    _, b = call("GET", "get_churn_scores.php", token=tokens["frontdesk"])
    spend = (((b.get("data") or {}).get("summary")) or {}).get("at_risk_spend", "missing")
    record("D03", "Privacy", "At-risk spend hidden", "frontdesk", "null", spend, spend is None)

for role in MGR:
    if role not in tokens:
        continue
    _, b = call("GET", "get_users.php", token=tokens[role], query={"page": 1, "limit": 5})
    nics = [str(u.get("nic") or "") for u in ((b.get("data") or {}).get("users") or [])]
    full = bool(nics) and not any("*" in n for n in nics)
    record("D04", "Privacy", "NIC shown in full", role, "full", "full" if full else "masked", full)
    if sample_nic and "*" not in sample_nic:
        _, b = call("GET", "get_users.php", token=tokens[role], query={"search": sample_nic})
        total = ((b.get("data") or {}).get("pagination") or {}).get("total") or 0
        record("D05", "Privacy", "Search by full NIC finds the patient", role, ">= 1", f"{total} results", total >= 1)
    _, b = call("GET", "get_churn_scores.php", token=tokens[role])
    spend = (((b.get("data") or {}).get("summary")) or {}).get("at_risk_spend", "missing")
    record("D06", "Privacy", "At-risk spend visible", role, "number", spend, isinstance(spend, (int, float)))

# ---------------------------------------------------------------- sign out
print("\nSIGN OUT")
for role, tok in tokens.items():
    call("POST", "logout.php", token=tok)
    s, _ = call("GET", "get_meta.php", token=tok)
    record("S01", "Session", "Token refused after sign-out", role, "401", s, s == 401)

# ---------------------------------------------------------------- summary
with open(OUT_FILE, "w", newline="", encoding="utf-8") as f:
    w = csv.DictWriter(f, fieldnames=list(results[0].keys()))
    w.writeheader()
    w.writerows(results)

passed = sum(r["result"] == "PASS" for r in results)
print("\n================ SUMMARY ================")
print(f"{passed}/{len(results)} checks passed")
for r in results:
    if r["result"] == "FAIL":
        print(f"  FAIL {r['id']} {r['check']} ({r['caller']}): expected {r['expected']}, got {r['actual']} {r['note']}")
print(f"\nAll results saved to {OUT_FILE}")
