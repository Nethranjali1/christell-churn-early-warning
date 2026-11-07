# Customer Churn Early-Warning API

Simple Flask wrapper around the XGBoost model from
`final_customer_churn_early_warning_system.ipynb`.

## Model recap
- **Algorithm**: XGBoost (won a 5-fold CV comparison against Logistic Regression and Random Forest).
- **Pipeline**: `ColumnTransformer` (StandardScaler on numeric columns, OneHotEncoder on categorical columns) → `SMOTE` → `XGBClassifier`, all saved as one sklearn/imblearn `Pipeline` object.
- **Artifact**: `churn_early_warning_model.joblib`, a dict with the pipeline plus metadata (feature list, risk thresholds `High ≥ 0.55` / `Medium ≥ 0.35`, model version, holdout metrics).
- **Leakage guard**: `Days_Since_Last_Visit_At_Cutoff` is deliberately excluded from the model's features. It's only used as a business rule — customers with recency ≥ 90 days are already inactive/churned and are not scored.

## Setup

```bash
pip install -r requirements.txt

# Put the trained model file (produced by cell 24 of the notebook) next to app.py,
# or point to it explicitly:
export MODEL_PATH=/path/to/churn_early_warning_model.joblib

python app.py
```

Server runs at `http://localhost:5000`.

**`Spend_Trend_Ratio_Capped`** uses the exact training value of the 99th-percentile cap (`SPEND_TREND_RATIO_CAP = 90025.654`, printed by notebook cell 12). It can be overridden with the `SPEND_TREND_RATIO_CAP` environment variable, but must equal the value the deployed model was trained with. A live test of all 397 holdout rows confirmed the service matches the saved model's predictions.

**Input validation:** `/predict` requires all 13 fields, including `Days_Since_Last_Visit_At_Cutoff`; numbers must be non-negative and text fields must be values the model was trained on, otherwise the request is rejected with HTTP 400.

**Debug mode** is off by default; set `FLASK_DEBUG=1` only on a development machine.

## Endpoints

### `GET /health`
Checks the model package loads correctly, has the expected keys, the leakage guard holds,
and the pipeline can score a synthetic sample row.

```bash
curl http://localhost:5000/health
```

```json
{
  "status": "healthy",
  "model_name": "XGBoost",
  "model_version": "v2.0.0-early-warning-no-leakage",
  "n_features": 19,
  "risk_thresholds": {"high": 0.55, "medium": 0.35},
  "sample_prediction_ok": true
}
```

### `POST /predict`
Scores one active customer.

```bash
curl -X POST http://localhost:5000/predict \
  -H "Content-Type: application/json" \
  -d '{
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
  }'
```

```json
{
  "eligible": true,
  "churn_probability": 0.62,
  "risk_tier": "High",
  "recommended_action": "Immediate personal outreach + strong retention offer",
  "model_version": "v2.0.0-early-warning-no-leakage"
}
```

If `Days_Since_Last_Visit_At_Cutoff >= 90`, the response instead is:

```json
{
  "eligible": false,
  "reason": "Customer is not currently active (recency >= 90 days) -- already churned, not an early-warning candidate."
}
```

Missing required fields return HTTP 400 with a `missing_fields` list.

## Notes
- Tested end-to-end with a structurally-identical stub model (same pipeline shape,
  package keys, and feature-engineering logic) — both endpoints, the inactive-customer
  rule, and input validation all behaved as expected.
- This is a dev server (`debug=True`, Flask's built-in server). For production, run behind
  gunicorn/uwsgi, e.g. `gunicorn -w 2 -b 0.0.0.0:5000 app:app`, and set `debug=False`.
