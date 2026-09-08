import { View } from 'react-native';
import { ThemedText } from './themed-text';
import { useTheme } from '@/hooks/use-theme';

export type Rule = { label: string; met: boolean };

/**
 * Live requirements for a field, each one green once satisfied. Every rule listed
 * here must be a rule that actually blocks submission: showing an unmet condition
 * that does not block would send somebody hunting for a problem that isn't there.
 */
export function RuleChecklist({ rules }: { rules: Rule[] }) {
  const theme = useTheme();
  return <View style={{ gap: 6 }}>
    {rules.map(rule => <View key={rule.label} style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 8 }}>
      <ThemedText
        accessibilityElementsHidden
        type="smallBold"
        style={{ color: rule.met ? theme.success : theme.danger, width: 16 }}>
        {rule.met ? '✓' : '✗'}
      </ThemedText>
      {/* The state is spoken as part of the label so a screen reader is not left
          with a bare tick character to interpret. */}
      <ThemedText
        type="small"
        accessibilityLabel={`${rule.label} — ${rule.met ? '✓' : '✗'}`}
        style={{ flex: 1, color: rule.met ? theme.success : theme.textSecondary }}>
        {rule.label}
      </ThemedText>
    </View>)}
  </View>;
}
