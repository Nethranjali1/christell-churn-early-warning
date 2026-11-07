"""
Customer Churn Early-Warning API
=================================
Two simple endpoints built around the model trained in
`final_customer_churn_early_warning_system.ipynb`:

  GET  /health   -> checks the saved model package loads and can score a
                     dummy row (mirrors the notebook's own health_check()).
  POST /predict  -> scores one active customer and returns churn
                     probability + risk tier + recommended action
                     (mirrors the notebook's predict_early_warning()).

Model summary (from the notebook)
----------------------------------
- Algorithm : XGBoost classifier, chosen after comparing Logistic
              Regression / Random Forest / XGBoost via 5-fold CV.
- Pipeline  : ColumnTransformer(StandardScaler on numeric cols,
              OneHotEncoder on categorical cols) -> SMOTE -> XGBClassifier
              (all bundled as a single sklearn/imblearn Pipeline object).
- Artifact  : a joblib-pickled dict ("model_package") with keys:
              pipeline, feature_columns, categorical_columns,
              numerical_columns, excluded_columns, model_name,
              model_version, training_date, chronological_split_date,
              risk_thresholds, metrics, active_customer_rule.
- Leakage guard: "Days_Since_Last_Visit_At_Cutoff" is deliberately EXCLUDED
              from model features. It is only used as a business rule to
              decide whether a customer is "active" (eligible to be scored).

Run:
    pip install -r requirements.txt
    export MODEL_PATH=/path/to/churn_early_warning_model.joblib   # optional
    python app.py
"""

import os
import datetime
import math

import joblib
import numpy as np
import pandas as pd
from flask import Flask, jsonify, request

app = Flask(__name__)

# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------

MODEL_PATH = os.environ.get("MODEL_PATH", "churn_early_warning_model.joblib")

# EPS: same additive smoothing constant used in the notebook's feature
# engineering (cell 12), applied consistently across all ratio features.
EPS = 1

# Spend_Trend_Ratio cap: the exact 99th-percentile value printed by the
# training notebook (cell 12, cap_value). It must equal the value the deployed
# model was trained with, otherwise live predictions drift from the validated
# model. The notebook computed it over all 1,998 snapshots; a training-only cap
# (93,587.83) clips the same 2 of 397 holdout rows (see report).
SPEND_TREND_RATIO_CAP = float(os.environ.get("SPEND_TREND_RATIO_CAP", 90025.65399999994))

# Raw fields the caller must supply for every prediction request.
REQUIRED_RAW_FIELDS = [
    "Gender",
    "Age",
    "Age_Group",
    "Preferred_Service_Category",
    "Visits_Last_90_Days_Before_Cutoff",
    "Visits_Prior_90_Days_Before_That",
    "Spend_Last_90_Days_Before_Cutoff_LKR",
    "Spend_Prior_90_Days_Before_That_LKR",
    "Avg_Visit_Interval_To_Date",
    "Number_of_Unique_Services_To_Date",
    "Number_of_Visits_To_Date",
    "Customer_Tenure_Days_At_Cutoff",
]

# Not a model feature -- only used for the active-customer eligibility rule.
RECENCY_FIELD = "Days_Since_Last_Visit_At_Cutoff"

RISK_ACTIONS = {
    "High": "Immediate personal outreach + strong retention offer",
    "Medium": "Automated re-engagement email / reminder",
    "Low": "No action needed",
}

# ---------------------------------------------------------------------------
# Model loading
# ---------------------------------------------------------------------------

_model_package = None
_load_error = None


def load_model():
    """Load the joblib model package once at startup (cached globally)."""
    global _model_package, _load_error
    try:
        pkg = joblib.load(MODEL_PATH)
        required_keys = ["pipeline", "feature_columns", "model_version", "excluded_columns"]
        for k in required_keys:
            if k not in pkg:
                raise ValueError(f"Missing key in model package: {k}")
        if RECENCY_FIELD in pkg["feature_columns"]:
            raise ValueError("LEAKAGE GUARD FAILED: recency field is present in feature_columns")
        _model_package = pkg
        _load_error = None
    except Exception as e:  # noqa: BLE001
        _model_package = None
        _load_error = str(e)


load_model()


# ---------------------------------------------------------------------------
# Feature engineering (must mirror notebook cell 12 exactly)
# ---------------------------------------------------------------------------

def engineer_features(row: dict) -> dict:
    row = dict(row)  # copy

    visits_last = row["Visits_Last_90_Days_Before_Cutoff"]
    visits_prior = row["Visits_Prior_90_Days_Before_That"]
    spend_last = row["Spend_Last_90_Days_Before_Cutoff_LKR"]
    spend_prior = row["Spend_Prior_90_Days_Before_That_LKR"]
    n_unique_services = row["Number_of_Unique_Services_To_Date"]
    n_visits_to_date = row["Number_of_Visits_To_Date"]
    tenure_days = row["Customer_Tenure_Days_At_Cutoff"]

    row["Visit_Trend_Ratio"] = (visits_last + EPS) / (visits_prior + EPS)
    row["Visit_Trend_Delta"] = visits_last - visits_prior

    raw_spend_trend_ratio = (spend_last + EPS) / (spend_prior + EPS)
    row["Spend_Trend_Ratio_Capped"] = min(raw_spend_trend_ratio, SPEND_TREND_RATIO_CAP)

    row["Spend_per_Visit_Last90"] = spend_last / visits_last if visits_last != 0 else 0.0
    row["Spend_per_Visit_Prior90"] = spend_prior / (visits_prior + EPS)

    row["Service_Diversity_Ratio"] = (
        n_unique_services / n_visits_to_date if n_visits_to_date != 0 else 0.0
    )
    row["Visits_Per_90D_Tenure"] = (
        n_visits_to_date / (tenure_days / 90) if tenure_days != 0 else 0.0
    )

    return row


TEXT_FIELDS = ["Gender", "Age_Group", "Preferred_Service_Category"]


def known_categories(pkg: dict) -> dict:
    """Text values the model was trained on, per field (empty if they cannot be read)."""
    try:
        encoder = pkg["pipeline"].named_steps["preprocess"].named_transformers_["cat"]
        return {col: {str(v) for v in values}
                for col, values in zip(pkg["categorical_columns"], encoder.categories_)}
    except Exception:  # noqa: BLE001
        return {}


def validate_payload(payload: dict, pkg: dict) -> list:
    """Return a list of problems with a /predict request (empty when it is valid)."""
    problems = []
    categories = known_categories(pkg)
    for field in REQUIRED_RAW_FIELDS + [RECENCY_FIELD]:
        value = payload[field]
        if field in TEXT_FIELDS:
            if not isinstance(value, str) or not value.strip():
                problems.append(f"{field} must be non-empty text")
            elif field in categories and value not in categories[field]:
                problems.append(f"{field} has a value the model does not know: {value!r}")
        elif isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value):
            problems.append(f"{field} must be a number")
        elif value < 0:
            problems.append(f"{field} must not be negative")
    return problems


def assign_risk_tier(proba: float, thresholds: dict) -> str:
    if proba >= thresholds["high"]:
        return "High"
    elif proba >= thresholds["medium"]:
        return "Medium"
    return "Low"


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------

@app.route("/health", methods=["GET"])
def health():
    """
    Model health check.
    Mirrors the notebook's health_check(): confirms the package loaded,
    has the expected keys, the leakage guard holds, and the pipeline can
    produce a valid probability on a synthetic sample row.
    """
    if _model_package is None:
        return jsonify({
            "status": "unhealthy",
            "error": _load_error or "Model not loaded",
        }), 503

    pkg = _model_package
    try:
        # Build one synthetic but well-formed row to prove the pipeline runs.
        dummy_raw = {
            "Gender": "Female",
            "Age": 30,
            "Age_Group": "25-34",
            "Preferred_Service_Category": pkg["categorical_columns"] and "Skin Rejuvenation",
            "Visits_Last_90_Days_Before_Cutoff": 2,
            "Visits_Prior_90_Days_Before_That": 2,
            "Spend_Last_90_Days_Before_Cutoff_LKR": 20000,
            "Spend_Prior_90_Days_Before_That_LKR": 20000,
            "Avg_Visit_Interval_To_Date": 45.0,
            "Number_of_Unique_Services_To_Date": 3,
            "Number_of_Visits_To_Date": 6,
            "Customer_Tenure_Days_At_Cutoff": 200,
        }
        engineered = engineer_features(dummy_raw)
        sample_df = pd.DataFrame([engineered])[pkg["feature_columns"]]
        proba = pkg["pipeline"].predict_proba(sample_df)[:, 1][0]
        assert 0 <= proba <= 1

        return jsonify({
            "status": "healthy",
            "model_name": pkg.get("model_name"),
            "model_version": pkg["model_version"],
            "training_date": pkg.get("training_date"),
            "n_features": len(pkg["feature_columns"]),
            "risk_thresholds": pkg.get("risk_thresholds"),
            "sample_prediction_ok": True,
            "checked_at": datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.%fZ"),
        }), 200

    except Exception as e:  # noqa: BLE001
        return jsonify({"status": "unhealthy", "error": str(e)}), 503


@app.route("/predict", methods=["POST"])
def predict():
    """
    Score a single active customer.

    Expected JSON body: all fields in REQUIRED_RAW_FIELDS plus
    "Days_Since_Last_Visit_At_Cutoff" (required), which enforces the
    active-customer business rule (>=90 days recency => not scored).
    Invalid or unknown values are rejected with HTTP 400.

    Example:
    {
        "Gender": "Male",
        "Age": 47,
        "Age_Group": "45-54",
        "Preferred_Service_Category": "Laser / Hair Removal",
        "Visits_Last_90_Days_Before_Cutoff": 1,
        "Visits_Prior_90_Days_Before_That": 4,
        "Spend_Last_90_Days_Before_Cutoff_LKR": 9000,
        "Spend_Prior_90_Days_Before_That_LKR": 70000,
        "Avg_Visit_Interval_To_Date": 65.0,
        "Number_of_Unique_Services_To_Date": 2,
        "Number_of_Visits_To_Date": 8,
        "Customer_Tenure_Days_At_Cutoff": 300,
        "Days_Since_Last_Visit_At_Cutoff": 40
    }
    """
    if _model_package is None:
        return jsonify({"error": "Model not loaded", "detail": _load_error}), 503

    payload = request.get_json(silent=True)
    if not isinstance(payload, dict) or not payload:
        return jsonify({"error": "Request body must be a JSON object"}), 400

    missing = [f for f in REQUIRED_RAW_FIELDS + [RECENCY_FIELD] if f not in payload]
    if missing:
        return jsonify({"error": "Missing required fields", "missing_fields": missing}), 400

    problems = validate_payload(payload, _model_package)
    if problems:
        return jsonify({"error": "Invalid input", "invalid_fields": problems}), 400

    pkg = _model_package
    days_since_last_visit = payload.get(RECENCY_FIELD)

    # Business rule: only currently-active customers are eligible.
    if days_since_last_visit is not None and days_since_last_visit >= 90:
        return jsonify({
            "eligible": False,
            "reason": (
                "Customer is not currently active (recency >= 90 days) -- "
                "already churned, not an early-warning candidate."
            ),
        }), 200

    try:
        raw_row = {f: payload[f] for f in REQUIRED_RAW_FIELDS}
        engineered = engineer_features(raw_row)
        X_sample = pd.DataFrame([engineered])[pkg["feature_columns"]]

        proba = float(pkg["pipeline"].predict_proba(X_sample)[:, 1][0])
        tier = assign_risk_tier(proba, pkg["risk_thresholds"])

        return jsonify({
            "eligible": True,
            "churn_probability": round(proba, 4),
            "risk_tier": tier,
            "recommended_action": RISK_ACTIONS[tier],
            "model_version": pkg["model_version"],
        }), 200

    except KeyError as e:
        return jsonify({"error": f"Invalid input: missing/unexpected field {e}"}), 400
    except Exception as e:  # noqa: BLE001
        app.logger.exception("Prediction failed")
        return jsonify({"error": "Prediction failed"}), 500


if __name__ == "__main__":
    # Debug mode exposes an interactive debugger, so it is off unless FLASK_DEBUG=1 is set.
    app.run(host="0.0.0.0", port=5000, debug=os.environ.get("FLASK_DEBUG") == "1")
