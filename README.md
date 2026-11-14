# Paisa

A private, mobile-friendly personal finance tracker. Paisa has no account or backend: transactions are stored in this browser using IndexedDB, and preferences use local storage.

## Run locally

Serve this folder over localhost or HTTPS (service workers are not available from `file://`). For example, with Python installed:

```powershell
python -m http.server 8000
```

Then open `http://localhost:8000`. The app has no build step or third-party runtime dependencies.
On Windows, run `run-server.bat` and choose Start or Stop to manage the local server. Local runs clear Paisa's service-worker cache to avoid stale pages; hosted HTTPS runs retain offline support.

## Included

- Income and expense tracking with add, edit, delete, category, account, date, and note
- Monthly dashboard with income, expense, carried-forward net savings, spending breakdown, six-month trend, and recent activity
- Monthly overall and category budgets; category allocations cannot exceed the overall limit, with 80% and 100% spending warnings
- Search and date, category, and account filters
- CSV transaction import with column mapping and duplicate detection; CSV export
- JSON backup and restore, custom categories, a single Main Bank account, recurring entries, and savings goals
- Light/dark theme, configurable currency and locale, installable offline shell, and backup reminders

All records stay on the device unless you explicitly export them. Keep regular backups: clearing browser storage deletes this device’s data.

Encrypted cross-device GitHub sync and UPI alert parsing are not included in this local-first version; no sync token or financial data is sent to a server.
