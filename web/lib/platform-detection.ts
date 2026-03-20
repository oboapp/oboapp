/**
 * Platform detection utilities for handling iOS Safari and PWA installation
 */

export interface PlatformInfo {
  isIOS: boolean;
  isSafari: boolean;
  isIOSSafari: boolean;
  isPWA: boolean;
  supportsNotifications: boolean;
  requiresPWAInstall: boolean;
}

/**
 * Detect if the browser is running on iOS
 */
export function isIOS(): boolean {
  if (typeof globalThis.window === "undefined") return false;

  const userAgent = globalThis.window.navigator.userAgent.toLowerCase();
  return /iphone|ipad|ipod/.test(userAgent);
}

/**
 * Detect if the browser is Safari
 */
export function isSafari(): boolean {
  if (typeof globalThis.window === "undefined") return false;

  const userAgent = globalThis.window.navigator.userAgent.toLowerCase();
  // Safari detection: has Safari in UA but not Chrome/Chromium/CriOS
  return (
    /safari/.test(userAgent) &&
    !/chrome|chromium|crios|fxios|edgios/.test(userAgent)
  );
}

/**
 * Detect if the app is installed as a PWA (running in standalone mode)
 */
export function isPWA(): boolean {
  if (typeof globalThis.window === "undefined") return false;

  // Check if running in standalone mode (PWA installed)
  const standaloneMatch = globalThis.window.matchMedia(
    "(display-mode: standalone)"
  ).matches;

  // Check iOS-specific standalone property
  const nav: Navigator & { standalone?: boolean } = globalThis.window.navigator;
  const iosStandalone =
    "standalone" in nav &&
    nav.standalone === true;

  return standaloneMatch || iosStandalone;
}

/**
 * Get comprehensive platform information
 */
export function getPlatformInfo(): PlatformInfo {
  const ios = isIOS();
  const safari = isSafari();
  const iosSafari = ios && safari;
  const pwa = isPWA();

  // iOS Safari only supports notifications in PWA mode (iOS 16.4+)
  const supportsNotifications = !iosSafari || (iosSafari && pwa);

  // iOS Safari requires PWA installation for notifications
  const requiresPWAInstall = iosSafari && !pwa;

  return {
    isIOS: ios,
    isSafari: safari,
    isIOSSafari: iosSafari,
    isPWA: pwa,
    supportsNotifications,
    requiresPWAInstall,
  };
}

/**
 * Get user-friendly instructions for enabling notifications on the current platform
 */
export function getNotificationInstructions(platformInfo: PlatformInfo): string {
  if (platformInfo.requiresPWAInstall) {
    return (
      "За да получаваш известия на iOS Safari:\n\n" +
      "1. Натисни бутона за споделяне (иконата със стрелка)\n" +
      "2. Избери 'Add to Home Screen' (Добави към началния екран)\n" +
      "3. Отвори приложението от началния екран\n" +
      "4. Разреши известията когато бъдеш попитан"
    );
  }

  if (!platformInfo.supportsNotifications) {
    return "За съжаление, този браузър не поддържа известия.";
  }

  return "";
}
