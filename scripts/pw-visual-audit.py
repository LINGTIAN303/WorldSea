# -*- coding: utf-8 -*-
"""
pw-visual-audit.py — WorldSmith Tauri 前端实机视觉审查（无头 Chromium + vite:5175）

输出：
- docs/details/截图/live/*.png   各视图 × 双主题截图
- docs/details/截图/live/audit-result.json  结构化测量数据（叠印/对比度/换行/disabled 态等）

说明：纯浏览器环境无 Tauri 后端，invoke 类调用会失败（会话/终端数据为空），
本脚本聚焦"纯视觉可发现"的布局/对比度/状态问题。
"""
import json
import os
import sys
import traceback

from playwright.sync_api import sync_playwright

BASE = "http://localhost:5175"
OUT_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "docs", "details", "截图", "live")
os.makedirs(OUT_DIR, exist_ok=True)

result = {"checks": [], "console_errors": [], "notes": []}


def check(name, theme, view, passed, detail):
    result["checks"].append({
        "name": name, "theme": theme, "view": view,
        "pass": bool(passed), "detail": detail,
    })
    print(f"[{'PASS' if passed else 'FAIL'}] {theme}/{view} {name}: {detail}")


def shot(pg, name):
    path = os.path.join(OUT_DIR, name + ".png")
    pg.screenshot(path=path)
    print("SHOT:", path)


def rects_overlap(r1, r2, tol=1.0):
    if not r1 or not r2:
        return False, 0
    ox = min(r1["x"] + r1["width"], r2["x"] + r2["width"]) - max(r1["x"], r2["x"])
    oy = min(r1["y"] + r1["height"], r2["y"] + r2["height"]) - max(r1["y"], r2["y"])
    area = max(0, ox) * max(0, oy)
    return area > tol, round(area, 1)


def run():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        ctx = browser.new_context(viewport={"width": 1280, "height": 800}, device_scale_factor=1.0)
        pg = ctx.new_page()
        pg.on("console", lambda m: result["console_errors"].append(m.text[:300]) if m.type == "error" else None)
        pg.on("pageerror", lambda e: result["console_errors"].append("PAGEERROR: " + str(e)[:300]))

        for theme in ["light", "dark"]:
            pg.goto(BASE, timeout=30000)
            pg.evaluate("""(t) => {
                localStorage.setItem('worldsmith:theme', t);
                document.documentElement.dataset.theme = t;
            }""", theme)
            pg.reload(timeout=30000)
            pg.wait_for_timeout(3500)  # 等 Vue 挂载 + 轮转提示稳定

            # ── 对话视图 ─────────────────────────────────────
            shot(pg, f"live-{theme}-chat")

            # 检查 1：composer 轮转提示第二行 vs kbd-hint 叠印（报告 #1）
            overlap = pg.evaluate("""() => {
                const hints = document.querySelectorAll('.rotating-hints .hint-line');
                const kbd = document.querySelector('.kbd-hint');
                const actions = document.querySelector('.input-actions');
                const ta = document.querySelector('.input-shell textarea');
                const toR = (el) => { if (!el) return null; const r = el.getBoundingClientRect();
                    return {x: r.x, y: r.y, width: r.width, height: r.height}; };
                return {
                    hint2: hints.length > 1 ? toR(hints[1]) : null,
                    hint1: hints.length > 0 ? toR(hints[0]) : null,
                    kbd: toR(kbd), actions: toR(actions), textarea: toR(ta),
                    hintCount: hints.length,
                };
            }""")
            ov, area = rects_overlap(overlap.get("hint2"), overlap.get("actions"))
            check("composer-hint2-vs-actions-overlap", theme, "chat", not ov,
                  f"hintCount={overlap.get('hintCount')} overlapArea={area}px² "
                  f"hint2Bottom={round((overlap.get('hint2') or {}).get('y', 0) + (overlap.get('hint2') or {}).get('height', 0), 1)} "
                  f"actionsTop={round((overlap.get('actions') or {}).get('y', 0), 1)}")

            # 检查 2：header 清空/压缩按钮的 disabled 态与外观（报告 #6/#10 前提核实）
            header_btns = pg.evaluate("""() => {
                const heads = document.querySelectorAll('.chat-head button, .view-head button, header button');
                return Array.from(heads).map(b => {
                    const cs = getComputedStyle(b);
                    return { text: (b.textContent || '').trim().slice(0, 12),
                             disabled: b.disabled, ariaDisabled: b.getAttribute('aria-disabled'),
                             color: cs.color, bg: cs.backgroundColor, border: cs.borderTopWidth + ' ' + cs.borderTopStyle,
                             opacity: cs.opacity, cls: (b.className || '').slice(0, 40) };
                });
            }""")
            check("header-buttons-probe", theme, "chat", True, json.dumps(header_btns, ensure_ascii=False))

            # 检查 3：rail "子Agent" 是否折行（报告 #13）
            wrap = pg.evaluate("""() => {
                const labels = document.querySelectorAll('.rail-item .rail-label');
                return Array.from(labels).map(l => ({ text: l.textContent,
                    h: l.getBoundingClientRect().height, lh: parseFloat(getComputedStyle(l).lineHeight) || 0 }));
            }""")
            wrapped = [w for w in wrap if w["lh"] and w["h"] > w["lh"] * 1.4]
            check("rail-label-no-wrap", theme, "chat", not wrapped, json.dumps(wrap, ensure_ascii=False))

            # 检查 4：浅色空态图标对比度（报告 #14）
            empty_icon = pg.evaluate("""() => {
                const el = document.querySelector('.tui-empty svg, .empty-icon svg, [class*="empty"] svg');
                if (!el) return null;
                const cs = getComputedStyle(el);
                return { color: cs.color, fill: cs.fill, stroke: cs.stroke, opacity: cs.opacity,
                         cls: (el.parentElement && el.parentElement.className || '').toString().slice(0, 60) };
            }""")
            if empty_icon:
                check("empty-icon-color", theme, "chat", True, json.dumps(empty_icon, ensure_ascii=False))
            else:
                check("empty-icon-color", theme, "chat", True, "NO_EMPTY_ICON_FOUND(可能非空态)")

            # 检查 5：hover 态（send 按钮 / rail / header 按钮）
            try:
                pg.hover(".send-btn", timeout=3000)
                pg.wait_for_timeout(400)
                shot(pg, f"live-{theme}-chat-sendbtn-hover")
            except Exception as e:
                result["notes"].append(f"{theme} send-btn hover fail: {e}")
            try:
                pg.hover("button.rail-item:has-text('终端')", timeout=3000)
                pg.wait_for_timeout(400)
                shot(pg, f"live-{theme}-chat-rail-hover")
            except Exception as e:
                result["notes"].append(f"{theme} rail hover fail: {e}")

            # 检查 6：输入文本 → 清空按钮出现 + 文本选中态（补 b55/b80 证据）
            try:
                pg.click(".input-shell textarea", timeout=3000)
                pg.type(".input-shell textarea", "验证文本选中态与清空按钮", delay=10)
                pg.wait_for_timeout(400)
                shot(pg, f"live-{theme}-chat-input-typed")
                pg.evaluate("""() => { const ta = document.querySelector('.input-shell textarea'); ta.focus(); ta.select(); }""")
                pg.wait_for_timeout(300)
                shot(pg, f"live-{theme}-chat-text-selected")
                sel = pg.evaluate("""() => {
                    const s = getComputedStyle(document.querySelector('.input-shell textarea'), '::selection');
                    return { selectionBg: s.backgroundColor, selectionColor: s.color };
                }""")
                check("textarea-selection-style", theme, "chat", True, json.dumps(sel, ensure_ascii=False))
                pg.evaluate("""() => { const ta = document.querySelector('.input-shell textarea'); ta.value=''; ta.dispatchEvent(new Event('input')); }""")
            except Exception as e:
                result["notes"].append(f"{theme} input-type fail: {e}")

            # ── 终端视图 ─────────────────────────────────────
            try:
                pg.click("button.rail-item:has-text('终端')", timeout=3000)
                pg.wait_for_timeout(1200)
                shot(pg, f"live-{theme}-terminal")
                term = pg.evaluate("""() => {
                    const empty = document.querySelector('.terminal-view [class*="empty"], .tui-empty');
                    const rows = document.querySelectorAll('[class*="session"] [class*="meta"], .session-meta');
                    const err = document.querySelector('.terminal-view [class*="error"]');
                    return { hasEmpty: !!empty, metaRows: rows.length,
                             errBar: err ? (err.className || '').slice(0, 50) : null,
                             bodyText: (document.querySelector('.view')?.textContent || '').trim().slice(0, 120) };
                }""")
                check("terminal-state", theme, "terminal", True, json.dumps(term, ensure_ascii=False))
            except Exception as e:
                result["notes"].append(f"{theme} terminal fail: {e}")

            # ── 子Agent 视图 ─────────────────────────────────
            try:
                pg.click("button.rail-item:has-text('子Agent')", timeout=3000)
                pg.wait_for_timeout(1200)
                shot(pg, f"live-{theme}-subagent")
                sub = pg.evaluate("""() => {
                    const clear = Array.from(document.querySelectorAll('button')).find(b => (b.textContent||'').includes('清空实例'));
                    const tags = document.querySelectorAll('[class*="tag"]');
                    const t = (el) => { if (!el) return null; const cs = getComputedStyle(el);
                        return { disabled: el.disabled, color: cs.color, opacity: cs.opacity, cls: (el.className||'').slice(0,40) }; };
                    return { clearBtn: t(clear), tagCount: tags.length,
                             tagStyles: Array.from(tags).slice(0, 5).map(g => { const cs = getComputedStyle(g);
                                 return { text: (g.textContent||'').trim().slice(0, 14), bg: cs.backgroundColor, color: cs.color, radius: cs.borderRadius }; }) };
                }""")
                check("subagent-state", theme, "subagent", True, json.dumps(sub, ensure_ascii=False))
            except Exception as e:
                result["notes"].append(f"{theme} subagent fail: {e}")

            # ── 记忆视图 ─────────────────────────────────────
            try:
                pg.click("button.rail-item:has-text('记忆')", timeout=3000)
                pg.wait_for_timeout(1200)
                shot(pg, f"live-{theme}-memory")
                mem = pg.evaluate("""() => {
                    const s = document.querySelector('.mp-search');
                    const btns = Array.from(document.querySelectorAll('.view button')).slice(0, 4).map(b => {
                        const cs = getComputedStyle(b); const r = b.getBoundingClientRect();
                        return { text: (b.textContent||'').trim().slice(0, 8), h: r.height, disabled: b.disabled, opacity: cs.opacity };
                    });
                    return { searchH: s ? s.getBoundingClientRect().height : null,
                             searchRadius: s ? getComputedStyle(s).borderRadius : null, buttons: btns };
                }""")
                check("memory-state", theme, "memory", True, json.dumps(mem, ensure_ascii=False))
            except Exception as e:
                result["notes"].append(f"{theme} memory fail: {e}")

            # 回到对话视图
            try:
                pg.click("button.rail-item:has-text('对话')", timeout=3000)
                pg.wait_for_timeout(800)
            except Exception:
                pass

        browser.close()


try:
    run()
except Exception:
    traceback.print_exc()
finally:
    out = os.path.join(OUT_DIR, "audit-result.json")
    with open(out, "w", encoding="utf-8") as f:
        json.dump(result, f, ensure_ascii=False, indent=2)
    print("RESULT_JSON:", out)
