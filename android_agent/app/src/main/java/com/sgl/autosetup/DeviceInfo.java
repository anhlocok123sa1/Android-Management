package com.sgl.autosetup;

import android.app.ActivityManager;
import android.content.Context;
import android.os.Environment;
import android.os.StatFs;
import android.util.Log;
import java.io.BufferedReader;
import java.io.FileReader;
import java.net.NetworkInterface;
import java.util.Collections;
import java.util.List;

public class DeviceInfo {

    public static String getMac() {
        // Thử eth0 trước, fallback wlan0
        String[] ifaces = {"eth0", "wlan0", "eth1"};
        for (String iface : ifaces) {
            try {
                BufferedReader br = new BufferedReader(new FileReader("/sys/class/net/" + iface + "/address"));
                String mac = br.readLine().trim();
                br.close();
                if (mac != null && !mac.isEmpty() && !mac.equals("00:00:00:00:00:00")) {
                    return mac.replace(":", "").toUpperCase();
                }
            } catch (Exception ignored) {}
        }
        // Fallback: NetworkInterface
        try {
            List<NetworkInterface> interfaces = Collections.list(NetworkInterface.getNetworkInterfaces());
            for (NetworkInterface ni : interfaces) {
                byte[] mac = ni.getHardwareAddress();
                if (mac != null && mac.length == 6) {
                    StringBuilder sb = new StringBuilder();
                    for (byte b : mac) sb.append(String.format("%02X", b));
                    String macStr = sb.toString();
                    if (!macStr.equals("000000000000")) return macStr;
                }
            }
        } catch (Exception ignored) {}
        return "UNKNOWN";
    }

    public static long getStorageMb() {
        try {
            StatFs stat = new StatFs(Environment.getDataDirectory().getPath());
            return stat.getAvailableBytes() / (1024 * 1024);
        } catch (Exception e) { return 0; }
    }

    public static long getRamMb(Context context) {
        try {
            ActivityManager am = (ActivityManager) context.getSystemService(Context.ACTIVITY_SERVICE);
            ActivityManager.MemoryInfo mi = new ActivityManager.MemoryInfo();
            am.getMemoryInfo(mi);
            return mi.availMem / (1024 * 1024);
        } catch (Exception e) { return 0; }
    }

    public static String getAppVersion(Context context) {
        try {
            return context.getPackageManager()
                .getPackageInfo(context.getPackageName(), 0).versionName;
        } catch (Exception e) { return "unknown"; }
    }

    public static String getIpAddress() {
        try {
            List<NetworkInterface> interfaces = Collections.list(NetworkInterface.getNetworkInterfaces());
            for (NetworkInterface ni : interfaces) {
                if (ni.isLoopback() || !ni.isUp()) continue;
                for (java.net.InetAddress addr : Collections.list(ni.getInetAddresses())) {
                    if (!addr.isLoopbackAddress() && addr instanceof java.net.Inet4Address) {
                        return addr.getHostAddress();
                    }
                }
            }
        } catch (Exception ignored) {}
        return "0.0.0.0";
    }
}
