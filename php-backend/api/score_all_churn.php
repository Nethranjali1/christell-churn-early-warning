<?php
/**
 * Scores every currently-active patient (attended within the last 90 days) and
 * stores the results in churn_scores as one "run". Unscoreable patients are
 * stored as 'skipped' with a reason. If the model service is down, nothing is
 * saved and the previous run stays in place.
 */
require_once __DIR__ . '/../config/Api.php';
require_once __DIR__ . '/../config/ChurnScoring.php';

requireMethod('POST');
$auth = requireAuth(['manager', 'admin']);
set_time_limit(300);

try {
    $db = Database::getInstance()->getConnection();

    $exists = $db->query("SHOW TABLES LIKE 'churn_scores'")->fetch();
    if (!$exists) {
        buildResponse(false, "The churn_scores table does not exist yet. Run php-backend/sql/churn_scores.sql in your database first.", null, 500);
    }

    $candidates = $db->query("
        SELECT u.user_id, u.name
        FROM users u
        JOIN (
            SELECT b.user_id, MAX(b.appointment_date) AS last_visit
            FROM bookings b
            JOIN booking_status bs ON b.status_id = bs.status_id
            WHERE bs.status_name = 'Attended'
            GROUP BY b.user_id
        ) v ON v.user_id = u.user_id
        WHERE v.last_visit >= DATE_SUB(NOW(), INTERVAL 90 DAY)
        ORDER BY u.user_id
    ")->fetchAll();

    $runId = bin2hex(random_bytes(16));
    $scoredAt = $db->query("SELECT NOW() AS n")->fetch()['n'];

    $insert = $db->prepare("
        INSERT INTO churn_scores
            (run_id, user_id, status, churn_probability, risk_tier, recommended_action, model_version, features_json, skip_reason, scored_at)
        VALUES
            (:run_id, :user_id, :status, :prob, :tier, :action, :model, :features, :reason, :scored_at)
    ");

    $db->beginTransaction();
    $scored = 0;
    $skipped = 0;
    $consecutiveModelFailures = 0;
    $modelVersion = null;

    foreach ($candidates as $c) {
        $row = [
            'run_id' => $runId, 'user_id' => (int)$c['user_id'], 'status' => 'scored',
            'prob' => null, 'tier' => null, 'action' => null, 'model' => null,
            'features' => null, 'reason' => null, 'scored_at' => $scoredAt,
        ];
        try {
            $built = churn_build_features($db, (int)$c['user_id']);
            $pred = churn_call_model($built['features']);

            if (!isset($pred['churn_probability']) || !isset($pred['risk_tier'])) {
                throw new ChurnScoringException("The churn prediction service did not return a probability and risk tier.", 502);
            }
            $row['prob']     = round((float)$pred['churn_probability'], 4);
            $row['tier']     = substr((string)$pred['risk_tier'], 0, 16);
            $row['action']   = isset($pred['recommended_action']) ? substr((string)$pred['recommended_action'], 0, 255) : null;
            $row['model']    = isset($pred['model_version']) ? substr((string)$pred['model_version'], 0, 64) : null;
            $row['features'] = json_encode($built['features']);
            $modelVersion = $row['model'] ?: $modelVersion;
            $consecutiveModelFailures = 0;
            $scored++;
        } catch (ChurnScoringException $e) {
            if ($e->httpCode === 502) {
                $consecutiveModelFailures++;
                // Model service is down: stop early instead of marking everyone as skipped.
                if ($consecutiveModelFailures >= 3) {
                    $db->rollBack();
                    buildResponse(false, $e->getMessage(), null, 502);
                }
            }
            $row['status'] = 'skipped';
            $row['reason'] = substr($e->getMessage(), 0, 255);
            $skipped++;
        }
        $insert->execute($row);
    }

    if ($scored === 0 && $skipped > 0) {
        $db->rollBack();
        buildResponse(false, "No patient could be scored in this run ($skipped skipped). The previous scores were kept.", null, 502);
    }

    $db->commit();

    buildResponse(true, "Success", [
        "run_id" => $runId,
        "scored_at" => $scoredAt,
        "scored" => $scored,
        "skipped" => $skipped,
        "model_version" => $modelVersion,
    ]);

} catch (PDOException $e) {
    if (isset($db) && $db->inTransaction()) { $db->rollBack(); }
    logServerError($e); buildResponse(false, "A database error occurred. Please try again.", null, 500);
} catch (Exception $e) {
    if (isset($db) && $db->inTransaction()) { $db->rollBack(); }
    logServerError($e); buildResponse(false, "Something went wrong. Please try again.", null, 500);
}