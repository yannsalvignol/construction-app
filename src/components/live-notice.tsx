import { useState } from 'react';
import { Pressable, View } from 'react-native';
import { Action, Card } from './work-ui';
import { ThemedText } from './themed-text';
import { useI18n } from '@/hooks/use-i18n';
import { useTheme } from '@/hooks/use-theme';
import { workCopy } from '@/lib/work-copy';

/**
 * Live sharing has its own agreement, separate from the presence notice: being
 * followed during the day is a different thing to consent to than answering an
 * occasional check, so accepting one never implies the other.
 */
export function LiveNotice({ accepted, busy, onAccept, onWithdraw }: {
  accepted: boolean; busy: boolean; onAccept: () => void; onWithdraw: () => void;
}) {
  const { locale } = useI18n();
  const copy = workCopy(locale);
  const theme = useTheme();
  const [agreed, setAgreed] = useState(false);
  return <Card>
    <ThemedText style={{ fontSize: 22, fontWeight: '700' }}>{copy.liveNoticeTitle}</ThemedText>
    <ThemedText type="small" themeColor="textSecondary">{copy.liveNoticeIntro}</ThemedText>
    <ThemedText type="small">{copy.liveNoticeCollection}</ThemedText>
    <ThemedText type="small">{copy.liveNoticePrivacy}</ThemedText>
    <ThemedText type="small">{copy.liveNoticeRights}</ThemedText>
    {accepted
      ? <Action secondary label={copy.liveWithdraw} busy={busy} onPress={onWithdraw} />
      : <>
        <Pressable accessibilityRole="checkbox" accessibilityState={{ checked: agreed }} onPress={() => setAgreed(!agreed)}
          style={{ flexDirection: 'row', gap: 12, alignItems: 'flex-start' }}>
          <View style={{ width: 24, height: 24, borderRadius: 7, borderWidth: 2, marginTop: 2,
            borderColor: agreed ? theme.accent : theme.backgroundSelected, backgroundColor: agreed ? theme.accent : 'transparent',
            alignItems: 'center', justifyContent: 'center' }}>
            {agreed && <ThemedText type="smallBold" style={{ color: theme.buttonText }}>✓</ThemedText>}
          </View>
          <ThemedText type="small" style={{ flex: 1 }}>{copy.liveAgree}</ThemedText>
        </Pressable>
        <Action label={copy.liveAccept} busy={busy} disabled={!agreed} onPress={onAccept} />
      </>}
  </Card>;
}
