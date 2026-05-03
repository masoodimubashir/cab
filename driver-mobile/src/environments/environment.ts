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
    apiKey: "AIzaSyCc-ncv_rHNe1d3u827Clvul96QmHVKouE",
    authDomain: "schooluniverse-f5eae.firebaseapp.com",
    projectId: "schooluniverse-f5eae",
    storageBucket: "schooluniverse-f5eae.firebasestorage.app",
    messagingSenderId: "150181897223",
    appId: "1:150181897223:web:1dcd1e27e0abe696f2f6a2",
    measurementId: "G-RVFJFW9B93"
  },
};

/*
 * For easier debugging in development mode, you can import the following file
 * to ignore zone related error stack frames such as `zone.run`, `zoneDelegate.invokeTask`.
 *
 * This import should be commented out in production mode because it will have a negative impact
 * on performance if an error is thrown.
 */
// import 'zone.js/plugins/zone-error';  // Included with Angular CLI.
