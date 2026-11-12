// ============================================================================
// SGL SMART BROADCAST CLOUD — FRONTEND APPLICATION LOGIC
// ============================================================================

const DEFAULT_WEBHOOK_URL = "https://script.google.com/macros/s/AKfycbxqawYpW8SebK0EK21Cl7C2uw6vN3-Jr7vQIHSAbNxtwXA5H7c_lYRNhXuB7104P0NN/exec";
const DEFAULT_SHEET_URL = "https://docs.google.com/spreadsheets/d/1-7ZrYTDnoL68BNB7D9QQWxhDGcGNXW3VVfdedAtejAg/edit";
// Mật khẩu AnyDesk mặc định được mã hóa XOR bằng khóa dẫn xuất SHA-256 từ phiên đăng nhập Admin (không lưu plaintext trong mã nguồn)
const ENCRYPTED_DEFAULT_AD_PASS = "dfd2a30ec67f7af35d";

let state = {
  backendType: localStorage.getItem("sgl_backend_type") || "pocketbase",
  pocketbaseUrl: (localStorage.getItem("sgl_pb_url") || "http://127.0.0.1:8090").trim().replace(/\/+$/, ""),
  pocketbaseSecret: localStorage.getItem("sgl_pb_secret") || "sgl_secret_token_2026",
  webhookUrl: localStorage.getItem("sgl_webhook_url") || DEFAULT_WEBHOOK_URL,
  sheetUrl: localStorage.getItem("sgl_sheet_url") || DEFAULT_SHEET_URL,
  adPass: localStorage.getItem("sgl_ad_pass") || "",
  printServerUrl: localStorage.getItem("sgl_print_server_url") || "",
  devices: [],
  templates: [],
  tasks: [],
  selectedMacs: new Set(),
  filteredDevices: [],
  recentlyAddedKeys: new Set()
};

// Đọc tham số URL chia sẻ nhanh nếu có: ?printer=https://...
try {
  const urlParams = new URLSearchParams(window.location.search);
  const qPrinter = urlParams.get("printer") || urlParams.get("print_url");
  if (qPrinter) {
    const cleanUrl = qPrinter.trim().replace(/\/+$/, "");
    if (cleanUrl.startsWith("http")) {
      state.printServerUrl = cleanUrl;
      localStorage.setItem("sgl_print_server_url", cleanUrl);
    }
  }
} catch (e) {}

const DEFAULT_TEMPLATES = [
  {
    template_name: "deploy_radio_36",
    description: "Cài đặt & Nâng cấp Radio 3.6 (Tải trực tiếp & cài đè qua Root)",
    steps_json: JSON.stringify([
      {
        action: "shell_cmd",
        params: {
          cmd: "am force-stop vn.phitn.app.radiostation ; am force-stop com.radiostation ; /vendor/xbin/curl -L -k -o /data/local/tmp/Radio3.6.apk \"https://drive.usercontent.google.com/download?id=1fU02IfohDL0FnLFmkz1TZ3tlSrpDfRdD&export=download&confirm=t\" && ls -l /data/local/tmp/Radio3.6.apk && pm install -r -g /data/local/tmp/Radio3.6.apk && rm -f /data/local/tmp/Radio3.6.apk"
        }
      },
      {
        action: "start_app",
        params: {
          package: "vn.phitn.app.radiostation",
          activity: "vn.phitn.app.radiostation.ui.SplashActivity"
        }
      },
      {
        action: "report_field",
        params: {
          field: "software",
          value: "Radio 3.6"
        }
      }
    ], null, 2)
  },
  {
    template_name: "deploy_vnpt_ics",
    description: "Chuyển sang VNPT ICS (Tải trực tiếp, cài ICS, tự động lấy MAC ICS lên Sheet)",
    steps_json: JSON.stringify([
      {
        action: "shell_cmd",
        params: {
          cmd: "am force-stop vn.phitn.app.radiostation ; am force-stop com.radiostation ; /vendor/xbin/curl -L -k -o /data/local/tmp/ics.apk \"https://drive.usercontent.google.com/download?id=1Qozu11xJNhvwSFlTPfC8rpFa8Zy8gLvF&export=download&confirm=t\" && ls -l /data/local/tmp/ics.apk && pm install -r -g /data/local/tmp/ics.apk && rm -f /data/local/tmp/ics.apk"
        }
      },
      {
        action: "start_app",
        params: {
          package: "com.app.ics_content_management",
          activity: "vn.vnpt.digo.ics.MainActivity"
        }
      },
      {
        action: "extract_ics_mac",
        params: {
          package: "com.app.ics_content_management"
        }
      },
      {
        action: "report_field",
        params: {
          field: "software",
          value: "VNPT ICS"
        }
      }
    ], null, 2)
  },
  {
    template_name: "deploy_radio_166",
    description: "Chuyển sang Radio 1.66 (Tải trực tiếp & cài đè qua Root)",
    steps_json: JSON.stringify([
      {
        action: "shell_cmd",
        params: {
          cmd: "am force-stop vn.phitn.app.radiostation ; am force-stop com.radiostation ; /vendor/xbin/curl -L -k -o /data/local/tmp/radio.apk \"https://drive.usercontent.google.com/download?id=1fa3-qqFUJ6d9sCuLjidHAI6eom1mlxJ5&export=download&confirm=t\" && ls -l /data/local/tmp/radio.apk && pm install -r -d -g /data/local/tmp/radio.apk && rm -f /data/local/tmp/radio.apk"
        }
      },
      {
        action: "start_app",
        params: {
          package: "vn.phitn.app.radiostation",
          activity: "vn.phitn.app.radiostation.ui.SplashActivity"
        }
      },
      {
        action: "report_field",
        params: {
          field: "software",
          value: "Radio 1.66"
        }
      }
    ], null, 2)
  },
  {
    template_name: "deploy_radio_20",
    description: "Nâng cấp Radio 2.0 (Tải trực tiếp & cài đè sạch qua Root, cấu hình Radio 2.0)",
    steps_json: JSON.stringify([
      {
        action: "shell_cmd",
        params: {
          cmd: "am force-stop vn.phitn.app.radiostation ; am force-stop com.radiostation ; /vendor/xbin/curl -L -k -o /data/local/tmp/Radio2.0.apk \"https://drive.usercontent.google.com/download?id=1bLxqszxg5DficlG02cWZFjmGLxbMhiFT&export=download&confirm=t\" && ls -l /data/local/tmp/Radio2.0.apk && pm install -r -g /data/local/tmp/Radio2.0.apk && rm -f /data/local/tmp/Radio2.0.apk"
        }
      },
      {
        action: "start_app",
        params: {
          package: "vn.phitn.app.radiostation",
          activity: "vn.phitn.app.radiostation.ui.SplashActivity"
        }
      },
      {
        action: "report_field",
        params: {
          field: "software",
          value: "Radio 2.0"
        }
      }
    ], null, 2)
  }
];

// ============================================================================
// AUTHENTICATION & SECURITY (SHA-256 DOUBLE-HASH + V2 TOKEN ROTATION)
// ============================================================================
const AUTH_SALT = "SGL_BROADCAST_AUTH_2026";
const AUTH_SALT_V2 = "SGL_API_TOKEN_V2_2026";
const SERVER_PEPPER = "SGL_SERVER_PEPPER_2026";
// SHA-256(legacyToken + ":SGL_SERVER_PEPPER_2026") — Tuyệt đối không lưu trực tiếp token trong mã nguồn
const EXPECTED_SERVER_HASH = "9a2ab7e32ba82f927abcd5fa6e9ad5d0db04fbccafee5597153184a5284b32a4";
const AUTH_STORAGE_KEY = "sgl_cloud_auth_session_v1";
const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

let syncIntervalId = null;
let failedLoginAttempts = 0;
let loginLockUntil = 0;

// Pure-JS SHA-256 fallback (for file:// or non-HTTPS LAN access) + Web Crypto API
async function sha256Hex(asciiStr) {
  if (window.crypto && window.crypto.subtle) {
    try {
      const msgBuffer = new TextEncoder().encode(asciiStr);
      const hashBuffer = await window.crypto.subtle.digest("SHA-256", msgBuffer);
      const hashArray = Array.from(new Uint8Array(hashBuffer));
      return hashArray.map(b => b.toString(16).padStart(2, "0")).join("");
    } catch (e) {
      // Fall through to pure JS SHA-256
    }
  }
  return sha256PureJS(asciiStr);
}

function sha256PureJS(ascii) {
  function rightRotate(value, amount) {
    return (value >>> amount) | (value << (32 - amount));
  }
  const mathPow = Math.pow;
  const maxWord = mathPow(2, 32);
  const lengthProperty = "length";
  let i, j;
  let result = "";
  const words = [];
  const asciiBitLength = ascii[lengthProperty] * 8;
  let hash = (sha256PureJS.h = sha256PureJS.h || []);
  const k = (sha256PureJS.k = sha256PureJS.k || []);
  let primeCounter = k[lengthProperty];
  const isComposite = {};
  for (let candidate = 2; primeCounter < 64; candidate++) {
    if (!isComposite[candidate]) {
      for (i = 0; i < 313; i += candidate) {
        isComposite[i] = candidate;
      }
      hash[primeCounter] = (mathPow(candidate, 0.5) * maxWord) | 0;
      k[primeCounter++] = (mathPow(candidate, 1 / 3) * maxWord) | 0;
    }
  }
  ascii += "\x80";
  while ((ascii[lengthProperty] % 64) - 56) ascii += "\x00";
  for (i = 0; i < ascii[lengthProperty]; i++) {
    j = ascii.charCodeAt(i);
    if (j >> 8) return "";
    words[i >> 2] |= j << ((3 - (i % 4)) * 8);
  }
  words[words[lengthProperty]] = (asciiBitLength / maxWord) | 0;
  words[words[lengthProperty]] = asciiBitLength;
  for (j = 0; j < words[lengthProperty]; ) {
    const w = words.slice(j, (j += 16));
    const oldHash = hash;
    hash = hash.slice(0, 8);
    for (i = 0; i < 64; i++) {
      const i2 = i + j;
      const w15 = w[i - 15],
        w2 = w[i - 2];
      const a = hash[0],
        e = hash[4];
      const temp1 =
        hash[7] +
        (rightRotate(e, 6) ^ rightRotate(e, 11) ^ rightRotate(e, 25)) +
        ((e & hash[5]) ^ (~e & hash[6])) +
        k[i] +
        (w[i] =
          i < 16
            ? w[i]
            : (w[i - 16] +
                (rightRotate(w15, 7) ^ rightRotate(w15, 18) ^ (w15 >>> 3)) +
                w[i - 7] +
                (rightRotate(w2, 17) ^ rightRotate(w2, 19) ^ (w2 >>> 10))) |
              0);
      const temp2 =
        (rightRotate(a, 2) ^ rightRotate(a, 13) ^ rightRotate(a, 22)) +
        ((a & hash[1]) ^ (a & hash[2]) ^ (hash[1] & hash[2]));
      hash = [(temp1 + temp2) | 0].concat(hash);
      hash[4] = (hash[4] + temp1) | 0;
    }
    for (i = 0; i < 8; i++) {
      hash[i] = (hash[i] + oldHash[i]) | 0;
    }
  }
  for (i = 0; i < 8; i++) {
    for (j = 3; j + 1; j--) {
      const b = (hash[i] >> (j * 8)) & 255;
      result += (b < 16 ? 0 : "") + b.toString(16);
    }
  }
  return result;
}

function validateAndNormalizeSessionObj(parsed) {
  if (!parsed || typeof parsed !== "object") return null;
  const legacyToken = parsed.legacyToken || parsed.hash || "";
  if (!legacyToken) return null;
  const computedVerify = sha256PureJS(`${legacyToken}:${SERVER_PEPPER}`);
  if (computedVerify !== EXPECTED_SERVER_HASH) return null;
  return {
    user: parsed.user || "admin",
    token: parsed.token || legacyToken,
    legacyToken: legacyToken,
    verifyHash: computedVerify,
    expiresAt: parsed.expiresAt || (Date.now() + SEVEN_DAYS_MS)
  };
}

function getStoredAuthSession() {
  try {
    const rawSession = sessionStorage.getItem(AUTH_STORAGE_KEY);
    if (rawSession) {
      const norm = validateAndNormalizeSessionObj(JSON.parse(rawSession));
      if (norm) return norm;
    }
    const rawLocal = localStorage.getItem(AUTH_STORAGE_KEY);
    if (rawLocal) {
      const parsed = JSON.parse(rawLocal);
      const norm = validateAndNormalizeSessionObj(parsed);
      if (norm && norm.expiresAt > Date.now()) {
        return norm;
      } else {
        localStorage.removeItem(AUTH_STORAGE_KEY);
      }
    }
  } catch (e) {
    // Ignore storage errors
  }
  return null;
}

function isSessionAuthenticated() {
  return getStoredAuthSession() !== null;
}

function decryptDefaultAdPassSync(legacyToken) {
  if (!legacyToken) return "";
  const check = sha256PureJS(`${legacyToken}:${SERVER_PEPPER}`);
  if (check !== EXPECTED_SERVER_HASH) return "";
  const keyStream = sha256PureJS(`${legacyToken}:SGL_ADPASS_STREAM_2026`);
  let out = "";
  for (let i = 0; i < ENCRYPTED_DEFAULT_AD_PASS.length; i += 2) {
    const encByte = parseInt(ENCRYPTED_DEFAULT_AD_PASS.substring(i, i + 2), 16);
    const keyByte = parseInt(keyStream.substring(i, i + 2), 16);
    out += String.fromCharCode(encByte ^ keyByte);
  }
  return out;
}

function getDecryptedDefaultAdPass() {
  const sess = getStoredAuthSession();
  if (!sess || !sess.legacyToken) return "";
  return decryptDefaultAdPassSync(sess.legacyToken);
}

function unlockApplication() {
  const sess = getStoredAuthSession();
  if (!sess) {
    handleLogout("🔒 Vui lòng đăng nhập tài khoản Quản trị viên!");
    return;
  }

  if (!state.adPass) {
    state.adPass = decryptDefaultAdPassSync(sess.legacyToken);
  }

  const gate = document.getElementById("loginGate");
  const topbar = document.getElementById("appTopbar");
  const main = document.getElementById("appMain");
  if (gate) gate.style.display = "none";
  if (topbar) topbar.style.display = "flex";
  if (main) main.style.display = "block";

  document.getElementById("txtWebhookUrl").value = state.webhookUrl;
  document.getElementById("txtSheetUrl").value = state.sheetUrl;
  document.getElementById("txtDefaultAdPass").value = state.adPass;
  if (document.getElementById("txtPrintServerUrl")) {
    document.getElementById("txtPrintServerUrl").value = state.printServerUrl;
  }
  document.getElementById("btnOpenSheetTop").href = state.sheetUrl;

  updateBackendUI();
  if (state.backendType === "pocketbase") {
    initPocketBaseSSE();
  }

  refreshAllData();
  if (syncIntervalId) clearInterval(syncIntervalId);
  syncIntervalId = setInterval(refreshAllData, 30000);
}

async function handleLoginSubmit(event) {
  event.preventDefault();
  const errBox = document.getElementById("loginErrorBox");
  const card = document.getElementById("loginCard");

  if (Date.now() < loginLockUntil) {
    const remainSec = Math.ceil((loginLockUntil - Date.now()) / 1000);
    errBox.textContent = `⏳ Đăng nhập sai quá nhiều lần. Vui lòng thử lại sau ${remainSec} giây.`;
    errBox.style.display = "block";
    return;
  }

  const username = (document.getElementById("loginUsername").value || "").trim().toLowerCase();
  const password = (document.getElementById("loginPassword").value || "").trim();
  const remember = document.getElementById("loginRemember").checked;

  const legacyToken = await sha256Hex(`${username}:${password}:${AUTH_SALT}`);
  const v2Token = await sha256Hex(`${username}:${password}:${AUTH_SALT_V2}`);
  const verifyHash = await sha256Hex(`${legacyToken}:${SERVER_PEPPER}`);

  if (username === "admin" && verifyHash === EXPECTED_SERVER_HASH) {
    failedLoginAttempts = 0;
    errBox.style.display = "none";
    const tokenObj = {
      user: "admin",
      token: v2Token,
      legacyToken: legacyToken,
      verifyHash: verifyHash,
      expiresAt: Date.now() + SEVEN_DAYS_MS
    };
    sessionStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(tokenObj));
    if (remember) {
      localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(tokenObj));
    } else {
      localStorage.removeItem(AUTH_STORAGE_KEY);
    }

    state.adPass = localStorage.getItem("sgl_ad_pass") || decryptDefaultAdPassSync(legacyToken);
    document.getElementById("loginPassword").value = "";

    // Tự động nâng cấp & khóa cứng Token V2 trên Google Apps Script PropertiesService
    apiPost({ action: "bind_v2_auth", auth_token: v2Token, legacy_token: legacyToken }).catch(() => {});

    showToast("🔓 Đăng nhập thành công! Chào mừng Quản trị viên.");
    unlockApplication();
  } else {
    failedLoginAttempts++;
    card.classList.remove("shake");
    void card.offsetWidth;
    card.classList.add("shake");

    if (failedLoginAttempts >= 5) {
      loginLockUntil = Date.now() + 30000;
      failedLoginAttempts = 0;
      errBox.textContent = "🚫 Nhập sai 5 lần liên tiếp! Tạm khóa đăng nhập trong 30 giây.";
    } else {
      errBox.textContent = `❌ Sai tài khoản hoặc mật khẩu bảo mật! (Còn ${5 - failedLoginAttempts} lần thử)`;
    }
    errBox.style.display = "block";
  }
}

function togglePasswordVisibility() {
  const input = document.getElementById("loginPassword");
  const btn = document.getElementById("btnTogglePass");
  if (input.type === "password") {
    input.type = "text";
    btn.textContent = "🙈";
  } else {
    input.type = "password";
    btn.textContent = "👁";
  }
}

function handleLogout(customMsg) {
  sessionStorage.removeItem(AUTH_STORAGE_KEY);
  localStorage.removeItem(AUTH_STORAGE_KEY);
  localStorage.removeItem("sgl_ad_pass");
  state.adPass = "";
  state.devices = [];
  if (syncIntervalId) {
    clearInterval(syncIntervalId);
    syncIntervalId = null;
  }
  const adPassInput = document.getElementById("txtDefaultAdPass");
  if (adPassInput) adPassInput.value = "";
  document.getElementById("appTopbar").style.display = "none";
  document.getElementById("appMain").style.display = "none";
  document.getElementById("loginGate").style.display = "flex";
  document.getElementById("loginPassword").value = "";
  showToast(typeof customMsg === "string" && customMsg ? customMsg : "🔒 Đã đăng xuất khỏi hệ thống an toàn.");
}

// ============================================================================
// INITIALIZATION
// ============================================================================
window.addEventListener("DOMContentLoaded", () => {
  if (isSessionAuthenticated()) {
    unlockApplication();
  } else {
    const userInp = document.getElementById("loginUsername");
    if (userInp) userInp.focus();
  }
});

// ============================================================================
// POCKETBASE & GOOGLE SHEETS DUAL-BACKEND LOGIC
// ============================================================================
let pbEventSource = null;
let pbClientId = "";

function updateBackendUI() {
  const isPb = state.backendType === "pocketbase";
  const sel = document.getElementById("selBackendType");
  if (sel) sel.value = state.backendType;

  const rowPbUrl = document.getElementById("rowPocketBaseUrl");
  const rowPbSec = document.getElementById("rowPocketBaseSecret");
  const rowGWebhook = document.getElementById("rowGoogleWebhook");
  const rowGSheet = document.getElementById("rowGoogleSheet");
  const badge = document.getElementById("badgeBackend");

  if (rowPbUrl) rowPbUrl.style.display = isPb ? "block" : "none";
  if (rowPbSec) rowPbSec.style.display = isPb ? "block" : "none";
  if (rowGWebhook) rowGWebhook.style.display = isPb ? "none" : "block";
  if (rowGSheet) rowGSheet.style.display = isPb ? "none" : "block";

  if (badge) {
    if (isPb) {
      badge.textContent = "⚡ PocketBase (Realtime)";
      badge.style.background = "#00e676";
      badge.style.color = "#000";
    } else {
      badge.textContent = "📊 Google Sheet (GAS)";
      badge.style.background = "#00b0ff";
      badge.style.color = "#fff";
    }
  }

  const txtPbUrl = document.getElementById("txtPocketBaseUrl");
  const txtPbSec = document.getElementById("txtPocketBaseSecret");
  if (txtPbUrl) txtPbUrl.value = state.pocketbaseUrl;
  if (txtPbSec) txtPbSec.value = state.pocketbaseSecret;
}

function onBackendTypeChange() {
  const sel = document.getElementById("selBackendType");
  if (sel) {
    state.backendType = sel.value;
    localStorage.setItem("sgl_backend_type", state.backendType);
    updateBackendUI();
    showToast(`Đã chuyển sang ${state.backendType === "pocketbase" ? "⚡ PocketBase" : "📊 Google Sheets"}`);
    if (state.backendType === "pocketbase") {
      initPocketBaseSSE();
    } else if (pbEventSource) {
      try { pbEventSource.close(); } catch(e) {}
      pbEventSource = null;
    }
    refreshAllData();
  }
}

let pbSseRetryDelay = 2000;
let pbSseRetryTimer = null;

function initPocketBaseSSE() {
  if (state.backendType !== "pocketbase") return;
  if (pbEventSource) {
    try { pbEventSource.close(); } catch(e) {}
    pbEventSource = null;
  }
  if (pbSseRetryTimer) {
    clearTimeout(pbSseRetryTimer);
    pbSseRetryTimer = null;
  }

  try {
    const sseUrl = `${state.pocketbaseUrl}/api/realtime`;
    pbEventSource = new EventSource(sseUrl);

    pbEventSource.onopen = function() {
      pbSseRetryDelay = 2000;
      const syncLbl = document.getElementById("lblLastSync");
      if (syncLbl) syncLbl.textContent = "⚡ Realtime SSE Kết nối";
    };

    pbEventSource.onmessage = function(e) {
      try {
        const msg = JSON.parse(e.data);
        if (msg.clientId) {
          pbClientId = msg.clientId;
          fetch(`${state.pocketbaseUrl}/api/realtime`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              clientId: pbClientId,
              subscriptions: ["devices/*", "tasks/*"]
            })
          }).catch(() => {});
          return;
        }

        if (msg.action && (msg.action === "create" || msg.action === "update" || msg.action === "delete")) {
          refreshAllData();
        }
      } catch (err) {}
    };

    pbEventSource.onerror = function() {
      try { pbEventSource.close(); } catch(e) {}
      pbEventSource = null;
      const syncLbl = document.getElementById("lblLastSync");
      if (syncLbl) syncLbl.textContent = `⏳ Mất kết nối SSE (thử lại sau ${Math.round(pbSseRetryDelay / 1000)}s)...`;
      pbSseRetryTimer = setTimeout(() => {
        pbSseRetryDelay = Math.min(pbSseRetryDelay * 1.5, 30000);
        initPocketBaseSSE();
      }, pbSseRetryDelay);
    };
  } catch (err) {
    console.warn("Lỗi khởi tạo PocketBase SSE:", err);
  }
}

// ----------------- PocketBase REST Handlers -----------------
async function apiGetPocketBase(params) {
  const action = params.action;
  const headers = { "Content-Type": "application/json" };
  if (state.pocketbaseSecret) {
    headers["X-SGL-Secret"] = state.pocketbaseSecret;
  }

  if (action === "get_devices") {
    const resp = await fetch(`${state.pocketbaseUrl}/api/collections/devices/records?page=1&perPage=500&sort=-last_seen`, { headers });
    const data = await resp.json();
    return { status: "ok", devices: data.items || [] };
  }

  if (action === "get_templates") {
    const resp = await fetch(`${state.pocketbaseUrl}/api/collections/templates/records?perPage=200`, { headers });
    const data = await resp.json();
    return { status: "ok", templates: data.items || [] };
  }

  if (action === "get_tasks") {
    const resp = await fetch(`${state.pocketbaseUrl}/api/collections/tasks/records?perPage=200&sort=-created`, { headers });
    const data = await resp.json();
    return { status: "ok", tasks: data.items || [] };
  }

  if (action === "sync_project_sheets") {
    return { status: "ok", message: "PocketBase tự động phân tách và lập chỉ mục CSDL SQLite realtime!" };
  }

  return { status: "ok" };
}

async function apiPostPocketBase(payload) {
  const action = payload.action;
  const headers = { "Content-Type": "application/json" };
  if (state.pocketbaseSecret) {
    headers["X-SGL-Secret"] = state.pocketbaseSecret;
  }

  if (action === "create_task") {
    const createdIds = [];
    const targetMacs = payload.target_macs || (payload.target_mac ? [payload.target_mac] : []);
    const ts = Date.now();
    for (let i = 0; i < targetMacs.length; i++) {
      const tid = `TASK_${ts}_${i + 1}`;
      const taskRecord = {
        task_id: tid,
        template_name: payload.template_name,
        target_mac: targetMacs[i].replace(/[^a-fA-F0-9]/g, "").toUpperCase(),
        status: "pending",
        created_at: new Date().toISOString()
      };
      await fetch(`${state.pocketbaseUrl}/api/collections/tasks/records`, {
        method: "POST",
        headers,
        body: JSON.stringify(taskRecord)
      });
      createdIds.push(tid);
    }
    return { status: "ok", task_ids: createdIds };
  }

  if (action === "assign_project") {
    const macs = payload.macs || (payload.mac ? [payload.mac] : []);
    const project = (payload.project || "").trim();
    for (const m of macs) {
      const cleanM = m.replace(/[^a-fA-F0-9]/g, "").toUpperCase();
      const query = encodeURIComponent(`mac='${cleanM}'`);
      try {
        const searchResp = await fetch(`${state.pocketbaseUrl}/api/collections/devices/records?filter=(${query})`, { headers });
        const searchData = await searchResp.json();
        if (searchData.items && searchData.items.length > 0) {
          const recId = searchData.items[0].id;
          await fetch(`${state.pocketbaseUrl}/api/collections/devices/records/${recId}`, {
            method: "PATCH",
            headers,
            body: JSON.stringify({ project: project })
          });
        }
      } catch (e) {}
    }
    return { status: "ok" };
  }

  if (action === "save_template") {
    const tName = (payload.template_name || "").trim();
    const query = encodeURIComponent(`template_name='${tName}'`);
    const tmplBody = {
      template_name: tName,
      steps_json: typeof payload.steps_json === "string" ? payload.steps_json : JSON.stringify(payload.steps_json),
      description: (payload.description || "").trim(),
      created_by: "admin"
    };
    try {
      const searchResp = await fetch(`${state.pocketbaseUrl}/api/collections/templates/records?filter=(${query})`, { headers });
      const searchData = await searchResp.json();
      if (searchData.items && searchData.items.length > 0) {
        await fetch(`${state.pocketbaseUrl}/api/collections/templates/records/${searchData.items[0].id}`, {
          method: "PATCH",
          headers,
          body: JSON.stringify(tmplBody)
        });
      } else {
        await fetch(`${state.pocketbaseUrl}/api/collections/templates/records`, {
          method: "POST",
          headers,
          body: JSON.stringify(tmplBody)
        });
      }
    } catch (e) {}
    return { status: "ok" };
  }

  if (action === "batch_import_devices") {
    const devices = payload.devices || [];
    for (const d of devices) {
      const cleanM = (d.mac || "").replace(/[^a-fA-F0-9]/g, "").toUpperCase();
      if (!cleanM) continue;
      const query = encodeURIComponent(`mac='${cleanM}'`);
      const devBody = {
        mac: cleanM,
        anydesk_id: (d.anydesk_id || "").replace(/\s+/g, "").trim(),
        project: (d.project || "").trim(),
        status: "new",
        last_seen: new Date().toISOString()
      };
      try {
        const searchResp = await fetch(`${state.pocketbaseUrl}/api/collections/devices/records?filter=(${query})`, { headers });
        const searchData = await searchResp.json();
        if (searchData.items && searchData.items.length > 0) {
          await fetch(`${state.pocketbaseUrl}/api/collections/devices/records/${searchData.items[0].id}`, {
            method: "PATCH",
            headers,
            body: JSON.stringify(devBody)
          });
        } else {
          await fetch(`${state.pocketbaseUrl}/api/collections/devices/records`, {
            method: "POST",
            headers,
            body: JSON.stringify(devBody)
          });
        }
      } catch (e) {}
    }
    return { status: "ok", imported: devices.length };
  }

  if (action === "bind_v2_auth") {
    return { status: "ok", bound: true };
  }

  if (action === "update_iot_id") {
    const adClean = (payload.anydesk_id || "").replace(/\s+/g, "").trim();
    const cleanM = (payload.mac || "").replace(/[^a-fA-F0-9]/g, "").toUpperCase();
    const newIot = (payload.iot_id !== undefined ? String(payload.iot_id) : "").trim();
    let query = "";
    if (cleanM && !cleanM.startsWith("CHUA_MAC_")) {
      query = `mac='${cleanM}'`;
    } else if (adClean) {
      query = `anydesk_id='${adClean}'`;
    }
    if (query) {
      try {
        const searchResp = await fetch(`${state.pocketbaseUrl}/api/collections/devices/records?filter=(${encodeURIComponent(query)})`, { headers });
        const searchData = await searchResp.json();
        if (searchData.items && searchData.items.length > 0) {
          await fetch(`${state.pocketbaseUrl}/api/collections/devices/records/${searchData.items[0].id}`, {
            method: "PATCH",
            headers,
            body: JSON.stringify({ iot_id: newIot })
          });
        }
      } catch (e) {}
    }
    return { status: "ok", iot_id: newIot };
  }

  return { status: "ok" };
}

// ============================================================================
// API CLIENT (CORS-SAFE FOR GOOGLE APPS SCRIPT + AUTO ADMIN TOKEN)
// ============================================================================
async function apiGet(params) {
  if (state.backendType === "pocketbase") {
    return apiGetPocketBase(params);
  }

  const sess = getStoredAuthSession();
  const url = new URL(state.webhookUrl);
  Object.keys(params).forEach(k => url.searchParams.set(k, params[k]));
  if (sess) {
    if (sess.token) url.searchParams.set("auth_token", sess.token);
    if (sess.legacyToken) url.searchParams.set("legacy_token", sess.legacyToken);
  }
  const resp = await fetch(url.toString(), {
    method: "GET",
    redirect: "follow"
  });
  const data = await resp.json();
  if (data && data.code === "UNAUTHORIZED") {
    handleLogout("🔒 Từ chối truy cập: Vui lòng đăng nhập lại tài khoản Quản trị viên!");
    throw new Error(data.message || "UNAUTHORIZED");
  }
  return data;
}

async function apiPost(payload) {
  if (state.backendType === "pocketbase") {
    return apiPostPocketBase(payload);
  }

  const sess = getStoredAuthSession();
  const bodyObj = Object.assign({}, payload);
  if (sess) {
    if (!bodyObj.auth_token && sess.token) bodyObj.auth_token = sess.token;
    if (!bodyObj.legacy_token && sess.legacyToken) bodyObj.legacy_token = sess.legacyToken;
  }
  // Dùng Content-Type text/plain để tránh lỗi CORS OPTIONS preflight trên Google Apps Script
  const resp = await fetch(state.webhookUrl, {
    method: "POST",
    redirect: "follow",
    headers: {
      "Content-Type": "text/plain;charset=utf-8"
    },
    body: JSON.stringify(bodyObj)
  });
  const data = await resp.json();
  if (data && data.code === "UNAUTHORIZED" && bodyObj.action !== "bind_v2_auth") {
    handleLogout("🔒 Từ chối truy cập: Vui lòng đăng nhập lại tài khoản Quản trị viên!");
    throw new Error(data.message || "UNAUTHORIZED");
  }
  return data;
}

function showToast(msg, isError = false) {
  const container = document.getElementById("toastContainer");
  const el = document.createElement("div");
  el.className = "toast";
  if (isError) {
    el.style.borderLeftColor = "var(--accent-red)";
  }
  el.textContent = msg;
  container.appendChild(el);
  setTimeout(() => {
    el.remove();
  }, 4000);
}

// ============================================================================
// NAVIGATION
// ============================================================================
function switchTab(tabId) {
  document.querySelectorAll(".tab-panel").forEach(p => p.classList.remove("active"));
  document.querySelectorAll(".nav-tab").forEach(b => b.classList.remove("active"));

  const target = document.getElementById(tabId);
  if (target) target.classList.add("active");

  const btn = document.querySelector(`.nav-tab[data-tab="${tabId}"]`);
  if (btn) btn.classList.add("active");

  if (tabId === "tab-deploy") {
    syncSelectedMacsToDeployBox();
    loadTasksQueue();
  }
}

// ============================================================================
// DATA LOADING & STATUS EVALUATION
// ============================================================================
async function refreshAllData() {
  const lblSync = document.getElementById("lblLastSync");
  lblSync.textContent = "⏳ Đang đồng bộ...";

  try {
    const [devRes, tplRes] = await Promise.all([
      apiGet({ action: "get_devices" }),
      apiGet({ action: "get_templates" })
    ]);

    if (devRes && Array.isArray(devRes.devices)) {
      devRes.devices.forEach((d, idx) => {
        if (d._rawIndex === undefined) {
          d._rawIndex = idx;
        }
      });
      state.devices = mergeDuplicateAnydeskRows(devRes.devices);
    }

    if (tplRes && Array.isArray(tplRes.templates) && tplRes.templates.length > 0) {
      state.templates = tplRes.templates;
      // Tự động đồng bộ cấu hình máy in từ Cloud nếu client chưa có hoặc nếu Cloud có URL mới
      const printerTpl = tplRes.templates.find(t => t.template_name === "sgl_printer_config");
      if (printerTpl) {
        try {
          const parsed = JSON.parse(printerTpl.steps_json);
          const cloudUrl = parsed && parsed[0] && parsed[0].params && parsed[0].params.url;
          if (cloudUrl && cloudUrl.startsWith("http")) {
            const cur = (state.printServerUrl || "").trim();
            if (!cur || (cur.includes("trycloudflare.com") && cur !== cloudUrl)) {
              state.printServerUrl = cloudUrl;
              localStorage.setItem("sgl_print_server_url", cloudUrl);
              const txtInput = document.getElementById("txtPrintServerUrl");
              if (txtInput) txtInput.value = cloudUrl;
            }
          }
        } catch (e) {}
      }
    } else {
      state.templates = DEFAULT_TEMPLATES;
    }

    updateProjectFiltersAndPills();
    renderDeviceTable();
    renderTemplatesUI();

    const nowStr = new Date().toLocaleTimeString("vi-VN");
    lblSync.textContent = `Đã đồng bộ: ${nowStr} (${state.devices.length} box)`;
  } catch (err) {
    console.error("refreshAllData error:", err);
    lblSync.textContent = "⚠️ Lỗi kết nối Cloud";
  }
}

function getDiffMinutes(lastSeenStr) {
  if (!lastSeenStr || lastSeenStr === "Chưa có" || lastSeenStr === "None") {
    return 999999;
  }
  const ts = Date.parse(lastSeenStr);
  if (isNaN(ts)) return 999999;
  const diffMs = Date.now() - ts;
  return Math.max(0, diffMs / 60000);
}

function isPlaceholderMac(mac) {
  const m = String(mac || "").trim().toUpperCase();
  return !m || m === "UNKNOWN" || m.startsWith("CHUA_MAC_") || m.startsWith("BOX_");
}

/**
 * Tự động gộp các dòng chờ CHUA_MAC_<anydesk> (từ Sheet dự án cũ / Thêm Box Lẻ) với dòng MAC thật
 * khi Box được cài App quản lý và gửi tín hiệu đầu tiên có cùng mã AnyDesk.
 */
function mergeDuplicateAnydeskRows(rawDevices) {
  const placeholderByAd = {};
  const realByAd = {};

  rawDevices.forEach(d => {
    const ad = String(d.anydesk_id || "").replace(/[\s\-]/g, "").trim();
    const mac = String(d.mac || "").trim().toUpperCase();
    if (!ad) return;
    if (isPlaceholderMac(mac)) {
      placeholderByAd[ad] = d;
    } else {
      realByAd[ad] = d;
    }
  });

  const mergedList = [];
  rawDevices.forEach(d => {
    const ad = String(d.anydesk_id || "").replace(/[\s\-]/g, "").trim();
    const mac = String(d.mac || "").trim().toUpperCase();
    if (isPlaceholderMac(mac) && ad && realByAd[ad]) {
      // Đã có Box thật cùng mã AnyDesk -> Gộp Dự án, Mã IoT, IMEI, Ghi chú từ dòng chờ sang dòng Box thật
      const realDev = realByAd[ad];
      let needSync = false;
      if (d._rawIndex !== undefined) {
        realDev._rawIndex = Math.max(realDev._rawIndex || 0, d._rawIndex);
      }
      if ((!realDev.project || realDev.project === "Kho thiết bị") && d.project && d.project !== "Kho thiết bị") {
        realDev.project = d.project;
        needSync = true;
      }
      if (!realDev.iot_id && d.iot_id) {
        realDev.iot_id = d.iot_id;
        needSync = true;
      }
      if (!realDev.imei_sim && d.imei_sim) {
        realDev.imei_sim = d.imei_sim;
        needSync = true;
      }
      if (!realDev.notes && d.notes) {
        realDev.notes = d.notes;
        needSync = true;
      }
      if (needSync) {
        apiPost({
          action: "register_device",
          mac: realDev.mac,
          anydesk_id: ad,
          project: realDev.project,
          software: realDev.software || d.software || "Radio 3.6",
          iot_id: realDev.iot_id || "",
          imei_sim: realDev.imei_sim || "",
          notes: realDev.notes || ""
        }).catch(() => {});
      }
      return; // Bỏ qua dòng CHUA_MAC_ trùng lặp
    }
    mergedList.push(d);
  });

  // Chống trùng lặp tuyệt đối (Deduplication) theo cả MAC thật lẫn AnyDesk ID
  const seenMacs = new Set();
  const seenAds = new Set();
  const uniqueList = [];

  mergedList.forEach(d => {
    const mac = String(d.mac || "").trim().toUpperCase();
    const ad = String(d.anydesk_id || "").replace(/[\s\-]/g, "").trim();

    const hasRealMac = !isPlaceholderMac(mac);
    if (hasRealMac && seenMacs.has(mac)) {
      return; // Bỏ qua nếu MAC thật này đã được thêm
    }
    if (ad && seenAds.has(ad)) {
      return; // Bỏ qua nếu AnyDesk ID này đã được thêm
    }

    if (hasRealMac) seenMacs.add(mac);
    if (ad) seenAds.add(ad);
    uniqueList.push(d);
  });

  return uniqueList;
}

function evaluateDeviceStatus(dev) {
  const mins = getDiffMinutes(dev.last_seen);
  if (mins <= 8) {
    return { tag: "online", label: "🟢 Online", mins };
  } else if (mins <= 12) {
    return { tag: "slow", label: "🟡 Chậm", mins };
  } else {
    return { tag: "offline", label: "🔴 Offline", mins };
  }
}

function formatRelativeTime(lastSeenStr, mins) {
  if (!lastSeenStr || mins >= 999999) return "Chưa kết nối";
  if (mins < 1) return "Vừa xong";
  if (mins < 60) return `${Math.floor(mins)} phút trước`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours} giờ trước`;
  const days = Math.floor(hours / 24);
  return `${days} ngày trước`;
}

// ============================================================================
// RENDER DASHBOARD, PROJECT PILLS & TABLE
// ============================================================================
function updateProjectFiltersAndPills() {
  const projCounts = {};
  let cntOnline = 0;
  let cntSlow = 0;
  let cntOffline = 0;

  state.devices.forEach(d => {
    const p = (d.project || "Kho thiết bị").trim();
    projCounts[p] = (projCounts[p] || 0) + 1;

    const st = evaluateDeviceStatus(d);
    if (st.tag === "online") cntOnline++;
    else if (st.tag === "slow") cntSlow++;
    else cntOffline++;
  });

  const projects = Object.keys(projCounts).sort((a, b) => a.localeCompare(b, "vi"));

  // Update KPI Cards
  document.getElementById("kpiTotal").textContent = state.devices.length;
  document.getElementById("kpiOnline").textContent = cntOnline;
  document.getElementById("kpiSlow").textContent = cntSlow;
  document.getElementById("kpiOffline").textContent = cntOffline;
  document.getElementById("kpiProjects").textContent = projects.length;

  // Update Dropdown
  const selProj = document.getElementById("selFilterProject");
  const currentVal = selProj.value || "ALL";
  selProj.innerHTML = `<option value="ALL">📁 Dự án: TẤT CẢ (${state.devices.length})</option>`;
  projects.forEach(p => {
    const opt = document.createElement("option");
    opt.value = p;
    opt.textContent = `📁 ${p} (${projCounts[p]})`;
    selProj.appendChild(opt);
  });
  if (projects.includes(currentVal)) {
    selProj.value = currentVal;
  } else {
    selProj.value = "ALL";
  }

  // Update Datalist in Modals
  const dl = document.getElementById("dlExistingProjects");
  dl.innerHTML = "";
  projects.forEach(p => {
    const opt = document.createElement("option");
    opt.value = p;
    dl.appendChild(opt);
  });

  // Update Project Pills Bar
  const pillsBar = document.getElementById("projectPillsBar");
  const activeProj = selProj.value;
  let pillsHtml = `
    <span class="project-pill ${activeProj === 'ALL' ? 'active' : ''}" onclick="setProjectFilter('ALL')">
      🌐 Tất cả dự án <span class="pill-count">${state.devices.length}</span>
    </span>
  `;
  projects.forEach(p => {
    const isAct = activeProj === p ? "active" : "";
    const safeP = p.replace(/'/g, "\\'");
    pillsHtml += `
      <span class="project-pill ${isAct}" onclick="setProjectFilter('${safeP}')">
        📁 ${escapeHtml(p)} <span class="pill-count">${projCounts[p]}</span>
      </span>
    `;
  });
  pillsBar.innerHTML = pillsHtml;
}

function setProjectFilter(projName) {
  const sel = document.getElementById("selFilterProject");
  sel.value = projName;
  updateProjectFiltersAndPills();
  renderDeviceTable();
}

function onProjectSelectChange() {
  updateProjectFiltersAndPills();
  renderDeviceTable();
}

function setStatusFilter(statusTag) {
  document.getElementById("selFilterStatus").value = statusTag;
  renderDeviceTable();
}

function renderDeviceTable() {
  const q = (document.getElementById("txtSearch").value || "").trim().toLowerCase();
  const fProj = document.getElementById("selFilterProject").value;
  const fSoft = document.getElementById("selFilterSoftware").value;
  const fStat = document.getElementById("selFilterStatus").value;

  const tbody = document.getElementById("deviceTableBody");

  const filtered = state.devices.filter(d => {
    const proj = (d.project || "Kho thiết bị").trim();
    const soft = (d.software || "Radio 3.6").trim();
    const st = evaluateDeviceStatus(d);

    if (fProj !== "ALL" && proj !== fProj) return false;
    if (fSoft !== "ALL" && !soft.toLowerCase().includes(fSoft.toLowerCase())) return false;
    if (fStat !== "ALL" && st.tag !== fStat) return false;

    if (q) {
      const hay = `${d.mac} ${d.anydesk_id} ${d.iot_id || ""} ${proj} ${soft} ${d.mac_ics || ""} ${d.notes || ""}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });

  // Sắp xếp: Box mới thêm luôn ở TRÊN ĐẦU TABLE
  filtered.sort((a, b) => {
    const aMac = (a.mac || "").toUpperCase();
    const bMac = (b.mac || "").toUpperCase();
    const aAd = (a.anydesk_id || "").replace(/\D/g, "");
    const bAd = (b.anydesk_id || "").replace(/\D/g, "");

    // 1. Ưu tiên số 1: Box vừa được thêm mới / đổi dự án trong phiên này (recentlyAddedKeys)
    const aRecent = state.recentlyAddedKeys && (state.recentlyAddedKeys.has(aMac) || (aAd && state.recentlyAddedKeys.has(aAd)));
    const bRecent = state.recentlyAddedKeys && (state.recentlyAddedKeys.has(bMac) || (bAd && state.recentlyAddedKeys.has(bAd)));
    if (aRecent && !bRecent) return -1;
    if (!aRecent && bRecent) return 1;

    // 2. Ưu tiên số 2: Box đang chờ (placeholder MAC: CHUA_MAC_...) luôn xếp trên đầu
    const aPending = isPlaceholderMac(aMac);
    const bPending = isPlaceholderMac(bMac);
    if (aPending && !bPending) return -1;
    if (!aPending && bPending) return 1;

    // Thứ tự thêm vào hệ thống (box mới thêm có _rawIndex cao hơn -> xếp trên)
    const orderDiff = (b._rawIndex ?? 0) - (a._rawIndex ?? 0);

    if (aPending && bPending) {
      return orderDiff;
    }

    // 3. Nếu đang xem một Dự Án cụ thể: xếp box mới thêm vào dự án lên đầu table
    const curProj = document.getElementById("selFilterProject") ? document.getElementById("selFilterProject").value : "ALL";
    if (curProj !== "ALL") {
      return orderDiff;
    }

    // 4. Nếu xem "TẤT CẢ" dự án: Ưu tiên Online -> Chậm -> Offline. Trong cùng nhóm, box mới nhất lên đầu
    const stA = evaluateDeviceStatus(a);
    const stB = evaluateDeviceStatus(b);
    if (stA.tag !== stB.tag) {
      const rank = { online: 0, slow: 1, offline: 2 };
      return rank[stA.tag] - rank[stB.tag];
    }

    return orderDiff;
  });

  state.filteredDevices = filtered;
  updateSelectedCounter();

  if (filtered.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="13" style="text-align:center; padding:32px; color:var(--text-secondary);">
          Không tìm thấy thiết bị nào khớp với bộ lọc hiện tại.
        </td>
      </tr>
    `;
    return;
  }

  let html = "";
  filtered.forEach((d, idx) => {
    const mac = d.mac || "";
    const adId = d.anydesk_id || "";
    const iotId = d.iot_id || "-";
    const proj = d.project || "Kho thiết bị";
    const soft = d.software || "Radio 3.6";
    const ics = d.mac_ics || "-";
    const storage = d.storage_mb ? `${d.storage_mb} MB` : "-";
    const task = d.task_id || "idle";
    const st = evaluateDeviceStatus(d);
    const relTime = formatRelativeTime(d.last_seen, st.mins);
    const isChecked = state.selectedMacs.has(mac);

    const badgeClass =
      st.tag === "online" ? "badge-online" :
      st.tag === "slow" ? "badge-slow" : "badge-offline";

    const safeMac = escapeHtml(mac);
    const safeAd = escapeHtml(adId);
    const safeIot = escapeHtml(iotId);
    const isPendingMac = isPlaceholderMac(mac);
    const isRecent = state.recentlyAddedKeys && (state.recentlyAddedKeys.has(safeMac) || (adId && state.recentlyAddedKeys.has(adId.replace(/\D/g, ""))));

    html += `
      <tr class="${isChecked ? 'selected-row' : ''} ${isRecent ? 'newly-added-row' : ''}">
        <td>
          <input type="checkbox" ${isChecked ? "checked" : ""} onchange="toggleSelectDevice('${safeMac}', this.checked)" />
        </td>
        <td class="mono" style="color:var(--text-muted);">${idx + 1}</td>
        <td><span class="badge ${badgeClass}">${st.label}</span></td>
        <td>
          ${isPendingMac
            ? `<span class="badge badge-slow" title="Đang chờ Box (${safeAd}) gửi tín hiệu lần đầu để tự động điền MAC thật">⏳ Tự lấy MAC khi kết nối</span>`
            : `<span class="copy-chip" onclick="copyText('${safeMac}', 'Đã chép MAC: ${safeMac}')" title="Bấm để sao chép MAC">${safeMac}</span>`
          }
        </td>
        <td>
          <span class="copy-chip" style="color:var(--accent-green); font-weight:700;" onclick="copyText('${safeAd}', 'Đã chép AnyDesk: ${safeAd}')" title="Bấm để sao chép AnyDesk ID">
            ${safeAd || "Chưa có"}
          </span>
        </td>
        <td class="mono">
          <div style="display:inline-flex; align-items:center; gap:6px;">
            ${iotId !== "-" 
              ? `<span class="copy-chip" style="color:var(--accent-cyan); font-weight:700;" onclick="copyText('${safeIot}', 'Đã chép Mã IoT: ${safeIot}')" title="Bấm để sao chép Mã IoT">${safeIot}</span>
                 <span role="button" tabindex="0" style="cursor:pointer; font-size:13px; opacity:0.75; padding:2px 4px; border-radius:4px;" onmouseover="this.style.opacity='1'" onmouseout="this.style.opacity='0.75'" onclick="openEditIotModal('${safeMac}', '${safeAd}', '${escapeHtml(d.iot_id || '')}')" title="Bấm cây bút để sửa Mã IoT">✏️</span>` 
              : `<span role="button" tabindex="0" style="cursor:pointer; color:var(--text-muted); font-size:12px; border-bottom:1px dashed var(--text-muted); padding:1px 4px;" onclick="openEditIotModal('${safeMac}', '${safeAd}', '')" title="Bấm để thêm Mã IoT">➕ Thêm IoT</span>`
            }
          </div>
        </td>
        <td><span class="badge badge-proj">${escapeHtml(proj)}</span></td>
        <td><span class="badge badge-soft">${escapeHtml(soft)}</span></td>
        <td class="mono">
          ${ics !== "-" ? `<span class="copy-chip" onclick="copyText('${escapeHtml(ics)}', 'Đã chép Mã ICS')">${escapeHtml(ics)}</span>` : "-"}
        </td>
        <td title="${escapeHtml(d.last_seen || '')}" style="color:var(--text-secondary);">${relTime}</td>
        <td class="mono" style="color:var(--text-secondary);">${escapeHtml(storage)}</td>
        <td class="mono" style="color:${task !== 'idle' && task !== '' ? 'var(--accent-amber)' : 'var(--text-muted)'};">
          ${escapeHtml(task || "idle")}
        </td>
        <td>
          <div style="display:flex; gap:6px;">
            <button class="btn btn-primary btn-sm" onclick="connectAnyDesk('${safeAd}')" title="Mở AnyDesk & tự nạp mật khẩu ${state.adPass}">
              💻 AnyDesk
            </button>
            <button class="btn btn-outline btn-sm" onclick="quickAssignSingle('${safeMac}')" title="Đổi dự án">
              📁 Dự án
            </button>
            <button class="btn btn-success btn-sm" onclick="printDeviceLabel('${safeAd}', '${safeIot}')" title="In tem dán vỏ Box (AiYin D11S)">
              🖨️ In Tem
            </button>
          </div>
        </td>
      </tr>
    `;
  });

  tbody.innerHTML = html;
}

// ============================================================================
// SELECTION & CLIPBOARD
// ============================================================================
function toggleSelectDevice(mac, checked) {
  if (checked) state.selectedMacs.add(mac);
  else state.selectedMacs.delete(mac);
  updateSelectedCounter();
  renderDeviceTable();
}

function toggleSelectAll(checked) {
  if (checked) {
    state.filteredDevices.forEach(d => {
      if (d.mac) state.selectedMacs.add(d.mac);
    });
  } else {
    state.filteredDevices.forEach(d => {
      if (d.mac) state.selectedMacs.delete(d.mac);
    });
  }
  updateSelectedCounter();
  renderDeviceTable();
}

function updateSelectedCounter() {
  const cnt = state.selectedMacs.size;
  document.getElementById("lblSelectedCount").textContent = `Đã chọn: ${cnt}`;
  const badge = document.getElementById("deploySelectedBadge");
  if (badge) badge.textContent = `${cnt} thiết bị được chọn`;
}

async function copyText(text, msg) {
  if (!text) return;
  try {
    await navigator.clipboard.writeText(text);
    showToast(msg || `Đã sao chép: ${text}`);
  } catch (e) {
    showToast(`Đã chọn: ${text}`);
  }
}

// ============================================================================
// ANYDESK LAUNCHER (LOCAL HELPER + URI FALLBACK)
// ============================================================================
async function connectAnyDesk(adId) {
  if (!adId || adId === "Chưa có") {
    showToast("Thiết bị này chưa có mã AnyDesk ID!", true);
    return;
  }
  const cleanId = adId.replace(/\D/g, "");
  if (!cleanId) {
    showToast("Mã AnyDesk ID không hợp lệ!", true);
    return;
  }

  // Luôn chép sẵn mật khẩu vào clipboard
  try {
    await navigator.clipboard.writeText(state.adPass);
  } catch (e) {}

  // Thử gọi Local Python Web Server (/api/open_anydesk) nếu đang chạy trên PC
  try {
    const resp = await fetch("/api/open_anydesk", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ anydesk_id: cleanId, password: state.adPass })
    });
    if (resp.ok) {
      const data = await resp.json();
      if (data.status === "ok") {
        showToast(`🚀 Đang mở AnyDesk ${cleanId} (Đã tự nạp mật khẩu ${state.adPass})`);
        return;
      }
    }
  } catch (err) {
    // Nếu đang mở file trực tiếp hoặc qua GitHub Pages -> dùng URI protocol anydesk:
  }

  showToast(`💻 Đang mở AnyDesk ${cleanId} (Đã chép sẵn mật khẩu ${state.adPass} vào Clipboard)`);
  window.location.href = `anydesk:${cleanId}`;
}

// ============================================================================
// ASSIGN PROJECT MODAL
// ============================================================================
function openAssignProjectModal() {
  if (state.selectedMacs.size === 0) {
    showToast("Vui lòng tick chọn ít nhất 1 thiết bị trong bảng!", true);
    return;
  }
  document.getElementById("lblModalAssignCount").textContent = `${state.selectedMacs.size} thiết bị`;
  document.getElementById("modalAssignProject").classList.add("open");
}

function quickAssignSingle(mac) {
  state.selectedMacs.clear();
  state.selectedMacs.add(mac);
  updateSelectedCounter();
  renderDeviceTable();
  openAssignProjectModal();
}

function closeModal(modalId) {
  document.getElementById(modalId).classList.remove("open");
}

async function confirmAssignProject() {
  const projName = (document.getElementById("txtModalProjectName").value || "").trim();
  const software = document.getElementById("selModalSoftware").value;
  if (!projName) {
    showToast("Vui lòng nhập tên Dự án!", true);
    return;
  }

  const macs = Array.from(state.selectedMacs);
  closeModal("modalAssignProject");
  showToast(`⏳ Đang gán ${macs.length} thiết bị vào dự án '${projName}'...`);

  try {
    const res = await apiPost({
      action: "assign_project",
      project: projName,
      software: software,
      target_macs: macs
    });
    if (res && res.status === "ok") {
      macs.forEach(m => state.recentlyAddedKeys.add(String(m).toUpperCase()));
      showToast(`✔ Đã cập nhật ${macs.length} thiết bị vào dự án '${projName}'!`);
      if (projName && projName !== "ALL") {
        setProjectFilter(projName);
      }
      refreshAllData();
    } else {
      showToast(`❌ Lỗi: ${(res && res.message) || "Không thể cập nhật dự án"}`, true);
    }
  } catch (err) {
    showToast(`❌ Lỗi kết nối khi gán dự án: ${err.message}`, true);
  }
}

// ============================================================================
// EDIT IOT ID MODAL
// ============================================================================
function openEditIotModal(mac, anydeskId, currentIot) {
  const cleanAd = String(anydeskId || "").trim();
  const cleanMac = String(mac || "").trim();
  const cleanIot = (currentIot && currentIot !== "-") ? String(currentIot).trim() : "";

  document.getElementById("hidEditIotMac").value = cleanMac;
  document.getElementById("hidEditIotAnydesk").value = cleanAd;

  const devTitle = cleanAd 
    ? `AnyDesk: ${cleanAd} ${cleanMac && !isPlaceholderMac(cleanMac) ? `(${cleanMac})` : ""}`
    : `MAC: ${cleanMac}`;
  document.getElementById("lblEditIotDevice").textContent = devTitle;

  const inputEl = document.getElementById("txtEditIotValue");
  inputEl.value = cleanIot;
  document.getElementById("modalEditIot").classList.add("open");

  setTimeout(() => {
    inputEl.focus();
    inputEl.select();
  }, 100);
}

async function confirmSaveEditIot() {
  const mac = (document.getElementById("hidEditIotMac").value || "").trim();
  const anydeskId = (document.getElementById("hidEditIotAnydesk").value || "").trim();
  const newIot = (document.getElementById("txtEditIotValue").value || "").trim();

  if (!anydeskId && !mac) {
    showToast("Không tìm thấy thông tin thiết bị để lưu!", true);
    return;
  }

  const btn = document.getElementById("btnSaveEditIot");
  btn.disabled = true;
  btn.textContent = "⏳ Đang lưu...";

  try {
    const res = await apiPost({
      action: "update_iot_id",
      mac: mac,
      anydesk_id: anydeskId,
      iot_id: newIot
    });

    if (res && res.status === "ok") {
      state.devices.forEach(d => {
        const dAd = String(d.anydesk_id || "").replace(/[\s\-]/g, "").trim();
        const dMac = String(d.mac || "").replace(/[:\-]/g, "").toUpperCase();
        if ((anydeskId && dAd === anydeskId) || (mac && dMac === mac)) {
          d.iot_id = newIot;
        }
      });
      if (anydeskId) state.recentlyAddedKeys.add(anydeskId.replace(/\D/g, ""));
      if (mac && !isPlaceholderMac(mac)) state.recentlyAddedKeys.add(mac.toUpperCase());

      closeModal("modalEditIot");
      showToast(`✔ Đã cập nhật Mã IoT: ${newIot || "(Đã xóa)"} cho Box ${anydeskId || mac}!`);
      renderDeviceTable();
    } else {
      showToast(`❌ Lỗi: ${(res && res.message) || "Không thể cập nhật Mã IoT"}`, true);
    }
  } catch (err) {
    showToast(`❌ Lỗi kết nối: ${err.message}`, true);
  } finally {
    btn.disabled = false;
    btn.textContent = "✔ Lưu Mã IoT";
  }
}

// ============================================================================
// ADD DEVICE MODAL
// ============================================================================
function openAddDeviceModal() {
  document.getElementById("txtAddMac").value = "";
  document.getElementById("txtAddAnydesk").value = "";
  document.getElementById("txtAddIot").value = "";
  document.getElementById("txtAddIcs").value = "";
  document.getElementById("txtAddImei").value = "";
  document.getElementById("txtAddNotes").value = "";
  const hint = document.getElementById("lblAutoMacHint");
  if (hint) {
    hint.style.color = "var(--accent-cyan)";
    hint.textContent = "⚡ Chỉ cần nhập Mã AnyDesk & Mã IoT, hệ thống sẽ tự động lấy MAC thật ngay lần đầu Box kết nối!";
  }
  document.getElementById("modalAddDevice").classList.add("open");
}

function onAddAnydeskInput(val) {
  const cleanAd = String(val || "").replace(/[\s\-]/g, "").trim();
  const macInput = document.getElementById("txtAddMac");
  const hint = document.getElementById("lblAutoMacHint");
  if (!cleanAd) {
    if (hint) {
      hint.style.color = "var(--accent-cyan)";
      hint.textContent = "⚡ Chỉ cần nhập Mã AnyDesk & Mã IoT, hệ thống sẽ tự động lấy MAC thật ngay lần đầu Box kết nối!";
    }
    return;
  }

  const found = state.devices.find(d => {
    const dAd = String(d.anydesk_id || "").replace(/[\s\-]/g, "").trim();
    return dAd === cleanAd && !isPlaceholderMac(d.mac);
  });

  if (found) {
    macInput.value = found.mac;
    if (!document.getElementById("txtAddIot").value && found.iot_id) {
      document.getElementById("txtAddIot").value = found.iot_id;
    }
    if (hint) {
      hint.style.color = "var(--accent-green)";
      hint.textContent = `✅ Đã tự động lấy MAC thật (${found.mac}) từ dữ liệu Box đã kết nối!`;
    }
  } else {
    if (hint) {
      hint.style.color = "var(--accent-cyan)";
      hint.textContent = "⚡ Không cần nhập MAC — Khi cài 00_AutoSetup.apk lên Box này, MAC thật sẽ tự động điền ngay lần đầu kết nối!";
    }
  }
}

async function confirmAddDevice() {
  let mac = (document.getElementById("txtAddMac").value || "").trim().replace(/[:\-]/g, "").toUpperCase();
  const adId = (document.getElementById("txtAddAnydesk").value || "").replace(/[\s\-]/g, "").trim();
  const iotId = (document.getElementById("txtAddIot").value || "").trim();
  const proj = (document.getElementById("txtAddProject").value || "Kho thiết bị").trim();
  const soft = document.getElementById("selAddSoftware").value;
  const ics = (document.getElementById("txtAddIcs").value || "").trim();
  const imei = (document.getElementById("txtAddImei").value || "").trim();
  const notes = (document.getElementById("txtAddNotes").value || "").trim();

  if (!adId && !mac) {
    showToast("Vui lòng nhập Mã AnyDesk ID!", true);
    return;
  }
  if (!mac && adId) {
    // Kiểm tra xem Box có mã AnyDesk này đã từng gửi MAC thật lên hệ thống chưa
    const existing = state.devices.find(d => {
      const dAd = String(d.anydesk_id || "").replace(/[\s\-]/g, "").trim();
      return dAd === adId && !isPlaceholderMac(d.mac);
    });
    mac = existing ? existing.mac : `CHUA_MAC_${adId}`;
  }

  closeModal("modalAddDevice");
  showToast(`⏳ Đang đăng ký thiết bị ${adId || mac}...`);

  try {
    const res = await apiPost({
      action: "register_device",
      mac: mac,
      anydesk_id: adId,
      iot_id: iotId,
      project: proj,
      software: soft,
      mac_ics: ics,
      imei_sim: imei,
      notes: notes
    });
    if (res && res.status === "ok") {
      if (mac) state.recentlyAddedKeys.add(mac.toUpperCase());
      if (adId) state.recentlyAddedKeys.add(adId.replace(/\D/g, ""));
      const returnedMac = res.mac && !isPlaceholderMac(res.mac) ? ` | MAC: ${res.mac}` : " (Sẽ tự điền MAC khi Box kết nối)";
      showToast(`✔ Đã lưu AnyDesk ${adId}${returnedMac} lên Google Sheet!`);
      if (proj && proj !== "ALL") {
        setProjectFilter(proj);
      }
      refreshAllData();
    } else {
      showToast(`❌ Lỗi: ${(res && res.message) || "Không thể lưu thiết bị"}`, true);
    }
  } catch (err) {
    showToast(`❌ Lỗi kết nối: ${err.message}`, true);
  }
}

function openBulkImportOldProjectModal() {
  document.getElementById("txtBulkOldProjectName").value = "";
  document.getElementById("txtBulkOldAnydeskList").value = "";
  document.getElementById("modalBulkImportOldProject").classList.add("open");
}

async function confirmBulkImportOldProject() {
  const projName = document.getElementById("txtBulkOldProjectName").value.trim();
  const defaultSoft = document.getElementById("selBulkOldSoftware").value;
  const rawText = document.getElementById("txtBulkOldAnydeskList").value || "";

  if (!projName) {
    showToast("Vui lòng nhập Tên Dự Án (Tên Sheet mới cần tạo)!", true);
    return;
  }

  // Trích xuất tất cả các mã AnyDesk (8-11 chữ số) từ nội dung dán vào
  const lines = rawText.split(/[\r\n,;]+/);
  const adSet = new Set();
  lines.forEach(line => {
    const cleaned = line.replace(/[\s\-]/g, "").trim();
    if (/^\d{8,11}$/.test(cleaned)) {
      adSet.add(cleaned);
    } else {
      const m = line.match(/\b(\d[\d\s]{7,13}\d)\b/);
      if (m) {
        const digits = m[1].replace(/\s+/g, "");
        if (/^\d{8,11}$/.test(digits)) adSet.add(digits);
      }
    }
  });

  const adList = Array.from(adSet);
  if (adList.length === 0) {
    showToast("Không tìm thấy mã AnyDesk hợp lệ nào (8–11 chữ số) trong danh sách vừa dán!", true);
    return;
  }

  const btn = document.getElementById("btnConfirmBulkOld");
  btn.disabled = true;
  btn.textContent = `⏳ Đang tạo Sheet & nạp ${adList.length} mã AnyDesk...`;

  try {
    // Kiểm tra xem có mã AnyDesk nào đã có MAC thật trên hệ thống chưa để giữ nguyên MAC thật
    const existingByAd = {};
    state.devices.forEach(d => {
      const cleanAd = String(d.anydesk_id || "").replace(/[\s\-]/g, "").trim();
      if (cleanAd) existingByAd[cleanAd] = d;
    });

    const devicesPayload = adList.map(ad => {
      const ex = existingByAd[ad];
      const realMac = ex && ex.mac && !String(ex.mac).startsWith("CHUA_MAC_") ? ex.mac : `CHUA_MAC_${ad}`;
      const soft = ex && ex.software && ex.software !== "Chưa đồng bộ" ? ex.software : defaultSoft;
      return {
        mac: realMac,
        anydesk_id: ad,
        project: projName,
        software: soft,
        status: ex ? ex.status : "offline",
        last_seen: ex ? ex.last_seen : "",
        mac_ics: ex ? ex.mac_ics : ""
      };
    });

    const res = await apiPost({
      action: "batch_import_devices",
      devices: devicesPayload
    });

    if (res && res.status === "ok") {
      adList.forEach(ad => state.recentlyAddedKeys.add(String(ad).replace(/\D/g, "")));
      closeModal("modalBulkImportOldProject");
      showToast(`✔ Đã tạo Sheet dự án "${projName}" với ${adList.length} mã AnyDesk!`);
      setProjectFilter(projName);
      await refreshAllData();
    } else {
      showToast(`❌ Lỗi nạp danh sách: ${(res && res.message) || "Không xác định"}`, true);
    }
  } catch (err) {
    showToast(`❌ Lỗi kết nối: ${err.message}`, true);
  } finally {
    btn.disabled = false;
    btn.textContent = "📥 Tạo Sheet Dự Án & Nạp Mã AnyDesk";
  }
}

// ============================================================================
// REMOTE DEPLOYMENT (STAGE 2) & TASKS QUEUE
// ============================================================================
function openQuickDeployModal() {
  if (state.selectedMacs.size === 0) {
    showToast("Vui lòng tick chọn các thiết bị cần chốt dự án từ xa!", true);
    return;
  }
  switchTab("tab-deploy");
}

function syncSelectedMacsToDeployBox() {
  const macs = Array.from(state.selectedMacs);
  if (macs.length > 0) {
    document.getElementById("txtDeployTargetMacs").value = macs.join(", ");
  }
}

function fillOnlineMacsToDeploy() {
  const onlineMacs = state.devices
    .filter(d => evaluateDeviceStatus(d).tag === "online")
    .map(d => d.mac)
    .filter(Boolean);
  document.getElementById("txtDeployTargetMacs").value = onlineMacs.join(", ");
  showToast(`Đã điền ${onlineMacs.length} máy đang Online vào danh sách triển khai.`);
}

function renderTemplatesUI() {
  const sel = document.getElementById("selDeployTemplate");
  const prevVal = sel.value;
  sel.innerHTML = "";

  state.templates.forEach(t => {
    const opt = document.createElement("option");
    opt.value = t.template_name;
    opt.textContent = `${t.template_name} — ${t.description || ""}`;
    sel.appendChild(opt);
  });

  if (prevVal && state.templates.some(t => t.template_name === prevVal)) {
    sel.value = prevVal;
  }
  onDeployTemplateChange();

  // Render danh sách bên tab Builder
  const listEl = document.getElementById("templateListContainer");
  if (listEl) {
    listEl.innerHTML = state.templates.map(t => `
      <div style="padding:12px; background:var(--bg-input); border:1px solid var(--border-subtle); border-radius:8px; display:flex; justify-content:space-between; align-items:center; gap:10px;">
        <div>
          <div class="mono" style="color:var(--accent-cyan); font-weight:700;">${escapeHtml(t.template_name)}</div>
          <div style="font-size:12px; color:var(--text-secondary);">${escapeHtml(t.description || "")}</div>
        </div>
        <button class="btn btn-outline btn-sm" onclick="loadTemplateIntoBuilder('${escapeHtml(t.template_name)}')">
          ✏️ Sửa
        </button>
      </div>
    `).join("");
  }
}

function onDeployTemplateChange() {
  const selName = document.getElementById("selDeployTemplate").value;
  const tpl = state.templates.find(t => t.template_name === selName);
  if (tpl) {
    document.getElementById("lblTemplateDesc").textContent = tpl.description || "Không có mô tả";
    try {
      const parsed = JSON.parse(tpl.steps_json || "[]");
      document.getElementById("txtDeployStepsPreview").value = JSON.stringify(parsed, null, 2);
    } catch (e) {
      document.getElementById("txtDeployStepsPreview").value = tpl.steps_json || "[]";
    }
  }
}

async function executeRemoteDeploy() {
  const tplName = document.getElementById("selDeployTemplate").value;
  const rawMacs = document.getElementById("txtDeployTargetMacs").value || "";
  const macList = rawMacs.split(/[\s,;]+/).map(s => s.trim()).filter(Boolean);

  if (!tplName) {
    showToast("Vui lòng chọn một kịch bản triển khai!", true);
    return;
  }
  if (macList.length === 0) {
    showToast("Vui lòng chọn hoặc nhập ít nhất 1 địa chỉ MAC mục tiêu!", true);
    return;
  }

  const tplObj = state.templates.find(t => t.template_name === tplName) || {};
  const btn = document.getElementById("btnExecuteDeploy");
  btn.disabled = true;
  btn.textContent = "⏳ Đang gửi lệnh lên Google Sheet...";

  try {
    let res = await apiPost({
      action: "create_task",
      template_name: tplName,
      target_macs: macList,
      steps_json: tplObj.steps_json || "[]",
      description: tplObj.description || ""
    });

    // Tự động lưu template nếu Sheet báo chưa có template
    if (res && res.status === "error" && String(res.message || "").toLowerCase().includes("template")) {
      await apiPost({
        action: "save_template",
        template_name: tplName,
        steps_json: tplObj.steps_json || "[]",
        description: tplObj.description || ""
      });
      res = await apiPost({
        action: "create_task",
        template_name: tplName,
        target_macs: macList
      });
    }

    if (res && res.status === "ok") {
      const ids = res.task_ids || [];
      showToast(`🎉 Đã tạo thành công ${ids.length} nhiệm vụ từ xa cho kịch bản '${tplName}'!`);
      loadTasksQueue();
      refreshAllData();
    } else {
      showToast(`❌ Lỗi tạo task: ${(res && res.message) || "Không xác định"}`, true);
    }
  } catch (err) {
    showToast(`❌ Lỗi kết nối: ${err.message}`, true);
  } finally {
    btn.disabled = false;
    btn.textContent = "🚀 PHÁT LỆNH TRIỂN KHAI LÊN CLOUD SHEET";
  }
}

async function loadTasksQueue() {
  const tbody = document.getElementById("tasksTableBody");
  try {
    const res = await apiGet({ action: "get_tasks" });
    const tasks = (res && Array.isArray(res.tasks)) ? res.tasks.slice().reverse() : [];
    state.tasks = tasks;

    if (tasks.length === 0) {
      tbody.innerHTML = `<tr><td colspan="5" style="text-align:center; padding:24px; color:var(--text-secondary);">Chưa có nhiệm vụ nào trên Sheet.</td></tr>`;
      return;
    }

    tbody.innerHTML = tasks.map(t => {
      const st = String(t.status || "").toLowerCase();
      const badge =
        st === "completed" ? "badge-online" :
        st === "claimed" || st === "pending" ? "badge-slow" : "badge-offline";
      return `
        <tr>
          <td class="mono">${escapeHtml(t.task_id || "")}</td>
          <td class="mono">${escapeHtml(t.target_mac || "")}</td>
          <td class="mono" style="color:var(--accent-cyan);">${escapeHtml(t.template_name || "")}</td>
          <td><span class="badge ${badge}">${escapeHtml(t.status || "")}</span></td>
          <td style="max-width:260px; overflow:hidden; text-overflow:ellipsis;" title="${escapeHtml(t.result || '')}">
            ${escapeHtml(t.result || "-")}
          </td>
        </tr>
      `;
    }).join("");
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="5" style="text-align:center; color:var(--accent-red);">Lỗi tải hàng đợi Task</td></tr>`;
  }
}

// ============================================================================
// TEMPLATE BUILDER
// ============================================================================
function loadTemplateIntoBuilder(tplName) {
  const tpl = state.templates.find(t => t.template_name === tplName);
  if (!tpl) return;
  document.getElementById("txtBuilderName").value = tpl.template_name;
  document.getElementById("txtBuilderDesc").value = tpl.description || "";
  try {
    document.getElementById("txtBuilderJson").value = JSON.stringify(JSON.parse(tpl.steps_json || "[]"), null, 2);
  } catch (e) {
    document.getElementById("txtBuilderJson").value = tpl.steps_json || "[]";
  }
  showToast(`Đã nạp kịch bản '${tplName}' vào trình chỉnh sửa.`);
}

function addBuilderStep(actionType) {
  const editor = document.getElementById("txtBuilderJson");
  let steps = [];
  try {
    steps = JSON.parse(editor.value || "[]");
    if (!Array.isArray(steps)) steps = [];
  } catch (e) {
    steps = [];
  }

  const samples = {
    install_apk: { action: "install_apk", params: { file: "radio.apk" } },
    uninstall_pkg: { action: "uninstall_pkg", params: { package: "vn.phitn.app.radiostation" } },
    shell_cmd: { action: "shell_cmd", params: { cmd: "am force-stop vn.phitn.app.radiostation" } },
    start_app: { action: "start_app", params: { package: "com.app.ics_content_management" } },
    extract_ics_mac: { action: "extract_ics_mac", params: { package: "com.app.ics_content_management" } },
    report_field: { action: "report_field", params: { field: "software", value: "VNPT ICS" } },
    download_apk: { action: "download_apk", params: { url: "https://example.com/app.apk", save_as: "app.apk" } }
  };

  if (samples[actionType]) {
    steps.push(samples[actionType]);
    editor.value = JSON.stringify(steps, null, 2);
  }
}

async function saveCustomTemplate() {
  const name = (document.getElementById("txtBuilderName").value || "").trim();
  const desc = (document.getElementById("txtBuilderDesc").value || "").trim();
  const rawJson = (document.getElementById("txtBuilderJson").value || "").trim();

  if (!name) {
    showToast("Vui lòng nhập Tên kịch bản!", true);
    return;
  }
  try {
    JSON.parse(rawJson);
  } catch (e) {
    showToast("Nội dung JSON Steps không đúng cú pháp!", true);
    return;
  }

  showToast(`⏳ Đang lưu kịch bản '${name}' lên Google Sheet...`);
  try {
    const res = await apiPost({
      action: "save_template",
      template_name: name,
      steps_json: rawJson,
      description: desc
    });
    if (res && res.status === "ok") {
      showToast(`✔ Đã lưu kịch bản '${name}' thành công!`);
      refreshAllData();
    } else {
      showToast(`❌ Lỗi lưu kịch bản: ${(res && res.message) || ""}`, true);
    }
  } catch (err) {
    showToast(`❌ Lỗi kết nối: ${err.message}`, true);
  }
}

// ============================================================================
// CLOUD SHEET SYNC & CSV EXPORT
// ============================================================================
async function syncSheetsOnCloud() {
  showToast("⏳ Đang yêu cầu Google Sheet tách các Sheet Dự Án & Sheet Final...");
  try {
    const res = await apiPost({ action: "sync_project_sheets" });
    if (res && res.status === "ok") {
      showToast(`✔ Đã tách & đồng bộ thành công ${res.total_devices || ""} thiết bị vào các Sheet Dự Án!`);
    } else {
      showToast("⚠️ Đã gửi yêu cầu đồng bộ Sheet.");
    }
  } catch (err) {
    showToast(`❌ Lỗi đồng bộ Sheet: ${err.message}`, true);
  }
}

function exportCurrentViewCsv() {
  if (!state.filteredDevices || state.filteredDevices.length === 0) {
    showToast("Không có dữ liệu để xuất!", true);
    return;
  }
  const headers = ["STT", "MAC", "AnyDesk_ID", "Ma_IoT", "Du_An", "Phan_Mem", "Ma_ICS", "IMEI_SIM", "Trang_Thai", "Lan_Cuoi_Online", "Bo_Nho_MB", "Ghi_Chu"];
  const rows = state.filteredDevices.map((d, i) => {
    const st = evaluateDeviceStatus(d);
    return [
      i + 1,
      d.mac || "",
      d.anydesk_id || "",
      `"${(d.iot_id || "").replace(/"/g, '""')}"`,
      `"${(d.project || "").replace(/"/g, '""')}"`,
      `"${(d.software || "").replace(/"/g, '""')}"`,
      d.mac_ics || "",
      `"${(d.imei_sim || "").replace(/"/g, '""')}"`,
      st.tag,
      d.last_seen || "",
      d.storage_mb || "",
      `"${(d.notes || "").replace(/"/g, '""')}"`
    ].join(",");
  });

  const csvContent = "\uFEFF" + headers.join(",") + "\n" + rows.join("\n");
  const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  const projFilter = document.getElementById("selFilterProject").value;
  const safeName = projFilter === "ALL" ? "Tat_Ca_Du_An" : projFilter.replace(/\s+/g, "_");
  a.href = url;
  a.download = `SGL_Danh_Sach_${safeName}.csv`;
  a.click();
  URL.revokeObjectURL(url);
  showToast(`📥 Đã xuất ${state.filteredDevices.length} thiết bị ra file CSV!`);
}

// ============================================================================
// REMOTE THERMAL PRINT (AIYIN D11S VIA CLOUDFLARE TUNNEL / LOCALHOST)
// ============================================================================
async function printDeviceLabel(anydeskId, iotId) {
  const adClean = String(anydeskId || "").trim();
  if (!adClean || adClean === "Chưa có") {
    showToast("❌ Box chưa có AnyDesk ID để tạo mã vạch in!");
    return false;
  }

  let finalIot = String(iotId || "").trim();
  if (!finalIot || finalIot === "-") {
    const userVal = prompt(`Box AnyDesk: ${adClean}\nNhập Mã IoT để in lên tem (VD: 11250):`, "");
    if (userVal === null) return false;
    finalIot = userVal.trim();
    if (finalIot) {
      // Tự động lưu Mã IoT vừa nhập lên Google Sheet / PocketBase
      apiPost({
        action: "update_iot_id",
        anydesk_id: adClean,
        iot_id: finalIot
      }).then(() => {
        state.devices.forEach(d => {
          if (String(d.anydesk_id || "").replace(/[\s\-]/g, "") === adClean) d.iot_id = finalIot;
        });
        renderDeviceTable();
      }).catch(() => {});
    }
  }

  // Xác định địa chỉ máy in (Print Server)
  let targetServer = (state.printServerUrl || "").trim();
  if (!targetServer) {
    if (window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1") {
      targetServer = window.location.origin;
    } else {
      const inputUrl = prompt(
        "Chưa cấu hình Link Máy In Cục Bộ (Cloudflare Tunnel HTTPS)!\nVui lòng dán link Cloudflare do máy tính xưởng cung cấp (VD: https://xxxx.trycloudflare.com):",
        ""
      );
      if (!inputUrl || !inputUrl.trim()) return false;
      targetServer = inputUrl.trim().replace(/\/+$/, "");
      state.printServerUrl = targetServer;
      localStorage.setItem("sgl_print_server_url", targetServer);
      if (document.getElementById("txtPrintServerUrl")) {
        document.getElementById("txtPrintServerUrl").value = targetServer;
      }
    }
  }
  targetServer = targetServer.replace(/\/+$/, "");

  showToast(`⏳ Đang gửi lệnh in tem: AnyDesk ${adClean} (IoT: ${finalIot || "---"})...`);

  try {
    const resp = await fetch(`${targetServer}/api/print_label`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ anydesk_id: adClean, iot_id: finalIot })
    });
    const result = await resp.json();
    if (result.status === "ok") {
      showToast(`🖨️ In tem thành công cho Box ${adClean}!`);
      return true;
    } else {
      showToast(`❌ Lỗi máy in: ${result.message || "Không thể in"}`);
      return false;
    }
  } catch (err) {
    showToast(`❌ Không thể kết nối tới Máy in (${targetServer}): ${err.message}`);
    return false;
  }
}

async function printSelectedDevices() {
  if (!state.selectedMacs || state.selectedMacs.size === 0) {
    showToast("⚠️ Vui lòng tick chọn [X] ít nhất 1 box để in tem!");
    return;
  }

  const selectedList = state.devices.filter(d => state.selectedMacs.has(d.mac));
  if (selectedList.length === 0) return;

  if (!confirm(`Bạn có chắc chắn muốn in tem cho ${selectedList.length} box đã chọn qua máy in AiYin D11S?`)) {
    return;
  }

  let count = 0;
  for (const dev of selectedList) {
    const ad = dev.anydesk_id || "";
    const iot = dev.iot_id || "";
    if (ad && ad !== "Chưa có") {
      const ok = await printDeviceLabel(ad, iot);
      if (ok) count++;
      // Delay nhỏ giữa các lệnh in
      await new Promise(r => setTimeout(r, 600));
    }
  }
  showToast(`✅ Đã gửi lệnh in cho ${count} / ${selectedList.length} box!`);
}

// ============================================================================
// SETTINGS
// ============================================================================
function saveSettings() {
  const defaultAdPass = getDecryptedDefaultAdPass();

  const selBackend = document.getElementById("selBackendType");
  if (selBackend) {
    state.backendType = selBackend.value;
    localStorage.setItem("sgl_backend_type", state.backendType);
  }

  const txtPbUrl = document.getElementById("txtPocketBaseUrl");
  if (txtPbUrl) {
    state.pocketbaseUrl = txtPbUrl.value.trim().replace(/\/+$/, "");
    localStorage.setItem("sgl_pb_url", state.pocketbaseUrl);
  }

  const txtPbSec = document.getElementById("txtPocketBaseSecret");
  if (txtPbSec) {
    state.pocketbaseSecret = txtPbSec.value.trim();
    localStorage.setItem("sgl_pb_secret", state.pocketbaseSecret);
  }

  state.webhookUrl = (document.getElementById("txtWebhookUrl").value || DEFAULT_WEBHOOK_URL).trim();
  state.sheetUrl = (document.getElementById("txtSheetUrl").value || DEFAULT_SHEET_URL).trim();
  state.adPass = (document.getElementById("txtDefaultAdPass").value || defaultAdPass).trim();

  const printUrlInput = document.getElementById("txtPrintServerUrl");
  if (printUrlInput) {
    state.printServerUrl = printUrlInput.value.trim().replace(/\/+$/, "");
    if (state.printServerUrl) {
      localStorage.setItem("sgl_print_server_url", state.printServerUrl);
      apiPost({
        action: "save_template",
        template_name: "sgl_printer_config",
        steps_json: JSON.stringify([{ action: "printer_server", params: { url: state.printServerUrl } }]),
        description: "Cấu hình máy in nhãn nhiệt AiYin D11S từ xa (Cloudflare Tunnel)"
      }).then(res => {
        if (res && res.status === "ok") {
          showToast("☁️ Đã đồng bộ máy in lên Cloud cho tất cả người dùng!");
        }
      }).catch(err => console.warn("Lỗi đồng bộ printer template:", err));
    } else {
      localStorage.removeItem("sgl_print_server_url");
    }
  }

  localStorage.setItem("sgl_webhook_url", state.webhookUrl);
  localStorage.setItem("sgl_sheet_url", state.sheetUrl);
  if (state.adPass && state.adPass !== defaultAdPass) {
    localStorage.setItem("sgl_ad_pass", state.adPass);
  } else {
    localStorage.removeItem("sgl_ad_pass");
  }
  document.getElementById("btnOpenSheetTop").href = state.sheetUrl;

  updateBackendUI();
  if (state.backendType === "pocketbase") {
    initPocketBaseSSE();
  } else if (pbEventSource) {
    try { pbEventSource.close(); } catch(e) {}
    pbEventSource = null;
  }

  showToast("✔ Đã lưu cấu hình hệ thống!");
  refreshAllData();
}

function resetDefaultSettings() {
  localStorage.removeItem("sgl_backend_type");
  localStorage.removeItem("sgl_pb_url");
  localStorage.removeItem("sgl_pb_secret");
  localStorage.removeItem("sgl_webhook_url");
  localStorage.removeItem("sgl_sheet_url");
  localStorage.removeItem("sgl_ad_pass");
  localStorage.removeItem("sgl_print_server_url");

  state.backendType = "pocketbase";
  state.pocketbaseUrl = "http://127.0.0.1:8090";
  state.pocketbaseSecret = "sgl_secret_token_2026";
  state.webhookUrl = DEFAULT_WEBHOOK_URL;
  state.sheetUrl = DEFAULT_SHEET_URL;
  state.adPass = getDecryptedDefaultAdPass();
  state.printServerUrl = "";

  updateBackendUI();
  document.getElementById("txtWebhookUrl").value = state.webhookUrl;
  document.getElementById("txtSheetUrl").value = state.sheetUrl;
  document.getElementById("txtDefaultAdPass").value = state.adPass;
  if (document.getElementById("txtPrintServerUrl")) {
    document.getElementById("txtPrintServerUrl").value = "";
  }
  document.getElementById("btnOpenSheetTop").href = state.sheetUrl;

  showToast("🔄 Đã khôi phục cấu hình mặc định!");
  refreshAllData();
}

function escapeHtml(str) {
  return String(str || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}
