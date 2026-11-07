<?php
require_once __DIR__ . '/../config/Api.php';

requireMethod('GET');
$auth = requireAuth(['frontdesk', 'manager', 'admin']);

try {
    $db = Database::getInstance()->getConnection();

    $search      = isset($_GET['search']) ? trim($_GET['search']) : '';
    $status      = isset($_GET['status']) ? trim($_GET['status']) : '';
    $dateFrom    = isset($_GET['date_from']) ? trim($_GET['date_from']) : '';
    $dateTo      = isset($_GET['date_to']) ? trim($_GET['date_to']) : '';
    $needsUpdate = isset($_GET['needs_update']) && $_GET['needs_update'] === '1';
    $page        = isset($_GET['page']) ? max(1, (int)$_GET['page']) : 1;
    $limit       = isset($_GET['limit']) ? (int)$_GET['limit'] : 20;
    if ($limit <= 0 || $limit > 200) { $limit = 20; }
    $offset = ($page - 1) * $limit;

    $conditions = [];
    $params = [];

    // With ATTR_EMULATE_PREPARES = false, the same named placeholder cannot be
    // used more than once in a query (that caused SQLSTATE[HY093]).
    // So each LIKE gets its own unique placeholder name.
    if ($search !== '') {
        $conditions[] = "(u.name LIKE :s_name OR u.mobile_no LIKE :s_mobile)";
        $like = "%" . addcslashes($search, '%_\\') . "%";
        $params['s_name']   = $like;
        $params['s_mobile'] = $like;
    }
    if ($status !== '') {
        $conditions[] = "bs.status_name = :status";
        $params['status'] = $status;
    }
    if ($dateFrom !== '') {
        $conditions[] = "b.appointment_date >= :date_from";
        $params['date_from'] = $dateFrom . " 00:00:00";
    }
    if ($dateTo !== '') {
        $conditions[] = "b.appointment_date <= :date_to";
        $params['date_to'] = $dateTo . " 23:59:59";
    }
    // Past appointments that are still 'Booked' (nobody recorded what happened)
    if ($needsUpdate) {
        $conditions[] = "(bs.status_name = 'Booked' AND b.appointment_date <= NOW())";
    }

    $where = count($conditions) ? "WHERE " . implode(" AND ", $conditions) : "";

    $countStmt = $db->prepare("
        SELECT COUNT(*) AS c
        FROM bookings b
        JOIN users u ON b.user_id = u.user_id
        JOIN booking_status bs ON b.status_id = bs.status_id
        $where
    ");
    $countStmt->execute($params);
    $total = (int)$countStmt->fetch()['c'];

    // How many past bookings still need a status, across ALL bookings (for the notice)
    $needsUpdateCount = (int)$db->query("
        SELECT COUNT(*) FROM bookings b
        JOIN booking_status bs ON b.status_id = bs.status_id
        WHERE bs.status_name = 'Booked' AND b.appointment_date <= NOW()
    ")->fetchColumn();

    $sql = "
        SELECT b.booking_id, b.user_id, u.name AS patient_name, u.mobile_no,
               b.appointment_date, b.booking_created_date, bs.status_name,
               (b.appointment_date <= NOW()) AS is_past,
               (bs.status_name = 'Booked' AND b.appointment_date <= NOW()) AS needs_update,
               (SELECT COUNT(*) FROM treatments t WHERE t.booking_id = b.booking_id) AS treatment_count,
               (SELECT COALESCE(SUM(t.amount_spent),0) FROM treatments t WHERE t.booking_id = b.booking_id) AS booking_spend
        FROM bookings b
        JOIN users u ON b.user_id = u.user_id
        JOIN booking_status bs ON b.status_id = bs.status_id
        $where
        ORDER BY b.appointment_date DESC
        LIMIT :limit OFFSET :offset
    ";
    $stmt = $db->prepare($sql);
    foreach ($params as $key => $val) {
        $stmt->bindValue(":$key", $val);
    }
    $stmt->bindValue(':limit', $limit, PDO::PARAM_INT);
    $stmt->bindValue(':offset', $offset, PDO::PARAM_INT);
    $stmt->execute();
    $bookings = $stmt->fetchAll();

    buildResponse(true, "Success", [
        "bookings" => $bookings,
        "needs_update_count" => $needsUpdateCount,
        "pagination" => [
            "page" => $page,
            "limit" => $limit,
            "total" => $total,
            "total_pages" => (int)ceil($total / $limit)
        ]
    ]);

} catch (PDOException $e) {
    logServerError($e); buildResponse(false, "A database error occurred. Please try again.", null, 500);
} catch (Exception $e) {
    logServerError($e); buildResponse(false, "Something went wrong. Please try again.", null, 500);
}
