import { Stack, useFocusEffect, useLocalSearchParams } from 'expo-router';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useCallback, useState } from 'react';
import { Keyboard, Pressable, ScrollView, StyleSheet, Switch, TextInput } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { DismissKeyboardView } from '@/components/dismiss-keyboard-view';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
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
  const theme = useTheme();
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
        'id, first_name, last_name, phone, username, employee_password, equipment_photo_required, clock_in_photo_required, notifications_enabled, is_active, location_mode'
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
        <SafeAreaView style={styles.safeArea} />
      </ThemedView>
    );
  }

  return (
    <DismissKeyboardView style={styles.container}>
      <Stack.Screen options={{ title: `${employee.first_name} ${employee.last_name}` }} />
      <SafeAreaView style={styles.safeArea} edges={['bottom', 'left', 'right']}>
        <ScrollView contentContainerStyle={styles.scrollContent} keyboardShouldPersistTaps="handled">
          <ThemedView style={[styles.credentialsCard, styles.transparent]}>
            <ThemedText type="smallBold">{t.employeeDetail.credentials.title}</ThemedText>

            <ThemedView style={[styles.credentialRow, styles.transparent]}>
              <ThemedText type="small" themeColor="textSecondary">
                {t.employeeDetail.credentials.username}
              </ThemedText>
              <ThemedText type="code">{employee.username}</ThemedText>
            </ThemedView>

            <ThemedView style={[styles.credentialRow, styles.transparent]}>
              <ThemedText type="small" themeColor="textSecondary">
                {t.employeeDetail.credentials.password}
              </ThemedText>
              <ThemedView style={[styles.passwordValue, styles.transparent]}>
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
                    tintColor={theme.textSecondary}
                  />
                </Pressable>
              </ThemedView>
            </ThemedView>

            {passwordError && (
              <ThemedText type="small" style={[styles.error, { color: theme.danger }]}>
                {passwordError}
              </ThemedText>
            )}

            <Pressable
              style={({ pressed }) => [
                styles.secondaryButton,
                { opacity: pressed || resettingPassword ? 0.7 : 1 },
              ]}
              disabled={resettingPassword}
              onPress={handleRegeneratePassword}>
              <ThemedText type="smallBold">
                {resettingPassword
                  ? t.employeeDetail.credentials.regenerating
                  : t.employeeDetail.credentials.regenerate}
              </ThemedText>
            </Pressable>

            <Pressable
              style={({ pressed }) => [styles.secondaryButton, { opacity: pressed ? 0.7 : 1 }]}
              onPress={() => setShowSendPreview(true)}>
              <ThemedText type="smallBold">{t.employeeDetail.credentials.sendToPhone}</ThemedText>
            </Pressable>

            {showSendPreview && (
              <ThemedView style={[styles.sendPreview, styles.transparent]}>
                <ThemedText type="small" themeColor="textSecondary">
                  {t.employeeDetail.credentials.sendPreview(
                    employee.phone ?? t.employeeDetail.credentials.defaultPhone,
                    employee.username,
                    employee.employee_password
                  )}
                </ThemedText>
              </ThemedView>
            )}
          </ThemedView>

          <ThemedView style={[styles.section, styles.transparent]}>
            <TextInput
              style={[styles.input, { color: theme.text, backgroundColor: 'transparent', borderColor: theme.backgroundSelected }]}
              placeholder={t.employeeDetail.form.firstNamePlaceholder}
              placeholderTextColor={theme.textSecondary}
              returnKeyType="next"
              value={firstName}
              onChangeText={(value) => {
                setFirstName(value);
                setInfoSaved(false);
              }}
            />
            <TextInput
              style={[styles.input, { color: theme.text, backgroundColor: 'transparent', borderColor: theme.backgroundSelected }]}
              placeholder={t.employeeDetail.form.lastNamePlaceholder}
              placeholderTextColor={theme.textSecondary}
              returnKeyType="next"
              value={lastName}
              onChangeText={(value) => {
                setLastName(value);
                setInfoSaved(false);
              }}
            />
            <TextInput
              style={[styles.input, { color: theme.text, backgroundColor: 'transparent', borderColor: theme.backgroundSelected }]}
              placeholder={t.employeeDetail.form.phonePlaceholder}
              placeholderTextColor={theme.textSecondary}
              keyboardType="phone-pad"
              returnKeyType="done"
              onSubmitEditing={() => Keyboard.dismiss()}
              value={phone}
              onChangeText={(value) => {
                setPhone(value);
                setInfoSaved(false);
              }}
            />

            {infoError && (
              <ThemedText type="small" style={[styles.error, { color: theme.danger }]}>
                {infoError}
              </ThemedText>
            )}

            <Pressable
              style={({ pressed }) => [
                styles.button,
                { backgroundColor: theme.accent, opacity: pressed || savingInfo ? 0.7 : 1 },
              ]}
              disabled={savingInfo}
              onPress={handleSaveInfo}>
              <ThemedText type="smallBold" style={{ color: theme.buttonText }}>
                {savingInfo
                  ? t.employeeDetail.form.saving
                  : infoSaved
                    ? t.employeeDetail.form.saved
                    : t.employeeDetail.form.save}
              </ThemedText>
            </Pressable>
          </ThemedView>

          <ThemedView style={[styles.togglesCard, styles.transparent]}>
            <ThemedText type="smallBold">{t.employeeDetail.settings}</ThemedText>

            {toggleError && (
              <ThemedText type="small" style={[styles.error, { color: theme.danger }]}>
                {toggleError}
              </ThemedText>
            )}

            {toggles(t).map((toggle) => (
              <ThemedView key={toggle.key} style={[styles.toggleRow, styles.transparent]}>
                <ThemedView style={[styles.toggleText, styles.transparent]}>
                  <ThemedText type="smallBold">{toggle.label}</ThemedText>
                  <ThemedText type="small" themeColor="textSecondary">
                    {toggle.description}
                  </ThemedText>
                </ThemedView>
                <Switch
                  value={employee[toggle.key]}
                  onValueChange={(value) => handleToggle(toggle.key, value)}
                  trackColor={{ false: theme.backgroundElement, true: theme.accent }}
                  ios_backgroundColor={theme.backgroundElement}
                />
              </ThemedView>
            ))}

            <ThemedView style={[styles.toggleRow, styles.transparent]}>
              <ThemedView style={[styles.toggleText, styles.transparent]}>
                <ThemedText type="smallBold">{t.employeeDetail.toggles.liveLocation.label}</ThemedText>
                <ThemedText type="small" themeColor="textSecondary">
                  {t.employeeDetail.toggles.liveLocation.description}
                </ThemedText>
              </ThemedView>
              <Switch
                value={employee.location_mode === 'live'}
                onValueChange={handleLiveLocation}
                trackColor={{ false: theme.backgroundElement, true: theme.accent }}
                ios_backgroundColor={theme.backgroundElement}
              />
            </ThemedView>
          </ThemedView>
        </ScrollView>
      </SafeAreaView>
    </DismissKeyboardView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  safeArea: {
    flex: 1,
  },
  scrollContent: {
    padding: Spacing.four,
    gap: Spacing.four,
  },
  centerText: {
    textAlign: 'center',
  },
  section: {
    gap: Spacing.three,
  },
  input: {
    borderRadius: Spacing.two,
    borderWidth: 1,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.three,
    fontSize: 16,
  },
  button: {
    borderRadius: Spacing.two,
    paddingVertical: Spacing.three,
    alignItems: 'center',
  },
  error: {
    
    textAlign: 'center',
  },
  togglesCard: {
    gap: Spacing.one,
  },
  credentialsCard: {
    gap: Spacing.three,
  },
  credentialRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingBottom: Spacing.two,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: 'rgba(128,128,128,0.3)',
  },
  passwordValue: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
  },
  pressed: {
    opacity: 0.6,
  },
  secondaryButton: {
    borderRadius: Spacing.two,
    paddingVertical: Spacing.two,
    alignItems: 'center',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(128,128,128,0.4)',
  },
  sendPreview: {
    borderRadius: Spacing.two,
    padding: Spacing.three,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(128,128,128,0.4)',
  },
  toggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: Spacing.two,
    gap: Spacing.three,
  },
  toggleText: {
    flex: 1,
    gap: Spacing.half,
  },
  transparent: {
    backgroundColor: 'transparent',
  },
});
