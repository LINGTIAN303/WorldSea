import { ref, readonly, onScopeDispose, getCurrentScope } from 'vue'

const _prefersReduced = ref(false)

let _consumerCount = 0
let _initialized = false
let _mediaQuery: MediaQueryList | null = null
let _observer: MutationObserver | null = null

function appReduced(): boolean {
  return typeof document !== 'undefined' && document.documentElement.dataset.reduceMotion === 'on'
}

function systemReduced(): boolean {
  return typeof window !== 'undefined'
    && typeof window.matchMedia === 'function'
    && window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

function sync() {
  _prefersReduced.value = appReduced() || systemReduced()
}

function onChange() {
  sync()
}

function init() {
  if (_initialized || typeof window === 'undefined') return
  _initialized = true
  if (typeof window.matchMedia === 'function') {
    _mediaQuery = window.matchMedia('(prefers-reduced-motion: reduce)')
    _mediaQuery.addEventListener('change', onChange)
  }
  if (typeof MutationObserver !== 'undefined') {
    _observer = new MutationObserver(sync)
    _observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-reduce-motion'] })
  }
  sync()
}

function release() {
  _consumerCount--
  if (_consumerCount <= 0) {
    _consumerCount = 0
    if (_mediaQuery) {
      _mediaQuery.removeEventListener('change', onChange)
      _mediaQuery = null
    }
    _observer?.disconnect()
    _observer = null
    _initialized = false
  }
}

export function useReducedMotion() {
  _consumerCount++
  init()

  if (getCurrentScope()) {
    onScopeDispose(() => {
      release()
    })
  }

  return {
    prefersReducedMotion: readonly(_prefersReduced),
  }
}

export function isReducedMotion(): boolean {
  if (typeof window === 'undefined') return false
  return appReduced() || systemReduced()
}
