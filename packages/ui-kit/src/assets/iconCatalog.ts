import { hasLucideIcon } from '../components/lucideMap'
import { hasIcon } from './iconRegistry'

/** 图标语义域：8 个芽域 + 通用。 */
export const ICON_DOMAIN_IDS = [
  'general',
  'geo',
  'life',
  'society',
  'knowledge',
  'goods',
  'time',
  'narrative',
  'tool',
] as const

export type IconDomain = typeof ICON_DOMAIN_IDS[number]

export interface IconCatalogEntry {
  name: string
  label: string
  keywords: string
  domains: IconDomain[]
}

type Row = [name: string, label: string, keywords: string, domains: IconDomain[]]

/**
 * 世界观精选图标库：只收语义相关、可离线使用的图标，不做 Lucide 全集。
 * 行格式 = [WsIcon 名, 中文名, 搜索关键词, 可归属域]。
 */
const ROWS: Row[] = [
  // ── 人物与抽象 ──
  ['user', '用户', '人物 角色 用户 user person', ['general', 'society']],
  ['users', '人群', '多人 群体 用户组 users group', ['general', 'society']],
  ['person', '人物', '人物 个体 person', ['general', 'society']],
  ['profile', '档案', '档案 资料 用户 profile', ['general', 'society']],
  ['character', '角色', '角色 人物 面孔 character face', ['general', 'society', 'life']],
  ['badge', '徽章', '徽章 身份 标记 badge', ['general', 'society']],
  ['crown', '王冠', '王冠 君主 皇室 crown king', ['society', 'goods']],
  ['handshake', '握手', '合作 结盟 握手 handshake ally', ['society', 'general']],
  ['heart', '心', '心 喜爱 情感 heart', ['general', 'life']],
  ['love', '爱', '爱 情感 恋爱 love', ['general', 'life']],
  ['skull', '骷髅', '骷髅 死亡 亡灵 skull death', ['life', 'society']],
  ['dragon', '龙', '龙 巨龙 神兽 dragon', ['life']],
  ['devil', '恶魔', '恶魔 邪魔 devil demon', ['life', 'society']],
  ['combat', '战斗', '战斗 冲突 交锋 combat battle', ['society', 'tool']],
  ['inspiration', '灵感/素材', '灵感 素材 收藏 inspiration idea', ['knowledge', 'narrative']],
  ['hero', '英雄', '英雄 勇者 hero', ['society']],
  ['family-tree', '家谱', '家谱 家族 血缘 family tree', ['society', 'life']],
  ['group', '群体', '群体 团队 组织 group team', ['society']],
  ['people', '人民', '人民 民众 人群 people', ['society']],
  ['organization', '组织', '组织 势力 团体 organization faction', ['society']],
  ['star', '星', '星 收藏 重要 star', ['general']],
  ['star-outline', '星标', '星标 收藏 关注 star', ['general']],
  ['bookmark', '书签', '书签 标记 bookmark', ['general', 'narrative']],
  ['pin', '固定', '固定 钉住 标记 pin', ['general', 'geo']],
  ['tag', '标签', '标签 分类 tag', ['general']],
  ['link', '链接', '链接 关联 link', ['general', 'society']],
  ['share', '分享', '分享 关系 网络 share', ['general', 'society']],
  ['search', '搜索', '搜索 查找 search', ['general']],
  ['filter', '过滤', '过滤 筛选 filter', ['general', 'tool']],
  ['sort', '排序', '排序 sort', ['general', 'tool']],
  ['refresh', '刷新', '刷新 重置 refresh', ['general']],
  ['plus', '添加', '添加 新建 plus', ['general']],
  ['minus', '移除', '移除 减少 minus', ['general']],
  ['check', '对', '完成 确认 对 check', ['general']],
  ['check-circle', '完成', '完成 成功 check success', ['general', 'narrative']],
  ['x-circle', '取消', '取消 失败 叉 x error', ['general', 'narrative']],
  ['alert', '警告', '警告 注意 alert warning', ['general']],
  ['info', '信息', '信息 说明 info', ['general']],
  ['help', '帮助', '帮助 疑问 help question', ['general']],
  ['question', '问题', '问题 疑问 question', ['general']],
  ['lock', '锁', '锁 保密 封印 lock', ['general', 'goods']],
  ['unlock', '解锁', '解锁 开放 unlock', ['general', 'goods']],
  ['key', '钥匙', '钥匙 关键 开启 key', ['general', 'goods']],
  ['eye', '眼睛', '眼睛 观察 可见 eye', ['general', 'knowledge']],
  ['glasses', '眼镜', '眼镜 观察 学者 glasses', ['general', 'knowledge']],
  ['target', '目标', '目标 靶心 战力 target', ['general', 'tool']],
  ['flag', '旗帜', '旗帜 阵营 国家 flag', ['general', 'society']],
  ['flame', '火焰', '火焰 火 燃烧 flame fire', ['general', 'life']],
  ['lightning', '闪电', '闪电 能量 迅捷 lightning zap', ['general', 'knowledge']],
  ['sparkles', '闪光', '闪光 魔法 星点 sparkles', ['general', 'knowledge']],
  ['moon', '月亮', '月亮 夜 月相 moon', ['general', 'time']],
  ['sun', '太阳', '太阳 日 光 sun', ['general', 'time']],
  ['activity', '活动', '活动 动态 波动 activity', ['general']],
  ['chart', '图表', '图表 统计 数据 chart', ['general', 'tool']],
  ['table', '表格', '表格 数据 矩阵 table', ['general', 'tool']],
  ['grid', '网格', '网格 矩阵 字段 grid', ['general', 'tool']],
  ['list', '列表', '列表 清单 list', ['general', 'narrative']],
  ['clipboard-list', '清单', '清单 任务 列表 clipboard', ['general', 'narrative']],
  ['task', '任务', '任务 待办 task', ['general', 'narrative']],
  ['task-plan', '计划', '计划 任务 安排 task plan', ['general', 'narrative']],
  ['archive', '归档', '归档 收纳 archive', ['general']],
  ['trash', '删除', '删除 垃圾桶 trash', ['general']],
  ['puzzle', '拼图', '插件 拼图 外部 puzzle', ['general']],
  ['settings', '设置', '设置 齿轮 配置 settings', ['general', 'tool']],
  ['wrench', '扳手', '工具 修理 工艺 wrench', ['general', 'tool']],
  ['terminal', '终端', '终端 命令行 terminal', ['general', 'tool']],
  ['code', '代码', '代码 程序 code', ['general', 'tool']],
  ['database', '数据库', '数据库 存储 database', ['general', 'tool']],
  ['mail', '邮件', '邮件 信 通信 mail', ['general', 'society']],
  ['message', '消息', '消息 对话 通信 message', ['general', 'society']],
  ['send', '发送', '发送 传递 send', ['general']],
  ['bell', '通知', '通知 提醒 bell', ['general']],
  ['clock', '时钟', '时钟 时间 时刻 clock', ['general', 'time']],
  ['calendar', '日历', '日历 日期 日程 calendar', ['general', 'time']],
  ['hourglass', '沙漏', '沙漏 等待 时间 hourglass', ['general', 'time']],
  ['bot', '机器人', '机器人 自动 智能 bot', ['general', 'tool']],
  ['smartphone', '手机', '手机 设备 移动 smartphone', ['general']],
  ['monitor', '屏幕', '屏幕 显示器 monitor', ['general']],
  ['camera', '相机', '相机 照片 影像 camera', ['general']],
  ['video', '视频', '视频 影像 video', ['general']],
  ['image', '图像', '图像 图片 画面 image', ['general']],
  ['music', '音乐', '音乐 旋律 music', ['general']],
  ['book', '书', '书 书籍 卷册 book', ['general', 'narrative']],
  ['book-open', '打开的书', '书 阅读 知识 book open', ['general', 'knowledge', 'narrative']],
  ['scroll', '卷轴', '卷轴 文书 古籍 scroll', ['general', 'narrative', 'knowledge']],
  ['file', '文件', '文件 文档 file', ['general', 'narrative']],
  ['files', '文件集', '文件 文档集 files', ['general', 'narrative']],
  ['folder', '文件夹', '文件夹 目录 folder', ['general']],
  ['folder-open', '打开文件夹', '文件夹 目录 folder', ['general']],
  ['paperclip', '回形针', '附件 回形针 paperclip', ['general']],
  ['printer', '打印机', '打印 输出 printer', ['general']],
  ['brush', '画笔', '画笔 绘制 美术 brush', ['general', 'tool']],
  ['edit', '编辑', '编辑 铅笔 修改 edit pencil', ['general', 'narrative']],
  ['pen-line', '笔', '笔 书写 记录 pen', ['general', 'narrative']],
  ['pen-tool', '钢笔工具', '钢笔 绘制 路径 pen tool', ['general', 'tool']],
  ['palette', '调色板', '调色板 颜色 美术 palette', ['general', 'tool']],
  ['type', '字体', '字体 文字 排版 type font', ['general', 'narrative']],
  ['text', '文本', '文本 文字 正文 text', ['general', 'narrative']],
  ['quote', '引用', '引用 语录 quote', ['general', 'narrative']],
  ['list-ordered', '有序列表', '列表 顺序 编号 list ordered', ['general', 'narrative']],
  ['bold', '加粗', '加粗 强调 bold', ['general', 'narrative']],
  ['italic', '斜体', '斜体 强调 italic', ['general', 'narrative']],
  ['strikethrough', '删除线', '删除线 划掉 strikethrough', ['general', 'narrative']],
  ['at-sign', '提及', '提及 提到 at mention', ['general', 'narrative']],
  ['keyboard', '键盘', '键盘 快捷键 keyboard', ['general']],
  ['move', '移动', '移动 拖拽 move', ['general']],
  ['expand', '展开', '展开 全屏 expand', ['general']],
  ['collapse', '收起', '收起 折叠 collapse', ['general']],
  ['copy', '复制', '复制 副本 copy', ['general']],
  ['download', '下载', '下载 导入 download', ['general']],
  ['upload', '上传', '上传 导出 upload', ['general']],
  ['export', '导出', '导出 输出 export', ['general']],
  ['import', '导入', '导入 输入 import', ['general']],
  ['save', '保存', '保存 写入 save', ['general']],
  ['delete', '删除', '删除 移除 delete', ['general']],
  ['close', '关闭', '关闭 取消 close', ['general']],
  ['menu', '菜单', '菜单 目录 menu', ['general']],
  ['dots', '更多', '更多 省略 dots', ['general']],
  ['more-horizontal', '更多', '更多 省略 more', ['general']],
  ['grip', '拖拽', '拖拽 手柄 排序 grip', ['general']],
  ['undo', '撤销', '撤销 回退 undo', ['general']],
  ['redo', '重做', '重做 前进 redo', ['general']],
  ['play', '播放', '播放 开始 play', ['general']],
  ['pause', '暂停', '暂停 pause', ['general']],
  ['stop', '停止', '停止 stop', ['general']],
  ['skip-forward', '跳过', '跳过 下一个 skip', ['general']],
  ['coffee', '咖啡', '咖啡 休息 coffee', ['general']],
  ['route', '路线', '路线 路径 旅程 route', ['general', 'geo', 'tool']],
  ['graph', '图谱', '图谱 关系 网络 graph network', ['general', 'tool']],
  ['workflow', '工作流', '工作流 流程 workflow', ['general', 'tool']],
  ['dashboard', '仪表盘', '仪表盘 面板 dashboard', ['general', 'tool']],
  ['compare', '比较', '比较 对比 compare', ['general', 'tool']],

  // ── 地理与场所 ──
  ['region', '区域', '区域 地区 地图 region', ['geo']],
  ['location', '地点', '地点 位置 location', ['geo']],
  ['map', '地图', '地图 世界 版图 map', ['geo']],
  ['globe', '世界', '世界 星球 全球 globe world', ['geo']],
  ['earth', '地球', '地球 行星 earth planet', ['geo']],
  ['planet', '星球', '星球 行星 planet', ['geo']],
  ['galaxy', '星系', '星系 星海 宇宙 galaxy', ['geo']],
  ['orbit', '轨道', '轨道 星环 orbit', ['geo', 'knowledge']],
  ['building', '建筑', '建筑 房屋 地点 building', ['geo', 'goods']],
  ['castle', '城堡', '城堡 王城 castle', ['geo', 'society']],
  ['city', '城市', '城市 都市 city', ['geo', 'society']],
  ['village', '村庄', '村庄 村落 village', ['geo', 'society']],
  ['camp', '营地', '营地 驻扎 camp', ['geo']],
  ['tent', '帐篷', '帐篷 营地 tent', ['geo']],
  ['mountain', '山', '山 山脉 地形 mountain', ['geo']],
  ['landscape', '地貌', '地貌 地形 风景 landscape', ['geo']],
  ['monument', '纪念碑', '纪念碑 地标 monument', ['geo', 'society']],
  ['landmark', '地标', '地标 名胜 建筑 landmark', ['geo', 'society', 'knowledge']],
  ['church', '教堂', '教堂 神殿 信仰 church temple', ['geo', 'society', 'knowledge']],
  ['home', '家', '家 住所 家园 home', ['geo', 'society']],
  ['bridge', '桥', '桥 连接 通路 bridge', ['geo', 'tool']],
  ['tree', '树', '树 森林 自然 tree', ['geo', 'life']],

  // ── 生命与族群 ──
  ['species', '物种', '物种 种族 生物 species race', ['life']],
  ['race', '种族', '种族 族群 血缘 race', ['life', 'society']],
  ['dna', '基因', '基因 血脉 遗传 dna', ['life', 'knowledge']],
  ['plant', '植物', '植物 草木 生态 plant', ['life']],
  ['flower', '花', '花 花卉 植物 flower', ['life']],
  ['leaf', '叶子', '叶子 草木 自然 leaf', ['life']],
  ['paw', '爪印', '爪印 野兽 动物 paw', ['life']],
  ['water', '水', '水 河流 海洋 water', ['life', 'geo']],
  ['droplet', '水滴', '水滴 液体 水 droplet', ['life', 'geo']],
  ['flask', '烧瓶', '烧瓶 炼金 实验 flask', ['life', 'knowledge']],
  ['flask-conical', '锥形瓶', '烧瓶 药剂 实验 flask', ['life', 'knowledge']],

  // ── 知识与规则 ──
  ['concept', '概念', '概念 设定 规则 concept idea', ['knowledge']],
  ['brain', '大脑', '大脑 智慧 思考 brain mind', ['knowledge']],
  ['lightbulb', '灵感', '灵感 点子 创意 lightbulb idea', ['knowledge', 'narrative']],
  ['magic', '魔法', '魔法 法术 奥术 magic spell', ['knowledge']],
  ['wizard', '巫师', '巫师 法师 施法 wizard mage', ['knowledge', 'society']],
  ['language', '语言', '语言 文字 语系 language', ['knowledge', 'society']],
  ['culture', '文化', '文化 习俗 文明 culture', ['knowledge', 'society']],

  // ── 物产与造物 ──
  ['item', '道具', '道具 物品 item object', ['goods']],
  ['package', '包裹', '包裹 物品 箱子 package box', ['goods']],
  ['apparel', '服饰', '服饰 服装 装备 apparel clothing', ['goods']],
  ['clothing', '衣物', '衣物 服装 衣袍 clothing', ['goods']],
  ['boots', '靴子', '靴子 鞋 装备 boots', ['goods']],
  ['pants', '裤装', '裤装 下装 pants', ['goods']],
  ['gloves', '手套', '手套 护手 gloves', ['goods']],
  ['ring', '戒指', '戒指 饰品 指环 ring', ['goods']],
  ['gem', '宝石', '宝石 晶石 珠宝 gem crystal', ['goods']],
  ['weapon', '武器', '武器 兵刃 weapon', ['goods']],
  ['sword', '剑', '剑 刀剑 兵刃 sword blade', ['goods']],
  ['shield', '盾', '盾 护盾 防御 shield', ['goods']],
  ['coins', '钱币', '钱币 货币 财富 coins money', ['goods']],
  ['coin', '硬币', '硬币 金币 货币 coin gold', ['goods']],

  // ── 时间与事件 ──
  ['timeline', '时间线', '时间线 时间 历史 timeline history', ['time', 'narrative']],
  ['event', '事件', '事件 发生 纪事 event', ['time', 'narrative']],

  // ── 叙事与文本 ──
  ['manuscript', '手稿', '手稿 正文 写作 manuscript', ['narrative']],
  ['outline', '大纲', '大纲 纲要 结构 outline', ['narrative']],
  ['notebook', '笔记本', '笔记本 笔记 notebook', ['narrative']],
  ['document', '文档', '文档 文书 记录 document', ['narrative']],

  // ── 推演与工具 ──
  ['mindmap', '思维导图', '思维导图 脑图 mindmap', ['tool', 'narrative']],
  ['drawing', '画板', '画板 绘图 草图 drawing', ['tool', 'narrative']],
  ['tactical-board', '战术棋盘', '战术 棋盘 推演 tactical board', ['tool']],
  ['war', '战争', '战争 冲突 战斗 war conflict', ['society', 'tool']],
  ['ally', '盟友', '盟友 结盟 同盟 ally', ['society', 'tool']],
  ['trade', '交易', '交易 贸易 商路 trade', ['society', 'tool']],
]

export const ICON_CATALOG: IconCatalogEntry[] = ROWS.map(([name, label, keywords, domains]) => ({
  name,
  label,
  keywords,
  domains,
}))

export function isCatalogIconAvailable(name: string): boolean {
  return hasLucideIcon(name) || hasIcon(name)
}

/** 名称 / 中文名 / 关键词三路命中；domain 为空或 all 时不过滤。 */
export function searchIconCatalog(query: string, domain?: IconDomain | 'all'): IconCatalogEntry[] {
  const q = query.trim().toLowerCase()
  return ICON_CATALOG.filter(entry => {
    if (domain && domain !== 'all' && !entry.domains.includes(domain)) return false
    if (!q) return true
    return entry.name.toLowerCase().includes(q)
      || entry.label.includes(q)
      || entry.keywords.toLowerCase().includes(q)
  })
}
