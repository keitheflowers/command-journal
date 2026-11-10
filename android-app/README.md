# The Family Save for Android

A Capacitor app that wraps the web app and adds what a browser can't do:

| Feature | How |
|---|---|
| Voice that works inside the app | Phone's speech recognizer + text-to-speech (`@capacitor-community/speech-recognition`, `text-to-speech`, MIT), connected to the app's existing voice code by `native.js` |
| Reminders | Local notifications for bills (2 days before + due day), tasks due today (8 AM), planned workouts (7 AM) and fasting goals (`@capacitor/local-notifications`, MIT). Re-planned after every change. |
| Samsung Health | Steps, sleep, weight and workouts from Health Connect (`@capgo/capacitor-health`, MPL-2.0, used unmodified). In Samsung Health turn on Settings → Health Connect. |
| "Hey Vector" with the app closed | `WakeWordService` (foreground service) runs Vosk (Apache-2.0) on the phone with a tiny grammar, so no audio leaves the phone. When it hears "Hey Vector" it opens the app ready for an instruction. With "display over other apps" allowed it opens directly; otherwise it shows a notification to tap. It listens only while the app is in the background. |
| Back button | Goes to Home, then closes the app |

## Get the APK
GitHub → **Actions → Android app** → the latest run → **Artifacts → family-save-android**. Unzip it, copy `app-debug.apk` to the phone, and open it. Allow "install unknown apps" for your file manager when asked.

The workflow runs on every push to `main` that changes the app, or from **Run workflow**.

## Build locally
Requires Node 22, JDK 21 and the Android SDK.

```
cd android-app
npm ci
# speech model for "Hey Vector" (about 40 MB), once:
curl -L -o /tmp/m.zip https://alphacephei.com/vosk/models/vosk-model-small-en-us-0.15.zip && unzip -q /tmp/m.zip -d /tmp/m \
  && mkdir -p android/app/src/main/assets/model-en-us && cp -r /tmp/m/vosk-model-small-en-us-0.15/. android/app/src/main/assets/model-en-us/ \
  && echo small-en-us-0.15 > android/app/src/main/assets/model-en-us/uuid
npm run apk        # copies the web app into www/, syncs plugins, builds app-debug.apk
```

## For the Play Store
- Create an upload key and a signed release build (`./gradlew bundleRelease` with a `signingConfig`). Keep the keystore out of git.
- Health Connect: fill in the Play Console health declaration. The app reads steps, sleep, weight and exercise. Its privacy policy is `privacypolicy.html` (a copy of `privacy.html`).
- The microphone foreground service needs the Play Console foreground-service declaration (type: microphone, for the user-enabled "Hey Vector").
- "Display over other apps" is optional; the app works without it (tap-to-open notification).
