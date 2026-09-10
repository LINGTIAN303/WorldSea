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
    registerPlugin,
    getView,
    clearViews,
    clearPlugins,
  }
})
