"""
Live end-to-end test of the deployed churn model (Interim Report, Ch. 6.10 item 1).

Sends each real holdout row to the running Flask service exactly as the PHP
backend does (POST, JSON body of the 13 contract fields), then checks:
  1. Parity:      live probability == the saved model's own probability
  2. Tiers:       live risk tier vs. actual churn (calibration through the live system)
  3. Ranking:     ROC-AUC from the live probabilities (should be ~0.778)
  4. Performance: response time per request

Standard library only. Usage:
    python live_holdout_test.py
    python live_holdout_test.py http://127.0.0.1:5000
"""
import csv
import json
import sys
import time
import urllib.error
import urllib.request

URL = sys.argv[1] if len(sys.argv) > 1 else "http://192.168.8.102:5000"  # same as MlConfig.php
IN_FILE = "holdout_for_live_test.csv"
OUT_FILE = "live_holdout_results.csv"
TOLERANCE = 1e-4

CONTRACT = [
    "Gender", "Age", "Age_Group", "Preferred_Service_Category",
    "Visits_Last_90_Days_Before_Cutoff", "Visits_Prior_90_Days_Before_That",
    "Spend_Last_90_Days_Before_Cutoff_LKR", "Spend_Prior_90_Days_Before_That_LKR",
    "Avg_Visit_Interval_To_Date", "Number_of_Unique_Services_To_Date",
    "Number_of_Visits_To_Date", "Customer_Tenure_Days_At_Cutoff",
    "Days_Since_Last_Visit_At_Cutoff",
]
TEXT_FIELDS = {"Gender", "Age_Group", "Preferred_Service_Category"}


def to_value(name, s):
    if name in TEXT_FIELDS:
        return s
    f = float(s)
    return int(f) if f.is_integer() else f


def to_label(s):
    s = str(s).strip().lower()
    if s in ("true", "yes", "churned"):
        return 1
    if s in ("false", "no", "stayed", "active"):
        return 0
    return int(float(s))


def call_model(features):
    req = urllib.request.Request(URL, data=json.dumps(features).encode("utf-8"),
                                 headers={"Content-Type": "application/json"}, method="POST")
    start = time.perf_counter()
    try:
        with urllib.request.urlopen(req, timeout=10) as r:
            body = json.loads(r.read().decode("utf-8"))
        return body, (time.perf_counter() - start) * 1000, None
    except urllib.error.HTTPError as e:
        return None, (time.perf_counter() - start) * 1000, f"HTTP {e.code}: {e.read().decode('utf-8', 'replace')[:200]}"
    except Exception as e:
        return None, (time.perf_counter() - start) * 1000, str(e)


def roc_auc(labels, scores):
    """Mann-Whitney ROC-AUC with average ranks for ties."""
    pairs = sorted(zip(scores, labels))
    ranks = [0.0] * len(pairs)
    i = 0
    while i < len(pairs):
        j = i
        while j + 1 < len(pairs) and pairs[j + 1][0] == pairs[i][0]:
            j += 1
        for k in range(i, j + 1):
            ranks[k] = (i + j) / 2 + 1
        i = j + 1
    pos = sum(1 for _, y in pairs if y == 1)
    neg = len(pairs) - pos
    rank_sum = sum(r for r, (_, y) in zip(ranks, pairs) if y == 1)
    return (rank_sum - pos * (pos + 1) / 2) / (pos * neg)


def percentile(values, p):
    v = sorted(values)
    return v[min(len(v) - 1, int(round(p / 100 * (len(v) - 1))))]


with open(IN_FILE, newline="", encoding="utf-8") as f:
    rows = list(csv.DictReader(f))
print(f"Loaded {len(rows)} holdout rows. Calling {URL} ...\n")

results = []
for n, row in enumerate(rows, 1):
    features = {c: to_value(c, row[c]) for c in CONTRACT}
    body, ms, err = call_model(features)
    prob = tier = None
    if body is not None:
        prob = body.get("churn_probability")
        tier = body.get("risk_tier")
        if prob is None:
            err = "No churn_probability in response: " + json.dumps(body)[:200]
    expected = float(row["expected_probability"])
    results.append({
        "Customer_Ref": row["Customer_Ref"], "Cutoff_Date": row["Cutoff_Date"],
        "actual_churned": to_label(row["actual_churned"]),
        "expected_probability": round(expected, 6),
        "live_probability": None if prob is None else round(float(prob), 6),
        "abs_diff": None if prob is None else abs(float(prob) - expected),
        "live_risk_tier": tier, "response_ms": round(ms, 1), "error": err,
    })
    if n % 50 == 0:
        print(f"  {n}/{len(rows)} done")

with open(OUT_FILE, "w", newline="", encoding="utf-8") as f:
    w = csv.DictWriter(f, fieldnames=list(results[0].keys()))
    w.writeheader()
    w.writerows(results)

ok = [r for r in results if r["live_probability"] is not None]
failed = [r for r in results if r["live_probability"] is None]

print("\n================ LIVE HOLDOUT TEST ================")
print(f"Rows sent: {len(results)} | answered: {len(ok)} | failed: {len(failed)}")
if failed:
    print("First failure:", failed[0]["error"])

if ok:
    diffs = [r["abs_diff"] for r in ok]
    within = sum(1 for d in diffs if d <= TOLERANCE)
    print("\n1. PARITY (live service vs saved model)")
    print(f"   Max |difference|: {max(diffs):.6f} | mean: {sum(diffs)/len(diffs):.6f}")
    print(f"   Within {TOLERANCE}: {within}/{len(ok)} ({100*within/len(ok):.1f}%)")

    print("\n2. RISK TIERS FROM THE LIVE SERVICE vs ACTUAL CHURN")
    print("   (interim report holdout: High 65.2%, Medium 32.3%, Low 17.4%)")
    for t in ["High", "Medium", "Low"]:
        g = [r for r in ok if str(r["live_risk_tier"]).lower() == t.lower()]
        if g:
            churned = sum(r["actual_churned"] for r in g)
            print(f"   {t:<7} n={len(g):<4} churned={churned:<4} rate={100*churned/len(g):.1f}%")
        else:
            print(f"   {t:<7} n=0")
    other = [r for r in ok if str(r["live_risk_tier"]).lower() not in ("high", "medium", "low")]
    if other:
        print(f"   Other/unknown tier labels: {len(other)} (e.g. {other[0]['live_risk_tier']!r})")

    labels = [r["actual_churned"] for r in ok]
    if 0 < sum(labels) < len(labels):
        print("\n3. RANKING")
        print(f"   ROC-AUC (live probabilities): {roc_auc(labels, [r['live_probability'] for r in ok]):.3f}")
        print(f"   ROC-AUC (saved model):        {roc_auc(labels, [r['expected_probability'] for r in ok]):.3f}")

    times = [r["response_ms"] for r in ok]
    print("\n4. PERFORMANCE")
    print(f"   Mean {sum(times)/len(times):.1f} ms | median {percentile(times, 50):.1f} ms | "
          f"95th pct {percentile(times, 95):.1f} ms | max {max(times):.1f} ms")

print(f"\nPer-row results saved to {OUT_FILE}")
