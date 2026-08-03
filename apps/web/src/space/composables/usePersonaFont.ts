import { ref, computed, watch, onScopeDispose, getCurrentScope } from 'vue'
import {
  register,
  unregister,
  loadFont,
  type TextAnimationEffect,
} from '@worldsmith/font-kit'
import { usePersonaFontStore, type PersonaFontProfile } from '../stores/persona-font-store'

interface TransitionConfig {
  type: 'spring' | 'smooth' | 'snap'
  damping?: number
  stiffness?: number
  duration?: number
}

function profileToTransitionConfig(profile: PersonaFontProfile): TransitionConfig {
  switch (profile.animationStyle.panelTransition) {
    case 'spring':
      return { type: 'spring', damping: 0.7, stiffness: 300 }
    case 'smooth':
      return { type: 'smooth', duration: 300 }
    case 'snap':
      return { type: 'snap', duration: 150 }
  }
}

export function usePersonaFont() {
  const store = usePersonaFontStore()
  const isLoaded = ref(false)
  const loadingError = ref<string | null>(null)

  const profile = computed(() => store.activeProfile)

  const fontFamily = computed(() => {
    const p = profile.value
    return `"${p.fontFamily}", "${p.fallbackFamily}", sans-serif`
  })

  const cssVars = computed<Record<string, string>>(() => {
    const p = profile.value
    return {
      '--agent-font': fontFamily.value,
      '--agent-primary': p.accentColor,
      '--agent-accent': p.accentColor,
      '--font-size-base': `${14 * p.sizeScale}px`,
      '--font-size-sm': `${12 * p.sizeScale}px`,
      '--font-size-xs': `${11 * p.sizeScale}px`,
    }
  })

  const enterAnimation = computed<TextAnimationEffect>(
    () => profile.value.animationStyle.messageEnter
  )

  const transitionConfig = computed<TransitionConfig>(
    () => profileToTransitionConfig(profile.value)
  )

  let currentFontId: string | null = null
  const injectedLinks = new Map<string, HTMLLinkElement>()

  function injectCssLink(id: string, cssUrl: string): Promise<void> {
    const existing = injectedLinks.get(id)
    if (existing) {
      if (existing.dataset.cssUrl === cssUrl) return Promise.resolve()
      existing.remove()
      injectedLinks.delete(id)
    }
    return new Promise((resolve, reject) => {
      const link = document.createElement('link')
      link.rel = 'stylesheet'
      link.href = cssUrl
      link.dataset.wfFontId = id
      link.dataset.cssUrl = cssUrl
      link.onload = () => resolve()
      link.onerror = () => reject(new Error(`字体 CSS 加载失败: ${cssUrl}`))
      document.head.appendChild(link)
      injectedLinks.set(id, link)
    })
  }

  function removeInjectedLink(id: string) {
    const link = injectedLinks.get(id)
    if (link) {
      link.remove()
      injectedLinks.delete(id)
    }
  }

  async function applyProfile(p: PersonaFontProfile) {
    if (currentFontId === p.id && isLoaded.value) return

    if (currentFontId && currentFontId !== p.id) {
      try { unregister(currentFontId) } catch {}
      removeInjectedLink(currentFontId)
    }

    isLoaded.value = false
    loadingError.value = null

    if (p.fontSource) {
      try {
        if (p.fontSource.type === 'windfonts') {
          const family = p.fontFamily
          const weight = p.fontSource.weight || 'Regular'
          const cssUrl = `https://app.windfonts.com/api/css?family=${encodeURIComponent(family)}&weight=${encodeURIComponent(weight)}&version=zh-common`
          await injectCssLink(p.id, cssUrl)
        } else if (p.fontSource.type === 'wsfont') {
          const { restoreFromDB, installFromWsfont } = await import('@/composables/fontInstaller')
          const { useFontLibraryStore } = await import('@/stores/fontLibraryStore')
          const libraryStore = useFontLibraryStore()
          const path = p.fontSource.path ?? ''
          if (path.startsWith('wsfont:')) {
            const manifestId = path.slice(7)
            const entry = libraryStore.getEntry(manifestId)
            if (entry) {
              await restoreFromDB(entry)
            }
          } else if (path) {
            const resp = await fetch(path)
            if (!resp.ok) throw new Error(`字体包加载失败: ${resp.status}`)
            const buffer = await resp.arrayBuffer()
            const { entry } = await installFromWsfont(buffer)
            libraryStore.addEntry(entry)
          }
        } else if (p.fontSource.type === 'system') {
          const { scanSystemFonts, readFontFile } = await import('@worldsmith/font-kit')
          const fonts = await scanSystemFonts()
          const match = fonts.find(f => f.family === p.fontFamily)
          if (match?.path) {
            const data = await readFontFile(match.path)
            if (data) {
              await register({
                id: p.id,
                family: p.fontFamily,
                weight: match.weight,
                style: match.style,
                source: { type: 'buffer', buffer: data },
              })
              await loadFont(p.id)
            }
          }
        } else if (p.fontSource.type === 'url') {
          await register({
            id: p.id,
            family: p.fontFamily,
            weight: 400,
            style: 'normal',
            source: { type: 'url', url: p.fontSource.path! },
          })
          await loadFont(p.id)
        }
      } catch (err) {
        loadingError.value = err instanceof Error ? err.message : String(err)
      }
    }

    currentFontId = p.id
    isLoaded.value = true
  }

  watch(profile, (p) => { applyProfile(p) }, { immediate: true })

  const scope = getCurrentScope()
  if (scope) {
    onScopeDispose(() => {
      if (currentFontId) {
        try { unregister(currentFontId) } catch {}
        removeInjectedLink(currentFontId)
        currentFontId = null
      }
    })
  }

  return {
    profile,
    isLoaded,
    loadingError,
    fontFamily,
    cssVars,
    enterAnimation,
    transitionConfig,
  }
}
