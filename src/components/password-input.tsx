import React, { useState } from 'react';
import { Pressable, TextInput, View, type TextInputProps } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useI18n } from '@/hooks/use-i18n';
import { useTheme } from '@/hooks/use-theme';
import { workCopy } from '@/lib/work-copy';

/**
 * A password field with a reveal toggle. Typing a password blind on a phone, in the
 * sun and often with gloves, is where most sign-in failures start.
 */
export function PasswordInput({ style, ref, ...props }: TextInputProps & { ref?: React.Ref<TextInput> }) {
  const { locale } = useI18n();
  const copy = workCopy(locale);
  const theme = useTheme();
  const [visible, setVisible] = useState(false);
  return <View>
    <TextInput
      ref={ref}
      {...props}
      secureTextEntry={!visible}
      autoCapitalize="none"
      autoCorrect={false}
      // Room for the eye so a long password never runs under it.
      style={[style, { paddingRight: 46 }]}
    />
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={visible ? copy.hidePassword : copy.showPassword}
      onPress={() => setVisible(!visible)}
      hitSlop={12}
      style={{ position: 'absolute', right: 14, top: 0, bottom: 0, justifyContent: 'center' }}>
      <Ionicons name={visible ? 'eye-off-outline' : 'eye-outline'} size={20} color={theme.textSecondary} />
    </Pressable>
  </View>;
}
