# -*- coding: utf-8 -*-
"""win-capture.py — 截取指定窗口画面（前置窗口后用 PIL ImageGrab）
用法: python win-capture.py <窗口标题> <输出路径>
"""
import sys
import time
import ctypes
from ctypes import wintypes
from PIL import ImageGrab


def main():
    title = sys.argv[1]
    out = sys.argv[2]
    user32 = ctypes.windll.user32

    # 模糊匹配窗口标题
    found = []

    @ctypes.WINFUNCTYPE(wintypes.BOOL, wintypes.HWND, wintypes.LPARAM)
    def enum_cb(hwnd, _lparam):
        if user32.IsWindowVisible(hwnd):
            buf = ctypes.create_unicode_buffer(256)
            user32.GetWindowTextW(hwnd, buf, 256)
            if title.lower() in buf.value.lower():
                found.append((hwnd, buf.value))
        return True

    user32.EnumWindows(enum_cb, 0)
    if not found:
        print('WINDOW_NOT_FOUND: ' + title)
        sys.exit(1)
    hwnd, matched = found[0]
    print('matched:', matched, 'hwnd:', hwnd)

    if user32.IsIconic(hwnd):
        user32.ShowWindow(hwnd, 9)  # SW_RESTORE
    # 置前（允许失败，截图不依赖前台，但不能被遮挡）
    user32.SetForegroundWindow(hwnd)
    time.sleep(0.8)

    rect = wintypes.RECT()
    user32.GetWindowRect(hwnd, ctypes.byref(rect))
    box = (rect.left, rect.top, rect.right, rect.bottom)
    print('rect:', box)
    img = ImageGrab.grab(bbox=box)
    img.save(out)
    print('saved:', out, img.size)


if __name__ == '__main__':
    main()
