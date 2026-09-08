import * as Clipboard from 'expo-clipboard';
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Keyboard, Pressable, ScrollView, Share, StyleSheet, TextInput } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { KEYBOARD_DONE_BAR_ID, KeyboardDoneBar } from '@/components/keyboard-done-bar';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { MaxContentWidth, Spacing } from '@/constants/theme';
import { useAuth } from '@/hooks/use-auth';
import { useI18n } from '@/hooks/use-i18n';
import { useTheme } from '@/hooks/use-theme';
import { resolveFunctionError } from '@/lib/edge-function-error';
import { generatePassword, generateUsername } from '@/lib/generate-credentials';
import { translateServerError } from '@/lib/i18n/server-errors';
import { supabase } from '@/lib/supabase';

function JoinCodeCard() {
  const theme = useTheme();
  const { t, locale } = useI18n();
  const { profile } = useAuth();

  const [joinCode, setJoinCode] = useState<string | null>(null);
  const [companyName, setCompanyName] = useState<string | null>(null);
  const [regenerating, setRegenerating] = useState(false);
  const [confirmingRegenerate, setConfirmingRegenerate] = useState(false);
  const [copied, setCopied] = useState(false);
  const [codeError, setCodeError] = useState<string | null>(null);
  const copiedTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);

  const fetchJoinCode = useCallback(async () => {
    if (!profile) return;
    const { data, error } = await supabase
      .from('companies')
      .select('name, join_code')
      .eq('id', profile.company_id)
      .single();

    if (error) {
      console.error('[employees] failed to load company join code', error);
      return;
    }
    setJoinCode(data.join_code);
    setCompanyName(data.name);
  }, [profile]);

  useFocusEffect(
    useCallback(() => {
      fetchJoinCode();
    }, [fetchJoinCode])
  );

  useEffect(() => {
    return () => {
      if (copiedTimeout.current) clearTimeout(copiedTimeout.current);
    };
  }, []);

  async function handleCopy() {
    if (!joinCode) return;
    await Clipboard.setStringAsync(joinCode);
    setCopied(true);
    if (copiedTimeout.current) clearTimeout(copiedTimeout.current);
    copiedTimeout.current = setTimeout(() => setCopied(false), 1500);
  }

  async function handleShare() {
    if (!joinCode) return;
    await Share.share({
      message: t.employees.joinCode.shareMessage(companyName ?? t.common.appName, joinCode),
    });
  }

  async function handleRegenerate() {
    setCodeError(null);
    setRegenerating(true);
    const { data, error } = await supabase.rpc('regenerate_company_join_code');
    setRegenerating(false);
    setConfirmingRegenerate(false);

    if (error) {
      console.error('[employees] failed to regenerate join code', error);
      setCodeError(translateServerError(error.message, locale));
      return;
    }
    setJoinCode(data);
  }

  return (
    <ThemedView style={[styles.joinCard, { borderColor: theme.backgroundSelected }]}>
      <ThemedText type="smallBold">{t.employees.joinCode.title}</ThemedText>
      <ThemedText type="small" themeColor="textSecondary">
        {t.employees.joinCode.description}
      </ThemedText>

      <ThemedText type="title" style={styles.joinCodeText}>
        {joinCode ?? '······'}
      </ThemedText>

      {codeError && (
        <ThemedText type="small" style={[styles.error, { color: theme.danger }]}>
          {codeError}
        </ThemedText>
      )}

      {confirmingRegenerate ? (
        <ThemedView style={[styles.confirmRow, styles.transparent]}>
          <ThemedText type="small" themeColor="textSecondary" style={styles.confirmText}>
            {t.employees.joinCode.confirmMessage}
          </ThemedText>
          <ThemedView style={[styles.confirmActions, styles.transparent]}>
            <Pressable onPress={() => setConfirmingRegenerate(false)} disabled={regenerating}>
              <ThemedText type="linkPrimary">{t.common.cancel}</ThemedText>
            </Pressable>
            <Pressable onPress={handleRegenerate} disabled={regenerating}>
              <ThemedText type="linkPrimary" style={[styles.error, { color: theme.danger }]}>
                {regenerating ? t.employees.joinCode.regenerating : t.employees.joinCode.regenerate}
              </ThemedText>
            </Pressable>
          </ThemedView>
        </ThemedView>
      ) : (
        <ThemedView style={[styles.joinCardActions, styles.transparent]}>
          <Pressable onPress={handleCopy} disabled={!joinCode} hitSlop={8}>
            <ThemedText type="linkPrimary">
              {copied ? t.employees.joinCode.copied : t.employees.joinCode.copy}
            </ThemedText>
          </Pressable>
          <Pressable onPress={handleShare} disabled={!joinCode} hitSlop={8}>
            <ThemedText type="linkPrimary">{t.employees.joinCode.share}</ThemedText>
          </Pressable>
          <Pressable onPress={() => setConfirmingRegenerate(true)} disabled={!joinCode} hitSlop={8}>
            <ThemedText type="linkPrimary">{t.employees.joinCode.regenerate}</ThemedText>
          </Pressable>
        </ThemedView>
      )}
    </ThemedView>
  );
}

type Employee = {
  id: string;
  first_name: string;
  last_name: string;
  phone: string | null;
  username: string | null;
};

export default function EmployeesScreen() {
  const theme = useTheme();
  const { t, locale } = useI18n();
  const router = useRouter();
  const { profile } = useAuth();

  const [employees, setEmployees] = useState<Employee[]>([]);
  const [loading, setLoading] = useState(true);

  const [showAddForm, setShowAddForm] = useState(false);
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [phone, setPhone] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const canSubmit = firstName.trim() && lastName.trim() && username.trim() && password.trim();

  const fetchEmployees = useCallback(async () => {
    if (!profile) return;
    setLoading(true);
    const { data } = await supabase
      .from('profiles')
      .select('id, first_name, last_name, phone, username')
      .eq('company_id', profile.company_id)
      .eq('role', 'employee')
      .order('first_name');
    setEmployees(data ?? []);
    setLoading(false);
  }, [profile]);

  useFocusEffect(
    useCallback(() => {
      fetchEmployees();
    }, [fetchEmployees])
  );

  function resetForm() {
    setFirstName('');
    setLastName('');
    setPhone('');
    setUsername('');
    setPassword('');
    setFormError(null);
  }

  async function handleAddEmployee() {
    setFormError(null);
    setSubmitting(true);

    const trimmedUsername = username.trim();
    console.log('[create-employee] submitting', {
      firstName: firstName.trim(),
      lastName: lastName.trim(),
      username: trimmedUsername,
      passwordLength: password.length,
    });

    const { data, error } = await supabase.functions.invoke('create-employee', {
      body: {
        firstName: firstName.trim(),
        lastName: lastName.trim(),
        phone: phone.trim() || undefined,
        username: trimmedUsername,
        password,
      },
    });

    setSubmitting(false);
    console.log('[create-employee] response', { data, error });

    if (error) {
      const message = await resolveFunctionError('create-employee', error);
      setFormError(message ? translateServerError(message, locale) : message);
      return;
    }

    console.log('[create-employee] created profile', data?.profile);
    console.log(
      `[create-employee] employee can now sign in with username "${trimmedUsername}" (case-insensitive) and the password shown above`
    );

    resetForm();
    setShowAddForm(false);
    fetchEmployees();
  }

  return (
    <ThemedView style={styles.container}>
      <SafeAreaView style={styles.safeArea} edges={['bottom', 'left', 'right']}>
        <ScrollView contentContainerStyle={styles.scrollContent} keyboardShouldPersistTaps="handled">
          <JoinCodeCard />

          {!loading && employees.length === 0 && !showAddForm && (
            <ThemedText type="small" themeColor="textSecondary" style={styles.centerText}>
              {t.employees.noEmployees}
            </ThemedText>
          )}

          {employees.map((employee) => (
            <Pressable
              key={employee.id}
              style={({ pressed }) => pressed && styles.pressed}
              onPress={() => router.push(`/employees/${employee.id}`)}>
              <ThemedView
                style={[
                  styles.employeeRow,
                  styles.transparent,
                  { borderColor: theme.backgroundSelected },
                ]}>
                <ThemedText type="smallBold">
                  {employee.first_name} {employee.last_name}
                </ThemedText>
                <ThemedText type="small" themeColor="textSecondary">
                  @{employee.username}
                  {employee.phone ? ` · ${employee.phone}` : ''}
                </ThemedText>
              </ThemedView>
            </Pressable>
          ))}

          {showAddForm ? (
            <ThemedView style={[styles.form, styles.transparent]}>
              <TextInput
                style={[
                  styles.input,
                  { color: theme.text, backgroundColor: 'transparent', borderColor: theme.backgroundSelected },
                ]}
                placeholder={t.employees.form.firstNamePlaceholder}
                placeholderTextColor={theme.textSecondary}
                returnKeyType="next"
                value={firstName}
                onChangeText={setFirstName}
                inputAccessoryViewID={KEYBOARD_DONE_BAR_ID}
              />
              <TextInput
                style={[
                  styles.input,
                  { color: theme.text, backgroundColor: 'transparent', borderColor: theme.backgroundSelected },
                ]}
                placeholder={t.employees.form.lastNamePlaceholder}
                placeholderTextColor={theme.textSecondary}
                returnKeyType="next"
                value={lastName}
                onChangeText={setLastName}
                inputAccessoryViewID={KEYBOARD_DONE_BAR_ID}
              />
              <TextInput
                style={[
                  styles.input,
                  { color: theme.text, backgroundColor: 'transparent', borderColor: theme.backgroundSelected },
                ]}
                placeholder={t.employees.form.phonePlaceholder}
                placeholderTextColor={theme.textSecondary}
                keyboardType="phone-pad"
                value={phone}
                onChangeText={setPhone}
                inputAccessoryViewID={KEYBOARD_DONE_BAR_ID}
              />
              <TextInput
                style={[
                  styles.input,
                  { color: theme.text, backgroundColor: 'transparent', borderColor: theme.backgroundSelected },
                ]}
                placeholder={t.employees.form.usernamePlaceholder}
                placeholderTextColor={theme.textSecondary}
                autoCapitalize="none"
                autoCorrect={false}
                returnKeyType="next"
                value={username}
                onChangeText={setUsername}
                inputAccessoryViewID={KEYBOARD_DONE_BAR_ID}
              />
              <TextInput
                style={[
                  styles.input,
                  { color: theme.text, backgroundColor: 'transparent', borderColor: theme.backgroundSelected },
                ]}
                placeholder={t.employees.form.passwordPlaceholder}
                placeholderTextColor={theme.textSecondary}
                autoCapitalize="none"
                autoCorrect={false}
                returnKeyType="done"
                onSubmitEditing={() => Keyboard.dismiss()}
                value={password}
                onChangeText={setPassword}
                inputAccessoryViewID={KEYBOARD_DONE_BAR_ID}
              />

              <Pressable
                onPress={() => {
                  setUsername(generateUsername(firstName || 'employee', lastName));
                  setPassword(generatePassword());
                }}>
                <ThemedText type="linkPrimary" style={styles.centerText}>
                  {t.employees.form.generateRandomly}
                </ThemedText>
              </Pressable>

              {formError && (
                <ThemedText type="small" style={[styles.error, { color: theme.danger }]}>
                  {formError}
                </ThemedText>
              )}

              <Pressable
                style={({ pressed }) => [
                  styles.button,
                  { backgroundColor: theme.accent, opacity: pressed || submitting || !canSubmit ? 0.7 : 1 },
                ]}
                disabled={submitting || !canSubmit}
                onPress={handleAddEmployee}>
                <ThemedText type="smallBold" style={{ color: theme.buttonText }}>
                  {submitting ? t.employees.form.submitting : t.employees.form.submit}
                </ThemedText>
              </Pressable>

              <Pressable
                onPress={() => {
                  resetForm();
                  setShowAddForm(false);
                }}>
                <ThemedText type="linkPrimary" style={styles.centerText}>
                  {t.employees.form.cancel}
                </ThemedText>
              </Pressable>
            </ThemedView>
          ) : (
            <ThemedView style={[styles.transparent, styles.manualAddSection]}>
              <ThemedText type="small" themeColor="textSecondary" style={styles.centerText}>
                {t.employees.manualAddNote}
              </ThemedText>
              <Pressable
                style={({ pressed }) => [
                  styles.button,
                  { backgroundColor: theme.accent, opacity: pressed ? 0.7 : 1 },
                ]}
                onPress={() => setShowAddForm(true)}>
                <ThemedText type="smallBold" style={{ color: theme.buttonText }}>
                  {t.employees.addManually}
                </ThemedText>
              </Pressable>
            </ThemedView>
          )}
        </ScrollView>
      </SafeAreaView>
      <KeyboardDoneBar />
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    flexDirection: 'row',
  },
  safeArea: {
    flex: 1,
    width: '100%',
    maxWidth: MaxContentWidth,
    alignSelf: 'center',
  },
  scrollContent: {
    paddingHorizontal: Spacing.four,
    paddingBottom: Spacing.four,
    gap: Spacing.three,
  },
  title: {
    textAlign: 'center',
    marginBottom: Spacing.two,
  },
  centerText: {
    textAlign: 'center',
  },
  pressed: {
    opacity: 0.7,
  },
  employeeRow: {
    borderRadius: Spacing.three,
    borderWidth: 1,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.three,
    gap: Spacing.half,
  },
  joinCard: {
    borderRadius: Spacing.three,
    borderWidth: 1,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.three,
    gap: Spacing.two,
  },
  joinCodeText: {
    letterSpacing: 6,
    textAlign: 'center',
  },
  joinCardActions: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  confirmRow: {
    gap: Spacing.two,
  },
  confirmText: {
    textAlign: 'center',
  },
  confirmActions: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: Spacing.four,
  },
  manualAddSection: {
    gap: Spacing.two,
  },
  form: {
    gap: Spacing.three,
    marginTop: Spacing.two,
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
  transparent: {
    backgroundColor: 'transparent',
  },
});
