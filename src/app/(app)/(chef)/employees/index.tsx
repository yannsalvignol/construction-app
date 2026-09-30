import * as Clipboard from 'expo-clipboard';
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, Keyboard, Pressable, ScrollView, Share, StyleSheet } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

import { Image } from 'expo-image';
import Ionicons from '@expo/vector-icons/Ionicons';
import { AnimatedInput } from '@/components/animated-input';
import { AppModal, ModalButton } from '@/components/app-modal';
import { PhoneInput } from '@/components/phone-input';
import { RuleChecklist } from '@/components/rule-checklist';
import { SwipeToDelete } from '@/components/swipe-to-delete';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { cardShadow, MaxContentWidth, Spacing } from '@/constants/theme';
import { useAuth } from '@/hooks/use-auth';
import { useAuthPalette } from '@/hooks/use-auth-palette';
import { useI18n } from '@/hooks/use-i18n';
import { useTheme } from '@/hooks/use-theme';
import { resolveFunctionError } from '@/lib/edge-function-error';
import { generatePassword, generateUsername } from '@/lib/generate-credentials';
import { translateServerError } from '@/lib/i18n/server-errors';
import { supabase } from '@/lib/supabase';
import { invalidate, useCached } from '@/hooks/use-cached';
import { employeesKey, loadEmployees } from '@/lib/tab-data';

function JoinCodeCard() {
  const theme = useTheme();
  const { t, locale } = useI18n();
  const { profile } = useAuth();

  const [joinCode, setJoinCode] = useState<string | null>(null);
  const [companyName, setCompanyName] = useState<string | null>(null);
  const [regenerating, setRegenerating] = useState(false);
  const [confirmingRegenerate, setConfirmingRegenerate] = useState(false);
  const [copied, setCopied] = useState(false);
  const [showCodeInfo, setShowCodeInfo] = useState(false);
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
    <ThemedView
      style={[
        styles.joinCard,
        { backgroundColor: theme.backgroundElement, borderColor: theme.backgroundSelected },
      ]}>
      <ThemedView style={[styles.transparent, { flexDirection: 'row', alignItems: 'center', gap: 10 }]}>
        <ThemedText type="smallBold" style={{ flex: 1 }}>{t.employees.joinCode.title}</ThemedText>
        {/* The explanation is read once and never again, so it hides behind the icon. */}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t.employees.joinCode.description}
          accessibilityState={{ expanded: showCodeInfo }}
          onPress={() => setShowCodeInfo(!showCodeInfo)}
          hitSlop={12}
          style={({ pressed }) => (pressed ? { opacity: 0.6 } : undefined)}>
          <Ionicons name="information-circle-outline" size={20} color={theme.textSecondary} />
        </Pressable>
      </ThemedView>
      {showCodeInfo && (
        <ThemedText type="small" themeColor="textSecondary">
          {t.employees.joinCode.description}
        </ThemedText>
      )}

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
  avatar_url: string | null;
};

export default function EmployeesScreen() {
  const insets = useSafeAreaInsets();
  const theme = useTheme();
  const palette = useAuthPalette();
  const { t, locale } = useI18n();
  const router = useRouter();
  const { profile } = useAuth();

  const [removing, setRemoving] = useState<string | null>(null);
  const [removeError, setRemoveError] = useState<string | null>(null);

  const [showAddForm, setShowAddForm] = useState(false);
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [phone, setPhone] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const canSubmit = firstName.trim() && lastName.trim() && username.trim() && password.trim();

  // Served from the cache the home screen warmed, then revalidated on focus:
  // the list is there on arrival instead of appearing a moment later.
  const companyId = profile?.company_id ?? '';
  const loader = useCallback(() => loadEmployees(companyId), [companyId]);
  const cached = useCached(employeesKey(companyId), loader);
  const employees = cached.data ?? [];
  const loading = cached.loading;
  const fetchEmployees = useCallback(async () => {
    invalidate(employeesKey(companyId));
    await cached.refresh();
  }, [companyId, cached]);

  async function removeEmployee(employee: Employee) {
    setRemoving(employee.id); setRemoveError(null);
    const { error } = await supabase.rpc('remove_employee', { employee: employee.id });
    setRemoving(null);
    if (error) {
      // The server refuses an employee who has declared work; say so plainly rather
      // than leaving the row looking as if the swipe simply failed.
      setRemoveError(/declared work/.test(error.message)
        ? t.employees.remove.hasWork
        : t.employees.remove.failed);
      return;
    }
    await fetchEmployees();
  }

  function confirmRemove(employee: Employee) {
    Alert.alert(
      `${employee.first_name} ${employee.last_name}`,
      t.employees.remove.confirm,
      [
        { text: t.employees.remove.cancel, style: 'cancel' },
        { text: t.employees.remove.action, style: 'destructive', onPress: () => { void removeEmployee(employee); } },
      ],
    );
  }

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
      <SafeAreaView style={styles.safeArea} edges={['left', 'right']}>
        <ScrollView contentContainerStyle={[styles.scrollContent, { paddingBottom: Spacing.four + insets.bottom }]} keyboardShouldPersistTaps="handled"
            keyboardDismissMode="on-drag">
          <JoinCodeCard />

          {removeError && (
            <ThemedText type="small" style={[styles.centerText, { color: theme.danger }]}>
              {removeError}
            </ThemedText>
          )}

          {!loading && employees.length === 0 && !showAddForm && (
            <ThemedText type="small" themeColor="textSecondary" style={styles.centerText}>
              {t.employees.noEmployees}
            </ThemedText>
          )}

          {employees.length > 0 && (
            <ThemedView style={[styles.employeeList, styles.transparent]}>
              {employees.map((employee) => (
                <SwipeToDelete
                  key={employee.id}
                  label={t.employees.remove.action}
                  radius={Spacing.three + Spacing.one}
                  busy={removing === employee.id}
                  onDelete={() => confirmRemove(employee)}>
                  <Pressable
                    style={({ pressed }) => pressed && styles.pressed}
                    onPress={() => router.push(`/employees/${employee.id}`)}>
                    <ThemedView
                      style={[
                        styles.employeeRow,
                        styles.transparent,
                        cardShadow(theme.isDark),
                        { backgroundColor: theme.backgroundElement, borderColor: theme.text },
                      ]}>
                      {employee.avatar_url ? (
                        <Image source={{ uri: employee.avatar_url }} style={styles.employeeAvatar} />
                      ) : (
                        <ThemedView
                          style={[
                            styles.employeeAvatar,
                            styles.employeeAvatarEmpty,
                            // The form grey, so an empty avatar reads as a slot
                            // waiting for a photograph, not a hole in the card.
                            { backgroundColor: palette.avatar },
                          ]}>
                          <Ionicons name="person" size={22} color={theme.textSecondary} />
                        </ThemedView>
                      )}
                      <ThemedView style={[styles.employeeIdentity, styles.transparent]}>
                        <ThemedText type="smallBold">
                          {employee.first_name} {employee.last_name}
                        </ThemedText>
                        {!!employee.username && (
                          <ThemedText type="small" themeColor="textSecondary">
                            {employee.username}
                          </ThemedText>
                        )}
                      </ThemedView>
                      <Ionicons name="chevron-forward" size={16} color={theme.textSecondary} />
                    </ThemedView>
                  </Pressable>
                </SwipeToDelete>
              ))}
            </ThemedView>
          )}

          {showAddForm ? (
            <ThemedView style={[styles.form, styles.transparent]}>
              <AnimatedInput
                surface={palette.field}
                labelColor={palette.fieldText}
                label={t.employees.form.firstNamePlaceholder}
                returnKeyType="next"
                value={firstName}
                onChangeText={setFirstName}
              />
              <AnimatedInput
                surface={palette.field}
                labelColor={palette.fieldText}
                label={t.employees.form.lastNamePlaceholder}
                returnKeyType="next"
                value={lastName}
                onChangeText={setLastName}
              />
              <PhoneInput
                surface={palette.field}
                labelColor={palette.fieldText}
                label={t.employees.form.phonePlaceholder}
                value={phone}
                onChangeText={setPhone}
              />
              <ThemedView
                style={[
                  styles.credentials,
                  cardShadow(theme.isDark),
                  { backgroundColor: theme.backgroundElement },
                ]}>
                <ThemedView style={[styles.transparent, { flexDirection: 'row', alignItems: 'center', gap: Spacing.two }]}>
                  <ThemedText type="smallBold" style={{ flex: 1 }}>
                    {t.employees.form.credentialsTitle}
                  </ThemedText>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={t.employees.form.generateRandomly}
                    onPress={() => {
                      setUsername(generateUsername(firstName || 'employee', lastName));
                      setPassword(generatePassword());
                    }}
                    style={({ pressed }) => [
                      styles.generateButton,
                      { borderColor: theme.accent, opacity: pressed ? 0.6 : 1 },
                    ]}>
                    <Ionicons name="dice-outline" size={16} color={theme.accentText} />
                    <ThemedText type="small" themeColor="accentText">
                      {t.employees.form.generate}
                    </ThemedText>
                  </Pressable>
                </ThemedView>
                <ThemedText type="small" themeColor="textSecondary">
                  {t.employees.form.credentialsHint}
                </ThemedText>

                <AnimatedInput
                  surface={palette.field}
                  labelColor={palette.fieldText}
                  label={t.employees.form.usernamePlaceholder}
                  autoCapitalize="none"
                  autoCorrect={false}
                  returnKeyType="next"
                  value={username}
                  onChangeText={setUsername}
                />

                <RuleChecklist rules={[
                  { label: t.employees.form.ruleLength, met: username.trim().length >= 3 && username.trim().length <= 20 },
                  { label: t.employees.form.ruleNoAccent, met: username.trim().length > 0 && !/[\s-]|[^\x00-\x7F]/.test(username.trim()) },
                ]} />

                <AnimatedInput
                  surface={palette.field}
                  labelColor={palette.fieldText}
                  label={t.employees.form.passwordPlaceholder}
                  autoCapitalize="none"
                  autoCorrect={false}
                  returnKeyType="done"
                  onSubmitEditing={() => Keyboard.dismiss()}
                  value={password}
                  onChangeText={setPassword}
                />

                <RuleChecklist rules={[
                  { label: t.employees.form.rulePassword, met: password.length >= 6 },
                ]} />

              </ThemedView>

              <Pressable
                style={({ pressed }) => [
                  styles.primary,
                  { backgroundColor: theme.accent, opacity: pressed || submitting || !canSubmit ? 0.7 : 1 },
                ]}
                disabled={submitting || !canSubmit}
                onPress={handleAddEmployee}>
                <ThemedText style={[styles.buttonLabel, { color: theme.buttonText }]}>
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
                  styles.primary,
                  { backgroundColor: theme.accent, opacity: pressed ? 0.7 : 1 },
                ]}
                onPress={() => setShowAddForm(true)}>
                <ThemedText style={[styles.buttonLabel, { color: theme.buttonText }]}>
                  {t.employees.addManually}
                </ThemedText>
              </Pressable>
            </ThemedView>
          )}
        </ScrollView>
      </SafeAreaView>

      <AppModal
        visible={!!formError}
        onClose={() => setFormError(null)}
        title={t.employees.form.errorTitle}
        icon="alert-circle-outline"
        actions={<ModalButton label={t.common.done} onPress={() => setFormError(null)} />}>
        <ThemedText type="small" themeColor="textSecondary">{formError}</ThemedText>
      </AppModal>
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
    // The tab row is pinned above the content, so the first card needs its own
    // clearance or it reads as tucked under the pills.
    paddingTop: Spacing.three,
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
  employeeList: {
    // Each employee is their own bubble; just enough air to keep them apart.
    gap: Spacing.two,
  },
  employeeIdentity: {
    flex: 1,
    gap: 2,
  },
  employeeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: Spacing.three + Spacing.one,
    borderWidth: 1,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.three,
    gap: Spacing.two,
  },
  credentials: {
    borderRadius: Spacing.three + Spacing.one,
    padding: Spacing.three,
    gap: Spacing.three,
  },
  generateButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.one,
    borderWidth: 1,
    borderRadius: Spacing.two,
    paddingHorizontal: Spacing.two,
    paddingVertical: Spacing.one,
  },
  employeeAvatar: {
    width: 46,
    height: 46,
    borderRadius: 23,
  },
  employeeAvatarEmpty: {
    alignItems: 'center',
    justifyContent: 'center',
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
    borderRadius: Spacing.three + Spacing.one,
    paddingVertical: Spacing.four,
    alignItems: 'center',
  },
  // The oval used everywhere else for a screen's main action.
  primary: {
    minHeight: 56,
    borderRadius: 999,
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttonLabel: {
    fontSize: 17,
    fontWeight: '400',
  },
  error: {
    
    textAlign: 'center',
  },
  transparent: {
    backgroundColor: 'transparent',
  },
});
