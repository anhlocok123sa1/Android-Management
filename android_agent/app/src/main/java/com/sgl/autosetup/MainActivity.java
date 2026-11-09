package com.sgl.autosetup;

import android.app.Activity;
import android.app.AlertDialog;
import android.content.Intent;
import android.content.pm.PackageInfo;
import android.content.pm.PackageManager;
import androidx.core.content.ContextCompat;
import android.graphics.Color;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.util.TypedValue;
import android.view.Gravity;
import android.webkit.CookieManager;
import android.webkit.JsResult;
import android.webkit.WebChromeClient;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Button;
import android.widget.CheckBox;
import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;

import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.DataOutputStream;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;

public class MainActivity extends Activity {

    // =========================================================================
    // DÁN LINK WEB APP GOOGLE SHEET CỦA BẠN VÀO GIỮA DẤU NGOẶC KÉP BÊN DƯỚI:
    // =========================================================================
    private static final String GOOGLE_SHEET_WEBHOOK_URL = "https://script.google.com/macros/s/AKfycbxqawYpW8SebK0EK21Cl7C2uw6vN3-Jr7vQIHSAbNxtwXA5H7c_lYRNhXuB7104P0NN/exec";

    // Tên các file APK trên USB
    private static final String APK_ANYDESK = "02_anydesk.apk";
    private static final String APK_ADCONTROL = "03_adcontrol-aosp.apk";
    private static final String APK_RADIO_36 = "04_Audio_3.6_productionRelease.apk";
    private static final String APK_RADIO_166 = "radio.apk";
    private static final String APK_ICS = "ics-android-box (2.0.0).apk";
    private static final String ICS_PACKAGE_NAME = "com.app.ics_content_management";

    // Tên 4 Sheet trên Google Sheet theo đúng yêu cầu
    private static final String SHEET_ANDROID_MOI = "Android Mới";
    private static final String SHEET_RADIO_36 = "Radio 3.6";
    private static final String SHEET_RADIO_166 = "Radio 1.66";
    private static final String SHEET_ICS = "ICS";

    // Thư mục lưu đệm trên máy (giúp Giai đoạn 2 qua AnyDesk cài được ngay cả khi rút USB)
    private static final String LOCAL_BACKUP_DIR = "/sdcard/SGL_Backup_Apks";

    private TextView tvLog;
    private TextView tvAnydeskId;
    private EditText edtRadioUser;
    private EditText edtRadioPass;
    private CheckBox cbAutoRemoveStage2;

    private Button btnStage1NewBox;
    private Button btnSyncOldBox;
    private Button btnStage2Radio36;
    private Button btnStage2Radio166;
    private Button btnStage2Ics;
    private Button btnUtilInstall;
    private Button btnUtilUninstall;
    private Button btnUtilDateTime;
    private Button btnUtilSaveMk;
    private Button btnDisableWifi4G;
    private Button btnUtilDeleteSelf;

    private final Handler mainHandler = new Handler(Looper.getMainLooper());

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setPadding(25, 14, 25, 14);
        root.setBackgroundColor(Color.parseColor("#121212"));

        TextView title = new TextView(this);
        title.setText("HỆ THỐNG CÀI ĐẶT & CHỐT DỰ ÁN ANDROID BOX (USB EDITION)");
        title.setTextColor(Color.WHITE);
        title.setTextSize(TypedValue.COMPLEX_UNIT_SP, 19);
        title.setGravity(Gravity.CENTER);
        root.addView(title);

        tvAnydeskId = new TextView(this);
        tvAnydeskId.setText("Đang kiểm tra AnyDesk & MAC...");
        tvAnydeskId.setTextColor(Color.parseColor("#00E676"));
        tvAnydeskId.setTextSize(TypedValue.COMPLEX_UNIT_SP, 18);
        tvAnydeskId.setGravity(Gravity.CENTER);
        tvAnydeskId.setPadding(0, 4, 0, 6);
        root.addView(tvAnydeskId);

        // =====================================================================
        // KHU VỰC 1: GIAI ĐOẠN 1 - CÀI CHUẨN MẠCH MỚI (XUẤT SHEET "Android Mới")
        // =====================================================================
        LinearLayout stage1Row = new LinearLayout(this);
        stage1Row.setOrientation(LinearLayout.HORIZONTAL);
        stage1Row.setGravity(Gravity.CENTER_VERTICAL);
        stage1Row.setPadding(0, 2, 0, 6);

        btnStage1NewBox = new Button(this);
        btnStage1NewBox.setText("GIAI ĐOẠN 1: CÀI MẠCH MỚI (3.6 + TEST Z755-01)");
        btnStage1NewBox.setBackgroundColor(Color.parseColor("#1E88E5"));
        btnStage1NewBox.setTextColor(Color.WHITE);
        btnStage1NewBox.setPadding(12, 16, 12, 16);
        LinearLayout.LayoutParams s1BtnParams = new LinearLayout.LayoutParams(
                0, LinearLayout.LayoutParams.WRAP_CONTENT, 1.0f);
        s1BtnParams.setMargins(4, 0, 8, 0);
        btnStage1NewBox.setLayoutParams(s1BtnParams);
        btnStage1NewBox.setOnClickListener(v -> {
            final String user = edtRadioUser.getText().toString().trim();
            final String pass = edtRadioPass.getText().toString().trim();
            new Thread(() -> runStage1StandardInstall(user, pass)).start();
        });
        stage1Row.addView(btnStage1NewBox);

        btnSyncOldBox = new Button(this);
        btnSyncOldBox.setText("🔄 ĐỒNG BỘ BOX CŨ LÊN SHEET (TỰ TÌM DỰ ÁN THEO ANYDESK)");
        btnSyncOldBox.setBackgroundColor(Color.parseColor("#00C853"));
        btnSyncOldBox.setTextColor(Color.parseColor("#04120A"));
        btnSyncOldBox.setPadding(12, 16, 12, 16);
        btnSyncOldBox.setLayoutParams(s1BtnParams);
        btnSyncOldBox.setOnClickListener(v -> new Thread(() -> syncOldBoxToSheet(false)).start());
        stage1Row.addView(btnSyncOldBox);

        TextView lblUser = new TextView(this);
        lblUser.setText("TK Test: ");
        lblUser.setTextColor(Color.LTGRAY);
        stage1Row.addView(lblUser);

        edtRadioUser = new EditText(this);
        edtRadioUser.setText("z755-01");
        edtRadioUser.setTextColor(Color.YELLOW);
        edtRadioUser.setMinWidth(130);
        stage1Row.addView(edtRadioUser);

        TextView lblPass = new TextView(this);
        lblPass.setText(" MK: ");
        lblPass.setTextColor(Color.LTGRAY);
        stage1Row.addView(lblPass);

        edtRadioPass = new EditText(this);
        edtRadioPass.setText("2");
        edtRadioPass.setTextColor(Color.YELLOW);
        edtRadioPass.setMinWidth(60);
        stage1Row.addView(edtRadioPass);

        root.addView(stage1Row);

        // =====================================================================
        // KHU VỰC 2: GIAI ĐOẠN 2 - CHỐT DỰ ÁN 1 CHẠM (XUẤT SHEET TƯƠNG ỨNG)
        // =====================================================================
        LinearLayout stage2HeaderRow = new LinearLayout(this);
        stage2HeaderRow.setOrientation(LinearLayout.HORIZONTAL);
        stage2HeaderRow.setGravity(Gravity.CENTER_VERTICAL);

        TextView lblStage2 = new TextView(this);
        lblStage2.setText("GIAI ĐOẠN 2 - CHỐT DỰ ÁN (Tự gỡ bản cũ -> Cài theo dự án -> Ghi Sheet riêng): ");
        lblStage2.setTextColor(Color.parseColor("#FFD54F"));
        lblStage2.setTextSize(TypedValue.COMPLEX_UNIT_SP, 14);
        stage2HeaderRow.addView(lblStage2);

        cbAutoRemoveStage2 = new CheckBox(this);
        cbAutoRemoveStage2.setText("Tự xóa 00_AutoSetup sau khi chốt dự án");
        cbAutoRemoveStage2.setTextColor(Color.WHITE);
        cbAutoRemoveStage2.setChecked(false);
        stage2HeaderRow.addView(cbAutoRemoveStage2);

        root.addView(stage2HeaderRow);

        LinearLayout stage2Row = new LinearLayout(this);
        stage2Row.setOrientation(LinearLayout.HORIZONTAL);
        stage2Row.setGravity(Gravity.CENTER);
        stage2Row.setPadding(0, 2, 0, 8);

        LinearLayout.LayoutParams btnParams = new LinearLayout.LayoutParams(
                0, LinearLayout.LayoutParams.WRAP_CONTENT, 1.0f);
        btnParams.setMargins(5, 2, 5, 2);

        // NÚT DỰ ÁN 1: RADIO 3.6 -> SHEET "Radio 3.6"
        btnStage2Radio36 = new Button(this);
        btnStage2Radio36.setText("DỰ ÁN RADIO 3.6\n(-> Sheet 'Radio 3.6')");
        btnStage2Radio36.setBackgroundColor(Color.parseColor("#00897B"));
        btnStage2Radio36.setTextColor(Color.WHITE);
        btnStage2Radio36.setPadding(10, 14, 10, 14);
        btnStage2Radio36.setLayoutParams(btnParams);
        btnStage2Radio36.setOnClickListener(v -> new Thread(() -> runStage2ProjectRadio36(cbAutoRemoveStage2.isChecked())).start());
        stage2Row.addView(btnStage2Radio36);

        // NÚT DỰ ÁN 2: RADIO 1.66 -> SHEET "Radio 1.66"
        btnStage2Radio166 = new Button(this);
        btnStage2Radio166.setText("DỰ ÁN RADIO 1.66\n(-> Sheet 'Radio 1.66')");
        btnStage2Radio166.setBackgroundColor(Color.parseColor("#FB8C00"));
        btnStage2Radio166.setTextColor(Color.WHITE);
        btnStage2Radio166.setPadding(10, 14, 10, 14);
        btnStage2Radio166.setLayoutParams(btnParams);
        btnStage2Radio166.setOnClickListener(v -> new Thread(() -> runStage2ProjectRadio166(cbAutoRemoveStage2.isChecked())).start());
        stage2Row.addView(btnStage2Radio166);

        // NÚT DỰ ÁN 3: VNPT ICS -> SHEET "ICS"
        btnStage2Ics = new Button(this);
        btnStage2Ics.setText("DỰ ÁN VNPT ICS\n(-> Sheet 'ICS')");
        btnStage2Ics.setBackgroundColor(Color.parseColor("#3949AB"));
        btnStage2Ics.setTextColor(Color.WHITE);
        btnStage2Ics.setPadding(10, 14, 10, 14);
        btnStage2Ics.setLayoutParams(btnParams);
        btnStage2Ics.setOnClickListener(v -> new Thread(() -> runStage2ProjectIcs(cbAutoRemoveStage2.isChecked())).start());
        stage2Row.addView(btnStage2Ics);

        root.addView(stage2Row);

        // =====================================================================
        // KHU VỰC 3: CÔNG CỤ LẺ (CÀI LẺ | GỠ LẺ | ĐỔI GIỜ +7 | LƯU MK | XÓA APP)
        // =====================================================================
        LinearLayout utilRow = new LinearLayout(this);
        utilRow.setOrientation(LinearLayout.HORIZONTAL);
        utilRow.setGravity(Gravity.CENTER);
        utilRow.setPadding(0, 0, 0, 6);

        btnUtilInstall = new Button(this);
        btnUtilInstall.setText("CÀI LẺ APP");
        btnUtilInstall.setBackgroundColor(Color.parseColor("#546E7A"));
        btnUtilInstall.setTextColor(Color.WHITE);
        btnUtilInstall.setLayoutParams(btnParams);
        btnUtilInstall.setOnClickListener(v -> showInstallSingleMenuDialog());
        utilRow.addView(btnUtilInstall);

        btnUtilUninstall = new Button(this);
        btnUtilUninstall.setText("GỠ LẺ APP");
        btnUtilUninstall.setBackgroundColor(Color.parseColor("#E53935"));
        btnUtilUninstall.setTextColor(Color.WHITE);
        btnUtilUninstall.setLayoutParams(btnParams);
        btnUtilUninstall.setOnClickListener(v -> showUninstallMenuDialog());
        utilRow.addView(btnUtilUninstall);

        btnUtilDateTime = new Button(this);
        btnUtilDateTime.setText("NGÀY GIỜ +7");
        btnUtilDateTime.setBackgroundColor(Color.parseColor("#8E24AA"));
        btnUtilDateTime.setTextColor(Color.WHITE);
        btnUtilDateTime.setLayoutParams(btnParams);
        btnUtilDateTime.setOnClickListener(v -> new Thread(() -> configureBangkokDateTime(true)).start());
        utilRow.addView(btnUtilDateTime);

        btnUtilSaveMk = new Button(this);
        btnUtilSaveMk.setText("LƯU MK ANYDESK");
        btnUtilSaveMk.setBackgroundColor(Color.parseColor("#43A047"));
        btnUtilSaveMk.setTextColor(Color.WHITE);
        btnUtilSaveMk.setLayoutParams(btnParams);
        btnUtilSaveMk.setOnClickListener(v -> new Thread(this::saveAnydeskTemplateToUsb).start());
        utilRow.addView(btnUtilSaveMk);

        btnDisableWifi4G = new Button(this);
        btnDisableWifi4G.setText("TẮT WIFI 4G (192.168.8.1)");
        btnDisableWifi4G.setBackgroundColor(Color.parseColor("#00838F"));
        btnDisableWifi4G.setTextColor(Color.WHITE);
        btnDisableWifi4G.setLayoutParams(btnParams);
        btnDisableWifi4G.setOnClickListener(v -> new Thread(this::runDisableSmartWifi4G).start());
        utilRow.addView(btnDisableWifi4G);

        btnUtilDeleteSelf = new Button(this);
        btnUtilDeleteSelf.setText("XÓA 00_AUTOSETUP");
        btnUtilDeleteSelf.setBackgroundColor(Color.parseColor("#B71C1C"));
        btnUtilDeleteSelf.setTextColor(Color.WHITE);
        btnUtilDeleteSelf.setLayoutParams(btnParams);
        btnUtilDeleteSelf.setOnClickListener(v -> new Thread(this::uninstallSelfApp).start());
        utilRow.addView(btnUtilDeleteSelf);

        root.addView(utilRow);

        ScrollView scroll = new ScrollView(this);
        tvLog = new TextView(this);
        tvLog.setTextColor(Color.parseColor("#E0E0E0"));
        tvLog.setTextSize(TypedValue.COMPLEX_UNIT_SP, 14);
        tvLog.setPadding(16, 8, 16, 8);
        scroll.addView(tvLog);
        root.addView(scroll);

        setContentView(root);
        boolean autoStartStage1 = getIntent() != null && getIntent().getBooleanExtra("AUTO_START_STAGE1", false);
        if (autoStartStage1) {
            log("⚡ Nhận tín hiệu từ cáp USB: Tự động kích hoạt GIAI ĐOẠN 1...");
            new Thread(() -> runStage1StandardInstall("z755-01", "2")).start();
        } else {
            log("Sẵn sàng! Đang tự động kiểm tra mã AnyDesk và đồng bộ trạng thái Box lên Google Sheet...");
            new Thread(() -> syncOldBoxToSheet(true)).start();
        }

        // Tự động khởi động AgentService chạy ngầm để nhận lệnh từ xa
        try {
            Intent agentIntent = new Intent(this, AgentService.class);
            ContextCompat.startForegroundService(this, agentIntent);
            log("🚀 Đã kích hoạt AgentService chạy nền (Heartbeat 5 phút/lần).");
        } catch (Exception e) {
            log("⚠ Không thể khởi động AgentService: " + e.getMessage());
        }
    }

    /**
     * Tự động đọc AnyDesk ID, MAC và phần mềm phát thanh đang sử dụng trên Box,
     * tìm kiếm mã AnyDesk trên các Sheet dự án của Google Sheet và đồng bộ trạng thái Online.
     */
    private void syncOldBoxToSheet(boolean isAutoStartup) {
        if (!isAutoStartup) {
            setButtonsEnabled(false);
        }
        try {
            String anydeskId = readAnydeskId();
            if (anydeskId != null) {
                anydeskId = anydeskId.replaceAll("[^0-9]", "").trim();
            } else {
                anydeskId = "";
            }
            // Nếu chưa đọc được AnyDesk ID ngay (do đang chờ cấp quyền Root hoặc AnyDesk chưa khởi tạo),
            // thử lại tối đa 5 lần hoặc tự kích hoạt AnyDesk để lấy bằng được AnyDesk ID + MAC ngay lần đầu!
            if (anydeskId.isEmpty()) {
                for (int r = 0; r < 5; r++) {
                    try { Thread.sleep(2000); } catch (InterruptedException ignored) {}
                    anydeskId = readAnydeskId();
                    if (anydeskId != null) {
                        anydeskId = anydeskId.replaceAll("[^0-9]", "").trim();
                    } else {
                        anydeskId = "";
                    }
                    if (!anydeskId.isEmpty()) break;
                }
            }
            if (anydeskId.isEmpty()) {
                anydeskId = ensureAnydeskIdReady();
            }

            String mac = DeviceInfo.getMac();
            if (mac == null || mac.isEmpty() || "UNKNOWN".equals(mac)) {
                mac = readFormattedMacAddress();
            }
            String software = DeviceInfo.detectInstalledSoftware(this);
            if (software.isEmpty()) {
                software = "Chưa cài App Đài";
            }
            String macIcs = "VNPT ICS".equals(software) ? DeviceInfo.extractIcsMacIfPresent() : "";

            setStatusBanner(anydeskId, mac, macIcs);

            log("--------------------------------------------------");
            log("🔍 [ĐỒNG BỘ BOX DỰ ÁN] Đang dò tìm mã AnyDesk [" + (anydeskId.isEmpty() ? "Chưa có" : anydeskId) + "] trên Google Sheet...");
            log("   • Địa chỉ MAC thiết bị : " + mac);
            log("   • App đang sử dụng     : " + software + (macIcs.isEmpty() ? "" : (" (MAC ICS: " + macIcs + ")")));

            WebhookClient client = new WebhookClient(getWebhookUrl(findUsbAppFolder()));
            WebhookClient.SyncBoxResult res = client.syncOldBoxByAnydesk(
                    mac,
                    anydeskId,
                    software,
                    macIcs,
                    DeviceInfo.getAppVersion(this),
                    DeviceInfo.getStorageMb(),
                    DeviceInfo.getRamMb(this),
                    DeviceInfo.getIpAddress()
            );

            if (res.success) {
                String matchNote = res.matchedByAnydesk
                        ? "✅ ĐÃ TÌM THẤY MÃ ANYDESK TRÊN DỰ ÁN: " + res.project
                        : "ℹ Mã AnyDesk chưa có sẵn trong Sheet dự án -> Đã thêm vào: " + res.project;
                log(matchNote);
                log("✔ Đã đồng bộ lên Google Sheet: Dự án [" + res.project + "] | App [" + res.software + "] | Trạng thái [ONLINE]");
                final String finalAd = anydeskId;
                final String finalMac = mac;
                final String finalProj = res.project;
                final String finalSoft = res.software;
                mainHandler.post(() -> tvAnydeskId.setText(
                        "ANYDESK: " + (finalAd.isEmpty() ? "Chưa có" : finalAd) +
                        "  |  MAC: " + finalMac +
                        "  |  DỰ ÁN: " + finalProj + " (" + finalSoft + " - ONLINE)"
                ));
            } else {
                log("⚠ Chưa thể kết nối Google Sheet: " + res.message);
            }
        } catch (Exception e) {
            log("⚠ Lỗi khi đồng bộ Box lên Sheet: " + e.getMessage());
        } finally {
            if (!isAutoStartup) {
                setButtonsEnabled(true);
            }
        }
    }

    // =========================================================================
    // GIAI ĐOẠN 1: CÀI CHUẨN MẠCH MỚI (3.6 + TEST Z755-01) -> SHEET "Android Mới"
    // =========================================================================
    private void runStage1StandardInstall(String radioUser, String radioPass) {
        setButtonsEnabled(false);
        log("==================================================");
        log(">>> BẮT ĐẦU GIAI ĐOẠN 1: CÀI CHUẨN MẠCH MỚI (XUẤT SHEET '" + SHEET_ANDROID_MOI + "') <<<");

        log("[Bước 1/8] Đặt múi giờ & đồng bộ thời gian GMT+07:00 (Asia/Bangkok)...");
        configureBangkokDateTime(false);

        log("\n[Bước 2/8] Tìm thư mục bộ cài trên USB...");
        String usbDir = findUsbAppFolder();
        if (usbDir.isEmpty()) {
            log("❌ KHÔNG TÌM THẤY THƯ MỤC BỘ CÀI TRÊN USB! Hãy kiểm tra lại USB.");
            setButtonsEnabled(true);
            return;
        }
        log("✔ Đã tìm thấy USB tại: " + usbDir);

        // Tự động sao lưu các bộ cài từ USB vào bộ nhớ trong của Box (/sdcard/SGL_Backup_Apks)
        // để khi sang Giai đoạn 2 (nhân viên vào AnyDesk dùng SIM) không cần cắm lại USB vẫn cài được 1.66 / ICS!
        log("\n[Bước 3/8] Đang cài đặt AnyDesk + Radio 3.6 và tạo bản lưu dự phòng cho Giai đoạn 2...");
        runRootCommand("mkdir -p " + LOCAL_BACKUP_DIR + " ; " +
                "for f in \"" + APK_RADIO_36 + "\" \"" + APK_RADIO_166 + "\" \"" + APK_ICS + "\"; do " +
                "  if [ -f \"" + usbDir + "/$f\" ]; then cp -f \"" + usbDir + "/$f\" \"" + LOCAL_BACKUP_DIR + "/$f\" 2>/dev/null; fi; " +
                "done ; sync");

        String[] stage1Apks = { APK_ANYDESK, APK_ADCONTROL, APK_RADIO_36 };
        for (String apk : stage1Apks) {
            installApkFromUsbOrBackup(apk, usbDir);
        }

        String radio36Pkg = resolvePackageName(usbDir, APK_RADIO_36, "radio|audio|station|streamer");
        if (!radio36Pkg.isEmpty()) {
            runRootCommand("am force-stop " + radio36Pkg);
        }
        bringAutoSetupToFront();

        log("\n[Bước 4/8] Cấp quyền hệ thống & lệnh Root cho AnyDesk...");
        runRootCommand("appops set com.anydesk.anydeskandroid PROJECT_MEDIA allow");
        runRootCommand("appops set com.anydesk.anydeskandroid SYSTEM_ALERT_WINDOW allow");
        runRootCommand("settings put secure enabled_accessibility_services com.anydesk.adcontrol.aosp/com.anydesk.adcontrol.AccService:com.anydesk.adcontrol.ad1/com.anydesk.adcontrol.AccService");
        runRootCommand("settings put secure accessibility_enabled 1");
        log("✔ Đã cấp xong PROJECT_MEDIA, Hiển thị trên ứng dụng khác và Accessibility!");

        log("\n[Bước 5/8] Khởi tạo mã ID AnyDesk và nạp mật khẩu bảo mật...");
        runRootCommand("monkey -p com.anydesk.anydeskandroid -c android.intent.category.LAUNCHER 1 >/dev/null 2>&1");

        String confDir = "";
        String anydeskId = "";
        for (int i = 0; i < 10; i++) {
            try { Thread.sleep(1000); } catch (InterruptedException ignored) {}
            confDir = findAnydeskConfDir();
            anydeskId = readAnydeskId();
            if (!confDir.isEmpty() && !anydeskId.isEmpty()) break;
        }
        bringAutoSetupToFront();

        String hasTemplate = runRootCommand(
                "if [ -s \"" + usbDir + "/anydesk_config/system.conf\" ] || " +
                        "[ -s \"" + usbDir + "/anydesk_config/service.conf\" ] || " +
                        "[ -s \"" + usbDir + "/anydesk_config/user.conf\" ]; then echo 'YES'; fi"
        );

        if ("YES".equals(hasTemplate) && !confDir.isEmpty()) {
            runRootCommand("am force-stop com.anydesk.anydeskandroid");
            try { Thread.sleep(1000); } catch (InterruptedException ignored) {}

            String restoreCmd =
                    "for base in " +
                            "  /data_mirror/data_de/null/0/com.anydesk.anydeskandroid " +
                            "  /data_mirror/data_ce/null/0/com.anydesk.anydeskandroid " +
                            "  /data/user_de/0/com.anydesk.anydeskandroid " +
                            "  /data/user/0/com.anydesk.anydeskandroid " +
                            "  /data/data/com.anydesk.anydeskandroid; do " +
                            "  target=\"$base/files/.anydesk\"; " +
                            "  if [ -d \"$target\" ]; then " +
                            "    for f in service.conf system.conf user.conf; do " +
                            "      if [ -s \"" + usbDir + "/anydesk_config/$f\" ]; then " +
                            "        rm -f \"$target/$f.new\"; " +
                            "        if [ -f \"$target/$f\" ]; then " +
                            "          grep -E '^ad\\.anynet\\.(id|cert|pkey|alias|register)' \"$target/$f\" > \"$target/$f.new\" 2>/dev/null || true; " +
                            "        fi; " +
                            "        cat \"" + usbDir + "/anydesk_config/$f\" >> \"$target/$f.new\"; " +
                            "        mv \"$target/$f.new\" \"$target/$f\"; " +
                            "      fi; " +
                            "    done; " +
                            "    OWNER=$(stat -c '%u:%g' \"$base\" 2>/dev/null); " +
                            "    if [ -n \"$OWNER\" ]; then chown -R $OWNER \"$base/files\" 2>/dev/null; fi; " +
                            "    chmod 600 \"$target\"/*.conf 2>/dev/null; " +
                            "  fi; " +
                            "  if [ -d \"$base\" ] && [ -d \"" + usbDir + "/anydesk_config/shared_prefs\" ]; then " +
                            "    mkdir -p \"$base/shared_prefs\" 2>/dev/null; " +
                            "    cp -f \"" + usbDir + "/anydesk_config/shared_prefs/\"*.xml \"$base/shared_prefs/\" 2>/dev/null || true; " +
                            "    OWNER=$(stat -c '%u:%g' \"$base\" 2>/dev/null); " +
                            "    if [ -n \"$OWNER\" ]; then chown -R $OWNER \"$base/shared_prefs\" 2>/dev/null; fi; " +
                            "    chmod 660 \"$base/shared_prefs/\"*.xml 2>/dev/null; " +
                            "  fi; " +
                            "done; " +
                            "sync";
            runRootCommand(restoreCmd);

            runRootCommand("monkey -p com.anydesk.anydeskandroid -c android.intent.category.LAUNCHER 1 >/dev/null 2>&1");
            try { Thread.sleep(2500); } catch (InterruptedException ignored) {}
            bringAutoSetupToFront();
            log("✔ Đã nạp tự động mật khẩu bảo mật và Full Access!");
        } else {
            log("⚠ CHÚ Ý: Chưa có mẫu mật khẩu AnyDesk trên USB. Hãy cài mật khẩu AnyDesk rồi bấm [LƯU MK ANYDESK].");
        }

        log("\n[Bước 6/8] Xuất [AnyDesk | MAC] lên Sheet '" + SHEET_ANDROID_MOI + "'...");
        anydeskId = readAnydeskId();
        String formattedMac = readFormattedMacAddress();
        setStatusBanner(anydeskId, formattedMac, "");
        sendToProjectSheet(SHEET_ANDROID_MOI, anydeskId, formattedMac, "", usbDir);

        log("\n[Bước 7/8] Đăng nhập tức thì Radio 3.6 (" + radioUser + " / " + radioPass + ")...");
        autoLoginRadioStation(radio36Pkg, radioUser, radioPass);

        log("🎉 HOÀN TẤT GIAI ĐOẠN 1! Mạch đã sẵn sàng chuyển sang xưởng lắp ráp.");
        setButtonsEnabled(true);
    }

    // =========================================================================
    // GIAI ĐOẠN 2 - NÚT 1: CHỐT DỰ ÁN RADIO 3.6 -> XUẤT SHEET "Radio 3.6"
    // =========================================================================
    private void runStage2ProjectRadio36(boolean autoRemoveSelf) {
        setButtonsEnabled(false);
        log("==================================================");
        log(">>> GIAI ĐOẠN 2: CHỐT DỰ ÁN [RADIO 3.6] -> XUẤT SHEET '" + SHEET_RADIO_36 + "' <<<");

        String usbDir = findUsbAppFolder();

        // 1. Gỡ ICS và Radio 1.66 (nếu có) để máy sạch sẽ
        log("[1/4] Kiểm tra và gỡ các ứng dụng dự án khác (ICS / Radio 1.66)...");
        uninstallAppSilently(usbDir, APK_ICS, ICS_PACKAGE_NAME);

        // 2. Cài đặt chuẩn lại bản Radio 3.6
        log("[2/4] Đảm bảo cài đặt đúng phiên bản Radio 3.6 (" + APK_RADIO_36 + ")...");
        installApkFromUsbOrBackup(APK_RADIO_36, usbDir);
        bringAutoSetupToFront();

        // 3. Xuất AnyDesk & MAC ra Sheet "Radio 3.6"
        log("[3/4] Đang xuất [AnyDesk | MAC] ra Sheet '" + SHEET_RADIO_36 + "'...");
        String anydeskId = ensureAnydeskIdReady();
        String mac = readFormattedMacAddress();
        setStatusBanner(anydeskId, mac, "");
        sendToProjectSheet(SHEET_RADIO_36, anydeskId, mac, "", usbDir);

        log("[4/4] Hoàn tất chốt dự án Radio 3.6!");
        if (autoRemoveSelf) {
            uninstallSelfApp();
        } else {
            setButtonsEnabled(true);
        }
    }

    // =========================================================================
    // GIAI ĐOẠN 2 - NÚT 2: CHỐT DỰ ÁN RADIO 1.66 -> XUẤT SHEET "Radio 1.66"
    // =========================================================================
    private void runStage2ProjectRadio166(boolean autoRemoveSelf) {
        setButtonsEnabled(false);
        log("==================================================");
        log(">>> GIAI ĐOẠN 2: CHỐT DỰ ÁN [RADIO 1.66] -> XUẤT SHEET '" + SHEET_RADIO_166 + "' <<<");

        String usbDir = findUsbAppFolder();

        // 1. Gỡ bản Radio 3.6 test và ICS (nếu có)
        log("[1/4] Đang gỡ bản Radio 3.6 test (và ICS nếu có)...");
        uninstallAppSilently(usbDir, APK_RADIO_36, "radio|audio|station|streamer");
        uninstallAppSilently(usbDir, APK_ICS, ICS_PACKAGE_NAME);

        // 2. Cài đặt bản Radio 1.66 (radio.apk)
        log("[2/4] Đang cài đặt Radio 1.66 (" + APK_RADIO_166 + ")...");
        boolean installed = installApkFromUsbOrBackup(APK_RADIO_166, usbDir);
        bringAutoSetupToFront();
        if (!installed) {
            log("❌ Cài đặt Radio 1.66 thất bại! Hãy kiểm tra file " + APK_RADIO_166 + " trên USB.");
            setButtonsEnabled(true);
            return;
        }

        // 3. Xuất AnyDesk & MAC ra Sheet "Radio 1.66"
        log("[3/4] Đang xuất [AnyDesk | MAC] ra Sheet '" + SHEET_RADIO_166 + "'...");
        String anydeskId = ensureAnydeskIdReady();
        String mac = readFormattedMacAddress();
        setStatusBanner(anydeskId, mac, "");
        sendToProjectSheet(SHEET_RADIO_166, anydeskId, mac, "", usbDir);

        log("[4/4] Hoàn tất chốt dự án Radio 1.66!");
        if (autoRemoveSelf) {
            uninstallSelfApp();
        } else {
            setButtonsEnabled(true);
        }
    }

    // =========================================================================
    // GIAI ĐOẠN 2 - NÚT 3: CHỐT DỰ ÁN VNPT ICS -> XUẤT SHEET "ICS"
    // =========================================================================
    private void runStage2ProjectIcs(boolean autoRemoveSelf) {
        setButtonsEnabled(false);
        log("==================================================");
        log(">>> GIAI ĐOẠN 2: CHỐT DỰ ÁN [VNPT ICS] -> XUẤT SHEET '" + SHEET_ICS + "' <<<");

        String usbDir = findUsbAppFolder();

        // 1. Gỡ bản Radio 3.6 / 1.66 trước khi cài ICS
        log("[1/5] Đang gỡ ứng dụng RadioStation cũ...");
        uninstallAppSilently(usbDir, APK_RADIO_36, "radio|audio|station|streamer");
        uninstallAppSilently(usbDir, APK_RADIO_166, "radio|audio|station|streamer");

        // 2. Cài đặt ứng dụng ICS (ics-android-box (2.0.0).apk)
        String checkIcsInstalled = runRootCommand("pm list packages " + ICS_PACKAGE_NAME + " 2>/dev/null");
        if (checkIcsInstalled.isEmpty()) {
            log("[2/5] Đang cài đặt ứng dụng ICS (" + APK_ICS + ")...");
            boolean installed = installApkFromUsbOrBackup(APK_ICS, usbDir);
            bringAutoSetupToFront();
            if (!installed) {
                log("❌ Không tìm thấy bộ cài " + APK_ICS + "! Hãy cắm USB chứa file " + APK_ICS + ".");
                setButtonsEnabled(true);
                return;
            }
        } else {
            log("[2/5] Ứng dụng ICS (" + ICS_PACKAGE_NAME + ") đã có sẵn trên mạch.");
        }

        // 3. Mở ICS 5 giây để trích xuất chính xác Mã ICS từ giao diện (idx=4, android.view.View)
        log("[3/5] Đang mở ứng dụng ICS để lấy Mã ICS thiết bị...");
        String icsCode = extractIcsCodeFromUi(usbDir);
        if (icsCode.isEmpty()) {
            log("❌ Không đọc được Mã ICS trên màn hình!");
            setButtonsEnabled(true);
            return;
        }
        log("✔ Đã lấy được Mã ICS chuẩn: " + icsCode);

        // 4. Xuất [AnyDesk | Mã ICS | MAC] ra Sheet "ICS"
        log("[4/5] Đang xuất [AnyDesk | Mã ICS | MAC] ra Sheet '" + SHEET_ICS + "'...");
        String anydeskId = ensureAnydeskIdReady();
        String mac = readFormattedMacAddress();
        setStatusBanner(anydeskId, mac, icsCode);
        sendToProjectSheet(SHEET_ICS, anydeskId, mac, icsCode, usbDir);

        log("[5/5] Hoàn tất chốt dự án VNPT ICS!");
        if (autoRemoveSelf) {
            uninstallSelfApp();
        } else {
            setButtonsEnabled(true);
        }
    }

    // =========================================================================
    // HÀM DÙNG CHUNG: CÀI APK TỪ USB HOẶC TỪ BỘ NHỚ DỰ PHÒNG TRÊN MẠCH
    // =========================================================================
    private boolean installApkFromUsbOrBackup(String apkFileName, String usbDir) {
        String sourcePath = "";
        if (!usbDir.isEmpty()) {
            String existsOnUsb = runRootCommand("if [ -f \"" + usbDir + "/" + apkFileName + "\" ]; then echo 'YES'; fi");
            if ("YES".equals(existsOnUsb)) {
                sourcePath = usbDir + "/" + apkFileName;
            }
        }
        if (sourcePath.isEmpty()) {
            String existsInBackup = runRootCommand("if [ -f \"" + LOCAL_BACKUP_DIR + "/" + apkFileName + "\" ]; then echo 'YES'; fi");
            if ("YES".equals(existsInBackup)) {
                sourcePath = LOCAL_BACKUP_DIR + "/" + apkFileName;
                log("   (Sử dụng file dự phòng có sẵn trên mạch: " + apkFileName + ")");
            }
        }
        if (sourcePath.isEmpty()) {
            log("   ❌ Không tìm thấy file: " + apkFileName);
            return false;
        }

        log("⏳ Đang cài đặt: " + apkFileName + " ...");
        String cmd = "cp \"" + sourcePath + "\" /data/local/tmp/temp_install.apk && " +
                "chmod 644 /data/local/tmp/temp_install.apk && " +
                "pm install -r -g /data/local/tmp/temp_install.apk 2>&1 ; " +
                "rm -f /data/local/tmp/temp_install.apk";
        String res = runRootCommand(cmd);
        log("   -> Kết quả: " + res);
        return res.contains("Success");
    }

    private void uninstallAppSilently(String usbDir, String apkFileName, String fallbackRegex) {
        String pkg = resolvePackageName(usbDir, apkFileName, fallbackRegex);
        if (!pkg.isEmpty()) {
            runRootCommand("am force-stop " + pkg + " ; pm uninstall " + pkg + " >/dev/null 2>&1");
            log("   -> Đã gỡ ứng dụng cũ: " + pkg);
        }
    }

    // =========================================================================
    // HÀM DÙNG CHUNG: GỬI DỮ LIỆU LÊN ĐÚNG SHEET CỦA TỪNG DỰ ÁN
    // =========================================================================
    private void sendToProjectSheet(String sheetName, String anydeskId, String mac, String icsCode, String usbDir) {
        // 1. Lưu file CSV dự phòng theo tên dự án trên USB (hoặc /sdcard/Download)
        String backupDir = usbDir.isEmpty() ? "/sdcard/Download" : usbDir;
        String safeFileName = "Danh_sach_" + sheetName.replace(" ", "_") + ".csv";
        String csvLine = SHEET_ICS.equals(sheetName)
                ? (anydeskId + "," + icsCode + "," + mac)
                : (anydeskId + "," + mac);
        String csvHeader = SHEET_ICS.equals(sheetName) ? "AnyDesk_ID,Ma_ICS,MAC" : "AnyDesk_ID,MAC";

        runRootCommand(
                "if [ ! -f \"" + backupDir + "/" + safeFileName + "\" ]; then " +
                        "  echo '" + csvHeader + "' > \"" + backupDir + "/" + safeFileName + "\" ; " +
                        "fi ; " +
                        "echo \"" + csvLine + "\" >> \"" + backupDir + "/" + safeFileName + "\" ; sync"
        );
        log("✔ Đã lưu bản dự phòng tại: " + backupDir + "/" + safeFileName);

        // 2. Bắn dữ liệu lên Google Sheet vào đúng tab sheetName
        String webhookUrl = getWebhookUrl(usbDir);
        if (webhookUrl.isEmpty() || webhookUrl.contains("DAN_LINK_GOOGLE_SCRIPT")) {
            log("⚠ Bạn chưa dán link Google Apps Script (hoặc file sheet_url.txt trên USB).");
            return;
        }

        try {
            JSONObject payload = new JSONObject();
            payload.put("action", "register_device");
            payload.put("anydesk_id", anydeskId);
            payload.put("mac", mac);
            payload.put("project", "Kho thiết bị");
            payload.put("software", SHEET_ANDROID_MOI.equals(sheetName) ? "Radio 3.6 (Test)" : sheetName);
            payload.put("sheet_name", sheetName);
            payload.put("sheet_type", SHEET_ICS.equals(sheetName) ? "ICS" : "MAIN");
            if (icsCode != null && !icsCode.isEmpty()) {
                payload.put("mac_ics", icsCode);
                payload.put("ics_code", icsCode);
            }

            HttpURLConnection conn = (HttpURLConnection) new URL(webhookUrl).openConnection();
            conn.setInstanceFollowRedirects(true);
            conn.setRequestMethod("POST");
            conn.setRequestProperty("Content-Type", "application/json; charset=UTF-8");
            conn.setConnectTimeout(10000);
            conn.setReadTimeout(10000);
            conn.setDoOutput(true);

            try (OutputStream os = conn.getOutputStream()) {
                os.write(payload.toString().getBytes(StandardCharsets.UTF_8));
            }

            int responseCode = conn.getResponseCode();
            if (responseCode == 200 || responseCode == 302) {
                if (SHEET_ICS.equals(sheetName)) {
                    log("🎉 ĐÃ GHI VÀO SHEET [" + sheetName + "] THÀNH CÔNG: AnyDesk=" + anydeskId + " | ICS=" + icsCode + " | MAC=" + mac);
                } else {
                    log("🎉 ĐÃ GHI VÀO SHEET [" + sheetName + "] THÀNH CÔNG: AnyDesk=" + anydeskId + " | MAC=" + mac);
                }
            } else {
                log("⚠ Google Sheet phản hồi mã HTTP: " + responseCode);
            }
        } catch (Exception e) {
            log("⚠ Lỗi kết nối mạng khi gửi lên Sheet [" + sheetName + "]: " + e.getMessage());
        }
    }

    private String ensureAnydeskIdReady() {
        String id = readAnydeskId();
        if (id.isEmpty()) {
            runRootCommand("monkey -p com.anydesk.anydeskandroid -c android.intent.category.LAUNCHER 1 >/dev/null 2>&1");
            try { Thread.sleep(4000); } catch (InterruptedException ignored) {}
            id = readAnydeskId();
            bringAutoSetupToFront();
        }
        return id;
    }

    // =========================================================================
    // TRÍCH XUẤT CHÍNH XÁC MÃ ICS TỪ GIAO DIỆN com.app.ics_content_management
    // =========================================================================
    private String extractIcsCodeFromUi(String usbDir) {
        String icsPkg = resolvePackageName(usbDir, APK_ICS, "ics_content_management|ics");
        if (icsPkg.isEmpty()) {
            icsPkg = ICS_PACKAGE_NAME;
        }

        String installed = runRootCommand("pm list packages " + icsPkg + " 2>/dev/null");
        if (installed.isEmpty()) {
            log("❌ Ứng dụng ICS (" + icsPkg + ") chưa được cài đặt trên thiết bị!");
            return "";
        }

        log("⏳ Đang mở ứng dụng ICS (" + icsPkg + ") và đợi 5 giây để đọc mã ICS...");
        runRootCommand("monkey -p " + icsPkg + " -c android.intent.category.LAUNCHER 1 >/dev/null 2>&1");

        String icsCode = "";
        for (int attempt = 1; attempt <= 2; attempt++) {
            try { Thread.sleep(attempt == 1 ? 5000 : 2500); } catch (InterruptedException ignored) {}

            String dumpAndParseCmd =
                    "rm -f /data/local/tmp/ics_ui.xml /data/local/tmp/ics_nodes.txt ; " +
                            "uiautomator dump /data/local/tmp/ics_ui.xml >/dev/null 2>&1 ; " +
                            "if [ -f /data/local/tmp/ics_ui.xml ]; then " +
                            "  sed 's/></>\\n</g' /data/local/tmp/ics_ui.xml > /data/local/tmp/ics_nodes.txt ; " +
                            "  CODE=$(grep 'class=\"android.view.View\"' /data/local/tmp/ics_nodes.txt | grep 'content-desc=\"\"' | grep -oE 'text=\"[^\"]+\"' | grep -v 'text=\"\"' | head -n 1 | cut -d'\"' -f2) ; " +
                            "  if [ -z \"$CODE\" ]; then " +
                            "    CODE=$(grep -oE 'text=\"[0-9a-fA-F]{12,24}\"' /data/local/tmp/ics_nodes.txt | head -n 1 | cut -d'\"' -f2) ; " +
                            "  fi ; " +
                            "  echo \"$CODE\" ; " +
                            "fi";
            icsCode = runRootCommand(dumpAndParseCmd).trim();
            if (!icsCode.isEmpty()) {
                break;
            }
        }

        bringAutoSetupToFront();
        return icsCode;
    }

    private void uninstallSelfApp() {
        setButtonsEnabled(false);
        log("==================================================");
        log("⏳ Đang xóa bộ nhớ tạm và tự động gỡ ứng dụng 00_AutoSetup khỏi mạch...");
        String myPkg = getPackageName();
        runRootCommand("nohup sh -c 'rm -rf " + LOCAL_BACKUP_DIR + "; input keyevent 3; sleep 1; pm uninstall " + myPkg + "' >/dev/null 2>&1 &");
    }

    private void setStatusBanner(String anydeskId, String mac, String icsCode) {
        String adText = (anydeskId == null || anydeskId.isEmpty()) ? "Chưa có" : anydeskId;
        String extra = (icsCode == null || icsCode.isEmpty()) ? "" : ("   |   ICS: " + icsCode);
        mainHandler.post(() -> tvAnydeskId.setText("ANYDESK: " + adText + "   |   MAC: " + mac + extra));
    }

    private void configureBangkokDateTime(boolean isStandaloneMenu) {
        if (isStandaloneMenu) {
            setButtonsEnabled(false);
            log("==================================================");
            log(">>> CÀI NGÀY GIỜ SANG GMT+07:00 (BANGKOK) <<<");
        }

        String tzCmd =
                "settings put global auto_time_zone 0 ; " +
                        "settings put global auto_time 1 ; " +
                        "settings put system time_12_24 24 ; " +
                        "setprop persist.sys.timezone Asia/Bangkok ; " +
                        "cmd alarm set-timezone Asia/Bangkok 2>/dev/null ; " +
                        "service call alarm 3 s16 Asia/Bangkok 2>/dev/null ; " +
                        "am broadcast -a android.intent.action.TIMEZONE_CHANGED --es time-zone Asia/Bangkok >/dev/null 2>&1 ; " +
                        "getprop persist.sys.timezone";
        String currentTz = runRootCommand(tzCmd);
        log("✔ Đã đặt múi giờ hệ thống: " + currentTz + " (GMT+07:00 Bangkok)");

        try {
            HttpURLConnection conn = (HttpURLConnection) new URL("http://clients3.google.com/generate_204").openConnection();
            conn.setConnectTimeout(5000);
            conn.setReadTimeout(5000);
            conn.connect();
            long serverTimeMillis = conn.getDate();
            conn.disconnect();

            if (serverTimeMillis > 0) {
                long epochSec = serverTimeMillis / 1000;
                runRootCommand(
                        "cmd alarm set-time " + serverTimeMillis + " 2>/dev/null ; " +
                                "date @" + epochSec + " >/dev/null 2>&1 ; " +
                                "toybox date @" + epochSec + " >/dev/null 2>&1 ; " +
                                "hwclock -w 2>/dev/null || true"
                );
                log("✔ Đã đồng bộ ngày giờ chuẩn qua Internet!");
            }
        } catch (Exception e) {
            runRootCommand("settings put global auto_time 0 ; settings put global auto_time 1");
        }

        String nowStr = runRootCommand("TZ=Asia/Bangkok date '+%d/%m/%Y - %H:%M:%S'");
        log("🕒 Thời gian hiện tại: " + nowStr + " (GMT+7)");

        if (isStandaloneMenu) {
            setButtonsEnabled(true);
        }
    }

    private void showUninstallMenuDialog() {
        String[] options = {
                "1. Gỡ RadioStation 3.6 (" + APK_RADIO_36 + ")",
                "2. Gỡ RadioStation 1.66 (" + APK_RADIO_166 + ")",
                "3. Gỡ VNPT ICS (" + APK_ICS + ")"
        };
        new AlertDialog.Builder(this)
                .setTitle("GỠ CÀI ĐẶT LẺ ỨNG DỤNG")
                .setItems(options, (dialog, which) -> {
                    if (which == 0) {
                        new Thread(() -> uninstallSpecificApp("RadioStation 3.6", APK_RADIO_36, "radio|audio|station|streamer")).start();
                    } else if (which == 1) {
                        new Thread(() -> uninstallSpecificApp("RadioStation 1.66", APK_RADIO_166, "radio|audio|station|streamer")).start();
                    } else if (which == 2) {
                        new Thread(() -> uninstallSpecificApp("VNPT ICS", APK_ICS, ICS_PACKAGE_NAME)).start();
                    }
                })
                .setNegativeButton("Đóng", null)
                .show();
    }

    private void showInstallSingleMenuDialog() {
        String[] options = {
                "1. Cài lẻ RadioStation 3.6 (" + APK_RADIO_36 + ")",
                "2. Cài lẻ RadioStation 1.66 (" + APK_RADIO_166 + ")",
                "3. Cài lẻ VNPT ICS (" + APK_ICS + ")"
        };
        new AlertDialog.Builder(this)
                .setTitle("CÀI ĐẶT LẺ ỨNG DỤNG (TỪ USB / BỘ NHỚ DỰ PHÒNG)")
                .setItems(options, (dialog, which) -> {
                    if (which == 0) {
                        new Thread(() -> {
                            setButtonsEnabled(false);
                            installApkFromUsbOrBackup(APK_RADIO_36, findUsbAppFolder());
                            bringAutoSetupToFront();
                            setButtonsEnabled(true);
                        }).start();
                    } else if (which == 1) {
                        new Thread(() -> {
                            setButtonsEnabled(false);
                            installApkFromUsbOrBackup(APK_RADIO_166, findUsbAppFolder());
                            bringAutoSetupToFront();
                            setButtonsEnabled(true);
                        }).start();
                    } else if (which == 2) {
                        new Thread(() -> {
                            setButtonsEnabled(false);
                            installApkFromUsbOrBackup(APK_ICS, findUsbAppFolder());
                            bringAutoSetupToFront();
                            setButtonsEnabled(true);
                        }).start();
                    }
                })
                .setNegativeButton("Đóng", null)
                .show();
    }

    private void uninstallSpecificApp(String appLabel, String apkFileName, String fallbackRegex) {
        setButtonsEnabled(false);
        log("==================================================");
        log(">>> Đang gỡ cài đặt: " + appLabel + " <<<");

        String usbDir = findUsbAppFolder();
        String pkg = resolvePackageName(usbDir, apkFileName, fallbackRegex);

        if (pkg.isEmpty()) {
            log("⚠ Không tìm thấy ứng dụng " + appLabel + " trên thiết bị!");
            setButtonsEnabled(true);
            return;
        }

        String res = runRootCommand("am force-stop " + pkg + " ; pm uninstall " + pkg + " 2>&1");
        if (res.contains("Success")) {
            log("✔ ĐÃ GỠ CÀI ĐẶT " + appLabel.toUpperCase() + " (" + pkg + ") THÀNH CÔNG!");
        } else {
            log("❌ Kết quả: " + res);
        }
        setButtonsEnabled(true);
    }

    private void log(String message) {
        // Bắn từng dòng trạng thái qua cáp USB về màn hình .bat trên máy tính
        for (String line : message.split("\n")) {
            if (!line.trim().isEmpty()) {
                android.util.Log.i("SGL_LOG", line);
            }
        }
        mainHandler.post(() -> tvLog.append(message + "\n"));
    }

    private void setButtonsEnabled(boolean enabled) {
        mainHandler.post(() -> {
            btnStage1NewBox.setEnabled(enabled);
            if (btnSyncOldBox != null) btnSyncOldBox.setEnabled(enabled);
            btnStage2Radio36.setEnabled(enabled);
            btnStage2Radio166.setEnabled(enabled);
            btnStage2Ics.setEnabled(enabled);
            btnUtilInstall.setEnabled(enabled);
            btnUtilUninstall.setEnabled(enabled);
            btnUtilDateTime.setEnabled(enabled);
            btnUtilSaveMk.setEnabled(enabled);
            if (btnDisableWifi4G != null) btnDisableWifi4G.setEnabled(enabled);
            btnUtilDeleteSelf.setEnabled(enabled);
        });
    }

    // =========================================================================
    // QUY TRÌNH TỰ ĐỘNG TẮT WIFI 2.4G TRÊN MODULE 4G (192.168.8.1)
    // =========================================================================
    private void runDisableSmartWifi4G() {
        setButtonsEnabled(false);
        log("==================================================");
        log(">>> BẮT ĐẦU QUY TRÌNH TỰ ĐỘNG TẮT WIFI MODULE 4G (192.168.8.1) <<<");
        log("[Bước 1/4] Đang kiểm tra kết nối tới trang quản trị " + SmartWifiHelper.DEFAULT_ROUTER_URL + " ...");

        boolean reachable = false;
        try {
            HttpURLConnection conn = (HttpURLConnection) new URL(SmartWifiHelper.DEFAULT_ROUTER_URL).openConnection();
            conn.setConnectTimeout(4000);
            conn.setReadTimeout(4000);
            conn.setRequestMethod("GET");
            int code = conn.getResponseCode();
            conn.disconnect();
            reachable = (code >= 200 && code < 500);
        } catch (Exception e) {
            log("   (Kiểm tra HTTP lỗi: " + e.getMessage() + ")");
        }

        if (!reachable) {
            String pingRes = runRootCommand("ping -c 1 -W 2 192.168.8.1 >/dev/null 2>&1 && echo 'OK'");
            reachable = "OK".equals(pingRes);
        }

        if (!reachable) {
            log("❌ Không kết nối được tới mạch 4G (192.168.8.1)! Hãy kiểm tra module 4G đã cắm vào mạch chưa.");
            setButtonsEnabled(true);
            return;
        }

        log("✔ Đã kết nối tới Smart Wifi System (192.168.8.1). Đang khởi chạy trình tự động tắt Wi-Fi...");
        mainHandler.post(this::showSmartWifiAutomationDialog);
    }

    @android.annotation.SuppressLint("SetJavaScriptEnabled")
    private void showSmartWifiAutomationDialog() {
        LinearLayout container = new LinearLayout(this);
        container.setOrientation(LinearLayout.VERTICAL);
        container.setPadding(16, 12, 16, 12);
        container.setBackgroundColor(Color.parseColor("#1E1E1E"));

        TextView tvStepStatus = new TextView(this);
        tvStepStatus.setText("⏳ Đang mở trang Smart Wifi System (192.168.8.1)...");
        tvStepStatus.setTextColor(Color.parseColor("#00E676"));
        tvStepStatus.setTextSize(TypedValue.COMPLEX_UNIT_SP, 15);
        tvStepStatus.setPadding(8, 4, 8, 10);
        container.addView(tvStepStatus);

        WebView webView = new WebView(this);
        int webHeightPx = (int) TypedValue.applyDimension(
                TypedValue.COMPLEX_UNIT_DIP, 380, getResources().getDisplayMetrics());
        LinearLayout.LayoutParams webParams = new LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT, webHeightPx);
        webView.setLayoutParams(webParams);

        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setUseWideViewPort(true);
        settings.setLoadWithOverviewMode(true);
        settings.setCacheMode(WebSettings.LOAD_NO_CACHE);

        try {
            CookieManager.getInstance().removeAllCookies(null);
            CookieManager.getInstance().setAcceptCookie(true);
        } catch (Exception ignored) {}

        webView.setWebViewClient(new WebViewClient());
        webView.setWebChromeClient(new WebChromeClient() {
            @Override
            public boolean onJsAlert(WebView view, String url, String message, JsResult result) {
                result.confirm();
                return true;
            }

            @Override
            public boolean onJsConfirm(WebView view, String url, String message, JsResult result) {
                result.confirm();
                return true;
            }
        });
        container.addView(webView);

        final boolean[] finished = {false};
        final long startTimeMs = System.currentTimeMillis();
        final long[] saveClickedTimeMs = {0L};
        final SmartWifiHelper.StepStatus[] lastLoggedStatus = {SmartWifiHelper.StepStatus.WAITING};

        AlertDialog dialog = new AlertDialog.Builder(this)
                .setTitle("TỰ ĐỘNG TẮT WIFI MODULE 4G (192.168.8.1)")
                .setView(container)
                .setCancelable(false)
                .setNegativeButton("Đóng / Dừng", (d, w) -> {
                    finished[0] = true;
                    try {
                        webView.stopLoading();
                        webView.destroy();
                    } catch (Exception ignored) {}
                    log("⚠ Đã đóng cửa sổ tự động tắt Wi-Fi 4G.");
                    setButtonsEnabled(true);
                })
                .create();

        dialog.show();
        webView.loadUrl(SmartWifiHelper.DEFAULT_ROUTER_URL);

        final String automationJs = SmartWifiHelper.buildAutomationJs(SmartWifiHelper.DEFAULT_ADMIN_PASSWORD);

        Runnable pollTask = new Runnable() {
            @Override
            public void run() {
                if (finished[0] || isFinishing()) {
                    return;
                }

                long elapsed = System.currentTimeMillis() - startTimeMs;
                if (elapsed > 28000L) {
                    finished[0] = true;
                    log("⚠ Hết thời gian chờ (28 giây) khi tự động tắt Wi-Fi 4G. Vui lòng kiểm tra lại.");
                    try {
                        if (dialog.isShowing()) dialog.dismiss();
                        webView.destroy();
                    } catch (Exception ignored) {}
                    setButtonsEnabled(true);
                    return;
                }

                if (saveClickedTimeMs[0] > 0L && (System.currentTimeMillis() - saveClickedTimeMs[0] >= 3200L)) {
                    completeSuccess(dialog, webView, finished);
                    return;
                }

                webView.evaluateJavascript(automationJs, rawResult -> {
                    if (finished[0]) return;
                    SmartWifiHelper.StepStatus status = SmartWifiHelper.parseStepStatus(rawResult);

                    if (status != SmartWifiHelper.StepStatus.WAITING && status != lastLoggedStatus[0]) {
                        lastLoggedStatus[0] = status;
                        switch (status) {
                            case LOGIN_SUBMITTED:
                                tvStepStatus.setText("[Bước 2/4] 🔑 Đã nhập mật khẩu admin và bấm Login...");
                                log("[Bước 2/4] 🔑 Đã tự động nhập mật khẩu admin và bấm Login...");
                                break;
                            case OPENING_WIFI_MENU:
                                tvStepStatus.setText("[Bước 3/4] 📂 Đang mở menu WiFi Settings...");
                                log("[Bước 3/4] 📂 Đang mở menu WiFi Settings...");
                                break;
                            case OPENING_24G_MENU:
                                tvStepStatus.setText("[Bước 3/4] 📂 Đang mở mục 2.4G WiFi Settings...");
                                log("   -> Đang mở mục 2.4G WiFi Settings...");
                                break;
                            case UNCHECKED_ENABLE_WIFI:
                                tvStepStatus.setText("[Bước 4/4] ✔ Đã bỏ tích 'Enable Wi-Fi', chuẩn bị bấm Save...");
                                log("   -> Đã bỏ tích 'Enable Wi-Fi' (Tắt sóng Wi-Fi 2.4G)...");
                                break;
                            case CLICKED_SAVE:
                                saveClickedTimeMs[0] = System.currentTimeMillis();
                                tvStepStatus.setText("[Bước 4/4] 💾 Đã bấm Save! Đang lưu cấu hình vào module 4G...");
                                log("[Bước 4/4] 💾 Đã bấm Save! Đang đợi module 4G lưu cấu hình...");
                                break;
                            default:
                                break;
                        }
                    }

                    if (SmartWifiHelper.isTerminalSuccess(status)) {
                        completeSuccess(dialog, webView, finished);
                    } else if (!finished[0]) {
                        mainHandler.postDelayed(this, 600);
                    }
                });
            }
        };

        mainHandler.postDelayed(pollTask, 800);
    }

    private void completeSuccess(AlertDialog dialog, WebView webView, boolean[] finished) {
        if (finished[0]) return;
        finished[0] = true;
        log("🎉 ĐÃ TẮT WIFI 2.4G TRÊN MODULE 4G (192.168.8.1) THÀNH CÔNG!");
        log("ℹ Lưu ý: Module 4G sẽ tự khởi động lại mạng trong khoảng 10-15 giây.");
        mainHandler.postDelayed(() -> {
            try {
                if (dialog.isShowing()) dialog.dismiss();
                webView.stopLoading();
                webView.destroy();
            } catch (Exception ignored) {}
            setButtonsEnabled(true);
        }, 900);
    }

    private String readFormattedMacAddress() {
        String mac = DeviceInfo.getMac();
        if (mac != null && !mac.isEmpty() && !"UNKNOWN".equals(mac)) {
            return mac;
        }
        String rawMac = runRootCommand(
                "(cat /sys/class/net/eth0/address 2>/dev/null || " +
                        "cat /sys/class/net/wlan0/address 2>/dev/null) | head -n 1"
        );
        if (rawMac == null) return "";
        return rawMac.trim().toUpperCase().replace(":", "").replaceAll("[^A-F0-9]", "");
    }

    private String runRootCommand(String command) {
        StringBuilder output = new StringBuilder();
        try {
            Process process = Runtime.getRuntime().exec("su");
            DataOutputStream os = new DataOutputStream(process.getOutputStream());
            os.writeBytes("if command -v nsenter >/dev/null 2>&1; then\n");
            os.writeBytes("  nsenter -t 1 -m -- /system/bin/sh << 'EOF_SGL_CMD'\n");
            os.writeBytes(command + "\n");
            os.writeBytes("EOF_SGL_CMD\n");
            os.writeBytes("  if [ $? -ne 0 ]; then\n");
            os.writeBytes("    /system/bin/sh << 'EOF_SGL_CMD_FB'\n");
            os.writeBytes(command + "\n");
            os.writeBytes("EOF_SGL_CMD_FB\n");
            os.writeBytes("  fi\n");
            os.writeBytes("else\n");
            os.writeBytes(command + "\n");
            os.writeBytes("fi\n");
            os.writeBytes("exit\n");
            os.flush();

            BufferedReader reader = new BufferedReader(new InputStreamReader(process.getInputStream()));
            String line;
            while ((line = reader.readLine()) != null) {
                output.append(line).append("\n");
            }
            process.waitFor();
        } catch (Exception e) {
            log("Lỗi quyền Root: " + e.getMessage());
        }
        return output.toString().trim();
    }

    private void bringAutoSetupToFront() {
        runRootCommand("am start --activity-single-top -n com.sgl.autosetup/.MainActivity >/dev/null 2>&1");
    }

    private String findUsbAppFolder() {
        String cmd = "for p in /sdcard/SGL_Backup_Apks /mnt/media_rw/* /storage/* /mnt/usb_storage/*; do " +
                "  if [ -d \"$p/App box\" ]; then echo \"$p/App box\"; break; fi; " +
                "  if [ -f \"$p/" + APK_ANYDESK + "\" ] || [ -f \"$p/" + APK_RADIO_36 + "\" ] || [ -f \"$p/" + APK_RADIO_166 + "\" ] || [ -f \"$p/" + APK_ICS + "\" ]; then echo \"$p\"; break; fi; " +
                "done 2>/dev/null";
        return runRootCommand(cmd);
    }

    private String resolvePackageName(String usbDir, String apkFileName, String fallbackRegex) {
        if (APK_ICS.equals(apkFileName)) {
            String checkIcs = runRootCommand("pm list packages " + ICS_PACKAGE_NAME + " 2>/dev/null");
            if (!checkIcs.isEmpty()) return ICS_PACKAGE_NAME;
        }
        String checkSource = !usbDir.isEmpty() ? (usbDir + "/" + apkFileName) : (LOCAL_BACKUP_DIR + "/" + apkFileName);
        String copyRes = runRootCommand(
                "if [ -f \"" + checkSource + "\" ]; then " +
                        "  cp \"" + checkSource + "\" /data/local/tmp/probe.apk && chmod 644 /data/local/tmp/probe.apk && echo 'COPIED'; " +
                        "fi"
        );
        if ("COPIED".equals(copyRes)) {
            try {
                PackageManager pm = getPackageManager();
                PackageInfo info = pm.getPackageArchiveInfo("/data/local/tmp/probe.apk", 0);
                runRootCommand("rm -f /data/local/tmp/probe.apk");
                if (info != null && info.packageName != null) {
                    return info.packageName;
                }
            } catch (Exception ignored) {
                runRootCommand("rm -f /data/local/tmp/probe.apk");
            }
        }
        String cmd = "pm list packages -3 2>/dev/null | cut -d':' -f2 | " +
                "grep -vE '^com\\.(sgl\\.autosetup|anydesk\\.)' | " +
                "grep -iE '" + fallbackRegex + "' | head -n 1";
        return runRootCommand(cmd);
    }

    private String getWebhookUrl(String usbDir) {
        String webhookUrl = GOOGLE_SHEET_WEBHOOK_URL;
        if (!usbDir.isEmpty()) {
            String urlFromUsb = runRootCommand("if [ -f \"" + usbDir + "/sheet_url.txt\" ]; then head -n 1 \"" + usbDir + "/sheet_url.txt\" | tr -d '\\r\\n '; fi");
            if (urlFromUsb.startsWith("https://script.google.com")) {
                webhookUrl = urlFromUsb;
            }
        }
        return webhookUrl;
    }

    private String findAnydeskConfDir() {
        String cmd =
                "for base in " +
                        "  /data_mirror/data_de/null/0/com.anydesk.anydeskandroid " +
                        "  /data_mirror/data_ce/null/0/com.anydesk.anydeskandroid " +
                        "  /data/user_de/0/com.anydesk.anydeskandroid " +
                        "  /data/user/0/com.anydesk.anydeskandroid " +
                        "  /data/data/com.anydesk.anydeskandroid; do " +
                        "  for sub in files/.anydesk files; do " +
                        "    d=\"$base/$sub\"; " +
                        "    if [ -f \"$d/system.conf\" ] || [ -f \"$d/service.conf\" ] || [ -f \"$d/user.conf\" ]; then " +
                        "      echo \"$d\"; exit 0; " +
                        "    fi; " +
                        "  done; " +
                        "done 2>/dev/null";
        return runRootCommand(cmd);
    }

    private String readAnydeskId() {
        return DeviceInfo.getAnydeskId();
    }

    private void autoLoginRadioStation(String radioPkg, String user, String pass) {
        if (radioPkg == null || radioPkg.isEmpty()) {
            radioPkg = "vn.phitn.app.radiostation";
        }
        String loginCmd =
                "PASS_MD5=$(printf '%s' '" + pass + "' | md5sum | cut -d' ' -f1) ; " +
                "for pkg in " + radioPkg + " vn.phitn.app.radiostation com.radiostation; do " +
                "  am force-stop $pkg 2>/dev/null ; " +
                "  for base in /data_mirror/data_ce/null/0/$pkg /data/user/0/$pkg /data/data/$pkg; do " +
                "    if [ -d \"$base\" ]; then " +
                "      mkdir -p \"$base/shared_prefs\" 2>/dev/null ; " +
                "      printf '<?xml version=\"1.0\" encoding=\"utf-8\" standalone=\"yes\" ?>\\n<map>\\n    <string name=\"user_info\">{&quot;username&quot;:&quot;%s&quot;,&quot;password&quot;:&quot;%s&quot;}</string>\\n</map>\\n' '" + user + "' \"$PASS_MD5\" > \"$base/shared_prefs/${pkg}_preferences.xml\" ; " +
                "      OWNER=$(stat -c '%u:%g' \"$base\" 2>/dev/null) ; " +
                "      if [ -n \"$OWNER\" ]; then chown -R $OWNER \"$base/shared_prefs\" 2>/dev/null; fi ; " +
                "      chmod 660 \"$base/shared_prefs/\"*.xml 2>/dev/null ; " +
                "    fi ; " +
                "  done ; " +
                "done ; " +
                "monkey -p " + radioPkg + " -c android.intent.category.LAUNCHER 1 >/dev/null 2>&1 || " +
                "monkey -p vn.phitn.app.radiostation -c android.intent.category.LAUNCHER 1 >/dev/null 2>&1";
        runRootCommand(loginCmd);
    }

    private void waitForAudioAndExit() {
        for (int i = 1; i <= 10; i++) {
            try { Thread.sleep(1000); } catch (InterruptedException ignored) {}
            if (i >= 5) {
                String audioActive = runRootCommand(
                        "if dumpsys audio 2>/dev/null | grep -qiE 'state:started|PLAYER_STATE_STARTED'; then echo 'PLAYING'; fi"
                );
                if ("PLAYING".equals(audioActive) || i >= 6) {
                    break;
                }
            }
        }
        runRootCommand("input keyevent 3");
    }

    private void saveAnydeskTemplateToUsb() {
        setButtonsEnabled(false);
        log("--------------------------------------------------");
        log("⏳ Đang trích xuất cấu hình mật khẩu AnyDesk vào USB...");

        String usbDir = findUsbAppFolder();
        if (usbDir.isEmpty()) {
            log("❌ Không tìm thấy thư mục bộ cài trên USB!");
            setButtonsEnabled(true);
            return;
        }

        String confDir = findAnydeskConfDir();
        if (confDir.isEmpty()) {
            log("❌ Không tìm thấy thư mục .anydesk! Hãy mở AnyDesk lên trước rồi thử lại.");
            setButtonsEnabled(true);
            return;
        }

        runRootCommand("sync");
        runRootCommand("am force-stop com.anydesk.anydeskandroid");
        try { Thread.sleep(800); } catch (InterruptedException ignored) {}

        String saveCmd =
                "rm -rf \"" + usbDir + "/anydesk_config\" ; " +
                        "mkdir -p \"" + usbDir + "/anydesk_config/shared_prefs\" ; " +
                        "for base in " +
                        "  /data_mirror/data_de/null/0/com.anydesk.anydeskandroid " +
                        "  /data_mirror/data_ce/null/0/com.anydesk.anydeskandroid " +
                        "  /data/user_de/0/com.anydesk.anydeskandroid " +
                        "  /data/user/0/com.anydesk.anydeskandroid " +
                        "  /data/data/com.anydesk.anydeskandroid; do " +
                        "  d=\"$base/files/.anydesk\"; " +
                        "  if [ -d \"$d\" ]; then " +
                        "    for f in service.conf system.conf user.conf; do " +
                        "      if [ -s \"$d/$f\" ] && [ ! -s \"" + usbDir + "/anydesk_config/$f\" ]; then " +
                        "        grep -vE '^ad\\.anynet\\.(id|cert|pkey|alias|register)' \"$d/$f\" > \"" + usbDir + "/anydesk_config/$f\" 2>/dev/null || true ; " +
                        "      fi ; " +
                        "    done ; " +
                        "  fi ; " +
                        "  if [ -d \"$base/shared_prefs\" ]; then " +
                        "    cp -f \"$base/shared_prefs/\"*.xml \"" + usbDir + "/anydesk_config/shared_prefs/\" 2>/dev/null || true ; " +
                        "  fi ; " +
                        "done ; " +
                        "sync";
        runRootCommand(saveCmd);

        String verifyFiles = runRootCommand("ls -la \"" + usbDir + "/anydesk_config/\" 2>&1");
        log("✔ ĐÃ LƯU MẪU MẬT KHẨU ANYDESK VÀO USB:\n" + verifyFiles);
        runRootCommand("monkey -p com.anydesk.anydeskandroid -c android.intent.category.LAUNCHER 1 >/dev/null 2>&1");
        try { Thread.sleep(1500); } catch (InterruptedException ignored) {}
        bringAutoSetupToFront();
        setButtonsEnabled(true);
    }
}