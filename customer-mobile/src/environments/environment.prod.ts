// ===========================================================================
// PRODUCTION CONFIG  (used when you build with `--configuration production`)
// ---------------------------------------------------------------------------
// You only edit ONE line: SERVER_HOST. Everything else is derived from it.
//
//   • No domain / no SSL yet  →  set SERVER_HOST to your VPS public IP without a port,
//     e.g.  const SERVER_HOST = '203.0.113.42';
//     and keep USE_HTTPS = false.  API + websockets run over plain http/ws.
//
//   • Later, when you add a domain + HTTPS (Let's Encrypt):
//     set SERVER_HOST = 'api.yoursite.com' and USE_HTTPS = true.
//     Also flip `cleartext` to false in capacitor.config.ts and rebuild.
//
// REVERB_APP_KEY must match REVERB_APP_KEY in the backend's production .env.
// ===========================================================================
const SERVER_HOST = 'dreamcabs.in';
const USE_HTTPS = true;

const httpScheme = USE_HTTPS ? 'https' : 'http';
const wsScheme: 'http' | 'https' = USE_HTTPS ? 'https' : 'http';

export const environment = {
  production: true,
  apiUrl: 'https://dreamcabs.in/api/api',
  /** Login OTP via server-side MSG91 (POST /auth/otp/sms/*). Set false for Firebase. */
  useServerOtp: true,
  googleMapsApiKey: 'AIzaSyDlGsZl3dalGOAKXG5nspcI5fduHQjk3-Q',
  // Reverb websockets. Port 8080 is exposed directly by the server stack
  // (see backend deploy). With HTTPS you'd typically proxy this to 443.
  reverbAppKey: '4jsb8ggrbvcriyaskojh',
  reverbHost: SERVER_HOST,
  reverbPort: USE_HTTPS ? 443 : 8080,
  reverbScheme: wsScheme,
  /** Same Web app config as dev; `appId` must be `…:web:…`, not Android/iOS. */
  firebase: {
    apiKey: "AIzaSyCCpdahYlxnjogTRS1ZSaF3sQ6cF9DTbVY",
    authDomain: "dreamcabs-1cd27.firebaseapp.com",
    projectId: "dreamcabs-1cd27",
    storageBucket: "dreamcabs-1cd27.firebasestorage.app",
    messagingSenderId: "862449587825",
    appId: "1:862449587825:web:cc8f4f7d2df4a1d8ac2dd0",
    measurementId: "G-CLHQFG1HW1"
  },
  fcmVapidKey: "",
};
