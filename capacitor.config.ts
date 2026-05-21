import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'jp.xtremewalk.app',
  appName: '東京エクストリームウォーク100',
  webDir: 'dist',
  android: {
    // Required by @capgo/background-geolocation to keep delivering location
    // callbacks across background transitions on Capacitor 8.
    useLegacyBridge: true,
  },
  server: {
    androidScheme: 'https',
  },
  plugins: {
    CapacitorUpdater: {
      // Manual mode: the app checks GitHub itself and applies web bundles.
      autoUpdate: false,
    },
  },
};

export default config;
