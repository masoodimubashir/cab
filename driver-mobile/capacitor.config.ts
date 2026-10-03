import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'product.driver.dreamcab',
  appName: 'CABBIES',
  webDir: 'www',
  // Production API and websockets use HTTPS.
  server: {
    cleartext: false,
  },
  plugins: {
    FirebaseAuthentication: {
      skipNativeAuth: false,
      providers: ['google.com'],
    },
  },
};

export default config;
