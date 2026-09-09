import React from 'react';
import { Host, Picker } from '@expo/ui';
import { ActivityIndicator, Modal, Pressable, ScrollView, StyleSheet, TextInput, View, type TextInputProps } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ThemedText } from './themed-text';
import { useTheme } from '@/hooks/use-theme';
import { useI18n } from '@/hooks/use-i18n';
import { workCopy } from '@/lib/work-copy';

export function WorkPage({ title, subtitle, titleAccessory, children }: {
  title: string; subtitle?: string;
  /** Sits to the right of the heading, for a control that acts on the whole page. */
  titleAccessory?: React.ReactNode;
  children: React.ReactNode;
}) {
  const theme = useTheme();
  return <SafeAreaView edges={['left', 'right', 'bottom']} style={{ flex: 1, backgroundColor: theme.background }}>
    <ScrollView keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag" contentContainerStyle={styles.page}>
      <View style={{ gap: 8, marginBottom: 8 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
          <ThemedText style={[styles.heading, { flex: 1 }]}>{title}</ThemedText>
          {titleAccessory}
        </View>
        {subtitle && <ThemedText themeColor="textSecondary">{subtitle}</ThemedText>}</View>
      {children}
    </ScrollView>
  </SafeAreaView>;
}
export function Card({ children, accent = false }: { children: React.ReactNode; accent?: boolean }) {
  const theme = useTheme();
  return <View style={[styles.card, { backgroundColor: accent ? theme.accentSoft : theme.backgroundElement, borderColor: accent ? theme.accent : theme.backgroundSelected }]}>{children}</View>;
}
export function Action({ label, onPress, disabled, busy, secondary = false }: { label: string; onPress: () => void; disabled?: boolean; busy?: boolean; secondary?: boolean }) {
  const theme = useTheme();
  return <Pressable accessibilityRole="button" accessibilityState={{ disabled: disabled || busy, busy }} disabled={disabled || busy} onPress={onPress}
    style={({ pressed }) => [styles.action, { backgroundColor: secondary ? theme.accentSoft : theme.accent, opacity: disabled || busy ? 0.5 : pressed ? 0.8 : 1 }]}>
    {busy && <ActivityIndicator color={secondary ? theme.accentText : theme.buttonText} />}
    <ThemedText type="smallBold" style={{ color: secondary ? theme.accentText : theme.buttonText, textAlign: 'center', flexShrink: 1 }}>{label}</ThemedText>
  </Pressable>;
}
export function Field(props: TextInputProps) {
  const theme = useTheme();
  return <TextInput placeholderTextColor={theme.textSecondary} keyboardAppearance={theme.isDark ? 'dark' : 'light'} {...props}
    style={[styles.field, { color: theme.text, backgroundColor: theme.backgroundElement, borderColor: theme.backgroundSelected }, props.style]} />;
}
export function Feedback({ message, success = false }: { message?: string | null; success?: boolean }) {
  const theme = useTheme();
  if (!message) return null;
  return <ThemedText accessibilityRole="alert" style={{ color: success ? theme.success : theme.danger }}>{message}</ThemedText>;
}
export function Select({ label, value, options, onChange }: { label: string; value: string; options: { value: string; label: string }[]; onChange: (value: string) => void }) {
  const theme = useTheme();
  const { locale } = useI18n();
  const copy = workCopy(locale);
  const [open, setOpen] = React.useState(false);
  return <View style={{ gap: 8 }}>
    <ThemedText type="smallBold">{label}</ThemedText>
    <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={() => setOpen(true)} style={[styles.field, { borderColor: theme.backgroundSelected, backgroundColor: theme.backgroundElement }]}>
      <ThemedText>{options.find(o => o.value === value)?.label ?? label} ▾</ThemedText>
    </Pressable>
    <Modal visible={open} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setOpen(false)}>
      <WorkPage title={label}>
        <Action secondary label={copy.close} onPress={() => setOpen(false)} />
        {options.map(option => <Pressable key={option.value} accessibilityRole="radio" accessibilityState={{ checked: option.value === value }} onPress={() => { onChange(option.value); setOpen(false); }}
          style={[styles.field, { backgroundColor: option.value === value ? theme.accentSoft : theme.backgroundElement, borderColor: theme.backgroundSelected }]}>
          <ThemedText style={{ color: option.value === value ? theme.accentText : theme.text }}>{option.label}</ThemedText>
        </Pressable>)}
      </WorkPage>
    </Modal>
  </View>;
}
/**
 * Spin wheel for a bounded number, preferred over the keyboard on site: it is
 * usable with gloves and can only produce a value that is already valid.
 * `appearance="wheel"` is an inline rotor on iOS and falls back to the platform
 * dropdown on Android and web.
 */
export function NumberWheel({ label, value, values, min = 0, max = 0, step = 1, decimals = 0, suffix, onChange }: {
  label: string; value: number; values?: number[]; min?: number; max?: number; step?: number; decimals?: number;
  /** Shown on every option, so the unit is read off the wheel and not guessed. */
  suffix?: string;
  onChange: (value: number) => void;
}) {
  const options = React.useMemo(() => {
    if (values) return values;
    const list: number[] = [];
    for (let n = min; n <= max + 1e-9; n += step) list.push(Number(n.toFixed(decimals)));
    return list;
  }, [values, min, max, step, decimals]);
  return <View style={{ gap: 4 }}>
    <ThemedText type="smallBold">{label}</ThemedText>
    <Host matchContents={{ vertical: true }} style={{ width: '100%' }}>
      <Picker selectedValue={value} onValueChange={next => onChange(Number(next))} appearance="wheel">
        {options.map(n => <Picker.Item key={n} label={suffix ? `${n.toFixed(decimals)} ${suffix}` : n.toFixed(decimals)} value={n} />)}
      </Picker>
    </Host>
  </View>;
}

const styles = StyleSheet.create({
  page: { padding: 20, paddingBottom: 100, gap: 20, width: '100%', maxWidth: 800, alignSelf: 'center' },
  heading: { fontSize: 30, lineHeight: 38, fontWeight: '700', letterSpacing: -0.8 },
  card: { borderRadius: 24, borderWidth: 1, padding: 22, gap: 16 },
  action: { minHeight: 50, borderRadius: 16, padding: 14, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 10 },
  field: { borderWidth: 1, borderRadius: 14, padding: 14, minHeight: 50, fontSize: 16 },
});
