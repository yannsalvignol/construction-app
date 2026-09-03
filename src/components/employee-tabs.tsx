import { NativeTabs } from 'expo-router/unstable-native-tabs';
import { useColorScheme } from 'react-native';

import { Colors } from '@/constants/theme';
import { useI18n } from '@/hooks/use-i18n';

export default function EmployeeTabs() {
  const { t } = useI18n();
  const scheme = useColorScheme();
  const colors = Colors[scheme === 'unspecified' ? 'light' : scheme];

  return (
    <NativeTabs
      backgroundColor={colors.background}
      indicatorColor={colors.backgroundElement}
      labelStyle={{ selected: { color: colors.text } }}>
      <NativeTabs.Trigger name="index">
        <NativeTabs.Trigger.Label>{t.employeeTabs.today}</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf="house" md="home" />
      </NativeTabs.Trigger>

      <NativeTabs.Trigger name="instructions">
        <NativeTabs.Trigger.Label>{t.employeeTabs.instructions}</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf="megaphone" md="campaign" />
      </NativeTabs.Trigger>

      <NativeTabs.Trigger name="map">
        <NativeTabs.Trigger.Label>{t.employeeTabs.map}</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf="map" md="map" />
      </NativeTabs.Trigger>

      <NativeTabs.Trigger name="report">
        <NativeTabs.Trigger.Label>{t.employeeTabs.report}</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf="exclamationmark.bubble" md="report_problem" />
      </NativeTabs.Trigger>

      <NativeTabs.Trigger name="account">
        <NativeTabs.Trigger.Label>{t.employeeTabs.account}</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf="person.crop.circle" md="person" />
      </NativeTabs.Trigger>
    </NativeTabs>
  );
}
