<?php
/**
 *   GET get_retention_actions.php?user_id=12   -> history for one patient (newest first)
 *   GET get_retention_actions.php?latest=1     -> most recent action for every patient (At-Risk page)
 */
require_once __DIR__ . '/../config/Api.php';

requireMethod('GET');
$auth = requireAuth(['frontdesk', 'manager', 'admin']);

try {
    $db = Database::getInstance()->getConnection();

    if (!$db->query("SHOW TABLES LIKE 'retention_actions'")->fetch()) {
        buildResponse(false, "The retention_actions table does not exist yet. Run php-backend/sql/retention_actions.sql in your database first.", null, 500);
    }

    if (isset($_GET['latest'])) {
        $rows = $db->query("
            SELECT ra.user_id, ra.channel, ra.outcome, ra.created_at
            FROM retention_actions ra
            JOIN (SELECT user_id, MAX(action_id) AS max_id FROM retention_actions GROUP BY user_id) m
              ON m.max_id = ra.action_id
        ")->fetchAll();
        foreach ($rows as &$r) { $r['user_id'] = (int)$r['user_id']; }
        buildResponse(true, "Success", ["latest" => $rows]);
    }

    $userId = (isset($_GET['user_id']) && ctype_digit((string)$_GET['user_id'])) ? (int)$_GET['user_id'] : 0;
    if ($userId <= 0) { buildResponse(false, "A valid 'user_id' is required", null); }

    $stmt = $db->prepare("
        SELECT ra.action_id, ra.channel, ra.outcome, ra.notes, ra.risk_tier_at_time,
               ra.churn_probability_at_time, ra.created_at, s.display_name AS staff_name
        FROM retention_actions ra
        LEFT JOIN staff_accounts s ON s.staff_id = ra.staff_id
        WHERE ra.user_id = :id
        ORDER BY ra.action_id DESC
        LIMIT 50
    ");
    $stmt->execute(['id' => $userId]);

    buildResponse(true, "Success", ["actions" => $stmt->fetchAll()]);

} catch (PDOException $e) {
    logServerError($e); buildResponse(false, "A database error occurred. Please try again.", null, 500);
}
