// This file can be replaced during build by using the `fileReplacements` array.
// `ng build` replaces `environment.ts` with `environment.prod.ts`.
// The list of file replacements can be found in `angular.json`.

export const environment = {
  production: false,
  /** Laravel API base (include /api). On-device dev (`npm run dev:device`) runs
   *  on the PHONE, so this must be the laptop's LAN IP — NOT localhost, which on
   *  the phone means the phone itself. Update if the laptop's Wi-Fi IP changes. */
  apiUrl: 'https://dreamcabs.in/api',
  /**
   * Login OTP provider:
   *   true  → server-side SMS OTP via MSG91 (POST /auth/otp/sms/*). In mock mode
   *           (no MSG91 key on the backend) the code is auto-filled for testing.
   *   false → Firebase phone auth (the legacy client-side path).
   */
  useServerOtp: true,
  /**
   * Google Maps JavaScript API key (Places + Geocoding).
   * Used for:
   * - Google Places Autocomplete (address typing)
   * - Map with markers for pickup/drop
   *
   * If empty, the booking screen will fall back to manual lat/lng + external maps links.
   */
  googleMapsApiKey: 'AIzaSyB75-vyT02OBfQQ85Vt6JIAF0LoDXQRujw',
  /**
   * Laravel Reverb websocket settings. Match `REVERB_*` in backend/.env.
   * Leave reverbAppKey blank to fall back to polling-only.
   */
  reverbAppKey: '4jsb8ggrbvcriyaskojh',
  reverbHost: 'dreamcabs.in',
  reverbPort: 443,
  reverbScheme: 'https' as 'http' | 'https',
  /**
   * Firebase: must be the **Web** app object (Console → Project settings → Your apps → </> Web).
   * If `appId` contains `:android:` or `:ios:` instead of `:web:`, Phone Auth in the browser throws
   * auth/configuration-not-found. Enable Phone sign-in; add `localhost` to Authorized domains.
   */
  firebase: {
    apiKey: "AIzaSyCCpdahYlxnjogTRS1ZSaF3sQ6cF9DTbVY",
    authDomain: "dreamcabs-1cd27.firebaseapp.com",
    projectId: "dreamcabs-1cd27",
    storageBucket: "dreamcabs-1cd27.firebasestorage.app",
    messagingSenderId: "862449587825",
    appId: "1:862449587825:web:cc8f4f7d2df4a1d8ac2dd0",
    measurementId: "G-CLHQFG1HW1"
  },
  /**
   * FCM Web Push VAPID key — Firebase Console → Project Settings → Cloud Messaging →
   * Web configuration → Web Push certificates → Generate key pair.
   * Required for browser push to work; native (Android/iOS) does not need this.
   */
  fcmVapidKey: "",
};

/*
 * For easier debugging in development mode, you can import the following file
 * to ignore zone related error stack frames such as `zone.run`, `zoneDelegate.invokeTask`.
 *
 * This import should be commented out in production mode because it will have a negative impact
 * on performance if an error is thrown.
 */
// import 'zone.js/plugins/zone-error';  // Included with Angular CLI.
