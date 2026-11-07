"""
Unit and API tests for the churn early-warning Flask service (app.py).

Run from the folder that contains app.py and churn_early_warning_model.joblib:
    pip install pytest
    python -m pytest -v test_app.py

Tests marked "xfail" record known input-validation defects found by this suite.
They are reported as XFAIL (expected failure) until the defect is fixed; once it is
fixed they show as XPASS and fail the run (strict), as a reminder to remove the marker.

Optional: copy holdout_for_live_test.csv next to this file to also run the
397-row parity test against the saved model's own probabilities.
"""
import math
import os
import warnings

import pytest

warnings.filterwarnings("ignore")
HERE = os.path.dirname(os.path.abspath(__file__))
os.environ.setdefault("MODEL_PATH", os.path.join(HERE, "churn_early_warning_model.joblib"))

import app as svc  # noqa: E402

EXPECTED_CAP = 90025.65399999994

# Customer 177 (holdout snapshot 2025-08-16): zero prior spend, so the spend-trend cap matters.
# The saved model gives 0.702078; the old placeholder cap of 10 gave 0.6884 in the live test.
CUSTOMER_177 = {
    "Gender": "Female", "Age": 38, "Age_Group": "35-44",
    "Preferred_Service_Category": "Injectables / Fillers",
    "Visits_Last_90_Days_Before_Cutoff": 1, "Visits_Prior_90_Days_Before_That": 0,
    "Spend_Last_90_Days_Before_Cutoff_LKR": 57988.81, "Spend_Prior_90_Days_Before_That_LKR": 0.0,
    "Avg_Visit_Interval_To_Date": 64.0, "Number_of_Unique_Services_To_Date": 3,
    "Number_of_Visits_To_Date": 8, "Customer_Tenure_Days_At_Cutoff": 521,
    "Days_Since_Last_Visit_At_Cutoff": 71,
}


def raw(**overrides):
    """A valid raw request, with chosen fields changed."""
    row = {
        "Gender": "Male", "Age": 47, "Age_Group": "45-54",
        "Preferred_Service_Category": "Laser / Hair Removal",
        "Visits_Last_90_Days_Before_Cutoff": 1, "Visits_Prior_90_Days_Before_That": 4,
        "Spend_Last_90_Days_Before_Cutoff_LKR": 9000, "Spend_Prior_90_Days_Before_That_LKR": 70000,
        "Avg_Visit_Interval_To_Date": 65.0, "Number_of_Unique_Services_To_Date": 2,
        "Number_of_Visits_To_Date": 8, "Customer_Tenure_Days_At_Cutoff": 300,
        "Days_Since_Last_Visit_At_Cutoff": 40,
    }
    row.update(overrides)
    return row


@pytest.fixture(scope="module")
def client():
    assert svc._model_package is not None, f"Model did not load: {svc._load_error}"
    return svc.app.test_client()


# ============================================================ 1. Feature engineering
class TestFeatureEngineering:
    def test_visit_trend_ratio_and_delta(self):
        f = svc.engineer_features(raw(Visits_Last_90_Days_Before_Cutoff=3, Visits_Prior_90_Days_Before_That=1))
        assert f["Visit_Trend_Ratio"] == pytest.approx((3 + 1) / (1 + 1))   # 2.0
        assert f["Visit_Trend_Delta"] == 2

    def test_spend_trend_ratio_normal_case(self):
        f = svc.engineer_features(raw())
        assert f["Spend_Trend_Ratio_Capped"] == pytest.approx((9000 + 1) / (70000 + 1))

    def test_cap_constant_matches_training_value(self):
        assert svc.SPEND_TREND_RATIO_CAP == pytest.approx(EXPECTED_CAP, abs=1e-6)

    def test_cap_applied_when_ratio_exceeds_it(self):
        f = svc.engineer_features(raw(Spend_Last_90_Days_Before_Cutoff_LKR=200000,
                                      Spend_Prior_90_Days_Before_That_LKR=0))
        assert f["Spend_Trend_Ratio_Capped"] == pytest.approx(EXPECTED_CAP)

    def test_large_ratio_below_cap_is_not_clipped(self):
        f = svc.engineer_features(CUSTOMER_177)
        assert f["Spend_Trend_Ratio_Capped"] == pytest.approx(57988.81 + 1)

    def test_spend_per_visit_last90(self):
        assert svc.engineer_features(raw())["Spend_per_Visit_Last90"] == pytest.approx(9000 / 1)

    def test_spend_per_visit_last90_zero_visits_gives_zero(self):
        f = svc.engineer_features(raw(Visits_Last_90_Days_Before_Cutoff=0))
        assert f["Spend_per_Visit_Last90"] == 0.0

    def test_spend_per_visit_prior90_uses_smoothing(self):
        assert svc.engineer_features(raw())["Spend_per_Visit_Prior90"] == pytest.approx(70000 / (4 + 1))

    def test_service_diversity_ratio(self):
        assert svc.engineer_features(raw())["Service_Diversity_Ratio"] == pytest.approx(2 / 8)

    def test_service_diversity_zero_visits_gives_zero(self):
        assert svc.engineer_features(raw(Number_of_Visits_To_Date=0))["Service_Diversity_Ratio"] == 0.0

    def test_visits_per_90d_tenure(self):
        assert svc.engineer_features(raw())["Visits_Per_90D_Tenure"] == pytest.approx(8 / (300 / 90))

    def test_visits_per_90d_zero_tenure_gives_zero(self):
        assert svc.engineer_features(raw(Customer_Tenure_Days_At_Cutoff=0))["Visits_Per_90D_Tenure"] == 0.0

    def test_input_row_is_not_modified(self):
        row = raw()
        before = dict(row)
        svc.engineer_features(row)
        assert row == before

    def test_output_has_every_model_feature(self):
        f = svc.engineer_features(raw())
        missing = [c for c in svc._model_package["feature_columns"] if c not in f]
        assert missing == []


# ============================================================ 2. Risk tiers
class TestRiskTiers:
    T = {"high": 0.55, "medium": 0.35}

    @pytest.mark.parametrize("p, tier", [
        (0.99, "High"), (0.55, "High"), (0.5499, "Medium"),
        (0.35, "Medium"), (0.3499, "Low"), (0.0, "Low"),
    ])
    def test_tier_boundaries(self, p, tier):
        assert svc.assign_risk_tier(p, self.T) == tier


# ============================================================ 3. Model package
class TestModelPackage:
    def test_package_loaded(self):
        assert svc._model_package is not None, svc._load_error

    def test_version_and_thresholds(self):
        pkg = svc._model_package
        assert pkg["model_version"] == "v2.0.0-early-warning-no-leakage"
        assert pkg["risk_thresholds"] == {"high": 0.55, "medium": 0.35}

    def test_leakage_guard_recency_not_a_feature(self):
        assert svc.RECENCY_FIELD not in svc._model_package["feature_columns"]

    def test_feature_count(self):
        assert len(svc._model_package["feature_columns"]) == 19


# ============================================================ 4. API endpoints
class TestEndpoints:
    def test_health(self, client):
        r = client.get("/health")
        assert r.status_code == 200
        assert r.get_json()["status"] == "healthy"

    def test_predict_valid_request(self, client):
        r = client.post("/predict", json=raw())
        body = r.get_json()
        assert r.status_code == 200
        assert body["eligible"] is True
        assert 0.0 <= body["churn_probability"] <= 1.0
        assert body["risk_tier"] == svc.assign_risk_tier(body["churn_probability"], svc._model_package["risk_thresholds"])
        assert body["recommended_action"] == svc.RISK_ACTIONS[body["risk_tier"]]

    def test_predict_is_deterministic(self, client):
        a = client.post("/predict", json=raw()).get_json()
        b = client.post("/predict", json=raw()).get_json()
        assert a == b

    def test_regression_customer_177_matches_saved_model(self, client):
        body = client.post("/predict", json=CUSTOMER_177).get_json()
        assert body["churn_probability"] == pytest.approx(0.702078, abs=1e-4)
        assert body["risk_tier"] == "High"

    def test_regression_placeholder_cap_would_be_detected(self, client, monkeypatch):
        """The original bug: with the placeholder cap of 10 the prediction drifts to 0.6884."""
        monkeypatch.setattr(svc, "SPEND_TREND_RATIO_CAP", 10.0)
        body = client.post("/predict", json=CUSTOMER_177).get_json()
        assert body["churn_probability"] == pytest.approx(0.6884, abs=1e-4)
        assert abs(body["churn_probability"] - 0.702078) > 1e-3

    def test_active_rule_recency_90_not_scored(self, client):
        body = client.post("/predict", json=raw(Days_Since_Last_Visit_At_Cutoff=90)).get_json()
        assert body["eligible"] is False
        assert "churn_probability" not in body

    def test_active_rule_recency_89_scored(self, client):
        assert client.post("/predict", json=raw(Days_Since_Last_Visit_At_Cutoff=89)).get_json()["eligible"] is True

    def test_missing_field_rejected_and_named(self, client):
        body = raw()
        del body["Age"]
        r = client.post("/predict", json=body)
        assert r.status_code == 400
        assert r.get_json()["missing_fields"] == ["Age"]

    def test_empty_body_rejected(self, client):
        assert client.post("/predict", json={}).status_code == 400

    def test_non_json_body_rejected(self, client):
        assert client.post("/predict", data="not json", content_type="text/plain").status_code == 400


# ============================================================ 5. Input validation (defects found and fixed)
# Found by this suite. Impact is limited because the PHP backend is the only caller and builds
# every request from the database, but the service should reject bad input with HTTP 400.
KNOWN = "Known defect: input not validated (fix after UAT)"


class TestKnownValidationDefects:
    def test_text_in_numeric_field_gives_400(self, client):
        assert client.post("/predict", json=raw(Visits_Last_90_Days_Before_Cutoff="two")).status_code == 400

    def test_text_recency_gives_400(self, client):
        assert client.post("/predict", json=raw(Days_Since_Last_Visit_At_Cutoff="40")).status_code == 400

    def test_negative_visits_gives_400(self, client):
        assert client.post("/predict", json=raw(Visits_Last_90_Days_Before_Cutoff=-3)).status_code == 400

    def test_unknown_gender_gives_400(self, client):
        assert client.post("/predict", json=raw(Gender="Unknown")).status_code == 400

    def test_null_age_gives_400(self, client):
        assert client.post("/predict", json=raw(Age=None)).status_code == 400

    def test_missing_recency_gives_400(self, client):
        body = raw()
        del body["Days_Since_Last_Visit_At_Cutoff"]
        assert client.post("/predict", json=body).status_code == 400


# ============================================================ 6. Holdout parity (optional)
HOLDOUT = os.path.join(HERE, "holdout_for_live_test.csv")


@pytest.mark.skipif(not os.path.exists(HOLDOUT), reason="holdout_for_live_test.csv not next to this file")
def test_holdout_parity_all_rows(client):
    import csv
    text_fields = {"Gender", "Age_Group", "Preferred_Service_Category"}
    worst, n = 0.0, 0
    with open(HOLDOUT, newline="", encoding="utf-8") as f:
        for row in csv.DictReader(f):
            body = {k: (row[k] if k in text_fields else float(row[k]))
                    for k in svc.REQUIRED_RAW_FIELDS + [svc.RECENCY_FIELD]}
            got = client.post("/predict", json=body).get_json()["churn_probability"]
            worst = max(worst, abs(got - float(row["expected_probability"])))
            n += 1
    assert n == 397
    assert worst <= 5e-5 + 1e-9, f"max difference {worst}"
