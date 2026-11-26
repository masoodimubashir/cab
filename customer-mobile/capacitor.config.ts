import type { CapacitorConfig } from '@capacitor/cli';
import { KeyboardResize } from '@capacitor/keyboard';

// Carpool test build (CARPOOL_TEST=1): the page may call http://localhost (the laptop, through adb reverse).
const carpoolTest = !!process.env['CARPOOL_TEST'];

const config: CapacitorConfig = {
  appId: 'product.customer.dreamcab',
  appName: 'DREAMCABS',
  webDir: 'www',
  // The web view's colour before the first page paints: white like the welcome page (dark mode showed grey).
  backgroundColor: '#FFFFFF',
  // Production API and websockets use HTTPS. Keep the existing local WebView
  // origin so stored sessions survive upgrades; it is not a remote API URL.
  server: {
    androidScheme: 'http',
    cleartext: carpoolTest,
  },
  plugins: {
    // Page draws behind the phone's button bar; dark icons because every main screen is light.
    SystemBars: {
      insetsHandling: 'css',
      style: 'LIGHT',
    },
    FirebaseAuthentication: {
      skipNativeAuth: false,
      providers: ['google.com'],
    },
    Keyboard: {
      resize: KeyboardResize.None,
      resizeOnFullScreen: false,
    },
  },
};

export default config;
