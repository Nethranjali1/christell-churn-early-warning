<?php
/**
 * POST get_early_warning_features.php   body: {"user_id": 123}
 *
 * Returns the exact 13-field feature vector the churn model receives for one
 * active patient (FR7), for inspection and debugging. Manager/Admin only.
 *
 * Uses the same churn_build_features() as predict_churn.php and
 * score_all_churn.php, so what you inspect here is always exactly what the
 * model was sent (no second copy of the feature logic).
 */
require_once __DIR__ . '/../config/Api.php';
require_once __DIR__ . '/../config/ChurnScoring.php';

requireMethod('POST');
$auth = requireAuth(['manager', 'admin']);

$body = getJsonBody();

if (!array_key_exists('user_id', $body) || !ctype_digit((string)$body['user_id']) || (int)$body['user_id'] < 1) {
    buildResponse(false, "A valid 'user_id' is required", null);
}
$userId = (int)$body['user_id'];

try {
    $db = Database::getInstance()->getConnection();

    // Throws ChurnScoringException for unknown, ineligible (inactive) or unsupported patients (FR9)
    $built = churn_build_features($db, $userId);

    // Same flat shape as before, so existing clients keep working
    buildResponse(true, "Success", $built['features']);

} catch (ChurnScoringException $e) {
    buildResponse(false, $e->getMessage(), null, $e->httpCode);
} catch (PDOException $e) {
    logServerError($e); buildResponse(false, "A database error occurred. Please try again.", null, 500);
} catch (Exception $e) {
    logServerError($e); buildResponse(false, "Something went wrong. Please try again.", null, 500);
}
