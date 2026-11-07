# Customer Churn Early-Warning System — Christell Luxury Wellness (Pvt) Ltd

Final year project, CS6P05ES, London Metropolitan University (ESOFT Metro Campus), 2026.
Author: D. P. N. M. Gunarathna. Supervisor: Ms. Karishani Bamunawita.

The system predicts which active clients of a wellness clinic are likely to make no visit in the next
90 days, shows each client's risk tier (High, Medium or Low) with a suggested action, and lets staff log
follow-up contacts and appointment outcomes so managers can review the effect in a retention report.

> **Data notice:** the model was trained and evaluated on **generated development data** shaped like the
> clinic's records. No real client data is included in this repository.

## Structure

| Folder | Contents |
| --- | --- |
| `frontend/` | Web console (HTML, CSS, JavaScript) with role-based pages for Front Desk and Manager/Admin |
| `php-backend/` | PHP API: sign-in, role checks, feature calculation, scoring runs, retention log, reports |
| `research_flask_api/` | Flask prediction service, saved model package, unit tests (`test_app.py`) |
| `notebook/` | Google Colab notebook: data preparation, model comparison, evaluation, SHAP, model export |
| `database/` | MariaDB schema (`christell_erp_schema.sql`, structure only) |
| `tests/` | Security test (`role_endpoint_tests.py`) and live parity test (`live_holdout_test.py`) |

## Architecture

```
Web console  ->  PHP API (sign-in, roles, 13 client fields)  ->  Flask /predict  ->  XGBoost pipeline
                     |
                 MariaDB (patients, bookings, treatments, scores, contacts, audit log)
```

## Running it locally (Windows)

1. **Web server and database:** install XAMPP (Apache, PHP 8.2, MariaDB 10.4). Copy `frontend/` and
   `php-backend/` into `C:\xampp\htdocs\`. In phpMyAdmin create a database `christell_erp`
   (`utf8mb4_general_ci`) and import `database/christell_erp_schema.sql`.
2. **Database login:** check `php-backend/config/Database.php` matches your local MariaDB user.
3. **Prediction service:**
   ```
   cd research_flask_api
   pip install -r requirements.txt
   python app.py
   ```
   The service listens on `http://127.0.0.1:5000` (`GET /health`, `POST /predict`).
4. Open `http://localhost/frontend/` and sign in with a staff account created in the `staff_accounts` table.

## Tests

| Test | Command | Result reported |
| --- | --- | --- |
| Unit tests | `cd research_flask_api` then `python -m pytest -v test_app.py` | 41 passed |
| Security and roles | `python tests/role_endpoint_tests.py` | 70/70 checks passed |
| Live parity | `cd research_flask_api` then `python ../tests/live_holdout_test.py http://127.0.0.1:5000/predict` | 397/397 within 0.0001 |

## Main results (holdout of 397 later records)

- XGBoost selected by five-fold cross-validation (average precision 0.564, ROC-AUC 0.852)
- Holdout ROC-AUC **0.778**, average precision **0.711**
- Actual churn by risk tier: High 65.2%, Medium 32.3%, Low 17.4%
