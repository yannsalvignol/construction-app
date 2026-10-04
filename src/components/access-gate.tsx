import { useCallback, useState } from 'react';
import { Linking } from 'react-native';
import { useFocusEffect } from 'expo-router';

import { ThemedText } from '@/components/themed-text';
import { Action, Card, WorkPage } from '@/components/work-ui';
import { useAuth } from '@/hooks/use-auth';
import { useI18n } from '@/hooks/use-i18n';
import { supabase } from '@/lib/supabase';

/** Where a locked chef is told to write. */
export const SALES_EMAIL = 'melanie@casprod.app';
const PRICING_URL = 'https://casprod.app/#tarifs';

type Access = {
  active: boolean;
  days_left: number;
  locked: boolean;
  notice_seen: boolean;
};

/**
 * Fifteen days, then a conversation.
 *
 * Two screens from one question. On the first opening, what the trial is and
 * how long it runs — said once, because a chef who has read it does not need
 * it every morning. After it expires, a wall: the app is not usable until
 * somebody here unlocks the account.
 *
 * Only in front of the chef. An employee did not sign anything and cannot pay
 * anything; locking him out of a day he is halfway through would punish the
 * wrong person for his employer's invoice.
 *
 * The screen is not the lock. The database refuses a locked company's writes
 * on its own, because a lock that lives in the app is a suggestion.
 */
export function AccessGate({ children }: { children: React.ReactNode }) {
  const { profile } = useAuth();
  const { t } = useI18n();
  const [access, setAccess] = useState<Access | null>(null);
  const [dismissed, setDismissed] = useState(false);

  const load = useCallback(async () => {
    if (profile?.role !== 'chef') return;
    const { data } = await supabase.rpc('company_access');
    setAccess((data as Access) ?? null);
  }, [profile?.role]);

  useFocusEffect(useCallback(() => { void load(); }, [load]));

  if (profile?.role !== 'chef' || !access) return <>{children}</>;

  if (access.locked) {
    return (
      <WorkPage topInset title={t.trial.lockedTitle}>
        <Card>
          <ThemedText type="small" themeColor="textSecondary">{t.trial.lockedBody}</ThemedText>
          <ThemedText type="smallBold">{SALES_EMAIL}</ThemedText>
          <Action
            label={t.trial.writeToUs}
            onPress={() => {
              void Linking.openURL(
                `mailto:${SALES_EMAIL}?subject=${encodeURIComponent(t.trial.mailSubject)}`
              );
            }}
          />
          <Action secondary label={t.trial.seePricing} onPress={() => { void Linking.openURL(PRICING_URL); }} />
        </Card>
      </WorkPage>
    );
  }

  // The welcome, once. Marked seen as he dismisses it rather than as it
  // appears: a screen closed by a crash was never read.
  if (!access.active && !access.notice_seen && !dismissed) {
    return (
      <WorkPage topInset title={t.trial.welcomeTitle}>
        <Card accent>
          <ThemedText type="smallBold">{t.trial.freeDays(access.days_left)}</ThemedText>
          <ThemedText type="small" themeColor="textSecondary">{t.trial.welcomeBody}</ThemedText>
          <Action
            label={t.trial.start}
            onPress={() => {
              setDismissed(true);
              void supabase.rpc('mark_trial_notice_seen');
            }}
          />
          <Action secondary label={t.trial.seePricing} onPress={() => { void Linking.openURL(PRICING_URL); }} />
        </Card>
      </WorkPage>
    );
  }

  return <>{children}</>;
}
