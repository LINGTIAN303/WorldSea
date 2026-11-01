/**
 * 自绘文件选择器的纯逻辑单测：路径归一/上级/面包屑/过滤/超限/排序/统计。
 * 不含 DOM 与 Tauri，纯函数直测。
 */
import { describe, it, expect } from 'vitest'
import {
  normalizePath,
  isDriveRoot,
  isPosixRoot,
  parentPath,
  joinPath,
  breadcrumbOf,
  baseNameOf,
  canThumbnail,
  extensionOf,
  matchesFilters,
  matchesQuery,
  moveFocusIndex,
  rangeWindow,
  typeLabelOf,
  isVisible,
  overLimitReason,
  formatBytes,
  sortEntries,
  formatModified,
  selectionSummary,
  type FsEntry,
} from '../filePickerModel'

const entry = (name: string, isDir = false, size = 0, modified: string | null = null): FsEntry => ({
  name,
  path: `D:/w/${name}`,
  isDir,
  size,
  modified,
})

describe('路径归一', () => {
  it('反斜杠转正斜杠、折叠重复分隔符、去尾部', () => {
    expect(normalizePath('D:\\a\\\\b\\')).toBe('D:/a/b')
    expect(normalizePath('D:/a/b/')).toBe('D:/a/b')
  })

  it('根路径保留（不把 / 归成空串）', () => {
    expect(normalizePath('/')).toBe('/')
    expect(isPosixRoot('/')).toBe(true)
  })

  it('盘符根识别（带不带斜杠都算）', () => {
    expect(isDriveRoot('C:')).toBe(true)
    expect(isDriveRoot('C:/')).toBe(true)
    expect(isDriveRoot('C:/a')).toBe(false)
  })
})

describe('上级与拼接', () => {
  it('普通路径逐级上溯直到盘符根', () => {
    expect(parentPath('D:/a/b/c')).toBe('D:/a/b')
    expect(parentPath('D:/a')).toBe('D:')
    expect(parentPath('D:')).toBeNull()
  })

  it('POSIX 根不能继续上溯', () => {
    expect(parentPath('/a')).toBe('/')
    expect(parentPath('/')).toBeNull()
  })

  it('joinPath 忽略空段并归一', () => {
    expect(joinPath('D:/w', 'a', '', 'b.txt')).toBe('D:/w/a/b.txt')
    expect(joinPath('D:/w/', '/x/')).toBe('D:/w/x')
  })
})

describe('面包屑', () => {
  it('无根时从盘符展开', () => {
    expect(breadcrumbOf('D:/w/a')).toEqual([
      { label: 'D:', path: 'D:' },
      { label: 'w', path: 'D:/w' },
      { label: 'a', path: 'D:/w/a' },
    ])
  })

  it('有根且在根内时以根为首项', () => {
    expect(breadcrumbOf('D:/w/a/b', 'D:/w')).toEqual([
      { label: 'w', path: 'D:/w' },
      { label: 'a', path: 'D:/w/a' },
      { label: 'b', path: 'D:/w/a/b' },
    ])
  })

  it('路径等于根本身时只有一项', () => {
    expect(breadcrumbOf('D:/w', 'D:/w')).toEqual([{ label: 'w', path: 'D:/w' }])
  })

  it('POSIX 根返回单项', () => {
    expect(breadcrumbOf('/')).toEqual([{ label: '/', path: '/' }])
  })
})

describe('末段与扩展名', () => {
  it('baseNameOf 取末段', () => {
    expect(baseNameOf('D:/a/b.txt')).toBe('b.txt')
    expect(baseNameOf('D:')).toBe('D:')
    expect(baseNameOf('/')).toBe('/')
  })

  it('extensionOf 小写去点，隐藏文件不算扩展', () => {
    expect(extensionOf('a.PNG')).toBe('png')
    expect(extensionOf('.gitignore')).toBe('')
    expect(extensionOf('noext')).toBe('')
  })
})

describe('过滤器', () => {
  it('空过滤器全通过', () => {
    expect(matchesFilters('a.txt')).toBe(true)
    expect(matchesFilters('a.txt', [])).toBe(true)
  })

  it('多组扩展名并集匹配（大小写不敏感）', () => {
    const filters = [
      { name: '图片', extensions: ['png', 'JPG'] },
      { name: '文档', extensions: ['md'] },
    ]
    expect(matchesFilters('a.PNG', filters)).toBe(true)
    expect(matchesFilters('a.jpg', filters)).toBe(true)
    expect(matchesFilters('a.md', filters)).toBe(true)
    expect(matchesFilters('a.exe', filters)).toBe(false)
  })

  it('目录恒可见（保证可导航）', () => {
    const filters = [{ name: '图片', extensions: ['png'] }]
    expect(isVisible(entry('sub', true), filters)).toBe(true)
    expect(isVisible(entry('a.exe'), filters)).toBe(false)
  })
})

describe('搜索词匹配', () => {
  it('空查询与纯空白恒通过', () => {
    expect(matchesQuery('a.png', '')).toBe(true)
    expect(matchesQuery('a.png', '   ')).toBe(true)
  })

  it('大小写不敏感的子串匹配', () => {
    expect(matchesQuery('Chapter-01.MD', 'chapter')).toBe(true)
    expect(matchesQuery('Chapter-01.MD', '01')).toBe(true)
    expect(matchesQuery('a.png', 'zip')).toBe(false)
  })

  it('查询词前后空白被裁掉', () => {
    expect(matchesQuery('a.png', '  png  ')).toBe(true)
  })
})

describe('类型列文案', () => {
  it('目录显示文件夹', () => {
    expect(typeLabelOf(entry('sub', true))).toBe('文件夹')
  })

  it('已知扩展名映射中文类型', () => {
    expect(typeLabelOf(entry('a.md'))).toBe('Markdown 源文件')
    expect(typeLabelOf(entry('a.PNG'))).toBe('PNG 图片')
    expect(typeLabelOf(entry('a.glb'))).toBe('GLB 模型')
  })

  it('未知扩展名回退为大写扩展名 + 文件', () => {
    expect(typeLabelOf(entry('a.xyz'))).toBe('XYZ 文件')
  })

  it('无扩展名显示文件', () => {
    expect(typeLabelOf(entry('README'))).toBe('文件')
  })
})

describe('超限判定', () => {
  it('未设上限或目录不判定', () => {
    expect(overLimitReason(entry('a.png', false, 999999), undefined)).toBeNull()
    expect(overLimitReason(entry('dir', true, 0), 1024)).toBeNull()
  })

  it('超过上限给出人类可读原因', () => {
    expect(overLimitReason(entry('a.png', false, 3 * 1024 * 1024), 1024 * 1024)).toBe('超过 1.0 MB 上限')
    expect(overLimitReason(entry('a.png', false, 1024), 1024)).toBeNull()
  })
})

describe('格式化', () => {
  it('formatBytes 分档', () => {
    expect(formatBytes(512)).toBe('512 B')
    expect(formatBytes(1536)).toBe('1.5 KB')
    expect(formatBytes(20 * 1024 * 1024)).toBe('20 MB')
    expect(formatBytes(-1)).toBe('—')
  })

  it('formatModified 无值给短横线', () => {
    expect(formatModified(null)).toBe('—')
    expect(formatModified('0')).toBe('—')
    expect(formatModified(String(new Date(2026, 9, 31, 8, 5).getTime()))).toBe('2026-10-31 08:05')
  })
})

describe('选中统计与排序', () => {
  it('目录优先，同类按名称本地化排序', () => {
    const sorted = sortEntries([
      entry('b.txt'),
      entry('zdir', true),
      entry('adir', true),
      entry('a.txt'),
    ])
    expect(sorted.map(e => e.name)).toEqual(['adir', 'zdir', 'a.txt', 'b.txt'])
  })

  it('selectionSummary 只统计选中的非目录体积', () => {
    const list = [entry('a.txt', false, 100), entry('b.txt', false, 200), entry('d', true, 0)]
    const summary = selectionSummary(list, new Set(['D:/w/a.txt', 'D:/w/d']))
    expect(summary).toEqual({ count: 2, totalBytes: 100 })
  })

  it('空选中返回零值', () => {
    expect(selectionSummary([entry('a.txt', false, 5)], new Set())).toEqual({ count: 0, totalBytes: 0 })
  })
})

describe('缩略图判定', () => {
  it('可解码的位图出缩略图', () => {
    for (const name of ['a.png', 'a.JPG', 'a.jpeg', 'a.gif', 'a.webp', 'a.bmp']) {
      expect(canThumbnail(entry(name))).toBe(true)
    }
  })

  it('目录、svg、非图片不出缩略图', () => {
    expect(canThumbnail(entry('dir', true))).toBe(false)
    // svg 是矢量，直接当 img 渲染内容风险与体积都不合适
    expect(canThumbnail(entry('icon.svg'))).toBe(false)
    expect(canThumbnail(entry('a.txt'))).toBe(false)
    expect(canThumbnail(entry('noext'))).toBe(false)
  })
})

describe('键盘导航与范围选择', () => {
  it('rangeWindow 正反向都给同一闭区间', () => {
    expect(rangeWindow(10, 2, 5)).toEqual({ lo: 2, hi: 5 })
    expect(rangeWindow(10, 5, 2)).toEqual({ lo: 2, hi: 5 })
  })

  it('rangeWindow 越界时 clamp 到列表边界', () => {
    expect(rangeWindow(3, -5, 99)).toEqual({ lo: 0, hi: 2 })
  })

  it('rangeWindow 空列表返回 null', () => {
    expect(rangeWindow(0, 0, 0)).toBeNull()
  })

  it('rangeWindow 单元素时区间退化', () => {
    expect(rangeWindow(1, 0, 0)).toEqual({ lo: 0, hi: 0 })
  })

  it('moveFocusIndex 夹在边界内', () => {
    expect(moveFocusIndex(0, -1, 5)).toBe(0)
    expect(moveFocusIndex(4, 1, 5)).toBe(4)
    expect(moveFocusIndex(2, 1, 5)).toBe(3)
    expect(moveFocusIndex(2, -2, 5)).toBe(0)
  })

  it('moveFocusIndex 大跨度跳转被 clamp（Home/End 语义）', () => {
    expect(moveFocusIndex(2, -999, 8)).toBe(0)
    expect(moveFocusIndex(2, 999, 8)).toBe(7)
  })

  it('moveFocusIndex 空列表归零不抛错', () => {
    expect(moveFocusIndex(3, 1, 0)).toBe(0)
  })
})
