import { View } from 'react-native';
import Animated, { LinearTransition } from 'react-native-reanimated';
import { ThemedText } from './themed-text';
import { useI18n } from '@/hooks/use-i18n';
import { unitShort, workCopy } from '@/lib/work-copy';
import type { Workspace } from '@/lib/presence';

/**
 * What has been declared today, read-only. Shared by the task form and the day
 * screen so the two can never drift into showing different totals.
 */
export function DeclaredTasks({ data }: { data: Workspace }) {
  const { locale } = useI18n();
  const copy = workCopy(locale);
  const label = locale === 'en' ? 'label_en' : 'label_fr';
  if (!data.declarations.length) {
    return <ThemedText type="small" themeColor="textSecondary">{copy.noTasks}</ThemedText>;
  }
  return <View style={{ gap: 8 }}>
    {data.declarations.map(declaration => {
      const item = data.codes.find(code => code.code === declaration.task_code);
      return <Animated.View key={declaration.id} layout={LinearTransition}
        style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 12 }}>
        <ThemedText type="small" style={{ flex: 1 }}>{item?.[label] ?? declaration.task_code}</ThemedText>
        <ThemedText type="smallBold">{declaration.quantity} {item ? unitShort(item.unit, copy) : ''}</ThemedText>
      </Animated.View>;
    })}
  </View>;
}
