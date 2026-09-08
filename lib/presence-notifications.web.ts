import type { Locale } from './i18n/locale';
export async function enablePresenceNotifications(_locale: Locale, _requestPermission = true) { return false; }
export async function unregisterPresenceNotifications() {}
export function onPresenceNotification(_callback: () => void) { return () => {}; }
