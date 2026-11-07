/**
 * ============================================================
 *  CHRISTELL WELLNESS — API CONFIGURATION
 * ------------------------------------------------------------
 *  This is the ONLY place you should need to touch when your
 *  local PHP server's IP/port/path changes. Update API_BASE_URL
 *  below and every page picks it up automatically.
 *
 *  Example values while developing locally:
 *    "http://localhost/php-backend/api"
 *    "http://127.0.0.1:8000/api"
 *    "http://192.168.1.42/christell/php-backend/api"
 * ============================================================
 */
const API_BASE_URL = "http://localhost/php-backend/api";

const API_ENDPOINTS = Object.freeze({
  LOGIN: `${API_BASE_URL}/login.php`,
  DASHBOARD_STATS: `${API_BASE_URL}/get_dashboard_stats.php`,
  USERS: `${API_BASE_URL}/get_users.php`,
  USER_DETAILS: `${API_BASE_URL}/get_user_details.php`,
  BOOKINGS: `${API_BASE_URL}/get_bookings.php`,
  DOCTORS: `${API_BASE_URL}/get_doctors.php`,
  META: `${API_BASE_URL}/get_meta.php`,
  EARLY_WARNING_FEATURES: `${API_BASE_URL}/get_early_warning_features.php`,
  PREDICT_CHURN: `${API_BASE_URL}/predict_churn.php`,
});

// Local storage keys (kept in one place so pages stay in sync)
const STORAGE_KEYS = Object.freeze({
  TOKEN: "christell_token",
  ADMIN: "christell_admin",
});
