import { Platform, StyleSheet, Text, type TextProps } from 'react-native';

import { Fonts, ThemeColor } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

export type ThemedTextProps = TextProps & {
  type?: 'default' | 'title' | 'small' | 'smallBold' | 'subtitle' | 'link' | 'linkPrimary' | 'code';
  themeColor?: ThemeColor;
};

export function ThemedText({ style, type = 'default', themeColor, ...rest }: ThemedTextProps) {
  const theme = useTheme();
  // A caller that overrides fontSize but not lineHeight would otherwise keep the
  // preset's line height (24 for `default`) and get its glyphs clipped, so scale
  // the line box to match. An explicit lineHeight always wins.
  const custom = StyleSheet.flatten(style);
  const scaled =
    custom?.fontSize != null && custom.lineHeight == null
      ? { lineHeight: Math.ceil(custom.fontSize * 1.25) }
      : null;

  return (
    <Text
      // The app's own sizes, not the phone's. Every size here is chosen
      // against a layout — a devis line beside its quantity, an hour beside a
      // duration — and iOS's larger-text settings reflow those into columns
      // that no longer line up. A caller that genuinely wants a figure to
      // follow the phone can still pass allowFontScaling, since `rest` wins.
      allowFontScaling={false}
      style={[
        { color: theme[themeColor ?? (type === 'linkPrimary' ? 'accentText' : 'text')] },
        type === 'default' && styles.default,
        type === 'title' && styles.title,
        type === 'small' && styles.small,
        type === 'smallBold' && styles.smallBold,
        type === 'subtitle' && styles.subtitle,
        type === 'link' && styles.link,
        type === 'linkPrimary' && styles.linkPrimary,
        type === 'code' && styles.code,
        style,
        scaled,
      ]}
      {...rest}
    />
  );
}

const styles = StyleSheet.create({
  small: {
    fontSize: 14,
    lineHeight: 20,
    fontWeight: 500,
  },
  smallBold: {
    fontSize: 14,
    lineHeight: 20,
    fontWeight: 700,
  },
  default: {
    fontSize: 16,
    lineHeight: 24,
    fontWeight: 500,
  },
  title: {
    fontSize: 48,
    fontWeight: 600,
    lineHeight: 52,
  },
  subtitle: {
    fontSize: 32,
    lineHeight: 44,
    fontWeight: 600,
  },
  link: {
    lineHeight: 30,
    fontSize: 14,
    fontWeight: 600,
  },
  linkPrimary: {
    lineHeight: 30,
    fontSize: 14,
    fontWeight: 600,
  },
  code: {
    fontFamily: Fonts.mono,
    fontWeight: Platform.select({ android: 700 }) ?? 500,
    fontSize: 12,
  },
});
