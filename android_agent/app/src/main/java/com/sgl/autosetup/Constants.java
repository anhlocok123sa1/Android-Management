package com.sgl.autosetup;

public class Constants {
    // Google Apps Script Web App URL
    public static final String WEBHOOK_URL = "https://script.google.com/macros/s/AKfycbxqawYpW8SebK0EK21Cl7C2uw6vN3-Jr7vQIHSAbNxtwXA5H7c_lYRNhXuB7104P0NN/exec";
    public static final long POLL_INTERVAL_MS = 5 * 60 * 1000L; // 5 phút
    public static final int MAX_RETRY = 3;
    public static final String TAG = "SGL_AGENT";
    public static final String NOTIFICATION_CHANNEL_ID = "sgl_agent_channel";
    public static final int NOTIFICATION_ID = 1001;
    public static final String LOCAL_TASK_DIR = "/sdcard/SGL_Tasks/";
}
