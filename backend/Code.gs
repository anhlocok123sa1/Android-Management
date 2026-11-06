/**
 * ==============================================================================
 * RADIO DEVICE MANAGER - GOOGLE APPS SCRIPT BACKEND
 * ==============================================================================
 * Hệ thống middleware trung gian kết nối giữa Android Box Agent và PC App Quản lý.
 * 
 * Lưu trữ dữ liệu trên 4 Sheet:
 *  1. Devices    : Danh sách thiết bị Android, trạng thái, last seen
 *  2. Tasks      : Hàng đợi nhiệm vụ cho từng thiết bị
 *  3. Templates  : Mẫu kịch bản cài đặt / cấu hình (steps JSON)
 *  4. Heartbeat  : Nhật ký xung nhịp định kỳ từ các box (5 phút/lần)
 * ==============================================================================
 */

// ĐIỀN ID SPREADSHEET NẾU DÙNG STANDALONE SCRIPT.
// Nếu Script được tạo trực tiếp từ Sheet (Extensions -> Apps Script), CÓ THỂ ĐỂ TRỐNG "".
var SPREADSHEET_ID = "";

/**
 * Lấy tham chiếu đến Spreadsheet hiện tại hoặc theo SPREADSHEET_ID.
 */
function getSpreadsheet() {
  if (SPREADSHEET_ID && SPREADSHEET_ID.trim() !== "") {
    return SpreadsheetApp.openById(SPREADSHEET_ID.trim());
  }
  var active = SpreadsheetApp.getActiveSpreadsheet();
  if (active) {
    return active;
  }
  throw new Error("Spreadsheet not found. Vui lòng cung cấp SPREADSHEET_ID hoặc bind Script vào Google Sheet.");
}

/**
 * Lấy Sheet theo tên và kiểm tra tồn tại.
 */
function getSheet(sheetName) {
  var ss = getSpreadsheet();
  var sheet = ss.getSheetByName(sheetName);
  if (!sheet) {
    throw new Error("Không tìm thấy Sheet '" + sheetName + "'. Vui lòng chạy hàm setupSheets() hoặc tạo thủ công.");
  }
  return sheet;
}

/**
 * Trả về response JSON chuẩn cho Web App.
 */
function jsonResponse(data) {
  return ContentService.createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}

/**
 * Trả về response lỗi chuẩn.
 */
function errorResponse(message) {
  return {
    status: "error",
    message: message || "Unknown error occurred"
  };
}

/**
 * Sinh mã task_id ngẫu nhiên theo chuẩn.
 */
function generateTaskId() {
  return "TASK_" + new Date().getTime() + "_" + Math.floor(Math.random() * 1000);
}

/**
 * Đọc toàn bộ danh sách header (dòng 1) của một sheet dưới dạng mảng chữ thường/chuẩn hóa.
 */
function getSheetHeaders(sheet) {
  var lastCol = sheet.getLastColumn();
  if (lastCol === 0) return [];
  var rawHeaders = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
  var headers = [];
  for (var i = 0; i < rawHeaders.length; i++) {
    headers.push(String(rawHeaders[i]).trim());
  }
  return headers;
}

/**
 * Đảm bảo các cột yêu cầu có mặt trong sheet. Nếu chưa có thì tự động append vào cuối header.
 * @param {Sheet} sheet
 * @param {string[]} requiredHeaders
 * @return {string[]} Danh sách headers sau khi đã đảm bảo
 */
function ensureHeaders(sheet, requiredHeaders) {
  var existing = getSheetHeaders(sheet);
  if (existing.length === 0) {
    sheet.getRange(1, 1, 1, requiredHeaders.length).setValues([requiredHeaders]);
    sheet.getRange(1, 1, 1, requiredHeaders.length).setFontWeight("bold");
    sheet.getRange(1, 1, 1, requiredHeaders.length).setBackground("#EFEFEF");
    sheet.setFrozenRows(1);
    return requiredHeaders;
  }
  var missing = [];
  var existingLower = existing.map(function(h) { return String(h).trim().toLowerCase(); });
  for (var i = 0; i < requiredHeaders.length; i++) {
    if (existingLower.indexOf(String(requiredHeaders[i]).trim().toLowerCase()) === -1) {
      missing.push(requiredHeaders[i]);
    }
  }
  if (missing.length > 0) {
    var startCol = existing.length + 1;
    sheet.getRange(1, startCol, 1, missing.length).setValues([missing]);
    sheet.getRange(1, startCol, 1, missing.length).setFontWeight("bold");
    sheet.getRange(1, startCol, 1, missing.length).setBackground("#EFEFEF");
    return existing.concat(missing);
  }
  return existing;
}

/**
 * Helper tìm row theo key (keyCol), cập nhật nếu đã có hoặc chèn thêm row mới nếu chưa có.
 * @param {Sheet} sheet - Google Sheet cần thao tác
 * @param {string|number} keyCol - Tên cột (string) hoặc chỉ số cột 1-based (number) làm khóa
 * @param {string} keyValue - Giá trị khóa cần tìm kiếm
 * @param {Object} dataObj - Object chứa dữ liệu cần ghi, map theo tên cột
 * @return {Object} { row: number, isNew: boolean }
 */
function upsertRow(sheet, keyCol, keyValue, dataObj) {
  var headers = getSheetHeaders(sheet);
  if (headers.length === 0) {
    throw new Error("Sheet '" + sheet.getName() + "' chưa có dòng tiêu đề (header).");
  }

  var keyColIndex = -1;
  if (typeof keyCol === "number") {
    keyColIndex = keyCol - 1;
  } else {
    for (var h = 0; h < headers.length; h++) {
      if (headers[h].toLowerCase() === String(keyCol).toLowerCase()) {
        keyColIndex = h;
        break;
      }
    }
  }

  if (keyColIndex === -1) {
    throw new Error("Không tìm thấy cột khóa '" + keyCol + "' trong Sheet '" + sheet.getName() + "'");
  }

  var lastRow = sheet.getLastRow();
  var foundRowIndex = -1;
  var existingRowData = [];

  if (lastRow > 1) {
    var values = sheet.getRange(2, 1, lastRow - 1, headers.length).getValues();
    var searchVal = String(keyValue).trim().toLowerCase();
    for (var i = 0; i < values.length; i++) {
      if (String(values[i][keyColIndex]).trim().toLowerCase() === searchVal) {
        foundRowIndex = i + 2; // 1-based index trên sheet
        existingRowData = values[i];
        break;
      }
    }
  }

  if (foundRowIndex > 0) {
    // Cập nhật row đã có, giữ nguyên các cột không nằm trong dataObj
    var updatedRow = [];
    for (var j = 0; j < headers.length; j++) {
      var colHeader = headers[j];
      var matchedKey = null;

      // Tìm key trong dataObj không phân biệt hoa thường
      for (var k in dataObj) {
        if (k.toLowerCase() === colHeader.toLowerCase()) {
          matchedKey = k;
          break;
        }
      }

      if (matchedKey !== null && dataObj[matchedKey] !== undefined) {
        updatedRow.push(dataObj[matchedKey]);
      } else {
        updatedRow.push(existingRowData[j]);
      }
    }
    sheet.getRange(foundRowIndex, 1, 1, headers.length).setValues([updatedRow]);
    return { row: foundRowIndex, isNew: false };
  } else {
    // Chèn row mới
    var newRow = [];
    for (var col = 0; col < headers.length; col++) {
      var headerName = headers[col];
      var valKey = null;
      for (var prop in dataObj) {
        if (prop.toLowerCase() === headerName.toLowerCase()) {
          valKey = prop;
          break;
        }
      }
      if (valKey !== null && dataObj[valKey] !== undefined) {
        newRow.push(dataObj[valKey]);
      } else {
        newRow.push("");
      }
    }
    sheet.appendRow(newRow);
    return { row: sheet.getLastRow(), isNew: true };
  }
}

/**
 * Đọc toàn bộ các row dữ liệu của sheet thành mảng Object (key theo tên header).
 */
function getSheetRowsAsObjects(sheet) {
  var lastRow = sheet.getLastRow();
  var headers = getSheetHeaders(sheet);
  if (lastRow <= 1 || headers.length === 0) {
    return [];
  }

  var values = sheet.getRange(2, 1, lastRow - 1, headers.length).getValues();
  var rows = [];
  for (var i = 0; i < values.length; i++) {
    var obj = { _rowIndex: i + 2 };
    for (var j = 0; j < headers.length; j++) {
      var colName = headers[j];
      var cellVal = values[i][j];
      if (cellVal instanceof Date) {
        cellVal = cellVal.toISOString();
      }
      obj[colName] = (cellVal !== null && cellVal !== undefined) ? cellVal : "";
    }
    rows.push(obj);
  }
  return rows;
}

/**
 * Parse tham số từ e (query parameter và JSON body nếu có).
 */
function extractRequestParams(e) {
  var params = {};

  if (e && e.parameter) {
    for (var p in e.parameter) {
      params[p] = e.parameter[p];
    }
  }

  if (e && e.postData && e.postData.contents) {
    try {
      var parsedBody = JSON.parse(e.postData.contents);
      if (typeof parsedBody === "object" && parsedBody !== null) {
        for (var b in parsedBody) {
          params[b] = parsedBody[b];
        }
      }
    } catch (parseErr) {
      // Trường hợp không phải JSON thuần (ví dụ raw text / x-www-form-urlencoded)
      params._rawBody = e.postData.contents;
    }
  }

  return params;
}

// ==============================================================================
// HTTP ENTRY POINTS
// ==============================================================================

/**
 * Xử lý HTTP GET request.
 */
function doGet(e) {
  try {
    var params = extractRequestParams(e);
    var action = params.action ? String(params.action).trim() : "";
    var result = routeAction(action, params);
    return jsonResponse(result);
  } catch (error) {
    return jsonResponse(errorResponse(error.message || String(error)));
  }
}

/**
 * Xử lý HTTP POST request.
 */
function doPost(e) {
  try {
    var params = extractRequestParams(e);
    var action = params.action ? String(params.action).trim() : "";
    var result = routeAction(action, params);
    return jsonResponse(result);
  } catch (error) {
    return jsonResponse(errorResponse(error.message || String(error)));
  }
}

/**
 * Bộ định tuyến (Router) chuyển tiếp action tới handler tương ứng.
 */
function routeAction(action, params) {
  if (!action) {
    return {
      status: "ok",
      message: "Radio Device Manager Backend API is online",
      timestamp: new Date().toISOString()
    };
  }

  switch (action) {
    // POST Actions
    case "heartbeat":
      return handleHeartbeat(params);
    case "claim_task":
      return handleClaimTask(params);
    case "complete_task":
      return handleCompleteTask(params);
    case "register_device":
      return handleRegisterDevice(params);
    case "assign_project":
      return handleAssignProject(params);
    case "create_task":
      return handleCreateTask(params);
    case "save_template":
      return handleSaveTemplate(params);
    case "batch_import_devices":
      return handleBatchImportDevices(params);
    case "sync_project_sheets":
      return handleSyncProjectSheets(params);

    // GET Actions
    case "get_devices":
      return handleGetDevices(params);
    case "get_templates":
      return handleGetTemplates(params);
    case "get_tasks":
      return handleGetTasks(params);

    default:
      return errorResponse("Hành động không hợp lệ: " + action);
  }
}

// ==============================================================================
// BUSINESS LOGIC HANDLERS
// ==============================================================================

/**
 * POST action=heartbeat
 * Android Agent gửi xung nhịp định kỳ 5 phút/lần.
 * Cập nhật Heartbeat + Devices và kiểm tra task pending.
 */
function handleHeartbeat(params) {
  var mac = params.mac ? String(params.mac).trim() : "";
  if (!mac) {
    return errorResponse("Thiếu tham số bắt buộc: mac");
  }

  var lock = LockService.getScriptLock();
  try {
    lock.waitLock(15000);
  } catch (e) {
    return errorResponse("Hệ thống đang bận xử lý request khác, vui lòng thử lại sau giây lát.");
  }

  try {
    var nowIso = new Date().toISOString();
    var heartbeatSheet = getSheet("Heartbeat");
    var devicesSheet = getSheet("Devices");
    var tasksSheet = getSheet("Tasks");
    var templatesSheet = getSheet("Templates");

    // 1. Upsert vào sheet Heartbeat
    upsertRow(heartbeatSheet, "mac", mac, {
      mac: mac,
      timestamp: nowIso,
      ram_mb: params.ram_mb !== undefined ? params.ram_mb : "",
      storage_mb: params.storage_mb !== undefined ? params.storage_mb : "",
      current_task: params.current_task !== undefined ? params.current_task : "",
      app_version: params.app_version !== undefined ? params.app_version : "",
      ip: params.ip !== undefined ? params.ip : ""
    });

    // 2. Upsert vào sheet Devices (cập nhật last_seen, app_version, storage_mb, anydesk_id nếu khác)
    var deviceData = {
      mac: mac,
      last_seen: nowIso,
      status: "online"
    };

    if (params.app_version !== undefined && String(params.app_version).trim() !== "") {
      deviceData.app_version = params.app_version;
    }
    if (params.storage_mb !== undefined && String(params.storage_mb).trim() !== "") {
      deviceData.storage_mb = params.storage_mb;
    }
    if (params.anydesk_id !== undefined && String(params.anydesk_id).trim() !== "") {
      deviceData.anydesk_id = params.anydesk_id;
    }
    if (params.current_task !== undefined) {
      deviceData.task_id = params.current_task;
    }

    upsertRow(devicesSheet, "mac", mac, deviceData);

    // 3. Tìm task pending cho mac này: WHERE target_mac=mac AND status='pending' ORDER BY created_at ASC LIMIT 1
    var allTasks = getSheetRowsAsObjects(tasksSheet);
    var pendingTasks = allTasks.filter(function(t) {
      var targetMac = String(t.target_mac || "").trim().toLowerCase();
      var status = String(t.status || "").trim().toLowerCase();
      return targetMac === mac.toLowerCase() && status === "pending";
    });

    // Sắp xếp tăng dần theo created_at
    pendingTasks.sort(function(a, b) {
      var tA = new Date(a.created_at).getTime() || 0;
      var tB = new Date(b.created_at).getTime() || 0;
      return tA - tB;
    });

    var pendingTaskResult = null;
    if (pendingTasks.length > 0) {
      var candidate = pendingTasks[0];
      var templateName = String(candidate.template_name || "").trim();
      var stepsJson = "";

      // Lấy steps_json từ sheet Templates
      var allTemplates = getSheetRowsAsObjects(templatesSheet);
      for (var i = 0; i < allTemplates.length; i++) {
        if (String(allTemplates[i].template_name || "").trim().toLowerCase() === templateName.toLowerCase()) {
          stepsJson = allTemplates[i].steps_json || "";
          break;
        }
      }

      pendingTaskResult = {
        task_id: String(candidate.task_id || ""),
        template_name: templateName,
        steps_json: stepsJson
      };
    }

    return {
      status: "ok",
      pending_task: pendingTaskResult
    };
  } finally {
    lock.releaseLock();
  }
}

/**
 * POST action=claim_task
 * Android Agent xác nhận nhận task để thực thi.
 * Tránh race condition: Chỉ claim khi status hiện tại là 'pending'.
 */
function handleClaimTask(params) {
  var taskId = params.task_id ? String(params.task_id).trim() : "";
  var mac = params.mac ? String(params.mac).trim() : "";

  if (!taskId) {
    return errorResponse("Thiếu tham số bắt buộc: task_id");
  }

  var lock = LockService.getScriptLock();
  try {
    lock.waitLock(15000);
  } catch (e) {
    return errorResponse("Hệ thống đang bận, vui lòng thử lại sau.");
  }

  try {
    var tasksSheet = getSheet("Tasks");
    var headers = getSheetHeaders(tasksSheet);
    var taskIdColIdx = headers.indexOf("task_id");
    var statusColIdx = headers.indexOf("status");
    var claimedAtColIdx = headers.indexOf("claimed_at");

    if (taskIdColIdx === -1 || statusColIdx === -1 || claimedAtColIdx === -1) {
      return errorResponse("Sheet Tasks thiếu các cột bắt buộc (task_id, status, claimed_at).");
    }

    var lastRow = tasksSheet.getLastRow();
    if (lastRow <= 1) {
      return errorResponse("Không tìm thấy task: " + taskId);
    }

    var values = tasksSheet.getRange(2, 1, lastRow - 1, headers.length).getValues();
    var targetRowIdx = -1;
    var currentStatus = "";

    for (var i = 0; i < values.length; i++) {
      if (String(values[i][taskIdColIdx]).trim() === taskId) {
        targetRowIdx = i + 2;
        currentStatus = String(values[i][statusColIdx]).trim().toLowerCase();
        break;
      }
    }

    if (targetRowIdx === -1) {
      return errorResponse("Không tìm thấy task: " + taskId);
    }

    // Set Tasks.status='claimed', Tasks.claimed_at=now() CHỈ KHI status hiện tại='pending'
    if (currentStatus !== "pending") {
      return {
        status: "already_claimed"
      };
    }

    var nowIso = new Date().toISOString();
    tasksSheet.getRange(targetRowIdx, statusColIdx + 1).setValue("claimed");
    tasksSheet.getRange(targetRowIdx, claimedAtColIdx + 1).setValue(nowIso);

    // Cập nhật trạng thái thiết bị thành busy và gán task_id
    if (mac) {
      var devicesSheet = getSheet("Devices");
      upsertRow(devicesSheet, "mac", mac, {
        mac: mac,
        status: "busy",
        task_id: taskId,
        last_seen: nowIso
      });
    }

    return {
      status: "ok"
    };
  } finally {
    lock.releaseLock();
  }
}

/**
 * POST action=complete_task
 * Android Agent báo cáo hoàn thành nhiệm vụ (thành công hoặc thất bại).
 */
function handleCompleteTask(params) {
  var taskId = params.task_id ? String(params.task_id).trim() : "";
  var mac = params.mac ? String(params.mac).trim() : "";

  if (!taskId) {
    return errorResponse("Thiếu tham số bắt buộc: task_id");
  }

  var lock = LockService.getScriptLock();
  try {
    lock.waitLock(15000);
  } catch (e) {
    return errorResponse("Hệ thống đang bận, vui lòng thử lại sau.");
  }

  try {
    var tasksSheet = getSheet("Tasks");
    var headers = getSheetHeaders(tasksSheet);
    var taskIdColIdx = headers.indexOf("task_id");
    var statusColIdx = headers.indexOf("status");
    var completedAtColIdx = headers.indexOf("completed_at");
    var resultColIdx = headers.indexOf("result");

    var lastRow = tasksSheet.getLastRow();
    if (lastRow <= 1) {
      return errorResponse("Không tìm thấy task: " + taskId);
    }

    var values = tasksSheet.getRange(2, 1, lastRow - 1, headers.length).getValues();
    var targetRowIdx = -1;

    for (var i = 0; i < values.length; i++) {
      if (String(values[i][taskIdColIdx]).trim() === taskId) {
        targetRowIdx = i + 2;
        break;
      }
    }

    if (targetRowIdx === -1) {
      return errorResponse("Không tìm thấy task: " + taskId);
    }

    var isSuccess = params.success === true || params.success === "true" || params.success === 1 || params.success === "1";
    var finalStatus = isSuccess ? "completed" : "failed";
    var nowIso = new Date().toISOString();

    var resultStr = "";
    if (typeof params.result === "object") {
      resultStr = JSON.stringify(params.result);
    } else if (params.result !== undefined && params.result !== null) {
      resultStr = String(params.result);
    }

    if (statusColIdx !== -1) {
      tasksSheet.getRange(targetRowIdx, statusColIdx + 1).setValue(finalStatus);
    }
    if (completedAtColIdx !== -1) {
      tasksSheet.getRange(targetRowIdx, completedAtColIdx + 1).setValue(nowIso);
    }
    if (resultColIdx !== -1) {
      tasksSheet.getRange(targetRowIdx, resultColIdx + 1).setValue(resultStr);
    }

    // Cập nhật Devices.status, Devices.task_id='', và các trường báo cáo (software, mac_ics, project...)
    if (mac) {
      var devicesSheet = getSheet("Devices");
      var updateDevObj = {
        mac: mac,
        status: "online",
        task_id: "",
        last_seen: nowIso
      };
      if (params.mac_ics) updateDevObj.mac_ics = String(params.mac_ics).trim();
      if (params.software) updateDevObj.software = String(params.software).trim();
      if (params.project) updateDevObj.project = String(params.project).trim();

      // Trích xuất tự động từ chuỗi kết quả nếu có
      var mIcs = resultStr.match(/mac_ics=([a-fA-F0-9]+)/i);
      if (mIcs) updateDevObj.mac_ics = mIcs[1];
      var mSoft = resultStr.match(/software=([^,\n;]+)/i);
      if (mSoft) updateDevObj.software = mSoft[1].trim();

      upsertRow(devicesSheet, "mac", mac, updateDevObj);
    }

    return {
      status: "ok"
    };
  } finally {
    lock.releaseLock();
  }
}

/**
 * POST action=register_device
 * Đăng ký hoặc cập nhật AnyDesk ID của box.
 */
function handleRegisterDevice(params) {
  var mac = params.mac ? String(params.mac).trim() : "";
  var anydeskId = params.anydesk_id ? String(params.anydesk_id).trim() : "";

  if (!mac) {
    return errorResponse("Thiếu tham số bắt buộc: mac");
  }

  var lock = LockService.getScriptLock();
  try {
    lock.waitLock(15000);
  } catch (e) {
    return errorResponse("Hệ thống đang bận, vui lòng thử lại sau.");
  }

  try {
    var devicesSheet = getSheet("Devices");
    ensureHeaders(devicesSheet, ["mac", "anydesk_id", "project", "software", "mac_ics", "status", "last_seen", "app_version", "storage_mb", "task_id", "iot_id", "imei_sim", "notes"]);
    var headers = getSheetHeaders(devicesSheet);
    var macColIdx = headers.indexOf("mac");
    var anydeskColIdx = headers.indexOf("anydesk_id");
    var lastSeenColIdx = headers.indexOf("last_seen");

    var lastRow = devicesSheet.getLastRow();
    var existingRowIdx = -1;

    if (lastRow > 1) {
      var values = devicesSheet.getRange(2, 1, lastRow - 1, headers.length).getValues();
      for (var i = 0; i < values.length; i++) {
        if (String(values[i][macColIdx]).trim().toLowerCase() === mac.toLowerCase()) {
          existingRowIdx = i + 2;
          break;
        }
      }
    }

    var isNew = false;
    var nowIso = new Date().toISOString();

    if (existingRowIdx > 0) {
      // Đã có -> Cập nhật anydesk_id nếu có truyền vào
      if (anydeskColIdx !== -1 && anydeskId) {
        devicesSheet.getRange(existingRowIdx, anydeskColIdx + 1).setValue(anydeskId);
      }
      if (lastSeenColIdx !== -1) {
        devicesSheet.getRange(existingRowIdx, lastSeenColIdx + 1).setValue(nowIso);
      }
      if (params.project) {
        var projColIdx = headers.indexOf("project");
        if (projColIdx !== -1) devicesSheet.getRange(existingRowIdx, projColIdx + 1).setValue(params.project);
      }
      if (params.software) {
        var softColIdx = headers.indexOf("software");
        if (softColIdx !== -1) devicesSheet.getRange(existingRowIdx, softColIdx + 1).setValue(params.software);
      }
      if (params.mac_ics) {
        var icsColIdx = headers.indexOf("mac_ics");
        if (icsColIdx !== -1) devicesSheet.getRange(existingRowIdx, icsColIdx + 1).setValue(params.mac_ics);
      }
      isNew = false;
    } else {
      // Chưa có -> insert row mới với status='new'
      upsertRow(devicesSheet, "mac", mac, {
        mac: mac,
        anydesk_id: anydeskId,
        project: params.project || "Kho thiết bị",
        software: params.software || "Radio 3.6 (Test)",
        mac_ics: params.mac_ics || "",
        iot_id: params.iot_id || "",
        imei_sim: params.imei_sim || "",
        status: "new",
        last_seen: nowIso,
        app_version: params.app_version || "",
        storage_mb: params.storage_mb || "",
        task_id: "",
        notes: params.notes || ""
      });
      isNew = true;
    }

    return {
      status: "ok",
      is_new: isNew
    };
  } finally {
    lock.releaseLock();
  }
}

/**
 * POST action=assign_project
 * Gán danh sách box (target_macs) vào một Dự án cụ thể (ví dụ: 'Xã Xuyên Mộc') và cập nhật loại phần mềm (software).
 */
function handleAssignProject(params) {
  var projectName = params.project ? String(params.project).trim() : "";
  var software = params.software ? String(params.software).trim() : "";
  var targetMacs = params.target_macs;

  if (!projectName) {
    return errorResponse("Thiếu tham số bắt buộc: project (Tên dự án)");
  }

  if (typeof targetMacs === "string") {
    try {
      targetMacs = JSON.parse(targetMacs);
    } catch (e) {
      targetMacs = targetMacs.split(",").map(function(m) { return m.trim(); }).filter(Boolean);
    }
  }

  if (!Array.isArray(targetMacs) || targetMacs.length === 0) {
    return errorResponse("target_macs phải là danh sách mảng các địa chỉ MAC");
  }

  var lock = LockService.getScriptLock();
  try {
    lock.waitLock(15000);
  } catch (e) {
    return errorResponse("Hệ thống đang bận, vui lòng thử lại sau.");
  }

  try {
    var devicesSheet = getSheet("Devices");
    ensureHeaders(devicesSheet, ["mac", "anydesk_id", "project", "software", "mac_ics", "status", "last_seen", "app_version", "storage_mb", "task_id", "iot_id", "imei_sim", "notes"]);
    var headers = getSheetHeaders(devicesSheet);
    var macColIdx = headers.indexOf("mac");
    var projColIdx = headers.indexOf("project");
    var softColIdx = headers.indexOf("software");

    if (macColIdx === -1 || projColIdx === -1) {
      return errorResponse("Sheet Devices thiếu cột mac hoặc project.");
    }

    var lastRow = devicesSheet.getLastRow();
    var updatedCount = 0;

    if (lastRow > 1) {
      var numCols = headers.length;
      var values = devicesSheet.getRange(2, 1, lastRow - 1, numCols).getValues();
      var macSet = {};
      for (var j = 0; j < targetMacs.length; j++) {
        macSet[String(targetMacs[j]).trim().toLowerCase()] = true;
      }

      for (var i = 0; i < values.length; i++) {
        var rowMac = String(values[i][macColIdx]).trim().toLowerCase();
        if (macSet[rowMac]) {
          var rowNum = i + 2;
          devicesSheet.getRange(rowNum, projColIdx + 1).setValue(projectName);
          if (softColIdx !== -1 && software) {
            devicesSheet.getRange(rowNum, softColIdx + 1).setValue(software);
          }
          updatedCount++;
        }
      }
    }

    try {
      syncProjectSheets();
    } catch (syncErr) {
      Logger.log("syncProjectSheets error in assign_project: " + syncErr.message);
    }

    return {
      status: "ok",
      updated_count: updatedCount,
      project: projectName,
      software: software
    };
  } finally {
    lock.releaseLock();
  }
}

/**
 * POST action=create_task
 * PC App tạo nhiệm vụ cho danh sách các MAC boxes.
 */
function handleCreateTask(params) {
  var templateName = params.template_name ? String(params.template_name).trim() : "";
  var targetMacs = params.target_macs;

  if (!templateName) {
    return errorResponse("Thiếu tham số bắt buộc: template_name");
  }

  if (typeof targetMacs === "string") {
    try {
      targetMacs = JSON.parse(targetMacs);
    } catch (e) {
      targetMacs = targetMacs.split(",").map(function(m) { return m.trim(); }).filter(Boolean);
    }
  }

  if (!Array.isArray(targetMacs) || targetMacs.length === 0) {
    return errorResponse("target_macs phải là danh sách mảng các địa chỉ MAC");
  }

  // Kiểm tra template có tồn tại trong Templates sheet
  var templatesSheet = getSheet("Templates");
  var allTemplates = getSheetRowsAsObjects(templatesSheet);
  var foundTemplate = allTemplates.some(function(t) {
    return String(t.template_name || "").trim().toLowerCase() === templateName.toLowerCase();
  });

  if (!foundTemplate) {
    return errorResponse("Không tìm thấy template có tên: " + templateName);
  }

  var lock = LockService.getScriptLock();
  try {
    lock.waitLock(15000);
  } catch (e) {
    return errorResponse("Hệ thống đang bận, vui lòng thử lại sau.");
  }

  try {
    var tasksSheet = getSheet("Tasks");
    var nowIso = new Date().toISOString();
    var taskIds = [];
    var rowsToAppend = [];
    var baseTimestamp = new Date().getTime();

    for (var i = 0; i < targetMacs.length; i++) {
      var mac = String(targetMacs[i]).trim();
      if (!mac) continue;

      var taskId = "TASK_" + baseTimestamp + "_" + i;
      taskIds.push(taskId);

      // columns: task_id | template_name | target_mac | status | created_at | claimed_at | completed_at | result
      rowsToAppend.push([
        taskId,
        templateName,
        mac,
        "pending",
        nowIso,
        "", // claimed_at
        "", // completed_at
        ""  // result
      ]);
    }

    if (rowsToAppend.length > 0) {
      var startRow = tasksSheet.getLastRow() + 1;
      tasksSheet.getRange(startRow, 1, rowsToAppend.length, 8).setValues(rowsToAppend);
    }

    return {
      status: "ok",
      task_ids: taskIds
    };
  } finally {
    lock.releaseLock();
  }
}

/**
 * POST action=save_template
 * PC App lưu mẫu kịch bản các bước cài đặt (steps_json).
 */
function handleSaveTemplate(params) {
  var templateName = params.template_name ? String(params.template_name).trim() : "";
  if (!templateName) {
    return errorResponse("Thiếu tham số bắt buộc: template_name");
  }

  var stepsJson = params.steps_json;
  if (typeof stepsJson === "object") {
    stepsJson = JSON.stringify(stepsJson);
  } else if (stepsJson === undefined || stepsJson === null) {
    stepsJson = "[]";
  } else {
    stepsJson = String(stepsJson);
  }

  var lock = LockService.getScriptLock();
  try {
    lock.waitLock(15000);
  } catch (e) {
    return errorResponse("Hệ thống đang bận, vui lòng thử lại sau.");
  }

  try {
    var templatesSheet = getSheet("Templates");
    var nowIso = new Date().toISOString();

    upsertRow(templatesSheet, "template_name", templateName, {
      template_name: templateName,
      steps_json: stepsJson,
      description: params.description !== undefined ? String(params.description) : "",
      created_by: params.created_by !== undefined ? String(params.created_by) : "admin",
      created_at: nowIso
    });

    return {
      status: "ok"
    };
  } finally {
    lock.releaseLock();
  }
}

/**
 * GET action=get_devices
 * Lấy toàn bộ danh sách thiết bị từ sheet Devices.
 */
function handleGetDevices(params) {
  var sheet = getSheet("Devices");
  var rawRows = getSheetRowsAsObjects(sheet);

  var devices = rawRows.map(function(r) {
    return {
      mac: String(r.mac || ""),
      anydesk_id: String(r.anydesk_id || ""),
      project: String(r.project || "Kho thiết bị"),
      software: String(r.software || "Radio 3.6"),
      mac_ics: String(r.mac_ics || ""),
      iot_id: String(r.iot_id || ""),
      imei_sim: String(r.imei_sim || ""),
      status: String(r.status || ""),
      last_seen: String(r.last_seen || ""),
      app_version: String(r.app_version || ""),
      storage_mb: String(r.storage_mb || ""),
      task_id: String(r.task_id || ""),
      notes: String(r.notes || "")
    };
  });

  return {
    status: "ok",
    devices: devices
  };
}

/**
 * GET action=get_templates
 * Lấy danh sách toàn bộ các template kịch bản từ sheet Templates.
 */
function handleGetTemplates(params) {
  var sheet = getSheet("Templates");
  var rawRows = getSheetRowsAsObjects(sheet);

  var templates = rawRows.map(function(r) {
    return {
      template_name: String(r.template_name || ""),
      steps_json: String(r.steps_json || ""),
      description: String(r.description || ""),
      created_by: String(r.created_by || ""),
      created_at: String(r.created_at || "")
    };
  });

  return {
    status: "ok",
    templates: templates
  };
}

/**
 * GET action=get_tasks
 * Lấy danh sách nhiệm vụ gần đây (tối đa 50 rows cuối), lọc theo mac nếu có.
 */
function handleGetTasks(params) {
  var sheet = getSheet("Tasks");
  var rawRows = getSheetRowsAsObjects(sheet);
  var filterMac = params.mac ? String(params.mac).trim().toLowerCase() : "";

  var filtered = rawRows.filter(function(t) {
    if (!filterMac) return true;
    return String(t.target_mac || "").trim().toLowerCase() === filterMac;
  });

  // Giới hạn 50 tasks gần nhất
  if (filtered.length > 50) {
    filtered = filtered.slice(filtered.length - 50);
  }

  var tasks = filtered.map(function(t) {
    return {
      task_id: String(t.task_id || ""),
      template_name: String(t.template_name || ""),
      target_mac: String(t.target_mac || ""),
      status: String(t.status || ""),
      created_at: String(t.created_at || ""),
      claimed_at: String(t.claimed_at || ""),
      completed_at: String(t.completed_at || ""),
      result: String(t.result || "")
    };
  });

  return {
    status: "ok",
    tasks: tasks
  };
}

// ==============================================================================
// TIỆN ÍCH THIẾT LẬP TỰ ĐỘNG (SETUP AUTOMATION)
// ==============================================================================

/**
 * Khởi tạo tự động 4 sheet chuẩn với đầy đủ header và định dạng.
 * Admin chỉ cần bấm "Run" -> chọn setupSheets() trong Apps Script Editor.
 */
function setupSheets() {
  var ss = getSpreadsheet();
  var sheetDefinitions = [
    {
      name: "Devices",
      headers: ["mac", "anydesk_id", "project", "software", "mac_ics", "status", "last_seen", "app_version", "storage_mb", "task_id", "iot_id", "imei_sim", "notes"]
    },
    {
      name: "Tasks",
      headers: ["task_id", "template_name", "target_mac", "status", "created_at", "claimed_at", "completed_at", "result"]
    },
    {
      name: "Templates",
      headers: ["template_name", "steps_json", "description", "created_by", "created_at"]
    },
    {
      name: "Heartbeat",
      headers: ["mac", "timestamp", "ram_mb", "storage_mb", "current_task", "app_version", "ip"]
    }
  ];

  sheetDefinitions.forEach(function(def) {
    var sheet = ss.getSheetByName(def.name);
    if (!sheet) {
      sheet = ss.insertSheet(def.name);
    }
    ensureHeaders(sheet, def.headers);
  });

  // Khởi tạo các mẫu kịch bản dự án mặc định nếu sheet Templates chưa có dữ liệu
  var tplSheet = ss.getSheetByName("Templates");
  if (tplSheet && tplSheet.getLastRow() <= 1) {
    var nowIso = new Date().toISOString();
    var defaultTemplates = [
      [
        "deploy_radio_36",
        JSON.stringify([
          {"action": "exec_cmd", "params": {"command": "am force-stop com.radiostation"}},
          {"action": "report_field", "params": {"field": "software", "value": "Radio 3.6"}}
        ], null, 2),
        "Chốt dự án Radio 3.6 (Đăng xuất tài khoản test, giữ app 3.6)",
        "admin",
        nowIso
      ],
      [
        "deploy_vnpt_ics",
        JSON.stringify([
          {"action": "uninstall_pkg", "params": {"package": "com.radiostation"}},
          {"action": "install_apk", "params": {"file": "ics-android-box (2.0.0).apk"}},
          {"action": "start_app", "params": {"package": "vnpt.smartcomm.radio", "activity": "vnpt.smartcomm.radio.activity.SplashActivity"}},
          {"action": "extract_ics_mac", "params": {}},
          {"action": "report_field", "params": {"field": "software", "value": "VNPT ICS"}}
        ], null, 2),
        "Chuyển sang VNPT ICS (Gỡ 3.6, cài ICS, tự động lấy MAC ICS lên Sheet)",
        "admin",
        nowIso
      ],
      [
        "deploy_radio_166",
        JSON.stringify([
          {"action": "uninstall_pkg", "params": {"package": "com.radiostation"}},
          {"action": "install_apk", "params": {"file": "radio.apk"}},
          {"action": "report_field", "params": {"field": "software", "value": "Radio 1.66"}}
        ], null, 2),
        "Chuyển sang Radio 1.66 (Gỡ 3.6, cài Radio 1.66)",
        "admin",
        nowIso
      ],
      [
        "deploy_radio_20",
        JSON.stringify([
          {"action": "uninstall_pkg", "params": {"package": "com.radiostation"}},
          {"action": "install_apk", "params": {"file": "Radio2.0.apk"}},
          {"action": "fetch_config", "params": {"sheet": "Config_Radio20", "key": "mac"}},
          {"action": "report_field", "params": {"field": "software", "value": "Radio 2.0"}}
        ], null, 2),
        "Nâng cấp Radio 2.0 (Đọc thông tin 14 input từ Google Sheet)",
        "admin",
        nowIso
      ]
    ];
    tplSheet.getRange(2, 1, defaultTemplates.length, 5).setValues(defaultTemplates);
  }

  // Xóa sheet mặc định ("Sheet1" / "Trang tính 1") nếu đang trống và đã có các sheet khác
  var defaultSheet = ss.getSheetByName("Sheet1") || ss.getSheetByName("Trang tính 1");
  if (defaultSheet && defaultSheet.getLastRow() === 0 && ss.getSheets().length > 1) {
    try {
      ss.deleteSheet(defaultSheet);
    } catch (e) {
      Logger.log("Không thể xóa sheet mặc định: " + e.message);
    }
  }

  Logger.log("Khởi tạo cấu trúc các Sheet thành công!");
}

/**
 * Menu tùy chỉnh khi mở Google Sheet trực tiếp trên trình duyệt.
 */
function onOpen() {
  var ui = SpreadsheetApp.getUi();
  ui.createMenu("🚀 SGL Quản Trị")
    .addItem("🔄 Đồng bộ & Tách Sheet theo từng Dự án", "syncProjectSheets")
    .addItem("⚡ Khởi tạo lại cấu trúc Sheet chuẩn", "setupSheets")
    .addToUi();
}

/**
 * POST action=sync_project_sheets
 * Yêu cầu Webhook đồng bộ lại các sheet dự án.
 */
function handleSyncProjectSheets(params) {
  try {
    syncProjectSheets();
    return {
      status: "ok",
      message: "Đã phân tách và đồng bộ các Sheet dự án thành công."
    };
  } catch (e) {
    return errorResponse("Lỗi đồng bộ Sheet: " + e.message);
  }
}

/**
 * POST action=batch_import_devices
 * Nạp hàng loạt thiết bị (từ file Excel/Google Sheet cũ) vào hệ thống quản lý.
 */
function handleBatchImportDevices(params) {
  var rawDevices = params.devices;
  if (!rawDevices) {
    return errorResponse("Thiếu tham số devices");
  }

  var devicesList = [];
  if (typeof rawDevices === "string") {
    try {
      devicesList = JSON.parse(rawDevices);
    } catch (e) {
      return errorResponse("devices phải là chuỗi JSON mảng hợp lệ: " + e.message);
    }
  } else if (Array.isArray(rawDevices)) {
    devicesList = rawDevices;
  }

  if (devicesList.length === 0) {
    return errorResponse("Danh sách devices rỗng");
  }

  var lock = LockService.getScriptLock();
  try {
    lock.waitLock(30000);
  } catch (e) {
    return errorResponse("Hệ thống đang bận, vui lòng thử lại sau.");
  }

  try {
    var devicesSheet = getSheet("Devices");
    ensureHeaders(devicesSheet, [
      "mac", "anydesk_id", "project", "software", "mac_ics", 
      "status", "last_seen", "app_version", "storage_mb", "task_id", 
      "iot_id", "imei_sim", "notes"
    ]);

    var importedCount = 0;
    for (var i = 0; i < devicesList.length; i++) {
      var d = devicesList[i];
      var mac = d.mac ? String(d.mac).trim().replace(/[:\-]/g, "").toUpperCase() : "";
      if (!mac && !d.anydesk_id) continue;
      if (!mac) mac = "CHUA_MAC_" + (d.anydesk_id || i);

      upsertRow(devicesSheet, "mac", mac, {
        mac: mac,
        anydesk_id: d.anydesk_id ? String(d.anydesk_id).trim() : "",
        project: d.project ? String(d.project).trim() : "Kho thiết bị",
        software: d.software ? String(d.software).trim() : "Radio 3.6",
        mac_ics: d.mac_ics ? String(d.mac_ics).trim() : "",
        status: d.status || "offline",
        last_seen: d.last_seen || "",
        app_version: d.app_version || "",
        storage_mb: d.storage_mb || "",
        task_id: d.task_id || "",
        iot_id: d.iot_id ? String(d.iot_id).trim() : "",
        imei_sim: d.imei_sim ? String(d.imei_sim).trim() : "",
        notes: d.notes ? String(d.notes).trim() : ""
      });
      importedCount++;
    }

    // Tự động phân tách dữ liệu sang từng Sheet dự án
    try {
      syncProjectSheets();
    } catch (syncErr) {
      Logger.log("syncProjectSheets error: " + syncErr.message);
    }

    return {
      status: "ok",
      imported_count: importedCount,
      message: "Đã nạp thành công " + importedCount + " thiết bị và phân tách các Sheet dự án."
    };
  } finally {
    lock.releaseLock();
  }
}

/**
 * Tự động đồng bộ và tách dữ liệu:
 * 1. Sheet "FINAL - TẤT CẢ DỰ ÁN": Tổng hợp toàn bộ các thiết bị trên hệ thống.
 * 2. Mỗi Dự án (vd: "Xã Xuyên Mộc (Đợt 1)", "Box Bảo Hành", "Android Dự Phòng", "Kho thiết bị"...)
 *    có riêng 1 Sheet hiển thị danh sách thiết bị thuộc dự án đó.
 */
function syncProjectSheets() {
  var ss = getSpreadsheet();
  var masterSheet = getSheet("Devices");
  var rawRows = getSheetRowsAsObjects(masterSheet);

  var byProject = {};
  var allRowsFinal = [];

  for (var i = 0; i < rawRows.length; i++) {
    var r = rawRows[i];
    var proj = String(r.project || "").trim();
    if (!proj) proj = "Kho thiết bị";
    if (!byProject[proj]) {
      byProject[proj] = [];
    }
    byProject[proj].push(r);
  }

  // Cột hiển thị cho từng sheet dự án
  var projHeaders = [
    "STT", "MÃ ANYDESK", "MÃ IOT", "MAC ANDROID", "MÃ ICS", 
    "TRẠNG THÁI", "PHẦN MỀM", "APP VER", "PING CUỐI (HEARTBEAT)", 
    "IMEI SIM", "TASK HIỆN TẠI", "GHI CHÚ"
  ];

  // 1. CẬP NHẬT TỪNG SHEET DỰ ÁN
  for (var projName in byProject) {
    var safeName = projName.replace(/[\[\]\*\?\/\\:]/g, "-").substring(0, 80).trim();
    var pSheet = ss.getSheetByName(safeName);
    if (!pSheet) {
      pSheet = ss.insertSheet(safeName);
    }
    pSheet.clear();

    pSheet.getRange(1, 1, 1, projHeaders.length).setValues([projHeaders]);
    pSheet.getRange(1, 1, 1, projHeaders.length).setFontWeight("bold");
    pSheet.getRange(1, 1, 1, projHeaders.length).setBackground("#1E293B"); // Slate dark
    pSheet.getRange(1, 1, 1, projHeaders.length).setFontColor("#F8FAFC");
    pSheet.setFrozenRows(1);

    var items = byProject[projName];
    if (items && items.length > 0) {
      var tableData = [];
      for (var j = 0; j < items.length; j++) {
        var it = items[j];
        tableData.push([
          j + 1,
          String(it.anydesk_id || ""),
          String(it.iot_id || ""),
          String(it.mac || "").toUpperCase(),
          String(it.mac_ics || ""),
          String(it.status || ""),
          String(it.software || ""),
          String(it.app_version || ""),
          String(it.last_seen || ""),
          String(it.imei_sim || ""),
          String(it.task_id || ""),
          String(it.notes || "")
        ]);
      }
      pSheet.getRange(2, 1, tableData.length, projHeaders.length).setValues(tableData);
      pSheet.getRange(1, 1, tableData.length + 1, projHeaders.length)
        .setBorder(true, true, true, true, true, true, "#CBD5E1", SpreadsheetApp.BorderStyle.SOLID);
    }
  }

  // 2. CẬP NHẬT SHEET "FINAL - TẤT CẢ DỰ ÁN"
  var finalSheetName = "FINAL - TẤT CẢ DỰ ÁN";
  var fSheet = ss.getSheetByName(finalSheetName);
  if (!fSheet) {
    fSheet = ss.insertSheet(finalSheetName, 0); // Đặt ở vị trí đầu tiên
  }
  fSheet.clear();

  var finalHeaders = [
    "STT", "DỰ ÁN (ĐỊA BÀN)", "MÃ ANYDESK", "MÃ IOT", "MAC ANDROID", "MÃ ICS", 
    "TRẠNG THÁI", "PHẦN MỀM", "APP VER", "PING CUỐI (HEARTBEAT)", 
    "IMEI SIM", "TASK HIỆN TẠI", "GHI CHÚ"
  ];

  fSheet.getRange(1, 1, 1, finalHeaders.length).setValues([finalHeaders]);
  fSheet.getRange(1, 1, 1, finalHeaders.length).setFontWeight("bold");
  fSheet.getRange(1, 1, 1, finalHeaders.length).setBackground("#0F172A"); // Darker navy
  fSheet.getRange(1, 1, 1, finalHeaders.length).setFontColor("#38BDF8"); // Cyan text
  fSheet.setFrozenRows(1);

  var globalStt = 1;
  var finalData = [];
  for (var p in byProject) {
    var pItems = byProject[p];
    for (var k = 0; k < pItems.length; k++) {
      var itm = pItems[k];
      finalData.push([
        globalStt++,
        p,
        String(itm.anydesk_id || ""),
        String(itm.iot_id || ""),
        String(itm.mac || "").toUpperCase(),
        String(itm.mac_ics || ""),
        String(itm.status || ""),
        String(itm.software || ""),
        String(itm.app_version || ""),
        String(itm.last_seen || ""),
        String(itm.imei_sim || ""),
        String(itm.task_id || ""),
        String(itm.notes || "")
      ]);
    }
  }

  if (finalData.length > 0) {
    fSheet.getRange(2, 1, finalData.length, finalHeaders.length).setValues(finalData);
    fSheet.getRange(1, 1, finalData.length + 1, finalHeaders.length)
      .setBorder(true, true, true, true, true, true, "#94A3B8", SpreadsheetApp.BorderStyle.SOLID);
  }
}
