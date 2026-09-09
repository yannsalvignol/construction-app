import { useState } from 'react';
import { Pressable, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { ThemedText } from './themed-text';
import { useI18n } from '@/hooks/use-i18n';
import { useTheme } from '@/hooks/use-theme';
import { formatElapsed, workCopy } from '@/lib/work-copy';

/**
 * Time inside the site zone against time away. Both are accumulated server-side
 * from live positions without keeping any of them, so this reports durations, not
 * a route. Time with no reading is attributed to neither and simply not shown.
 */
export function ZoneTime({ secondsInside, secondsOutside }: { secondsInside: number; secondsOutside: number }) {
  const { locale } = useI18n();
  const copy = workCopy(locale);
  const theme = useTheme();
  const away = secondsOutside > 0;
  const [explained, setExplained] = useState(false);
  return <View style={{ gap: 8 }}>
    {/* Top-right, where an info affordance is expected. The rule matters but is not
        read every day, so it stays behind the icon. */}
    <Pressable accessibilityRole="button" accessibilityLabel={copy.zoneHint}
      accessibilityState={{ expanded: explained }}
      onPress={() => setExplained(!explained)}
      hitSlop={12} style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1, alignSelf: 'flex-end' })}>
      <Ionicons name="information-circle-outline" size={20} color={theme.textSecondary} />
    </Pressable>
    <View style={{ flexDirection: 'row', gap: 10 }}>
      {[
        { label: copy.onSite, seconds: secondsInside, tint: theme.success },
        { label: copy.offSite, seconds: secondsOutside, tint: away ? theme.danger : theme.textSecondary },
      ].map(chip => <View key={chip.label} style={{
        flex: 1, paddingVertical: 12, paddingHorizontal: 14, borderRadius: 14, gap: 2,
        borderWidth: 1, borderColor: chip.tint, backgroundColor: theme.backgroundElement,
      }}>
        <ThemedText style={{ fontSize: 20, fontWeight: '700', color: chip.tint }}>
          {formatElapsed(chip.seconds * 1000, copy)}
        </ThemedText>
        <ThemedText type="small" themeColor="textSecondary">{chip.label}</ThemedText>
      </View>)}
    </View>
    {explained && <ThemedText type="small" themeColor="textSecondary">{copy.zoneHint}</ThemedText>}
  </View>;
}
