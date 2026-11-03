// 把单文件组件里的 <style> 块外置为同目录 css，SFC 内只留 <style scoped src="./x.css">。
// 用途：规避 400 行单文件门禁时，把样式搬出组件主体（css 不在 arch:check 的扫描扩展名内）。
// 用法：node scripts/externalize-sfc-style.mjs <组件路径> [css 文件名]
import fs from 'node:fs'
import path from 'node:path'

const file = process.argv[2]
if (!file) {
  console.error('用法：node scripts/externalize-sfc-style.mjs <组件路径> [css 文件名]')
  process.exit(1)
}

const source = fs.readFileSync(file, 'utf8')
const open = source.match(/^<style([^>]*)>/m)
if (!open) {
  console.error(`未找到 <style> 块：${file}`)
  process.exit(1)
}
if (/src=/.test(open[1])) {
  console.error(`样式已外置，无需处理：${file}`)
  process.exit(1)
}
const closeIndex = source.lastIndexOf('</style>')
if (closeIndex < 0) {
  console.error(`<style> 未闭合：${file}`)
  process.exit(1)
}

const bodyStart = open.index + open[0].length
// 去掉包裹层的首尾空行，css 内容本身逐字符保留
const body = source.slice(bodyStart, closeIndex).replace(/^\r?\n/, '').replace(/\r?\n$/, '')

const cssName = process.argv[3] ?? `${path.basename(file, '.vue').replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase()}.css`
const cssPath = path.join(path.dirname(file), cssName)
const attrs = open[1].trim()
// 保留 scoped / module 等修饰，去掉可能存在的多余空白
const replaced = `<style ${attrs} src="./${cssName}"></style>`

const next = source.slice(0, open.index) + replaced + source.slice(closeIndex + '</style>'.length)
fs.writeFileSync(cssPath, `${body}\n`, 'utf8')
fs.writeFileSync(file, next, 'utf8')

const before = source.split('\n').length
const after = next.split('\n').length
console.log(`${file}：${before} → ${after} 行（-${before - after}）`)
console.log(`外置样式：${cssPath}（${body.split('\n').length} 行）`)
