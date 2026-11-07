// ============================================================================
// SGL SMART BROADCAST CLOUD — FRONTEND APPLICATION LOGIC
// ============================================================================

const DEFAULT_WEBHOOK_URL = "https://script.google.com/macros/s/AKfycbxqawYpW8SebK0EK21Cl7C2uw6vN3-Jr7vQIHSAbNxtwXA5H7c_lYRNhXuB7104P0NN/exec";
const DEFAULT_SHEET_URL = "https://docs.google.com/spreadsheets/d/1-7ZrYTDnoL68BNB7D9QQWxhDGcGNXW3VVfdedAtejAg/edit";
const DEFAULT_ANYDESK_PASS = "12345678j";

let state = {
  webhookUrl: localStorage.getItem("sgl_webhook_url") || DEFAULT_WEBHOOK_URL,
  sheetUrl: localStorage.getItem("sgl_sheet_url") || DEFAULT_SHEET_URL,
  adPass: localStorage.getItem("sgl_ad_pass") || DEFAULT_ANYDESK_PASS,
  devices: [],
  templates: [],
  tasks: [],
  selectedMacs: new Set(),
  filteredDevices: []
};

const DEFAULT_TEMPLATES = [
  {
    template_name: "deploy_radio_36",
    description: "Chốt dự án Radio 3.6 (Đăng xuất tài khoản test, giữ app 3.6)",
    steps_json: JSON.stringify([
      { action: "shell_cmd", params: { cmd: "am force-stop vn.phitn.app.radiostation ; am force-stop com.radiostation" } },
      { action: "report_field", params: { field: "software", value: "Radio 3.6" } }
    ], null, 2)
  },
  {
    template_name: "deploy_vnpt_ics",
    description: "Chuyển sang VNPT ICS (Gỡ 3.6, cài ICS, tự động lấy MAC ICS lên Sheet)",
    steps_json: JSON.stringify([
      { action: "uninstall_pkg", params: { package: "vn.phitn.app.radiostation" } },
      { action: "install_apk", params: { file: "ics-android-box (2.0.0).apk" } },
      { action: "start_app", params: { package: "com.app.ics_content_management", fallback_package: "vnpt.smartcomm.radio", activity: "vnpt.smartcomm.radio.activity.SplashActivity" } },
      { action: "extract_ics_mac", params: { package: "com.app.ics_content_management", fallback_package: "vnpt.smartcomm.radio" } },
      { action: "report_field", params: { field: "software", value: "VNPT ICS" } }
    ], null, 2)
  },
  {
    template_name: "deploy_radio_166",
    description: "Chuyển sang Radio 1.66 (Gỡ 3.6, cài Radio 1.66)",
    steps_json: JSON.stringify([
      { action: "uninstall_pkg", params: { package: "vn.phitn.app.radiostation" } },
      { action: "install_apk", params: { file: "radio.apk" } },
      { action: "report_field", params: { field: "software", value: "Radio 1.66" } }
    ], null, 2)
  },
  {
    template_name: "deploy_radio_20",
    description: "Nâng cấp Radio 2.0 (Đọc thông tin cấu hình từ Google Sheet)",
    steps_json: JSON.stringify([
      { action: "uninstall_pkg", params: { package: "vn.phitn.app.radiostation" } },
      { action: "install_apk", params: { file: "Radio2.0.apk" } },
      { action: "fetch_config", params: { sheet: "Config_Radio20", key: "mac" } },
      { action: "report_field", params: { field: "software", value: "Radio 2.0" } }
    ], null, 2)
  }
];

// ============================================================================
// AUTHENTICATION & SECURITY (SHA-256 SALTED HASH)
// ============================================================================
const AUTH_SALT = "SGL_BROADCAST_AUTH_2026";
// SHA-256("admin:<password>:SGL_BROADCAST_AUTH_2026")
const ADMIN_AUTH_HASH = "1ba829b76a47773c9a3257e995cc4e790621de7b2e7123eb502f822d61fe8387";
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

function isSessionAuthenticated() {
  try {
    const rawSession = sessionStorage.getItem(AUTH_STORAGE_KEY);
    if (rawSession) {
      const parsed = JSON.parse(rawSession);
      if (parsed && parsed.hash === ADMIN_AUTH_HASH) return true;
    }
    const rawLocal = localStorage.getItem(AUTH_STORAGE_KEY);
    if (rawLocal) {
      const parsed = JSON.parse(rawLocal);
      if (parsed && parsed.hash === ADMIN_AUTH_HASH && parsed.expiresAt > Date.now()) {
        return true;
      } else {
        localStorage.removeItem(AUTH_STORAGE_KEY);
      }
    }
  } catch (e) {
    // Ignore storage errors
  }
  return false;
}

function unlockApplication() {
  const gate = document.getElementById("loginGate");
  const topbar = document.getElementById("appTopbar");
  const main = document.getElementById("appMain");
  if (gate) gate.style.display = "none";
  if (topbar) topbar.style.display = "flex";
  if (main) main.style.display = "block";

  document.getElementById("txtWebhookUrl").value = state.webhookUrl;
  document.getElementById("txtSheetUrl").value = state.sheetUrl;
  document.getElementById("txtDefaultAdPass").value = state.adPass;
  document.getElementById("btnOpenSheetTop").href = state.sheetUrl;

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

  const computedHash = await sha256Hex(`${username}:${password}:${AUTH_SALT}`);

  if (username === "admin" && computedHash === ADMIN_AUTH_HASH) {
    failedLoginAttempts = 0;
    errBox.style.display = "none";
    const tokenObj = {
      user: "admin",
      hash: ADMIN_AUTH_HASH,
      expiresAt: Date.now() + SEVEN_DAYS_MS
    };
    sessionStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(tokenObj));
    if (remember) {
      localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(tokenObj));
    } else {
      localStorage.removeItem(AUTH_STORAGE_KEY);
    }
    document.getElementById("loginPassword").value = "";
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

function handleLogout() {
  sessionStorage.removeItem(AUTH_STORAGE_KEY);
  localStorage.removeItem(AUTH_STORAGE_KEY);
  if (syncIntervalId) {
    clearInterval(syncIntervalId);
    syncIntervalId = null;
  }
  document.getElementById("appTopbar").style.display = "none";
  document.getElementById("appMain").style.display = "none";
  document.getElementById("loginGate").style.display = "flex";
  document.getElementById("loginPassword").value = "";
  showToast("🔒 Đã đăng xuất khỏi hệ thống an toàn.");
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
// API CLIENT (CORS-SAFE FOR GOOGLE APPS SCRIPT)
// ============================================================================
async function apiGet(params) {
  const url = new URL(state.webhookUrl);
  Object.keys(params).forEach(k => url.searchParams.set(k, params[k]));
  const resp = await fetch(url.toString(), {
    method: "GET",
    redirect: "follow"
  });
  return await resp.json();
}

async function apiPost(payload) {
  // Dùng Content-Type text/plain để tránh lỗi CORS OPTIONS preflight trên Google Apps Script
  const resp = await fetch(state.webhookUrl, {
    method: "POST",
    redirect: "follow",
    headers: {
      "Content-Type": "text/plain;charset=utf-8"
    },
    body: JSON.stringify(payload)
  });
  return await resp.json();
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
      state.devices = mergeDuplicateAnydeskRows(devRes.devices);
    }

    if (tplRes && Array.isArray(tplRes.templates) && tplRes.templates.length > 0) {
      state.templates = tplRes.templates;
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

/**
 * Tự động gộp các dòng chờ CHUA_MAC_<anydesk> (từ Sheet dự án cũ) với dòng MAC thật
 * khi Box cũ được cài App quản lý và gửi Heartbeat có cùng mã AnyDesk.
 */
function mergeDuplicateAnydeskRows(rawDevices) {
  const placeholderByAd = {};
  const realByAd = {};

  rawDevices.forEach(d => {
    const ad = String(d.anydesk_id || "").replace(/[\s\-]/g, "").trim();
    const mac = String(d.mac || "").trim().toUpperCase();
    if (!ad) return;
    if (mac.startsWith("CHUA_MAC_")) {
      placeholderByAd[ad] = d;
    } else {
      realByAd[ad] = d;
    }
  });

  const mergedList = [];
  rawDevices.forEach(d => {
    const ad = String(d.anydesk_id || "").replace(/[\s\-]/g, "").trim();
    const mac = String(d.mac || "").trim().toUpperCase();
    if (mac.startsWith("CHUA_MAC_") && ad && realByAd[ad]) {
      // Đã có Box thật cùng mã AnyDesk -> Gộp tên Dự án từ dòng chờ sang dòng Box thật
      const realDev = realByAd[ad];
      if ((!realDev.project || realDev.project === "Kho thiết bị") && d.project && d.project !== "Kho thiết bị") {
        realDev.project = d.project;
        // Đồng bộ ngầm dự án của Box thật lên Sheet
        apiPost({
          action: "assign_project",
          target_macs: [realDev.mac],
          project: d.project,
          software: realDev.software || d.software || "Radio 3.6"
        }).catch(() => {});
      }
      return; // Bỏ qua dòng CHUA_MAC_ trùng lặp
    }
    mergedList.push(d);
  });

  return mergedList;
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
      const hay = `${d.mac} ${d.anydesk_id} ${proj} ${soft} ${d.mac_ics || ""} ${d.notes || ""}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });

  // Sắp xếp Online lên đầu, sau đó theo dự án
  filtered.sort((a, b) => {
    const sa = evaluateDeviceStatus(a).mins;
    const sb = evaluateDeviceStatus(b).mins;
    return sa - sb;
  });

  state.filteredDevices = filtered;
  updateSelectedCounter();

  if (filtered.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="12" style="text-align:center; padding:32px; color:var(--text-secondary);">
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

    html += `
      <tr class="${isChecked ? 'selected-row' : ''}">
        <td>
          <input type="checkbox" ${isChecked ? "checked" : ""} onchange="toggleSelectDevice('${safeMac}', this.checked)" />
        </td>
        <td class="mono" style="color:var(--text-muted);">${idx + 1}</td>
        <td><span class="badge ${badgeClass}">${st.label}</span></td>
        <td>
          <span class="copy-chip" onclick="copyText('${safeMac}', 'Đã chép MAC: ${safeMac}')" title="Bấm để sao chép MAC">
            ${safeMac}
          </span>
        </td>
        <td>
          <span class="copy-chip" style="color:var(--accent-green); font-weight:700;" onclick="copyText('${safeAd}', 'Đã chép AnyDesk: ${safeAd}')" title="Bấm để sao chép AnyDesk ID">
            ${safeAd || "Chưa có"}
          </span>
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
      showToast(`✔ Đã cập nhật ${macs.length} thiết bị vào dự án '${projName}'!`);
      refreshAllData();
    } else {
      showToast(`❌ Lỗi: ${(res && res.message) || "Không thể cập nhật dự án"}`, true);
    }
  } catch (err) {
    showToast(`❌ Lỗi kết nối khi gán dự án: ${err.message}`, true);
  }
}

// ============================================================================
// ADD DEVICE MODAL
// ============================================================================
function openAddDeviceModal() {
  document.getElementById("modalAddDevice").classList.add("open");
}

async function confirmAddDevice() {
  let mac = (document.getElementById("txtAddMac").value || "").trim().toUpperCase();
  const adId = (document.getElementById("txtAddAnydesk").value || "").trim();
  const proj = (document.getElementById("txtAddProject").value || "Kho thiết bị").trim();
  const soft = document.getElementById("selAddSoftware").value;
  const ics = (document.getElementById("txtAddIcs").value || "").trim();

  if (!adId && !mac) {
    showToast("Vui lòng nhập ít nhất Mã AnyDesk ID hoặc MAC!", true);
    return;
  }
  if (!mac) {
    mac = `BOX_${adId.replace(/\s+/g, "")}`;
  }

  closeModal("modalAddDevice");
  showToast(`⏳ Đang đăng ký thiết bị ${mac}...`);

  try {
    const res = await apiPost({
      action: "register_device",
      mac: mac,
      anydesk_id: adId,
      project: proj,
      software: soft,
      mac_ics: ics
    });
    if (res && res.status === "ok") {
      showToast(`✔ Đã lưu thiết bị ${mac} lên Google Sheet!`);
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
      closeModal("modalBulkImportOldProject");
      showToast(`✔ Đã tạo Sheet dự án "${projName}" với ${adList.length} mã AnyDesk!`);
      await refreshAllData();
      setProjectFilter(projName);
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
  const headers = ["STT", "MAC", "AnyDesk_ID", "Du_An", "Phan_Mem", "Ma_ICS", "Trang_Thai", "Lan_Cuoi_Online", "Bo_Nho_MB"];
  const rows = state.filteredDevices.map((d, i) => {
    const st = evaluateDeviceStatus(d);
    return [
      i + 1,
      d.mac || "",
      d.anydesk_id || "",
      `"${(d.project || "").replace(/"/g, '""')}"`,
      `"${(d.software || "").replace(/"/g, '""')}"`,
      d.mac_ics || "",
      st.tag,
      d.last_seen || "",
      d.storage_mb || ""
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
// SETTINGS
// ============================================================================
function saveSettings() {
  state.webhookUrl = (document.getElementById("txtWebhookUrl").value || DEFAULT_WEBHOOK_URL).trim();
  state.sheetUrl = (document.getElementById("txtSheetUrl").value || DEFAULT_SHEET_URL).trim();
  state.adPass = (document.getElementById("txtDefaultAdPass").value || DEFAULT_ANYDESK_PASS).trim();

  localStorage.setItem("sgl_webhook_url", state.webhookUrl);
  localStorage.setItem("sgl_sheet_url", state.sheetUrl);
  localStorage.setItem("sgl_ad_pass", state.adPass);
  document.getElementById("btnOpenSheetTop").href = state.sheetUrl;

  showToast("✔ Đã lưu cấu hình hệ thống!");
  refreshAllData();
}

function resetDefaultSettings() {
  localStorage.removeItem("sgl_webhook_url");
  localStorage.removeItem("sgl_sheet_url");
  localStorage.removeItem("sgl_ad_pass");
  state.webhookUrl = DEFAULT_WEBHOOK_URL;
  state.sheetUrl = DEFAULT_SHEET_URL;
  state.adPass = DEFAULT_ANYDESK_PASS;

  document.getElementById("txtWebhookUrl").value = state.webhookUrl;
  document.getElementById("txtSheetUrl").value = state.sheetUrl;
  document.getElementById("txtDefaultAdPass").value = state.adPass;
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
