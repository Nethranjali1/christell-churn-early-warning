<?php
require_once __DIR__ . '/../config/Api.php';

requireMethod('POST');

$body = getJsonBody();

if (!array_key_exists('username', $body) || !array_key_exists('password', $body)) {
    buildResponse(false, "Fields 'username' and 'password' are required", null);
}
$username = trim((string)$body['username']);
$password = (string)$body['password'];

if ($username === '' || $password === '') {
    buildResponse(false, "Username and password cannot be empty", null);
}

try {
    $db = Database::getInstance()->getConnection();

    $stmt = $db->prepare("SELECT staff_id, username, password_hash, display_name, role, is_active FROM staff_accounts WHERE username = :u");
    $stmt->execute(['u' => $username]);
    $staff = $stmt->fetch();

    // Same message for unknown user, wrong password or disabled account
    if (!$staff || !(int)$staff['is_active'] || !password_verify($password, $staff['password_hash'])) {
        buildResponse(false, "Invalid username or password", null, 401);
    }

    $db->exec("DELETE FROM auth_sessions WHERE expires_at < NOW()");

    $token = bin2hex(random_bytes(32));
    $db->prepare("INSERT INTO auth_sessions (token_hash, staff_id, expires_at) VALUES (:h, :s, DATE_ADD(NOW(), INTERVAL 8 HOUR))")
       ->execute(['h' => hash('sha256', $token), 's' => $staff['staff_id']]);
    $db->prepare("UPDATE staff_accounts SET last_login = NOW() WHERE staff_id = :s")
       ->execute(['s' => $staff['staff_id']]);

    buildResponse(true, "Login successful", [
        "token" => $token,
        "admin" => [
            "username" => $staff['username'],
            "display_name" => $staff['display_name'],
            "role" => $staff['role'],
            "role_label" => ROLE_LABELS[$staff['role']] ?? $staff['role']
        ]
    ]);
} catch (PDOException $e) {
    logServerError($e); buildResponse(false, "A database error occurred. Please try again.", null, 500);
}
