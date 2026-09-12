import { useFocusEffect } from 'expo-router';
import { decode } from 'base64-arraybuffer';
import Constants from 'expo-constants';
import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import * as WebBrowser from 'expo-web-browser';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useCallback, useState } from 'react';
import { Keyboard, Pressable, ScrollView, StyleSheet, TextInput } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { PasswordInput } from '@/components/password-input';
import { ThemedText } from '@/components/themed-text';
import { DismissKeyboardView } from '@/components/dismiss-keyboard-view';
import { ThemedView } from '@/components/themed-view';
import { MaxContentWidth, Spacing } from '@/constants/theme';
import { useAuth } from '@/hooks/use-auth';
import { useI18n } from '@/hooks/use-i18n';
import { useTheme } from '@/hooks/use-theme';
import { resolveFunctionError } from '@/lib/edge-function-error';
import type { Locale } from '@/lib/i18n/locale';
import { translateServerError } from '@/lib/i18n/server-errors';
import { supabase } from '@/lib/supabase';
import { workCopy } from '@/lib/work-copy';

const APP_VERSION = Constants.expoConfig?.version ?? '1.0.0';
// Hosted legal pages. App Store Connect needs a public privacy-policy URL and
// the app has to link to it; until one is configured the in-app notice shows.
const PRIVACY_POLICY_URL = process.env.EXPO_PUBLIC_PRIVACY_POLICY_URL;
const TERMS_URL = process.env.EXPO_PUBLIC_TERMS_URL;

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <ThemedView style={[styles.infoRow, styles.transparent]}>
      <ThemedText type="small" themeColor="textSecondary">
        {label}
      </ThemedText>
      <ThemedText type="small">{value}</ThemedText>
    </ThemedView>
  );
}

function LinkRow({
  label,
  note,
  onPress,
}: {
  label: string;
  note: string | null;
  onPress: () => void;
}) {
  const theme = useTheme();
  return (
    <ThemedView style={styles.transparent}>
      <Pressable
        style={({ pressed }) => [styles.infoRow, pressed && styles.pressed]}
        onPress={onPress}>
        <ThemedText type="small">{label}</ThemedText>
        <Ionicons name="chevron-forward" size={15} color={theme.textSecondary} />
      </Pressable>
      {note && (
        <ThemedText type="small" themeColor="textSecondary" style={styles.linkNote}>
          {note}
        </ThemedText>
      )}
    </ThemedView>
  );
}

const LANGUAGE_OPTIONS: { key: Locale; label: (t: ReturnType<typeof useI18n>['t']) => string }[] = [
  { key: 'fr', label: (t) => t.account.language.french },
  { key: 'en', label: (t) => t.account.language.english },
];

function LanguageRow() {
  const theme = useTheme();
  const { t, locale, setLocale } = useI18n();

  return (
    <ThemedView style={[styles.section, styles.transparent]}>
      <ThemedText type="smallBold">{t.account.language.title}</ThemedText>
      <ThemedView style={[styles.languageRow, styles.transparent]}>
        {LANGUAGE_OPTIONS.map((option) => {
          const selected = option.key === locale;
          return (
            <Pressable
              key={option.key}
              style={({ pressed }) => pressed && styles.pressed}
              onPress={() => setLocale(option.key)}>
              <ThemedView
                style={[
                  styles.languagePill,
                  {
                    backgroundColor: 'transparent',
                    borderColor: selected ? theme.accent : theme.backgroundSelected,
                  },
                ]}>
                <ThemedText type="small" themeColor={selected ? 'accentText' : 'textSecondary'}>
                  {option.label(t)}
                </ThemedText>
              </ThemedView>
            </Pressable>
          );
        })}
      </ThemedView>
    </ThemedView>
  );
}

export function AccountScreen({ topInset = true }: { topInset?: boolean }) {
  const theme = useTheme();
  const { t, locale } = useI18n();
  const { profile, signOut, refreshProfile } = useAuth();

  const [firstName, setFirstName] = useState(profile?.first_name ?? '');
  const [lastName, setLastName] = useState(profile?.last_name ?? '');
  const [phone, setPhone] = useState(profile?.phone ?? '');
  const [companyName, setCompanyName] = useState('');
  const [savingInfo, setSavingInfo] = useState(false);
  const [infoError, setInfoError] = useState<string | null>(null);
  const [infoSaved, setInfoSaved] = useState(false);

  const [uploadingPhoto, setUploadingPhoto] = useState(false);
  const [photoError, setPhotoError] = useState<string | null>(null);

  const [showPasswordForm, setShowPasswordForm] = useState(false);
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [changingPassword, setChangingPassword] = useState(false);
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [passwordChanged, setPasswordChanged] = useState(false);

  const [openLegalNote, setOpenLegalNote] = useState<'privacy' | 'terms' | null>(null);

  const [confirmingDeletion, setConfirmingDeletion] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deletionError, setDeletionError] = useState<string | null>(null);

  const fetchCompany = useCallback(async () => {
    if (!profile || profile.role !== 'chef') return;
    const { data } = await supabase
      .from('companies')
      .select('name')
      .eq('id', profile.company_id)
      .single();
    if (data) setCompanyName(data.name);
  }, [profile]);

  useFocusEffect(useCallback(() => {
    void fetchCompany();
  }, [fetchCompany]));

  async function handleSaveInfo() {
    if (!profile) return;
    setInfoError(null);
    setInfoSaved(false);
    setSavingInfo(true);

    const { error: profileError } = await supabase
      .from('profiles')
      .update({
        first_name: firstName.trim(),
        last_name: lastName.trim(),
        phone: phone.trim() || null,
      })
      .eq('id', profile.id);

    if (profileError) {
      setSavingInfo(false);
      setInfoError(translateServerError(profileError.message, locale));
      return;
    }

    if (profile.role === 'chef') {
      const { error: companyError } = await supabase
        .from('companies')
        .update({ name: companyName.trim() })
        .eq('id', profile.company_id);

      if (companyError) {
        setSavingInfo(false);
        setInfoError(translateServerError(companyError.message, locale));
        return;
      }
    }

    setSavingInfo(false);
    setInfoSaved(true);
    await refreshProfile();
  }

  async function handlePickPhoto() {
    if (!profile) return;
    setPhotoError(null);

    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      setPhotoError(t.account.photoPermissionDenied);
      return;
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.6,
      base64: true,
    });

    if (result.canceled || !result.assets[0]?.base64) return;

    setUploadingPhoto(true);

    const path = `${profile.id}/avatar.jpg`;
    const { error: uploadError } = await supabase.storage
      .from('avatars')
      .upload(path, decode(result.assets[0].base64), {
        contentType: 'image/jpeg',
        upsert: true,
      });

    if (uploadError) {
      setUploadingPhoto(false);
      setPhotoError(translateServerError(uploadError.message, locale));
      return;
    }

    const { data } = supabase.storage.from('avatars').getPublicUrl(path);
    const avatarUrl = `${data.publicUrl}?updated=${Date.now()}`;

    const { error: updateError } = await supabase
      .from('profiles')
      .update({ avatar_url: avatarUrl })
      .eq('id', profile.id);

    setUploadingPhoto(false);

    if (updateError) {
      setPhotoError(translateServerError(updateError.message, locale));
      return;
    }

    await refreshProfile();
  }

  async function handleChangePassword() {
    setPasswordError(null);
    setPasswordChanged(false);

    if (newPassword.length < 6) {
      setPasswordError(t.account.security.passwordTooShort);
      return;
    }
    if (newPassword !== confirmPassword) {
      setPasswordError(t.account.security.passwordsDoNotMatch);
      return;
    }

    setChangingPassword(true);
    const { error } = await supabase.auth.updateUser({ password: newPassword });
    setChangingPassword(false);

    if (error) {
      setPasswordError(translateServerError(error.message, locale));
      return;
    }

    setNewPassword('');
    setConfirmPassword('');
    setPasswordChanged(true);
  }

  if (!profile) return null;

  async function handleDeleteAccount() {
    setDeleting(true);
    setDeletionError(null);
    const { error } = await supabase.functions.invoke('delete-account', { method: 'POST' });
    if (error) {
      const message = await resolveFunctionError('delete-account', error);
      setDeletionError(message ? translateServerError(message, locale) : t.account.deletion.failed);
      setDeleting(false);
      return;
    }
    // The auth user no longer exists, so the server-side sign-out is expected to
    // fail; the local session still has to go.
    await signOut().catch(() => supabase.auth.signOut({ scope: 'local' }));
  }

  function openLegal(kind: 'privacy' | 'terms') {
    const url = kind === 'privacy' ? PRIVACY_POLICY_URL : TERMS_URL;
    if (url) {
      WebBrowser.openBrowserAsync(url).catch(() => setOpenLegalNote(kind));
      return;
    }
    setOpenLegalNote((current) => (current === kind ? null : kind));
  }

  return (
    <DismissKeyboardView style={styles.container}>
      <SafeAreaView
        style={styles.safeArea}
        edges={topInset ? undefined : ['bottom', 'left', 'right']}>
        <ScrollView contentContainerStyle={styles.scrollContent} keyboardShouldPersistTaps="handled">
          <ThemedView style={[styles.header, styles.transparent]}>
            <Pressable onPress={handlePickPhoto} disabled={uploadingPhoto}>
              {profile.avatar_url ? (
                <Image source={{ uri: profile.avatar_url }} style={styles.avatar} />
              ) : (
                <ThemedView
                  style={[
                    styles.avatar,
                    styles.avatarPlaceholder,
                    { borderWidth: 1, borderColor: theme.backgroundSelected },
                  ]}>
                  <Ionicons name="person" size={32} color={theme.textSecondary} />
                </ThemedView>
              )}
            </Pressable>

            <ThemedText type="subtitle" style={styles.centerText}>
              {profile.first_name} {profile.last_name}
            </ThemedText>
            <ThemedView
              style={[styles.roleBadge, { borderWidth: 1, borderColor: theme.backgroundSelected }]}>
              <ThemedText type="small" themeColor="textSecondary">
                {t.account.role[profile.role]}
              </ThemedText>
            </ThemedView>

            <Pressable onPress={handlePickPhoto} disabled={uploadingPhoto}>
              <ThemedText type="linkPrimary">
                {uploadingPhoto ? t.account.uploadingPhoto : t.account.changePhoto}
              </ThemedText>
            </Pressable>

            {photoError && (
              <ThemedText type="small" style={[styles.error, { color: theme.danger }]}>
                {photoError}
              </ThemedText>
            )}
          </ThemedView>

          <ThemedView style={[styles.section, styles.transparent]}>
            <ThemedText type="smallBold">{t.account.profile.title}</ThemedText>
            <TextInput
              style={[styles.input, { color: theme.text, backgroundColor: 'transparent', borderColor: theme.backgroundSelected }]}
              placeholder={t.account.profile.firstNamePlaceholder}
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
              placeholder={t.account.profile.lastNamePlaceholder}
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
              placeholder={t.account.profile.phonePlaceholder}
              placeholderTextColor={theme.textSecondary}
              keyboardType="phone-pad"
              returnKeyType="done"
              onSubmitEditing={() => Keyboard.dismiss()}
              value={phone ?? ''}
              onChangeText={(value) => {
                setPhone(value);
                setInfoSaved(false);
              }}
            />

            {profile.role === 'chef' && (
              <TextInput
                style={[
                  styles.input,
                  { color: theme.text, backgroundColor: 'transparent', borderColor: theme.backgroundSelected },
                ]}
                placeholder={t.account.profile.companyNamePlaceholder}
                placeholderTextColor={theme.textSecondary}
                returnKeyType="done"
                onSubmitEditing={() => Keyboard.dismiss()}
                value={companyName}
                onChangeText={(value) => {
                  setCompanyName(value);
                  setInfoSaved(false);
                }}
              />
            )}

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
                  ? t.account.profile.saving
                  : infoSaved
                    ? t.account.profile.saved
                    : t.account.profile.save}
              </ThemedText>
            </Pressable>
          </ThemedView>

          {profile.role === 'chef' && (
            <ThemedView style={[styles.section, styles.transparent]}>
              <ThemedText type="smallBold">{t.account.security.title}</ThemedText>

              <LinkRow
                label={t.account.security.changePassword}
                note={null}
                onPress={() => setShowPasswordForm((value) => !value)}
              />

              {showPasswordForm && (
                <ThemedView style={[styles.expandedForm, styles.transparent]}>
                  <PasswordInput
                    style={[
                      styles.input,
                      { color: theme.text, backgroundColor: 'transparent', borderColor: theme.backgroundSelected },
                    ]}
                    placeholder={t.account.security.newPasswordPlaceholder}
                    placeholderTextColor={theme.textSecondary}
                    returnKeyType="next"
                    value={newPassword}
                    onChangeText={(value) => {
                      setNewPassword(value);
                      setPasswordChanged(false);
                    }}
                  />
                  <PasswordInput
                    style={[
                      styles.input,
                      { color: theme.text, backgroundColor: 'transparent', borderColor: theme.backgroundSelected },
                    ]}
                    placeholder={t.account.security.confirmPasswordPlaceholder}
                    placeholderTextColor={theme.textSecondary}
                    returnKeyType="done"
                    onSubmitEditing={() => Keyboard.dismiss()}
                    value={confirmPassword}
                    onChangeText={(value) => {
                      setConfirmPassword(value);
                      setPasswordChanged(false);
                    }}
                  />

                  {passwordError && (
                    <ThemedText type="small" style={[styles.error, { color: theme.danger }]}>
                      {passwordError}
                    </ThemedText>
                  )}

                  <Pressable
                    style={({ pressed }) => [
                      styles.button,
                      { backgroundColor: theme.accent, opacity: pressed || changingPassword ? 0.7 : 1 },
                    ]}
                    disabled={changingPassword || !newPassword || !confirmPassword}
                    onPress={handleChangePassword}>
                    <ThemedText type="smallBold" style={{ color: theme.buttonText }}>
                      {changingPassword
                        ? t.account.security.updating
                        : passwordChanged
                          ? t.account.security.updated
                          : t.account.security.update}
                    </ThemedText>
                  </Pressable>
                </ThemedView>
              )}
            </ThemedView>
          )}

          <LanguageRow />

          <ThemedView style={[styles.section, styles.transparent]}>
            <ThemedText type="smallBold">{t.account.about.title}</ThemedText>
            <InfoRow label={t.account.about.version} value={APP_VERSION} />
            <LinkRow
              label={t.account.about.privacyPolicy}
              note={openLegalNote === 'privacy' ? [workCopy(locale).noticePrivacy, workCopy(locale).noticeAccess, workCopy(locale).noticeRights].join('\n\n') : null}
              onPress={() => openLegal('privacy')}
            />
            <LinkRow
              label={t.account.about.termsOfService}
              note={openLegalNote === 'terms' ? t.account.about.notAvailableYet : null}
              onPress={() => openLegal('terms')}
            />
          </ThemedView>

          <ThemedView style={[styles.section, styles.transparent]}>
            <ThemedText type="smallBold">{t.account.deletion.title}</ThemedText>
            {confirmingDeletion ? (
              <ThemedView style={[styles.expandedForm, styles.transparent]}>
                <ThemedText type="small" themeColor="textSecondary">
                  {profile.role === 'chef'
                    ? t.account.deletion.chefWarning
                    : t.account.deletion.employeeWarning}
                </ThemedText>
                {deletionError && (
                  <ThemedText type="small" style={[styles.error, { color: theme.danger }]}>
                    {deletionError}
                  </ThemedText>
                )}
                <Pressable
                  style={({ pressed }) => [
                    styles.button,
                    { backgroundColor: theme.danger, opacity: pressed || deleting ? 0.7 : 1 },
                  ]}
                  disabled={deleting}
                  onPress={handleDeleteAccount}>
                  <ThemedText type="smallBold" style={{ color: theme.buttonText }}>
                    {deleting ? t.account.deletion.deleting : t.account.deletion.confirm}
                  </ThemedText>
                </Pressable>
                <Pressable onPress={() => setConfirmingDeletion(false)} disabled={deleting}>
                  <ThemedText type="linkPrimary" style={styles.centerText}>
                    {t.common.cancel}
                  </ThemedText>
                </Pressable>
              </ThemedView>
            ) : (
              <Pressable onPress={() => setConfirmingDeletion(true)}>
                <ThemedText type="small" style={{ color: theme.danger }}>
                  {t.account.deletion.action}
                </ThemedText>
              </Pressable>
            )}
          </ThemedView>

          <ThemedText type="small" themeColor="textSecondary" style={styles.centerText}>
            {t.account.signedInAs(t.account.role[profile.role])}
          </ThemedText>

          <Pressable onPress={signOut}>
            <ThemedText type="linkPrimary" style={styles.centerText}>
              {t.common.signOut}
            </ThemedText>
          </Pressable>
        </ScrollView>
      </SafeAreaView>
    </DismissKeyboardView>
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
    paddingBottom: Spacing.six,
    gap: Spacing.five,
  },
  centerText: {
    textAlign: 'center',
  },
  header: {
    alignItems: 'center',
    gap: Spacing.two,
  },
  avatar: {
    width: 96,
    height: 96,
    borderRadius: 48,
  },
  avatarPlaceholder: {
    justifyContent: 'center',
    alignItems: 'center',
  },
  roleBadge: {
    borderRadius: Spacing.four,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.half,
  },
  section: {
    gap: Spacing.three,
  },
  languageRow: {
    flexDirection: 'row',
    gap: Spacing.two,
  },
  languagePill: {
    borderRadius: Spacing.four,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.one,
    borderWidth: 1,
    borderColor: 'transparent',
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
  infoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: Spacing.two,
  },
  pressed: {
    opacity: 0.6,
  },
  linkNote: {
    paddingBottom: Spacing.two,
  },
  expandedForm: {
    gap: Spacing.three,
    paddingTop: Spacing.one,
  },
  transparent: {
    backgroundColor: 'transparent',
  },
});
