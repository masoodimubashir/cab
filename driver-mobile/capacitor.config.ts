import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.dreamcabs.driver',
  appName: 'DreamCabs Driver',
  webDir: 'www',
  // Allow plain-HTTP (cleartext) requests. Needed for: (a) live-reload to the
  // laptop's http://<LAN-IP>:8200 dev server, and (b) talking to the
  // production API over http://<SERVER-IP> while there is no domain/SSL yet.
  // The app itself is still served from https://localhost (androidScheme
  // default). Once you add a domain + HTTPS, set this to false.
  server: {
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
