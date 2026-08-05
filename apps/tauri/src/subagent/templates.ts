/**
 * # 子 Agent 预设规格模板
 *
 * 提供常用子 Agent 的一键配置模板，用户在「子 Agent」管理页通过模板菜单
 * 快速预填表单（ID / 名称 / 描述 / 系统提示词 / 白名单 / 最大迭代），
 * 再按需微调后保存。
 *
 * 模板只做**前端预填**，不写死在后端——保持后端零默认规格、纯由用户
 * 注册（决策点 11）。tools_whitelist 为 `undefined` 表示"继承全部工具"，
 * stay consistent with SubAgentView 的 textToWhitelist 语义（空 = 不设白名单）。
 */
import type { SubAgentSpec } from './composables/useSubagentRust'

/** 预设模板：id 作为子 Agent 唯一标识，填入表单时作为默认 id（可改） */
export interface SubAgentTemplate {
  /** 模板展示名 */
  label: string
  /** 模板说明（鼠标悬浮提示） */
  hint: string
  /** 填入表单的规格（id 非必填时可用 key 兜底） */
  spec: SubAgentSpec
}

/**
 * 全部预设模板。新增模板只需在此追加一项，UI 自动渲染进模板菜单。
 * system_prompt 均以中文编写，符合子 Agent 复用主 Agent LLM 配置的场景。
 */
export const subagentTemplates: SubAgentTemplate[] = [
  {
    label: '代码助手',
    hint: '精通 Rust / TypeScript 代码编写与重构',
    spec: {
      id: 'coder',
      name: '代码助手',
      description: '精通 Rust / TypeScript 代码编写，处理算法、函数实现、重构任务',
      system_prompt:
        '你是一个严谨的代码工程师。请直接给出简洁、正确的代码实现，关键行附中文注释，不做多余解释。',
      max_iterations: 5,
    },
  },
  {
    label: '写作助手',
    hint: '撰写、润色、总结中文文档与文案',
    spec: {
      id: 'writer',
      name: '写作助手',
      description: '擅长中文写作：撰写、润色、总结文章 / 报告 / 文案，注重结构与表达',
      system_prompt:
        '你是一个专业的中文写作者。先梳理结构，再分点输出；语言简洁、通顺、有感染力，避免空话套话。',
      max_iterations: 4,
    },
  },
  {
    label: '数据分析助手',
    hint: '清洗、分析数据并输出结论',
    spec: {
      id: 'analyst',
      name: '数据分析助手',
      description: '擅长数据清洗、统计分析与结论提炼，输出可执行的洞察与建议',
      system_prompt:
        '你是一个严谨的数据分析师。先明确数据口径，再选用合适方法分析，最后给出简洁结论与可执行建议；不确定时明确说明假设。',
      max_iterations: 6,
    },
  },
  {
    label: '终端沙箱',
    hint: '受限终端执行：仅可调用 execute_command',
    spec: {
      id: 'sandbox',
      name: '终端沙箱',
      description: '在受限终端中执行命令并返回结果，仅开放 execute_command 等终端工具',
      system_prompt:
        '你是一个终端执行助手。请使用 execute_command 执行用户要求的命令，返回命令输出与关键结论；命令失败时说明原因。',
      tools_whitelist: [
        'execute_command',
        'detect_shells',
        'shell_session_create',
        'shell_session_exec',
        'shell_session_input',
        'shell_session_destroy',
        'shell_session_list',
      ],
      max_iterations: 5,
    },
  },
]