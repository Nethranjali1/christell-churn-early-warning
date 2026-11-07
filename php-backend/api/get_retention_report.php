<?php
/**
 * Manager/Admin only.
 *   GET get_retention_report.php            -> summary tables for the Retention Report page
 *   GET get_retention_report.php?run_id=... -> same, using that scoring run as the baseline
 *   GET get_retention_report.php?export=1   -> raw, de-identified rows for CSV download
 *
 * "Returned" = the patient has an Attended booking after the reference time.
 * This shows association only; it does not prove the outreach caused the visit.
 */
require_once __DIR__ . '/../config/Api.php';
 
requireMethod('GET');
$auth = requireAuth(['manager', 'admin']);
 
// Attended booking after the time of a given contact (alias ra = retention_actions row)
$RETURNED_AFTER_CONTACT = "EXISTS (
    SELECT 1 FROM bookings b
    JOIN booking_status bs ON b.status_id = bs.status_id
    WHERE b.user_id = ra.user_id AND bs.status_name = 'Attended' AND b.appointment_date > ra.created_at
)";
 
function tierOrder($tier) {
    $order = ['high' => 1, 'medium' => 2, 'low' => 3];
    $k = strtolower((string)$tier);
    return isset($order[$k]) ? $order[$k] : 9;
}
 
try {
    $db = Database::getInstance()->getConnection();
 
    $empty = [
        "setup_needed" => false, "run" => null, "runs" => [],
        "totals" => ["actions" => 0, "patients_contacted" => 0],
        "cohort" => [], "by_first_contact_tier" => [], "by_channel" => [], "by_outcome" => [],
    ];
 
    if (!$db->query("SHOW TABLES LIKE 'retention_actions'")->fetch()) {
        $empty["setup_needed"] = true;
        buildResponse(true, "Retention log not set up", $empty);
    }
 
    // ---------- Raw export (no names, no notes) ----------
    if (isset($_GET['export'])) {
        $rows = $db->query("
            SELECT ra.action_id, ra.user_id, ra.channel, ra.outcome,
                   ra.risk_tier_at_time, ra.churn_probability_at_time, ra.created_at,
                   $RETURNED_AFTER_CONTACT AS returned_after_contact
            FROM retention_actions ra
            ORDER BY ra.action_id
        ")->fetchAll();
        $out = [];
        foreach ($rows as $r) {
            $out[] = [
                "action_id" => (int)$r['action_id'],
                "user_id" => (int)$r['user_id'],
                "channel" => $r['channel'],
                "outcome" => $r['outcome'],
                "risk_tier_at_time" => $r['risk_tier_at_time'],
                "churn_probability_at_time" => $r['churn_probability_at_time'] !== null ? (float)$r['churn_probability_at_time'] : null,
                "created_at" => $r['created_at'],
                "returned_after_contact" => (int)$r['returned_after_contact'],
            ];
        }
        buildResponse(true, "Success", ["rows" => $out]);
    }
 
    // ---------- Totals ----------
    $t = $db->query("SELECT COUNT(*) AS actions, COUNT(DISTINCT user_id) AS patients FROM retention_actions")->fetch();
    $totals = ["actions" => (int)$t['actions'], "patients_contacted" => (int)$t['patients']];
 
    // ---------- Baseline scoring run: contacted vs not contacted, and who came back ----------
    // The comparison is anchored to ONE run. By default that is the latest run, but a
    // Manager can pick an earlier run so that clicking Re-score doesn't reset the evaluation.
    $run = null;
    $runs = [];
    $cohort = [];
    $windowDays = 90;   // the model's prediction horizon
    if ($db->query("SHOW TABLES LIKE 'churn_scores'")->fetch()) {
        $runs = $db->query("
            SELECT run_id, MIN(scored_at) AS scored_at, SUM(status = 'scored') AS scored_count
            FROM churn_scores
            GROUP BY run_id
            ORDER BY MIN(scored_at) DESC
            LIMIT 50
        ")->fetchAll();
        foreach ($runs as $k => $r) {
            $runs[$k] = ["run_id" => $r['run_id'], "scored_at" => $r['scored_at'],
                         "scored_count" => (int)$r['scored_count'], "is_latest" => $k === 0];
        }

        $chosen = null;
        $requested = isset($_GET['run_id']) ? trim((string)$_GET['run_id']) : '';
        if ($requested !== '') {
            foreach ($runs as $r) {
                if ($r['run_id'] === $requested) { $chosen = $r; break; }
            }
        }
        if ($chosen === null && $runs) { $chosen = $runs[0]; }   // fall back to the latest run

        if ($chosen) {
            $runId = $chosen['run_id'];
            $scoredAt = $chosen['scored_at'];
            $elapsed = (int)floor((time() - strtotime($scoredAt)) / 86400);
            $run = [
                "run_id" => $runId,
                "scored_at" => $scoredAt,
                "scored_count" => $chosen['scored_count'],
                "is_latest" => $chosen['is_latest'],
                "requested_found" => $requested === '' || $requested === $runId,
                "days_elapsed" => max(0, $elapsed),
                "window_days" => $windowDays,
                "window_complete" => $elapsed >= $windowDays,
            ];

            // Each placeholder name is used once (the server runs with real prepared statements)
            $stmt = $db->prepare("
                SELECT x.tier, x.contacted, COUNT(*) AS n, SUM(x.returned) AS returned
                FROM (
                    SELECT cs.risk_tier AS tier,
                           EXISTS (SELECT 1 FROM retention_actions ra
                                   WHERE ra.user_id = cs.user_id AND ra.created_at >= :contact_from) AS contacted,
                           EXISTS (SELECT 1 FROM bookings b
                                   JOIN booking_status bs ON b.status_id = bs.status_id
                                   WHERE b.user_id = cs.user_id AND bs.status_name = 'Attended'
                                     AND b.appointment_date > :return_from) AS returned
                    FROM churn_scores cs
                    WHERE cs.run_id = :run_id AND cs.status = 'scored'
                ) x
                GROUP BY x.tier, x.contacted
            ");
            $stmt->execute(['contact_from' => $scoredAt, 'return_from' => $scoredAt, 'run_id' => $runId]);

            $byTier = [];
            foreach ($stmt->fetchAll() as $r) {
                $tier = (string)$r['tier'];
                if (!isset($byTier[$tier])) {
                    $byTier[$tier] = ["tier" => $tier, "patients" => 0,
                        "contacted" => 0, "contacted_returned" => 0,
                        "not_contacted" => 0, "not_contacted_returned" => 0];
                }
                $n = (int)$r['n'];
                $ret = (int)$r['returned'];
                $byTier[$tier]["patients"] += $n;
                if ((int)$r['contacted'] === 1) {
                    $byTier[$tier]["contacted"] += $n;
                    $byTier[$tier]["contacted_returned"] += $ret;
                } else {
                    $byTier[$tier]["not_contacted"] += $n;
                    $byTier[$tier]["not_contacted_returned"] += $ret;
                }
            }
            $cohort = array_values($byTier);
            usort($cohort, function ($a, $b) { return tierOrder($a['tier']) <=> tierOrder($b['tier']); });
        }
    }

    // ---------- Contacted patients, grouped by the tier at their FIRST contact ----------
    $firstRows = $db->query("
        SELECT f.tier_label AS tier, COUNT(*) AS patients,
               SUM(EXISTS (SELECT 1 FROM retention_actions r2
                           WHERE r2.user_id = f.user_id AND r2.outcome = 'rebooked')) AS rebooked,
               SUM(EXISTS (SELECT 1 FROM bookings b
                           JOIN booking_status bs ON b.status_id = bs.status_id
                           WHERE b.user_id = f.user_id AND bs.status_name = 'Attended'
                             AND b.appointment_date > f.first_contact)) AS returned
        FROM (
            SELECT ra.user_id, ra.created_at AS first_contact,
                   COALESCE(ra.risk_tier_at_time, 'Unscored') AS tier_label
            FROM retention_actions ra
            JOIN (SELECT user_id, MIN(action_id) AS min_id FROM retention_actions GROUP BY user_id) m
              ON m.min_id = ra.action_id
        ) f
        GROUP BY f.tier_label
    ")->fetchAll();
    $byFirst = [];
    foreach ($firstRows as $r) {
        $byFirst[] = ["tier" => $r['tier'], "patients" => (int)$r['patients'],
                      "rebooked" => (int)$r['rebooked'], "returned" => (int)$r['returned']];
    }
    usort($byFirst, function ($a, $b) { return tierOrder($a['tier']) <=> tierOrder($b['tier']); });
 
    // ---------- By channel and by outcome ----------
    $byChannel = [];
    $chRows = $db->query("
        SELECT channel, COUNT(*) AS contacts,
               SUM(outcome NOT IN ('no_answer', 'pending')) AS reached,
               SUM(outcome = 'rebooked') AS rebooked
        FROM retention_actions
        GROUP BY channel
        ORDER BY contacts DESC
    ")->fetchAll();
    foreach ($chRows as $r) {
        $byChannel[] = ["channel" => $r['channel'], "contacts" => (int)$r['contacts'],
                        "reached" => (int)$r['reached'], "rebooked" => (int)$r['rebooked']];
    }
 
    $byOutcome = [];
    foreach ($db->query("SELECT outcome, COUNT(*) AS c FROM retention_actions GROUP BY outcome ORDER BY c DESC")->fetchAll() as $r) {
        $byOutcome[] = ["outcome" => $r['outcome'], "count" => (int)$r['c']];
    }
 
    buildResponse(true, "Success", [
        "setup_needed" => false,
        "run" => $run,
        "runs" => $runs,
        "totals" => $totals,
        "cohort" => $cohort,
        "by_first_contact_tier" => $byFirst,
        "by_channel" => $byChannel,
        "by_outcome" => $byOutcome,
    ]);
 
} catch (PDOException $e) {
    logServerError($e); buildResponse(false, "A database error occurred. Please try again.", null, 500);
} catch (Exception $e) {
    logServerError($e); buildResponse(false, "Something went wrong. Please try again.", null, 500);
}