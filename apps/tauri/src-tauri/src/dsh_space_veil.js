/* worldsea-shell:space-veil —— 空间切换遮罩（壳注入，Agent 空间 / 工作台两页同款）
 * ─────────────────────────────────────────────
 * 壳在双窗互斥切换（workspace_window.rs）时以 eval 驱动：
 *   __wsSpaceVeil.show()    遮罩浮现（150ms），中央眼睛地球原地自转
 *   __wsSpaceVeil.release() 遮罩淡出（400ms）露出页面
 * 两页同款遮罩 + 切换时几何对齐 ⇒ 眼睛跨窗位置连续，遮蔽 show/hide 硬切。
 * 素材走 /workspace/eye/（未哈希，协议层 /workspace 前缀直连 workspace-dist，两页同源可取）。
 * 强调色从 localStorage 直读（worldsea-theme / worldsea-accent-custom，与 entity-core 键名同源；
 * 深色锚点为构建期离线派生的硬编码表——accentPresets.ts 改色板时须同步本表）。
 */
;(function () {
  'use strict'
  if (globalThis.__wsSpaceVeil) return

  /* 强调色预设 [浅色锚点, 深色锚点]（同步自 packages/entity-core accentPresets.ts；prism/cyan/moss/ember 深色为 deriveDark 离线派生值） */
  var ACCENTS = {
    indigo: ['#4f46e5', '#8b87f8'],
    prism: ['#2563eb', '#75a3fc'],
    cyan: ['#0e7490', '#76aec3'],
    moss: ['#15803d', '#78b685'],
    ember: ['#c2410c', '#e5886b'],
    ink: ['#2a2018', '#d6c9b4'],
  }
  var DEFAULT_ACCENT = ['#4f46e5', '#8b87f8']

  function resolveIrisColor() {
    // 独立虹膜色（设置-外观「眼睛虹膜色」，键名与 App.vue/AppearancePanel 同源）优先——显式色深浅通用
    try {
      var eyeIris = localStorage.getItem('worldsea-eye-iris')
      if (eyeIris) return eyeIris
    } catch (e) {
      /* localStorage 不可用走强调色轴 */
    }
    var dark = document.documentElement.dataset.theme === 'dark'
    var col = dark ? 1 : 0
    try {
      var id = localStorage.getItem('worldsea-theme')
      if (id === 'custom') {
        var custom = localStorage.getItem('worldsea-accent-custom')
        if (custom) return custom // 自定义锚点已量化；深色态沿用浅锚（亮度带 0.40-0.56，深底可辨）
        return DEFAULT_ACCENT[col]
      }
      if (id && ACCENTS[id]) return ACCENTS[id][col]
    } catch (e) {
      /* localStorage 不可用走默认 */
    }
    return DEFAULT_ACCENT[col]
  }

  var STYLE =
    '#worldsea-space-veil{position:fixed;inset:0;z-index:2147483600;display:flex;align-items:center;justify-content:center;' +
    'opacity:0;pointer-events:none;transition:none;}' +
    /* show(fade) 源窗侧淡入；默认（目标窗侧）无过渡——窗口可见的首帧遮罩即全不透明，防另一侧界面闪现 */
    '#worldsea-space-veil.wsv-fade.wsv-on{transition:opacity .15s ease;}' +
    '#worldsea-space-veil.wsv-on{opacity:1;pointer-events:auto;}' +
    '#worldsea-space-veil.wsv-out{transition:opacity .4s ease;}' +
    'html[data-theme="dark"] #worldsea-space-veil,html:not([data-theme]) #worldsea-space-veil{background:var(--color-bg-base,#141416);}' +
    'html[data-theme="light"] #worldsea-space-veil{background:var(--color-bg-base,#f4f5f7);}' +
    '#worldsea-space-veil .wsv-eye{position:relative;width:min(240px,24vw);aspect-ratio:1441/932;}' +
    '#worldsea-space-veil .wsv-layer{position:absolute;background:var(--color-text-primary,var(--dsw-alias-label-primary,#e6e9ee));' +
    '-webkit-mask-size:100% 100%;mask-size:100% 100%;-webkit-mask-repeat:no-repeat;mask-repeat:no-repeat;}' +
    'html[data-theme="light"] #worldsea-space-veil .wsv-layer{background:var(--color-text-primary,var(--dsw-alias-label-primary,#26282c));}' +
    '#worldsea-space-veil .wsv-socket{left:0;top:0;width:100%;height:100%;' +
    '-webkit-mask-image:url(/workspace/eye/eye-socket.webp);mask-image:url(/workspace/eye/eye-socket.webp);}' +
    '#worldsea-space-veil .wsv-brow{left:3.12%;top:17.6%;width:62.11%;height:39.06%;' +
    '-webkit-mask-image:url(/workspace/eye/eye-brow.webp);mask-image:url(/workspace/eye/eye-brow.webp);}' +
    '#worldsea-space-veil .wsv-clip{position:absolute;inset:0;clip-path:ellipse(22.9% 22% at 37.82% 54.45%);-webkit-clip-path:ellipse(22.9% 22% at 37.82% 54.45%);}' +
    '#worldsea-space-veil .wsv-iris{left:23.94%;top:33.37%;width:28.66%;height:43.24%;will-change:transform;' +
    'animation:wsv-spin 1.6s linear infinite;' +
    '-webkit-mask-image:url(/workspace/eye/eye-iris.webp);mask-image:url(/workspace/eye/eye-iris.webp);}' +
    '@keyframes wsv-spin{from{transform:rotate(0)}to{transform:rotate(360deg)}}'

  var veil = null
  var iris = null

  function ensure() {
    if (veil) return
    var style = document.createElement('style')
    style.textContent = STYLE
    document.head.appendChild(style)
    veil = document.createElement('div')
    veil.id = 'worldsea-space-veil'
    veil.setAttribute('aria-hidden', 'true')
    veil.innerHTML =
      '<div class="wsv-eye"><div class="wsv-layer wsv-socket"></div>' +
      '<div class="wsv-clip"><div class="wsv-layer wsv-iris"></div></div>' +
      '<div class="wsv-layer wsv-brow"></div></div>'
    iris = veil.querySelector('.wsv-iris')
    document.body.appendChild(veil)
  }

  function show(fade) {
    ensure()
    iris.style.background = resolveIrisColor()
    if (fade) veil.classList.add('wsv-fade')
    else veil.classList.remove('wsv-fade')
    veil.classList.add('wsv-on')
  }

  function release() {
    if (!veil) return
    // 淡出统一走 .wsv-out（.4s）——即时出现（目标窗侧）的遮罩也要软离场
    veil.classList.add('wsv-out')
    veil.classList.remove('wsv-on')
    setTimeout(function () {
      veil.classList.remove('wsv-out')
    }, 450)
  }

  globalThis.__wsSpaceVeil = { show: show, release: release }
})()
