import { Card } from './work-ui';
import { ThemedText } from './themed-text';
import { useI18n } from '@/hooks/use-i18n';
import { workCopy } from '@/lib/work-copy';

// Sharing needs the native location task, so the web build only explains itself.
export function EmployeeLiveMap() {
  const { locale } = useI18n();
  const copy = workCopy(locale);
  return <Card>
    <ThemedText style={{ fontSize: 22, fontWeight: '700' }}>{copy.myPosition}</ThemedText>
    <ThemedText type="small" themeColor="textSecondary">{copy.nativeOnly}</ThemedText>
  </Card>;
}
