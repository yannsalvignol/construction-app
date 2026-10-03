import React from 'react';
import { BrandSpinner } from '@/components/brand-spinner';
import { Host, Picker } from '@expo/ui';
import { Modal, Pressable, ScrollView, StyleSheet, TextInput, View, type TextInputProps } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Animated, {
  interpolateColor, useAnimatedStyle, useSharedValue, withSequence, withTiming,
} from 'react-native-reanimated';
import { ThemedText } from './themed-text';
import { cardShadow } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useI18n } from '@/hooks/use-i18n';
import { workCopy } from '@/lib/work-copy';

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

export function WorkPage({ title, subtitle, titleAccessory, topInset = false, children }: {
  title: string; subtitle?: string;
  /** Sits to the right of the heading, for a control that acts on the whole page. */
  titleAccessory?: React.ReactNode;
  /**
   * For a page shown outside the tabs, which has nothing above it to hold the
   * heading clear of the status bar. Inside the tabs the native container
   * already does, and asking for it twice would push the page down.
   */
  topInset?: boolean;
  children: React.ReactNode;
}) {
  const theme = useTheme();
  // No bottom edge: the page scrolls under the home indicator; its own bottom
  // padding keeps the last item clear of it.
  return <SafeAreaView
    edges={topInset ? ['top', 'left', 'right'] : ['left', 'right']}
    style={{ flex: 1, backgroundColor: theme.background }}>
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
/**
 * The employee's cards read like the chef's: a white surface lifted by a
 * shadow rather than outlined, and no purple fill. `accent` marks a card as
 * the one that matters right now with a thin accent edge, which is enough
 * without repainting the whole thing.
 */
export function Card({ children, accent = false }: { children: React.ReactNode; accent?: boolean }) {
  const theme = useTheme();
  return (
    <View
      style={[
        styles.card,
        cardShadow(theme.isDark),
        {
          backgroundColor: theme.backgroundElement,
          borderColor: accent ? theme.accent : 'transparent',
        },
      ]}>
      {children}
    </View>
  );
}
export function Action({ label, onPress, disabled, busy, secondary = false, large = false, tone }: {
  label: string; onPress: () => void; disabled?: boolean; busy?: boolean; secondary?: boolean;
  /** For the one action a screen exists for, pressed with a glove on a chantier. */
  large?: boolean;
  /**
   * "finish" closes something that was running. It takes the success tone, not
   * the danger one: ending a day is the day going well, and red would read as a
   * warning about an ordinary act.
   */
  tone?: 'finish';
}) {
  const theme = useTheme();
  const fill = tone === 'finish' ? theme.successFill : theme.accent;
  return <Pressable accessibilityRole="button" accessibilityState={{ disabled: disabled || busy, busy }} disabled={disabled || busy} onPress={onPress}
    // Secondary is an outlined oval, as on the chef's screens, rather than a
    // second purple surface competing with the real action.
    style={({ pressed }) => [styles.action, large && styles.actionLarge, {
      backgroundColor: secondary ? 'transparent' : fill,
      borderWidth: secondary ? 1 : 0,
      borderColor: theme.text,
      opacity: disabled || busy ? 0.5 : pressed ? 0.8 : 1,
    }]}>
    {busy && <BrandSpinner color={secondary ? theme.accentText : theme.buttonText} />}
    <ThemedText type="smallBold" style={{ color: secondary ? theme.text : theme.buttonText, textAlign: 'center', flexShrink: 1 }}>{label}</ThemedText>
  </Pressable>;
}
/**
 * The two hours a declared day runs between, read off the duration wheel.
 *
 * Recessed inside the card rather than another raised surface: it is a readout
 * of the control above it, not a second thing to act on. The hours carry the
 * weight because they are what is being chosen — a worker picking between seven
 * and seven thirty is deciding whether he finishes before or after a quarter to
 * four, not counting hours.
 */
export function ShiftSpan({ startLabel, endLabel, start, end, middle }: {
  startLabel: string; endLabel: string; start: string; end: string; middle: string;
}) {
  const theme = useTheme();
  return (
    <View style={[styles.span, { backgroundColor: theme.backgroundInput }]}>
      <View style={styles.spanEnd}>
        <ThemedText type="small" themeColor="textSecondary">{startLabel}</ThemedText>
        <ThemedText style={styles.spanTime}>{start}</ThemedText>
      </View>

      <View style={styles.spanMiddle}>
        <ThemedText type="smallBold" themeColor="accentText">{middle}</ThemedText>
        <View style={[styles.spanRail, { backgroundColor: theme.separator }]} />
      </View>

      <View style={[styles.spanEnd, { alignItems: 'flex-end' }]}>
        <ThemedText type="small" themeColor="textSecondary">{endLabel}</ThemedText>
        <ThemedText style={styles.spanTime}>{end}</ThemedText>
      </View>
    </View>
  );
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
export function Select({ label, value, options, missing = false, refusedAt = 0, onChange }: {
  label: string; value: string; options: { value: string; label: string }[];
  /** Marked when an action was refused for want of this answer, not on sight:
   *  a field is not wrong until somebody has tried to go on without it. */
  missing?: boolean;
  /**
   * Bumped on every refusal, not just the first. Pressing a button twice and
   * seeing nothing change the second time reads as the app having stopped
   * listening, so each press lights the field again.
   */
  refusedAt?: number;
  onChange: (value: string) => void;
}) {
  const theme = useTheme();
  const { locale } = useI18n();
  const copy = workCopy(locale);
  const [open, setOpen] = React.useState(false);

  const flash = useSharedValue(0);
  React.useEffect(() => {
    if (!refusedAt) return;
    // Up fast so it is seen, down slowly so it is not a blink.
    flash.value = withSequence(
      withTiming(1, { duration: 90 }),
      withTiming(0, { duration: 520 })
    );
  }, [refusedAt, flash]);

  const flashStyle = useAnimatedStyle(() => ({
    backgroundColor: interpolateColor(
      flash.value, [0, 1], [theme.backgroundElement, theme.warningSoft]
    ),
  }));
  return <View style={{ gap: 8 }}>
    <ThemedText type="smallBold" themeColor={missing ? 'warning' : undefined}>{label}</ThemedText>
    <AnimatedPressable accessibilityRole="button" accessibilityLabel={label} onPress={() => setOpen(true)}
      style={[styles.field, {
        borderColor: missing ? theme.warning : theme.backgroundSelected,
        borderWidth: missing ? 2 : 1,
      }, flashStyle]}>
      <ThemedText themeColor={missing ? 'warning' : undefined}>
        {options.find(o => o.value === value)?.label ?? label} ▾
      </ThemedText>
    </AnimatedPressable>
    <Modal visible={open} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setOpen(false)}>
      <WorkPage title={label}>
        <Action secondary label={copy.close} onPress={() => setOpen(false)} />
        {options.map(option => <Pressable key={option.value} accessibilityRole="radio" accessibilityState={{ checked: option.value === value }} onPress={() => { onChange(option.value); setOpen(false); }}
          style={[styles.field, styles.option, {
            backgroundColor: theme.backgroundElement,
            borderColor: option.value === value ? theme.text : theme.backgroundSelected,
          }]}>
          <ThemedText style={{ flex: 1 }}>{option.label}</ThemedText>
          {option.value === value && <ThemedText type="smallBold">✓</ThemedText>}
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
export function NumberWheel({ label, value, values, min = 0, max = 0, step = 1, decimals = 0, suffix, format, onChange }: {
  label: string; value: number; values?: number[]; min?: number; max?: number; step?: number; decimals?: number;
  /** Shown on every option, so the unit is read off the wheel and not guessed. */
  suffix?: string;
  /** For a quantity that is not read as a decimal — 7.5 hours is "7 h 30". */
  format?: (value: number) => string;
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
        {options.map(n => (
          <Picker.Item
            key={n}
            label={format ? format(n) : suffix ? `${n.toFixed(decimals)} ${suffix}` : n.toFixed(decimals)}
            value={n}
          />
        ))}
      </Picker>
    </Host>
  </View>;
}

const styles = StyleSheet.create({
  page: { padding: 20, paddingBottom: 100, gap: 20, width: '100%', maxWidth: 800, alignSelf: 'center' },
  heading: { fontSize: 30, lineHeight: 38, fontWeight: '700', letterSpacing: -0.8 },
  card: { borderRadius: 20, borderWidth: 1, padding: 22, gap: 16 },
  action: { minHeight: 52, borderRadius: 999, padding: 14, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 10 },
  actionLarge: { minHeight: 68, paddingVertical: 20 },
  span: { flexDirection: 'row', alignItems: 'center', gap: 12, borderRadius: 14, paddingVertical: 14, paddingHorizontal: 16 },
  spanEnd: { gap: 2 },
  spanTime: { fontSize: 26, lineHeight: 30, fontWeight: '700', letterSpacing: -0.5, fontVariant: ['tabular-nums'] },
  /** Carries the eye from one hour to the other, under the duration it spans. */
  spanMiddle: { flex: 1, alignItems: 'center', gap: 6, paddingTop: 10 },
  spanRail: { height: 1, alignSelf: 'stretch' },
  field: { borderWidth: 1, borderRadius: 14, padding: 14, minHeight: 50, fontSize: 16 },
  option: { flexDirection: 'row', alignItems: 'center', gap: 10 },
});
/** For screens that need their own scroll view but the same page metrics as WorkPage. */
export const pageStyles = { page: styles.page, heading: styles.heading };
