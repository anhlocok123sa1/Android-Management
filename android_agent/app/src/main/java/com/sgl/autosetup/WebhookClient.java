package com.sgl.autosetup;

import android.util.Log;
import org.json.JSONArray;
import org.json.JSONObject;
import java.util.concurrent.TimeUnit;
import okhttp3.MediaType;
import okhttp3.OkHttpClient;
import okhttp3.Request;
import okhttp3.RequestBody;
import okhttp3.Response;

public class WebhookClient {

    private static final MediaType JSON = MediaType.get("application/json; charset=utf-8");

    private final OkHttpClient client;
    private final String webhookUrl;

    public WebhookClient(String webhookUrl) {
        this.webhookUrl = webhookUrl;
        this.client = new OkHttpClient.Builder()
                .connectTimeout(15, TimeUnit.SECONDS)
                .readTimeout(30, TimeUnit.SECONDS)
                .followRedirects(true)
                .followSslRedirects(true)
                .build();
    }

    /**
     * Gửi heartbeat, trả về JSON string của pending_task (hoặc null nếu không có)
     */
    public String heartbeat(String mac, String anydeskId, long ramMb, long storageMb,
                            String currentTask, String appVersion, String ip) {
        try {
            JSONObject payload = new JSONObject();
            payload.put("action", "heartbeat");
            payload.put("mac", mac);
            payload.put("anydesk_id", anydeskId);
            payload.put("ram_mb", ramMb);
            payload.put("storage_mb", storageMb);
            payload.put("current_task", currentTask);
            payload.put("app_version", appVersion);
            payload.put("ip", ip);

            String responseBody = post(payload.toString());
            if (responseBody == null) return null;

            JSONObject resp = new JSONObject(responseBody);
            if (resp.has("pending_task") && !resp.isNull("pending_task")) {
                return resp.getJSONObject("pending_task").toString();
            }
            return null;
        } catch (Exception e) {
            Log.e(Constants.TAG, "heartbeat error: " + e.getMessage(), e);
            return null;
        }
    }

    /**
     * Claim task, trả về true nếu thành công
     */
    public boolean claimTask(String mac, String taskId) {
        try {
            JSONObject payload = new JSONObject();
            payload.put("action", "claim_task");
            payload.put("mac", mac);
            payload.put("task_id", taskId);

            String responseBody = post(payload.toString());
            if (responseBody == null) return false;

            JSONObject resp = new JSONObject(responseBody);
            return "ok".equalsIgnoreCase(resp.optString("status", ""));
        } catch (Exception e) {
            Log.e(Constants.TAG, "claimTask error: " + e.getMessage(), e);
            return false;
        }
    }

    /**
     * Báo cáo task hoàn thành
     */
    public void completeTask(String mac, String taskId, String result, boolean success) {
        try {
            JSONObject payload = new JSONObject();
            payload.put("action", "complete_task");
            payload.put("mac", mac);
            payload.put("task_id", taskId);
            payload.put("result", result);
            payload.put("success", success);

            post(payload.toString());
        } catch (Exception e) {
            Log.e(Constants.TAG, "completeTask error: " + e.getMessage(), e);
        }
    }

    /**
     * Đăng ký thiết bị mới
     */
    public void registerDevice(String mac, String anydeskId) {
        try {
            JSONObject payload = new JSONObject();
            payload.put("action", "register_device");
            payload.put("mac", mac);
            payload.put("anydesk_id", anydeskId);

            post(payload.toString());
        } catch (Exception e) {
            Log.e(Constants.TAG, "registerDevice error: " + e.getMessage(), e);
        }
    }

    /**
     * Lấy danh sách devices (cho PC App, không dùng trong agent)
     */
    public String getDevices() {
        try {
            JSONObject payload = new JSONObject();
            payload.put("action", "get_devices");
            return post(payload.toString());
        } catch (Exception e) {
            Log.e(Constants.TAG, "getDevices error: " + e.getMessage(), e);
            return null;
        }
    }

    /**
     * Lấy templates
     */
    public String getTemplates() {
        try {
            JSONObject payload = new JSONObject();
            payload.put("action", "get_templates");
            return post(payload.toString());
        } catch (Exception e) {
            Log.e(Constants.TAG, "getTemplates error: " + e.getMessage(), e);
            return null;
        }
    }

    /**
     * Tạo task mới (cho PC App)
     */
    public String createTask(String templateName, String[] targetMacs) {
        try {
            JSONObject payload = new JSONObject();
            payload.put("action", "create_task");
            payload.put("template_name", templateName);
            JSONArray macsArray = new JSONArray();
            for (String m : targetMacs) macsArray.put(m);
            payload.put("target_macs", macsArray);
            return post(payload.toString());
        } catch (Exception e) {
            Log.e(Constants.TAG, "createTask error: " + e.getMessage(), e);
            return null;
        }
    }

    /**
     * Lưu template
     */
    public boolean saveTemplate(String name, String stepsJson, String description) {
        try {
            JSONObject payload = new JSONObject();
            payload.put("action", "save_template");
            payload.put("name", name);
            payload.put("steps_json", stepsJson);
            payload.put("description", description);

            String responseBody = post(payload.toString());
            if (responseBody == null) return false;

            JSONObject resp = new JSONObject(responseBody);
            return "ok".equalsIgnoreCase(resp.optString("status", ""));
        } catch (Exception e) {
            Log.e(Constants.TAG, "saveTemplate error: " + e.getMessage(), e);
            return false;
        }
    }

    // -------------------------------------------------------------------------
    // Internal helper
    // -------------------------------------------------------------------------
    private String post(String jsonBody) {
        try {
            RequestBody body = RequestBody.create(jsonBody, JSON);
            Request request = new Request.Builder()
                    .url(webhookUrl)
                    .post(body)
                    .build();
            try (Response response = client.newCall(request).execute()) {
                if (response.body() != null) {
                    return response.body().string();
                }
                return null;
            }
        } catch (Exception e) {
            Log.e(Constants.TAG, "HTTP POST error: " + e.getMessage(), e);
            return null;
        }
    }
}
