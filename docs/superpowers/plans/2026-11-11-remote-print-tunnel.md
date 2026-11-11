# Remote Web Print with Cloudflare Tunnel Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enable remote users accessing the GitHub Pages web application to print 15x40mm box labels directly to the local AiYin D11S thermal printer via a secure Cloudflare Tunnel to the local Python web server.

**Architecture:** A local Python HTTP server (`web_server.py`) exposes a CORS-enabled `POST /api/print_label` endpoint that interfaces with `sgl_manager.printer_engine`. A Cloudflare Quick Tunnel (`cloudflared`) provides a secure public HTTPS endpoint for the local server. The GitHub Pages client (`web/app.js`) sends print requests with AnyDesk ID and IoT ID directly to the tunnel endpoint.

**Tech Stack:** Python 3.13 (`http.server`, `win32print`, `PIL`, `python-barcode`), Cloudflare Tunnel (`cloudflared`), Vanilla HTML5/JavaScript (`fetch`).

**Spec:** [Chat Design Doc](#) - 15x40mm label template (Code 128 AnyDesk barcode on left, bold IoT ID on right), Cloudflare Tunnel to `localhost:8080`, CORS-enabled HTTP endpoints, 1-Click batch and row-level printing.

## Global Constraints
- Target printer: `AiYin_D11` on Windows Spooler (`USB001` port).
- Label size: 15x40 mm (96px printable width, 320px length at 203 DPI).
- Zero-config public HTTPS via Cloudflare Quick Tunnel (`cloudflared tunnel --url http://localhost:8080`).
- CORS `Access-Control-Allow-Origin: *` to allow requests originating from GitHub Pages (`https://*.github.io`).

## Review Focus
1. **CORS Preflight Failure:** Browser rejects cross-origin `POST` because `OPTIONS /api/print_label` preflight is not handled. Ensure `do_OPTIONS` returns 200 with appropriate CORS headers.
2. **Missing IoT ID on Web:** Device row has no `iot_id` when user clicks print. Prompt user with a prompt modal/dialog before sending print request.
3. **Tunnel Reconnect / URL Change:** Quick tunnel generates a new URL upon restart. Allow users to easily update the Print Server URL in Web Settings.
4. **Invalid AnyDesk ID:** Clean input string of spaces before generating Code 128 barcode.
5. **Printer Offline / Spooler Error:** Web server returns JSON error `{status: "error", message: "..."}` so user receives immediate UI feedback.

---

### Task 1: Update `web_server.py` with Print Endpoint & CORS

**Files:**
- Modify: `web_server.py`
- Test: `tests/test_web_server_print.py`

**Interfaces:**
- Consumes: `sgl_manager.printer_engine.print_box_label(anydesk_id, iot_id)`
- Produces: `POST /api/print_label` accepting `{ "anydesk_id": str, "iot_id": str }` and returning `{ "status": "ok"|"error", "message": str }`

- [ ] **Step 1: Write test for `/api/print_label` endpoint**
Create a test script that starts `SGLWebHandler` on a test port, sends an `OPTIONS` request (verifying CORS headers) and a `POST` request with JSON payload.

- [ ] **Step 2: Run test to verify it fails**
Run test script:
```powershell
python -m unittest tests/test_web_server_print.py
```
Expected: FAIL (404 or connection refused)

- [ ] **Step 3: Implement `do_OPTIONS` and update `do_POST` in `web_server.py`**
Add CORS headers (`Access-Control-Allow-Origin: *`, `Access-Control-Allow-Headers: Content-Type`, `Access-Control-Allow-Methods: POST, OPTIONS`).
Handle `/api/print_label`: parse JSON body, call `print_box_label(anydesk_id, iot_id)`, and return JSON response.

- [ ] **Step 4: Run test to verify it passes**
```powershell
python -m unittest tests/test_web_server_print.py
```
Expected: PASS

- [ ] **Step 5: Commit**
```powershell
git add web_server.py tests/test_web_server_print.py
git commit -m "feat: add CORS and /api/print_label endpoint to web_server"
```

---

### Task 2: Setup Cloudflare Tunnel & Startup Automation

**Files:**
- Create/Download: `bin/cloudflared.exe` (or system winget install)
- Modify: `CHAY_WEB_QUAN_LY.bat`
- Create: `start_tunnel.bat` or integrate into `CHAY_WEB_QUAN_LY.bat`

**Interfaces:**
- Consumes: `http://localhost:8080`
- Produces: Public HTTPS tunnel URL printed to console and saved to `.current_tunnel_url` for easy copying.

- [ ] **Step 1: Install or verify `cloudflared` executable**
Use winget or download `cloudflared.exe` into project tools directory if not present.
Verify with:
```powershell
cloudflared --version
```

- [ ] **Step 2: Update `CHAY_WEB_QUAN_LY.bat`**
Add a launcher script or update `CHAY_WEB_QUAN_LY.bat` so it launches `web_server.py` and starts `cloudflared tunnel --url http://localhost:8080`, logging the active public URL.

- [ ] **Step 3: Test tunnel launch and verify public endpoint**
Run tunnel test and perform an HTTP GET request to verify tunnel routing to `web_server.py`.

- [ ] **Step 4: Commit**
```powershell
git add CHAY_WEB_QUAN_LY.bat
git commit -m "feat: integrate cloudflared tunnel into startup batch script"
```

---

### Task 3: Update Web UI (`web/index.html` & `web/app.js`)

**Files:**
- Modify: `web/index.html`
- Modify: `web/app.js`

**Interfaces:**
- Consumes: Print Server URL from `localStorage.getItem("sgl_print_server_url")` or default
- Produces: In-browser `[ 🖨️ In Tem ]` action buttons on device rows and batch action toolbar.

- [ ] **Step 1: Add Print Server URL setting to Settings Modal in `web/index.html`**
Add an input `#txtPrintServerUrl` in the config section of `web/index.html`.
Add a batch button `[ 🖨️ In Tem Đã Chọn ]` next to the other batch actions.

- [ ] **Step 2: Implement printing functions in `web/app.js`**
Add `state.printServerUrl`.
Add `printDeviceLabel(anydeskId, iotId)`:
- If `iotId` is empty or "-", prompt user for IoT ID via a modal/prompt.
- Call `${state.printServerUrl}/api/print_label`.
- Display toast notification with result.
Add `printSelectedDevices()`: iterate through selected devices and print each with rate-limiting.
Add `[ 🖨️ In Tem ]` button into `renderDeviceTable()` row actions.

- [ ] **Step 3: Test Web UI in browser**
Verify that clicking `[ 🖨️ In Tem ]` invokes the API and prints with valid notification.

- [ ] **Step 4: Commit**
```powershell
git add web/index.html web/app.js
git commit -m "feat: add remote print buttons and print server url setting to web"
```

---

### Task 4: End-to-End Verification

**Files:**
- Test end-to-end pipeline from Web to AiYin D11S printer.

- [ ] **Step 1: Start `web_server.py` and test local `/api/print_label`**
- [ ] **Step 2: Start Cloudflare tunnel and send test request from public HTTPS URL**
- [ ] **Step 3: Verify physical printer prints label correctly**
- [ ] **Step 4: Final verification and summary**
