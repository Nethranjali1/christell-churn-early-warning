<?php
/**
 * Shared churn-scoring logic.
 * Used by predict_churn.php (one patient, live) and score_all_churn.php (batch, stored).
 */
require_once __DIR__ . '/MlConfig.php';

class ChurnScoringException extends Exception {
    public $httpCode;
    public function __construct($message, $httpCode = 400) {
        parent::__construct($message);
        $this->httpCode = $httpCode;
    }
}

function churn_age_group($age) {
    $ranges = [
        "18-24" => [18, 24], "25-34" => [25, 34], "35-44" => [35, 44],
        "45-54" => [45, 54], "55-64" => [55, 64], "65-75" => [65, 75],
    ];
    foreach ($ranges as $label => $range) {
        if ($age >= $range[0] && $age <= $range[1]) return $label;
    }
    return null;
}

function churn_build_features(PDO $db, $userId) {
    // ---- 1. Fetch user ----
    $stmt = $db->prepare("SELECT user_id, name, gender, date_of_birth FROM users WHERE user_id = :user_id");
    $stmt->execute(['user_id' => $userId]);
    $user = $stmt->fetch();

    if (!$user) {
        throw new ChurnScoringException("User not found", 404);
    }
    if (!in_array($user['gender'], ['Male', 'Female'])) {
        throw new ChurnScoringException("This patient's gender is not set to a value the model supports (Male/Female)");
    }

    // ---- 2. Age / Age_Group ----
    $dob = new DateTime($user['date_of_birth']);
    $today = new DateTime();
    $age = $today->diff($dob)->y;

    if ($age < 18 || $age > 75) {
        throw new ChurnScoringException("This patient's age ($age) is outside the model's supported range (18-75)");
    }
    $ageGroup = churn_age_group($age);
    if ($ageGroup === null) {
        throw new ChurnScoringException("Unable to determine a valid age group for age $age");
    }

    // ---- 3. All-time visit stats (Attended bookings) ----
    $stmt = $db->prepare("
        SELECT COUNT(*) AS total_visits, MIN(appointment_date) AS first_visit, MAX(appointment_date) AS last_visit
        FROM bookings b
        JOIN booking_status bs ON b.status_id = bs.status_id
        WHERE b.user_id = :user_id AND bs.status_name = 'Attended'
    ");
    $stmt->execute(['user_id' => $userId]);
    $visitData = $stmt->fetch();
    $numberOfVisitsToDate = (int)$visitData['total_visits'];

    if ($numberOfVisitsToDate === 0) {
        throw new ChurnScoringException("This patient has no attended bookings yet — not enough history to forecast churn");
    }

    $lastVisitDate = new DateTime($visitData['last_visit']);
    $firstVisitDate = new DateTime($visitData['first_visit']);
    $daysSinceLastVisit = $today->diff($lastVisitDate)->days;
    $customerTenureDays = $today->diff($firstVisitDate)->days;

    // ---- 4. Eligibility: only currently-active patients are scored ----
    if ($daysSinceLastVisit >= 90) {
        throw new ChurnScoringException("This patient is not currently active (last visit was $daysSinceLastVisit days ago). Churn forecasting only applies to active patients.");
    }

    // ---- 5. Avg visit interval to date ----
    if ($numberOfVisitsToDate > 1) {
        $stmt = $db->prepare("
            SELECT appointment_date FROM bookings b
            JOIN booking_status bs ON b.status_id = bs.status_id
            WHERE b.user_id = :user_id AND bs.status_name = 'Attended'
            ORDER BY appointment_date ASC
        ");
        $stmt->execute(['user_id' => $userId]);
        $allVisits = $stmt->fetchAll(PDO::FETCH_COLUMN);
        $gaps = [];
        for ($i = 1; $i < count($allVisits); $i++) {
            $d1 = new DateTime($allVisits[$i - 1]);
            $d2 = new DateTime($allVisits[$i]);
            $gaps[] = $d1->diff($d2)->days;
        }
        $avgVisitInterval = round(array_sum($gaps) / count($gaps), 2);
    } else {
        $avgVisitInterval = $customerTenureDays;
    }

    // ---- 6. Unique services to date ----
    $stmt = $db->prepare("
        SELECT COUNT(DISTINCT t.category_id) AS unique_count
        FROM treatments t
        JOIN bookings b ON t.booking_id = b.booking_id
        JOIN treatment_status ts ON t.status_id = ts.status_id
        WHERE b.user_id = :user_id AND ts.status_name = 'Completed'
    ");
    $stmt->execute(['user_id' => $userId]);
    $uniqueServices = (int)$stmt->fetch()['unique_count'];

    // ---- 7. Preferred service category (ML-mapped label) ----
    $stmt = $db->prepare("
        SELECT sc.category_name, sc.ml_model_category, COUNT(*) AS cnt, SUM(t.amount_spent) AS cat_spend
        FROM treatments t
        JOIN bookings b ON t.booking_id = b.booking_id
        JOIN treatment_status ts ON t.status_id = ts.status_id
        JOIN service_categories sc ON t.category_id = sc.category_id
        WHERE b.user_id = :user_id AND ts.status_name = 'Completed'
        GROUP BY sc.category_id, sc.category_name, sc.ml_model_category
        ORDER BY cnt DESC, cat_spend DESC
        LIMIT 1
    ");
    $stmt->execute(['user_id' => $userId]);
    $prefCatRow = $stmt->fetch();

    if (!$prefCatRow) {
        throw new ChurnScoringException("Unable to determine a preferred service category for this patient");
    }
    $preferredServiceCategory = $prefCatRow['ml_model_category'];
    if ($preferredServiceCategory === null || trim($preferredServiceCategory) === "") {
        throw new ChurnScoringException("No ML category mapping is defined for '{$prefCatRow['category_name']}'. Set 'ml_model_category' in service_categories.");
    }

    // ---- 8. Windowed visits & spend (last 90 days, and 90-180 days ago) ----
    $stmt = $db->prepare("
        SELECT
            SUM(CASE WHEN b.appointment_date >= DATE_SUB(NOW(), INTERVAL 90 DAY) THEN 1 ELSE 0 END) AS visits_last_90,
            SUM(CASE WHEN b.appointment_date < DATE_SUB(NOW(), INTERVAL 90 DAY)
                     AND b.appointment_date >= DATE_SUB(NOW(), INTERVAL 180 DAY) THEN 1 ELSE 0 END) AS visits_prior_90
        FROM bookings b
        JOIN booking_status bs ON b.status_id = bs.status_id
        WHERE b.user_id = :user_id AND bs.status_name = 'Attended'
    ");
    $stmt->execute(['user_id' => $userId]);
    $windowVisits = $stmt->fetch();

    $stmt = $db->prepare("
        SELECT
            COALESCE(SUM(CASE WHEN b.appointment_date >= DATE_SUB(NOW(), INTERVAL 90 DAY) THEN t.amount_spent ELSE 0 END), 0) AS spend_last_90,
            COALESCE(SUM(CASE WHEN b.appointment_date < DATE_SUB(NOW(), INTERVAL 90 DAY)
                     AND b.appointment_date >= DATE_SUB(NOW(), INTERVAL 180 DAY) THEN t.amount_spent ELSE 0 END), 0) AS spend_prior_90
        FROM treatments t
        JOIN bookings b ON t.booking_id = b.booking_id
        JOIN treatment_status ts ON t.status_id = ts.status_id
        WHERE b.user_id = :user_id AND ts.status_name = 'Completed'
    ");
    $stmt->execute(['user_id' => $userId]);
    $windowSpend = $stmt->fetch();

    // ---- Exact feature contract the model expects ----
    $features = [
        "Gender" => $user['gender'],
        "Age" => $age,
        "Age_Group" => $ageGroup,
        "Preferred_Service_Category" => $preferredServiceCategory,
        "Visits_Last_90_Days_Before_Cutoff" => (int)$windowVisits['visits_last_90'],
        "Visits_Prior_90_Days_Before_That" => (int)$windowVisits['visits_prior_90'],
        "Spend_Last_90_Days_Before_Cutoff_LKR" => round((float)$windowSpend['spend_last_90'], 2),
        "Spend_Prior_90_Days_Before_That_LKR" => round((float)$windowSpend['spend_prior_90'], 2),
        "Avg_Visit_Interval_To_Date" => $avgVisitInterval,
        "Number_of_Unique_Services_To_Date" => $uniqueServices,
        "Number_of_Visits_To_Date" => $numberOfVisitsToDate,
        "Customer_Tenure_Days_At_Cutoff" => $customerTenureDays,
        "Days_Since_Last_Visit_At_Cutoff" => $daysSinceLastVisit
    ];

    return ['patient_name' => $user['name'], 'features' => $features];
}

function churn_call_model(array $features) {
    $ch = curl_init(CHURN_PREDICTION_API_URL);
    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_POST => true,
        CURLOPT_HTTPHEADER => ['Content-Type: application/json'],
        CURLOPT_POSTFIELDS => json_encode($features),
        CURLOPT_TIMEOUT => CHURN_PREDICTION_TIMEOUT_SECONDS,
        CURLOPT_CONNECTTIMEOUT => CHURN_PREDICTION_TIMEOUT_SECONDS,
    ]);
    $mlResponseRaw = curl_exec($ch);
    $curlErrno = curl_errno($ch);
    $curlError = curl_error($ch);
    $httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);

    if ($curlErrno !== 0) {
        throw new ChurnScoringException("Could not reach the churn prediction service at " . CHURN_PREDICTION_API_URL . " ($curlError). Check that the model server is running and the URL in config/MlConfig.php is correct.", 502);
    }

    $mlResponse = json_decode($mlResponseRaw, true);
    if (json_last_error() !== JSON_ERROR_NONE || !is_array($mlResponse)) {
        throw new ChurnScoringException("The churn prediction service returned an unexpected response (HTTP $httpCode).", 502);
    }

    if ($httpCode < 200 || $httpCode >= 300) {
        $msg = isset($mlResponse['message']) ? $mlResponse['message'] : "The churn prediction service returned HTTP $httpCode.";
        throw new ChurnScoringException($msg, 502);
    }

    return $mlResponse;
}