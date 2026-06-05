# Fixtures WebView Android App

This Android app opens the hosted fixtures page inside a native app shell:

- https://leeponeill-football.online/fixtures.html

## Open and run

1. Open Android Studio.
2. Choose **Open** and select this folder:
   - `android-fixtures-webview`
3. Let Gradle sync finish.
4. Run the `app` configuration on an emulator or connected device.

## Notes

- The app uses a `WebView` and requires internet access.
- The toolbar title is `Fixtures Hub`.
- Back button navigates back in WebView history before exiting.
