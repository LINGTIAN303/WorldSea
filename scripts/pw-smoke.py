# -*- coding: utf-8 -*-
"""Playwright 冒烟测试：启动 Chromium 并访问 vite 页面"""
import sys
import traceback

try:
    from playwright.sync_api import sync_playwright

    with sync_playwright() as p:
        b = p.chromium.launch(headless=True)
        pg = b.new_page(viewport={"width": 1280, "height": 800})
        pg.goto("http://localhost:5175", timeout=30000)
        pg.wait_for_timeout(5000)
        print("TITLE:", pg.title())
        print("BODY_LEN:", len(pg.content()))
        b.close()
except Exception:
    traceback.print_exc()
    sys.exit(1)
