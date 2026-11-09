package com.sgl.autosetup;

import android.app.ActivityManager;
import android.content.Context;
import android.content.pm.PackageInfo;
import android.content.pm.PackageManager;
import android.os.Environment;
import android.os.StatFs;
import android.util.Log;
import java.io.BufferedReader;
import java.io.DataOutputStream;
import java.io.FileReader;
import java.io.InputStreamReader;
import java.net.NetworkInterface;
import java.util.Collections;
import java.util.List;
import java.util.concurrent.TimeUnit;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

public class DeviceInfo {

    public static String runRootCommand(String command) {
        StringBuilder output = new StringBuilder();
        try {
            Process process = Runtime.getRuntime().exec("su");
            DataOutputStream os = new DataOutputStream(process.getOutputStream());
            os.writeBytes("if command -v nsenter >/dev/null 2>&1; then\n");
            os.writeBytes("  nsenter -t 1 -m -- /system/bin/sh << 'EOF_SGL_DEV'\n");
            os.writeBytes(command + "\n");
            os.writeBytes("EOF_SGL_DEV\n");
            os.writeBytes("  if [ $? -ne 0 ]; then\n");
            os.writeBytes("    /system/bin/sh << 'EOF_SGL_DEV_FB'\n");
            os.writeBytes(command + "\n");
            os.writeBytes("EOF_SGL_DEV_FB\n");
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
            process.waitFor(10, TimeUnit.SECONDS);
        } catch (Exception ignored) {}
        return output.toString().trim();
    }

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
        // Fallback bằng quyền Root nếu Android chặn đọc /sys/class/net
        String rootMac = runRootCommand("(cat /sys/class/net/eth0/address 2>/dev/null || cat /sys/class/net/wlan0/address 2>/dev/null) | head -n 1");
        if (rootMac != null && !rootMac.isEmpty() && !rootMac.contains("00:00:00:00:00:00")) {
            String cleaned = rootMac.replace(":", "").replaceAll("[^A-Fa-f0-9]", "").toUpperCase();
            if (cleaned.length() >= 12) return cleaned;
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

    public static String getAnydeskId() {
        String cmd =
                "for base in " +
                        "  /data_mirror/data_de/null/0/com.anydesk.anydeskandroid " +
                        "  /data_mirror/data_ce/null/0/com.anydesk.anydeskandroid " +
                        "  /data/user_de/0/com.anydesk.anydeskandroid " +
                        "  /data/user/0/com.anydesk.anydeskandroid " +
                        "  /data/data/com.anydesk.anydeskandroid; do " +
                        "  for f in \"$base/files/.anydesk/system.conf\" \"$base/files/.anydesk/service.conf\" \"$base/files/.anydesk/user.conf\" \"$base/files/system.conf\" \"$base/files/service.conf\"; do " +
                        "    if [ -f \"$f\" ]; then " +
                        "      grep 'ad.anynet.id=' \"$f\" 2>/dev/null | head -n 1 ; " +
                        "    fi; " +
                        "  done; " +
                        "done 2>/dev/null";
        String raw = runRootCommand(cmd);
        if (raw != null && !raw.isEmpty()) {
            Matcher m = Pattern.compile("ad\\.anynet\\.id=\\s*(\\d{7,12})").matcher(raw);
            if (m.find()) {
                return m.group(1);
            }
            Matcher m2 = Pattern.compile("\\b(\\d{8,11})\\b").matcher(raw);
            if (m2.find()) {
                return m2.group(1);
            }
        }
        return "";
    }

    /**
     * Tự động phát hiện phần mềm phát thanh đang cài và sử dụng trên Box cũ / mới.
     */
    public static String detectInstalledSoftware(Context context) {
        try {
            PackageManager pm = context.getPackageManager();
            // 1. Kiểm tra VNPT ICS
            String[] icsPkgs = {"com.app.ics_content_management", "vnpt.smartcomm.radio"};
            for (String pkg : icsPkgs) {
                if (isPackageInstalled(pm, pkg)) {
                    return "VNPT ICS";
                }
            }

            // 2. Kiểm tra RadioStation (3.6 / 2.0 / 1.66)
            String[] radioPkgs = {"vn.phitn.app.radiostation", "com.radiostation", "com.radio.station", "vn.radiostation"};
            for (String pkg : radioPkgs) {
                if (isPackageInstalled(pm, pkg)) {
                    String ver = getPackageVersionName(pm, pkg);
                    if (ver.startsWith("2.")) return "Radio 2.0";
                    if (ver.startsWith("1.6") || ver.contains("1.66")) return "Radio 1.66";
                    // Kiểm tra xem đang đăng nhập tài khoản test z755-01 hay tài khoản dự án thật
                    String prefsCheck = runRootCommand(
                            "grep -i 'z755-01' /data/data/" + pkg + "/shared_prefs/*.xml /data/user/0/" + pkg + "/shared_prefs/*.xml 2>/dev/null | head -n 1"
                    );
                    if (prefsCheck != null && !prefsCheck.isEmpty()) {
                        return "Radio 3.6 (Test)";
                    }
                    return "Radio 3.6";
                }
            }

            // 3. Quét qua shell pm list packages phòng trường hợp Android 11+ chặn query package
            String shellCheck = runRootCommand(
                    "pm list packages -3 2>/dev/null | cut -d':' -f2"
            );
            if (shellCheck != null && !shellCheck.isEmpty()) {
                if (shellCheck.contains("ics_content_management") || shellCheck.contains("vnpt.smartcomm.radio")) {
                    return "VNPT ICS";
                }
                for (String line : shellCheck.split("\n")) {
                    String p = line.trim();
                    if (p.isEmpty() || p.contains("autosetup") || p.contains("anydesk")) continue;
                    if (p.toLowerCase().matches(".*(radio|audio|station|streamer).*")) {
                        String dumpVer = runRootCommand("dumpsys package " + p + " 2>/dev/null | grep versionName | head -n 1");
                        if (dumpVer.contains("2.0")) return "Radio 2.0";
                        if (dumpVer.contains("1.6")) return "Radio 1.66";
                        return "Radio 3.6";
                    }
                }
            }
        } catch (Exception ignored) {}
        return "";
    }

    public static String extractIcsMacIfPresent() {
        try {
            String raw = runRootCommand(
                    "cat /data/data/com.app.ics_content_management/shared_prefs/*.xml " +
                            "/data/data/vnpt.smartcomm.radio/shared_prefs/*.xml " +
                            "/sdcard/ics* /sdcard/VNPT* 2>/dev/null"
            );
            if (raw != null && !raw.isEmpty()) {
                Matcher m = Pattern.compile("([0-9A-Fa-f]{2}:){5}[0-9A-Fa-f]{2}|[0-9A-Fa-f]{12}").matcher(raw);
                if (m.find()) {
                    return m.group(0).replace(":", "").toUpperCase();
                }
            }
        } catch (Exception ignored) {}
        return "";
    }

    private static boolean isPackageInstalled(PackageManager pm, String pkg) {
        try {
            pm.getPackageInfo(pkg, 0);
            return true;
        } catch (Exception e) {
            return false;
        }
    }

    private static String getPackageVersionName(PackageManager pm, String pkg) {
        try {
            PackageInfo info = pm.getPackageInfo(pkg, 0);
            return info.versionName != null ? info.versionName.trim() : "";
        } catch (Exception e) {
            return "";
        }
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
