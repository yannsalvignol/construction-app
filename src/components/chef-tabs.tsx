'use no memo';

import { usePathname, useRouter } from 'expo-router';
import { Tabs, TabList, TabTrigger, TabSlot } from 'expo-router/ui';
import { useEffect, useRef } from 'react';
import { useWindowDimensions, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated';

import { AppHeader } from './app-header';
import { CHEF_TAB_BAR_HEIGHT, ChefTabButton, ChefTabList } from './chef-tab-bar';

import { useI18n } from '@/hooks/use-i18n';

const SWIPE_THRESHOLD = 50;

export default function ChefTabs() {
  const { t } = useI18n();
  const pathname = usePathname();
  const router = useRouter();
  const { width } = useWindowDimensions();
  const isAccount = pathname === '/account';

  const lastMainTab = useSharedValue('/');
  const translateX = useSharedValue(0);
  const didMount = useRef(false);

  if (!isAccount) {
    lastMainTab.value = pathname;
  }

  function goTo(href: string) {
    router.navigate(href as never);
  }

  useEffect(() => {
    if (!didMount.current) {
      didMount.current = true;
      return;
    }
    translateX.value = isAccount ? width : -width;
    translateX.value = withTiming(0, { duration: 220 });
    // Only the account/main-tab boundary should trigger the slide-in.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAccount]);

  /* eslint-disable react-hooks/immutability -- Reanimated shared values are meant to be
     mutated outside the render/effect model; this predates the compiler's understanding of them. */
  const swipeGesture = Gesture.Pan()
    .activeOffsetX([-20, 20])
    .failOffsetY([-20, 20])
    .onUpdate((event) => {
      const draggingToAccount = event.translationX < 0 && !isAccount;
      const draggingBack = event.translationX > 0 && isAccount;
      if (draggingToAccount || draggingBack) {
        translateX.value = event.translationX;
      }
    })
    .onEnd((event) => {
      const swipingToAccount = event.translationX <= -SWIPE_THRESHOLD && !isAccount;
      const swipingBack = event.translationX >= SWIPE_THRESHOLD && isAccount;

      if (swipingToAccount) {
        translateX.value = withTiming(-width, { duration: 180 }, (finished) => {
          if (finished) runOnJS(goTo)('/account');
        });
      } else if (swipingBack) {
        translateX.value = withTiming(width, { duration: 180 }, (finished) => {
          if (finished) runOnJS(goTo)(lastMainTab.value);
        });
      } else {
        translateX.value = withSpring(0, { damping: 20, stiffness: 200 });
      }
    });
  /* eslint-enable react-hooks/immutability */

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: translateX.value }],
  }));

  return (
    <View style={{ flex: 1 }}>
      <AppHeader />
      <Tabs style={{ flex: 1 }}>
        <GestureDetector gesture={swipeGesture}>
          <Animated.View
            style={[
              { flex: 1, paddingTop: isAccount ? 0 : CHEF_TAB_BAR_HEIGHT },
              animatedStyle,
            ]}>
            <TabSlot style={{ flex: 1 }} />
          </Animated.View>
        </GestureDetector>

        <TabList asChild>
          <ChefTabList hidden={isAccount}>
            <TabTrigger name="home" href="/" asChild>
              <ChefTabButton icon={{ ios: 'house', android: 'home', web: 'home' }}>
                {t.chefTabs.home}
              </ChefTabButton>
            </TabTrigger>
            <TabTrigger name="employees" href="/employees" asChild>
              <ChefTabButton icon={{ ios: 'person.2', android: 'group', web: 'group' }}>
                {t.chefTabs.employees}
              </ChefTabButton>
            </TabTrigger>
            <TabTrigger name="sites" href="/sites" asChild>
              <ChefTabButton icon={{ ios: 'map', android: 'location_on', web: 'location_on' }}>
                {t.chefTabs.sites}
              </ChefTabButton>
            </TabTrigger>
            <TabTrigger name="live" href="/live" asChild>
              <ChefTabButton icon={{ ios: 'dot.radiowaves.left.and.right', android: 'my_location', web: 'my_location' }}>
                {t.chefTabs.live}
              </ChefTabButton>
            </TabTrigger>
            <TabTrigger name="schedule" href="/schedule" asChild>
              <ChefTabButton
                icon={{ ios: 'calendar', android: 'calendar_month', web: 'calendar_month' }}>
                {t.chefTabs.schedule}
              </ChefTabButton>
            </TabTrigger>
            {/* Not shown as a pill; reachable only via swipe, the profile picture, or the app icon. */}
            <TabTrigger name="account" href="/account" style={{ display: 'none' }} />
          </ChefTabList>
        </TabList>
      </Tabs>
    </View>
  );
}
