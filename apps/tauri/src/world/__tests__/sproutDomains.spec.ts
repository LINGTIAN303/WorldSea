/**
 * R1/R2 语义域静态守卫（2026-10-20）。
 *
 * 真实插件图含 mind-elixir 等重依赖，直接 import 全部 index.ts 在 vitest 下过慢；
 * 本 spec 只读源码 + TypeScript AST，校验 manifest 的 domain / secondaryDomains。
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'
import { SPROUT_DOMAINS, isSproutDomain } from '@worldsea/entity-core'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const PLUGINS_DIR = path.resolve(HERE, '../plugins')

interface ParsedManifest {
  id: string
  domain?: string
  secondaryDomains?: string[]
  entityTypes?: string[]
  file: string
}

function unwrap(node: ts.Node | undefined): ts.Node | undefined {
  while (node && (ts.isAsExpression(node) || ts.isSatisfiesExpression(node) || ts.isParenthesizedExpression(node))) {
    node = node.expression
  }
  return node
}

function prop(obj: ts.ObjectLiteralExpression, name: string): ts.PropertyAssignment | undefined {
  for (const item of obj.properties) {
    if (ts.isPropertyAssignment(item) && item.name.getText() === name) return item
  }
  return undefined
}

function stringValue(node: ts.Node | undefined): string | undefined {
  const value = unwrap(node)
  if (value && (ts.isStringLiteral(value) || ts.isNoSubstitutionTemplateLiteral(value))) return value.text
  return undefined
}

function stringArray(node: ts.Node | undefined): string[] | undefined {
  const value = unwrap(node)
  if (!value || !ts.isArrayLiteralExpression(value)) return undefined
  const result: string[] = []
  for (const element of value.elements) {
    const text = stringValue(element)
    if (text === undefined) return undefined
    result.push(text)
  }
  return result
}

function manifestObjects(file: string): ParsedManifest[] {
  const source = fs.readFileSync(file, 'utf8')
  const sf = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
  const found: ParsedManifest[] = []
  const visit = (node: ts.Node) => {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name)) {
      const name = node.name.text
      if (name === 'manifest' || name.endsWith('_MANIFEST')) {
        const init = unwrap(node.initializer)
        if (init && ts.isObjectLiteralExpression(init)) {
          const id = stringValue(prop(init, 'id')?.initializer)
          const kind = stringValue(prop(init, 'kind')?.initializer)
          if (!id || !id.startsWith('official.') || kind === 'utility') return
          const domain = stringValue(prop(init, 'domain')?.initializer)
          const secondaryNode = prop(init, 'secondaryDomains')?.initializer
          const secondaryDomains = secondaryNode ? stringArray(secondaryNode) : undefined
          if (secondaryNode && !secondaryDomains) {
            throw new Error(`${id} 的 secondaryDomains 不是字符串数组（${file}）`)
          }
          const typesNode = prop(init, 'entityTypes')?.initializer
          const entityTypes = typesNode ? stringArray(typesNode) : undefined
          if (typesNode && !entityTypes) {
            throw new Error(`${id} 的 entityTypes 不是字符串数组（${file}）`)
          }
          found.push({ id, domain, secondaryDomains, entityTypes, file })
        }
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(sf)
  return found
}

function allManifests(): ParsedManifest[] {
  const result: ParsedManifest[] = []
  for (const entry of fs.readdirSync(PLUGINS_DIR, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name === '__tests__') continue
    for (const file of ['index.ts', 'manifest.ts']) {
      const full = path.join(PLUGINS_DIR, entry.name, file)
      if (fs.existsSync(full)) result.push(...manifestObjects(full))
    }
  }
  return result
}

const manifests = allManifests()

describe('R1/R2 芽语义域', () => {
  it('域注册表 8 项、id 唯一、标签与问题非空', () => {
    expect(SPROUT_DOMAINS).toHaveLength(8)
    expect(new Set(SPROUT_DOMAINS.map(domain => domain.id)).size).toBe(8)
    for (const domain of SPROUT_DOMAINS) {
      expect(domain.label.trim()).not.toBe('')
      expect(domain.icon.trim()).not.toBe('')
      expect(domain.question.trim()).not.toBe('')
    }
  })

  it('27 个内置芽均声明主域，且主域已登记', () => {
    expect(manifests).toHaveLength(27)
    expect(new Set(manifests.map(manifest => manifest.id)).size).toBe(27)
    for (const manifest of manifests) {
      expect(manifest.domain, `${manifest.id} 缺 domain（${manifest.file}）`).toBeTruthy()
      expect(isSproutDomain(manifest.domain!), `${manifest.id} 的 domain=${manifest.domain} 未登记`).toBe(true)
    }
  })

  it('副域合法、不重复、不等于主域；16 个芽有副域', () => {
    const withSecondary = manifests.filter(manifest => manifest.secondaryDomains?.length)
    expect(withSecondary).toHaveLength(16)
    for (const manifest of withSecondary) {
      const secondary = manifest.secondaryDomains!
      expect(new Set(secondary).size, `${manifest.id} 副域重复`).toBe(secondary.length)
      for (const domain of secondary) {
        expect(isSproutDomain(domain), `${manifest.id} 的副域 ${domain} 未登记`).toBe(true)
        expect(domain).not.toBe(manifest.domain)
      }
    }
  })

  it('8 个域各至少 1 个芽；分布为 2/3/4/3/3/1/4/7', () => {
    const counts = Object.fromEntries(SPROUT_DOMAINS.map(domain => [domain.id, 0]))
    for (const manifest of manifests) counts[manifest.domain!] += 1
    expect(counts).toEqual({
      geo: 2,
      life: 3,
      society: 4,
      knowledge: 3,
      goods: 3,
      time: 1,
      narrative: 4,
      tool: 7,
    })
  })

  it('字段矩阵芽归 tool 域', () => {
    expect(manifests.find(manifest => manifest.id === 'official.field-matrix')?.domain).toBe('tool')
  })
})

/** 从插件目录的 index.ts 里提取 apply 中实际注册的实体类型（registerEntityV2 / registerEntityType）。 */
function registeredEntityTypes(file: string): string[] {
  const indexFile = path.join(path.dirname(file), 'index.ts')
  const sf = ts.createSourceFile(
    indexFile,
    fs.readFileSync(indexFile, 'utf8'),
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  )
  const types: string[] = []
  const visit = (node: ts.Node) => {
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
      const method = node.expression.name.text
      if (method === 'registerEntityV2' || method === 'registerEntityType') {
        const arg = unwrap(node.arguments[0])
        if (arg && ts.isObjectLiteralExpression(arg)) {
          const key = method === 'registerEntityV2' ? 'type' : 'typeKey'
          const value = stringValue(prop(arg, key)?.initializer)
          if (value) types.push(value)
        }
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(sf)
  return types
}

describe('R5 芽实体类型声明', () => {
  it('27 个内置芽声明 entityTypes，且与实际 registerEntityV2 一致', () => {
    expect(manifests).toHaveLength(27)
    const owners = new Map<string, string>()
    for (const manifest of manifests) {
      expect(manifest.entityTypes, `${manifest.id} 缺 entityTypes（${manifest.file}）`).toBeDefined()
      const actual = registeredEntityTypes(manifest.file)
      expect(
        [...new Set(manifest.entityTypes!)].sort(),
        `${manifest.id} entityTypes 与注册不一致`,
      ).toEqual([...new Set(actual)].sort())
      for (const type of manifest.entityTypes!) {
        expect(
          owners.has(type),
          `实体类型 ${type} 被 ${owners.get(type)} 与 ${manifest.id} 重复声明`,
        ).toBe(false)
        owners.set(type, manifest.id)
      }
    }
    const pureView = manifests
      .filter(manifest => manifest.entityTypes?.length === 0)
      .map(manifest => manifest.id)
      .sort()
    expect(pureView).toEqual([
      'official.apparel',
      'official.custom',
      'official.field-matrix',
      'official.graph',
      'official.mindmap',
      'official.weapons',
    ])
  })
})
