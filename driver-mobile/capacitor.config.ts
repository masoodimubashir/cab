import type { CapacitorConfig } from '@capacitor/cli';

// Carpool test build (CARPOOL_TEST=1): the page may call http://localhost (the laptop, through adb reverse).
const carpoolTest = !!process.env['CARPOOL_TEST'];

const config: CapacitorConfig = {
  appId: 'product.driver.dreamcab',
  appName: 'CABBIES',
  webDir: 'www',
  // Production API and websockets use HTTPS.
  server: {
    cleartext: carpoolTest,
    ...(carpoolTest ? { androidScheme: 'http' } : {}),
  },
  plugins: {
    FirebaseAuthentication: {
      skipNativeAuth: false,
      providers: ['google.com'],
    },
  },
};

export default config;
