import { ThemedText } from './themed-text';
import { useI18n } from '@/hooks/use-i18n';
import { workCopy } from '@/lib/work-copy';

// Neither react-native-maps nor the platform geocoder has a web build, so the
// browser cannot resolve the address a pin sits on.
export function SitePicker({ onChange }: {
  onChange: (value: { latitude: number; longitude: number; address: string } | null) => void;
}) {
  const { locale } = useI18n();
  void onChange;
  return <ThemedText type="small" themeColor="warning">{workCopy(locale).geocodeUnavailable}</ThemedText>;
}
