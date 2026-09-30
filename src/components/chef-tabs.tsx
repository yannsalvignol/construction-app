'use no memo';

import { Tabs, TabList, TabTrigger, TabSlot } from 'expo-router/ui';
import { View } from 'react-native';

import { AppHeader } from './app-header';
import { CHEF_TAB_BAR_HEIGHT, ChefTabButton, ChefTabList } from './chef-tab-bar';

import { useI18n } from '@/hooks/use-i18n';

/**
 * The chef's tabs. The profile is not one of them: it is pushed over this
 * screen from the header avatar, as Réglages is pushed over the profile, so
 * every step of main → profile → réglages goes back the same way — the
 * platform's own edge swipe — instead of one level answering to a gesture of
 * its own.
 */
export default function ChefTabs() {
  const { t } = useI18n();

  return (
    <View style={{ flex: 1 }}>
      <AppHeader />
      <Tabs style={{ flex: 1 }}>
        <View style={{ flex: 1, paddingTop: CHEF_TAB_BAR_HEIGHT }}>
          <TabSlot style={{ flex: 1 }} />
        </View>

        <TabList asChild>
          <ChefTabList>
            <TabTrigger name="home" href="/" asChild>
              <ChefTabButton icon="home-outline">
                {t.chefTabs.home}
              </ChefTabButton>
            </TabTrigger>
            <TabTrigger name="employees" href="/employees" asChild>
              <ChefTabButton icon="people-outline">
                {t.chefTabs.employees}
              </ChefTabButton>
            </TabTrigger>
            <TabTrigger name="sites" href="/sites" asChild>
              <ChefTabButton icon="business-outline">
                {t.chefTabs.sites}
              </ChefTabButton>
            </TabTrigger>
            <TabTrigger name="live" href="/live" asChild>
              <ChefTabButton icon="map-outline">
                {t.chefTabs.live}
              </ChefTabButton>
            </TabTrigger>
          </ChefTabList>
        </TabList>
      </Tabs>
    </View>
  );
}
