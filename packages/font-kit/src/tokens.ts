export type FontSizeToken =
  | '2xs'
  | 'xs'
  | 'sm'
  | 'base'
  | 'md'
  | 'lg'
  | 'xl'
  | '2xl'
  | '3xl'

export type FontWeightToken =
  | 'normal'
  | 'medium'
  | 'semibold'
  | 'bold'

export type LineHeightToken =
  | 'tight'
  | 'normal'
  | 'relaxed'
  | 'loose'

export type LetterSpacingToken =
  | 'tight'
  | 'normal'
  | 'wide'
  | 'wider'

export type FontCategoryToken =
  | 'base'
  | 'mono'
  | 'serif'
  | 'display'

export const FONT_SIZE_VALUES: Record<FontSizeToken, number> = {
  '2xs': 9,
  xs: 11,
  sm: 12,
  base: 14,
  md: 15,
  lg: 16,
  xl: 18,
  '2xl': 22,
  '3xl': 28,
}

export const FONT_WEIGHT_VALUES: Record<FontWeightToken, number> = {
  normal: 400,
  medium: 500,
  semibold: 600,
  bold: 700,
}

export const LINE_HEIGHT_VALUES: Record<LineHeightToken, number> = {
  tight: 1.25,
  normal: 1.5,
  relaxed: 1.75,
  loose: 2,
}

export const LETTER_SPACING_VALUES: Record<LetterSpacingToken, string> = {
  tight: '-0.01em',
  normal: '0',
  wide: '0.02em',
  wider: '0.05em',
}

export const FONT_FAMILY_VALUES: Record<FontCategoryToken, string> = {
  base: "'Inter', 'Segoe UI', system-ui, -apple-system, sans-serif",
  mono: "'JetBrains Mono', 'Consolas', 'Fira Code', monospace",
  serif: "'Noto Serif SC', 'Georgia', serif",
  display: "'Inter', 'Segoe UI', system-ui, -apple-system, sans-serif",
}

export const CSS_VAR_FONT_SIZE: Record<FontSizeToken, string> = {
  '2xs': 'var(--font-size-2xs)',
  xs: 'var(--font-size-xs)',
  sm: 'var(--font-size-sm)',
  base: 'var(--font-size-base)',
  md: 'var(--font-size-md)',
  lg: 'var(--font-size-lg)',
  xl: 'var(--font-size-xl)',
  '2xl': 'var(--font-size-2xl)',
  '3xl': 'var(--font-size-3xl)',
}

export const CSS_VAR_FONT_WEIGHT: Record<FontWeightToken, string> = {
  normal: 'var(--font-weight-normal)',
  medium: 'var(--font-weight-medium)',
  semibold: 'var(--font-weight-semibold)',
  bold: 'var(--font-weight-bold)',
}

export const CSS_VAR_LINE_HEIGHT: Record<LineHeightToken, string> = {
  tight: 'var(--line-height-tight)',
  normal: 'var(--line-height-normal)',
  relaxed: 'var(--line-height-relaxed)',
  loose: 'var(--line-height-loose)',
}

export const CSS_VAR_LETTER_SPACING: Record<LetterSpacingToken, string> = {
  tight: 'var(--letter-spacing-tight)',
  normal: 'var(--letter-spacing-normal)',
  wide: 'var(--letter-spacing-wide)',
  wider: 'var(--letter-spacing-wider)',
}

export const CSS_VAR_FONT_FAMILY: Record<FontCategoryToken, string> = {
  base: 'var(--font-family-base)',
  mono: 'var(--font-family-mono)',
  serif: 'var(--font-family-serif)',
  display: 'var(--font-family-display)',
}

export interface FontTokens {
  size: FontSizeToken
  weight: FontWeightToken
  lineHeight: LineHeightToken
  letterSpacing: LetterSpacingToken
  category: FontCategoryToken
}

export interface SemanticFontTokens {
  display: { size: FontSizeToken; weight: FontWeightToken; lineHeight: LineHeightToken; letterSpacing: LetterSpacingToken }
  title: { size: FontSizeToken; weight: FontWeightToken; lineHeight: LineHeightToken; letterSpacing: LetterSpacingToken }
  heading: { size: FontSizeToken; weight: FontWeightToken; lineHeight: LineHeightToken; letterSpacing: LetterSpacingToken }
  subheading: { size: FontSizeToken; weight: FontWeightToken; lineHeight: LineHeightToken; letterSpacing: LetterSpacingToken }
  body: { size: FontSizeToken; weight: FontWeightToken; lineHeight: LineHeightToken; letterSpacing: LetterSpacingToken }
  bodySm: { size: FontSizeToken; weight: FontWeightToken; lineHeight: LineHeightToken; letterSpacing: LetterSpacingToken }
  caption: { size: FontSizeToken; weight: FontWeightToken; lineHeight: LineHeightToken; letterSpacing: LetterSpacingToken }
  overline: { size: FontSizeToken; weight: FontWeightToken; lineHeight: LineHeightToken; letterSpacing: LetterSpacingToken }
  micro: { size: FontSizeToken }
}

export const COSMIC_FONT_TOKENS: SemanticFontTokens = {
  display: { size: '3xl', weight: 'bold', lineHeight: 'tight', letterSpacing: 'tight' },
  title: { size: '2xl', weight: 'semibold', lineHeight: 'tight', letterSpacing: 'tight' },
  heading: { size: 'xl', weight: 'semibold', lineHeight: 'tight', letterSpacing: 'normal' },
  subheading: { size: 'lg', weight: 'medium', lineHeight: 'normal', letterSpacing: 'normal' },
  body: { size: 'base', weight: 'normal', lineHeight: 'normal', letterSpacing: 'normal' },
  bodySm: { size: 'sm', weight: 'normal', lineHeight: 'normal', letterSpacing: 'normal' },
  caption: { size: 'xs', weight: 'normal', lineHeight: 'normal', letterSpacing: 'wide' },
  overline: { size: 'xs', weight: 'medium', lineHeight: 'tight', letterSpacing: 'wider' },
  micro: { size: '2xs' },
}

export function cssFontSize(token: FontSizeToken): string {
  return CSS_VAR_FONT_SIZE[token]
}

export function cssFontWeight(token: FontWeightToken): string {
  return CSS_VAR_FONT_WEIGHT[token]
}

export function cssLineHeight(token: LineHeightToken): string {
  return CSS_VAR_LINE_HEIGHT[token]
}

export function cssLetterSpacing(token: LetterSpacingToken): string {
  return CSS_VAR_LETTER_SPACING[token]
}

export function cssFontFamily(token: FontCategoryToken): string {
  return CSS_VAR_FONT_FAMILY[token]
}

export function pxFontSize(token: FontSizeToken): number {
  return FONT_SIZE_VALUES[token]
}

export function numericWeight(token: FontWeightToken): number {
  return FONT_WEIGHT_VALUES[token]
}

export function numericLineHeight(token: LineHeightToken): number {
  return LINE_HEIGHT_VALUES[token]
}

export function cssFontShorthand(
  size: FontSizeToken = 'base',
  weight: FontWeightToken = 'normal',
  lineHeight: LineHeightToken = 'normal',
  family: FontCategoryToken = 'base',
): string {
  return `${cssFontWeight(weight)} ${FONT_SIZE_VALUES[size]}px / ${LINE_HEIGHT_VALUES[lineHeight]} ${FONT_FAMILY_VALUES[family]}`
}
