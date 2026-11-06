package com.sgl.autosetup;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.util.Log;
import androidx.core.content.ContextCompat;

public class BootReceiver extends BroadcastReceiver {
    @Override
    public void onReceive(Context context, Intent intent) {
        if (Intent.ACTION_BOOT_COMPLETED.equals(intent.getAction())) {
            Log.i(Constants.TAG, "Boot completed received. Starting AgentService...");
            Intent serviceIntent = new Intent(context, AgentService.class);
            ContextCompat.startForegroundService(context, serviceIntent);
        }
    }
}
