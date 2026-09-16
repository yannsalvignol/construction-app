import { Tabs, TabList, TabTrigger, TabSlot } from 'expo-router/ui';

import { CustomTabList, TabButton } from './tab-bar.web';

import { useI18n } from '@/hooks/use-i18n';

export default function EmployeeTabs() {
  const { t } = useI18n();

  return (
    <Tabs>
      <TabSlot style={{ height: '100%' }} />
      <TabList asChild>
        <CustomTabList>
          <TabTrigger name="today" href="/" asChild>
            <TabButton>{t.employeeTabs.today}</TabButton>
          </TabTrigger>
          <TabTrigger name="schedule" href="/schedule" asChild>
            <TabButton>{t.employeeTabs.schedule}</TabButton>
          </TabTrigger>
          <TabTrigger name="instructions" href="/instructions" asChild>
            <TabButton>{t.employeeTabs.instructions}</TabButton>
          </TabTrigger>
          <TabTrigger name="map" href="/map" asChild>
            <TabButton>{t.employeeTabs.map}</TabButton>
          </TabTrigger>
          <TabTrigger name="report" href="/report" asChild>
            <TabButton>{t.employeeTabs.report}</TabButton>
          </TabTrigger>
          <TabTrigger name="account" href="/account" asChild>
            <TabButton>{t.employeeTabs.account}</TabButton>
          </TabTrigger>
        </CustomTabList>
      </TabList>
    </Tabs>
  );
}
