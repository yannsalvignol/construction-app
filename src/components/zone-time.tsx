import { useState } from 'react';
import { Pressable, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { ThemedText } from './themed-text';
import { useI18n } from '@/hooks/use-i18n';
import { useTheme } from '@/hooks/use-theme';
import { formatElapsed, workCopy } from '@/lib/work-copy';

/**
 * Time inside the site zone against time away.
 *
 * Both are accumulated server-side from live positions without keeping any of
 * them, so this reports durations, not a route. Everything else about the day
 * is unmeasured: positions only arrive while the app is open or the phone is
 * moving, and a silence longer than ten minutes is attributed to neither
 * bucket, because nobody knows where he was.
 *
 * That third figure is shown rather than swallowed. Two chips reading "0 min"
 * and "0 min" against a day that has run twenty-five minutes is not an empty
 * state, it is a wrong one: it says we checked and he was nowhere. The chips
 * only appear once there is something to put in them, and the time nothing is
 * known about is named every time there is any.
 */
export function ZoneTime({ secondsInside, secondsOutside, secondsElapsed }: {
  secondsInside: number;
  secondsOutside: number;
  /** The whole day so far. What neither bucket accounts for is named. */
  secondsElapsed?: number;
}) {
  const { locale } = useI18n();
  const copy = workCopy(locale);
  const theme = useTheme();
  const away = secondsOutside > 0;
  const measured = secondsInside + secondsOutside;
  // A minute of slack: the gap between the last position and this render is
  // not news, and rounding it up would make every open day look unmeasured.
  const unmeasured = Math.max(0, Math.round((secondsElapsed ?? measured) - measured - 60));
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
    {measured > 0 && (
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
    )}
    {/* Said plainly, whether it is the whole day or the half of it the phone
        spent in a pocket with the app closed. */}
    {unmeasured > 0 && (
      <ThemedText type="small" themeColor="textSecondary">
        {measured > 0
          ? copy.zonePartly(formatElapsed(unmeasured * 1000, copy))
          : copy.zoneNothing}
      </ThemedText>
    )}
    {explained && <ThemedText type="small" themeColor="textSecondary">{copy.zoneHint}</ThemedText>}
  </View>;
}
