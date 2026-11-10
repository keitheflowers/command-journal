package app.familysave;

import android.Manifest;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;
import androidx.core.content.ContextCompat;
import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;

/**
 * "Hey Vector" while the app is closed. JS: Capacitor.Plugins.WakeWord
 * start() / stop() / status() / openOverlaySettings(), event "wake".
 * The service listens only while the app is in the background, so the
 * in-app voice assistant gets the microphone while you're using it.
 */
@CapacitorPlugin(
    name = "WakeWord",
    permissions = { @Permission(strings = { Manifest.permission.RECORD_AUDIO }, alias = "microphone") }
)
public class WakeWordPlugin extends Plugin {
    static final String EXTRA_WAKE = "fs_wake";

    @Override
    public void load() {
        Intent i = getActivity().getIntent();
        if (i != null && i.getBooleanExtra(EXTRA_WAKE, false)) {
            i.removeExtra(EXTRA_WAKE);
            notifyListeners("wake", new JSObject(), true);
        }
    }

    @Override
    protected void handleOnNewIntent(Intent intent) {
        super.handleOnNewIntent(intent);
        if (intent != null && intent.getBooleanExtra(EXTRA_WAKE, false)) {
            intent.removeExtra(EXTRA_WAKE);
            notifyListeners("wake", new JSObject(), true);
        }
    }

    @Override
    protected void handleOnResume() {
        super.handleOnResume();
        WakeWordService.setAppVisible(true);
    }

    @Override
    protected void handleOnPause() {
        super.handleOnPause();
        WakeWordService.setAppVisible(false);
    }

    @PluginMethod
    public void start(PluginCall call) {
        if (getPermissionState("microphone") != PermissionState.GRANTED) {
            requestPermissionForAlias("microphone", call, "micResult");
            return;
        }
        begin(call);
    }

    @PermissionCallback
    private void micResult(PluginCall call) {
        if (getPermissionState("microphone") == PermissionState.GRANTED) begin(call);
        else call.reject("Microphone permission is needed for Hey Vector.");
    }

    private void begin(PluginCall call) {
        try {
            // Started while the app is open (Android only allows a microphone
            // service to start from the foreground); it waits until you leave.
            WakeWordService.setAppVisible(true);
            ContextCompat.startForegroundService(getContext(), new Intent(getContext(), WakeWordService.class));
            call.resolve(status());
        } catch (Exception e) {
            call.reject("Could not start Hey Vector: " + e.getMessage());
        }
    }

    @PluginMethod
    public void stop(PluginCall call) {
        getContext().stopService(new Intent(getContext(), WakeWordService.class));
        call.resolve(status());
    }

    @PluginMethod
    public void status(PluginCall call) {
        call.resolve(status());
    }

    private JSObject status() {
        JSObject r = new JSObject();
        r.put("running", WakeWordService.isRunning());
        r.put("canOpenFromBackground", Build.VERSION.SDK_INT < 29 || Settings.canDrawOverlays(getContext()));
        r.put("microphone", getPermissionState("microphone") == PermissionState.GRANTED);
        return r;
    }

    @PluginMethod
    public void openOverlaySettings(PluginCall call) {
        Intent i = new Intent(Settings.ACTION_MANAGE_OVERLAY_PERMISSION, Uri.parse("package:" + getContext().getPackageName()));
        i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        getContext().startActivity(i);
        call.resolve();
    }
}
