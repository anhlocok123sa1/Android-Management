package com.sgl.autosetup;

import android.content.Context;
import android.content.SharedPreferences;
import android.util.Log;
import org.json.JSONArray;
import org.json.JSONObject;
import java.io.BufferedReader;
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
                            stepOutput = executeShellCmd(params);
                            stepOk = true; // best-effort
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

    // -------------------------------------------------------------------------
    // Action: download_apk
    // -------------------------------------------------------------------------
    private String executeDownloadApk(JSONObject params) throws Exception {
        String url = params.getString("url");
        String saveAs = params.getString("save_as");

        // Ensure directory exists
        File dir = new File(Constants.LOCAL_TASK_DIR);
        if (!dir.exists()) {
            dir.mkdirs();
        }

        File destFile = new File(Constants.LOCAL_TASK_DIR + saveAs);

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
        String file = params.getString("file");
        String apkPath = Constants.LOCAL_TASK_DIR + file;
        String cmd = "pm install -r -g " + apkPath;
        return runRootCommand(cmd);
    }

    // -------------------------------------------------------------------------
    // Action: uninstall_pkg
    // -------------------------------------------------------------------------
    private String executeUninstallPkg(JSONObject params) throws Exception {
        String pkg = params.getString("package");
        String cmd = "am force-stop " + pkg + " ; pm uninstall " + pkg;
        return runRootCommand(cmd);
    }

    // -------------------------------------------------------------------------
    // Action: report_field
    // -------------------------------------------------------------------------
    private String executeReportField(JSONObject params, String mac, String taskId,
                                      WebhookClient webhookClient) {
        try {
            String field = params.getString("field");
            String value = params.getString("value");
            // Report as a complete_task with structured result containing field info
            webhookClient.completeTask(mac, taskId + "_field_" + field,
                    field + "=" + value, true);
            return "Reported field " + field + "=" + value;
        } catch (Exception e) {
            return "report_field error: " + e.getMessage();
        }
    }

    // -------------------------------------------------------------------------
    // Action: shell_cmd
    // -------------------------------------------------------------------------
    private String executeShellCmd(JSONObject params) throws Exception {
        String cmd = params.getString("cmd");
        return runRootCommand(cmd);
    }

    // -------------------------------------------------------------------------
    // Root command helper — same pattern as MainActivity
    // -------------------------------------------------------------------------
    private String runRootCommand(String cmd) {
        StringBuilder output = new StringBuilder();
        try {
            Process process = Runtime.getRuntime().exec(new String[]{"su", "-c", cmd});
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
