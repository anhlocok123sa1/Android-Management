package com.sgl.autosetup;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.os.Build;
import android.os.IBinder;
import android.util.Log;
import androidx.core.app.NotificationCompat;
import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.util.concurrent.TimeUnit;

public class AgentService extends Service {

    private static final String PREFS_NAME = "sgl_agent_prefs";
    private static final String KEY_CURRENT_TASK = "current_task";

    private volatile boolean isRunning = false;
    private volatile boolean initialSyncDone = false;
    private Thread pollingThread;
    private WebhookClient webhookClient;
    private TaskExecutor taskExecutor;

    @Override
    public void onCreate() {
        super.onCreate();
        getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
                .edit()
                .putString(KEY_CURRENT_TASK, "idle")
                .apply();
        webhookClient = new WebhookClient(Constants.WEBHOOK_URL);
        taskExecutor = new TaskExecutor();
        createNotificationChannel();
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        startForeground(Constants.NOTIFICATION_ID, buildNotification("SGL Agent đang chạy nền..."));

        if (!isRunning) {
            isRunning = true;
            pollingThread = new Thread(this::pollingLoop, "SGL-Agent-Polling");
            pollingThread.start();
            Log.i(Constants.TAG, "AgentService started successfully.");
        }

        return START_STICKY;
    }

    @Override
    public void onDestroy() {
        isRunning = false;
        if (pollingThread != null) {
            pollingThread.interrupt();
        }
        Log.i(Constants.TAG, "AgentService stopped.");
        super.onDestroy();
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }

    private void pollingLoop() {
        while (isRunning) {
            try {
                performHeartbeatAndTaskCheck();
            } catch (Exception e) {
                Log.e(Constants.TAG, "Error in polling loop: " + e.getMessage(), e);
            }

            try {
                Thread.sleep(Constants.POLL_INTERVAL_MS);
            } catch (InterruptedException e) {
                Log.i(Constants.TAG, "Polling loop interrupted.");
                break;
            }
        }
    }

    private void performHeartbeatAndTaskCheck() {
        String mac = DeviceInfo.getMac();
        String anydeskId = readAnydeskId();
        long ramMb = DeviceInfo.getRamMb(this);
        long storageMb = DeviceInfo.getStorageMb();
        String appVersion = DeviceInfo.getAppVersion(this);
        String ip = DeviceInfo.getIpAddress();
        String software = DeviceInfo.detectInstalledSoftware(this);
        String macIcs = "VNPT ICS".equals(software) ? DeviceInfo.extractIcsMacIfPresent() : "";

        // Lần đầu tiên Service chạy: tự động tìm mã AnyDesk trên các Sheet dự án và đồng bộ app đang dùng + trạng thái Online
        if (!initialSyncDone && !mac.isEmpty() && !"UNKNOWN".equals(mac)) {
            initialSyncDone = true;
            WebhookClient.SyncBoxResult syncRes = webhookClient.syncOldBoxByAnydesk(
                    mac, anydeskId, software, macIcs, appVersion, storageMb, ramMb, ip
            );
            if (syncRes != null && syncRes.success) {
                updateNotification("Đã đồng bộ Dự án: " + syncRes.project + " (" + syncRes.software + ")");
            }
        }

        SharedPreferences prefs = getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
        String currentTask = prefs.getString(KEY_CURRENT_TASK, "idle");

        Log.d(Constants.TAG, "Sending heartbeat for MAC: " + mac + ", AnyDesk: " + anydeskId + ", soft: " + software);
        String pendingTaskJson = webhookClient.heartbeat(
                mac, anydeskId, ramMb, storageMb, currentTask, appVersion, ip, software, macIcs
        );

        if (pendingTaskJson != null && !pendingTaskJson.isEmpty() && "idle".equals(currentTask)) {
            try {
                JSONObject taskObj = new JSONObject(pendingTaskJson);
                String taskId = taskObj.getString("task_id");
                String templateName = taskObj.optString("template_name", "unnamed");
                String stepsJson = taskObj.optString("steps_json", "[]");

                Log.i(Constants.TAG, "Received pending task: " + taskId + " (" + templateName + ")");

                // Try to claim task
                boolean claimed = webhookClient.claimTask(mac, taskId);
                if (claimed) {
                    Log.i(Constants.TAG, "Claimed task " + taskId + " successfully. Starting execution...");
                    prefs.edit().putString(KEY_CURRENT_TASK, taskId).apply();
                    updateNotification("Đang chạy nhiệm vụ: " + templateName);
                    try {
                        TaskExecutor.ExecutionResult execRes = taskExecutor.execute(this, taskId, templateName, stepsJson, mac, webhookClient);
                        Log.i(Constants.TAG, "Task execution finished. Success: " + execRes.success);
                        webhookClient.completeTask(mac, taskId, execRes.result != null ? execRes.result : execRes.error, execRes.success);
                    } finally {
                        prefs.edit().putString(KEY_CURRENT_TASK, "idle").apply();
                        updateNotification("SGL Agent đang chạy nền...");
                    }
                } else {
                    Log.w(Constants.TAG, "Could not claim task " + taskId + " (already claimed or cancelled)");
                }
            } catch (Exception e) {
                Log.e(Constants.TAG, "Failed to parse/process pending task: " + e.getMessage(), e);
            }
        }
    }

    private String readAnydeskId() {
        return DeviceInfo.getAnydeskId();
    }

    private void createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationChannel channel = new NotificationChannel(
                    Constants.NOTIFICATION_CHANNEL_ID,
                    "SGL AutoSetup Agent Service",
                    NotificationManager.IMPORTANCE_LOW
            );
            channel.setDescription("Dịch vụ đồng bộ nhiệm vụ từ xa");
            NotificationManager manager = getSystemService(NotificationManager.class);
            if (manager != null) {
                manager.createNotificationChannel(channel);
            }
        }
    }

    private Notification buildNotification(String contentText) {
        return new NotificationCompat.Builder(this, Constants.NOTIFICATION_CHANNEL_ID)
                .setContentTitle("SGL Truyền Thanh Agent")
                .setContentText(contentText)
                .setSmallIcon(android.R.drawable.ic_dialog_info)
                .setPriority(NotificationCompat.PRIORITY_LOW)
                .setOngoing(true)
                .build();
    }

    private void updateNotification(String contentText) {
        NotificationManager manager = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
        if (manager != null) {
            manager.notify(Constants.NOTIFICATION_ID, buildNotification(contentText));
        }
    }
}
