<?php
require_once __DIR__ . '/../config/Api.php';

requireMethod('GET');
$auth = requireAuth(['frontdesk', 'manager', 'admin']);

if (!isset($_GET['user_id']) || trim((string)$_GET['user_id']) === '' || !ctype_digit((string)$_GET['user_id'])) {
    buildResponse(false, "A valid 'user_id' query parameter is required", null);
}
$userId = (int)$_GET['user_id'];

try {
    $db = Database::getInstance()->getConnection();

    $stmt = $db->prepare("SELECT * FROM users WHERE user_id = :id");
    $stmt->execute(['id' => $userId]);
    $user = $stmt->fetch();

    if (!$user) {
        buildResponse(false, "User not found", null, 404);
    }

    $dob = new DateTime($user['date_of_birth']);
    $age = (new DateTime())->diff($dob)->y;

    // ---- Bookings (with treatment rollup per booking) ----
    $stmt = $db->prepare("
        SELECT b.booking_id, b.appointment_date, b.booking_created_date, bs.status_name AS booking_status,
               (SELECT COUNT(*) FROM treatments t WHERE t.booking_id = b.booking_id) AS treatment_count,
               (SELECT COALESCE(SUM(t.amount_spent),0) FROM treatments t WHERE t.booking_id = b.booking_id) AS booking_spend
        FROM bookings b
        JOIN booking_status bs ON b.status_id = bs.status_id
        WHERE b.user_id = :id
        ORDER BY b.appointment_date DESC
    ");
    $stmt->execute(['id' => $userId]);
    $bookings = $stmt->fetchAll();

    // ---- Treatments (detailed, across all bookings) ----
    $stmt = $db->prepare("
        SELECT tr.treatment_id, tr.booking_id, b.appointment_date, sc.category_name, d.doctor_name,
               tr.amount_spent, ts.status_name AS treatment_status, tr.treatment_date
        FROM treatments tr
        JOIN bookings b ON tr.booking_id = b.booking_id
        JOIN service_categories sc ON tr.category_id = sc.category_id
        JOIN doctors d ON tr.doctor_id = d.doctor_id
        JOIN treatment_status ts ON tr.status_id = ts.status_id
        WHERE b.user_id = :id
        ORDER BY tr.treatment_date DESC
    ");
    $stmt->execute(['id' => $userId]);
    $treatments = $stmt->fetchAll();

    $totalSpend = 0;
    foreach ($treatments as $t) {
        if ($t['treatment_status'] === 'Completed') {
            $totalSpend += (float)$t['amount_spent'];
        }
    }

    $lastVisit = null;
    foreach ($bookings as $b) {
        if ($b['booking_status'] === 'Attended') {
            $lastVisit = $b['appointment_date'];
            break; // already sorted DESC
        }
    }
    $status = 'New';
    $daysSinceLastVisit = null;
    if ($lastVisit) {
        $daysSinceLastVisit = (new DateTime())->diff(new DateTime($lastVisit))->days;
        $status = ($daysSinceLastVisit < 90) ? 'Active' : 'Inactive';
    }

    buildResponse(true, "Success", [
        "profile" => [
            "user_id" => (int)$user['user_id'],
            "nic" => maskNic($user['nic'], $auth['role']),
            "name" => $user['name'],
            "mobile_no" => $user['mobile_no'],
            "address" => $user['address'],
            "date_of_birth" => $user['date_of_birth'],
            "age" => $age,
            "gender" => $user['gender'],
            "past_medical_history" => $user['past_medical_history'],
            "number_of_unique_services" => (int)$user['number_of_unique_services'],
            "created_at" => $user['created_at'],
            "status" => $status,
            "days_since_last_visit" => $daysSinceLastVisit,
            "total_spend" => round($totalSpend, 2),
            "total_bookings" => count($bookings)
        ],
        "bookings" => $bookings,
        "treatments" => $treatments
    ]);

} catch (PDOException $e) {
    logServerError($e); buildResponse(false, "A database error occurred. Please try again.", null, 500);
} catch (Exception $e) {
    logServerError($e); buildResponse(false, "Something went wrong. Please try again.", null, 500);
}
