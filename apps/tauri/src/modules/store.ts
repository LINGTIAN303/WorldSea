/**
 * modules/store.ts — 模块存储（Web 端迁移版）
 *
 * P3-W2 从根 src/modules/store.ts 迁移。实现不变：
 * 通过 ProjectManager 获取当前项目级 modules 表（切换项目后自动指向新库），
 * 项目系统未初始化时回退到旧的全局数据库。
 */

import { getProjectManager, db as legacyDb } from '@worldsmith/entity-core/core'
import type { ModuleInstance } from './types'

/**
 * 获取当前项目的 modules 表。
 * 每次调用动态获取，确保切换项目后操作正确的数据库。
 */
function getModulesTable() {
  try {
    return getProjectManager().getCurrentProjectDb().modules
  } catch {
    // 项目系统未初始化时回退到旧的全局数据库
    return legacyDb.modules
  }
}

async function getAll(): Promise<ModuleInstance[]> {
  return getModulesTable().toArray() as unknown as Promise<ModuleInstance[]>
}

async function get(id: string): Promise<ModuleInstance | undefined> {
  return getModulesTable().get(id) as unknown as Promise<ModuleInstance | undefined>
}

async function getActive(): Promise<ModuleInstance[]> {
  return getModulesTable().where('active').equals(1).toArray() as unknown as Promise<ModuleInstance[]>
}

async function install(instance: ModuleInstance): Promise<void> {
  await getModulesTable().put(instance)
}

async function uninstall(id: string): Promise<void> {
  await getModulesTable().delete(id)
}

async function setActive(id: string, active: boolean): Promise<void> {
  await getModulesTable().update(id, { active })
}

async function exists(id: string): Promise<boolean> {
  const m = await getModulesTable().get(id)
  return m !== undefined
}

async function clear(): Promise<void> {
  await getModulesTable().clear()
}

async function migrateFromLocalStorage() {
  try {
    const raw = localStorage.getItem('worldsmith_custom_modules')
    if (!raw) return { migrated: 0 }
    const oldModules = JSON.parse(raw)
    if (!Array.isArray(oldModules)) return { migrated: 0 }

    let count = 0
    for (const mod of oldModules) {
      const id = 'custom.' + mod.id
      if (!(await exists(id))) {
        await install({
          id: id,
          manifest: {
            id: id,
            name: mod.name || 'Unnamed',
            version: '1.0.0',
            icon: mod.icon || '🧩',
            description: mod.description || '',
            dependencies: [],
            entityTypes: (mod.entityTypes || []).map((et: any) => ({
              ...et,
              name: 'custom.' + mod.id + '.' + et.name,
            })),
            relationTypes: (mod.relationTypes || []).map((rt: any) => ({
              ...rt,
              name: 'custom.' + mod.id + '.' + rt.name,
              sourceTypes: (rt.sourceTypes || []).map((t: string) => 'custom.' + mod.id + '.' + t),
              targetTypes: (rt.targetTypes || []).map((t: string) => 'custom.' + mod.id + '.' + t),
            })),
            views: (mod.views || []).map((v: any) => ({
              ...v,
              id: 'custom.' + mod.id + '.' + v.id,
            })),
            createdAt: mod.createdAt || new Date().toISOString(),
            updatedAt: mod.updatedAt || new Date().toISOString(),
          },
          installedAt: new Date().toISOString(),
          source: 'local',
          active: true,
        })
        count++
      }
    }
    return { migrated: count }
  } catch (e) {
    return { migrated: 0, error: String(e) }
  }
}

export const moduleStore = { getAll, get, getActive, install, uninstall, setActive, exists, clear, migrateFromLocalStorage }
