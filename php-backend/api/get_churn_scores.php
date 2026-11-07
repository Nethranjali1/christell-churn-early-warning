<?php
/**
 * Returns the most recent stored scoring run.
 *   GET get_churn_scores.php             -> full list (At-Risk page)
 *   GET get_churn_scores.php?summary=1   -> counts + top 5 (Overview widget)
 */
require_once __DIR__ . '/../config/Api.php';

requireMethod('GET');
$auth = requireAuth(['frontdesk', 'manager', 'admin']);

function emptyPayload($setupNeeded) {
    return [
        "setup_needed" => $setupNeeded,
        "run" => null,
        "summary" => ["high" => 0, "medium" => 0, "low" => 0, "at_risk_spend" => 0],
        "scores" => [],
        "skipped" => [],
    ];
}

try {
    $db = Database::getInstance()->getConnection();

    $exists = $db->query("SHOW TABLES LIKE 'churn_scores'")->fetch();
    if (!$exists) {
        buildResponse(true, "Scores table not set up", emptyPayload(true));
    }

    $latest = $db->query("SELECT run_id FROM churn_scores ORDER BY score_id DESC LIMIT 1")->fetch();
    if (!$latest) {
        buildResponse(true, "No scores yet", emptyPayload(false));
    }
    $runId = $latest['run_id'];

    $stmt = $db->prepare("
        SELECT MIN(scored_at) AS scored_at,
               SUM(status = 'scored') AS scored_count,
               SUM(status = 'skipped') AS skipped_count,
               MAX(model_version) AS model_version
        FROM churn_scores WHERE run_id = :run_id
    ");
    $stmt->execute(['run_id' => $runId]);
    $r = $stmt->fetch();
    $run = [
        "run_id" => $runId,
        "scored_at" => $r['scored_at'],
        "scored_count" => (int)$r['scored_count'],
        "skipped_count" => (int)$r['skipped_count'],
        "model_version" => $r['model_version'],
    ];

    $stmt = $db->prepare("
        SELECT cs.user_id, cs.churn_probability, cs.risk_tier, cs.recommended_action,
               cs.model_version, cs.features_json,
               u.name, u.nic, u.mobile_no,
               COALESCE(s.total_spend, 0) AS total_spend,
               v.last_visit
        FROM churn_scores cs
        JOIN users u ON u.user_id = cs.user_id
        LEFT JOIN (
            SELECT b.user_id, SUM(t.amount_spent) AS total_spend
            FROM treatments t
            JOIN bookings b ON t.booking_id = b.booking_id
            JOIN treatment_status ts ON t.status_id = ts.status_id
            WHERE ts.status_name = 'Completed'
            GROUP BY b.user_id
        ) s ON s.user_id = cs.user_id
        LEFT JOIN (
            SELECT b.user_id, MAX(b.appointment_date) AS last_visit
            FROM bookings b
            JOIN booking_status bs ON b.status_id = bs.status_id
            WHERE bs.status_name = 'Attended'
            GROUP BY b.user_id
        ) v ON v.user_id = cs.user_id
        WHERE cs.run_id = :run_id AND cs.status = 'scored'
        ORDER BY cs.churn_probability DESC, u.name ASC
    ");
    $stmt->execute(['run_id' => $runId]);
    $rows = $stmt->fetchAll();

    $summary = ["high" => 0, "medium" => 0, "low" => 0, "at_risk_spend" => 0];
    $scores = [];
    foreach ($rows as $row) {
        $tier = strtolower((string)$row['risk_tier']);
        if (isset($summary[$tier])) { $summary[$tier]++; }
        if ($tier !== 'low') { $summary['at_risk_spend'] += (float)$row['total_spend']; }
        $scores[] = [
            "user_id" => (int)$row['user_id'],
            "name" => $row['name'],
            "nic" => maskNic($row['nic'], $auth['role']),
            "mobile_no" => $row['mobile_no'],
            "total_spend" => round((float)$row['total_spend'], 2),
            "last_visit" => $row['last_visit'],
            "churn_probability" => (float)$row['churn_probability'],
            "risk_tier" => $row['risk_tier'],
            "recommended_action" => $row['recommended_action'],
            "model_version" => $row['model_version'],
            "features" => json_decode($row['features_json'], true),
        ];
    }
    $summary['at_risk_spend'] = round($summary['at_risk_spend'], 2);
       if ($auth['role'] === 'frontdesk') { $summary['at_risk_spend'] = null; }

    if (isset($_GET['summary'])) {
        $top = [];
        foreach ($scores as $s) {
            if (strtolower($s['risk_tier']) === 'low') { continue; }
            $top[] = [
                "user_id" => $s['user_id'], "name" => $s['name'],
                "churn_probability" => $s['churn_probability'], "risk_tier" => $s['risk_tier'],
            ];
            if (count($top) >= 5) { break; }
        }
        buildResponse(true, "Success", [
            "setup_needed" => false, "run" => $run, "summary" => $summary,
            "scores" => $top, "skipped" => [],
        ]);
    }

    $stmt = $db->prepare("
        SELECT cs.user_id, u.name, cs.skip_reason
        FROM churn_scores cs
        JOIN users u ON u.user_id = cs.user_id
        WHERE cs.run_id = :run_id AND cs.status = 'skipped'
        ORDER BY u.name
    ");
    $stmt->execute(['run_id' => $runId]);
    $skipped = [];
    foreach ($stmt->fetchAll() as $k) {
        $skipped[] = ["user_id" => (int)$k['user_id'], "name" => $k['name'], "reason" => $k['skip_reason']];
    }

    buildResponse(true, "Success", [
        "setup_needed" => false, "run" => $run, "summary" => $summary,
        "scores" => $scores, "skipped" => $skipped,
    ]);

} catch (PDOException $e) {
    logServerError($e); buildResponse(false, "A database error occurred. Please try again.", null, 500);
} catch (Exception $e) {
    logServerError($e); buildResponse(false, "Something went wrong. Please try again.", null, 500);
}