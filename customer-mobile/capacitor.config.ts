import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.dreamcabs.customer',
  appName: 'DreamCabs',
  webDir: 'www',
  // Allow plain-HTTP (cleartext) requests. Needed for: (a) live-reload to the
  // laptop's http://<LAN-IP>:8100 dev server, and (b) talking to the
  // production API over http://<SERVER-IP> while there is no domain/SSL yet.
  // The app itself is still served from https://localhost (androidScheme
  // default). Once you add a domain + HTTPS, set this to false.
  server: {
    // Serve the webview over http://localhost (not the https default) so plain
    // http:// API calls aren't blocked as mixed content while there's no SSL.
    // Switch back to 'https' (or remove) once the API is served over HTTPS.
    androidScheme: 'http',
    cleartext: true,
  },
  plugins: {
    FirebaseAuthentication: {
      skipNativeAuth: false,
      providers: ['google.com'],
    },
  },
};

export default config;
