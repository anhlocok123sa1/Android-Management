package com.sgl.autosetup;

import android.content.Context;
import android.content.SharedPreferences;
import android.util.Log;
import org.json.JSONArray;
import org.json.JSONObject;
import java.io.BufferedReader;
import java.io.DataOutputStream;
import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.util.concurrent.TimeUnit;
import okhttp3.OkHttpClient;
import okhttp3.Request;
import okhttp3.Response;

public class TaskExecutor {

    private static final String PREFS_NAME = "sgl_agent_prefs";

    // -------------------------------------------------------------------------
    // Public entry point
    // -------------------------------------------------------------------------
    public ExecutionResult execute(Context context, String taskId, String templateName,
                                   String stepsJson, String mac, WebhookClient webhookClient) {
        ExecutionResult result = new ExecutionResult();
        StringBuilder log = new StringBuilder();

        try {
            JSONArray steps = new JSONArray(stepsJson);
            SharedPreferences prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
            String checkpointKey = "checkpoint_" + taskId;
            int startFrom = prefs.getInt(checkpointKey, 0);

            log.append("Task: ").append(templateName).append(" (").append(taskId).append(")\n");
            log.append("Steps: ").append(steps.length()).append(", resuming from: ").append(startFrom).append("\n");

            for (int i = startFrom; i < steps.length(); i++) {
                JSONObject step = steps.getJSONObject(i);
                String action = step.getString("action");
                JSONObject params = step.optJSONObject("params");
                if (params == null) params = new JSONObject();

                log.append("[Step ").append(i + 1).append("/").append(steps.length())
                   .append("] action=").append(action).append("\n");
                Log.i(Constants.TAG, "Executing step " + (i + 1) + ": " + action);

                boolean stepOk = false;
                String stepOutput = "";

                try {
                    switch (action) {
                        case "download_apk":
                            stepOutput = executeDownloadApk(params);
                            stepOk = !stepOutput.startsWith("ERROR");
                            break;
                        case "install_apk":
                            stepOutput = executeInstallApk(params);
                            stepOk = stepOutput.contains("Success");
                            break;
                        case "uninstall_pkg":
                            stepOutput = executeUninstallPkg(params);
                            stepOk = true; // best-effort
                            break;
                        case "report_field":
                            stepOutput = executeReportField(params, mac, taskId, webhookClient);
                            stepOk = true; // best-effort
                            break;
                        case "shell_cmd":
                        case "exec_cmd":
                            stepOutput = executeShellCmd(params);
                            stepOk = true; // best-effort
                            break;
                        case "start_app":
                            stepOutput = executeStartApp(params);
                            stepOk = !stepOutput.startsWith("ERROR");
                            break;
                        case "extract_ics_mac":
                            stepOutput = executeExtractIcsMac(params);
                            stepOk = !stepOutput.startsWith("ERROR");
                            break;
                        case "fetch_config":
                            stepOutput = "Fetched config for " + params.optString("sheet", "Config_Radio20") + " (best-effort)";
                            stepOk = true;
                            break;
                        default:
                            stepOutput = "Unknown action: " + action;
                            stepOk = false;
                    }
                } catch (Exception e) {
                    stepOutput = "Exception: " + e.getMessage();
                    stepOk = false;
                    Log.e(Constants.TAG, "Step " + (i + 1) + " exception", e);
                }

                log.append("  → ").append(stepOutput).append("\n");

                if (!stepOk) {
                    result.success = false;
                    result.failedStep = action + " (step " + (i + 1) + ")";
                    result.error = stepOutput;
                    result.result = log.toString();
                    return result;
                }

                // Save checkpoint after each successful step
                prefs.edit().putInt(checkpointKey, i + 1).apply();
            }

            // All steps done — clear checkpoint
            prefs.edit().remove(checkpointKey).apply();
            result.success = true;
            result.result = log.toString();

        } catch (Exception e) {
            result.success = false;
            result.error = "Parse/setup error: " + e.getMessage();
            result.result = log.toString();
            Log.e(Constants.TAG, "execute() error", e);
        }

        return result;
    }

    private static boolean isSafePackageOrComponent(String val) {
        return val != null && !val.isEmpty() && val.matches("^[a-zA-Z0-9_.$/]+$") && !val.contains("..");
    }

    private static String sanitizeApkFileName(String rawName) {
        if (rawName == null) return "";
        String baseName = new File(rawName.trim()).getName();
        if (!baseName.matches("^[a-zA-Z0-9._\\- ()]+\\.apk$")) {
            return "";
        }
        return baseName;
    }

    // -------------------------------------------------------------------------
    // Action: download_apk
    // -------------------------------------------------------------------------
    private String executeDownloadApk(JSONObject params) throws Exception {
        String url = params.getString("url").trim();
        String saveAs = sanitizeApkFileName(params.getString("save_as"));
        if (saveAs.isEmpty()) {
            return "ERROR: Invalid or unsafe APK filename";
        }
        if (!url.startsWith("https://") && !url.startsWith("http://")) {
            return "ERROR: Invalid download URL scheme";
        }

        // Ensure directory exists
        File dir = new File(Constants.LOCAL_TASK_DIR);
        if (!dir.exists()) {
            dir.mkdirs();
        }

        File destFile = new File(dir, saveAs);

        OkHttpClient dlClient = new OkHttpClient.Builder()
                .connectTimeout(30, TimeUnit.SECONDS)
                .readTimeout(120, TimeUnit.SECONDS)
                .followRedirects(true)
                .build();

        int lastError = 0;
        for (int attempt = 1; attempt <= Constants.MAX_RETRY; attempt++) {
            try {
                Request request = new Request.Builder().url(url).get().build();
                try (Response response = dlClient.newCall(request).execute()) {
                    if (!response.isSuccessful()) {
                        lastError = response.code();
                        Log.w(Constants.TAG, "download attempt " + attempt + " HTTP " + lastError);
                        continue;
                    }
                    if (response.body() == null) {
                        Log.w(Constants.TAG, "download attempt " + attempt + " empty body");
                        continue;
                    }
                    try (InputStream is = response.body().byteStream();
                         FileOutputStream fos = new FileOutputStream(destFile)) {
                        byte[] buf = new byte[8192];
                        int len;
                        while ((len = is.read(buf)) != -1) {
                            fos.write(buf, 0, len);
                        }
                        fos.flush();
                    }
                }
                // Verify
                if (destFile.exists() && destFile.length() > 0) {
                    return "Downloaded " + saveAs + " (" + destFile.length() + " bytes)";
                } else {
                    Log.w(Constants.TAG, "download attempt " + attempt + " zero-size file");
                }
            } catch (IOException e) {
                Log.w(Constants.TAG, "download attempt " + attempt + " IOException: " + e.getMessage());
            }
        }
        return "ERROR: download failed after " + Constants.MAX_RETRY + " attempts (last HTTP " + lastError + ")";
    }

    // -------------------------------------------------------------------------
    // Action: install_apk
    // -------------------------------------------------------------------------
    private String executeInstallApk(JSONObject params) throws Exception {
        String file = sanitizeApkFileName(params.getString("file"));
        if (file.isEmpty()) {
            return "ERROR: Invalid or unsafe APK filename";
        }
        File srcFile = new File(Constants.LOCAL_TASK_DIR, file);
        if (!srcFile.exists()) {
            srcFile = new File("/sdcard/SGL_Backup_Apks", file);
        }
        if (!srcFile.exists()) {
            return "ERROR: APK file not found in SGL_Tasks or SGL_Backup_Apks: " + file;
        }
        String cmd = "cp \"" + srcFile.getAbsolutePath() + "\" /data/local/tmp/sgl_task_install.apk && "
                + "chmod 644 /data/local/tmp/sgl_task_install.apk && "
                + "pm install -r -g /data/local/tmp/sgl_task_install.apk 2>&1 ; "
                + "rm -f /data/local/tmp/sgl_task_install.apk";
        return runRootCommand(cmd);
    }

    // -------------------------------------------------------------------------
    // Action: uninstall_pkg
    // -------------------------------------------------------------------------
    private String executeUninstallPkg(JSONObject params) throws Exception {
        String pkg = params.getString("package").trim();
        if (!isSafePackageOrComponent(pkg)) {
            return "ERROR: Invalid package name: " + pkg;
        }
        String cmd;
        if ("com.radiostation".equals(pkg) || "vn.phitn.app.radiostation".equals(pkg)) {
            cmd = "am force-stop vn.phitn.app.radiostation ; pm uninstall vn.phitn.app.radiostation ; am force-stop com.radiostation ; pm uninstall com.radiostation";
        } else {
            cmd = "am force-stop " + pkg + " ; pm uninstall " + pkg;
        }
        return runRootCommand(cmd);
    }

    // -------------------------------------------------------------------------
    // Action: report_field
    // -------------------------------------------------------------------------
    private String executeReportField(JSONObject params, String mac, String taskId,
                                      WebhookClient webhookClient) {
        String field = params.optString("field", "").trim();
        String value = params.optString("value", "").trim();
        return field + "=" + value;
    }

    // -------------------------------------------------------------------------
    // Action: shell_cmd / exec_cmd
    // -------------------------------------------------------------------------
    private String executeShellCmd(JSONObject params) throws Exception {
        String cmd = params.optString("cmd", params.optString("command", ""));
        if (cmd.isEmpty()) return "Empty command";
        return runRootCommand(cmd);
    }

    // -------------------------------------------------------------------------
    // Action: start_app
    // -------------------------------------------------------------------------
    private String executeStartApp(JSONObject params) {
        String pkg = params.optString("package", "").trim();
        String fallbackPkg = params.optString("fallback_package", "").trim();
        String activity = params.optString("activity", "").trim();
        if (pkg.isEmpty() || !isSafePackageOrComponent(pkg)) return "ERROR: Invalid or missing package name";
        if (!fallbackPkg.isEmpty() && !isSafePackageOrComponent(fallbackPkg)) return "ERROR: Invalid fallback package";
        if (!activity.isEmpty() && !isSafePackageOrComponent(activity)) return "ERROR: Invalid activity name";
        String cmd;
        if (!activity.isEmpty()) {
            cmd = "am start -n " + pkg + "/" + activity + " >/dev/null 2>&1 || monkey -p " + pkg + " -c android.intent.category.LAUNCHER 1 >/dev/null 2>&1 || monkey -p com.app.ics_content_management -c android.intent.category.LAUNCHER 1 >/dev/null 2>&1";
        } else {
            cmd = "monkey -p " + pkg + " -c android.intent.category.LAUNCHER 1 >/dev/null 2>&1 || monkey -p com.app.ics_content_management -c android.intent.category.LAUNCHER 1 >/dev/null 2>&1";
        }
        if (!fallbackPkg.isEmpty()) {
            cmd += " || monkey -p " + fallbackPkg + " -c android.intent.category.LAUNCHER 1 >/dev/null 2>&1";
        }
        runRootCommand(cmd);
        return "Started app: " + pkg;
    }

    // -------------------------------------------------------------------------
    // Action: extract_ics_mac
    // -------------------------------------------------------------------------
    private String executeExtractIcsMac(JSONObject params) {
        String pkg = params.optString("package", "com.app.ics_content_management").trim();
        String fallbackPkg = params.optString("fallback_package", "vnpt.smartcomm.radio").trim();
        if (!isSafePackageOrComponent(pkg)) pkg = "com.app.ics_content_management";
        if (!isSafePackageOrComponent(fallbackPkg)) fallbackPkg = "vnpt.smartcomm.radio";
        runRootCommand("monkey -p " + pkg + " -c android.intent.category.LAUNCHER 1 >/dev/null 2>&1 || monkey -p " + fallbackPkg + " -c android.intent.category.LAUNCHER 1 >/dev/null 2>&1");

        String icsCode = "";
        for (int attempt = 1; attempt <= 2; attempt++) {
            try {
                Thread.sleep(attempt == 1 ? 5000 : 2500);
            } catch (InterruptedException ignored) {}

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
            if (!icsCode.isEmpty() && !icsCode.startsWith("ERROR")) {
                break;
            }
        }

        if (icsCode.isEmpty() || icsCode.startsWith("ERROR")) {
            return "ERROR: Could not extract ICS MAC from UI";
        }
        return "mac_ics=" + icsCode;
    }

    // -------------------------------------------------------------------------
    // Root command helper — same pattern as MainActivity
    // -------------------------------------------------------------------------
    private String runRootCommand(String cmd) {
        StringBuilder output = new StringBuilder();
        try {
            Process process = Runtime.getRuntime().exec("su");
            DataOutputStream os = new DataOutputStream(process.getOutputStream());
            os.writeBytes("if command -v nsenter >/dev/null 2>&1; then\n");
            os.writeBytes("  nsenter -t 1 -m -- /system/bin/sh << 'EOF_SGL_CMD'\n");
            os.writeBytes(cmd + "\n");
            os.writeBytes("EOF_SGL_CMD\n");
            os.writeBytes("else\n");
            os.writeBytes(cmd + "\n");
            os.writeBytes("fi\n");
            os.writeBytes("exit\n");
            os.flush();

            BufferedReader stdout = new BufferedReader(new InputStreamReader(process.getInputStream()));
            BufferedReader stderr = new BufferedReader(new InputStreamReader(process.getErrorStream()));
            String line;
            while ((line = stdout.readLine()) != null) {
                output.append(line).append("\n");
            }
            while ((line = stderr.readLine()) != null) {
                output.append(line).append("\n");
            }
            process.waitFor(60, TimeUnit.SECONDS);
        } catch (Exception e) {
            output.append("ERROR: ").append(e.getMessage());
            Log.e(Constants.TAG, "runRootCommand error: " + cmd, e);
        }
        return output.toString().trim();
    }

    // -------------------------------------------------------------------------
    // Result
    // -------------------------------------------------------------------------
    public static class ExecutionResult {
        public boolean success;
        public String failedStep;
        public String error;
        public String result; // log tổng hợp
    }
}
