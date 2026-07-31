import * as fs from 'fs'
import * as path from 'path'

export function readJson<T>(dataPath: string, key: string, fallback: T): T {
  const filePath = path.join(dataPath, `${key}.json`)
  try {
    if (!fs.existsSync(filePath)) return fallback
    const raw = fs.readFileSync(filePath, 'utf-8')
    return JSON.parse(raw) as T
  } catch {
    return fallback
  }
}

export function writeJson<T>(dataPath: string, key: string, data: T): void {
  if (!fs.existsSync(dataPath)) {
    fs.mkdirSync(dataPath, { recursive: true })
  }
  const filePath = path.join(dataPath, `${key}.json`)
  const dir = path.dirname(filePath)
  if (dir !== dataPath && !fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true })
  }
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8')
}
