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
        return heartbeat(mac, anydeskId, ramMb, storageMb, currentTask, appVersion, ip, "", "");
    }

    public String heartbeat(String mac, String anydeskId, long ramMb, long storageMb,
                            String currentTask, String appVersion, String ip,
                            String software, String macIcs) {
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
            if (software != null && !software.isEmpty()) {
                payload.put("software", software);
            }
            if (macIcs != null && !macIcs.isEmpty()) {
                payload.put("mac_ics", macIcs);
            }

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

    public static class SyncBoxResult {
        public boolean success;
        public boolean matchedByAnydesk;
        public String project;
        public String software;
        public String message;
    }

    /**
     * Tự động tìm mã AnyDesk của Box cũ trên Google Sheet theo từng dự án,
     * đồng bộ MAC thật, phần mềm đang sử dụng (Radio 3.6 / 1.66 / 2.0 / VNPT ICS) và trạng thái Online.
     */
    public SyncBoxResult syncOldBoxByAnydesk(String mac, String anydeskId, String detectedSoftware,
                                             String macIcs, String appVersion, long storageMb,
                                             long ramMb, String ip) {
        SyncBoxResult res = new SyncBoxResult();
        res.project = "Kho thiết bị";
        res.software = (detectedSoftware != null && !detectedSoftware.isEmpty()) ? detectedSoftware : "Radio 3.6";
        String cleanAd = anydeskId != null ? anydeskId.replaceAll("[\\s\\-]", "").trim() : "";

        try {
            // Chỉ gửi 1 request register_device duy nhất (~250 bytes) để tiết kiệm tối đa dung lượng SIM 4G.
            // Server (Code.gs) tự động quét Sheet dự án, khớp mã AnyDesk / CHUA_MAC, điền MAC thật và trả về tên Dự án.
            JSONObject regPayload = new JSONObject();
            regPayload.put("action", "register_device");
            regPayload.put("mac", mac);
            regPayload.put("anydesk_id", cleanAd);
            regPayload.put("software", res.software);
            regPayload.put("status", "online");
            regPayload.put("app_version", appVersion);
            regPayload.put("storage_mb", storageMb);
            if (macIcs != null && !macIcs.isEmpty()) regPayload.put("mac_ics", macIcs);

            String regRespStr = post(regPayload.toString());
            if (regRespStr != null && !regRespStr.isEmpty()) {
                JSONObject regResp = new JSONObject(regRespStr);
                if ("ok".equalsIgnoreCase(regResp.optString("status", ""))) {
                    String serverProj = regResp.optString("project", "");
                    String serverSoft = regResp.optString("software", "");
                    if (!serverProj.isEmpty()) {
                        res.project = serverProj;
                    }
                    if (!serverSoft.isEmpty()) {
                        res.software = serverSoft;
                    }
                    res.matchedByAnydesk = regResp.optBoolean("matched_by_anydesk", false)
                            || (!serverProj.isEmpty() && !"Kho thiết bị".equals(serverProj));
                    res.success = true;
                    res.message = "Đã đồng bộ thành công lên dự án: " + res.project;
                    return res;
                }
            }
            res.success = false;
            res.message = "Phản hồi không hợp lệ từ Google Sheet";
        } catch (Exception e) {
            res.success = false;
            res.message = "Lỗi đồng bộ: " + e.getMessage();
            Log.e(Constants.TAG, "syncOldBoxByAnydesk error: " + e.getMessage(), e);
        }
        return res;
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
            payload.put("template_name", name);
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
