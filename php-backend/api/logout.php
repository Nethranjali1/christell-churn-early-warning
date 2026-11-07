<?php
require_once __DIR__ . '/../config/Api.php';

requireMethod('POST');

$token = getBearerToken();
if ($token) {
    try {
        $db = Database::getInstance()->getConnection();
        $db->prepare("DELETE FROM auth_sessions WHERE token_hash = :h")->execute(['h' => hash('sha256', $token)]);
    } catch (PDOException $e) { /* ignore: the browser clears its session anyway */ }
}
buildResponse(true, "Signed out", null);
