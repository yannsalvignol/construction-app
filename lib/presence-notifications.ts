import { isRunningInExpoGo } from 'expo';
import Constants from 'expo-constants';
import * as Device from 'expo-device';
import { Platform } from 'react-native';
import { supabase } from './supabase';
import type { Locale } from './i18n/locale';

const TOKEN_KEY = 'casprod:presence-push';

// Remote notifications left Expo Go in SDK 53: merely importing
// expo-notifications there throws "Cannot find native module
// 'ExpoPushTokenManager'", which used to take down every signed-in screen.
// Load it lazily and only outside Expo Go, so Expo Go simply has no push.
const Notifications: typeof import('expo-notifications') | null = isRunningInExpoGo()
  ? null
  : require('expo-notifications'); // eslint-disable-line @typescript-eslint/no-require-imports
Notifications?.setNotificationHandler({ handleNotification: async () => ({ shouldPlaySound: true, shouldSetBadge: false, shouldShowBanner: true, shouldShowList: true }) });

export async function enablePresenceNotifications(locale: Locale, requestPermission = true): Promise<boolean> {
  if (!Device.isDevice || !Notifications) return false;
  try {
    if (Platform.OS === 'android') await Notifications.setNotificationChannelAsync('presence', { name: 'Casprod · Présence', importance: Notifications.AndroidImportance.HIGH });
    let permission = await Notifications.getPermissionsAsync();
    if (!permission.granted && requestPermission) permission = await Notifications.requestPermissionsAsync();
    if (!permission.granted) return false;
    const projectId = Constants.expoConfig?.extra?.eas?.projectId ?? Constants.easConfig?.projectId;
    if (!projectId) return false;
    const token = (await Notifications.getExpoPushTokenAsync({ projectId })).data;
    const { error } = await supabase.rpc('register_presence_push', { push_token: token, language: locale });
    if (error) return false;
    localStorage.setItem(TOKEN_KEY, token);
    return true;
  } catch { return false; }
}
/**
 * The chef's side: he is not consenting to be watched, he is asking to be told
 * when one of his men stops answering, so this asks for permission outright
 * rather than waiting on an agreement he never has to give.
 */
export async function enableChefAlerts(locale: Locale): Promise<boolean> {
  if (!Device.isDevice || !Notifications) return false;
  try {
    if (Platform.OS === 'android') await Notifications.setNotificationChannelAsync('presence', { name: 'Casprod · Présence', importance: Notifications.AndroidImportance.HIGH });
    let permission = await Notifications.getPermissionsAsync();
    if (!permission.granted) permission = await Notifications.requestPermissionsAsync();
    if (!permission.granted) return false;
    const projectId = Constants.expoConfig?.extra?.eas?.projectId ?? Constants.easConfig?.projectId;
    if (!projectId) return false;
    const token = (await Notifications.getExpoPushTokenAsync({ projectId })).data;
    const { error } = await supabase.rpc('register_chef_push', { push_token: token, language: locale });
    if (error) return false;
    localStorage.setItem(TOKEN_KEY, token);
    return true;
  } catch { return false; }
}

export async function unregisterPresenceNotifications() {
  const token = localStorage.getItem(TOKEN_KEY);
  if (token) await supabase.rpc('unregister_presence_push', { push_token: token });
  localStorage.removeItem(TOKEN_KEY);
}
export function onPresenceNotification(callback: () => void) {
  if (!Notifications) return () => {};
  const received = Notifications.addNotificationReceivedListener(callback);
  const opened = Notifications.addNotificationResponseReceivedListener(callback);
  return () => { received.remove(); opened.remove(); };
}
