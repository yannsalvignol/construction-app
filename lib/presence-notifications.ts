import Constants from 'expo-constants';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import { supabase } from './supabase';
import type { Locale } from './i18n/locale';

const TOKEN_KEY = 'casprod:presence-push';
Notifications.setNotificationHandler({ handleNotification: async () => ({ shouldPlaySound: true, shouldSetBadge: false, shouldShowBanner: true, shouldShowList: true }) });

export async function enablePresenceNotifications(locale: Locale, requestPermission = true): Promise<boolean> {
  if (!Device.isDevice) return false;
  try {
    if (Platform.OS === 'android') await Notifications.setNotificationChannelAsync('presence', { name: 'CASPROD · Présence', importance: Notifications.AndroidImportance.HIGH });
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
export async function unregisterPresenceNotifications() {
  const token = localStorage.getItem(TOKEN_KEY);
  if (token) await supabase.rpc('unregister_presence_push', { push_token: token });
  localStorage.removeItem(TOKEN_KEY);
}
export function onPresenceNotification(callback: () => void) {
  const received = Notifications.addNotificationReceivedListener(callback);
  const opened = Notifications.addNotificationResponseReceivedListener(callback);
  return () => { received.remove(); opened.remove(); };
}
