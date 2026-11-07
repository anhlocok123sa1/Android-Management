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
            // Bước 1: Yêu cầu Sheet đồng bộ (quét các Sheet dự án mới tạo nếu có) và tải danh sách thiết bị
            try {
                JSONObject syncReq = new JSONObject();
                syncReq.put("action", "sync_project_sheets");
                post(syncReq.toString());
            } catch (Exception ignored) {}

            String matchedProject = "";
            String existingIot = "";
            String existingImei = "";
            String existingNotes = "";
            boolean foundOnSheet = false;

            String devRespStr = getDevices();
            if (devRespStr != null && !devRespStr.isEmpty()) {
                JSONObject devResp = new JSONObject(devRespStr);
                JSONArray arr = devResp.optJSONArray("devices");
                if (arr != null) {
                    for (int i = 0; i < arr.length(); i++) {
                        JSONObject d = arr.getJSONObject(i);
                        String rowAd = d.optString("anydesk_id", "").replaceAll("[\\s\\-]", "").trim();
                        String rowMac = d.optString("mac", "").trim().toUpperCase();
                        String rowProj = d.optString("project", "").trim();

                        if ((!cleanAd.isEmpty() && (cleanAd.equals(rowAd) || rowMac.equals("CHUA_MAC_" + cleanAd)))
                                || (!mac.isEmpty() && mac.equalsIgnoreCase(rowMac))) {
                            foundOnSheet = true;
                            if (!rowProj.isEmpty() && (!"Kho thiết bị".equals(rowProj) || matchedProject.isEmpty())) {
                                matchedProject = rowProj;
                            }
                            if (existingIot.isEmpty()) existingIot = d.optString("iot_id", "");
                            if (existingImei.isEmpty()) existingImei = d.optString("imei_sim", "");
                            if (existingNotes.isEmpty()) existingNotes = d.optString("notes", "");
                        }
                    }
                }
            }

            if (!matchedProject.isEmpty()) {
                res.project = matchedProject;
                res.matchedByAnydesk = true;
            }

            // Bước 2: Gọi register_device kèm đầy đủ thông tin dự án, phần mềm đang dùng, MAC thật
            JSONObject regPayload = new JSONObject();
            regPayload.put("action", "register_device");
            regPayload.put("mac", mac);
            regPayload.put("anydesk_id", cleanAd);
            regPayload.put("project", res.project);
            regPayload.put("software", res.software);
            regPayload.put("status", "online");
            regPayload.put("app_version", appVersion);
            regPayload.put("storage_mb", storageMb);
            if (macIcs != null && !macIcs.isEmpty()) regPayload.put("mac_ics", macIcs);
            if (!existingIot.isEmpty()) regPayload.put("iot_id", existingIot);
            if (!existingImei.isEmpty()) regPayload.put("imei_sim", existingImei);
            if (!existingNotes.isEmpty()) regPayload.put("notes", existingNotes);

            String regRespStr = post(regPayload.toString());
            if (regRespStr != null) {
                JSONObject regResp = new JSONObject(regRespStr);
                String serverProj = regResp.optString("project", "");
                if (!serverProj.isEmpty() && !"Kho thiết bị".equals(serverProj)) {
                    res.project = serverProj;
                    res.matchedByAnydesk = true;
                }
            }

            // Bước 3: Gửi heartbeat để cập nhật trạng thái ONLINE + last_seen + bảng Heartbeat
            heartbeat(mac, cleanAd, ramMb, storageMb, "idle", appVersion, ip, res.software, macIcs);

            // Bước 4: Gọi assign_project để ép cập nhật project + software và tách Sheet dự án tự động
            JSONObject assignPayload = new JSONObject();
            assignPayload.put("action", "assign_project");
            JSONArray macsArr = new JSONArray();
            macsArr.put(mac);
            assignPayload.put("target_macs", macsArr);
            assignPayload.put("project", res.project);
            assignPayload.put("software", res.software);
            post(assignPayload.toString());

            res.success = true;
            res.matchedByAnydesk = foundOnSheet || res.matchedByAnydesk;
            res.message = "Đã đồng bộ thành công lên dự án: " + res.project;
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
