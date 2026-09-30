import { useState } from 'react';
import { Checkbox } from './checkbox';
import { Action, Card } from './work-ui';
import { ThemedText } from './themed-text';
import { useI18n } from '@/hooks/use-i18n';
import { workCopy } from '@/lib/work-copy';

export function PresenceNotice({ accepted, busy, onAccept, onWithdraw }: { accepted: boolean; busy: boolean; onAccept: () => void; onWithdraw: () => void }) {
  const { locale } = useI18n();
  const copy = workCopy(locale);
  const [checked, setChecked] = useState(false);
  const [withdrawing, setWithdrawing] = useState(false);
  return <Card>
    <ThemedText style={{ fontSize: 24, lineHeight: 30, fontWeight: '700' }}>{copy.noticeTitle}</ThemedText>
    {[copy.noticeIntro, copy.noticeCollection, copy.noticePrivacy, copy.noticeAccess, copy.noticeRights, copy.noticeChoice].map(text => <ThemedText key={text} themeColor="textSecondary">{text}</ThemedText>)}
    {accepted ? <>
      {withdrawing && <ThemedText>{copy.withdrawConfirm}</ThemedText>}
      <Action secondary busy={busy} label={copy.withdraw} onPress={() => withdrawing ? onWithdraw() : setWithdrawing(true)} />
      {withdrawing && <Action secondary label={copy.cancel} onPress={() => setWithdrawing(false)} />}
    </> : <>
      <Checkbox checked={checked} onCheckedChange={setChecked} label={copy.agreeLabel} />
      <Action label={copy.accept} disabled={!checked} busy={busy} onPress={onAccept} />
    </>}
  </Card>;
}
