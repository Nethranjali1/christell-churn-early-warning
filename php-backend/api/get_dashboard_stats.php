<?php
require_once __DIR__ . '/../config/Api.php';

requireMethod('GET');
$auth = requireAuth(['manager', 'admin']);

try {
    $db = Database::getInstance()->getConnection();

    // ---- Core counts ----
    $totalPatients = (int)$db->query("SELECT COUNT(*) AS c FROM users")->fetch()['c'];
    $totalDoctors  = (int)$db->query("SELECT COUNT(*) AS c FROM doctors")->fetch()['c'];
    $totalBookings = (int)$db->query("SELECT COUNT(*) AS c FROM bookings")->fetch()['c'];

    $todaysBookings = (int)$db->query("
        SELECT COUNT(*) AS c FROM bookings WHERE DATE(appointment_date) = CURDATE()
    ")->fetch()['c'];

    // Active patients: attended a booking within the last 90 days (mirrors the churn rule elsewhere in this system)
    $activePatients = (int)$db->query("
        SELECT COUNT(DISTINCT b.user_id) AS c
        FROM bookings b
        JOIN booking_status bs ON b.status_id = bs.status_id
        WHERE bs.status_name = 'Attended'
          AND b.appointment_date >= DATE_SUB(NOW(), INTERVAL 90 DAY)
    ")->fetch()['c'];

    $totalRevenue = (float)$db->query("
        SELECT COALESCE(SUM(t.amount_spent), 0) AS s
        FROM treatments t
        JOIN treatment_status ts ON t.status_id = ts.status_id
        WHERE ts.status_name = 'Completed'
    ")->fetch()['s'];

    $upcomingCount = (int)$db->query("
        SELECT COUNT(*) AS c
        FROM bookings b
        JOIN booking_status bs ON b.status_id = bs.status_id
        WHERE b.appointment_date >= NOW()
          AND bs.status_name NOT IN ('Cancelled', 'Attended')
    ")->fetch()['c'];

    // ---- Recent bookings (last 8) ----
    $stmt = $db->query("
        SELECT b.booking_id, u.name AS patient_name, u.mobile_no,
               b.appointment_date, bs.status_name
        FROM bookings b
        JOIN users u ON b.user_id = u.user_id
        JOIN booking_status bs ON b.status_id = bs.status_id
        ORDER BY b.booking_id DESC
        LIMIT 8
    ");
    $recentBookings = $stmt->fetchAll();

    // ---- Bookings trend, last 7 days ----
    $stmt = $db->query("
        SELECT DATE(appointment_date) AS day, COUNT(*) AS total
        FROM bookings
        WHERE appointment_date >= DATE_SUB(CURDATE(), INTERVAL 6 DAY)
          AND appointment_date < DATE_ADD(CURDATE(), INTERVAL 1 DAY)
        GROUP BY DATE(appointment_date)
        ORDER BY day ASC
    ");
    $trendRaw = $stmt->fetchAll();
    $trendMap = [];
    foreach ($trendRaw as $row) {
        $trendMap[$row['day']] = (int)$row['total'];
    }
    $bookingsTrend = [];
    for ($i = 6; $i >= 0; $i--) {
        $day = date('Y-m-d', strtotime("-$i day"));
        $bookingsTrend[] = ["date" => $day, "total" => $trendMap[$day] ?? 0];
    }

    // ---- Top service categories by completed treatment count ----
    $stmt = $db->query("
        SELECT sc.category_name, COUNT(*) AS treatment_count, COALESCE(SUM(t.amount_spent),0) AS revenue
        FROM treatments t
        JOIN service_categories sc ON t.category_id = sc.category_id
        JOIN treatment_status ts ON t.status_id = ts.status_id
        WHERE ts.status_name = 'Completed'
        GROUP BY sc.category_id, sc.category_name
        ORDER BY treatment_count DESC
        LIMIT 5
    ");
    $topCategories = $stmt->fetchAll();

    buildResponse(true, "Success", [
        "total_patients"    => $totalPatients,
        "active_patients"   => $activePatients,
        "total_doctors"     => $totalDoctors,
        "total_bookings"    => $totalBookings,
        "todays_bookings"   => $todaysBookings,
        "upcoming_bookings" => $upcomingCount,
        "total_revenue"     => round($totalRevenue, 2),
        "recent_bookings"   => $recentBookings,
        "bookings_trend"    => $bookingsTrend,
        "top_categories"    => $topCategories
    ]);

} catch (PDOException $e) {
    logServerError($e); buildResponse(false, "A database error occurred. Please try again.", null, 500);
} catch (Exception $e) {
    logServerError($e); buildResponse(false, "Something went wrong. Please try again.", null, 500);
}
