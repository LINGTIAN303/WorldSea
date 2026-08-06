/** 轻量公式引擎（四则/比较/逻辑/字段引用/聚合，纯函数无 eval 沙箱安全），详细见 docs/details/注释/packages/entity-core/core/formula.md */

type FieldValues = Record<string, unknown>

/** 分词 */
type Token =
  | { type: 'num'; value: number }
  | { type: 'str'; value: string }
  | { type: 'ident'; value: string }
  | { type: 'field'; value: string }   // {field_name}
  | { type: 'op'; value: string }
  | { type: 'paren'; value: '(' | ')' }
  | { type: 'comma'; value: ',' }
  | { type: 'func'; value: string }    // 函数名
  | { type: 'eof'; value?: undefined }

function tokenize(expr: string): Token[] {
  const tokens: Token[] = []
  let i = 0
  while (i < expr.length) {
    const ch = expr[i]
    if (ch === ' ' || ch === '\t' || ch === '\n') { i++; continue }
    if (ch === '{') {
      const end = expr.indexOf('}', i)
      if (end < 0) throw new Error('未关闭的 {')
      tokens.push({ type: 'field', value: expr.slice(i + 1, end).trim() })
      i = end + 1
      continue
    }
    if ('0123456789.'.includes(ch)) {
      let num = ''
      while (i < expr.length && '0123456789.'.includes(expr[i])) { num += expr[i]; i++ }
      tokens.push({ type: 'num', value: parseFloat(num) })
      continue
    }
    if (ch === '"' || ch === "'") {
      const quote = ch; i++
      let str = ''
      while (i < expr.length && expr[i] !== quote) { str += expr[i]; i++ }
      if (i < expr.length) i++ // skip closing quote
      tokens.push({ type: 'str', value: str })
      continue
    }
    if ('+-*/%&|!='.includes(ch)) {
      let op = ch; i++
      if (i < expr.length && '=&|'.includes(expr[i]) && (ch === expr[i] || (ch === '!' && expr[i] === '=') || (ch === '=' && expr[i] === '=') || (ch === '>' && expr[i] === '=') || (ch === '<' && expr[i] === '='))) {
        op += expr[i]; i++
      }
      tokens.push({ type: 'op', value: op })
      continue
    }
    if (ch === '(' || ch === ')') { tokens.push({ type: 'paren', value: ch }); i++; continue }
    if (ch === ',') { tokens.push({ type: 'comma', value: ',' }); i++; continue }
    // identifier (field name without braces, or function name)
    if (/[a-zA-Z_]/.test(ch)) {
      let id = ''
      while (i < expr.length && /[a-zA-Z0-9_.]/.test(expr[i])) { id += expr[i]; i++ }
      tokens.push({ type: 'ident', value: id })
      continue
    }
    throw new Error(`无法识别的字符: '${ch}'`)
  }
  tokens.push({ type: 'eof' })
  return tokens
}

/** 递归下降解析器 -> 求值 */
class Parser {
  private pos = 0
  private tokens: Token[]
  private fields: FieldValues
  private allEntities?: FieldValues[]

  constructor(tokens: Token[], fields: FieldValues, allEntities?: FieldValues[]) {
    this.tokens = tokens
    this.fields = fields
    this.allEntities = allEntities
  }

  private peek(): Token { return this.tokens[this.pos] || { type: 'eof' } }
  private consume(): Token { return this.tokens[this.pos++] || { type: 'eof' } }

  private expect(type: string, value?: string): Token {
    const t = this.consume()
    if (t.type !== type || (value !== undefined && t.value !== value)) {
      throw new Error(`期望 ${type}(${value ?? '*'})，实际得到 ${t.type}(${t.value})`)
    }
    return t
  }

  private getFieldValue(name: string): unknown {
    if (name in this.fields) return this.fields[name]
    // Try case-insensitive
    const lower = name.toLowerCase()
    for (const [k, v] of Object.entries(this.fields)) {
      if (k.toLowerCase() === lower) return v
    }
    return null
  }

  parse(): unknown { return this.orExpr() }

  private orExpr(): unknown {
    let left = this.andExpr()
    while (this.peek().type === 'op' && this.peek().value === '||') {
      this.consume()
      const right = this.andExpr()
      left = Boolean(left) || Boolean(right)
    }
    return left
  }

  private andExpr(): unknown {
    let left = this.eqExpr()
    while (this.peek().type === 'op' && this.peek().value === '&&') {
      this.consume()
      const right = this.eqExpr()
      left = Boolean(left) && Boolean(right)
    }
    return left
  }

  private eqExpr(): unknown {
    let left = this.compExpr()
    while (this.peek().type === 'op' && ['==', '!=', '===', '!=='].includes(this.peek().value as string)) {
      const op = this.consume().value
      const right = this.compExpr()
      if (op === '==' || op === '===') left = left == right // eslint-disable-line eqeqeq
      else left = left != right
    }
    return left
  }

  private compExpr(): unknown {
    let left = this.addExpr()
    while (this.peek().type === 'op' && ['<', '>', '<=', '>='].includes(this.peek().value as string)) {
      const op = this.consume().value
      const right = this.addExpr()
      const l = Number(left); const r = Number(right)
      if (op === '<') left = l < r
      else if (op === '>') left = l > r
      else if (op === '<=') left = l <= r
      else if (op === '>=') left = l >= r
    }
    return left
  }

  private addExpr(): unknown {
    let left = this.mulExpr()
    while (this.peek().type === 'op' && (this.peek().value === '+' || this.peek().value === '-')) {
      const op = this.consume().value
      const right = this.mulExpr()
      if (op === '+') {
        // String concat if either is string
        if (typeof left === 'string' || typeof right === 'string') {
          left = String(left) + String(right)
        } else {
          left = Number(left) + Number(right)
        }
      } else {
        left = Number(left) - Number(right)
      }
    }
    return left
  }

  private mulExpr(): unknown {
    let left = this.unary()
    while (this.peek().type === 'op' && ['*', '/', '%'].includes(this.peek().value as string)) {
      const op = this.consume().value
      const right = this.unary()
      const l = Number(left); const r = Number(right)
      if (op === '*') left = l * r
      else if (op === '/') left = r !== 0 ? l / r : Infinity
      else left = l % r
    }
    return left
  }

  private unary(): unknown {
    if (this.peek().type === 'op' && this.peek().value === '!') {
      this.consume()
      return !this.primary()
    }
    if (this.peek().type === 'op' && this.peek().value === '-') {
      this.consume()
      return -Number(this.primary())
    }
    return this.primary()
  }

  private primary(): unknown {
    const t = this.peek()
    if (t.type === 'num') { this.consume(); return t.value }
    if (t.type === 'str') { this.consume(); return t.value }
    if (t.type === 'field') { this.consume(); return this.getFieldValue(t.value) }
    if (t.type === 'ident') {
      this.consume()
      // Function call?
      if (this.peek().type === 'paren' && this.peek().value === '(') {
        return this.callFunc(t.value)
      }
      // Field reference by name
      return this.getFieldValue(t.value)
    }
    if (t.type === 'paren' && t.value === '(') {
      this.consume()
      const val = this.orExpr()
      this.expect('paren', ')')
      return val
    }
    throw new Error(`意外的词法单元: ${t.type}(${t.value})`)
  }

  private callFunc(name: string): unknown {
    this.expect('paren', '(')
    const args: unknown[] = []
    if (this.peek().type !== 'paren' || this.peek().value !== ')') {
      args.push(this.orExpr())
      while (this.peek().type === 'comma') {
        this.consume()
        args.push(this.orExpr())
      }
    }
    this.expect('paren', ')')

    const lower = name.toLowerCase()
    if (['sum', 'count', 'avg', 'min', 'max'].includes(lower)) {
      // Aggregate: first arg is field name
      const fieldName = String(args[0] ?? '')
      if (!this.allEntities) return null
      const values = this.allEntities.map(e => Number(e[fieldName] ?? 0)).filter(v => !isNaN(v))
      if (lower === 'sum') return values.reduce((a, b) => a + b, 0)
      if (lower === 'count') return values.length
      if (lower === 'avg') return values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0
      if (lower === 'min') return values.length ? Math.min(...values) : 0
      if (lower === 'max') return values.length ? Math.max(...values) : 0
    }

    if (lower === 'if') {
      const cond = Boolean(args[0])
      return cond ? args[1] : args[2]
    }

    return null
  }
}

/**
 * 计算公式表达式
 * @param expr 公式字符串，如 "{price} * {quantity}"
 * @param fields 当前实体的字段值
 * @param allEntities 可选，同类型所有实体（用于聚合）
 */
export function evaluateFormula(
  expr: string,
  fields: FieldValues,
  allEntities?: FieldValues[],
): unknown {
  try {
    const tokens = tokenize(expr)
    const parser = new Parser(tokens, fields, allEntities)
    return parser.parse()
  } catch (e: any) {
    return `公式错误: ${e.message}`
  }
}

/**
 * 提取公式中引用的所有字段名
 */
export function extractFieldRefs(expr: string): string[] {
  const refs: string[] = []
  try {
    const tokens = tokenize(expr)
    for (const t of tokens) {
      if (t.type === 'field' || t.type === 'ident') {
        if (!['SUM', 'COUNT', 'AVG', 'MIN', 'MAX', 'IF', 'sum', 'count', 'avg', 'min', 'max', 'if'].includes(t.value)) {
          refs.push(t.value)
        }
      }
    }
  } catch { /* ignore parse errors */ }
  return [...new Set(refs)]
}
