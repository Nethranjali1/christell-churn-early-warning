<?php
require_once __DIR__ . '/../config/Api.php';

requireMethod('POST');
$auth = requireAuth(['frontdesk', 'manager', 'admin']);

$body = getJsonBody();

$channels = ['call', 'sms', 'whatsapp', 'email', 'in_person'];
$outcomes = ['pending', 'no_answer', 'contacted', 'rebooked', 'declined'];

$userId  = (isset($body['user_id']) && ctype_digit((string)$body['user_id'])) ? (int)$body['user_id'] : 0;
$channel = (string)($body['channel'] ?? '');
$outcome = (string)($body['outcome'] ?? '');
$notes   = trim((string)($body['notes'] ?? ''));

if ($userId <= 0) { buildResponse(false, "A valid 'user_id' is required", null); }
if (!in_array($channel, $channels, true)) { buildResponse(false, "Please choose how the patient was contacted", null); }
if (!in_array($outcome, $outcomes, true)) { buildResponse(false, "Please choose an outcome", null); }
if (mb_strlen($notes) > 500) { buildResponse(false, "Notes must be 500 characters or fewer", null); }

try {
    $db = Database::getInstance()->getConnection();

    $stmt = $db->prepare("SELECT 1 FROM users WHERE user_id = :id");
    $stmt->execute(['id' => $userId]);
    if (!$stmt->fetch()) { buildResponse(false, "Patient not found", null, 404); }

    // Snapshot the patient's latest stored risk, so outcomes can later be compared with the model's prediction
    $tier = null;
    $prob = null;
    if ($db->query("SHOW TABLES LIKE 'churn_scores'")->fetch()) {
        $s = $db->prepare("SELECT risk_tier, churn_probability FROM churn_scores WHERE user_id = :id AND status = 'scored' ORDER BY score_id DESC LIMIT 1");
        $s->execute(['id' => $userId]);
        if ($row = $s->fetch()) {
            $tier = $row['risk_tier'];
            $prob = $row['churn_probability'];
        }
    }

    $ins = $db->prepare("
        INSERT INTO retention_actions (user_id, staff_id, channel, outcome, notes, risk_tier_at_time, churn_probability_at_time)
        VALUES (:u, :s, :c, :o, :n, :t, :p)
    ");
    $ins->execute([
        'u' => $userId, 's' => $auth['staff_id'], 'c' => $channel, 'o' => $outcome,
        'n' => $notes === '' ? null : $notes, 't' => $tier, 'p' => $prob,
    ]);

    buildResponse(true, "Contact logged", ["action_id" => (int)$db->lastInsertId()]);

} catch (PDOException $e) {
    logServerError($e); buildResponse(false, "A database error occurred. Please try again.", null, 500);
}
