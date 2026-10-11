// Vue SFC 模块声明（供 tsc 类型检查识别 .vue 导入）
declare module '*.vue' {
  import type { DefineComponent } from 'vue'
  const component: DefineComponent<Record<string, unknown>, Record<string, unknown>, unknown>
  export default component
}
