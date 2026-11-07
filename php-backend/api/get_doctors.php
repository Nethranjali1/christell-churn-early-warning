<?php
require_once __DIR__ . '/../config/Api.php';

requireMethod('GET');
$auth = requireAuth(['manager', 'admin']);

try {
    $db = Database::getInstance()->getConnection();

    $stmt = $db->query("
        SELECT
            d.doctor_id, d.doctor_name,
            COUNT(DISTINCT sc.category_id) AS category_count,
            COUNT(t.treatment_id) AS treatment_count,
            COALESCE(SUM(CASE WHEN ts.status_name = 'Completed' THEN t.amount_spent ELSE 0 END), 0) AS total_revenue
        FROM doctors d
        LEFT JOIN service_categories sc ON sc.doctor_id = d.doctor_id
        LEFT JOIN treatments t ON t.doctor_id = d.doctor_id
        LEFT JOIN treatment_status ts ON t.status_id = ts.status_id
        GROUP BY d.doctor_id, d.doctor_name
        ORDER BY total_revenue DESC
    ");
    $doctors = $stmt->fetchAll();

    foreach ($doctors as &$d) {
        $d['treatment_count'] = (int)$d['treatment_count'];
        $d['category_count'] = (int)$d['category_count'];
        $d['total_revenue'] = round((float)$d['total_revenue'], 2);
    }

    buildResponse(true, "Success", ["doctors" => $doctors]);

} catch (PDOException $e) {
    logServerError($e); buildResponse(false, "A database error occurred. Please try again.", null, 500);
} catch (Exception $e) {
    logServerError($e); buildResponse(false, "Something went wrong. Please try again.", null, 500);
}
