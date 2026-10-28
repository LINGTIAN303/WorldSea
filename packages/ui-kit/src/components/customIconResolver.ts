/** 自定义图标解析位：ui-kit 不依赖项目 store，由应用启动时注册 id → 运行时 URL。 */

export interface CustomIconRender {
  /** `convertFileSrc` 产物或兼容的图片 URL。 */
  src: string
}

type CustomIconResolver = (id: string) => CustomIconRender | null

const PREFIX = 'custom:'

let resolver: CustomIconResolver | null = null

export function registerCustomIconResolver(next: CustomIconResolver | null): void {
  resolver = next
}

export function resolveCustomIcon(name: string): CustomIconRender | null {
  if (typeof name !== 'string' || !name.startsWith(PREFIX) || name.length === PREFIX.length) return null
  return resolver?.(name.slice(PREFIX.length)) ?? null
}

export function hasCustomIcon(name: string): boolean {
  return resolveCustomIcon(name) !== null
}
