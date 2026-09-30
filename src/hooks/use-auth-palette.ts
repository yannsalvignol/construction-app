import { useTheme } from '@/hooks/use-theme';

/**
 * The palette the signed-out screens share: sign in, sign up, create an
 * account, join a company, and the code-based password flows. They are one
 * continuous journey, so they are painted as one — a slightly cooler grey page
 * than the app's, fields a shade darker still, and white provider buttons.
 *
 * Light mode only. In dark mode these fall back to the theme's own colours,
 * since a fixed light palette would light the screen up at night.
 */
export function useAuthPalette() {
  const theme = useTheme();
  if (theme.isDark) {
    return {
      page: theme.background,
      field: theme.backgroundInput,
      fieldText: theme.text,
      social: theme.background,
      avatar: theme.backgroundSelected,
    };
  }
  return {
    page: '#F2F2F2',
    field: '#ECECEC',
    fieldText: '#9AA0AC',
    social: '#FFFFFF',
    // Clearly darker than both the page and the fields: an empty avatar is a
    // large disc, and at that size a near-white grey disappears into the page.
    avatar: '#C9C9C9',
  };
}
