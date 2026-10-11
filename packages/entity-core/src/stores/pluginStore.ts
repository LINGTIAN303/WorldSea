import { defineStore } from 'pinia'
import { ref } from 'vue'
import type { PluginManifest, PluginView } from '../types/plugin'

export const usePluginStore = defineStore('plugin', () => {
  const plugins = ref<PluginManifest[]>([])
  const views = ref<PluginView[]>([])
  const loading = ref(false)

  function registerView(view: PluginView) {
    if (!views.value.find((v) => v.id === view.id)) {
      views.value.push(view)
    }
  }

  /** 反注册单个视图（显示侧镜像；真源变更见 `pluginAPI.onViewChange`）。返回是否真的删掉了 */
  function unregisterView(id: string): boolean {
    const idx = views.value.findIndex((v) => v.id === id)
    if (idx === -1) return false
    views.value.splice(idx, 1)
    return true
  }

  function registerPlugin(manifest: PluginManifest) {
    if (!plugins.value.find((p) => p.id === manifest.id)) {
      plugins.value.push(manifest)
    }
  }

  function getView(id: string): PluginView | undefined {
    return views.value.find((v) => v.id === id)
  }

  /** 清空所有已注册的视图（项目切换时使用） */
  function clearViews(): void {
    views.value = []
  }

  /** 清空所有已注册的芽（项目切换时使用） */
  function clearPlugins(): void {
    plugins.value = []
  }

  return {
    plugins,
    views,
    loading,
    registerView,
    unregisterView,
    registerPlugin,
    getView,
    clearViews,
    clearPlugins,
  }
})
