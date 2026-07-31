import type { ToolDefinition } from '../bridge-types'
import type { ToolMeta } from '@worldsmith/agent-core'
import type { IToolContext } from '../toolbus/types'
import { loadApiKey } from '../providers/key-store'
import { persistVideo, getAllVideos, getVideo, getVideosByPathPrefix, urlToBlob } from '../stores/video-persistence'
import { smartFetch } from '../utils/smart-fetch'
import { isTauri } from '../execution'
import { getProviderManifest } from '../providers/provider-registry'

/** 视频生成请求超时（提交任务） */
const VIDEO_SUBMIT_TIMEOUT = 30_000
/** 视频状态轮询超时 */
const VIDEO_POLL_TIMEOUT = 30_000
/** 最大轮询次数 */
const MAX_POLL_ATTEMPTS = 60
/** 轮询间隔 (ms) */
const POLL_INTERVAL = 5_000

/** 视频虚拟存储根目录 */
const VIDEO_DIR = '/videos/generated'

/**
 * 供应商协议配置
 *
 * 每家视频 API 的协议各不相同，这里统一抽象为：
 * - submitPath: 提交任务的 Vite 代理路径
 * - pollPath: 轮询状态的 Vite 代理路径（含 {taskId} 占位符）
 * - extraSubmitHeaders: 提交时额外需要的请求头
 * - buildBody: 根据统一参数构建供应商特定的请求体
 * - extractTaskId: 从提交响应中提取任务 ID
 * - extractStatus: 从轮询响应中提取状态字符串
 * - extractVideoUrl: 从轮询响应中提取视频 URL
 */
interface ProviderProtocol {
  submitPath: string
  pollPath: string
  extraSubmitHeaders?: Record<string, string>
  buildBody: (modelId: string, prompt: string, image: string | undefined, args: Record<string, unknown>) => Record<string, unknown>
  extractTaskId: (json: any) => string | undefined
  extractStatus: (json: any) => string
  extractVideoUrl: (json: any) => string
}

const PROVIDERS: Record<string, ProviderProtocol> = {
  /* ── Agnes AI ─────────────────────────────────────── */
  agnes: {
    submitPath: '/api/agnes/v1/videos',
    pollPath: '/api/agnes/v1/videos/{taskId}',
    buildBody(modelId, prompt, image, args) {
      const body: Record<string, unknown> = { model: modelId, prompt }
      if (image) body.image = image
      if (args.width) body.width = Number(args.width)
      if (args.height) body.height = Number(args.height)
      if (args.num_frames) body.num_frames = Number(args.num_frames)
      if (args.frame_rate) body.frame_rate = Number(args.frame_rate)
      return body
    },
    extractTaskId: (json) => json.id || json.task_id,
    extractStatus: (json) => json.status || '',
    extractVideoUrl: (json) => json.output?.video_url || json.video_url || '',
  },

  /* ── MiniMax (海螺) ───────────────────────────────── */
  minimax: {
    submitPath: '/api/minimax/v1/video_generation',
    pollPath: '/api/minimax/v1/query/video_generation?task_id={taskId}',
    buildBody(modelId, prompt, image) {
      const body: Record<string, unknown> = { model: modelId, prompt }
      if (image) body.first_frame_image = image
      return body
    },
    extractTaskId: (json) => json.task_id,
    extractStatus: (json) => json.status || '',
    extractVideoUrl: (json) => {
      // MiniMax 返回 file_id，需要拼 File API 路径
      const fileId = json.file_id || json.output?.file_id
      if (fileId) return `/api/minimax/v1/files/retrieve?file_id=${fileId}`
      return ''
    },
  },

  /* ── 智谱 (CogVideoX) ─────────────────────────────── */
  zhipu: {
    submitPath: '/api/zhipu/api/paas/v4/videos/generations',
    pollPath: '/api/zhipu/api/paas/v4/videos/generations/{taskId}',
    buildBody(modelId, prompt, image) {
      const body: Record<string, unknown> = { model: modelId, prompt }
      if (image) body.image = image
      return body
    },
    extractTaskId: (json) => json.id || json.task_id,
    extractStatus: (json) => json.task_status || json.status || '',
    extractVideoUrl: (json) => json.video_result?.[0]?.url || json.output?.video_url || '',
  },

  /* ── 阿里 (DashScope / Wan) ──────────────────────── */
  qwen: {
    submitPath: '/api/qwen/video-generation',
    pollPath: '/api/qwen/tasks/{taskId}',
    extraSubmitHeaders: { 'X-DashScope-Async': 'enable' },
    buildBody(modelId, prompt, image, args) {
      const body: Record<string, unknown> = {
        model: modelId,
        input: { prompt },
        parameters: {} as Record<string, unknown>,
      }
      if (image) (body.input as any).image_url = image
      if (args.width || args.height) {
        const params = body.parameters as Record<string, unknown>
        if (args.width) params.width = Number(args.width)
        if (args.height) params.height = Number(args.height)
      }
      return body
    },
    extractTaskId: (json) => json.output?.task_id || json.task_id,
    extractStatus: (json) => json.output?.task_status || json.status || '',
    extractVideoUrl: (json) => json.output?.video_url || json.output?.results?.[0]?.url || '',
  },

  /* ── 字节 (Seedance / 火山引擎) ───────────────────── */
  bytedance: {
    submitPath: '/api/bytedance/v1/video/generation',
    pollPath: '/api/bytedance/v1/video/generation/{taskId}',
    buildBody(modelId, prompt, image, args) {
      // Seedance 通过 prompt 末尾追加命令控制参数
      let finalPrompt = prompt
      if (args.width || args.height) {
        const w = args.width || 1280
        const h = args.height || 720
        finalPrompt += ` --rs ${w}x${h}`
      }
      const body: Record<string, unknown> = { model: modelId, content: [{ type: 'text', text: finalPrompt }] }
      if (image) body.content = [{ type: 'image_url', image_url: { url: image } }, { type: 'text', text: finalPrompt }]
      return body
    },
    extractTaskId: (json) => json.id || json.task_id,
    extractStatus: (json) => json.status || json.state || '',
    extractVideoUrl: (json) => json.output?.video_url || json.result?.video_url || '',
  },

  /* ── 快手 (Kling) ─────────────────────────────────── */
  kling: {
    submitPath: '/api/kling/v1/videos',
    pollPath: '/api/kling/v1/videos/{taskId}',
    buildBody(modelId, prompt, image, args) {
      const body: Record<string, unknown> = { model: modelId, prompt }
      if (image) body.image = image
      // Kling duration 是字符串 "5" 或 "10"
      if (args.duration) body.duration = String(args.duration)
      return body
    },
    extractTaskId: (json) => json.data?.task_id || json.task_id,
    extractStatus: (json) => json.data?.task_status || json.status || '',
    extractVideoUrl: (json) => json.data?.task_result?.videos?.[0]?.url || json.output?.video_url || '',
  },
}

const VIDEO_GEN_PROVIDER_KEY = 'worldsmith_video_gen_provider'
const VIDEO_GEN_MODEL_KEY = 'worldsmith_video_gen_model'

function getOrigin(): string {
  return typeof window !== 'undefined' ? window.location.origin : 'http://localhost:5173'
}

function getVideoGenConfig(): { provider: string; modelId: string } | null {
  const provider = localStorage.getItem(VIDEO_GEN_PROVIDER_KEY) || ''
  const modelId = localStorage.getItem(VIDEO_GEN_MODEL_KEY) || ''
  if (provider && modelId) return { provider, modelId }
  return null
}

/** 自动复用供应商已配置的 API Key */
async function getVideoGenApiKey(provider: string): Promise<string> {
  const key = await loadApiKey(provider)
  return key || ''
}

function buildVideoPath(blockId: string, caption?: string): string {
  const date = new Date()
  const dateDir = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
  const safeName = (caption || 'untitled').replace(/[^a-zA-Z0-9\u4e00-\u9fff_-]/g, '_').slice(0, 40)
  return `${VIDEO_DIR}/${dateDir}/${safeName}-${blockId}.mp4`
}

/**
 * video_generate 工具
 */
const videoGenerateTool: ToolDefinition = {
  name: 'video_generate',
  description: '使用 AI 视频生成模型创建视频。支持文生视频、图生视频。视频生成是异步的：提交任务后返回 task_id，使用 video_status 查询进度和获取结果。',
  parameters: {
    prompt: {
      type: 'string',
      description: '视频生成的文本描述，越详细越好。例如："一只猫在海滩上漫步，夕阳西下，金色暖光，电影质感"',
      required: true,
    },
    image: {
      type: 'string',
      description: '参考图片 URL，用于图生视频模式。留空则为纯文生视频',
      required: false,
    },
    width: {
      type: 'number',
      description: '视频宽度。默认由供应商决定',
      required: false,
    },
    height: {
      type: 'number',
      description: '视频高度。默认由供应商决定',
      required: false,
    },
    num_frames: {
      type: 'number',
      description: '视频帧数（Agnes 专用，需满足 8n+1 且 ≤441）。默认 121',
      required: false,
    },
    frame_rate: {
      type: 'number',
      description: '视频帧率 (1-60)。默认 24',
      required: false,
    },
    duration: {
      type: 'number',
      description: '视频时长（秒）。部分供应商支持（快手等）',
      required: false,
    },
    caption: {
      type: 'string',
      description: '视频说明文字',
      required: false,
    },
  },
  meta: {
    permission: 'safe',
    category: 'vision',
    displayName: '生成视频',
  } satisfies ToolMeta,
  execute: async (args: Record<string, unknown>, ctx: IToolContext): Promise<string> => {
    const prompt = String(args.prompt)
    if (!prompt.trim()) {
      return JSON.stringify({ ok: false, error: 'prompt 不能为空' })
    }

    const config = getVideoGenConfig()
    if (!config) {
      return JSON.stringify({
        ok: false,
        error: '视频生成未配置。请在设置面板中配置视频生成供应商和模型。',
      })
    }

    const apiKey = await getVideoGenApiKey(config.provider)
    if (!apiKey) {
      return JSON.stringify({
        ok: false,
        error: `视频生成供应商 ${config.provider} 未配置 API Key。请在设置面板的"供应商"中配置该供应商的 API Key。`,
      })
    }

    const protocol = PROVIDERS[config.provider]
    if (!protocol) {
      return JSON.stringify({
        ok: false,
        error: `不支持的视频生成供应商: ${config.provider}。当前支持: ${Object.keys(PROVIDERS).join(', ')}`,
      })
    }

    ctx.reportProgress?.(0, 'pending')
    // Tauri 模式：直连供应商 API；Web 模式：走 Vite 代理
    const submitUrl = isTauri()
      ? `${getProviderManifest(config.provider)?.directBaseUrl || ''}${protocol.submitPath.replace(/^\/api\/[^/]+/, '')}`
      : `${getOrigin()}${protocol.submitPath}`
    const image = args.image ? String(args.image) : undefined
    const body = protocol.buildBody(config.modelId, prompt, image, args)

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
      ...protocol.extraSubmitHeaders,
    }

    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), VIDEO_SUBMIT_TIMEOUT)

    try {
      const resp = await smartFetch(submitUrl, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
        signal: controller.signal,
        timeout: 30,
      })

      if (!resp.ok) {
        const errText = await resp.text().catch(() => '')
        return JSON.stringify({
          ok: false,
          error: `视频生成 API 返回 ${resp.status}: ${errText.slice(0, 500)}`,
        })
      }

      const json = await resp.json()
      const taskId = protocol.extractTaskId(json)
      ctx.reportProgress?.(5, 'polling')
      if (!taskId) {
        return JSON.stringify({
          ok: false,
          error: 'API 未返回任务 ID，无法追踪视频生成进度',
          rawResponse: JSON.stringify(json).slice(0, 500),
        })
      }

      const blockId = `vid-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
      const caption = args.caption ? String(args.caption) : undefined
      const sizeStr = `${args.width || '?'}x${args.height || '?'}`
      const videoPath = buildVideoPath(blockId, caption)

      await persistVideo({
        id: blockId,
        path: videoPath,
        prompt,
        model: config.modelId,
        provider: config.provider,
        size: sizeStr,
        createdAt: Date.now(),
        caption,
        taskId: String(taskId),
        taskStatus: 'pending',
      })

      pollVideoResult(blockId, String(taskId), config.provider, apiKey, ctx, caption)
        .catch((err) => { console.error('[video_generate] background poll failed:', err) })

      return JSON.stringify({
        ok: true,
        taskId: String(taskId),
        videoId: blockId,
        status: 'pending',
        message: `视频生成任务已提交（task_id: ${taskId}）。正在后台轮询结果，完成后会自动展示。也可使用 video_status 工具手动查询进度（传入 video_id: ${blockId}）。`,
      })
    } catch (err: any) {
      if (err.name === 'AbortError') {
        return JSON.stringify({ ok: false, error: '视频生成提交超时，请稍后重试。' })
      }
      return JSON.stringify({
        ok: false,
        error: `视频生成提交失败: ${err instanceof Error ? err.message : String(err)}`,
      })
    } finally {
      clearTimeout(timeout)
    }
  },
}

/**
 * 后台轮询视频生成结果
 */
async function pollVideoResult(
  videoId: string,
  taskId: string,
  provider: string,
  apiKey: string,
  ctx: IToolContext,
  caption?: string,
): Promise<void> {
  const protocol = PROVIDERS[provider]
  if (!protocol) return

  const pollUrl = isTauri()
    ? `${getProviderManifest(provider)?.directBaseUrl || ''}${protocol.pollPath.replace('{taskId}', taskId).replace(/^\/api\/[^/]+/, '')}`
    : `${getOrigin()}${protocol.pollPath.replace('{taskId}', taskId)}`
  let consecutivePollErrors = 0

  for (let attempt = 0; attempt < MAX_POLL_ATTEMPTS; attempt++) {
    await new Promise(r => setTimeout(r, POLL_INTERVAL))

    try {
      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), VIDEO_POLL_TIMEOUT)

      const resp = await smartFetch(pollUrl, {
        method: 'GET',
        headers: { 'Authorization': `Bearer ${apiKey}` },
        signal: controller.signal,
        timeout: 30,
      })

      clearTimeout(timeout)
      if (!resp.ok) {
        consecutivePollErrors++
        if (consecutivePollErrors >= 5) {
          ctx.reportProgress?.(-1, 'failed')
          const existing = await getVideo(videoId)
          if (existing) { existing.taskStatus = 'failed'; await persistVideo(existing) }
          return
        }
        continue
      }
      consecutivePollErrors = 0

      const json = await resp.json()
      // 上报轮询进度
      ctx.reportProgress?.(Math.min(95, 5 + attempt * 1.5), 'polling')
      const status = protocol.extractStatus(json).toLowerCase()

      if (status === 'completed' || status === 'success' || status === 'succeeded' || status === 'done') {
        ctx.reportProgress?.(100, 'completed')
        const videoUrl = protocol.extractVideoUrl(json)

        if (!videoUrl) {
          const existing = await getVideo(videoId)
          if (existing) { existing.taskStatus = 'failed'; await persistVideo(existing) }
          return
        }

        ctx.appendBlock?.({
          type: 'video',
          id: videoId,
          src: videoUrl,
          caption,
          collapsible: true,
        })

        const existing = await getVideo(videoId)
        if (existing) {
          existing.taskStatus = 'completed'
          existing.remoteUrl = videoUrl
          await persistVideo(existing)

          urlToBlob(videoUrl).then(async (blob) => {
            const record = await getVideo(videoId)
            if (record) { record.blob = blob; await persistVideo(record) }
          }).catch(() => {})
        }

        return
      }

      if (status.includes('fail') || status.includes('error') || status.includes('cancel') || status === 'timeout' || status === 'expired') {
        ctx.reportProgress?.(-1, 'failed')
        const existing = await getVideo(videoId)
        if (existing) { existing.taskStatus = 'failed'; await persistVideo(existing) }
        return
      }

      // 仍在处理中
      const existing = await getVideo(videoId)
      if (existing) { existing.taskStatus = 'processing'; await persistVideo(existing) }
    } catch {
      // 轮询失败，继续重试
    }
  }

  // 超过最大轮询次数
  ctx.reportProgress?.(-1, 'failed')
  const existing = await getVideo(videoId)
  if (existing) { existing.taskStatus = 'failed'; await persistVideo(existing) }
}

/**
 * video_status 工具
 */
const videoStatusTool: ToolDefinition = {
  name: 'video_status',
  description: '查询视频生成任务的状态和结果。传入 video_generate 返回的 video_id。如果视频已完成，会自动展示。',
  parameters: {
    video_id: {
      type: 'string',
      description: '视频 ID，由 video_generate 返回',
      required: true,
    },
  },
  meta: {
    permission: 'safe',
    category: 'vision',
    displayName: '视频状态',
  } satisfies ToolMeta,
  execute: async (args: Record<string, unknown>, ctx: IToolContext): Promise<string> => {
    const videoId = String(args.video_id).trim()
    if (!videoId) {
      return JSON.stringify({ ok: false, error: '请提供 video_id' })
    }

    const record = await getVideo(videoId)
    if (!record) {
      return JSON.stringify({ ok: false, error: `未找到视频记录: ${videoId}` })
    }

    if (record.taskStatus === 'completed' && record.remoteUrl) {
      ctx.appendBlock?.({
        type: 'video',
        id: record.id,
        src: record.remoteUrl,
        caption: record.caption,
        collapsible: true,
      })
    }

    return JSON.stringify({
      ok: true,
      videoId: record.id,
      taskId: record.taskId,
      status: record.taskStatus || 'unknown',
      path: record.path,
      prompt: record.prompt.slice(0, 100) + (record.prompt.length > 100 ? '...' : ''),
      model: record.model,
      provider: record.provider,
      size: record.size,
      hasBlob: !!record.blob,
      remoteUrl: record.remoteUrl || undefined,
      caption: record.caption,
      createdAt: new Date(record.createdAt).toISOString(),
    })
  },
}

/**
 * video_list 工具
 */
const videoListTool: ToolDefinition = {
  name: 'video_list',
  description: '列出所有已生成的视频。返回视频 ID、路径、提示词、状态等信息。可按路径前缀筛选。',
  parameters: {
    path_prefix: {
      type: 'string',
      description: '按路径前缀筛选，如 "/videos/generated/2026-06-04"。留空则列出所有视频',
      required: false,
    },
    limit: {
      type: 'number',
      description: '最多返回的视频数量，默认 20',
      required: false,
    },
  },
  meta: {
    permission: 'safe',
    category: 'vision',
    displayName: '列出视频',
  } satisfies ToolMeta,
  execute: async (args: Record<string, unknown>, _ctx: IToolContext): Promise<string> => {
    const pathPrefix = String(args.path_prefix || '').trim()
    const limit = Math.max(1, Math.min(100, Number(args.limit) || 20))

    let videos
    if (pathPrefix) {
      videos = await getVideosByPathPrefix(pathPrefix)
    } else {
      videos = await getAllVideos()
    }

    videos.sort((a, b) => b.createdAt - a.createdAt)
    const total = videos.length
    videos = videos.slice(0, limit)

    return JSON.stringify({
      ok: true,
      total,
      showing: videos.length,
      directory: VIDEO_DIR,
      videos: videos.map(v => ({
        id: v.id,
        path: v.path,
        prompt: v.prompt.slice(0, 100) + (v.prompt.length > 100 ? '...' : ''),
        model: v.model,
        provider: v.provider,
        size: v.size,
        status: v.taskStatus || 'unknown',
        createdAt: new Date(v.createdAt).toISOString(),
        caption: v.caption,
      })),
      hint: '使用 video_status 工具并传入视频 ID 可查询详情，使用 video_show 重新展示已完成的视频。',
    })
  },
}

/**
 * video_show 工具
 */
const videoShowTool: ToolDefinition = {
  name: 'video_show',
  description: '重新展示已存储的视频。当用户要求查看之前生成的视频时使用此工具。通过 video_list 获取视频 ID。',
  parameters: {
    video_id: {
      type: 'string',
      description: '要展示的视频 ID，从 video_list 获取',
      required: true,
    },
  },
  meta: {
    permission: 'safe',
    category: 'vision',
    displayName: '展示视频',
  } satisfies ToolMeta,
  execute: async (args: Record<string, unknown>, ctx: IToolContext): Promise<string> => {
    const videoId = String(args.video_id).trim()
    if (!videoId) {
      return JSON.stringify({ ok: false, error: '请提供视频 ID' })
    }

    const record = await getVideo(videoId)
    if (!record) {
      return JSON.stringify({ ok: false, error: `未找到视频: ${videoId}。请使用 video_list 查看可用视频。` })
    }

    const src = record.remoteUrl || (record.blob ? URL.createObjectURL(record.blob) : '')
    if (!src) {
      return JSON.stringify({ ok: false, error: `视频 ${videoId} 尚未下载完成或无可用 URL` })
    }

    ctx.appendBlock?.({
      type: 'video',
      id: record.id,
      src,
      caption: record.caption,
      collapsible: true,
    })

    return JSON.stringify({
      ok: true,
      id: record.id,
      path: record.path,
      prompt: record.prompt,
      model: record.model,
      size: record.size,
      status: record.taskStatus,
      createdAt: new Date(record.createdAt).toISOString(),
      caption: record.caption,
      message: `视频已重新展示。路径: ${record.path}`,
    })
  },
}

/**
 * video_gen_config 工具
 */
const videoGenConfigTool: ToolDefinition = {
  name: 'video_gen_config',
  description: '查看当前视频生成配置信息。当需要确认视频生成是否已配置时使用此工具。',
  parameters: {},
  meta: {
    permission: 'safe',
    category: 'vision',
    displayName: '视频生成配置',
  } satisfies ToolMeta,
  execute: async (_args: Record<string, unknown>, _ctx: IToolContext): Promise<string> => {
    const config = getVideoGenConfig()
    if (!config) {
      return JSON.stringify({
        ok: true,
        configured: false,
        directory: VIDEO_DIR,
        supportedProviders: Object.keys(PROVIDERS),
        hint: '视频生成未配置。请在设置面板中配置视频生成供应商和模型。',
      })
    }

    const hasKey = !!(await getVideoGenApiKey(config.provider))

    return JSON.stringify({
      ok: true,
      configured: true,
      provider: config.provider,
      modelId: config.modelId,
      hasApiKey: hasKey,
      directory: VIDEO_DIR,
      hint: `生成的视频存储在 ${VIDEO_DIR} 目录下。使用 video_list 查看所有视频，使用 video_show 重新展示。`,
    })
  },
}

export const videoGenTools = [videoGenerateTool, videoStatusTool, videoListTool, videoShowTool, videoGenConfigTool]
