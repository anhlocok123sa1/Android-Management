package com.sgl.autosetup;

/**
 * Bộ điều khiển tự động tắt Wi-Fi 2.4G trên trang quản trị module 4G
 * "Smart Wifi System" (http://192.168.8.1).
 */
public class SmartWifiHelper {

    public static final String DEFAULT_ROUTER_URL = "http://192.168.8.1";
    public static final String DEFAULT_ADMIN_PASSWORD = "admin";

    public enum StepStatus {
        WAITING,
        LOGIN_SUBMITTED,
        OPENING_WIFI_MENU,
        OPENING_24G_MENU,
        UNCHECKED_ENABLE_WIFI,
        CLICKED_SAVE,
        SAVE_SUCCESSFUL,
        ALREADY_DISABLED
    }

    public static boolean isTerminalSuccess(StepStatus status) {
        return status == StepStatus.SAVE_SUCCESSFUL || status == StepStatus.ALREADY_DISABLED;
    }

    public static StepStatus parseStepStatus(String rawEvalResult) {
        if (rawEvalResult == null) {
            return StepStatus.WAITING;
        }
        String cleaned = rawEvalResult.trim();
        if (cleaned.startsWith("\"") && cleaned.endsWith("\"") && cleaned.length() >= 2) {
            cleaned = cleaned.substring(1, cleaned.length() - 1).trim();
        }
        if (cleaned.isEmpty() || "null".equalsIgnoreCase(cleaned) || "undefined".equalsIgnoreCase(cleaned)) {
            return StepStatus.WAITING;
        }
        try {
            return StepStatus.valueOf(cleaned);
        } catch (IllegalArgumentException e) {
            return StepStatus.WAITING;
        }
    }

    /**
     * Sinh mã JavaScript tự động thực hiện các bước trên http://192.168.8.1:
     * 1. Đăng nhập với mật khẩu admin
     * 2. Mở menu WiFi Settings -> 2.4G WiFi Settings
     * 3. Bỏ tích Enable Wi-Fi
     * 4. Bấm nút Save chính (cạnh nút Cancel, phía trên bảng 2.4G Multi-SSID Setup)
     * 5. Phát hiện thông báo "Save successful"
     */
    public static String buildAutomationJs(String password) {
        String safePass = (password == null ? DEFAULT_ADMIN_PASSWORD : password)
                .replace("\\", "\\\\")
                .replace("'", "\\'")
                .replace("\n", "")
                .replace("\r", "");

        return "(function() {\n" +
                "  try {\n" +
                "    var PASS = '" + safePass + "';\n" +
                "    var now = Date.now();\n" +
                "    function getAllDocs() {\n" +
                "      var docs = [document];\n" +
                "      var frames = document.querySelectorAll('iframe, frame');\n" +
                "      for (var i = 0; i < frames.length; i++) {\n" +
                "        try {\n" +
                "          var d = frames[i].contentDocument || (frames[i].contentWindow && frames[i].contentWindow.document);\n" +
                "          if (d) docs.push(d);\n" +
                "        } catch (e) {}\n" +
                "      }\n" +
                "      return docs;\n" +
                "    }\n" +
                "    function isVisible(el) {\n" +
                "      if (!el) return false;\n" +
                "      var style = window.getComputedStyle ? window.getComputedStyle(el) : el.style;\n" +
                "      if (style && (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0')) return false;\n" +
                "      var rect = el.getBoundingClientRect ? el.getBoundingClientRect() : {width: 1, height: 1};\n" +
                "      return rect.width > 0 && rect.height > 0;\n" +
                "    }\n" +
                "    function normText(el) {\n" +
                "      if (!el) return '';\n" +
                "      var t = (el.tagName === 'INPUT' || el.tagName === 'BUTTON') ? (el.value || el.innerText || el.textContent || '') : (el.innerText || el.textContent || '');\n" +
                "      return String(t).replace(/\\s+/g, ' ').trim();\n" +
                "    }\n" +
                "    function setInputValue(input, val) {\n" +
                "      input.focus();\n" +
                "      var setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value');\n" +
                "      if (setter && setter.set) { setter.set.call(input, val); } else { input.value = val; }\n" +
                "      ['input', 'change', 'keydown', 'keyup', 'blur'].forEach(function(ev) {\n" +
                "        input.dispatchEvent(new Event(ev, {bubbles: true}));\n" +
                "      });\n" +
                "    }\n" +
                "    var docs = getAllDocs();\n" +
                "\n" +
                "    // 1. Kiểm tra thông báo Save successful\n" +
                "    for (var dIdx = 0; dIdx < docs.length; dIdx++) {\n" +
                "      var bodyText = (docs[dIdx].body && docs[dIdx].body.innerText) ? docs[dIdx].body.innerText : '';\n" +
                "      if (bodyText.indexOf('Save successful') !== -1 && window.__sglClickedSave) {\n" +
                "        return 'SAVE_SUCCESSFUL';\n" +
                "      }\n" +
                "    }\n" +
                "\n" +
                "    // 2. Kiểm tra màn hình Login (input password + nút Login, chưa vào trang có WiFi Settings)\n" +
                "    for (var dIdx = 0; dIdx < docs.length; dIdx++) {\n" +
                "      var doc = docs[dIdx];\n" +
                "      var hasWifiMenu = doc.body && doc.body.innerText && doc.body.innerText.indexOf('WiFi Settings') !== -1;\n" +
                "      if (!hasWifiMenu) {\n" +
                "        var passInput = doc.querySelector('input[type=\"password\"]') || doc.querySelector('input[placeholder*=\"password\" i]');\n" +
                "        if (passInput && isVisible(passInput)) {\n" +
                "          if (window.__sglLoginTime && (now - window.__sglLoginTime < 3500)) {\n" +
                "            return 'WAITING';\n" +
                "          }\n" +
                "          setInputValue(passInput, PASS);\n" +
                "          var candidates = doc.querySelectorAll('button, input[type=\"button\"], input[type=\"submit\"], a, div, span');\n" +
                "          for (var i = 0; i < candidates.length; i++) {\n" +
                "            var el = candidates[i];\n" +
                "            if (isVisible(el) && normText(el).toLowerCase() === 'login') {\n" +
                "              window.__sglLoginTime = now;\n" +
                "              el.click();\n" +
                "              return 'LOGIN_SUBMITTED';\n" +
                "            }\n" +
                "          }\n" +
                "        }\n" +
                "      }\n" +
                "    }\n" +
                "\n" +
                "    // 3. Kiểm tra nếu đã mở bảng 2.4G WiFi Settings (có dòng Enable Wi-Fi)\n" +
                "    for (var dIdx = 0; dIdx < docs.length; dIdx++) {\n" +
                "      var doc = docs[dIdx];\n" +
                "      var allEls = doc.querySelectorAll('td, th, label, span, div, p');\n" +
                "      var enableWifiCheckbox = null;\n" +
                "      for (var i = 0; i < allEls.length; i++) {\n" +
                "        var t = normText(allEls[i]).toLowerCase();\n" +
                "        if ((t === 'enable wi-fi' || t === 'enable wifi') && isVisible(allEls[i])) {\n" +
                "          var container = allEls[i].parentElement;\n" +
                "          for (var up = 0; up < 4 && container; up++) {\n" +
                "            var cbs = container.querySelectorAll('input[type=\"checkbox\"]');\n" +
                "            if (cbs.length >= 1 && cbs.length <= 3) {\n" +
                "              enableWifiCheckbox = cbs[0];\n" +
                "              break;\n" +
                "            }\n" +
                "            container = container.parentElement;\n" +
                "          }\n" +
                "          if (enableWifiCheckbox) break;\n" +
                "        }\n" +
                "      }\n" +
                "\n" +
                "      if (enableWifiCheckbox && isVisible(enableWifiCheckbox)) {\n" +
                "        if (!window.__sglPanelSeenAt) {\n" +
                "          window.__sglPanelSeenAt = now;\n" +
                "          return 'WAITING';\n" +
                "        }\n" +
                "        if (now - window.__sglPanelSeenAt < 700) {\n" +
                "          return 'WAITING';\n" +
                "        }\n" +
                "        if (window.__sglClickedSave) {\n" +
                "          return 'WAITING';\n" +
                "        }\n" +
                "        if (enableWifiCheckbox.checked) {\n" +
                "          window.__sglUncheckedByUs = true;\n" +
                "          window.__sglUncheckedAt = now;\n" +
                "          enableWifiCheckbox.click();\n" +
                "          if (enableWifiCheckbox.checked) {\n" +
                "            enableWifiCheckbox.checked = false;\n" +
                "            enableWifiCheckbox.dispatchEvent(new Event('change', {bubbles: true}));\n" +
                "            enableWifiCheckbox.dispatchEvent(new Event('click', {bubbles: true}));\n" +
                "          }\n" +
                "          return 'UNCHECKED_ENABLE_WIFI';\n" +
                "        }\n" +
                "        // Nếu vừa bỏ tích, đợi 450ms cho giao diện thu gọn rồi bấm Save\n" +
                "        if (window.__sglUncheckedAt && (now - window.__sglUncheckedAt < 450)) {\n" +
                "          return 'WAITING';\n" +
                "        }\n" +
                "        // Tìm nút Save chính của 2.4G WiFi Settings (ưu tiên nút Save nằm cùng hàng với Cancel, trước 2.4G Multi-SSID Setup)\n" +
                "        var btns = doc.querySelectorAll('button, input[type=\"button\"], input[type=\"submit\"], a, div, span');\n" +
                "        var saveNextToCancel = null;\n" +
                "        var firstSaveBtn = null;\n" +
                "        for (var b = 0; b < btns.length; b++) {\n" +
                "          var btn = btns[b];\n" +
                "          if (!isVisible(btn)) continue;\n" +
                "          if (normText(btn).toLowerCase() === 'save') {\n" +
                "            if (!firstSaveBtn) firstSaveBtn = btn;\n" +
                "            var p = btn.parentElement;\n" +
                "            for (var level = 0; level < 3 && p; level++) {\n" +
                "              var pText = (p.innerText || p.textContent || '').toLowerCase();\n" +
                "              if (pText.indexOf('cancel') !== -1 && pText.indexOf('2.4g multi-ssid setup') === -1) {\n" +
                "                saveNextToCancel = btn;\n" +
                "                break;\n" +
                "              }\n" +
                "              p = p.parentElement;\n" +
                "            }\n" +
                "            if (saveNextToCancel) break;\n" +
                "          }\n" +
                "        }\n" +
                "        var targetSave = saveNextToCancel || firstSaveBtn;\n" +
                "        if (targetSave) {\n" +
                "          window.__sglClickedSave = true;\n" +
                "          window.__sglSaveTime = now;\n" +
                "          targetSave.click();\n" +
                "          return 'CLICKED_SAVE';\n" +
                "        }\n" +
                "      }\n" +
                "    }\n" +
                "\n" +
                "    // 4. Mở menu WiFi Settings -> 2.4G WiFi Settings ở thanh bên trái\n" +
                "    for (var dIdx = 0; dIdx < docs.length; dIdx++) {\n" +
                "      var doc = docs[dIdx];\n" +
                "      var navEls = doc.querySelectorAll('a, li, div, span, p, td');\n" +
                "      for (var i = 0; i < navEls.length; i++) {\n" +
                "        var el = navEls[i];\n" +
                "        if (isVisible(el) && normText(el).toLowerCase() === '2.4g wifi settings') {\n" +
                "          if (!window.__sglClick24gTime || (now - window.__sglClick24gTime > 2500)) {\n" +
                "            window.__sglClick24gTime = now;\n" +
                "            window.__sglPanelSeenAt = 0;\n" +
                "            el.click();\n" +
                "            return 'OPENING_24G_MENU';\n" +
                "          }\n" +
                "          return 'WAITING';\n" +
                "        }\n" +
                "      }\n" +
                "      for (var j = 0; j < navEls.length; j++) {\n" +
                "        var elW = navEls[j];\n" +
                "        var tw = normText(elW).toLowerCase();\n" +
                "        if (isVisible(elW) && (tw === 'wifi settings' || tw === 'wi-fi settings')) {\n" +
                "          if (!window.__sglClickWifiMenuTime || (now - window.__sglClickWifiMenuTime > 2500)) {\n" +
                "            window.__sglClickWifiMenuTime = now;\n" +
                "            elW.click();\n" +
                "            return 'OPENING_WIFI_MENU';\n" +
                "          }\n" +
                "          return 'WAITING';\n" +
                "        }\n" +
                "      }\n" +
                "    }\n" +
                "    return 'WAITING';\n" +
                "  } catch (err) {\n" +
                "    return 'WAITING';\n" +
                "  }\n" +
                "})();";
    }
}
