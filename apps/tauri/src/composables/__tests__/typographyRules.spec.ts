/**
 * 一键排版规则单测（批1）：纯函数，锁定中文写作向规则的守卫口径——
 * 数字/英文语境不受半角转全角误伤；引号配对按开合交替；省略号/破折号归一。
 */
import { describe, it, expect } from 'vitest'
import { applyTypography } from '../typographyRules'

function run(text: string, quoteStyle: 'off' | 'curly' | 'corner' = 'off') {
  return applyTypography(text, { quoteStyle })
}

describe('半角标点 → 全角（邻字守卫）', () => {
  it('中文语境的半角标点转全角', () => {
    expect(run('你好,世界!').text).toBe('你好，世界！')
    expect(run('他说:好的;再见?').text).toBe('他说：好的；再见？')
  })

  it('数字与小数点不受影响（3.5 / 1,000）', () => {
    expect(run('价格是3.5元，共1,000件').text).toBe('价格是3.5元，共1,000件')
  })

  it('纯英文语境不转（a, b. c!）', () => {
    expect(run('a, b. c!').text).toBe('a, b. c!')
  })

  it('单侧邻中文即转（hi,你好）', () => {
    expect(run('hi,你好').text).toBe('hi，你好')
  })
})

describe('省略号规范化', () => {
  it('三个半角点转……', () => {
    expect(run('等一下...').text).toBe('等一下……')
  })

  it('单个/奇数 … 补齐成对', () => {
    expect(run('这…不对').text).toBe('这……不对')
    expect(run('这……对').text).toBe('这……对')
  })

  it('四点以上归一为两字符', () => {
    expect(run('完了.....').text).toBe('完了……')
  })
})

describe('破折号规范化', () => {
  it('-- 转破折号', () => {
    expect(run('你好--世界').text).toBe('你好——世界')
  })

  it('单个 — 补全为 ——', () => {
    expect(run('好—坏').text).toBe('好——坏')
  })

  it('连字符范围不动（1-2）', () => {
    expect(run('编号1-2').text).toBe('编号1-2')
  })
})

describe('引号统一（配对状态机）', () => {
  it('off 不处理', () => {
    expect(run('他说"你好"，然后离开。', 'off').text).toBe('他说"你好"，然后离开。')
  })

  it('straight 引号按开合交替转弯引号，转出的全角语境带动标点转换', () => {
    const r = run('他说"你好",然后离开。', 'curly')
    expect(r.text).toBe('他说“你好”，然后离开。')
    expect(r.changes).toBe(3) // 两个引号 + 一个逗号
  })

  it('已弯引号重排为直角引号', () => {
    expect(run('“你好”', 'corner').text).toBe('「你好」')
  })

  it('奇数引号（未闭合）按开合顺序处理不崩溃', () => {
    const r = run('他说"你好', 'curly')
    expect(r.text).toBe('他说“你好')
  })
})

describe('段首空白清除', () => {
  it('全角/半角空格与 tab 开头的缩进清除', () => {
    expect(run('　　你好').text).toBe('你好')
    expect(run('  hi').text).toBe('hi')
    expect(run('\t你好').text).toBe('你好')
  })

  it('无段首空白计 0 处', () => {
    expect(run('你好').changes).toBe(0)
  })
})

describe('组合执行', () => {
  it('一次跑完全部规则并累计处数', () => {
    const r = run('　　"等等,"他说,"先看看3.5公里外的战场..."', 'curly')
    expect(r.text).toBe('“等等，”他说，“先看看3.5公里外的战场……”')
  })
})
