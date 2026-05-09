export const environment = {
  production: true,
  apiUrl: 'https://your-api.example.com/api',
  googleMapsApiKey: 'REMOVED_GOOGLE_API_KEY',
  reverbAppKey: '',
  reverbHost: '',
  reverbPort: 443,
  reverbScheme: 'https' as 'http' | 'https',
  /** Same Web app config as dev; `appId` must be `…:web:…`, not Android/iOS. */
  firebase: {
      apiKey: "REMOVED_GOOGLE_API_KEY",
    authDomain: "dreamcabs-c851f.firebaseapp.com",
    projectId: "dreamcabs-c851f",
    storageBucket: "dreamcabs-c851f.firebasestorage.app",
    messagingSenderId: "862449587825",
    appId: "1:862449587825:web:cc8f4f7d2df4a1d8ac2dd0",
    measurementId: "G-CLHQFG1HW1"
  },
  fcmVapidKey: "",
};
 