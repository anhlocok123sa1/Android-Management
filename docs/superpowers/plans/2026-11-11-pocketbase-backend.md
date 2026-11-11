# PocketBase Backend Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Create an isolated branch `feat/pocketbase` and implement a self-hosted PocketBase backend replacing Google Sheets, providing <30ms response times, real-time SSE updates, and full backward compatibility with Android Box field devices.

**Architecture:** A standalone `pocketbase.exe` binary serves SQLite collections (`devices`, `tasks`, `templates`, `heartbeats`) over REST API. A PocketBase JavaScript hook (`pb_hooks/legacy_compat.pb.js`) provides drop-in compatibility for existing Android agents calling legacy Google Apps Script webhook actions. The Web UI (`web/app.js`) connects to PocketBase with Server-Sent Events (SSE) for instant live updates. A 1-click startup script (`CHAY_POCKETBASE.bat`) orchestrates PocketBase, Cloudflare Quick Tunnel (`cloudflared.exe`), and initial setup.

**Tech Stack:** PocketBase v0.24+ (Windows amd64, Go/SQLite), Python 3.13 (`urllib`/`requests`, `unittest`), Vanilla JavaScript (ES6, Fetch, EventSource), Cloudflare Tunnel (`cloudflared`).

**Spec:** [`docs/superpowers/specs/2026-11-11-pocketbase-backend-design.md`](file:///d:/Code/AndroidProject/docs/superpowers/specs/2026-11-11-pocketbase-backend-design.md)

## Global Constraints
- **Isolation:** All work must take place on a dedicated Git branch `feat/pocketbase`; `main` (Google Sheets backend) must remain completely untouched.
- **Portability:** PocketBase runs as a zero-dependency standalone binary (`pocketbase.exe`) on Windows; no Docker, Node.js, or complex database installations required.
- **Security:** Administrative operations (`create_task`, `assign_project`, `save_template`) require authentication via Secret Header (`X-SGL-Secret`) or Admin Token; public access cannot execute arbitrary root commands.
- **Data Safety:** `pb_data/` (SQLite database directory) must be added to `.gitignore` to prevent committing live databases or secret credentials to Git.
- **Dual Support:** Web app and Python client must support a toggle between `pocketbase` and `google_sheets` modes for seamless rollback.

## Review Focus
1. **PocketBase Binary Fetch Failure:** Network timeout or architecture mismatch when downloading `pocketbase.exe`. Ensure PowerShell download script validates checksum/file size and falls back gracefully.
2. **Missing Collections on Cold Start:** First run of PocketBase starts with empty database. Ensure setup script runs idempotent schema initialization on startup.
3. **Legacy Webhook Payload Compatibility:** Android box sending legacy POST `{ action: "heartbeat", mac: "..." }` fails if hook does not handle urlencoded or raw JSON. Ensure hook handles both `application/json` and `application/x-www-form-urlencoded`.
4. **Cloudflare Quick Tunnel Reconnect:** Ephemeral tunnel URL changes on reboot. Ensure `CHAY_POCKETBASE.bat` extracts the active URL and writes it to `pocketbase_config.json` for frontend and agent discovery.
5. **Realtime SSE Disconnection:** Network hiccup drops Web SSE connection. Ensure `web/app.js` implements automatic reconnection backoff.

---

### Task 1: Branch Isolation & Environment Configuration

**Files:**
- Modify: `.gitignore`
- Create: `pocketbase_config.json`

**Interfaces:**
- Produces: Git branch `feat/pocketbase`, `.gitignore` rules for `bin/pocketbase/pb_data/`, `*.db`, `*.db-journal`.

- [ ] **Step 1: Create and checkout git branch `feat/pocketbase`**
Run:
```powershell
git checkout -b feat/pocketbase
```
Expected: Switched to a new branch 'feat/pocketbase'

- [ ] **Step 2: Update `.gitignore` with PocketBase data exclusions**
Add exclusions for `bin/pocketbase/pb_data/`, `bin/pocketbase/*.zip`, and `*.db-wal`.

- [ ] **Step 3: Create default configuration file `pocketbase_config.json`**
```json
{
  "pocketbase_port": 8090,
  "admin_email": "admin@sgl.local",
  "admin_password": "SglAdminPassword2026!",
  "api_secret": "sgl_secret_token_2026",
  "fixed_domain": "",
  "active_tunnel_url": ""
}
```

- [ ] **Step 4: Verify git status and commit**
```powershell
git add .gitignore pocketbase_config.json
git commit -m "feat(pocketbase): setup branch feat/pocketbase and configuration"
```

---

### Task 2: Download & Integrate PocketBase Windows Binary

**Files:**
- Create: `bin/pocketbase/download_pb.ps1`
- Target: `bin/pocketbase/pocketbase.exe`

**Interfaces:**
- Consumes: GitHub Releases `pocketbase/pocketbase` Windows amd64 zip
- Produces: Executable `bin/pocketbase/pocketbase.exe`

- [ ] **Step 1: Write download and verification script `download_pb.ps1`**
Script checks if `bin/pocketbase/pocketbase.exe` exists. If not, downloads official v0.24.x zip from GitHub releases, extracts `pocketbase.exe` to `bin/pocketbase/`, and cleans up `.zip`.

- [ ] **Step 2: Execute `download_pb.ps1` to acquire binary**
Run:
```powershell
powershell -ExecutionPolicy Bypass -File bin/pocketbase/download_pb.ps1
```
Expected: `pocketbase.exe` extracted successfully.

- [ ] **Step 3: Verify binary executes cleanly**
Run:
```powershell
.\bin\pocketbase\pocketbase.exe --version
```
Expected: Output showing `pocketbase v0.24.*` or higher.

- [ ] **Step 4: Commit script**
```powershell
git add bin/pocketbase/download_pb.ps1
git commit -m "feat(pocketbase): add pocketbase binary installer script"
```

---

### Task 3: Schema Definition & Auto-Setup Script

**Files:**
- Create: `backend/pocketbase_setup.py`
- Create: `tests/test_pocketbase_setup.py`

**Interfaces:**
- Consumes: PocketBase Admin REST API (`POST /api/admins/auth-with-password`, `POST /api/collections`)
- Produces: Collections `devices`, `tasks`, `templates`, `heartbeats` with fields defined in spec.

- [ ] **Step 1: Write unit test `tests/test_pocketbase_setup.py`**
Test checks that `backend/pocketbase_setup.py` defines the expected 4 collection schemas with correct field types (`mac` text unique, `status` select, etc.).

- [ ] **Step 2: Run test to verify failure**
Run: `python -m unittest tests/test_pocketbase_setup.py`
Expected: FAIL (module not found)

- [ ] **Step 3: Implement `backend/pocketbase_setup.py`**
Script performs:
1. Creates Superuser if not exists (`admin@sgl.local` / password from config).
2. Authenticates and acquires Superuser JWT.
3. Checks existing collections; creates or updates `devices`, `tasks`, `templates`, `heartbeats`.
4. Seeds standard default templates (`deploy_radio_36`, `deploy_vnpt_ics`, `deploy_radio_166`, `deploy_radio_20`).
5. Configures API access rules: `listRule: ""`, `viewRule: ""`, `createRule: ""` for heartbeats and device registrations; administrative rules require `@request.headers.x_sgl_secret = '...'` or superuser.

- [ ] **Step 4: Run test to verify it passes**
Run: `python -m unittest tests/test_pocketbase_setup.py`
Expected: PASS

- [ ] **Step 5: Commit**
```powershell
git add backend/pocketbase_setup.py tests/test_pocketbase_setup.py
git commit -m "feat(pocketbase): implement automated schema definition and setup"
```

---

### Task 4: One-Click Google Sheets to PocketBase Data Migration

**Files:**
- Create: `backend/import_sheets_to_pb.py`
- Create: `tests/test_import_sheets.py`

**Interfaces:**
- Consumes: Google Apps Script Webhook (`GET /exec?action=get_devices`, `action=get_templates`) or CSV files
- Produces: Populated records in PocketBase collections `devices` and `templates`.

- [ ] **Step 1: Write test `tests/test_import_sheets.py`**
Mock Google Sheets response with 3 devices and 2 templates, run import function, assert PocketBase API received record creation payloads.

- [ ] **Step 2: Run test to verify failure**
Run: `python -m unittest tests/test_import_sheets.py`
Expected: FAIL

- [ ] **Step 3: Implement `backend/import_sheets_to_pb.py`**
Implements `import_data(webhook_url, pb_url, secret)`:
1. Fetches devices and templates from existing GAS URL.
2. Iterates and inserts/upserts records into PocketBase `devices` and `templates` collections.
3. Prints detailed sync report (number of devices imported, templates loaded).

- [ ] **Step 4: Run test to verify it passes**
Run: `python -m unittest tests/test_import_sheets.py`
Expected: PASS

- [ ] **Step 5: Commit**
```powershell
git add backend/import_sheets_to_pb.py tests/test_import_sheets.py
git commit -m "feat(pocketbase): add Google Sheets to PocketBase migration tool"
```

---

### Task 5: PocketBase Legacy Webhook Hook (`pb_hooks`)

**Files:**
- Create: `bin/pocketbase/pb_hooks/legacy_compat.pb.js`
- Create: `tests/test_legacy_hook.py`

**Interfaces:**
- Consumes: `POST /api/sgl_webhook` with JSON/FormData body `{ action: "heartbeat" | "claim_task" | "complete_task" | "register_device", ... }`
- Produces: JSON response matching GAS format: `{ "status": "ok", ... }`

- [ ] **Step 1: Write test `tests/test_legacy_hook.py`**
Test sends POST requests to `/api/sgl_webhook` for each legacy action and verifies response structure.

- [ ] **Step 2: Run test to verify failure**
Run: `python -m unittest tests/test_legacy_hook.py`
Expected: FAIL (connection refused or 404)

- [ ] **Step 3: Implement `bin/pocketbase/pb_hooks/legacy_compat.pb.js`**
Using PocketBase JS Hooks engine:
```javascript
routerAdd("POST", "/api/sgl_webhook", (c) => {
    // Parse body (JSON or form)
    // Switch on body.action:
    // "heartbeat": upsert devices, insert heartbeats
    // "claim_task": query tasks pending for MAC, update status to claimed, return steps_json
    // "complete_task": update task status to completed/failed, set completed_at and result
    // "register_device": insert or update devices collection
    // Return c.json(200, { status: "ok", ... })
});
```

- [ ] **Step 4: Test legacy hook against running test instance**
Run: `python -m unittest tests/test_legacy_hook.py`
Expected: PASS

- [ ] **Step 5: Commit**
```powershell
git add bin/pocketbase/pb_hooks/legacy_compat.pb.js tests/test_legacy_hook.py
git commit -m "feat(pocketbase): add legacy GAS webhook compatibility hook"
```

---

### Task 6: Python Client Adapter (`pocketbase_client.py`)

**Files:**
- Create: `sgl_manager/pocketbase_client.py`
- Create: `tests/test_pocketbase_client.py`

**Interfaces:**
- Produces: `PocketBaseClient` class with methods:
  - `get_devices() -> list[dict]`
  - `register_device(mac, anydesk_id, project) -> bool`
  - `create_task(template_name, target_macs) -> list[str]`
  - `claim_task(mac) -> dict`
  - `complete_task(task_id, result, is_error) -> bool`
  - `send_heartbeat(mac, info) -> bool`

- [ ] **Step 1: Write unit test `tests/test_pocketbase_client.py`**
Test checks all methods of `PocketBaseClient` with mocked HTTP responses.

- [ ] **Step 2: Run test to verify failure**
Run: `python -m unittest tests/test_pocketbase_client.py`
Expected: FAIL

- [ ] **Step 3: Implement `sgl_manager/pocketbase_client.py`**
Full implementation of `PocketBaseClient` communicating with PocketBase REST API with support for `X-SGL-Secret` authentication.

- [ ] **Step 4: Run test to verify it passes**
Run: `python -m unittest tests/test_pocketbase_client.py`
Expected: PASS

- [ ] **Step 5: Commit**
```powershell
git add sgl_manager/pocketbase_client.py tests/test_pocketbase_client.py
git commit -m "feat(pocketbase): implement Python PocketBaseClient adapter"
```

---

### Task 7: Web Application Integration (REST API & Realtime SSE)

**Files:**
- Modify: `web/app.js`
- Modify: `web/index.html`

**Interfaces:**
- Consumes: PocketBase REST endpoints `/api/collections/devices/records`, `/api/collections/tasks/records`, `/api/realtime` (SSE)
- Produces: Live Dashboard auto-updating in real-time without full page reloads.

- [ ] **Step 1: Add backend switcher to `web/index.html`**
Add UI controls in Settings modal to select Backend Type (`PocketBase (Siêu tốc)` vs `Google Sheets (Cũ)`), PocketBase Server URL, and API Secret.

- [ ] **Step 2: Implement PocketBase API & SSE Client in `web/app.js`**
1. Read `backendType` from `localStorage` (default: `"pocketbase"`).
2. When `backendType === "pocketbase"`:
   - Call PocketBase REST API for device listing, task dispatch, template management.
   - Initialize `new EventSource(`${pbUrl}/api/realtime`)` and subscribe to `devices/*` and `tasks/*`.
   - On SSE message, update local state and re-render device table rows seamlessly.
3. Fallback to Google Apps Script webhook when `backendType === "sheets"`.

- [ ] **Step 3: Verify Web App in browser**
Open `web/index.html` locally, verify that settings reflect PocketBase configuration and UI shows live connection status indicator.

- [ ] **Step 4: Commit**
```powershell
git add web/app.js web/index.html
git commit -m "feat(web): add PocketBase REST API and Realtime SSE support"
```

---

### Task 8: 1-Click Startup Script & Cloudflare Tunnel Launcher

**Files:**
- Create: `CHAY_POCKETBASE.bat`
- Create: `CHAY_POCKETBASE.py`

**Interfaces:**
- Orchestrates: `pocketbase.exe serve`, `backend/pocketbase_setup.py`, `bin/cloudflared.exe`, browser launch.

- [ ] **Step 1: Implement `CHAY_POCKETBASE.py`**
1. Starts PocketBase process on port 8090.
2. Waits for health check `http://127.0.0.1:8090/api/health` (returns 200).
3. Invokes `pocketbase_setup.py` to ensure schema is initialized.
4. Checks `pocketbase_config.json`:
   - If `fixed_domain` is set: uses it.
   - If empty: launches `bin/cloudflared.exe tunnel --url http://127.0.0.1:8090`, captures generated `trycloudflare.com` URL, and writes to config.
5. Prints QR / URL for Android box configuration and launches `web/index.html` in default browser.

- [ ] **Step 2: Create `CHAY_POCKETBASE.bat`**
Windows batch launcher with 1-click execution (`python CHAY_POCKETBASE.py`).

- [ ] **Step 3: Run end-to-end smoke test**
Launch PocketBase launcher, verify health endpoint returns 200 OK, Web UI connects, and collections are accessible.

- [ ] **Step 4: Commit**
```powershell
git add CHAY_POCKETBASE.bat CHAY_POCKETBASE.py
git commit -m "feat(pocketbase): add 1-click PocketBase orchestrator and launcher"
```
