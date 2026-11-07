<?php
require_once __DIR__ . '/../config/Api.php';

requireMethod('GET');
$auth = requireAuth(['frontdesk', 'manager', 'admin']);

try {
    $db = Database::getInstance()->getConnection();

    $bookingStatuses = $db->query("SELECT status_id, status_name FROM booking_status ORDER BY status_name")->fetchAll();
    $treatmentStatuses = $db->query("SELECT status_id, status_name FROM treatment_status ORDER BY status_name")->fetchAll();
    $serviceCategories = $db->query("SELECT category_id, category_name, doctor_id FROM service_categories ORDER BY category_name")->fetchAll();

    buildResponse(true, "Success", [
        "booking_statuses" => $bookingStatuses,
        "treatment_statuses" => $treatmentStatuses,
        "service_categories" => $serviceCategories
    ]);

} catch (PDOException $e) {
    logServerError($e); buildResponse(false, "A database error occurred. Please try again.", null, 500);
} catch (Exception $e) {
    logServerError($e); buildResponse(false, "Something went wrong. Please try again.", null, 500);
}
