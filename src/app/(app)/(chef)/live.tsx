import { useState } from 'react';
import { Pressable, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { LiveTeamMap } from '@/components/live-team-map';
import { ThemedText } from '@/components/themed-text';
import { pageStyles } from '@/components/work-ui';
import { useI18n } from '@/hooks/use-i18n';
import { useTheme } from '@/hooks/use-theme';
import { workCopy } from '@/lib/work-copy';

export default function LiveTeamScreen() {
  const { locale } = useI18n();
  const copy = workCopy(locale);
  const theme = useTheme();
  // The rule is read once and then known; the map is what the chef comes back for.
  const [explained, setExplained] = useState(false);

  // The heading scrolls away with the page while the map stays pinned (see
  // LiveTeamMap), so this screen owns its header instead of using WorkPage.
  return <LiveTeamMap header={
    <View style={{ gap: 8 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
        <ThemedText style={[pageStyles.heading, { flex: 1 }]}>{copy.liveTitle}</ThemedText>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={copy.liveHint}
          accessibilityState={{ expanded: explained }}
          onPress={() => setExplained(!explained)}
          hitSlop={12}
          style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}>
          <Ionicons name={explained ? 'chevron-up-outline' : 'chevron-down-outline'} size={22} color={theme.textSecondary} />
        </Pressable>
      </View>
      {explained && <ThemedText type="small" themeColor="textSecondary">{copy.liveHint}</ThemedText>}
    </View>
  } />;
}
