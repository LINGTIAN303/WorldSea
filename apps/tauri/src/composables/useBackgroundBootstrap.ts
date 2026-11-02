/** 背景启动引导：全局 src 注入/校验、项目覆盖加载；接线见 docs/details/架构/界面背景机制-v2.md §7 */
import { convertFileSrc } from '@tauri-apps/api/core'
import {
  cleanupGlobalBackgroundOrphans, getFileStorageBackend, isTauri,
  readProjectBackground, resolveBackgroundSrc, resolveProjectBackgroundAssets,
} from '@worldsea/entity-core/core'
import {
  BACKGROUND_TARGETS, BACKGROUND_THEMES, normalizeProjectConfig, useBackground,
  type BackgroundTarget, type BackgroundTheme,
} from '@worldsea/style-kit'

/** 项目加载代数：清空/新加载自增，旧异步结果凭 token 丢弃，避免覆盖新项目 */
let generation = 0

/** 挂载前把全局绝对路径换成 asset URL，避免首帧空档；浏览器预览无 Tauri 直接跳过 */
export function hydrateGlobalBackground() {
  if (!isTauri()) return
  const api = useBackground()
  for (const target of BACKGROUND_TARGETS) {
    const paths = api.globalConfig.value.targets[target].paths
    api.setTargetSrcs(target, {
      light: paths.light ? convertFileSrc(paths.light) : '',
      dark: paths.dark ? convertFileSrc(paths.dark) : '',
    }, 'global')
  }
}

/** 校验全局背景文件是否仍在：失效只标记缺失，不改持久化配置；顺带清理孤儿文件 */
export async function validateGlobalBackground() {
  if (!isTauri()) return
  const api = useBackground()
  for (const target of BACKGROUND_TARGETS) {
    for (const theme of BACKGROUND_THEMES) {
      const path = api.globalConfig.value.targets[target].paths[theme]
      if (!path) continue
      const src = await resolveBackgroundSrc(path)
      if (src) api.setTargetSrc(target, theme, src, 'global')
      else api.markMissing(target, theme, 'global')
    }
  }
  await cleanupGlobalBackgroundOrphans(() => BACKGROUND_TARGETS.flatMap(target =>
    BACKGROUND_THEMES.map(theme => api.globalConfig.value.targets[target].paths[theme]),
  ).filter(Boolean))
}

/** 读取当前项目背景覆盖并解析资产；无项目/无配置/配置无效时清空覆盖（回到跟随全局） */
export async function loadProjectBackgroundForCurrentProject() {
  const token = ++generation
  const api = useBackground()
  const dir = getFileStorageBackend()?.projectDir ?? null
  if (!dir) { api.setProjectConfig(null); return }
  const raw = await readProjectBackground(dir)
  if (token !== generation) return
  const config = normalizeProjectConfig(raw)
  if (!config) { api.setProjectConfig(null); return }
  const refs: Array<{ target: BackgroundTarget; theme: BackgroundTheme; path: string }> = []
  for (const target of BACKGROUND_TARGETS) {
    const t = config.targets[target]
    if (!t) continue
    for (const theme of BACKGROUND_THEMES) {
      if (t.paths[theme]) refs.push({ target, theme, path: t.paths[theme] })
    }
  }
  const { srcs, missing } = await resolveProjectBackgroundAssets(dir, refs)
  if (token !== generation) return
  api.setProjectConfig(config)
  for (const target of BACKGROUND_TARGETS) {
    if (!config.targets[target]) continue
    const targetSrcs = srcs[target] ?? {}
    api.setTargetSrcs(target, { light: targetSrcs.light ?? '', dark: targetSrcs.dark ?? '' }, 'project')
    for (const theme of BACKGROUND_THEMES) if (missing[target]?.[theme]) api.markMissing(target, theme, 'project')
  }
}

/** 项目切换开始：作废旧异步结果并清空旧项目覆盖 */
export function clearProjectBackground() {
  generation++
  useBackground().setProjectConfig(null)
}
