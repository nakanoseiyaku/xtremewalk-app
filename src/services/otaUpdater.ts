import { Capacitor } from '@capacitor/core';
import { App } from '@capacitor/app';
import { CapacitorUpdater } from '@capgo/capacitor-updater';

// version.json + bundle.zip are published as GitHub Release assets (tag "ota")
// by .github/workflows/ota-build.yml on every push to the branch.
const VERSION_URL =
  'https://github.com/nakanoseiyaku/xtremewalk-app/releases/download/ota/version.json';

let checking = false;
let pendingVersion: string | null = null;

interface RemoteVersion {
  version?: string;
  url?: string;
}

/**
 * Over-the-air updates for the web layer (HTML/JS/CSS). The native shell (APK)
 * is untouched — native feature changes still require an APK reinstall.
 * Web only / no-op on the browser build.
 */
export async function initOtaUpdates(): Promise<void> {
  if (!Capacitor.isNativePlatform()) return;
  // Confirm the running bundle is good so the plugin never rolls it back.
  try {
    await CapacitorUpdater.notifyAppReady();
  } catch {
    // ignore — not fatal
  }
  void checkForUpdate();
  void App.addListener('resume', () => {
    void checkForUpdate();
  });
}

async function checkForUpdate(): Promise<void> {
  if (!Capacitor.isNativePlatform() || checking) return;
  checking = true;
  try {
    const res = await fetch(`${VERSION_URL}?t=${Date.now()}`, { cache: 'no-store' });
    if (!res.ok) return;
    const remote = (await res.json()) as RemoteVersion;
    if (!remote.version || !remote.url) return;
    if (remote.version === pendingVersion) return; // already downloaded this session

    const current = await CapacitorUpdater.current();
    if (current.bundle?.version === remote.version) return; // already on the latest

    const bundle = await CapacitorUpdater.download({
      version: remote.version,
      url: remote.url,
    });
    // Activate on the next app launch / background — non-disruptive mid-race.
    await CapacitorUpdater.next({ id: bundle.id });
    pendingVersion = remote.version;
  } catch {
    // offline, or the release is not published yet — retry on next launch/resume
  } finally {
    checking = false;
  }
}
