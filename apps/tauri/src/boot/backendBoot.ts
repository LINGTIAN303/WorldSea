/**
 * 后端运行时装配（可等待、幂等）。
 * 详细 why 见 docs/details/注释/tauri/boot/启动链.md
 */
import * as coreBackend from '@/core/coreBackend'
import { registerValidationApi } from '@worldsea/entity-core'
import { registerBackend } from '@worldsea/canvas-engine/core'
import { injectAllKeyframes } from '@worldsea/motion-kit'
import { installAutoLinkWiring } from '@/shell/autoLinkWiring'

let backendBootPromise: Promise<void> | null = null

async function runBackendBoot(): Promise<void> {
  // AutoLink ② 批装配（策略注册 / 设置桥 / 确认桥 / 撤销上限）
  installAutoLinkWiring()

  registerBackend({
    getBackendType: coreBackend.getBackendType,
    algoDijkstraPath: coreBackend.algoDijkstraPath,
  })

  registerValidationApi({
    validateEntity: coreBackend.validateEntity,
    checkReferences: coreBackend.checkReferences,
    getBackendType: coreBackend.getBackendType,
  })

  injectAllKeyframes()
}

/** 启动后端装配；重复调用复用同一 Promise，App 启动链与入口可同时等待 */
export function startBackendBoot(): Promise<void> {
  if (!backendBootPromise) backendBootPromise = runBackendBoot()
  return backendBootPromise
}
