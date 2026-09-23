/**
 * Below are the colors that are used in the app. The colors are defined in the light and dark mode.
 * There are many other ways to style your app. For example, [Nativewind](https://www.nativewind.dev/), [Tamagui](https://tamagui.dev/), [unistyles](https://reactnativeunistyles.vercel.app), etc.
 */

import '@/global.css';

import { Platform } from 'react-native';

export const Colors = {
  light: {
    text: '#241B35',
    background: '#F8F6FC',
    backgroundElement: '#FFFFFF',
    /** Text fields: a shade under the page, so a form reads as recessed. */
    backgroundInput: '#F3F0FA',
    backgroundSelected: '#E3DDED',
    textSecondary: '#655A75',
    /** Placeholders only: a step past textSecondary, since the field's own
     * tone already separates it from the page. */
    textPlaceholder: '#8C82A0',
    buttonText: '#ffffff',
    accent: '#8358D8',
    accentText: '#7B49CF',
    accentSoft: '#F3ECFD',
    danger: '#B82746',
    success: '#26734A',
    warning: '#8A5410',
    isDark: false,
  },
  dark: {
    text: '#F5F0FC',
    background: '#15111D',
    backgroundElement: '#211A2D',
    /** Text fields: a shade under the page, so a form reads as recessed. */
    backgroundInput: '#1B1626',
    backgroundSelected: '#44364F',
    textSecondary: '#C0B3CE',
    /** Placeholders only: a step past textSecondary, since the field's own
     * tone already separates it from the page. */
    textPlaceholder: '#8E82A0',
    buttonText: '#ffffff',
    accent: '#9163E6',
    accentText: '#D9BDFF',
    accentSoft: '#3B2A4D',
    danger: '#FF91A4',
    success: '#83D5A7',
    warning: '#F1C077',
    isDark: true,
  },
} as const;

export type ThemeColor = Exclude<keyof typeof Colors.light & keyof typeof Colors.dark, 'isDark'>;

export const Fonts = Platform.select({
  ios: {
    /** iOS `UIFontDescriptorSystemDesignDefault` */
    sans: 'system-ui',
    /** iOS `UIFontDescriptorSystemDesignSerif` */
    serif: 'ui-serif',
    /** iOS `UIFontDescriptorSystemDesignRounded` */
    rounded: 'ui-rounded',
    /** iOS `UIFontDescriptorSystemDesignMonospaced` */
    mono: 'ui-monospace',
  },
  default: {
    sans: 'normal',
    serif: 'serif',
    rounded: 'normal',
    mono: 'monospace',
  },
  web: {
    sans: 'var(--font-display)',
    serif: 'var(--font-serif)',
    rounded: 'var(--font-rounded)',
    mono: 'var(--font-mono)',
  },
});

export const Spacing = {
  half: 2,
  one: 4,
  two: 8,
  three: 16,
  four: 24,
  five: 32,
  six: 64,
} as const;

export const BottomTabInset = Platform.select({ ios: 50, android: 80 }) ?? 0;
export const MaxContentWidth = 800;
