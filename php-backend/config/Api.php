<?php
/**
 * Shared API bootstrap: CORS headers + standard JSON response envelope.
 * Every endpoint should require this file first.
 */

require_once __DIR__ . '/Database.php';

header("Content-Type: application/json; charset=UTF-8");
// CORS: only these web addresses may call the API from a browser.
// The console is served from http://localhost/frontend, so normally nothing else is needed.
// Add an address here if the console is opened from somewhere else (e.g. a testing tunnel).
$ALLOWED_ORIGINS = ['http://localhost', 'http://127.0.0.1'];
$requestOrigin = $_SERVER['HTTP_ORIGIN'] ?? '';
if (in_array($requestOrigin, $ALLOWED_ORIGINS, true)) {
    header("Access-Control-Allow-Origin: " . $requestOrigin);
    header("Vary: Origin");
}
header("Access-Control-Allow-Methods: GET, POST, OPTIONS");
header("Access-Control-Allow-Headers: Content-Type, Authorization");

// Preflight
if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(204);
    exit;
}

/**
 * Write the real error to the PHP error log (C:\xampp\php\logs\php_error_log)
 * so the browser never sees table names, SQL or file paths.
 */
function logServerError($e) {
    error_log(sprintf('[%s] %s: %s in %s:%d', basename($_SERVER['SCRIPT_NAME'] ?? 'api'),
        get_class($e), $e->getMessage(), $e->getFile(), $e->getLine()));
}

function buildResponse($success, $message, $data, $httpCode = null) {
    if ($httpCode === null) {
        $httpCode = $success ? 200 : 400;
    }
    http_response_code($httpCode);
    echo json_encode([
        "successStatus" => $success,
        "message" => $message,
        "data" => $data
    ]);
    exit;
}

function getJsonBody() {
    $raw = file_get_contents("php://input");
    if ($raw === false || trim($raw) === "") {
        return [];
    }
    $body = json_decode($raw, true);
    if (json_last_error() !== JSON_ERROR_NONE || !is_array($body)) {
        buildResponse(false, "Request body must be valid JSON", null);
    }
    return $body;
}

function requireMethod($method) {
    if ($_SERVER['REQUEST_METHOD'] !== $method) {
        buildResponse(false, "Only $method method is allowed for this endpoint", null, 405);
    }
}

// ============================================================
// Authentication & role-based access control
// ============================================================
const ROLE_LABELS = ['frontdesk' => 'Front Desk', 'manager' => 'Manager', 'admin' => 'Administrator'];

function getBearerToken() {
    $h = $_SERVER['HTTP_AUTHORIZATION'] ?? $_SERVER['REDIRECT_HTTP_AUTHORIZATION'] ?? '';
    if ($h === '' && function_exists('getallheaders')) {
        foreach (getallheaders() as $k => $v) {
            if (strtolower($k) === 'authorization') { $h = $v; }
        }
    }
    return preg_match('/^Bearer\s+(\S+)$/i', $h, $m) ? $m[1] : null;
}

/**
 * Call at the top of every protected endpoint.
 * $roles = allowed role keys; empty array = any signed-in staff member.
 * Returns the staff row (staff_id, username, display_name, role).
 */
function requireAuth(array $roles = []) {
    $token = getBearerToken();
    if (!$token) {
        buildResponse(false, "Please sign in to continue.", null, 401);
    }
    $db = Database::getInstance()->getConnection();
    $stmt = $db->prepare("
        SELECT s.staff_id, s.username, s.display_name, s.role
        FROM auth_sessions a
        JOIN staff_accounts s ON s.staff_id = a.staff_id
        WHERE a.token_hash = :h AND a.expires_at > NOW() AND s.is_active = 1
    ");
    $stmt->execute(['h' => hash('sha256', $token)]);
    $staff = $stmt->fetch();
    if (!$staff) {
        buildResponse(false, "Your session has expired. Please sign in again.", null, 401);
    }
    if ($roles && !in_array($staff['role'], $roles, true)) {
        buildResponse(false, "Your role does not have access to this.", null, 403);
    }
    return $staff;
}

/** Front Desk sees a masked NIC; Manager and Admin see it in full. */
function maskNic($nic, $role) {
    if ($role !== 'frontdesk' || $nic === null || $nic === '') { return $nic; }
    $n = strlen($nic);
    return $n <= 4 ? $nic : str_repeat('*', $n - 4) . substr($nic, -4);
}
