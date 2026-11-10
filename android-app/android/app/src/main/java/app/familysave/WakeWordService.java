package app.familysave;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.os.Build;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import android.provider.Settings;
import androidx.core.app.NotificationCompat;
import androidx.core.app.ServiceCompat;
import org.json.JSONObject;
import org.vosk.Model;
import org.vosk.Recognizer;
import org.vosk.android.RecognitionListener;
import org.vosk.android.SpeechService;
import org.vosk.android.StorageService;

/**
 * Listens on the phone (no audio leaves it) for "Hey Vector" using Vosk,
 * an open-source (Apache-2.0) offline speech engine, limited to a tiny
 * grammar. When heard, it opens the app ready for an instruction.
 */
public class WakeWordService extends Service implements RecognitionListener {
    private static final String CHANNEL = "vector_listen", ALERT = "vector_wake";
    private static final int ID = 7101, ALERT_ID = 7102;
    private static final String GRAMMAR = "[\"hey vector\", \"vector\", \"hey victor\", \"[unk]\"]";
    private static WakeWordService instance;
    private static volatile boolean appVisible = true;

    private final Handler main = new Handler(Looper.getMainLooper());
    private Model model;
    private SpeechService speech;

    static boolean isRunning() { return instance != null; }

    static void setAppVisible(boolean visible) {
        appVisible = visible;
        WakeWordService s = instance;
        if (s != null) s.main.post(s::update);
    }

    @Override
    public void onCreate() {
        super.onCreate();
        instance = this;
        NotificationManager nm = getSystemService(NotificationManager.class);
        if (Build.VERSION.SDK_INT >= 26) {
            nm.createNotificationChannel(new NotificationChannel(CHANNEL, "Hey Vector listening", NotificationManager.IMPORTANCE_MIN));
            NotificationChannel alert = new NotificationChannel(ALERT, "Hey Vector", NotificationManager.IMPORTANCE_HIGH);
            nm.createNotificationChannel(alert);
        }
        Notification n = new NotificationCompat.Builder(this, CHANNEL)
            .setSmallIcon(R.drawable.ic_stat_vector)
            .setContentTitle("Listening for “Hey Vector”")
            .setContentText("Tap to open The Family Save. Turn off in Settings → Voice.")
            .setContentIntent(openApp(false))
            .setOngoing(true)
            .setPriority(NotificationCompat.PRIORITY_MIN)
            .build();
        ServiceCompat.startForeground(this, ID, n, Build.VERSION.SDK_INT >= 30 ? ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE : 0);
        StorageService.unpack(this, "model-en-us", "model",
            m -> { model = m; update(); },
            e -> stopSelf());
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) { return START_STICKY; }

    /** Listen only while the app is in the background. */
    private void update() {
        if (model == null) return;
        if (appVisible) { stopListening(); return; }
        if (speech != null) return;
        try {
            speech = new SpeechService(new Recognizer(model, 16000.0f, GRAMMAR), 16000.0f);
            speech.startListening(this);
        } catch (Exception e) {
            speech = null;
        }
    }

    private void stopListening() {
        if (speech != null) {
            speech.stop();
            speech.shutdown();
            speech = null;
        }
    }

    private void heard(String hypothesis) {
        String text;
        try { text = new JSONObject(hypothesis).optString("text", ""); } catch (Exception e) { return; }
        if (!text.contains("vector") && !text.contains("victor")) return;
        stopListening();
        appVisible = true; // the app is coming up; it takes the microphone
        if (Build.VERSION.SDK_INT < 29 || Settings.canDrawOverlays(this)) {
            Intent i = new Intent(this, MainActivity.class)
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_REORDER_TO_FRONT)
                .putExtra(WakeWordPlugin.EXTRA_WAKE, true);
            startActivity(i);
        } else {
            // Android blocks opening apps from the background without the
            // "display over other apps" permission: offer a tap instead.
            Notification n = new NotificationCompat.Builder(this, ALERT)
                .setSmallIcon(R.drawable.ic_stat_vector)
                .setContentTitle("Vector is ready")
                .setContentText("Tap to talk to Vector.")
                .setContentIntent(openApp(true))
                .setAutoCancel(true)
                .setPriority(NotificationCompat.PRIORITY_HIGH)
                .setCategory(NotificationCompat.CATEGORY_REMINDER)
                .build();
            getSystemService(NotificationManager.class).notify(ALERT_ID, n);
            appVisible = false;
            main.postDelayed(this::update, 1500);
        }
    }

    private PendingIntent openApp(boolean wake) {
        Intent i = new Intent(this, MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        if (wake) i.putExtra(WakeWordPlugin.EXTRA_WAKE, true);
        return PendingIntent.getActivity(this, wake ? 1 : 0, i, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }

    @Override public void onResult(String hypothesis) { heard(hypothesis); }
    @Override public void onFinalResult(String hypothesis) { heard(hypothesis); }
    @Override public void onPartialResult(String hypothesis) {}
    @Override public void onError(Exception e) { stopListening(); main.postDelayed(this::update, 3000); }
    @Override public void onTimeout() { stopListening(); main.post(this::update); }

    @Override
    public void onDestroy() {
        stopListening();
        if (model != null) model.close();
        instance = null;
        super.onDestroy();
    }

    @Override public IBinder onBind(Intent intent) { return null; }
}
