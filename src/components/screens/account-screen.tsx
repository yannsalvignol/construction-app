import { useFocusEffect, useRouter } from 'expo-router';
import { decode } from 'base64-arraybuffer';
import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useCallback, useState } from 'react';
import { Keyboard, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { AnimatedInput } from '@/components/animated-input';
import { BrandSpinner } from '@/components/brand-spinner';
import { PhoneInput } from '@/components/phone-input';
import { ThemedView } from '@/components/themed-view';
import { MaxContentWidth, Spacing } from '@/constants/theme';
import { useAuth } from '@/hooks/use-auth';
import { useAuthPalette } from '@/hooks/use-auth-palette';
import { useI18n } from '@/hooks/use-i18n';
import { useTheme } from '@/hooks/use-theme';
import { translateServerError } from '@/lib/i18n/server-errors';
import { supabase } from '@/lib/supabase';

export function AccountScreen() {
  const insets = useSafeAreaInsets();
  const theme = useTheme();
  const palette = useAuthPalette();
  const router = useRouter();
  const { t, locale } = useI18n();
  const { profile, refreshProfile } = useAuth();

  const [firstName, setFirstName] = useState(profile?.first_name ?? '');
  const [lastName, setLastName] = useState(profile?.last_name ?? '');
  const [phone, setPhone] = useState(profile?.phone ?? '');
  const [companyName, setCompanyName] = useState('');
  const [savingInfo, setSavingInfo] = useState(false);
  const [infoError, setInfoError] = useState<string | null>(null);
  const [infoSaved, setInfoSaved] = useState(false);

  const [uploadingPhoto, setUploadingPhoto] = useState(false);
  const [photoError, setPhotoError] = useState<string | null>(null);


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

  if (!profile) return null;

  return (
    <ThemedView style={styles.container}>
      <SafeAreaView style={styles.safeArea} edges={['top', 'left', 'right']}>
        <ScrollView
          contentContainerStyle={[styles.scrollContent, { paddingBottom: Spacing.six + insets.bottom }]}
          keyboardShouldPersistTaps="handled"
            keyboardDismissMode="on-drag">
          <View style={styles.toolbar}>
            {/* The chef's screens have no header of their own here, so the way
                back lives on this row alongside the gear. */}
            <View style={styles.toolbarLeft}>
              {/* Pushed over the tabs for a chef, a tab of its own for an
                  employee: the chevron belongs only to the pushed one. */}
              {router.canGoBack() && (
                <Pressable
                  onPress={() => router.back()}
                  hitSlop={8}
                  accessibilityLabel={t.common.back}
                  style={({ pressed }) => pressed && styles.pressed}>
                  <Ionicons name="chevron-back" size={28} color={theme.text} />
                </Pressable>
              )}
              <ThemedText type="subtitle" style={styles.toolbarTitle}>{t.account.editProfile}</ThemedText>
            </View>

            <Pressable
              onPress={() => router.push('/settings')}
              hitSlop={8}
              accessibilityLabel={t.settings.title}
              style={({ pressed }) => pressed && styles.pressed}>
              <Ionicons name="settings-outline" size={28} color={theme.text} />
            </Pressable>
          </View>

          <ThemedView style={[styles.header, styles.transparent]}>
            <Pressable
              onPress={handlePickPhoto}
              disabled={uploadingPhoto}
              accessibilityRole="button"
              accessibilityLabel={uploadingPhoto ? t.account.uploadingPhoto : t.account.changePhoto}
              style={({ pressed }) => pressed && styles.pressed}>
              {profile.avatar_url ? (
                <Image source={{ uri: profile.avatar_url }} style={styles.avatar} />
              ) : (
                <ThemedView
                  style={[
                    styles.avatar,
                    styles.avatarPlaceholder,
                    { backgroundColor: palette.avatar, borderColor: theme.backgroundSelected },
                  ]}>
                  <Ionicons name="person" size={32} color={theme.textSecondary} />
                </ThemedView>
              )}

              {/* On the picture rather than under it: the badge says what the
                  tap does without a line of text to read. */}
              <View style={styles.editBadge}>
                {uploadingPhoto ? (
                  <BrandSpinner size={22} color={theme.text} />
                ) : (
                  <Ionicons name="create" size={30} color={theme.text} />
                )}
              </View>
            </Pressable>

            <ThemedText type="subtitle" style={styles.centerText}>
              {profile.first_name} {profile.last_name}
            </ThemedText>

            {photoError && (
              <ThemedText type="small" style={[styles.error, { color: theme.danger }]}>
                {photoError}
              </ThemedText>
            )}
          </ThemedView>

          <ThemedView style={[styles.section, styles.transparent]}>
            <ThemedText type="smallBold">{t.account.profile.title}</ThemedText>
            <AnimatedInput
              surface={palette.field}
              labelColor={palette.fieldText}
              label={t.account.profile.firstNamePlaceholder}
              returnKeyType="next"
              value={firstName}
              onChangeText={(value) => {
                setFirstName(value);
                setInfoSaved(false);
              }}
            />
            <AnimatedInput
              surface={palette.field}
              labelColor={palette.fieldText}
              label={t.account.profile.lastNamePlaceholder}
              returnKeyType="next"
              value={lastName}
              onChangeText={(value) => {
                setLastName(value);
                setInfoSaved(false);
              }}
            />
            <PhoneInput
              surface={palette.field}
              labelColor={palette.fieldText}
              label={t.account.profile.phonePlaceholder}
              value={phone ?? ''}
              onChangeText={(value) => {
                setPhone(value);
                setInfoSaved(false);
              }}
            />

            {profile.role === 'chef' && (
              <AnimatedInput
                surface={palette.field}
                labelColor={palette.fieldText}
                label={t.account.profile.companyNamePlaceholder}
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
        </ScrollView>
      </SafeAreaView>
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
    paddingBottom: Spacing.six,
    gap: Spacing.five,
  },
  centerText: {
    textAlign: 'center',
  },
  toolbar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  toolbarLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
  },
  // Same size as the Réglages heading, so the two screens read as siblings.
  toolbarTitle: {
    fontSize: 24,
    lineHeight: 32,
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
  editBadge: {
    position: 'absolute',
    // Positive insets: the glyph sits on the picture rather than beside it.
    right: 2,
    bottom: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  section: {
    gap: Spacing.three,
  },
  button: {
    borderRadius: Spacing.two,
    paddingVertical: Spacing.three,
    alignItems: 'center',
  },
  error: {
    
    textAlign: 'center',
  },
  pressed: {
    opacity: 0.6,
  },
  transparent: {
    backgroundColor: 'transparent',
  },
});
