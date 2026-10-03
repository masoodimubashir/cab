import type { CapacitorConfig } from '@capacitor/cli';
import { KeyboardResize } from '@capacitor/keyboard';

const config: CapacitorConfig = {
  appId: 'product.customer.dreamcab',
  appName: 'DREAMCABS',
  webDir: 'www',
  // Production API and websockets use HTTPS. Keep the existing local WebView
  // origin so stored sessions survive upgrades; it is not a remote API URL.
  server: {
    androidScheme: 'http',
    cleartext: false,
  },
  plugins: {
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
