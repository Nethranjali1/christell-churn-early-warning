<?php
require_once __DIR__ . '/../config/Api.php';

requireMethod('GET');
$auth = requireAuth(['frontdesk', 'manager', 'admin']);

try {
    $db = Database::getInstance()->getConnection();

    // ---- Query params ----
    $search = isset($_GET['search']) ? trim($_GET['search']) : '';
    $page   = isset($_GET['page']) ? max(1, (int)$_GET['page']) : 1;
    $limit  = isset($_GET['limit']) ? (int)$_GET['limit'] : 20;
    if ($limit <= 0 || $limit > 200) { $limit = 20; }
    $offset = ($page - 1) * $limit;

    $allowedSort = ['name', 'created_at', 'number_of_unique_services', 'date_of_birth'];
    $sortBy = isset($_GET['sort_by']) && in_array($_GET['sort_by'], $allowedSort) ? $_GET['sort_by'] : 'created_at';
    $sortDir = (isset($_GET['sort_dir']) && strtoupper($_GET['sort_dir']) === 'ASC') ? 'ASC' : 'DESC';

    // ---- FIX: search ----
    // With ATTR_EMULATE_PREPARES = false, the same named placeholder cannot be
    // used more than once in a query (that caused SQLSTATE[HY093]).
    // So each LIKE gets its own unique placeholder name.
    $where = '';
    $params = [];
     if ($search !== '') {
       $like = "%" . addcslashes($search, '%_\\') . "%";
       $params['s_name']   = $like;
       $params['s_mobile'] = $like;
       if ($auth['role'] === 'frontdesk') {
           $where = "WHERE (u.name LIKE :s_name OR u.mobile_no LIKE :s_mobile)";
       } else {
           $where = "WHERE (u.name LIKE :s_name OR u.nic LIKE :s_nic OR u.mobile_no LIKE :s_mobile)";
           $params['s_nic'] = $like;
       }
   }
    // ---- end of fix ----

    // ---- Total count ----
    $countStmt = $db->prepare("SELECT COUNT(*) AS c FROM users u $where");
    $countStmt->execute($params);
    $total = (int)$countStmt->fetch()['c'];

    // ---- Latest churn run (optional: Patients list works even before the table exists) ----
    $latestRunId = null;
    $hasScores = $db->query("SHOW TABLES LIKE 'churn_scores'")->fetch();
    if ($hasScores) {
        $lr = $db->query("SELECT run_id FROM churn_scores ORDER BY score_id DESC LIMIT 1")->fetch();
        if ($lr) { $latestRunId = $lr['run_id']; }
    }
    $scoreSelect = $latestRunId ? "cs.churn_probability, cs.risk_tier" : "NULL AS churn_probability, NULL AS risk_tier";
    $scoreJoin = $latestRunId
        ? "LEFT JOIN churn_scores cs ON cs.user_id = u.user_id AND cs.run_id = :run_id AND cs.status = 'scored'"
        : "";

    // ---- Page of users with aggregated visit/spend stats ----
    $sql = "
        SELECT
            u.user_id, u.nic, u.name, u.mobile_no, u.address, u.date_of_birth, u.gender,
            u.number_of_unique_services, u.created_at,
            COALESCE(v.total_visits, 0) AS total_visits,
            v.last_visit,
            COALESCE(s.total_spend, 0) AS total_spend,
            $scoreSelect
        FROM users u
        LEFT JOIN (
            SELECT b.user_id, COUNT(*) AS total_visits, MAX(b.appointment_date) AS last_visit
            FROM bookings b
            JOIN booking_status bs ON b.status_id = bs.status_id
            WHERE bs.status_name = 'Attended'
            GROUP BY b.user_id
        ) v ON v.user_id = u.user_id
        LEFT JOIN (
            SELECT b.user_id, SUM(t.amount_spent) AS total_spend
            FROM treatments t
            JOIN bookings b ON t.booking_id = b.booking_id
            JOIN treatment_status ts ON t.status_id = ts.status_id
            WHERE ts.status_name = 'Completed'
            GROUP BY b.user_id
        ) s ON s.user_id = u.user_id
        $scoreJoin
        $where
        ORDER BY u.$sortBy $sortDir
        LIMIT :limit OFFSET :offset
    ";
    $stmt = $db->prepare($sql);
    foreach ($params as $key => $val) {
        $stmt->bindValue(":$key", $val);
    }
    if ($latestRunId) { $stmt->bindValue(':run_id', $latestRunId); }
    $stmt->bindValue(':limit', $limit, PDO::PARAM_INT);
    $stmt->bindValue(':offset', $offset, PDO::PARAM_INT);
    $stmt->execute();
    $rows = $stmt->fetchAll();

    $today = new DateTime();
    $users = [];
    foreach ($rows as $row) {
        $dob = new DateTime($row['date_of_birth']);
        $age = $today->diff($dob)->y;

        $daysSinceLastVisit = null;
        $status = 'New';
        if ($row['last_visit']) {
            $lastVisit = new DateTime($row['last_visit']);
            $daysSinceLastVisit = $today->diff($lastVisit)->days;
            $status = ($daysSinceLastVisit < 90) ? 'Active' : 'Inactive';
        }

        $users[] = [
            "user_id" => (int)$row['user_id'],
            "nic" => maskNic($row['nic'], $auth['role']),
            "name" => $row['name'],
            "mobile_no" => $row['mobile_no'],
            "address" => $row['address'],
            "gender" => $row['gender'],
            "date_of_birth" => $row['date_of_birth'],
            "age" => $age,
            "number_of_unique_services" => (int)$row['number_of_unique_services'],
            "total_visits" => (int)$row['total_visits'],
            "total_spend" => round((float)$row['total_spend'], 2),
            "last_visit" => $row['last_visit'],
            "days_since_last_visit" => $daysSinceLastVisit,
            "status" => $status,
            "created_at" => $row['created_at'],
            "churn_probability" => $row['churn_probability'] !== null ? (float)$row['churn_probability'] : null,
            "risk_tier" => $row['risk_tier']
        ];
    }

    buildResponse(true, "Success", [
        "users" => $users,
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