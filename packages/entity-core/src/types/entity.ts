import type {
  FieldTypeSchema as CoreFieldTypeSchema,
  EntityTypeSchema as CoreEntityTypeSchema,
  ViewDeclaration,
  ValidationRule,
} from '@worldsea/core-api-types'
import type { RelationTypeSchema } from './relation'

/** 字段 schema：复用契约 FieldTypeSchema（fieldType/options 对象数组），扩展运行时 relationType */
export interface FieldSchema extends CoreFieldTypeSchema {
  /** 实体引用字段关联的关系类型（运行时扩展，契约层无） */
  relationType?: string
}

/**
 * 实体类型 schema：主键与契约层对齐（typeKey），核心字段复用契约，运行时扩展可选。
 * 契约层必填的 relations/validations/views/iconMap/idPrefix 在此放宽为可选，
 * 供前端模块注册轻量构造；与后端互通时由 SchemaRenderer 桥接补默认值。
 */
export interface EntityTypeSchema
  extends Omit<CoreEntityTypeSchema, 'fields' | 'icon' | 'relations' | 'validations' | 'views' | 'iconMap' | 'idPrefix'> {
  icon?: string
  fields: FieldSchema[]
  /** 用户自定义字段（运行时扩展，契约层无） */
  customFields?: FieldSchema[]
  relations?: RelationTypeSchema[]
  validations?: ValidationRule[]
  views?: ViewDeclaration[]
  iconMap?: Record<string, string>
  idPrefix?: string
}

/** 形象图类别（2026-10-25 形象图批计划 §三）：上传时按扩展名判定，UI 可改判 */
export type PortraitKind = 'static' | 'animated' | 'lottie' | 'model'

/** 模型动作触发配置（D2）：值=动作名或 'random'（随机播自带动作） */
export interface ModelActionConfig {
  hover?: string | 'random'
  click?: string | 'random'
}

/** 运动区域（D3/D4）：百分比坐标（x/y/w/h ∈ 0-100，相对图面 contain 后的显示区） */
export interface MotionRegion {
  id: string
  x: number
  y: number
  w: number
  h: number
}

/** 关键帧（E 批多关键帧）：t 相对轨迹起点（秒），缺省属性=0/1（与单段语义一致） */
export interface MotionKeyframe {
  t: number
  dx?: number
  dy?: number
  rotate?: number
  scale?: number
}

/** 轨迹缓动（F2；缺省 linear）——映射 WAAPI 关键帧级 easing，作用于每段区间 */
export type MotionEasing = 'linear' | 'ease-in' | 'ease-out' | 'ease-in-out'

/** 区域运动轨迹（D3 单段参数 + E 批多关键帧；keyframes 存在时优先生效，单段字段忽略） */
export interface MotionTrack {
  id: string
  regionId: string
  /** 什么时候动（需求 #8/#20）：loop=自动循环 / hover=悬停触发 / click=点击触发 /
   *  mouse=内容追踪鼠标（#20：区域内容朝指针方向偏移，dx/dy 语义变为跟随幅度上限；不参与时间轴） */
  trigger: 'loop' | 'hover' | 'click' | 'mouse'
  /** 单段时长（秒；mouse 驱动无效） */
  duration: number
  /** 循环播放（false=单次；mouse 驱动无效） */
  loop: boolean
  /** 往返（去程+回程各 duration 秒；false=去程后跳回） */
  alternate?: boolean
  /** 缓动（轨迹级，作用于每段区间；缺省 linear） */
  easing?: MotionEasing
  /** 向哪动/动多少：位移取区域自身尺寸的百分比，rotate 度，scale 倍；
   *  trigger=mouse 时 dx/dy=朝指针的最大跟随偏移（区域尺寸百分比） */
  dx?: number
  dy?: number
  rotate?: number
  scale?: number
  /** 多关键帧（E 批）：按 t 升序；首帧 t=0 恒等自动补；无此数组走单段字段 */
  keyframes?: MotionKeyframe[]
}

/** 区域运动编排（D3 机制 + D4 画布编辑；静态/动态图共用，模型走动作配置不参与） */
export interface MotionConfig {
  regions: MotionRegion[]
  tracks: MotionTrack[]
}

/** 形象图元数据（渐进填充：focus 随 A 批，model 动作配置随 D2，motion 编排随 D3/D4） */
export interface EntityPortraitMeta {
  /** 形象作封面/预览时的焦点（语义同 coverPosition/coverZoom） */
  focus?: { position?: string; zoom?: number }
  /** 建模类：悬停/点击播放的动作绑定（缺省 random） */
  model?: ModelActionConfig
  /** 静态/动态类：区域运动编排 */
  motion?: MotionConfig
}

/** 卡片封面源（互斥枚举；勾选形象/视频作封面即写此字段，默认 image） */
export type CoverSource = 'image' | 'portrait' | 'video'

export interface Entity {
  id: string
  type: string
  name: string
  description: string
  properties: Record<string, unknown>
  tags: string[]
  avatar?: string
  coverImage?: string
  coverPosition?: string
  coverZoom?: number
  /** 形象图（asset URL，磁盘链路；悬停预览/追踪/可作封面） */
  portrait?: string
  portraitKind?: PortraitKind
  portraitMeta?: EntityPortraitMeta
  /** 视频 Tab 资产（C 批启用，类型先行） */
  videoAsset?: string
  coverSource?: CoverSource
  /** Facet 数据块，key 为 facet ID，value 为 facet 字段数据 */
  facets?: Record<string, Record<string, unknown>>
  createdAt: string
  updatedAt: string
}
