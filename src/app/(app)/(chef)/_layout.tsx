import { useEffect } from 'react';

import ChefTabs from '@/components/chef-tabs';
import { useI18n } from '@/hooks/use-i18n';
import { useWarmTabs } from '@/hooks/use-warm-tabs';
import { enableChefAlerts } from '@/lib/presence-notifications';

export default function ChefLayout() {
  // Starts loading the tabs' content the moment the chef enters the app, so
  // none of them is ever opened cold.
  useWarmTabs();
  const { locale } = useI18n();
  // A safety alert that waits for him to open the app is not a safety feature.
  useEffect(() => { void enableChefAlerts(locale); }, [locale]);
  return <ChefTabs />;
}
