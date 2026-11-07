<?php
/**
 * POST update_booking_status.php
 * body: {"booking_id": 123, "status": "Attended" | "No Show" | "Cancelled"}
 *
 * Front Desk, Manager and Admin. Records what happened to a booking so that
 * visits, spend and churn features stay current.
 *
 * Rules:
 *  - Only a booking that is currently "Booked" can be changed (history is not rewritten).
 *  - "Attended" and "No Show" only once the appointment time has passed.
 *  - "Attended" also marks the booking's open treatments "Completed"
 *    (spend only counts Completed treatments, so a visit without them would show zero spend).
 *  - "No Show" / "Cancelled" mark open treatments "Cancelled" (if that treatment status exists).
 *  - Every change is written to booking_status_log (who, when, from, to).
 */
require_once __DIR__ . '/../config/Api.php';

requireMethod('POST');
$auth = requireAuth(['frontdesk', 'manager', 'admin']);

$body = getJsonBody();
$allowed = ['Attended', 'No Show', 'Cancelled'];

if (!isset($body['booking_id']) || !ctype_digit((string)$body['booking_id']) || (int)$body['booking_id'] < 1) {
    buildResponse(false, "A valid 'booking_id' is required", null);
}
$newStatus = isset($body['status']) ? trim((string)$body['status']) : '';
if (!in_array($newStatus, $allowed, true)) {
    buildResponse(false, "Status must be one of: " . implode(', ', $allowed), null);
}
$bookingId = (int)$body['booking_id'];

try {
    $db = Database::getInstance()->getConnection();

    if (!$db->query("SHOW TABLES LIKE 'booking_status_log'")->fetch()) {
        buildResponse(false, "Status updates are not set up yet. Run php-backend/sql/booking_status_log.sql once in phpMyAdmin.", null, 500);
    }

    // Status ids by name (case-insensitive, so small naming differences don't break it)
    $bookingStatusIds = [];
    foreach ($db->query("SELECT status_id, status_name FROM booking_status")->fetchAll() as $r) {
        $bookingStatusIds[strtolower(trim($r['status_name']))] = (int)$r['status_id'];
    }
    $treatmentStatusIds = [];
    foreach ($db->query("SELECT status_id, status_name FROM treatment_status")->fetchAll() as $r) {
        $treatmentStatusIds[strtolower(trim($r['status_name']))] = (int)$r['status_id'];
    }
    foreach (['booked', strtolower($newStatus)] as $needed) {
        if (!isset($bookingStatusIds[$needed])) {
            buildResponse(false, "Booking status '$needed' is missing from the booking_status table.", null, 500);
        }
    }
    $completedId = $treatmentStatusIds['completed'] ?? null;
    $cancelledId = $treatmentStatusIds['cancelled'] ?? ($treatmentStatusIds['canceled'] ?? null);
    if ($newStatus === 'Attended' && $completedId === null) {
        buildResponse(false, "Treatment status 'Completed' is missing from the treatment_status table.", null, 500);
    }

    $db->beginTransaction();

    $stmt = $db->prepare("
        SELECT b.booking_id, b.status_id, b.appointment_date, (b.appointment_date <= NOW()) AS is_past,
               u.name AS patient_name
        FROM bookings b
        JOIN users u ON u.user_id = b.user_id
        WHERE b.booking_id = :id
        FOR UPDATE
    ");
    $stmt->execute(['id' => $bookingId]);
    $booking = $stmt->fetch();

    if (!$booking) {
        $db->rollBack();
        buildResponse(false, "Booking not found", null, 404);
    }
    if ((int)$booking['status_id'] !== $bookingStatusIds['booked']) {
        $db->rollBack();
        buildResponse(false, "Only bookings that are still 'Booked' can be updated. This one has already been recorded.", null, 409);
    }
    if ($newStatus !== 'Cancelled' && !(int)$booking['is_past']) {
        $db->rollBack();
        buildResponse(false, "This appointment hasn't happened yet. It can only be cancelled for now.", null, 409);
    }

    $newStatusId = $bookingStatusIds[strtolower($newStatus)];
    $db->prepare("UPDATE bookings SET status_id = :s WHERE booking_id = :id")
       ->execute(['s' => $newStatusId, 'id' => $bookingId]);

    // Open treatments = not already Completed or Cancelled
    $closed = array_values(array_filter([$completedId, $cancelledId], function ($v) { return $v !== null; }));
    $closedList = $closed ? implode(',', array_map('intval', $closed)) : '0';
    $targetTreatmentStatus = $newStatus === 'Attended' ? $completedId : $cancelledId;
    $treatmentsUpdated = 0;
    if ($targetTreatmentStatus !== null) {
        $upd = $db->prepare("UPDATE treatments SET status_id = :ts WHERE booking_id = :id AND status_id NOT IN ($closedList)");
        $upd->execute(['ts' => $targetTreatmentStatus, 'id' => $bookingId]);
        $treatmentsUpdated = $upd->rowCount();
    }

    $db->prepare("
        INSERT INTO booking_status_log (booking_id, old_status_id, new_status_id, treatments_updated, staff_id)
        VALUES (:b, :o, :n, :t, :s)
    ")->execute([
        'b' => $bookingId, 'o' => (int)$booking['status_id'], 'n' => $newStatusId,
        't' => $treatmentsUpdated, 's' => (int)$auth['staff_id'],
    ]);

    $db->commit();

    buildResponse(true, "Booking marked as $newStatus", [
        "booking_id" => $bookingId,
        "patient_name" => $booking['patient_name'],
        "status" => $newStatus,
        "treatments_updated" => $treatmentsUpdated,
    ]);

} catch (PDOException $e) {
    if (isset($db) && $db->inTransaction()) { $db->rollBack(); }
    logServerError($e); buildResponse(false, "A database error occurred. Please try again.", null, 500);
} catch (Exception $e) {
    if (isset($db) && $db->inTransaction()) { $db->rollBack(); }
    logServerError($e); buildResponse(false, "Something went wrong. Please try again.", null, 500);
}
