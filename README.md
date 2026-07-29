# PEA Solar DocTrack (Static)

Standalone static frontend for **PEA Solar DocTrack** — GitHub Pages compatible.  
Visual/behavior reference: GAS mockup (กขท. upload · กธพ. review).

## Production vs demo

| | GitHub Pages (this repo) | GAS Web App |
|--|--------------------------|-------------|
| Purpose | **Demo** — all UI states in localStorage | **Production** — Spreadsheet + Drive/Graph + email |
| Login | Employee ID demo cards | Google Workspace + optional demo IDs |

See parent folder `README.md` for GAS production setup.

## Demo accounts

| Employee ID | Role |
|-------------|------|
| `KHT001` / `KHT002` / `KHT003` | กขท. |
| `GTHP001` / `GTHP002` | กธพ. |
| `OLD001` | Inactive (user management) |

Seed covers `Draft`, `Submitted`, `NeedsRevision`, `Completed`, multi-site waterworks project, file version history, comments, notifications, audit logs, and email prefs.

SharePoint folder (mock open URL):  
https://pea365-my.sharepoint.com/:f:/g/personal/pojsawat_suk_pea_co_th/IgAqKwm-hbKbQLLOryXzeVvTAfWd3AzgEeKmd7-4n7w93Ww?e=ezedia

## Structure

```
index.html           # entry (no GAS template tags)
assets/styles.css    # PEA purple–gold responsive UI
assets/mock-api.js   # localStorage mock API + seed
assets/app.js        # SPA client (no google.script.run)
scripts/validate.js  # Node syntax + seed/API smoke checks
package.json
```

## Run locally

```bash
# Option A — any static server
npx --yes serve .

# Option B — Python
python -m http.server 8080
```

Open `http://localhost:3000` (or 8080) and sign in with `KHT001` or `GTHP001`.

## GitHub Pages

1. Push this repo to GitHub  
2. Settings → Pages → Deploy from branch (`main` / root)  
3. Open `https://<user>.github.io/<repo>/`

`index.html` loads relative `assets/*` paths — no build step.

## Data persistence

- All mutations persist in **browser localStorage** (`pea_doctrack_mock_db`)
- Sessions: `pea_doctrack_mock_sessions` + token `pea_doctrack_token`
- **GTHP → Settings → รีเซ็ตข้อมูลทั้งหมด** restores the comprehensive seed

## Validate

```bash
npm test
```

Checks file layout, JS syntax (`node --check`), seed completeness, and a mini KHT→GTHP workflow against the mock API (via `node --experimental-vm-modules` / vm sandbox).

## Workflow

```
KHT: contract / project / sites → upload (reason on replace) → submit when required complete
GTHP: comment / request revision / accept
→ Notifications + AuditLogs
```
