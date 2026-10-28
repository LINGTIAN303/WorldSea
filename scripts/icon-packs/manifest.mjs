/**
 * 多风格内置图标库的精选清单。
 * 生成器只取这里列出的语义图标；缺项自动跳过。新增图标库时：
 * 1) 在 PACKS 增加一条（package 为 @iconify-json 包名）；
 * 2) 为它补 aliases（不同库对同一语义的命名差异）；
 * 3) 运行 `node scripts/icon-packs/generate.mjs`。
 */

export const SEMANTIC = [
  { key: 'home', label: '房屋', keywords: '房屋 家 住所 home house', domains: ['geo'] },
  { key: 'user', label: '人物', keywords: '人物 角色 用户 user person', domains: ['life', 'society'] },
  { key: 'users', label: '人群', keywords: '人群 群体 用户组 users group', domains: ['life', 'society'] },
  { key: 'shield', label: '盾牌', keywords: '盾 防御 保护 shield defense', domains: ['goods', 'society'] },
  { key: 'sword', label: '剑', keywords: '剑 刀剑 兵刃 sword blade', domains: ['goods'] },
  { key: 'book', label: '书', keywords: '书 书籍 文本 book', domains: ['knowledge', 'narrative'] },
  { key: 'map', label: '地图', keywords: '地图 地点 路线 map', domains: ['geo'] },
  { key: 'settings', label: '设置', keywords: '设置 齿轮 配置 settings gear', domains: ['tool'] },
  { key: 'castle', label: '城堡', keywords: '城堡 要塞 城 castle fortress', domains: ['geo', 'society'] },
  { key: 'crown', label: '王冠', keywords: '王冠 君主 皇室 crown king', domains: ['society', 'goods'] },
  { key: 'tree', label: '树', keywords: '树 森林 植物 tree forest', domains: ['life', 'geo'] },
  { key: 'scroll', label: '卷轴', keywords: '卷轴 文书 记录 scroll', domains: ['knowledge', 'narrative'] },
  { key: 'dragon', label: '龙', keywords: '龙 巨龙 神兽 dragon', domains: ['life'] },
  { key: 'skull', label: '骷髅', keywords: '骷髅 死亡 亡灵 skull death', domains: ['life', 'society'] },
  { key: 'gem', label: '宝石', keywords: '宝石 晶石 珠宝 gem crystal', domains: ['goods'] },
  { key: 'coins', label: '钱币', keywords: '钱币 货币 财富 coins money', domains: ['goods'] },
  { key: 'compass', label: '指南针', keywords: '指南针 方向 导航 compass navigation', domains: ['geo', 'tool'] },
  { key: 'hourglass', label: '沙漏', keywords: '沙漏 时间 计时 hourglass time', domains: ['time'] },
  { key: 'key', label: '钥匙', keywords: '钥匙 开启 锁 key unlock', domains: ['goods'] },
  { key: 'flag', label: '旗帜', keywords: '旗帜 国家 阵营 flag banner', domains: ['society'] },
  { key: 'mountain', label: '山', keywords: '山 山脉 地形 mountain', domains: ['geo'] },
  { key: 'water', label: '水', keywords: '水 河流 海洋 water river', domains: ['geo'] },
  { key: 'star', label: '星', keywords: '星 星辰 收藏 star', domains: ['general'] },
  { key: 'heart', label: '心', keywords: '心 喜爱 情感 heart love', domains: ['life'] },
  { key: 'eye', label: '眼睛', keywords: '眼睛 观察 视觉 eye', domains: ['life'] },
  { key: 'handshake', label: '握手', keywords: '握手 合作 结盟 handshake ally', domains: ['society'] },
  { key: 'building', label: '建筑', keywords: '建筑 房屋 城市 building city', domains: ['society', 'geo'] },
  { key: 'ship', label: '船', keywords: '船 航海 航行 ship boat', domains: ['geo', 'goods'] },
  { key: 'horse', label: '马', keywords: '马 坐骑 骑兵 horse', domains: ['life'] },
  { key: 'potion', label: '药水', keywords: '药水 药剂 炼金 potion alchemy', domains: ['goods', 'knowledge'] },
  { key: 'wheat', label: '麦穗', keywords: '麦穗 农业 粮食 wheat grain', domains: ['life', 'goods'] },
  { key: 'moon', label: '月亮', keywords: '月亮 夜晚 月相 moon night', domains: ['time', 'geo'] },
  { key: 'sun', label: '太阳', keywords: '太阳 日光 白天 sun day', domains: ['time', 'geo'] },
]

export const PACKS = [
  {
    id: 'ph', label: 'Phosphor', style: 'Regular', package: 'ph', license: 'MIT',
    colorMode: 'mono', aliases: { home: ['house', 'home'], book: ['book-open'], map: ['map-trifold'], settings: ['gear'] },
  },
  {
    id: 'ph-fill', label: 'Phosphor', style: 'Fill', package: 'ph', suffix: '-fill', license: 'MIT',
    colorMode: 'mono', aliases: { home: ['house', 'home'], book: ['book-open'], map: ['map-trifold'], settings: ['gear'] },
  },
  {
    id: 'ph-duotone', label: 'Phosphor', style: 'Duotone', package: 'ph', suffix: '-duotone', license: 'MIT',
    colorMode: 'mono', aliases: { home: ['house', 'home'], book: ['book-open'], map: ['map-trifold'], settings: ['gear'] },
  },
  {
    id: 'ph-thin', label: 'Phosphor', style: 'Thin', package: 'ph', suffix: '-thin', license: 'MIT',
    colorMode: 'mono', aliases: { home: ['house', 'home'], book: ['book-open'], map: ['map-trifold'], settings: ['gear'] },
  },
  {
    id: 'ph-light', label: 'Phosphor', style: 'Light', package: 'ph', suffix: '-light', license: 'MIT',
    colorMode: 'mono', aliases: { home: ['house', 'home'], book: ['book-open'], map: ['map-trifold'], settings: ['gear'] },
  },
  {
    id: 'ph-bold', label: 'Phosphor', style: 'Bold', package: 'ph', suffix: '-bold', license: 'MIT',
    colorMode: 'mono', aliases: { home: ['house', 'home'], book: ['book-open'], map: ['map-trifold'], settings: ['gear'] },
  },
  {
    id: 'sl-freehand', label: 'Streamline', style: 'Freehand 手绘', package: 'streamline-freehand', license: 'CC BY 4.0',
    colorMode: 'mono',
    aliases: {
      user: ['face-id-user'], shield: ['security-computer-shield'], book: ['book-bookmark'],
      map: ['worldwide-web-location-pin'], settings: ['settings-cog'], castle: ['amusement-park-castle'],
      skull: ['delete-skull'], coins: ['money-coin-cash'], hourglass: ['time-hourglass-triangle'],
      flag: ['learning-programming-flag'], water: ['water-fountain-drink'], eye: ['view-eye-1'],
      handshake: ['business-deal-handshake'], building: ['office-building-glass-window'],
    },
  },
  {
    id: 'sl-plump', label: 'Streamline', style: 'Plump 圆胖', package: 'streamline-plump', license: 'CC BY 4.0',
    colorMode: 'mono',
    aliases: {
      home: ['home-1'], user: ['user-face-male'], shield: ['shield-1'], book: ['book-1'],
      map: ['map-fold'], settings: ['cog'], tree: ['tree-1'], skull: ['skull-2'],
      coins: ['dollar-coin'], compass: ['compass-navigator'], hourglass: ['hourglass'],
      key: ['keyhole-lock-circle'], flag: ['rectangle-flag'], star: ['hotel-five-star'],
      eye: ['eye-optic'], building: ['building-office'], ship: ['sail-ship'],
      wheat: ['wheat'], moon: ['moon-stars'], sun: ['sun'], scroll: ['horizonal-scroll'],
    },
  },
  {
    id: 'sl-plump-remix', label: 'Streamline', style: 'Plump Remix 圆胖', package: 'streamline-plump', suffix: '-remix', license: 'CC BY 4.0',
    colorMode: 'mono',
    aliases: {
      home: ['home-1'], user: ['user-face-male'], shield: ['shield-1'], book: ['book-1'],
      map: ['map-fold'], settings: ['cog'], tree: ['tree-1'], skull: ['skull-2'],
      coins: ['dollar-coin'], compass: ['compass-navigator'], hourglass: ['hourglass'],
      key: ['keyhole-lock-circle'], flag: ['rectangle-flag'], star: ['hotel-five-star'],
      eye: ['eye-optic'], building: ['building-office'], ship: ['sail-ship'],
      wheat: ['wheat'], moon: ['moon-stars'], sun: ['sun'], scroll: ['horizonal-scroll'],
    },
  },
  {
    id: 'sl-plump-solid', label: 'Streamline', style: 'Plump Solid 圆胖', package: 'streamline-plump', suffix: '-solid', license: 'CC BY 4.0',
    colorMode: 'mono',
    aliases: {
      home: ['home-1'], user: ['user-face-male'], shield: ['shield-1'], book: ['book-1'],
      map: ['map-fold'], settings: ['cog'], tree: ['tree-1'], skull: ['skull-2'],
      coins: ['dollar-coin'], compass: ['compass-navigator'], hourglass: ['hourglass'],
      key: ['keyhole-lock-circle'], flag: ['rectangle-flag'], star: ['hotel-five-star'],
      eye: ['eye-optic'], building: ['building-office'], ship: ['sail-ship'],
      wheat: ['wheat'], moon: ['moon-stars'], sun: ['sun'], scroll: ['horizonal-scroll'],
    },
  },
  {
    id: 'sl-sharp', label: 'Streamline', style: 'Sharp 锐角', package: 'streamline-sharp', license: 'CC BY 4.0',
    colorMode: 'mono',
    aliases: {
      home: ['home-1'], user: ['user-add-plus'], shield: ['shield-2'], book: ['contact-book'],
      map: ['map-search'], settings: ['cog'], sword: ['sword-attack'], tree: ['tree-3'],
      skull: ['skull-2'], compass: ['location-compass-2'], hourglass: ['hourglass'],
      key: ['browser-key'], flag: ['triangle-flag'], water: ['water-drop'], star: ['star-2'],
      heart: ['double-heart'], building: ['office-building-2'], ship: ['ship'],
      moon: ['moon-cloud'], sun: ['sun'], scroll: ['diagonal-scroll-1'],
    },
  },
  {
    id: 'sl-sharp-remix', label: 'Streamline', style: 'Sharp Remix 锐角', package: 'streamline-sharp', suffix: '-remix', license: 'CC BY 4.0',
    colorMode: 'mono',
    aliases: {
      home: ['home-1'], user: ['user-add-plus'], shield: ['shield-2'], book: ['contact-book'],
      map: ['map-search'], settings: ['cog'], sword: ['sword-attack'], tree: ['tree-3'],
      skull: ['skull-2'], compass: ['location-compass-2'], hourglass: ['hourglass'],
      key: ['browser-key'], flag: ['triangle-flag'], water: ['water-drop'], star: ['star-2'],
      heart: ['double-heart'], building: ['office-building-2'], ship: ['ship'],
      moon: ['moon-cloud'], sun: ['sun'], scroll: ['diagonal-scroll-1'],
    },
  },
  {
    id: 'sl-sharp-solid', label: 'Streamline', style: 'Sharp Solid 锐角', package: 'streamline-sharp', suffix: '-solid', license: 'CC BY 4.0',
    colorMode: 'mono',
    aliases: {
      home: ['home-1'], user: ['user-add-plus'], shield: ['shield-2'], book: ['contact-book'],
      map: ['map-search'], settings: ['cog'], sword: ['sword-attack'], tree: ['tree-3'],
      skull: ['skull-2'], compass: ['location-compass-2'], hourglass: ['hourglass'],
      key: ['browser-key'], flag: ['triangle-flag'], water: ['water-drop'], star: ['star-2'],
      heart: ['double-heart'], building: ['office-building-2'], ship: ['ship'],
      moon: ['moon-cloud'], sun: ['sun'], scroll: ['diagonal-scroll-1'],
    },
  },
  {
    id: 'sl-cyber', label: 'Streamline', style: 'Cyber 赛博', package: 'streamline-cyber', license: 'CC BY 4.0',
    colorMode: 'mono',
    aliases: {
      home: ['home-scene'], user: ['person'], shield: ['shield-3'], book: ['book-open-1'],
      castle: ['castle-2'], skull: ['skull-1'], coins: ['coin-hand-1'], compass: ['compass-2'],
      hourglass: ['hourglass-2'], key: ['key-2'], flag: ['flag-3'], star: ['badge-star-2'],
      heart: ['heart-beat'], handshake: ['business-handshake-deal'], building: ['building-13'],
      sun: ['sun-1'], crown: ['crown-2'],
    },
  },
  {
    id: 'sl-pixel', label: 'Streamline', style: 'Pixel 像素', package: 'streamline-pixel', license: 'CC BY 4.0',
    colorMode: 'mono',
    aliases: {
      home: ['interface-essential-home-1'], user: ['single-user-shield'], shield: ['single-user-shield'],
      map: ['interface-essential-map'], gem: ['business-prodect-diamond'], tree: ['ecology-tree'],
      skull: ['interface-essential-skull-1'], coins: ['business-money-coin-currency'],
      compass: ['interface-essential-safari-compass'], hourglass: ['interface-essential-waiting-hourglass-loading'],
      key: ['interface-essential-key'], flag: ['interface-essential-flag'], water: ['health-drug-medicine-water'],
      star: ['social-rewards-rating-star-1'], heart: ['interface-essential-heart-favorite'],
      eye: ['interface-essential-view-eye'], handshake: ['business-products-deal-handshake'],
      building: ['building-real-eastate-house-2'], moon: ['weather-moon'], sun: ['weather-cloud-sun-fine'],
      scroll: ['interface-essential-scroll-horizontal'], crown: ['social-rewards-vip-crown-king'],
      book: ['content-files-book'], settings: ['interface-essential-settings-toggle-horizontal'],
    },
  },
  {
    id: 'gi', label: 'Game-icons', style: 'Fantasy 奇幻', package: 'game-icons', license: 'CC BY 3.0',
    colorMode: 'mono',
    aliases: { sword: ['sword-wound', 'crossed-swords'], scroll: ['scroll-unfurled'], map: ['treasure-map'], castle: ['castle'], skull: ['skull'] },
    extras: [
      ['dragon-head', '龙首', '龙 巨龙 神兽 dragon', ['life']],
      ['crown', '王冠', '王冠 君主 皇室 crown', ['society', 'goods']],
      ['wizard-staff', '法杖', '法杖 魔法 巫师 wizard staff magic', ['knowledge', 'goods']],
      ['potion-ball', '药水瓶', '药水 炼金 魔法 potion alchemy', ['goods', 'knowledge']],
      ['treasure-map', '藏宝图', '藏宝图 地图 冒险 treasure map', ['geo', 'goods']],
      ['spell-book', '魔法书', '魔法书 法术 知识 spell book', ['knowledge']],
      ['horse-head', '马首', '马 坐骑 骑兵 horse', ['life']],
      ['wheat', '麦穗', '麦穗 农业 粮食 wheat', ['life', 'goods']],
    ],
  },
  {
    id: 'ip-color', label: 'IconPark', style: 'Multi-color 彩色', package: 'icon-park', license: 'Apache 2.0',
    colorMode: 'color', aliases: { map: ['map-distance'], settings: ['setting'] },
  },
  {
    id: 'ip-twotone', label: 'IconPark', style: 'TwoTone 双色', package: 'icon-park-twotone', license: 'Apache 2.0',
    colorMode: 'mono', aliases: { map: ['map-distance'], settings: ['setting'] },
  },
  {
    id: 'solar-broken', label: 'Solar', style: 'Broken 断裂', package: 'solar', suffix: '-broken', license: 'CC BY 4.0',
    colorMode: 'mono',
  },
  {
    id: 'solar-duotone', label: 'Solar', style: 'Line Duotone 双色', package: 'solar', suffix: '-line-duotone', license: 'CC BY 4.0',
    colorMode: 'mono', aliases: { user: ['user-circle'] },
  },
  {
    id: 'solar-linear', label: 'Solar', style: 'Linear 线性', package: 'solar', suffix: '-linear', license: 'CC BY 4.0',
    colorMode: 'mono',
  },
  {
    id: 'solar-bold', label: 'Solar', style: 'Bold 粗线', package: 'solar', suffix: '-bold', license: 'CC BY 4.0',
    colorMode: 'mono',
  },
  {
    id: 'solar-outline', label: 'Solar', style: 'Outline 轮廓', package: 'solar', suffix: '-outline', license: 'CC BY 4.0',
    colorMode: 'mono',
  },
  {
    id: 'solar-bold-duotone', label: 'Solar', style: 'Bold Duotone 双色', package: 'solar', suffix: '-bold-duotone', license: 'CC BY 4.0',
    colorMode: 'mono', aliases: { user: ['user-circle'] },
  },
  {
    id: 'pixel', label: 'Pixelarticons', style: 'Pixel 像素', package: 'pixelarticons', license: 'MIT',
    colorMode: 'mono',
  },
]
