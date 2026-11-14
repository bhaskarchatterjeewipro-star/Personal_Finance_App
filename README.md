# Paisa

Paisa is a private, mobile-friendly personal finance tracker for keeping tabs on income, expenses, budgets, and savings. It runs in your browser and works offline after its first load.

## Highlights

- **Understand your finances:** monthly income and expense summaries, carried-forward net savings, spending breakdowns, a six-month trend, and recent activity.
- **Track transactions:** add, edit, delete, search, and filter by date, category, or account.
- **Plan ahead:** monthly overall and category budgets, spending alerts at 80% and 100%, savings goals, and recurring entries.
- **Bring your data:** import and export transactions as CSV, or create and restore a full JSON backup.
- **Make it yours:** custom categories, light and dark themes, and configurable currency and locale.
- **Keep it private:** there is no account or backend. Financial records are stored in the browser's IndexedDB database; preferences are stored in local storage.

Paisa does not send financial data to a server. Cross-device sync and UPI alert parsing are not included. Clearing browser storage deletes data saved on that device, so keep regular backups.

## Run locally

No build step, package installation, or third-party runtime dependency is needed. Serve the project over localhost or HTTPS; service workers are not available when opening `index.html` directly as a `file://` URL.

### Windows

Run `run-server.bat`, choose **Start server**, and open [http://localhost:8000](http://localhost:8000). Choose **Stop server** in the script to stop the server on port 8000.

### Any platform with Python

From the project directory, run:

```powershell
python -m http.server 8000
```

Then open [http://localhost:8000](http://localhost:8000). Press `Ctrl+C` in the terminal to stop the server.

Local runs clear Paisa's service-worker cache to avoid stale pages. Hosted HTTPS runs retain offline support.

## Project layout

| Path | Purpose |
| --- | --- |
| `index.html` | App shell, navigation, and dialogs |
| `css/style.css` | Responsive layout and themes |
| `js/app.js` | App startup, state, and interaction wiring |
| `js/db.js` | IndexedDB persistence |
| `js/ui*.js` | Dashboard and view rendering |
| `js/forms.js` | Budget, goal, and recurring-entry forms |
| `js/backup.js` | CSV import/export and JSON backup/restore |
| `js/utils.js` | Shared formatting, calculations, and CSV utilities |
| `manifest.json`, `sw.js`, `icon.svg` | Installable app metadata, offline shell, and icon |
| `run-server.bat` | Windows local server helper |
