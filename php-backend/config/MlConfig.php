<?php
/**
 * Churn-prediction ML microservice configuration.
 *
 * This points at the separate Flask/ML server that runs the early-warning
 * churn model (NOT the christell_erp PHP/MySQL backend). Update this whenever
 * that service's host/IP/port changes on your local network.
 */
define('CHURN_PREDICTION_API_URL', ' http://192.168.8.102:5000/predict');

// How long (seconds) to wait for the ML service before giving up.
define('CHURN_PREDICTION_TIMEOUT_SECONDS', 8);
