import * as Clipboard from 'expo-clipboard';
import * as Haptics from 'expo-haptics';
import { Image } from 'expo-image';
import { Stack, useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Platform, Pressable, ScrollView, StyleSheet, Switch, View } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

import { BrandSpinner } from '@/components/brand-spinner';
import { AnimatedInput } from '@/components/animated-input';
import { AppModal, ModalButton } from '@/components/app-modal';
import { PhoneInput } from '@/components/phone-input';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { cardShadow, MaxContentWidth, Spacing } from '@/constants/theme';
import { useAuthPalette } from '@/hooks/use-auth-palette';
import { useI18n } from '@/hooks/use-i18n';
import { useTheme } from '@/hooks/use-theme';
import { resolveFunctionError } from '@/lib/edge-function-error';
import { generatePassword } from '@/lib/generate-credentials';
import type { Translations } from '@/lib/i18n/en';
import { translateServerError } from '@/lib/i18n/server-errors';
import { supabase } from '@/lib/supabase';

type EmployeeDetail = {
  id: string;
  first_name: string;
  last_name: string;
  phone: string | null;
  username: string | null;
  employee_password: string | null;
  equipment_photo_required: boolean;
  clock_in_photo_required: boolean;
  notifications_enabled: boolean;
  is_active: boolean;
  location_mode: 'checkpoint' | 'live';
  avatar_url: string | null;
};

type ToggleKey =
  | 'equipment_photo_required'
  | 'clock_in_photo_required'
  | 'notifications_enabled'
  | 'is_active';

function toggles(t: Translations): { key: ToggleKey; label: string; description: string }[] {
  return [
    { key: 'is_active', ...t.employeeDetail.toggles.isActive },
    { key: 'equipment_photo_required', ...t.employeeDetail.toggles.equipmentPhoto },
    { key: 'clock_in_photo_required', ...t.employeeDetail.toggles.clockInPhoto },
    { key: 'notifications_enabled', ...t.employeeDetail.toggles.notifications },
  ];
}

export default function EmployeeDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const theme = useTheme();
  const palette = useAuthPalette();
  const { t, locale } = useI18n();

  const [employee, setEmployee] = useState<EmployeeDetail | null>(null);
  const [loading, setLoading] = useState(true);

  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [phone, setPhone] = useState('');
  const [savingInfo, setSavingInfo] = useState(false);
  const [infoError, setInfoError] = useState<string | null>(null);
  const [infoSaved, setInfoSaved] = useState(false);

  const [toggleError, setToggleError] = useState<string | null>(null);

  const [showPassword, setShowPassword] = useState(false);
  const [resettingPassword, setResettingPassword] = useState(false);
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [showSendPreview, setShowSendPreview] = useState(false);

  const fetchEmployee = useCallback(async () => {
    setLoading(true);
    const { data } = await supabase
      .from('profiles')
      .select(
        'id, first_name, last_name, phone, username, employee_password, equipment_photo_required, clock_in_photo_required, notifications_enabled, is_active, location_mode, avatar_url'
      )
      .eq('id', id)
      .single();

    if (data) {
      setEmployee(data);
      setFirstName(data.first_name);
      setLastName(data.last_name);
      setPhone(data.phone ?? '');
    }
    setLoading(false);
  }, [id]);

  useFocusEffect(useCallback(() => {
    void fetchEmployee();
  }, [fetchEmployee]));

  async function handleSaveInfo() {
    setInfoError(null);
    setInfoSaved(false);
    setSavingInfo(true);

    const { error } = await supabase
      .from('profiles')
      .update({
        first_name: firstName.trim(),
        last_name: lastName.trim(),
        phone: phone.trim() || null,
      })
      .eq('id', id);

    setSavingInfo(false);

    if (error) {
      setInfoError(translateServerError(error.message, locale));
      return;
    }
    setInfoSaved(true);
  }

  async function handleRegeneratePassword() {
    setPasswordError(null);
    setResettingPassword(true);

    const newPassword = generatePassword();
    console.log('[reset-employee-password] submitting', {
      employeeId: id,
      passwordLength: newPassword.length,
    });

    const { data, error } = await supabase.functions.invoke('reset-employee-password', {
      body: { employeeId: id, password: newPassword },
    });

    setResettingPassword(false);
    console.log('[reset-employee-password] response', { data, error });

    if (error) {
      const message = await resolveFunctionError('reset-employee-password', error);
      setPasswordError(message ? translateServerError(message, locale) : message);
      return;
    }

    console.log(`[reset-employee-password] password reset for employee ${id}`);

    setEmployee((current) => (current ? { ...current, employee_password: newPassword } : current));
    setShowPassword(true);
  }

  async function handleToggle(key: ToggleKey, value: boolean) {
    if (!employee) return;
    setToggleError(null);
    setEmployee({ ...employee, [key]: value });

    const { error } = await supabase.from('profiles').update({ [key]: value }).eq('id', id);

    if (error) {
      setEmployee((current) => (current ? { ...current, [key]: !value } : current));
      setToggleError(translateServerError(error.message, locale));
    }
  }

  async function handleLiveLocation(value: boolean) {
    if (!employee) return;
    const mode = value ? 'live' : 'checkpoint';
    setToggleError(null);
    setEmployee({ ...employee, location_mode: mode });

    const { error } = await supabase.from('profiles').update({ location_mode: mode }).eq('id', id);

    if (error) {
      setEmployee((current) => (current ? { ...current, location_mode: employee.location_mode } : current));
      setToggleError(translateServerError(error.message, locale));
    }
  }

  if (loading || !employee) {
    return (
      <ThemedView style={styles.container}>
        <Stack.Screen options={{ headerShown: false }} />
        <SafeAreaView style={[styles.safeArea, styles.loading]} edges={['left', 'right']}>
          <BrandSpinner color={theme.accentText} />
        </SafeAreaView>
      </ThemedView>
    );
  }

  const fullName = `${employee.first_name} ${employee.last_name}`.trim();

  return (
    <ThemedView style={[styles.container, { backgroundColor: palette.page }]}>
      {/* The screen draws its own back row, like the profile and chantier
          screens; the stack header would be a second, different-looking one. */}
      <Stack.Screen options={{ headerShown: false }} />
      <SafeAreaView style={styles.safeArea} edges={['left', 'right']}>
        <ScrollView
          contentContainerStyle={[styles.scrollContent, { paddingBottom: Spacing.five + insets.bottom }]}
          keyboardShouldPersistTaps="handled"
            keyboardDismissMode="on-drag">
          <View style={styles.toolbar}>
            <Pressable
              onPress={() => (router.canGoBack() ? router.back() : router.replace('/employees'))}
              hitSlop={8}
              accessibilityLabel={t.common.back}
              style={({ pressed }) => pressed && styles.pressed}>
              <Ionicons name="chevron-back" size={28} color={theme.text} />
            </Pressable>
            <ThemedText type="subtitle" style={styles.toolbarTitle} numberOfLines={1}>{fullName}</ThemedText>
          </View>

          <View style={styles.identity}>
            {employee.avatar_url ? (
              <Image source={{ uri: employee.avatar_url }} style={styles.avatar} />
            ) : (
              <View style={[styles.avatar, styles.avatarEmpty, { backgroundColor: palette.avatar }]}>
                <Ionicons name="person" size={34} color={theme.textSecondary} />
              </View>
            )}
            <View style={styles.identityText}>
              <ThemedText style={styles.identityName}>{fullName}</ThemedText>
              <View style={styles.identityStatus}>
                <View
                  style={[
                    styles.dot,
                    { backgroundColor: employee.is_active ? theme.success : theme.textPlaceholder },
                  ]}
                />
                <ThemedText type="small" themeColor="textSecondary">
                  {employee.is_active ? t.employeeDetail.toggles.isActive.label : t.employees.remove.action}
                </ThemedText>
              </View>
            </View>
          </View>

          {/* Straight through to what this person has actually been doing. */}
          <Card>
            <Row
              icon="time-outline"
              label={t.employeeActivity.title}
              onPress={() => router.push(`/employee/${employee.id}`)}
            />
          </Card>

          <SectionTitle>{t.employeeDetail.credentials.title}</SectionTitle>
          <Card>
            <View style={styles.credentialRow}>
              <ThemedText type="small" themeColor="textSecondary">
                {t.employeeDetail.credentials.username}
              </ThemedText>
              <View style={styles.credentialValue}>
                <ThemedText type="code">{employee.username}</ThemedText>
                <CopyButton value={employee.username} />
              </View>
            </View>

            <Divider />

            <View style={styles.credentialRow}>
              <ThemedText type="small" themeColor="textSecondary">
                {t.employeeDetail.credentials.password}
              </ThemedText>
              <View style={styles.credentialValue}>
                <ThemedText type="code">
                  {showPassword ? (employee.employee_password ?? '—') : '••••••••'}
                </ThemedText>
                <Pressable
                  hitSlop={8}
                  onPress={() => setShowPassword((value) => !value)}
                  style={({ pressed }) => pressed && styles.pressed}>
                  <Ionicons
                    name={showPassword ? 'eye-off-outline' : 'eye-outline'}
                    size={18}
                    color={theme.textSecondary}
                  />
                </Pressable>
                <CopyButton value={employee.employee_password} />
              </View>
            </View>
          </Card>

          {passwordError && (
            <ThemedText type="small" style={{ color: theme.danger }}>{passwordError}</ThemedText>
          )}

          <View style={styles.buttonRow}>
            <Pressable
              accessibilityRole="button"
              disabled={resettingPassword}
              onPress={handleRegeneratePassword}
              style={({ pressed }) => [
                styles.pill,
                { borderColor: theme.text },
                (pressed || resettingPassword) && styles.pressed,
              ]}>
              <ThemedText type="smallBold">
                {resettingPassword
                  ? t.employeeDetail.credentials.regenerating
                  : t.employeeDetail.credentials.regenerate}
              </ThemedText>
            </Pressable>

            <Pressable
              accessibilityRole="button"
              onPress={() => setShowSendPreview(true)}
              style={({ pressed }) => [styles.pill, { borderColor: theme.text }, pressed && styles.pressed]}>
              <ThemedText type="smallBold">{t.employeeDetail.credentials.sendToPhone}</ThemedText>
            </Pressable>
          </View>

          <SectionTitle>{t.employeeDetail.form.title}</SectionTitle>
          <AnimatedInput
            surface={palette.field}
            labelColor={palette.fieldText}
            label={t.employeeDetail.form.firstNamePlaceholder}
            returnKeyType="next"
            value={firstName}
            onChangeText={(value) => { setFirstName(value); setInfoSaved(false); }}
          />
          <AnimatedInput
            surface={palette.field}
            labelColor={palette.fieldText}
            label={t.employeeDetail.form.lastNamePlaceholder}
            returnKeyType="next"
            value={lastName}
            onChangeText={(value) => { setLastName(value); setInfoSaved(false); }}
          />
          <PhoneInput
            surface={palette.field}
            labelColor={palette.fieldText}
            label={t.employeeDetail.form.phonePlaceholder}
            value={phone}
            onChangeText={(value) => { setPhone(value); setInfoSaved(false); }}
          />

          {infoError && <ThemedText type="small" style={{ color: theme.danger }}>{infoError}</ThemedText>}

          <Pressable
            accessibilityRole="button"
            disabled={savingInfo}
            onPress={handleSaveInfo}
            style={({ pressed }) => [
              styles.primary,
              { backgroundColor: theme.accent, opacity: pressed || savingInfo ? 0.7 : 1 },
            ]}>
            <ThemedText style={{ color: theme.buttonText }}>
              {savingInfo
                ? t.employeeDetail.form.saving
                : infoSaved
                  ? t.employeeDetail.form.saved
                  : t.employeeDetail.form.save}
            </ThemedText>
          </Pressable>

          <SectionTitle>{t.employeeDetail.settings}</SectionTitle>
          {toggleError && <ThemedText type="small" style={{ color: theme.danger }}>{toggleError}</ThemedText>}
          <Card>
            {toggles(t).map((toggle, index) => (
              <View key={toggle.key}>
                {index > 0 && <Divider />}
                <View style={styles.toggleRow}>
                  <View style={styles.toggleText}>
                    <ThemedText type="smallBold">{toggle.label}</ThemedText>
                    <ThemedText type="small" themeColor="textSecondary">{toggle.description}</ThemedText>
                  </View>
                  <Switch
                    value={employee[toggle.key]}
                    onValueChange={(value) => handleToggle(toggle.key, value)}
                    trackColor={{ false: theme.backgroundSelected, true: theme.accent }}
                    ios_backgroundColor={theme.backgroundSelected}
                  />
                </View>
              </View>
            ))}

            <Divider />

            <View style={styles.toggleRow}>
              <View style={styles.toggleText}>
                <ThemedText type="smallBold">{t.employeeDetail.toggles.liveLocation.label}</ThemedText>
                <ThemedText type="small" themeColor="textSecondary">
                  {t.employeeDetail.toggles.liveLocation.description}
                </ThemedText>
              </View>
              <Switch
                value={employee.location_mode === 'live'}
                onValueChange={handleLiveLocation}
                trackColor={{ false: theme.backgroundSelected, true: theme.accent }}
                ios_backgroundColor={theme.backgroundSelected}
              />
            </View>
          </Card>
        </ScrollView>
      </SafeAreaView>

      <AppModal
        visible={showSendPreview}
        onClose={() => setShowSendPreview(false)}
        title={t.employeeDetail.credentials.sendToPhone}
        icon="chatbubble-ellipses-outline"
        actions={<ModalButton label={t.common.done} onPress={() => setShowSendPreview(false)} />}>
        <ThemedText type="small" themeColor="textSecondary">
          {t.employeeDetail.credentials.sendPreview(
            employee.phone ?? t.employeeDetail.credentials.defaultPhone,
            employee.username,
            employee.employee_password
          )}
        </ThemedText>
      </AppModal>
    </ThemedView>
  );
}

/** A grouped card, as used on the dashboard and in the settings screen. */
function Card({ children }: { children: React.ReactNode }) {
  const theme = useTheme();
  return (
    <View style={[styles.card, cardShadow(theme.isDark), { backgroundColor: theme.backgroundElement }]}>
      {children}
    </View>
  );
}

function Divider() {
  const theme = useTheme();
  return <View style={{ height: StyleSheet.hairlineWidth, backgroundColor: theme.backgroundSelected }} />;
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return <ThemedText type="smallBold" style={styles.sectionTitle}>{children}</ThemedText>;
}

/** One tappable line inside a Card. */
function Row({ icon, label, onPress }: {
  icon: React.ComponentProps<typeof Ionicons>['name'];
  label: string;
  onPress: () => void;
}) {
  const theme = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [styles.row, pressed && styles.pressed]}>
      <Ionicons name={icon} size={20} color={theme.accentText} />
      <ThemedText style={{ flex: 1 }}>{label}</ThemedText>
      <Ionicons name="chevron-forward" size={16} color={theme.textPlaceholder} />
    </Pressable>
  );
}

/**
 * Copies one credential to the clipboard. A chef reads these out to somebody
 * standing in front of them or pastes them into a message; retyping a
 * generated password from a screen is where the mistakes happen.
 */
function CopyButton({ value }: { value: string | null }) {
  const theme = useTheme();
  const { t } = useI18n();
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  if (!value) return null;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={copied ? t.employeeDetail.credentials.copied : t.employeeDetail.credentials.copy}
      hitSlop={8}
      onPress={() => {
        void Clipboard.setStringAsync(value);
        if (Platform.OS !== 'web') void Haptics.selectionAsync().catch(() => {});
        setCopied(true);
        if (timer.current) clearTimeout(timer.current);
        timer.current = setTimeout(() => setCopied(false), 1500);
      }}
      style={({ pressed }) => pressed && styles.pressed}>
      <Ionicons
        name={copied ? 'checkmark' : 'copy-outline'}
        size={18}
        color={copied ? theme.success : theme.textSecondary}
      />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  safeArea: {
    flex: 1,
  },
  loading: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  scrollContent: {
    paddingHorizontal: Spacing.four,
    paddingTop: Spacing.three,
    gap: Spacing.three,
    maxWidth: MaxContentWidth,
    alignSelf: 'center',
    width: '100%',
  },
  toolbar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
  },
  toolbarTitle: {
    flex: 1,
  },
  identity: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    paddingVertical: Spacing.two,
  },
  avatar: {
    width: 72,
    height: 72,
    borderRadius: 36,
  },
  avatarEmpty: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  identityText: {
    flex: 1,
    gap: Spacing.one,
  },
  identityName: {
    fontSize: 22,
    fontWeight: '700',
  },
  identityStatus: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  sectionTitle: {
    marginTop: Spacing.two,
  },
  card: {
    borderRadius: Spacing.three + Spacing.one,
    paddingHorizontal: Spacing.three,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    paddingVertical: Spacing.three,
  },
  credentialRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.three,
    paddingVertical: Spacing.three,
  },
  credentialValue: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
  },
  toggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    paddingVertical: Spacing.three,
  },
  toggleText: {
    flex: 1,
    gap: 2,
  },
  buttonRow: {
    gap: Spacing.two,
  },
  pill: {
    minHeight: 48,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 999,
    borderWidth: 1,
  },
  primary: {
    minHeight: 52,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 999,
  },
  pressed: {
    opacity: 0.6,
  },
});
