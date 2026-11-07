<?php
require_once __DIR__ . '/../config/Api.php';
require_once __DIR__ . '/../config/ChurnScoring.php';

requireMethod('POST');
$auth = requireAuth(['frontdesk', 'manager', 'admin']);

$body = getJsonBody();

if (!array_key_exists('user_id', $body) || trim((string)$body['user_id']) === '' || !ctype_digit((string)$body['user_id'])) {
    buildResponse(false, "A valid 'user_id' is required", null);
}
$userId = (int)$body['user_id'];

try {
    $db = Database::getInstance()->getConnection();

    $built = churn_build_features($db, $userId);
    $prediction = churn_call_model($built['features']);

    buildResponse(true, "Success", [
        "patient_name" => $built['patient_name'],
        "features" => $built['features'],
        "prediction" => $prediction
    ]);

} catch (ChurnScoringException $e) {
    buildResponse(false, $e->getMessage(), null, $e->httpCode);
} catch (PDOException $e) {
    logServerError($e); buildResponse(false, "A database error occurred. Please try again.", null, 500);
} catch (Exception $e) {
    logServerError($e); buildResponse(false, "Something went wrong. Please try again.", null, 500);
}
