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
 * Chạy hàm này 1 lần trong Apps Script Editor để cấp quyền kết nối ra ngoài (script.external_request).
 */
function CAP_QUYEN_SAIGONIOT() {
  var resp = UrlFetchApp.fetch("https://cmsiot.saigoniot.vn:8081/assets/env.js", { muteHttpExceptions: true });
  Logger.log("OK! Đã có quyền external_request. HTTP " + resp.getResponseCode());
}

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
 * Chuẩn hóa mã AnyDesk (loại bỏ dấu cách, gạch ngang).
 */
function normalizeAnydeskId(val) {
  if (val === null || val === undefined) return "";
  return String(val).replace(/[\s\-]/g, "").trim();
}

/**
 * Quét tất cả các Sheet dự án do người dùng tự tạo (copy/paste danh sách mã AnyDesk vào Sheet mới)
 * và tự động đồng bộ ngược vào bảng Devices tổng (gắn đúng tên Sheet làm tên Dự án).
 */
function ingestProjectSheetsToMaster() {
  var ss = getSpreadsheet();
  var devicesSheet = getSheet("Devices");
  var requiredCols = [
    "mac", "anydesk_id", "project", "software", "mac_ics",
    "status", "last_seen", "app_version", "storage_mb", "task_id",
    "iot_id", "imei_sim", "notes"
  ];
  var headers = ensureHeaders(devicesSheet, requiredCols);
  var macIdx = headers.indexOf("mac");
  var adIdx = headers.indexOf("anydesk_id");
  var projIdx = headers.indexOf("project");

  var lastDevRow = devicesSheet.getLastRow();
  var devValues = lastDevRow > 1 ? devicesSheet.getRange(2, 1, lastDevRow - 1, headers.length).getValues() : [];

  // Map anydesk_id -> row index in Devices (0-based in devValues)
  var adToRowIdx = {};
  for (var d = 0; d < devValues.length; d++) {
    var existingAd = normalizeAnydeskId(devValues[d][adIdx]);
    if (existingAd) {
      adToRowIdx[existingAd] = d;
    }
  }

  var systemSheets = {
    "devices": true,
    "tasks": true,
    "templates": true,
    "heartbeat": true,
    "final - tất cả dự án": true,
    "config_radio20": true,
    "android mới": true,
    "radio 3.6": true,
    "radio 1.66": true,
    "ics": true,
    "sheet1": true,
    "trang tính 1": true
  };

  var allSheets = ss.getSheets();
  var newRowsToAppend = [];

  for (var s = 0; s < allSheets.length; s++) {
    var sheet = allSheets[s];
    var sheetName = String(sheet.getName() || "").trim();
    if (!sheetName || systemSheets[sheetName.toLowerCase()]) continue;

    var lastRow = sheet.getLastRow();
    var lastCol = sheet.getLastColumn();
    if (lastRow === 0 || lastCol === 0) continue;

    var data = sheet.getRange(1, 1, lastRow, Math.min(lastCol, 15)).getValues();
    var adCol = -1;
    var iotCol = -1;
    var macCol = -1;
    var softCol = -1;
    var noteCol = -1;
    var startRow = 0;

    // Kiểm tra xem dòng 1 có phải dòng tiêu đề không
    var row0Str = data[0].join(" ").toLowerCase();
    if (row0Str.indexOf("anydesk") !== -1 || row0Str.indexOf("stt") !== -1 || row0Str.indexOf("mac") !== -1) {
      startRow = 1;
      for (var c = 0; c < data[0].length; c++) {
        var h = String(data[0][c] || "").trim().toLowerCase();
        if (h.indexOf("anydesk") !== -1) adCol = c;
        else if (h.indexOf("iot") !== -1) iotCol = c;
        else if (h.indexOf("mac android") !== -1 || h === "mac") macCol = c;
        else if (h.indexOf("phần mềm") !== -1 || h === "software") softCol = c;
        else if (h.indexOf("ghi chú") !== -1 || h === "notes") noteCol = c;
      }
    }

    for (var r = startRow; r < data.length; r++) {
      var row = data[r];
      var foundAd = "";
      if (adCol !== -1) {
        var candidate = normalizeAnydeskId(row[adCol]);
        if (/^\d{8,11}$/.test(candidate)) foundAd = candidate;
      } else {
        // Người dùng vừa tạo Sheet mới và paste thẳng cột mã AnyDesk vào cột A, B hoặc C
        for (var colScan = 0; colScan < Math.min(row.length, 4); colScan++) {
          var cand = normalizeAnydeskId(row[colScan]);
          if (/^\d{8,11}$/.test(cand)) {
            foundAd = cand;
            break;
          }
        }
      }

      if (!foundAd) continue;

      var isLoiSheet = (sheetName.toLowerCase().indexOf("lỗi") !== -1 || sheetName.toLowerCase().indexOf("loi") !== -1 || sheetName.toLowerCase().indexOf("error") !== -1);
      var isStagingNew = (sheetName.toLowerCase() === "new" || sheetName.toLowerCase() === "mới" || sheetName.toLowerCase() === "box mới");

      if (adToRowIdx[foundAd] !== undefined) {
        // Đã có trên bảng Devices -> nếu đang ở "Kho thiết bị" hoặc rỗng thì cập nhật sang tên Sheet dự án mới
        var idx = adToRowIdx[foundAd];
        var curProj = String(devValues[idx][projIdx] || "").trim();
        if (!curProj || curProj === "Kho thiết bị") {
          if (isLoiSheet) {
            var noteColIdx = headers.indexOf("notes");
            if (noteColIdx !== -1) {
              devValues[idx][noteColIdx] = "Box lỗi";
              devicesSheet.getRange(idx + 2, noteColIdx + 1).setValue("Box lỗi");
            }
          } else if (!isStagingNew) {
            devValues[idx][projIdx] = sheetName;
            devicesSheet.getRange(idx + 2, projIdx + 1).setValue(sheetName);
          }
        }
      } else {
        // Chưa có trên bảng Devices -> thêm mới với project = tên Sheet
        var rowMac = (macCol !== -1 && row[macCol]) ? String(row[macCol]).trim().replace(/[:\-]/g, "").toUpperCase() : "";
        if (!rowMac) rowMac = "CHUA_MAC_" + foundAd;
        var rowSoft = (softCol !== -1 && row[softCol]) ? String(row[softCol]).trim() : "Chưa đồng bộ";
        var rowIot = (iotCol !== -1 && row[iotCol]) ? String(row[iotCol]).trim() : "";
        var rowNote = (noteCol !== -1 && row[noteCol]) ? String(row[noteCol]).trim() : "";

        var initProj = sheetName;
        if (isLoiSheet) {
          initProj = "Kho thiết bị";
          if (!rowNote) rowNote = "Box lỗi";
        } else if (isStagingNew) {
          initProj = "Kho thiết bị";
        }

        var newRowArr = [];
        var newObj = {
          mac: rowMac,
          anydesk_id: foundAd,
          project: initProj,
          software: rowSoft,
          mac_ics: "",
          status: "offline",
          last_seen: "",
          app_version: "",
          storage_mb: "",
          task_id: "",
          iot_id: rowIot,
          imei_sim: "",
          notes: rowNote
        };
        for (var hc = 0; hc < headers.length; hc++) {
          var key = headers[hc].toLowerCase();
          newRowArr.push(newObj[key] !== undefined ? newObj[key] : "");
        }
        newRowsToAppend.push(newRowArr);
        adToRowIdx[foundAd] = devValues.length + newRowsToAppend.length - 1;
      }
    }
  }

  if (newRowsToAppend.length > 0) {
    var appendStart = devicesSheet.getLastRow() + 1;
    devicesSheet.getRange(appendStart, 1, newRowsToAppend.length, headers.length).setValues(newRowsToAppend);
  }
}

/**
 * Kiểm tra xem giá trị MAC có phải là mã giữ chỗ tạm (chưa có MAC thật) hay không.
 */
function isPlaceholderMac(mac) {
  var m = String(mac || "").trim().toUpperCase();
  return !m || m === "UNKNOWN" || m.indexOf("CHUA_MAC_") === 0 || m.indexOf("BOX_") === 0;
}

/**
 * Tìm và cập nhật thiết bị trong bảng Devices theo cả MAC lẫn AnyDesk ID.
 * Nếu Box cũ đã có mã AnyDesk trong một Sheet dự án (với mã tạm CHUA_MAC_<anydesk>),
 * hàm này sẽ tự động khớp mã AnyDesk đó, giữ nguyên Dự án của Sheet, điền MAC thật,
 * phần mềm đang sử dụng và trạng thái Online!
 */
function upsertDeviceByMacOrAnydesk(devicesSheet, mac, anydeskId, dataObj) {
  var requiredCols = [
    "mac", "anydesk_id", "project", "software", "mac_ics",
    "status", "last_seen", "app_version", "storage_mb", "task_id",
    "iot_id", "imei_sim", "notes"
  ];
  var headers = ensureHeaders(devicesSheet, requiredCols);
  var macColIdx = headers.indexOf("mac");
  var adColIdx = headers.indexOf("anydesk_id");
  var projColIdx = headers.indexOf("project");
  var softColIdx = headers.indexOf("software");

  var cleanMac = String(mac || "").trim().replace(/[:\-]/g, "").toUpperCase();
  var cleanAd = normalizeAnydeskId(anydeskId);

  // Nếu lúc thêm Box lẻ / Dự án cũ chưa truyền MAC thật nhưng Box đã từng gửi Heartbeat vào RAM Cache,
  // tự động lấy luôn MAC thật và thông tin từ RAM Cache!
  if (isPlaceholderMac(cleanMac) && cleanAd) {
    try {
      var cachedHbStr = CacheService.getScriptCache().get("hbad_" + cleanAd);
      if (cachedHbStr) {
        var cachedHb = JSON.parse(cachedHbStr);
        if (cachedHb && cachedHb.mac && !isPlaceholderMac(cachedHb.mac)) {
          cleanMac = String(cachedHb.mac).trim().replace(/[:\-]/g, "").toUpperCase();
          if (!dataObj.software || dataObj.software === "Chưa đồng bộ") {
            dataObj.software = cachedHb.software || dataObj.software;
          }
          if (!dataObj.mac_ics && cachedHb.mac_ics) dataObj.mac_ics = cachedHb.mac_ics;
          if (!dataObj.last_seen && cachedHb.last_seen) dataObj.last_seen = cachedHb.last_seen;
          if (!dataObj.app_version && cachedHb.app_version) dataObj.app_version = cachedHb.app_version;
          if (!dataObj.storage_mb && cachedHb.storage_mb) dataObj.storage_mb = cachedHb.storage_mb;
          dataObj.status = "online";
        }
      }
    } catch (e) {}
  }

  var lastRow = devicesSheet.getLastRow();
  var macRowIdx = -1;     // 1-based row on sheet
  var adRowIdx = -1;      // 1-based row on sheet
  var macRowData = null;
  var adRowData = null;
  var pendingChuaMacRows = [];

  if (lastRow > 1) {
    var values = devicesSheet.getRange(2, 1, lastRow - 1, headers.length).getValues();
    for (var i = 0; i < values.length; i++) {
      var rMac = String(values[i][macColIdx] || "").trim().replace(/[:\-]/g, "").toUpperCase();
      var rAd = normalizeAnydeskId(values[i][adColIdx]);

      if (cleanMac && !isPlaceholderMac(cleanMac) && rMac === cleanMac) {
        macRowIdx = i + 2;
        macRowData = values[i];
      }
      if (cleanAd && (rAd === cleanAd || rMac === ("CHUA_MAC_" + cleanAd) || rMac === ("BOX_" + cleanAd))) {
        adRowIdx = i + 2;
        adRowData = values[i];
      }
      if (rMac.indexOf("CHUA_MAC_") === 0 && rAd) {
        pendingChuaMacRows.push({ rowIdx: i + 2, rowData: values[i], ad: rAd });
      }
    }
  }

  // KHÔNG dùng fallback đoán mò theo recent_pending_ad vì nếu một Box khác vừa cắm nguồn
  // chưa đọc kịp AnyDesk ID sẽ cướp nhầm vị trí và Mã IoT của Box người dùng vừa thêm!
  // Chỉ ghép MAC thật vào dòng CHUA_MAC_<anydesk> khi Box gửi LÊN ĐÚNG MÃ ANYDESK ĐÓ!

  var targetRowIdx = -1;
  var existingRowData = null;
  var matchedByAnydesk = false;

  if (macRowIdx > 0 && adRowIdx > 0 && macRowIdx !== adRowIdx) {
    // Có cả dòng MAC thật (vd ở Kho thiết bị) và dòng chờ CHUA_MAC_<anydesk> trên Sheet dự án mới -> Gộp lại!
    var adProj = String(adRowData[projColIdx] || "").trim();
    if (adProj && adProj !== "Kho thiết bị") {
      macRowData[projColIdx] = adProj;
    }
    // Giữ lại thông tin iot_id, imei_sim, notes nếu dòng AnyDesk có
    for (var c = 0; c < headers.length; c++) {
      if (!macRowData[c] && adRowData[c]) {
        macRowData[c] = adRowData[c];
      }
    }
    targetRowIdx = macRowIdx;
    existingRowData = macRowData;
    matchedByAnydesk = true;
    // Xóa dòng CHUA_MAC_ dư thừa
    devicesSheet.deleteRow(adRowIdx);
    if (adRowIdx < targetRowIdx) {
      targetRowIdx--;
    }
  } else if (adRowIdx > 0) {
    // Khớp theo mã AnyDesk trên Sheet dự án (hoặc CHUA_MAC_<anydesk>)!
    targetRowIdx = adRowIdx;
    existingRowData = adRowData;
    var oldMacVal = String(existingRowData[macColIdx] || "").trim().toUpperCase();
    if (isPlaceholderMac(oldMacVal) || (cleanMac && !isPlaceholderMac(cleanMac) && oldMacVal !== cleanMac)) {
      matchedByAnydesk = true;
    }
  } else if (macRowIdx > 0) {
    targetRowIdx = macRowIdx;
    existingRowData = macRowData;
  }

  if (targetRowIdx > 0 && existingRowData) {
    var updatedRow = [];
    for (var j = 0; j < headers.length; j++) {
      var colHeader = headers[j].toLowerCase();
      var existingVal = existingRowData[j];
      var incomingVal = dataObj[colHeader];

      if (colHeader === "mac") {
        var existingMacClean = String(existingVal || "").trim().replace(/[:\-]/g, "").toUpperCase();
        // Tuyệt đối không bao giờ ghi đè MAC thật đã có bằng mã tạm CHUA_MAC_
        if (cleanMac && !isPlaceholderMac(cleanMac)) {
          updatedRow.push(cleanMac);
        } else if (existingMacClean && !isPlaceholderMac(existingMacClean)) {
          updatedRow.push(existingMacClean);
        } else {
          updatedRow.push(cleanMac || existingMacClean || (cleanAd ? ("CHUA_MAC_" + cleanAd) : ""));
        }
      } else if (colHeader === "anydesk_id" && cleanAd) {
        updatedRow.push(cleanAd);
      } else if (colHeader === "project") {
        // Giữ nguyên dự án đã gắn trên Sheet nếu dataObj không truyền dự án cụ thể
        var curProjVal = String(existingVal || "").trim();
        if (incomingVal && incomingVal !== "Kho thiết bị") {
          updatedRow.push(incomingVal);
        } else if (curProjVal) {
          updatedRow.push(curProjVal);
        } else {
          updatedRow.push("Kho thiết bị");
        }
      } else if (colHeader === "software") {
        var curSoftVal = String(existingVal || "").trim();
        if (incomingVal && incomingVal !== "Chưa đồng bộ") {
          updatedRow.push(incomingVal);
        } else if (curSoftVal && curSoftVal !== "Chưa đồng bộ") {
          updatedRow.push(curSoftVal);
        } else {
          updatedRow.push(incomingVal || curSoftVal || "Radio 3.6");
        }
      } else if (incomingVal !== undefined && incomingVal !== "") {
        updatedRow.push(incomingVal);
      } else {
        updatedRow.push(existingVal);
      }
    }
    devicesSheet.getRange(targetRowIdx, 1, 1, headers.length).setValues([updatedRow]);
    return {
      row: targetRowIdx,
      isNew: false,
      matchedByAnydesk: matchedByAnydesk,
      mac: String(updatedRow[macColIdx] || cleanMac),
      project: String(updatedRow[projColIdx] || "Kho thiết bị"),
      software: String(updatedRow[softColIdx] || "")
    };
  } else {
    // Thiết bị hoàn toàn mới chưa có trong bất kỳ Sheet dự án nào
    var newRow = [];
    var defaultProj = dataObj.project || "Kho thiết bị";
    var defaultSoft = dataObj.software || "Radio 3.6";
    var finalNewMac = cleanMac || (cleanAd ? ("CHUA_MAC_" + cleanAd) : "");
    for (var col = 0; col < headers.length; col++) {
      var hName = headers[col].toLowerCase();
      if (hName === "mac") newRow.push(finalNewMac);
      else if (hName === "anydesk_id") newRow.push(cleanAd);
      else if (hName === "project") newRow.push(defaultProj);
      else if (hName === "software") newRow.push(defaultSoft);
      else if (dataObj[hName] !== undefined) newRow.push(dataObj[hName]);
      else newRow.push("");
    }
    devicesSheet.appendRow(newRow);
    return {
      row: devicesSheet.getLastRow(),
      isNew: true,
      matchedByAnydesk: false,
      mac: finalNewMac,
      project: defaultProj,
      software: defaultSoft
    };
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

// ==============================================================================
// ADMIN AUTHENTICATION & SECURITY MODULE (SHA-256 DOUBLE-HASH + PEPPER)
// ==============================================================================

var SERVER_PEPPER = "SGL_SERVER_PEPPER_2026";
// SHA-256(clientToken + ":SGL_SERVER_PEPPER_2026") — Không lưu trực tiếp clientToken trong mã nguồn
var EXPECTED_SERVER_HASH = "9a2ab7e32ba82f927abcd5fa6e9ad5d0db04fbccafee5597153184a5284b32a4";
var AUTH_FAIL_CACHE_KEY = "sgl_auth_fail_count_v1";
var UNAUTH_REG_RATE_KEY = "sgl_unauth_reg_rate_v1";

/**
 * Băm chuỗi sang SHA-256 Hex chữ thường trên Google Apps Script.
 */
function sha256HexServer(inputStr) {
  var rawBytes = Utilities.computeDigest(
    Utilities.DigestAlgorithm.SHA_256,
    String(inputStr || ""),
    Utilities.Charset.UTF_8
  );
  var hex = "";
  for (var i = 0; i < rawBytes.length; i++) {
    var b = rawBytes[i];
    if (b < 0) b += 256;
    var bHex = b.toString(16);
    if (bHex.length === 1) bHex = "0" + bHex;
    hex += bHex;
  }
  return hex.toLowerCase();
}

/**
 * Kiểm tra request có mang auth_token hợp lệ của Quản trị viên hay không.
 * Hỗ trợ nâng cấp tự động lên khóa V2 trong PropertiesService để vô hiệu hóa các hash cũ trên Git.
 */
function isAdminAuthenticated(params) {
  if (!params) return false;
  var token = params.auth_token ? String(params.auth_token).trim() : "";
  var legacyToken = params.legacy_token ? String(params.legacy_token).trim() : "";
  if (!token && !legacyToken) return false;

  var cache = CacheService.getScriptCache();
  try {
    var failCountStr = cache.get(AUTH_FAIL_CACHE_KEY);
    var failCount = failCountStr ? parseInt(failCountStr, 10) : 0;
    if (failCount >= 15) {
      return false; // Tạm khóa xác thực 60 giây nếu bị dò token sai quá 15 lần
    }
  } catch (e) {}

  var v2ServerHash = "";
  try {
    v2ServerHash = PropertiesService.getScriptProperties().getProperty("ADMIN_V2_SERVER_HASH") || "";
  } catch (e) {}

  var computedTokenHash = token ? sha256HexServer(token + ":" + SERVER_PEPPER) : "";
  var computedLegacyHash = legacyToken ? sha256HexServer(legacyToken + ":" + SERVER_PEPPER) : "";

  if (v2ServerHash) {
    // Khi khóa V2 đã được kích hoạt trong PropertiesService: bắt buộc khớp khóa V2 (chặn hoàn toàn hash cũ)
    if (computedTokenHash && computedTokenHash === v2ServerHash) {
      return true;
    }
  } else {
    // Trước khi khóa V2 được kích hoạt lần đầu: chấp nhận khớp EXPECTED_SERVER_HASH
    if (computedTokenHash === EXPECTED_SERVER_HASH || computedLegacyHash === EXPECTED_SERVER_HASH) {
      return true;
    }
  }

  try {
    var curFail = parseInt(cache.get(AUTH_FAIL_CACHE_KEY) || "0", 10);
    cache.put(AUTH_FAIL_CACHE_KEY, String(curFail + 1), 60);
  } catch (e) {}
  return false;
}

/**
 * Trả về lỗi UNAUTHORIZED nếu chưa xác thực Admin, hoặc null nếu hợp lệ.
 */
function requireAdminAuth(params) {
  if (!isAdminAuthenticated(params)) {
    return {
      status: "error",
      code: "UNAUTHORIZED",
      message: "Từ chối truy cập: Yêu cầu xác thực Quản trị viên (Invalid or missing auth_token)."
    };
  }
  return null;
}

/**
 * Kích hoạt và khóa cứng Token V2 vào PropertiesService ngay khi Admin đăng nhập bằng mật khẩu.
 */
function handleBindV2Auth(params) {
  var token = params.auth_token ? String(params.auth_token).trim() : "";
  var legacyToken = params.legacy_token ? String(params.legacy_token).trim() : "";
  if (!token || !legacyToken || token === legacyToken) {
    return errorResponse("Thiếu thông tin khóa V2 hợp lệ để liên kết bảo mật.");
  }

  var legacyCheck = sha256HexServer(legacyToken + ":" + SERVER_PEPPER);
  if (legacyCheck !== EXPECTED_SERVER_HASH) {
    return {
      status: "error",
      code: "UNAUTHORIZED",
      message: "Không thể xác thực chữ ký gốc của Quản trị viên."
    };
  }

  var v2ServerHash = sha256HexServer(token + ":" + SERVER_PEPPER);
  try {
    PropertiesService.getScriptProperties().setProperty("ADMIN_V2_SERVER_HASH", v2ServerHash);
  } catch (e) {
    return errorResponse("Không thể lưu khóa V2 vào PropertiesService: " + e.message);
  }

  return {
    status: "ok",
    v2_bound: true,
    message: "Đã nâng cấp và khóa bảo mật Token V2 trên Server thành công."
  };
}

/**
 * Kiểm tra kịch bản steps_json không chứa các lệnh phá hủy hệ thống trái phép.
 */
function validateSafeStepsJson(stepsJsonStr) {
  var s = String(stepsJsonStr || "");
  var dangerousPatterns = [
    /rm\s+-rf\s+\/\b/i,
    /\bmkfs\b/i,
    /\bdd\s+if=/i,
    /\breboot\s+bootloader\b/i,
    /\/dev\/tcp\//i,
    /\bnc\s+-e\b/i,
    /\bncat\b/i
  ];
  for (var i = 0; i < dangerousPatterns.length; i++) {
    if (dangerousPatterns[i].test(s)) {
      return "Từ chối kịch bản: Phát hiện lệnh hệ thống nguy hiểm bị cấm.";
    }
  }
  return null;
}

/**
 * Bộ định tuyến (Router) chuyển tiếp action tới handler tương ứng.
 */
function routeAction(action, params) {
  if (!action) {
    return {
      status: "ok",
      version: "2.2.0-auth-secured",
      message: "Radio Device Manager Backend API is online (Auth Enforced)",
      timestamp: new Date().toISOString()
    };
  }

  // Các hành động Quản trị bắt buộc phải có auth_token hợp lệ của Admin
  var adminActions = {
    "assign_project": true,
    "update_iot_id": true,
    "create_task": true,
    "save_template": true,
    "batch_import_devices": true,
    "sync_project_sheets": true,
    "get_devices": true,
    "get_templates": true,
    "get_tasks": true,
    "verify_auth": true,
    "get_iot_statuses": true,
    "save_cmsiot_config": true,
    "get_cmsiot_config_status": true
  };

  if (adminActions[action]) {
    var authErr = requireAdminAuth(params);
    if (authErr) return authErr;
  }

  switch (action) {
    // Auth & Security Actions
    case "bind_v2_auth":
      return handleBindV2Auth(params);
    case "verify_auth":
      return { status: "ok", authenticated: true, version: "2.2.0-auth-secured" };

    // POST Actions (Agent & Admin)
    case "heartbeat":
      return handleHeartbeat(params);
    case "claim_task":
      return handleClaimTask(params);
    case "complete_task":
      return handleCompleteTask(params);
    case "register_device":
      return handleRegisterDevice(params);
    case "update_iot_id":
      return handleUpdateIotId(params);
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

    // GET Actions (Admin)
    case "get_devices":
      return handleGetDevices(params);
    case "get_templates":
      return handleGetTemplates(params);
    case "get_tasks":
      return handleGetTasks(params);
    case "get_iot_statuses":
      return handleGetIotStatuses(params);
    case "save_cmsiot_config":
      return handleSaveCmsIotConfig(params);
    case "get_cmsiot_config_status":
      return handleGetCmsIotConfigStatus();
    case "iot_auth_status":
      return { status: "ok", auth_required: getIotAuthStatusInfo().required };

    default:
      return errorResponse("Hành động không hợp lệ: " + action);
  }
}

// ==============================================================================
// BUSINESS LOGIC HANDLERS
// ==============================================================================

// ==============================================================================
// HIGH-THROUGHPUT CACHE & BATCH FLUSH ENGINE (CHỊU TẢI 2.000+ BOX)
// ==============================================================================

var PENDING_TASKS_CACHE_KEY = "sgl_pending_tasks_map_v1";
var LAST_FLUSH_TS_KEY = "sgl_last_sheet_flush_ts_v1";
var NEW_HB_MACS_KEY = "sgl_new_hb_macs_v1";
var FLUSH_INTERVAL_MS = 60 * 1000; // Ghi gộp xuống Sheet tối đa 1 lần / 60 giây

/**
 * Xóa cache nhiệm vụ đang chờ khi có thay đổi (create_task, claim_task, complete_task, save_template).
 */
function invalidatePendingTasksCache() {
  try {
    CacheService.getScriptCache().remove(PENDING_TASKS_CACHE_KEY);
  } catch (e) {}
}

/**
 * Đọc nhiệm vụ đang chờ của 1 MAC từ bộ nhớ đệm RAM (chỉ mất ~2ms, không cần đọc Sheet).
 * Nếu cache hết hạn (90 giây), tự động nạp lại từ bảng Tasks + Templates.
 */
function getPendingTaskFromCacheOrSheet(mac) {
  if (!mac) return null;
  var cleanMacLower = String(mac).trim().toLowerCase();
  var cache = CacheService.getScriptCache();

  try {
    var cachedStr = cache.get(PENDING_TASKS_CACHE_KEY);
    if (cachedStr) {
      var taskMap = JSON.parse(cachedStr);
      return taskMap[cleanMacLower] || null;
    }
  } catch (e) {}

  // Cache miss -> Đọc từ Sheet Tasks + Templates 1 lần và lưu vào RAM 90 giây
  try {
    var tasksSheet = getSheet("Tasks");
    var templatesSheet = getSheet("Templates");
    var allTasks = getSheetRowsAsObjects(tasksSheet);
    var allTemplates = getSheetRowsAsObjects(templatesSheet);

    var tplMap = {};
    for (var i = 0; i < allTemplates.length; i++) {
      var tName = String(allTemplates[i].template_name || "").trim().toLowerCase();
      if (tName) {
        tplMap[tName] = allTemplates[i].steps_json || "[]";
      }
    }

    // Sắp xếp tăng dần theo created_at
    var pendingTasks = allTasks.filter(function(t) {
      return String(t.status || "").trim().toLowerCase() === "pending";
    });
    pendingTasks.sort(function(a, b) {
      var tA = new Date(a.created_at).getTime() || 0;
      var tB = new Date(b.created_at).getTime() || 0;
      return tA - tB;
    });

    var newMap = {};
    for (var j = 0; j < pendingTasks.length; j++) {
      var pt = pendingTasks[j];
      var targetMac = String(pt.target_mac || "").trim().toLowerCase();
      if (targetMac && !newMap[targetMac]) {
        var tplName = String(pt.template_name || "").trim();
        newMap[targetMac] = {
          task_id: String(pt.task_id || ""),
          template_name: tplName,
          steps_json: tplMap[tplName.toLowerCase()] || "[]"
        };
      }
    }

    try {
      cache.put(PENDING_TASKS_CACHE_KEY, JSON.stringify(newMap), 90);
    } catch (cachePutErr) {}

    return newMap[cleanMacLower] || null;
  } catch (err) {
    return null;
  }
}

/**
 * Helper đọc hàng loạt key từ CacheService (chia nhỏ mỗi mẻ 500 keys để vượt giới hạn getAll).
 */
function getCacheBatch(cache, keys) {
  var result = {};
  if (!keys || keys.length === 0) return result;
  var CHUNK_SIZE = 500;
  for (var i = 0; i < keys.length; i += CHUNK_SIZE) {
    var chunk = keys.slice(i, i + CHUNK_SIZE);
    try {
      var part = cache.getAll(chunk);
      if (part) {
        for (var k in part) {
          result[k] = part[k];
        }
      }
    } catch (e) {}
  }
  return result;
}

/**
 * Hàm Ghi Gộp Hàng Loạt (Batch Flush):
 * Gom toàn bộ nhịp sống (Heartbeat) của hàng nghìn Box đang lưu trong RAM Cache
 * và ghi xuống bảng Devices chỉ bằng 1 lệnh setValues() duy nhất!
 */
function flushCachedHeartbeatsToSheet() {
  var cache = CacheService.getScriptCache();

  // 1. Quét các Sheet dự án mới tạo (nếu có)
  try {
    ingestProjectSheetsToMaster();
  } catch (e) {}

  var devicesSheet = getSheet("Devices");
  var requiredCols = [
    "mac", "anydesk_id", "project", "software", "mac_ics",
    "status", "last_seen", "app_version", "storage_mb", "task_id",
    "iot_id", "imei_sim", "notes"
  ];
  var headers = ensureHeaders(devicesSheet, requiredCols);
  var macIdx = headers.indexOf("mac");
  var adIdx = headers.indexOf("anydesk_id");
  var projIdx = headers.indexOf("project");
  var softIdx = headers.indexOf("software");
  var icsIdx = headers.indexOf("mac_ics");
  var statusIdx = headers.indexOf("status");
  var lastSeenIdx = headers.indexOf("last_seen");
  var appVerIdx = headers.indexOf("app_version");
  var storageIdx = headers.indexOf("storage_mb");
  var taskIdx = headers.indexOf("task_id");

  var lastRow = devicesSheet.getLastRow();
  var values = lastRow > 1 ? devicesSheet.getRange(2, 1, lastRow - 1, headers.length).getValues() : [];

  // Danh sách các MAC mới gửi heartbeat nhưng có thể chưa nằm trong bảng Devices (hoặc đang là CHUA_MAC_)
  var extraMacs = [];
  try {
    var rawExtra = cache.get(NEW_HB_MACS_KEY);
    if (rawExtra) extraMacs = JSON.parse(rawExtra);
  } catch (e) {}

  var cacheKeysObj = {};
  for (var i = 0; i < values.length; i++) {
    var rMac = String(values[i][macIdx] || "").trim().replace(/[:\-]/g, "").toUpperCase();
    var rAd = normalizeAnydeskId(values[i][adIdx]);
    if (rMac) cacheKeysObj["hb_" + rMac] = true;
    if (rAd) cacheKeysObj["hbad_" + rAd] = true;
  }
  for (var m = 0; m < extraMacs.length; m++) {
    cacheKeysObj["hb_" + extraMacs[m]] = true;
  }

  var allCacheKeys = Object.keys(cacheKeysObj);
  var cachedMap = getCacheBatch(cache, allCacheKeys);

  var nowMs = new Date().getTime();
  var OFFLINE_THRESHOLD_MS = 12 * 60 * 1000;
  var dirtySheet = false;
  var matchedNewBoxOrSoft = false;
  var handledMacs = {};

  for (var r = 0; r < values.length; r++) {
    var row = values[r];
    var rowMac = String(row[macIdx] || "").trim().replace(/[:\-]/g, "").toUpperCase();
    var rowAd = normalizeAnydeskId(row[adIdx]);

    var hbStr = cachedMap["hb_" + rowMac] || (rowAd ? cachedMap["hbad_" + rowAd] : null);
    if (hbStr) {
      try {
        var hb = JSON.parse(hbStr);
        if (hb.mac && !isPlaceholderMac(hb.mac) && isPlaceholderMac(rowMac)) {
          row[macIdx] = hb.mac;
          rowMac = hb.mac;
          matchedNewBoxOrSoft = true;
        }
        // Chỉ điền AnyDesk ID nếu dòng này chưa từng có AnyDesk ID, tuyệt đối không ghi đè mã AnyDesk khác
        if (hb.anydesk_id && !rowAd) {
          row[adIdx] = hb.anydesk_id;
          dirtySheet = true;
        }
        if (hb.software && hb.software !== row[softIdx]) {
          row[softIdx] = hb.software;
          matchedNewBoxOrSoft = true;
        }
        if (hb.mac_ics && hb.mac_ics !== row[icsIdx]) {
          row[icsIdx] = hb.mac_ics;
          matchedNewBoxOrSoft = true;
        }
        if (hb.last_seen && hb.last_seen !== row[lastSeenIdx]) {
          row[lastSeenIdx] = hb.last_seen;
          dirtySheet = true;
        }
        if (hb.app_version !== undefined && String(hb.app_version) !== "" && hb.app_version !== row[appVerIdx]) {
          row[appVerIdx] = hb.app_version;
          dirtySheet = true;
        }
        if (hb.storage_mb !== undefined && String(hb.storage_mb) !== "" && hb.storage_mb !== row[storageIdx]) {
          row[storageIdx] = hb.storage_mb;
          dirtySheet = true;
        }
        if (hb.current_task !== undefined && hb.current_task !== row[taskIdx]) {
          row[taskIdx] = hb.current_task;
          dirtySheet = true;
        }
        handledMacs[rowMac] = true;
      } catch (parseErr) {}
    }

    // Tự động tính toán trạng thái online / offline theo mốc 12 phút
    var lsVal = String(row[lastSeenIdx] || "").trim();
    var curSt = String(row[statusIdx] || "").trim().toLowerCase();
    if (lsVal) {
      var seenMs = new Date(lsVal).getTime();
      if (!isNaN(seenMs)) {
        var newSt = (nowMs - seenMs) <= OFFLINE_THRESHOLD_MS ? "online" : "offline";
        if (curSt !== "busy" && curSt !== newSt) {
          row[statusIdx] = newSt;
          dirtySheet = true;
        }
      }
    }
  }

  // Ghi gộp toàn bộ bảng Devices chỉ bằng 1 lệnh setValues duy nhất!
  if ((dirtySheet || matchedNewBoxOrSoft) && values.length > 0) {
    devicesSheet.getRange(2, 1, values.length, headers.length).setValues(values);
  }

  // Thêm các Box hoàn toàn mới chưa có trong bảng Devices
  for (var em = 0; em < extraMacs.length; em++) {
    var eMac = extraMacs[em];
    if (handledMacs[eMac]) continue;
    var eHbStr = cachedMap["hb_" + eMac];
    if (eHbStr) {
      try {
        var eHb = JSON.parse(eHbStr);
        upsertDeviceByMacOrAnydesk(devicesSheet, eHb.mac, eHb.anydesk_id, {
          mac: eHb.mac,
          anydesk_id: eHb.anydesk_id || "",
          software: eHb.software || "Radio 3.6",
          mac_ics: eHb.mac_ics || "",
          status: "online",
          last_seen: eHb.last_seen || new Date().toISOString(),
          app_version: eHb.app_version || "",
          storage_mb: eHb.storage_mb || "",
          task_id: eHb.current_task || ""
        });
        matchedNewBoxOrSoft = true;
      } catch (e) {}
    }
  }

  try {
    cache.remove(NEW_HB_MACS_KEY);
    cache.put(LAST_FLUSH_TS_KEY, String(nowMs), 3600);
  } catch (e) {}

  if (matchedNewBoxOrSoft) {
    try {
      syncProjectSheets();
    } catch (e) {}
  }
}

/**
 * POST action=heartbeat (TỐI ƯU HÓA CHỊU TẢI CAO - PHƯƠNG ÁN A)
 * - Ghi trực tiếp vào bộ nhớ đệm RAM (CacheService) trong ~5ms, KHÔNG khóa LockService.
 * - Đọc nhiệm vụ đang chờ từ Cache RAM (~2ms).
 * - Định kỳ 60 giây mới gom toàn bộ dữ liệu trong RAM ghi gộp 1 lần xuống Google Sheet.
 */
function handleHeartbeat(params) {
  var rawMac = params.mac ? String(params.mac).trim() : "";
  if (!rawMac) {
    return errorResponse("Thiếu tham số bắt buộc: mac");
  }

  var cleanMac = rawMac.replace(/[:\-]/g, "").toUpperCase();
  var anydeskId = params.anydesk_id !== undefined ? normalizeAnydeskId(params.anydesk_id) : "";
  var nowIso = new Date().toISOString();
  var nowMs = new Date().getTime();

  var hbObj = {
    mac: cleanMac,
    anydesk_id: anydeskId,
    last_seen: nowIso,
    status: "online",
    ram_mb: params.ram_mb !== undefined ? params.ram_mb : "",
    storage_mb: params.storage_mb !== undefined ? params.storage_mb : "",
    current_task: params.current_task !== undefined ? params.current_task : "",
    app_version: params.app_version !== undefined ? params.app_version : "",
    ip: params.ip !== undefined ? params.ip : "",
    software: params.software !== undefined ? String(params.software).trim() : "",
    mac_ics: params.mac_ics !== undefined ? String(params.mac_ics).trim() : ""
  };

  var cache = CacheService.getScriptCache();
  try {
    var hbJson = JSON.stringify(hbObj);
    // Lưu nhịp sống vào RAM Cache (giữ trong 6 giờ = 21600 giây)
    cache.put("hb_" + cleanMac, hbJson, 21600);
    if (anydeskId) {
      cache.put("hbad_" + anydeskId, hbJson, 21600);
    }

    // Ghi nhận MAC vào danh sách chờ đồng bộ
    var rawExtra = cache.get(NEW_HB_MACS_KEY);
    var extraArr = rawExtra ? JSON.parse(rawExtra) : [];
    if (extraArr.indexOf(cleanMac) === -1 && extraArr.length < 400) {
      extraArr.push(cleanMac);
      cache.put(NEW_HB_MACS_KEY, JSON.stringify(extraArr), 3600);
    }
  } catch (cacheErr) {
    Logger.log("Cache put error: " + cacheErr.message);
  }

  // Nếu đây là lần đầu tiên Box gửi thông tin (hoặc vừa cập nhật AnyDesk ID / vừa thêm Box lẻ / Dự án cũ),
  // lập tức ghi thẳng MAC thật xuống Google Sheet ngay (0 giây trễ) thay vì đợi chu kỳ 60 giây!
  var syncPairKey = "synced_pair_" + cleanMac + "_" + (anydeskId || "noad");
  var isFirstSignalForPair = !cache.get(syncPairKey);

  // Kiểm tra xem đã đến chu kỳ 60 giây để ghi gộp (Batch Flush) xuống Google Sheet chưa, hoặc là tín hiệu đầu tiên của Box
  var lastFlushStr = cache.get(LAST_FLUSH_TS_KEY);
  var lastFlushMs = lastFlushStr ? parseInt(lastFlushStr, 10) : 0;
  if (isFirstSignalForPair || !lastFlushMs || (nowMs - lastFlushMs) >= FLUSH_INTERVAL_MS) {
    var lock = LockService.getScriptLock();
    var waitTimeMs = isFirstSignalForPair ? 5000 : 400;
    if (lock.tryLock(waitTimeMs)) {
      try {
        cache.put(LAST_FLUSH_TS_KEY, String(nowMs), 3600);
        flushCachedHeartbeatsToSheet();
        cache.put(syncPairKey, "1", 21600);
      } catch (flushErr) {
        Logger.log("flushCachedHeartbeatsToSheet error: " + flushErr.message);
      } finally {
        lock.releaseLock();
      }
    }
  }

  // Tìm task pending từ RAM Cache (chỉ mất 2ms)
  var pendingTaskResult = getPendingTaskFromCacheOrSheet(cleanMac);

  return {
    status: "ok",
    pending_task: pendingTaskResult
  };
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
    invalidatePendingTasksCache();

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
    invalidatePendingTasksCache();

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
      var mProj = resultStr.match(/project=([^,\n;]+)/i);
      if (mProj) updateDevObj.project = mProj[1].trim();

      upsertRow(devicesSheet, "mac", mac, updateDevObj);
      if (updateDevObj.mac_ics || updateDevObj.software || updateDevObj.project) {
        try { syncProjectSheets(); } catch (syncErr) { Logger.log(syncErr); }
      }
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
  var isAdmin = isAdminAuthenticated(params);
  var mac = params.mac ? String(params.mac).trim() : "";
  var anydeskId = params.anydesk_id ? normalizeAnydeskId(params.anydesk_id) : "";

  if (!mac && !anydeskId) {
    return errorResponse("Thiếu tham số bắt buộc: cần ít nhất mac hoặc anydesk_id");
  }
  if (!mac && anydeskId) {
    mac = "CHUA_MAC_" + anydeskId;
  }

  // Nếu request KHÔNG có auth_token của Quản trị viên (tức là gọi từ Android Box ngoài thực địa):
  if (!isAdmin) {
    var cleanHexMac = mac.replace(/[:\-]/g, "").toUpperCase();
    // 1. Chặn việc tạo dòng CHUA_MAC_ hoặc gửi MAC giả mạo không đúng chuẩn 12 ký tự Hex
    if (isPlaceholderMac(mac) || !/^[0-9A-F]{12}$/.test(cleanHexMac)) {
      return {
        status: "error",
        code: "UNAUTHORIZED",
        message: "Từ chối truy cập: Chỉ Quản trị viên mới được phép thêm Box lẻ hoặc đăng ký mã chờ."
      };
    }
    mac = cleanHexMac;

    // 2. Chặn việc request không xác thực tự ý ghi đè thông tin quản trị (Dự án, Mã IoT, IMEI SIM, Ghi chú)
    delete params.project;
    delete params.iot_id;
    delete params.imei_sim;
    delete params.notes;

    // 3. Giới hạn tần suất (Rate Limit) đăng ký thiết bị từ xa để chống Botnet spam làm đầy Google Sheet
    try {
      var cache = CacheService.getScriptCache();
      var regCount = parseInt(cache.get(UNAUTH_REG_RATE_KEY) || "0", 10);
      if (regCount > 40) {
        return errorResponse("Hệ thống đang giới hạn tần suất đăng ký tự động. Vui lòng thử lại sau 1 phút.");
      }
      cache.put(UNAUTH_REG_RATE_KEY, String(regCount + 1), 60);
    } catch (e) {}
  }

  var lock = LockService.getScriptLock();
  try {
    lock.waitLock(15000);
  } catch (e) {
    return errorResponse("Hệ thống đang bận, vui lòng thử lại sau.");
  }

  try {
    // 0. Ghi gộp nhịp sống mới nhất từ RAM Cache và quét các Sheet dự án mới tạo
    try {
      flushCachedHeartbeatsToSheet();
    } catch (flushErr) {}
    try {
      ingestProjectSheetsToMaster();
    } catch (ingErr) {
      Logger.log("ingestProjectSheetsToMaster error in register_device: " + ingErr.message);
    }

    var devicesSheet = getSheet("Devices");
    var nowIso = new Date().toISOString();
    var isPlaceholder = isPlaceholderMac(mac);

    var deviceData = {
      mac: mac,
      anydesk_id: anydeskId,
      status: params.status || (isPlaceholder ? "offline" : "online"),
      last_seen: isPlaceholder ? "" : nowIso
    };
    if (params.project) deviceData.project = String(params.project).trim();
    if (params.software) deviceData.software = String(params.software).trim();
    if (params.mac_ics) deviceData.mac_ics = String(params.mac_ics).trim();
    if (params.iot_id) deviceData.iot_id = String(params.iot_id).trim();
    if (params.imei_sim) deviceData.imei_sim = String(params.imei_sim).trim();
    if (params.app_version) deviceData.app_version = String(params.app_version).trim();
    if (params.storage_mb) deviceData.storage_mb = String(params.storage_mb).trim();
    if (params.notes) deviceData.notes = String(params.notes).trim();

    var upsertRes = upsertDeviceByMacOrAnydesk(devicesSheet, mac, anydeskId, deviceData);

    try {
      syncProjectSheets();
    } catch (syncErr) {
      Logger.log("syncProjectSheets error in register_device: " + syncErr.message);
    }

    return {
      status: "ok",
      is_new: upsertRes.isNew,
      matched_by_anydesk: upsertRes.matchedByAnydesk,
      mac: upsertRes.mac,
      project: upsertRes.project,
      software: upsertRes.software
    };
  } finally {
    lock.releaseLock();
  }
}

/**
 * POST action=update_iot_id
 * Cho phép Quản trị viên cập nhật hoặc sửa Mã AnyDesk và Mã IoT (iot_id) cho thiết bị theo AnyDesk ID hoặc MAC.
 */
function handleUpdateIotId(params) {
  var oldAnydeskId = params.old_anydesk_id ? normalizeAnydeskId(params.old_anydesk_id) : "";
  var anydeskId = params.anydesk_id ? normalizeAnydeskId(params.anydesk_id) : "";
  var mac = params.mac ? String(params.mac).trim().replace(/[:\-]/g, "").toUpperCase() : "";
  var newIotId = params.iot_id !== undefined ? String(params.iot_id).trim() : "";

  var lookupAnydesk = oldAnydeskId || anydeskId;

  if (!lookupAnydesk && !mac) {
    return errorResponse("Thiếu thông tin nhận diện thiết bị (cần anydesk_id hoặc mac)");
  }

  var lock = LockService.getScriptLock();
  try {
    lock.waitLock(15000);
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
    var headers = getSheetHeaders(devicesSheet);
    var macColIdx = headers.indexOf("mac");
    var adColIdx = headers.indexOf("anydesk_id");
    var iotColIdx = headers.indexOf("iot_id");

    if (iotColIdx === -1 || adColIdx === -1) {
      return errorResponse("Sheet Devices thiếu cột iot_id hoặc anydesk_id.");
    }

    var lastRow = devicesSheet.getLastRow();
    var targetRowIdx = -1;
    var currentAdInRow = "";
    var currentMacInRow = "";

    if (lastRow > 1) {
      var values = devicesSheet.getRange(2, 1, lastRow - 1, headers.length).getValues();
      for (var i = 0; i < values.length; i++) {
        var rMac = String(values[i][macColIdx] || "").trim().replace(/[:\-]/g, "").toUpperCase();
        var rAd = normalizeAnydeskId(values[i][adColIdx]);

        if (mac && !isPlaceholderMac(mac) && rMac === mac) {
          targetRowIdx = i + 2;
          currentAdInRow = rAd;
          currentMacInRow = rMac;
          break;
        }
        if (oldAnydeskId && (rAd === oldAnydeskId || rMac === ("CHUA_MAC_" + oldAnydeskId) || rMac === ("BOX_" + oldAnydeskId))) {
          targetRowIdx = i + 2;
          currentAdInRow = rAd;
          currentMacInRow = rMac;
          break;
        }
        if (anydeskId && (rAd === anydeskId || rMac === ("CHUA_MAC_" + anydeskId) || rMac === ("BOX_" + anydeskId))) {
          targetRowIdx = i + 2;
          currentAdInRow = rAd;
          currentMacInRow = rMac;
          break;
        }
      }
    }

    var effectiveOldAd = oldAnydeskId || currentAdInRow;

    if (targetRowIdx > 0) {
      devicesSheet.getRange(targetRowIdx, iotColIdx + 1).setValue(newIotId);

      if (anydeskId) {
        devicesSheet.getRange(targetRowIdx, adColIdx + 1).setValue(anydeskId);

        if (isPlaceholderMac(currentMacInRow)) {
          var newPlaceholderMac = "CHUA_MAC_" + anydeskId;
          devicesSheet.getRange(targetRowIdx, macColIdx + 1).setValue(newPlaceholderMac);
        }
      }
    } else {
      // Nếu chưa có dòng nào, tự động thêm mới với AnyDesk / MAC và Mã IoT này
      upsertDeviceByMacOrAnydesk(devicesSheet, mac || (anydeskId ? "CHUA_MAC_" + anydeskId : ""), anydeskId, {
        mac: mac || (anydeskId ? "CHUA_MAC_" + anydeskId : ""),
        anydesk_id: anydeskId,
        iot_id: newIotId,
        project: "Kho thiết bị"
      });
    }

    // Nếu AnyDesk bị đổi sang mã mới, thay thế mã cũ trên tất cả các Sheet dữ liệu khác
    if (effectiveOldAd && anydeskId && effectiveOldAd !== anydeskId) {
      var ss = getSpreadsheet();
      var allSheets = ss.getSheets();
      for (var s = 0; s < allSheets.length; s++) {
        var sh = allSheets[s];
        var shName = String(sh.getName() || "").toLowerCase();
        if (shName === "devices") continue;
        var sLastRow = sh.getLastRow();
        var sLastCol = sh.getLastColumn();
        if (sLastRow === 0 || sLastCol === 0) continue;
        var sRange = sh.getRange(1, 1, sLastRow, Math.min(sLastCol, 15));
        var sValues = sRange.getValues();
        var isModified = false;
        for (var r = 0; r < sValues.length; r++) {
          for (var c = 0; c < sValues[r].length; c++) {
            if (normalizeAnydeskId(sValues[r][c]) === effectiveOldAd) {
              sValues[r][c] = anydeskId;
              isModified = true;
            }
          }
        }
        if (isModified) {
          sRange.setValues(sValues);
        }
      }
    }

    // Tự động đồng bộ cập nhật Mã IoT & AnyDesk sang Sheet Dự Án và Sheet Final
    try {
      syncProjectSheets();
    } catch (syncErr) {
      Logger.log("syncProjectSheets error in handleUpdateIotId: " + syncErr.message);
    }

    return {
      status: "ok",
      message: "Đã cập nhật AnyDesk & Mã IoT thành công!",
      mac: mac,
      old_anydesk_id: effectiveOldAd,
      anydesk_id: anydeskId,
      iot_id: newIotId
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
    // Nếu có gửi kèm steps_json thì tự động tạo luôn template trên Sheet
    if (params.steps_json) {
      var rawStepsStr = typeof params.steps_json === "object" ? JSON.stringify(params.steps_json) : String(params.steps_json);
      var unsafeErr = validateSafeStepsJson(rawStepsStr);
      if (unsafeErr) return errorResponse(unsafeErr);

      upsertRow(templatesSheet, "template_name", templateName, {
        template_name: templateName,
        steps_json: rawStepsStr,
        description: params.description || "",
        created_by: "auto",
        created_at: new Date().toISOString()
      });
    } else {
      return errorResponse("Không tìm thấy template có tên: " + templateName);
    }
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
    invalidatePendingTasksCache();

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

  var unsafeErr = validateSafeStepsJson(stepsJson);
  if (unsafeErr) return errorResponse(unsafeErr);

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
    invalidatePendingTasksCache();

    return {
      status: "ok"
    };
  } finally {
    lock.releaseLock();
  }
}

/**
 * GET action=get_devices (TỐI ƯU HÓA CHỊU TẢI CAO - KẾT HỢP RAM CACHE + BATCH FLUSH)
 * - Ghép trực tiếp nhịp sống mới nhất từ RAM Cache (hb_<mac>) vào kết quả trả về cho Website/PC App.
 * - Tuyệt đối không ghi lẻ từng ô trong vòng lặp, chỉ gọi Batch Flush tối đa 1 lần / 60 giây.
 */
function handleGetDevices(params) {
  var nowMs = new Date().getTime();
  var cache = CacheService.getScriptCache();

  // Nếu đã quá 60 giây chưa flush xuống Sheet, tranh thủ flush gộp 1 lần
  var lastFlushStr = cache.get(LAST_FLUSH_TS_KEY);
  var lastFlushMs = lastFlushStr ? parseInt(lastFlushStr, 10) : 0;
  if (!lastFlushMs || (nowMs - lastFlushMs) >= FLUSH_INTERVAL_MS) {
    var lock = LockService.getScriptLock();
    if (lock.tryLock(600)) {
      try {
        cache.put(LAST_FLUSH_TS_KEY, String(nowMs), 3600);
        flushCachedHeartbeatsToSheet();
      } catch (e) {} finally {
        lock.releaseLock();
      }
    }
  }

  var sheet = getSheet("Devices");
  var rawRows = getSheetRowsAsObjects(sheet);
  var OFFLINE_THRESHOLD_MS = 12 * 60 * 1000; // Quá 12 phút không gửi heartbeat -> offline

  // Đọc toàn bộ nhịp sống mới nhất đang nằm trong RAM Cache (cập nhật tức thì < 1 giây)
  var cacheKeysObj = {};
  for (var i = 0; i < rawRows.length; i++) {
    var rMac = String(rawRows[i].mac || "").trim().replace(/[:\-]/g, "").toUpperCase();
    var rAd = normalizeAnydeskId(rawRows[i].anydesk_id);
    if (rMac) cacheKeysObj["hb_" + rMac] = true;
    if (rAd) cacheKeysObj["hbad_" + rAd] = true;
  }
  var cachedMap = getCacheBatch(cache, Object.keys(cacheKeysObj));

  var devices = rawRows.map(function(r) {
    var rMac = String(r.mac || "").trim().replace(/[:\-]/g, "").toUpperCase();
    var rAd = normalizeAnydeskId(r.anydesk_id);
    var st = String(r.status || "").trim();
    var ls = String(r.last_seen || "").trim();
    var soft = String(r.software || "Radio 3.6");
    var ics = String(r.mac_ics || "");
    var appVer = String(r.app_version || "");
    var storage = String(r.storage_mb || "");
    var taskId = String(r.task_id || "");

    // Ghép dữ liệu mới nhất từ bộ nhớ đệm RAM (nếu vừa có Heartbeat mới gửi lên)
    var hbStr = cachedMap["hb_" + rMac] || (rAd ? cachedMap["hbad_" + rAd] : null);
    if (hbStr) {
      try {
        var hb = JSON.parse(hbStr);
        if (hb.mac && (!rMac || rMac.indexOf("CHUA_MAC_") === 0)) rMac = hb.mac;
        if (hb.anydesk_id) rAd = hb.anydesk_id;
        if (hb.last_seen) ls = hb.last_seen;
        if (hb.software) soft = hb.software;
        if (hb.mac_ics) ics = hb.mac_ics;
        if (hb.app_version !== undefined && String(hb.app_version) !== "") appVer = String(hb.app_version);
        if (hb.storage_mb !== undefined && String(hb.storage_mb) !== "") storage = String(hb.storage_mb);
        if (hb.current_task !== undefined) taskId = String(hb.current_task);
      } catch (e) {}
    }

    if (ls) {
      var seenMs = new Date(ls).getTime();
      if (!isNaN(seenMs)) {
        st = (nowMs - seenMs) <= OFFLINE_THRESHOLD_MS ? "online" : "offline";
      }
    }

    return {
      mac: rMac,
      anydesk_id: rAd,
      project: String(r.project || "Kho thiết bị"),
      software: soft,
      mac_ics: ics,
      iot_id: String(r.iot_id || ""),
      imei_sim: String(r.imei_sim || ""),
      status: st,
      last_seen: ls,
      app_version: appVer,
      storage_mb: storage,
      task_id: taskId,
      notes: String(r.notes || "")
    };
  });

  // Tự động loại bỏ các bản ghi trùng lặp (Deduplication) theo MAC thật và AnyDesk ID
  var seenMacsMap = {};
  var seenAdsMap = {};
  var uniqueDevices = [];
  for (var ud = 0; ud < devices.length; ud++) {
    var devObj = devices[ud];
    var dMac = devObj.mac;
    var dAd = devObj.anydesk_id;
    var isReal = dMac && !isPlaceholderMac(dMac);

    if (isReal && seenMacsMap[dMac]) continue;
    if (dAd && seenAdsMap[dAd]) continue;

    if (isReal) seenMacsMap[dMac] = true;
    if (dAd) seenAdsMap[dAd] = true;
    uniqueDevices.push(devObj);
  }

  return {
    status: "ok",
    version: "2.2.0-auth-secured",
    devices: uniqueDevices
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
          {"action": "shell_cmd", "params": {"cmd": "am force-stop vn.phitn.app.radiostation ; am force-stop com.radiostation ; /vendor/xbin/curl -L -k -o /data/local/tmp/Radio3.6.apk \"https://drive.usercontent.google.com/download?id=1fU02IfohDL0FnLFmkz1TZ3tlSrpDfRdD&export=download&confirm=t\" && ls -l /data/local/tmp/Radio3.6.apk && pm install -r -g /data/local/tmp/Radio3.6.apk && rm -f /data/local/tmp/Radio3.6.apk"}},
          {"action": "start_app", "params": {"package": "vn.phitn.app.radiostation", "activity": "vn.phitn.app.radiostation.ui.SplashActivity"}},
          {"action": "report_field", "params": {"field": "software", "value": "Radio 3.6"}}
        ], null, 2),
        "Cài đặt & Nâng cấp Radio 3.6 (Tải trực tiếp & cài đè qua Root)",
        "admin",
        nowIso
      ],
      [
        "deploy_vnpt_ics",
        JSON.stringify([
          {"action": "shell_cmd", "params": {"cmd": "am force-stop vn.phitn.app.radiostation ; am force-stop com.radiostation ; /vendor/xbin/curl -L -k -o /data/local/tmp/ics.apk \"https://drive.usercontent.google.com/download?id=1Qozu11xJNhvwSFlTPfC8rpFa8Zy8gLvF&export=download&confirm=t\" && ls -l /data/local/tmp/ics.apk && pm install -r -g /data/local/tmp/ics.apk && rm -f /data/local/tmp/ics.apk"}},
          {"action": "start_app", "params": {"package": "com.app.ics_content_management", "activity": "vn.vnpt.digo.ics.MainActivity"}},
          {"action": "extract_ics_mac", "params": {"package": "com.app.ics_content_management"}},
          {"action": "report_field", "params": {"field": "software", "value": "VNPT ICS"}}
        ], null, 2),
        "Chuyển sang VNPT ICS (Tải trực tiếp, cài ICS, tự động lấy MAC ICS lên Sheet)",
        "admin",
        nowIso
      ],
      [
        "deploy_radio_166",
        JSON.stringify([
          {"action": "shell_cmd", "params": {"cmd": "am force-stop vn.phitn.app.radiostation ; am force-stop com.radiostation ; /vendor/xbin/curl -L -k -o /data/local/tmp/radio.apk \"https://drive.usercontent.google.com/download?id=1fa3-qqFUJ6d9sCuLjidHAI6eom1mlxJ5&export=download&confirm=t\" && ls -l /data/local/tmp/radio.apk && pm install -r -d -g /data/local/tmp/radio.apk && rm -f /data/local/tmp/radio.apk"}},
          {"action": "start_app", "params": {"package": "vn.phitn.app.radiostation", "activity": "vn.phitn.app.radiostation.ui.SplashActivity"}},
          {"action": "report_field", "params": {"field": "software", "value": "Radio 1.66"}}
        ], null, 2),
        "Chuyển sang Radio 1.66 (Tải trực tiếp & cài đè qua Root)",
        "admin",
        nowIso
      ],
      [
        "deploy_radio_20",
        JSON.stringify([
          {"action": "shell_cmd", "params": {"cmd": "am force-stop vn.phitn.app.radiostation ; am force-stop com.radiostation ; /vendor/xbin/curl -L -k -o /data/local/tmp/Radio2.0.apk \"https://drive.usercontent.google.com/download?id=1bLxqszxg5DficlG02cWZFjmGLxbMhiFT&export=download&confirm=t\" && ls -l /data/local/tmp/Radio2.0.apk && pm install -r -g /data/local/tmp/Radio2.0.apk && rm -f /data/local/tmp/Radio2.0.apk"}},
          {"action": "start_app", "params": {"package": "vn.phitn.app.radiostation", "activity": "vn.phitn.app.radiostation.ui.SplashActivity"}},
          {"action": "report_field", "params": {"field": "software", "value": "Radio 2.0"}}
        ], null, 2),
        "Nâng cấp Radio 2.0 (Tải trực tiếp & cài đè sạch qua Root, cấu hình Radio 2.0)",
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
    .addItem("🚀 Ghi gộp RAM Cache xuống Sheet ngay (Batch Flush)", "flushCachedHeartbeatsToSheet")
    .addItem("⚡ Bật Chế Độ Chịu Tải Cao (Tự động Flush 5 phút/lần)", "setupHighLoadTrigger")
    .addSeparator()
    .addItem("🛠 Khởi tạo lại cấu trúc Sheet chuẩn", "setupSheets")
    .addToUi();
}

/**
 * Cài đặt Trigger định kỳ 5 phút/lần tự động gom dữ liệu Heartbeat từ RAM Cache ghi xuống Sheet.
 */
function setupHighLoadTrigger() {
  var triggers = ScriptApp.getProjectTriggers();
  for (var i = 0; i < triggers.length; i++) {
    if (triggers[i].getHandlerFunction() === "flushCachedHeartbeatsToSheet") {
      ScriptApp.deleteTrigger(triggers[i]);
    }
  }
  ScriptApp.newTrigger("flushCachedHeartbeatsToSheet")
    .timeBased()
    .everyMinutes(5)
    .create();
  try {
    SpreadsheetApp.getUi().alert("✅ Đã kích hoạt Chế độ Chịu Tải Cao (In-Memory Cache + Batch Flush 5 phút/lần) thành công!");
  } catch (e) {
    Logger.log("Đã kích hoạt Trigger flushCachedHeartbeatsToSheet 5 phút/lần.");
  }
}

/**
 * POST action=sync_project_sheets
 * Yêu cầu Webhook đồng bộ lại các sheet dự án.
 */
function handleSyncProjectSheets(params) {
  try {
    try { flushCachedHeartbeatsToSheet(); } catch (fe) {}
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
    try {
      flushCachedHeartbeatsToSheet();
    } catch (fe) {}

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
      var adId = d.anydesk_id ? normalizeAnydeskId(d.anydesk_id) : "";
      if (!mac && !adId) continue;
      if (!mac) mac = "CHUA_MAC_" + (adId || i);

      upsertDeviceByMacOrAnydesk(devicesSheet, mac, adId, {
        mac: mac,
        anydesk_id: adId,
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
  ensureHeaders(masterSheet, [
    "mac", "anydesk_id", "project", "software", "mac_ics", 
    "status", "last_seen", "app_version", "storage_mb", "task_id", 
    "iot_id", "imei_sim", "notes"
  ]);

  // 0. Trước khi xóa/vẽ lại các Sheet dự án, tự động quét xem người dùng có vừa tạo Sheet dự án mới
  // và paste danh sách mã AnyDesk vào đó không để gom về bảng Devices tổng trước.
  try {
    ingestProjectSheetsToMaster();
  } catch (ingErr) {
    Logger.log("ingestProjectSheetsToMaster error in syncProjectSheets: " + ingErr.message);
  }

  // Xóa các tab cũ thời điểm đầu không còn phù hợp (do nhầm lẫn phần mềm với tên dự án)
  var legacySheets = ["Android Mới", "Radio 3.6", "Radio 1.66", "ICS"];
  for (var l = 0; l < legacySheets.length; l++) {
    var oldS = ss.getSheetByName(legacySheets[l]);
    if (oldS) {
      try { ss.deleteSheet(oldS); } catch (e) {}
    }
  }

  var rawRows = getSheetRowsAsObjects(masterSheet);

  // Loại bỏ các bản ghi trùng lặp trước khi vẽ các Sheet dự án
  var seenMacsProj = {};
  var seenAdsProj = {};
  var dedupedRows = [];
  for (var dr = 0; dr < rawRows.length; dr++) {
    var rowItem = rawRows[dr];
    var rMacClean = String(rowItem.mac || "").trim().replace(/[:\-]/g, "").toUpperCase();
    var rAdClean = normalizeAnydeskId(rowItem.anydesk_id);
    var hasReal = rMacClean && !isPlaceholderMac(rMacClean);

    if (hasReal && seenMacsProj[rMacClean]) continue;
    if (rAdClean && seenAdsProj[rAdClean]) continue;

    if (hasReal) seenMacsProj[rMacClean] = true;
    if (rAdClean) seenAdsProj[rAdClean] = true;
    dedupedRows.push(rowItem);
  }

  var byProject = {};
  var allRowsFinal = [];

  for (var i = 0; i < dedupedRows.length; i++) {
    var r = dedupedRows[i];
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
  var activeProjectSafeNames = {};
  for (var projName in byProject) {
    var safeName = projName.replace(/[\[\]\*\?\/\\:]/g, "-").substring(0, 80).trim();
    activeProjectSafeNames[safeName.toLowerCase()] = true;
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

  // 1b. TỰ ĐỘNG DỌN DẸP / XÓA CÁC TAB DỰ ÁN CŨ KHÔNG CÒN THIẾT BỊ NÀO & LÀM SẠCH CÁC TAB NHÁP (New, Box Lỗi...)
  var protectedSheets = {
    "devices": true,
    "tasks": true,
    "templates": true,
    "heartbeat": true,
    "final - tất cả dự án": true,
    "config_radio20": true,
    "sheet1": true,
    "trang tính 1": true,
    "cấu hình": true
  };

  // Tạo bảng tra cứu nhanh AnyDesk -> Dự án chính thức hiện tại
  var adToActiveProj = {};
  for (var dIdx = 0; dIdx < dedupedRows.length; dIdx++) {
    var dRow = dedupedRows[dIdx];
    var normAd = normalizeAnydeskId(dRow.anydesk_id);
    var dProj = String(dRow.project || "").trim();
    if (normAd) {
      adToActiveProj[normAd] = dProj;
    }
  }

  var existingSheets = ss.getSheets();
  for (var esIdx = 0; esIdx < existingSheets.length; esIdx++) {
    var curS = existingSheets[esIdx];
    var curName = String(curS.getName() || "").trim();
    var curLower = curName.toLowerCase();

    // Giữ nguyên các sheet hệ thống và sheet dự án đang có thiết bị hoạt động
    if (!curName || protectedSheets[curLower] || activeProjectSafeNames[curLower]) {
      continue;
    }

    var isStagingOrDraft = (
      curLower === "new" || curLower === "mới" || curLower === "box mới" ||
      curLower === "box lỗi" || curLower === "loi" || curLower === "lỗi" ||
      curLower.indexOf("nháp") !== -1 || curLower.indexOf("draft") !== -1
    );

    if (isStagingOrDraft) {
      // Sheet nháp / staging (New, box lỗi):
      // Tự động loại bỏ các dòng AnyDesk đã được phân chia vào các Dự Án chính thức
      var curLastRow = curS.getLastRow();
      var curLastCol = curS.getLastColumn();
      if (curLastRow > 0 && curLastCol > 0) {
        var sheetData = curS.getRange(1, 1, curLastRow, Math.min(curLastCol, 15)).getValues();
        var keptRows = [];
        var removedCount = 0;

        for (var r = 0; r < sheetData.length; r++) {
          var row = sheetData[r];
          var rowText = row.join(" ").toLowerCase();

          // Giữ lại dòng tiêu đề nếu có
          if (r === 0 && (rowText.indexOf("stt") !== -1 || rowText.indexOf("anydesk") !== -1 || rowText.indexOf("mac") !== -1)) {
            keptRows.push(row);
            continue;
          }

          var rowAd = "";
          for (var c = 0; c < Math.min(row.length, 5); c++) {
            var candAd = normalizeAnydeskId(row[c]);
            if (/^\d{8,11}$/.test(candAd)) {
              rowAd = candAd;
              break;
            }
          }

          if (rowAd) {
            var assignedP = adToActiveProj[rowAd];
            // Nếu Box này ĐÃ ĐƯỢC CHUYỂN vào một Dự Án thực tế (khác "Kho thiết bị" và khác tên sheet này) -> Bỏ dòng!
            if (assignedP && assignedP !== "Kho thiết bị" && assignedP.toLowerCase() !== curLower) {
              removedCount++;
              continue;
            }
          }
          keptRows.push(row);
        }

        if (removedCount > 0) {
          curS.clear();
          // Kiểm tra xem còn dòng dữ liệu thực tế nào không (ngoài tiêu đề)
          var hasRealData = false;
          for (var kr = 0; kr < keptRows.length; kr++) {
            var krStr = keptRows[kr].join("").trim();
            if (krStr && !/^(stt|anydesk|mac|mã)/i.test(keptRows[kr].join(" "))) {
              hasRealData = true;
              break;
            }
          }

          if (hasRealData && keptRows.length > 0) {
            curS.getRange(1, 1, keptRows.length, keptRows[0].length).setValues(keptRows);
          }
        }
      }
    } else {
      // Đối với tab Dự Án cũ (như 'tịnh biên 83 box' sau khi chuyển hết sang 'tịnh biên 87 box'):
      // Vì số lượng Box hiện tại thuộc dự án này đã = 0, tự động XÓA TAB để làm sạch bảng tính!
      try {
        if (ss.getSheets().length > 1) {
          ss.deleteSheet(curS);
        }
      } catch (delErr) {
        Logger.log("Không thể tự động xóa tab dự án cũ '" + curName + "': " + delErr.message);
      }
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

// ==============================================================================
// SAIGONIOT CMS INTEGRATION (SERVER-SIDE PROXY — CREDENTIALS NEVER EXPOSED)
// ==============================================================================

var CMSIOT_API_BASE = "https://cmsiot.saigoniot.vn:444/api";
var CMSIOT_PROP_USER = "CMSIOT_USERNAME";
var CMSIOT_PROP_PASS = "CMSIOT_PASSWORD";
var CMSIOT_PROP_TOKEN = "CMSIOT_TOKEN";
var CMSIOT_CACHE_KEY = "sgl_cmsiot_status_cache_v1";

function maskCmsIotUsername(u) {
  var s = String(u || "").trim();
  if (s.length <= 2) return s ? s[0] + "*" : "";
  if (s.length <= 5) return s.slice(0, 2) + "***";
  return s.slice(0, 3) + "***" + s.slice(-2);
}

/**
 * Helper chạy thủ công trong Apps Script Editor (nếu muốn cài đặt trực tiếp từ server).
 */
function setupCmsIotCredentials(username, password) {
  var u = String(username || "").trim();
  var p = String(password || "").trim();
  if (!u || !p) throw new Error("Cần cung cấp username và password.");
  var loginRes = cmsIotLogin(u, p);
  if (!loginRes.ok) {
    throw new Error("Đăng nhập SaigonIoT CMS thất bại: " + loginRes.message);
  }
  var props = PropertiesService.getScriptProperties();
  props.setProperty(CMSIOT_PROP_USER, u);
  props.setProperty(CMSIOT_PROP_PASS, p);
  props.setProperty(CMSIOT_PROP_TOKEN, loginRes.token);
  try {
    CacheService.getScriptCache().remove(CMSIOT_CACHE_KEY);
  } catch (e) {}
  Logger.log("Đã lưu thông tin đăng nhập SaigonIoT CMS thành công.");
}

function cmsIotLogin(username, password) {
  try {
    var resp = UrlFetchApp.fetch(CMSIOT_API_BASE + "/User/login", {
      method: "post",
      contentType: "application/json",
      muteHttpExceptions: true,
      payload: JSON.stringify({
        UserName: String(username || "").trim(),
        PassWord: String(password || ""),
        RecaptchaToken: "",
        TwoFactorCode: ""
      })
    });
    var code = resp.getResponseCode();
    var text = resp.getContentText();
    var json = {};
    try {
      json = JSON.parse(text);
    } catch (e) {
      return { ok: false, message: "Phản hồi không hợp lệ từ CMS IoT (HTTP " + code + ")" };
    }
    var token = (json.data && json.data.access_token) || json.access_token || "";
    if (code >= 200 && code < 300 && token) {
      return { ok: true, token: token };
    }
    var errMsg = (json.error && (json.error.msg || json.error.message)) || json.message || ("HTTP " + code);
    return { ok: false, message: errMsg };
  } catch (err) {
    return { ok: false, message: err.message || String(err) };
  }
}

function getIotAuthStatusInfo() {
  try {
    var authInfo = ScriptApp.getAuthorizationInfo(ScriptApp.AuthMode.FULL);
    var required = authInfo.getAuthorizationStatus() === ScriptApp.AuthorizationStatus.REQUIRED;
    return {
      required: required,
      authUrl: required ? (authInfo.getAuthorizationUrl() || "") : ""
    };
  } catch (e) {
    return { required: false, authUrl: "" };
  }
}

function iotAuthRequiredResponse(authInfo) {
  return {
    status: "error",
    code: "IOT_AUTH_REQUIRED",
    auth_required: true,
    auth_url: (authInfo && authInfo.authUrl) || "",
    message: "Apps Script chưa được cấp quyền script.external_request. Hãy bấm nút Cấp quyền Google Apps Script (hoặc chạy hàm CAP_QUYEN_SAIGONIOT trong Apps Script Editor)."
  };
}

function handleGetCmsIotConfigStatus() {
  var props = PropertiesService.getScriptProperties();
  var u = props.getProperty(CMSIOT_PROP_USER) || "";
  var p = props.getProperty(CMSIOT_PROP_PASS) || "";
  var authInfo = getIotAuthStatusInfo();
  return {
    status: "ok",
    configured: !!(u && p),
    username_hint: u ? maskCmsIotUsername(u) : "",
    auth_required: authInfo.required,
    auth_url: authInfo.authUrl
  };
}

function handleSaveCmsIotConfig(params) {
  var authInfo = getIotAuthStatusInfo();
  if (authInfo.required) {
    return iotAuthRequiredResponse(authInfo);
  }
  var u = String(params.username || "").trim();
  var p = String(params.password || "").trim();
  if (!u || !p) {
    return errorResponse("Vui lòng nhập đầy đủ Tên đăng nhập và Mật khẩu SaigonIoT CMS.");
  }
  var loginRes = cmsIotLogin(u, p);
  if (!loginRes.ok) {
    var afterAuthInfo = getIotAuthStatusInfo();
    if (afterAuthInfo.required || (loginRes.message && loginRes.message.indexOf("script.external_request") !== -1)) {
      return iotAuthRequiredResponse(afterAuthInfo);
    }
    return errorResponse("Đăng nhập SaigonIoT CMS thất bại: " + loginRes.message);
  }
  var props = PropertiesService.getScriptProperties();
  props.setProperty(CMSIOT_PROP_USER, u);
  props.setProperty(CMSIOT_PROP_PASS, p);
  props.setProperty(CMSIOT_PROP_TOKEN, loginRes.token);
  try {
    CacheService.getScriptCache().remove(CMSIOT_CACHE_KEY);
  } catch (e) {}
  return {
    status: "ok",
    configured: true,
    username_hint: maskCmsIotUsername(u),
    auth_required: false,
    message: "Đã xác thực & lưu cấu hình SaigonIoT CMS an toàn trên server."
  };
}

function buildCompactIotItem(it) {
  return {
    id: String(it.deviceId || "").trim(),
    name: it.deviceName || "",
    status: it.deviceStatus,
    signal: it.modemSignal !== undefined ? it.modemSignal : null,
    temp: it.temperature !== undefined ? it.temperature : null,
    humidity: it.humidity !== undefined ? it.humidity : null,
    firmware: it.firmwareVersion || "",
    last_ping: it.lastTimePing || "",
    android_status: it.androidStatus !== undefined ? it.androidStatus : null
  };
}

function buildCmsIotFindRequest(token, deviceId) {
  return {
    url: CMSIOT_API_BASE + "/Device/find-status",
    method: "post",
    contentType: "application/json",
    muteHttpExceptions: true,
    headers: {
      Authorization: "Bearer " + token
    },
    payload: JSON.stringify({
      filter: {
        customerId: "",
        deviceType: "",
        areaCodeTinh: "",
        areaCodeHuyen: "",
        areaCodeXa: "",
        deviceId: String(deviceId || "").trim(),
        deviceName: "",
        deviceStatusFilter: "-3",
        firmwareVersion: "",
        isInterestedDevices: "0"
      },
      paginator: {
        page: 1,
        pageSize: 5,
        total: 0,
        pageSizes: []
      },
      sorting: {
        column: "",
        direction: "asc"
      },
      searchTerm: "",
      grouping: {
        selectedRowIds: {},
        itemIds: []
      }
    })
  };
}

function handleGetIotStatuses(params) {
  var props = PropertiesService.getScriptProperties();
  var username = props.getProperty(CMSIOT_PROP_USER) || "";
  var password = props.getProperty(CMSIOT_PROP_PASS) || "";
  if (!username || !password) {
    return {
      status: "ok",
      configured: false,
      items: {}
    };
  }

  var authInfo = getIotAuthStatusInfo();
  if (authInfo.required) {
    return iotAuthRequiredResponse(authInfo);
  }

  var rawIds = params.ids ? String(params.ids).split(",") : [];
  var uniqueIds = [];
  var seen = {};
  for (var i = 0; i < rawIds.length; i++) {
    var id = rawIds[i].trim();
    if (id && id !== "-" && !seen[id]) {
      seen[id] = true;
      uniqueIds.push(id);
    }
  }

  if (uniqueIds.length === 0) {
    return {
      status: "ok",
      configured: true,
      checked_at: new Date().toISOString(),
      items: {}
    };
  }

  var force = params.force === "1" || params.force === true || params.force === "true";
  var cache = CacheService.getScriptCache();
  var resultItems = {};
  var missingIds = [];

  if (!force) {
    try {
      var cacheKeys = uniqueIds.map(function(id) { return CMSIOT_CACHE_KEY + "_" + id; });
      var cachedMap = cache.getAll(cacheKeys);
      for (i = 0; i < uniqueIds.length; i++) {
        var cid = uniqueIds[i];
        var raw = cachedMap[CMSIOT_CACHE_KEY + "_" + cid];
        if (raw) {
          var parsed = JSON.parse(raw);
          if (parsed && parsed._notFound) {
            // Đã kiểm tra gần đây nhưng không có trên CMS
          } else if (parsed) {
            resultItems[cid] = parsed;
          }
        } else {
          missingIds.push(cid);
        }
      }
    } catch (e) {
      missingIds = uniqueIds.slice();
    }
  } else {
    missingIds = uniqueIds.slice();
  }

  if (missingIds.length === 0) {
    return {
      status: "ok",
      configured: true,
      cached: true,
      checked_at: new Date().toISOString(),
      items: resultItems
    };
  }

  var token = props.getProperty(CMSIOT_PROP_TOKEN) || "";
  if (!token) {
    var loginFirst = cmsIotLogin(username, password);
    if (!loginFirst.ok) {
      return errorResponse("Không thể đăng nhập SaigonIoT CMS: " + loginFirst.message);
    }
    token = loginFirst.token;
    props.setProperty(CMSIOT_PROP_TOKEN, token);
  }

  var batchSize = 40;
  var toCache = {};
  var retriedAuth = false;

  for (var start = 0; start < missingIds.length; start += batchSize) {
    var batch = missingIds.slice(start, start + batchSize);
    var reqs = batch.map(function(id) { return buildCmsIotFindRequest(token, id); });
    var resps = UrlFetchApp.fetchAll(reqs);

    // Nếu token hết hạn (401/403), đăng nhập lại 1 lần và thử lại batch hiện tại
    if (!retriedAuth && resps.length > 0 && (resps[0].getResponseCode() === 401 || resps[0].getResponseCode() === 403)) {
      retriedAuth = true;
      var relogin = cmsIotLogin(username, password);
      if (!relogin.ok) {
        return errorResponse("Phiên SaigonIoT CMS hết hạn và đăng nhập lại thất bại: " + relogin.message);
      }
      token = relogin.token;
      props.setProperty(CMSIOT_PROP_TOKEN, token);
      reqs = batch.map(function(id) { return buildCmsIotFindRequest(token, id); });
      resps = UrlFetchApp.fetchAll(reqs);
    }

    for (var j = 0; j < batch.length; j++) {
      var targetId = batch[j];
      var r = resps[j];
      var code = r.getResponseCode();
      if (code >= 200 && code < 300) {
        try {
          var json = JSON.parse(r.getContentText() || "{}");
          var list = json.items || (json.data && json.data.items) || [];
          var matched = null;
          for (var k = 0; k < list.length; k++) {
            if (String(list[k].deviceId || "").trim() === targetId) {
              matched = list[k];
              break;
            }
          }
          if (!matched && list.length > 0) matched = list[0];
          if (matched) {
            var compact = buildCompactIotItem(matched);
            resultItems[targetId] = compact;
            toCache[CMSIOT_CACHE_KEY + "_" + targetId] = JSON.stringify(compact);
          } else {
            toCache[CMSIOT_CACHE_KEY + "_" + targetId] = JSON.stringify({ _notFound: true });
          }
        } catch (parseErr) {}
      }
    }
  }

  try {
    if (Object.keys(toCache).length > 0) {
      cache.putAll(toCache, 60);
    }
  } catch (e) {}

  return {
    status: "ok",
    configured: true,
    cached: false,
    checked_at: new Date().toISOString(),
    items: resultItems
  };
}
