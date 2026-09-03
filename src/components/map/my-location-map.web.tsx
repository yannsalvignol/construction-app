import { MapPlaceholder } from '@/components/map/map-placeholder';
import { useI18n } from '@/hooks/use-i18n';

export function MyLocationMap() {
  const { t } = useI18n();
  return <MapPlaceholder title={t.map.yourLocation} />;
}
