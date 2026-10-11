import { ref, computed } from 'vue'

export interface FontPresetEntry {
  id: string
  displayName: string
  family: string
  category: 'content' | 'ui'
  source: 'wsfont' | 'system'
  wsfontPath?: string
  tags: string[]
  description?: string
}

export const FONT_PRESETS: FontPresetEntry[] = [
  // ─── Content Fonts ───
  {
    id: 'mao-zedong',
    displayName: '毛泽东字体',
    family: 'Mao Ze Dong',
    category: 'content',
    source: 'wsfont',
    wsfontPath: '/fonts/mao-zedong.wsfont',
    tags: ['书法', '毛体', 'calligraphy'],
    description: '毛泽东书法风格字体，来源：字体家',
  },
  {
    id: 'source-han-serif-cn',
    displayName: 'Source Han Serif CN',
    family: 'Source Han Serif CN',
    category: 'content',
    source: 'wsfont',
    wsfontPath: '/fonts/source-han-serif-cn.wsfont',
    tags: ['宋体', '衬线', 'serif', '思源宋体'],
    description: '思源宋体，经典中文衬线字体',
  },
  {
    id: 'lxgw-neo-zhisong',
    displayName: '霞鹜新志宋',
    family: 'LXGW Neo ZhiSong',
    category: 'content',
    source: 'wsfont',
    wsfontPath: '/fonts/lxgw-neo-zhisong.wsfont',
    tags: ['宋体', '现代', 'serif', '文艺'],
    description: '现代风格宋体，适合文学内容',
  },
  {
    id: 'liu-jian-mao-cao',
    displayName: '刘建毛草',
    family: 'Liu Jian Mao Cao',
    category: 'content',
    source: 'wsfont',
    wsfontPath: '/fonts/liu-jian-mao-cao.wsfont',
    tags: ['草书', '书法', 'cursive'],
    description: '草书风格，适合标题与装饰',
  },
  {
    id: 'jiangxi-zhuokai',
    displayName: '江西拙楷',
    family: 'jiangxizhuokai',
    category: 'content',
    source: 'wsfont',
    wsfontPath: '/fonts/jiangxi-zhuokai.wsfont',
    tags: ['楷体', '楷书', 'kai'],
    description: '拙朴楷书，适合正文阅读',
  },
  {
    id: 'xzfx-xingcao',
    displayName: '书体坊行草体',
    family: 'shetifang-zxf-xingcao',
    category: 'content',
    source: 'wsfont',
    wsfontPath: '/fonts/xzfx-xingcao.wsfont',
    tags: ['行草', '书法', 'running-cursive'],
    description: '书体坊禚效锋行草体',
  },

  // ─── UI Fonts ───
  {
    id: 'misans',
    displayName: 'MiSans',
    family: 'MiSans',
    category: 'ui',
    source: 'wsfont',
    wsfontPath: '/fonts/misans.wsfont',
    tags: ['无衬线', 'sans-serif', '现代', 'ui'],
    description: '小米 Sans，清晰现代的界面字体',
  },
  {
    id: 'oppo-sans',
    displayName: 'OPPO Sans',
    family: 'OPPO Sans',
    category: 'ui',
    source: 'wsfont',
    wsfontPath: '/fonts/oppo-sans.wsfont',
    tags: ['无衬线', 'sans-serif', 'ui'],
    description: 'OPPO Sans，精致优雅的界面字体',
  },
  {
    id: 'ibm-plex-sans-sc',
    displayName: 'IBM Plex Sans SC',
    family: 'IBM Plex Sans SC',
    category: 'ui',
    source: 'wsfont',
    wsfontPath: '/fonts/ibm-plex-sans-sc.wsfont',
    tags: ['无衬线', 'sans-serif', '技术', 'technical'],
    description: 'IBM Plex 中文，技术风格界面字体',
  },
  {
    id: 'noto-sans-cjk-sc',
    displayName: 'Noto Sans CJK SC',
    family: 'Noto Sans CJK SC',
    category: 'ui',
    source: 'wsfont',
    wsfontPath: '/fonts/noto-sans-cjk-sc.wsfont',
    tags: ['无衬线', 'sans-serif', '中性', 'neutral'],
    description: 'Google Noto Sans CJK，字符覆盖最全',
  },
]

export function useFontPresets() {
  const installedIds = ref<Set<string>>(new Set())

  const contentPresets = computed(() =>
    FONT_PRESETS.filter((p) => p.category === 'content'),
  )

  const uiPresets = computed(() =>
    FONT_PRESETS.filter((p) => p.category === 'ui'),
  )

  function getPreset(id: string): FontPresetEntry | undefined {
    return FONT_PRESETS.find((p) => p.id === id)
  }

  function getPresetByFamily(family: string): FontPresetEntry | undefined {
    return FONT_PRESETS.find((p) => p.family === family)
  }

  function isInstalled(id: string): boolean {
    return installedIds.value.has(id)
  }

  function markInstalled(id: string) {
    if (installedIds.value.has(id)) return
    installedIds.value = new Set([...installedIds.value, id])
  }

  return {
    installedIds,
    contentPresets,
    uiPresets,
    getPreset,
    getPresetByFamily,
    isInstalled,
    markInstalled,
  }
}
