// This file can be replaced during build by using the `fileReplacements` array.
// `ng build` replaces `environment.ts` with `environment.prod.ts`.
// The list of file replacements can be found in `angular.json`.

export const environment = {
  production: false,
  /** Laravel API base (include /api). */
  apiUrl: 'http://localhost:8000/api',
  /**
   * Firebase: must be the **Web** app object (Console → Project settings → Your apps → </> Web).
   * If `appId` contains `:android:` or `:ios:` instead of `:web:`, Phone Auth in the browser throws
   * auth/configuration-not-found. Enable Phone sign-in; add `localhost` to Authorized domains.
   */
  firebase: {
    apiKey: "AIzaSyCCpdahYlxnjogTRS1ZSaF3sQ6cF9DTbVY",
    authDomain: "dreamcabs-c851f.firebaseapp.com",
    projectId: "dreamcabs-c851f",
    storageBucket: "dreamcabs-c851f.firebasestorage.app",
    messagingSenderId: "862449587825",
    appId: "1:862449587825:web:cc8f4f7d2df4a1d8ac2dd0",
    measurementId: "G-CLHQFG1HW1"
  },
  /** Reverb (WebSocket) — match backend/.env REVERB_* values. */
  reverbAppKey: 'local',
  reverbHost: 'localhost',
  reverbPort: 8080,
  reverbScheme: 'http' as 'http' | 'https',
  /** FCM Web Push VAPID key — Firebase Console → Cloud Messaging → Web Push certificates. */
  fcmVapidKey: '',
};

/*
 * For easier debugging in development mode, you can import the following file
 * to ignore zone related error stack frames such as `zone.run`, `zoneDelegate.invokeTask`.
 *
 * This import should be commented out in production mode because it will have a negative impact
 * on performance if an error is thrown.
 */
// import 'zone.js/plugins/zone-error';  // Included with Angular CLI.
