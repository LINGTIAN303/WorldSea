import type { ToolDefinition } from '../bridge-types'
import { createExecutionAdapter } from '../execution'

async function runCommand(command: string, timeout = 15000): Promise<string> {
  const adapter = await createExecutionAdapter()
  if (!adapter.isAvailable()) return JSON.stringify({ ok: false, error: 'CLI 工具当前不可用。Tauri 桌面模式请确认环境正常，Web 模式请启动 worldsmith-server 服务。' })
  try {
    const result = await adapter.executeCommand(command, { timeout })
    return result.stdout
  } catch (err) {
    return JSON.stringify({ ok: false, error: err instanceof Error ? err.message : String(err) })
  }
}

function stripAnsi(text: string): string {
  return text.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '').replace(/\x1b\].*?\x07/g, '')
}

const webSearchCliTool: ToolDefinition = {
  name: 'web_search_cli',
  description: '通过 CLI 执行 DuckDuckGo 搜索，无需 API Key。使用 ddgs（Python 库）或 ddgr 作为后端。适用于无法配置搜索 API Key 时获取互联网信息。',
  parameters: {
    query: { type: 'string', description: '搜索关键词', required: true },
    max_results: { type: 'number', description: '返回结果数量，默认5，最大10' },
    backend: { type: 'string', description: '搜索后端：ddgs（Python，推荐）/ ddgr（独立 CLI），默认自动检测' },
  },
  execute: async (args, _ctx) => {
    const query = String(args.query).replace(/"/g, '\\"')
    const maxResults = Math.min(Number(args.max_results) || 5, 10)
    const backend = String(args.backend || '').toLowerCase()

    let cmd: string
    if (backend === 'ddgr') {
      cmd = `ddgr --num ${maxResults} --json "${query}"`
    } else if (backend === 'ddgs') {
      cmd = `python -c "from ddgs import DDGS; import json; results=DDGS().text('${query.replace(/'/g, "\\'")}', max_results=${maxResults}); print(json.dumps(results, ensure_ascii=False, indent=2))"`
    } else {
      cmd = `python -c "from ddgs import DDGS; import json; results=DDGS().text('${query.replace(/'/g, "\\'")}', max_results=${maxResults}); print(json.dumps(results, ensure_ascii=False, indent=2))" 2>nul || ddgr --num ${maxResults} --json "${query}"`
    }

    const raw = await runCommand(cmd, 20000)
    const output = stripAnsi(raw)

    if (!output || output.trim().length === 0) {
      return JSON.stringify({
        ok: false,
        error: '搜索无输出，可能未安装 ddgs 或 ddgr',
        hint: '安装方式：pip install ddgs 或 pip install ddgr',
        query,
      })
    }

    try {
      const parsed = JSON.parse(output)
      if (Array.isArray(parsed)) {
        const results = parsed.slice(0, maxResults).map((r: any) => ({
          title: r.title || '',
          url: r.href || r.link || '',
          snippet: (r.body || r.description || r.snippet || '').slice(0, 300),
        }))
        return JSON.stringify({ ok: true, query, results, backend: backend || 'auto' })
      }
      if (parsed.results && Array.isArray(parsed.results)) {
        const results = parsed.results.slice(0, maxResults).map((r: any) => ({
          title: r.title || '',
          url: r.url || r.href || '',
          snippet: (r.abstract || r.snippet || r.body || '').slice(0, 300),
        }))
        return JSON.stringify({ ok: true, query, results, backend: backend || 'auto' })
      }
      return JSON.stringify({ ok: true, query, raw: output.slice(0, 4000), backend: backend || 'auto' })
    } catch {
      const lines = output.split('\n').filter(l => l.trim())
      if (lines.length > 0) {
        return JSON.stringify({ ok: true, query, raw: output.slice(0, 4000), backend: backend || 'auto', parsed: false })
      }
      return JSON.stringify({ ok: false, error: '无法解析搜索结果', query, raw: output.slice(0, 500) })
    }
  },
}

const webFetchCliTool: ToolDefinition = {
  name: 'web_fetch_cli',
  description: '通过 curl 抓取网页内容，无需 API Key。支持 HTML/JSON/纯文本。返回网页原文内容。',
  parameters: {
    url: { type: 'string', description: '要抓取的网页 URL', required: true },
    max_length: { type: 'number', description: '返回内容最大字符数，默认8000' },
    format: { type: 'string', description: '输出格式：raw（原文）/ markdown（尝试转 Markdown），默认 raw' },
  },
  execute: async (args, _ctx) => {
    const url = String(args.url)
    const maxLength = Number(args.max_length) || 8000
    const format = String(args.format || 'raw').toLowerCase()

    if (!url.match(/^https?:\/\//i)) {
      return JSON.stringify({ ok: false, error: 'URL 必须以 http:// 或 https:// 开头', url })
    }

    let cmd: string
    if (format === 'markdown') {
      cmd = `curl -sL --max-time 15 "${url}" | python -c "import sys; from html.parser import HTMLParser; class P(HTMLParser):\\n    def __init__(self):\\n        super().__init__(); self.text=[]; self.skip=False\\n    def handle_starttag(self, tag, attrs):\\n        if tag in ('script','style','nav','footer','header'): self.skip=True\\n    def handle_endtag(self, tag):\\n        if tag in ('script','style','nav','footer','header'): self.skip=False\\n        if tag in ('p','div','h1','h2','h3','h4','h5','h6','li','br'): self.text.append('\\n')\\n    def handle_data(self, data):\\n        if not self.skip: self.text.append(data.strip())\\np=P(); p.feed(sys.stdin.read()); print('\\n'.join(l for l in p.text if l))" 2>nul`
    } else {
      cmd = `curl -sL --max-time 15 "${url}"`
    }

    const raw = await runCommand(cmd, 20000)
    const output = stripAnsi(raw)

    if (!output || output.trim().length === 0) {
      return JSON.stringify({ ok: false, error: '网页内容为空或无法访问', url })
    }

    const trimmed = output.length > maxLength
      ? output.slice(0, maxLength) + '\n\n...[内容已截断]'
      : output

    return JSON.stringify({
      ok: true,
      url,
      content: trimmed,
      length: output.length,
      truncated: output.length > maxLength,
      format,
    })
  },
}

const webQaCliTool: ToolDefinition = {
  name: 'web_qa_cli',
  description: '通过 howdoi 从 Stack Overflow 等社区获取编程答案，无需 API Key。适用于快速查找代码片段、编程问题解决方案。',
  parameters: {
    question: { type: 'string', description: '编程问题，如 "how to read file in python"', required: true },
    num_answers: { type: 'number', description: '返回答案数量，默认1，最大3' },
    language: { type: 'string', description: '编程语言过滤，如 python/javascript/rust' },
  },
  execute: async (args, _ctx) => {
    const question = String(args.question).replace(/"/g, '\\"')
    const numAnswers = Math.min(Number(args.num_answers) || 1, 3)
    const lang = args.language ? ` -l ${String(args.language)}` : ''

    const cmd = `howdoi -n ${numAnswers}${lang} "${question}"`

    const raw = await runCommand(cmd, 20000)
    const output = stripAnsi(raw)

    if (!output || output.trim().length === 0) {
      return JSON.stringify({
        ok: false,
        error: '无答案返回，可能未安装 howdoi',
        hint: '安装方式：pip install howdoi',
        question,
      })
    }

    return JSON.stringify({
      ok: true,
      question,
      answers: output.trim(),
    })
  },
}

const webDnsCliTool: ToolDefinition = {
  name: 'web_dns_cli',
  description: '通过 nslookup/dig 查询 DNS 记录，无需 API Key。用于域名解析、IP 查询。',
  parameters: {
    domain: { type: 'string', description: '要查询的域名', required: true },
    record_type: { type: 'string', description: 'DNS 记录类型：A/AAAA/MX/CNAME/TXT/NS，默认 A' },
  },
  execute: async (args, _ctx) => {
    const domain = String(args.domain).replace(/"/g, '')
    const recordType = String(args.record_type || 'A').toUpperCase()

    const validTypes = ['A', 'AAAA', 'MX', 'CNAME', 'TXT', 'NS', 'ANY']
    if (!validTypes.includes(recordType)) {
      return JSON.stringify({ ok: false, error: `不支持的记录类型: ${recordType}`, validTypes })
    }

    const cmd = `nslookup -type=${recordType} ${domain}`
    const raw = await runCommand(cmd, 10000)
    const output = stripAnsi(raw)

    return JSON.stringify({
      ok: true,
      domain,
      recordType,
      result: output.trim(),
    })
  },
}

const webPingCliTool: ToolDefinition = {
  name: 'web_ping_cli',
  description: '通过 ping 检测网络连通性和延迟，无需 API Key。',
  parameters: {
    host: { type: 'string', description: '目标主机名或 IP 地址', required: true },
    count: { type: 'number', description: 'ping 次数，默认4，最大10' },
  },
  execute: async (args, _ctx) => {
    const host = String(args.host).replace(/[^a-zA-Z0-9.\-:]/g, '')
    const count = Math.min(Number(args.count) || 4, 10)

    if (!host) {
      return JSON.stringify({ ok: false, error: '请提供有效的主机名或 IP 地址' })
    }

    const cmd = `ping -n ${count} ${host}`
    const raw = await runCommand(cmd, 15000)
    const output = stripAnsi(raw)

    return JSON.stringify({
      ok: true,
      host,
      count,
      result: output.trim(),
    })
  },
}

export const webCliTools = [webSearchCliTool, webFetchCliTool, webQaCliTool, webDnsCliTool, webPingCliTool]
