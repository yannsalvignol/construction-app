import { View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { ThemedText } from './themed-text';
import { useI18n } from '@/hooks/use-i18n';
import { useTheme } from '@/hooks/use-theme';
import { workCopy } from '@/lib/work-copy';

/**
 * Whether a shared position sits inside the site's zone. `null` is not "off site":
 * it means the site has no coordinates, so the distance cannot be computed and
 * saying either would be a guess.
 */
export function OnSiteBadge({ onSite, distance }: { onSite: boolean | null; distance?: number | null }) {
  const { locale } = useI18n();
  const copy = workCopy(locale);
  const theme = useTheme();
  if (onSite === null || onSite === undefined) {
    return <ThemedText type="small" themeColor="textSecondary">{copy.zoneUnknown}</ThemedText>;
  }
  const tint = onSite ? theme.success : theme.danger;
  return <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
    <Ionicons name={onSite ? 'checkmark-circle-outline' : 'alert-circle-outline'} size={16} color={tint} />
    <ThemedText type="smallBold" style={{ color: tint, flexShrink: 1 }}>
      {onSite ? copy.onSite : distance != null ? copy.offSiteAt(distance) : copy.offSite}
    </ThemedText>
  </View>;
}
