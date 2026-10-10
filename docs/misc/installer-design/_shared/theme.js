/* 设计稿专用：主题切换 + 变体切换。真机施工时不引入本文件。 */
(function () {
  'use strict';

  var body = document.body;
  var STORAGE_KEY = 'worldsea-installer-design-theme';

  // 记忆上一次选择，便于连续审阅多个页面时保持一致
  var saved = null;
  try {
    saved = window.localStorage.getItem(STORAGE_KEY);
  } catch (err) {
    saved = null;
  }
  if (saved === 'light') {
    body.setAttribute('data-preview-light', '');
    body.removeAttribute('data-ds-dark-theme');
  } else {
    body.setAttribute('data-ds-dark-theme', '');
    body.removeAttribute('data-preview-light');
  }

  var toggle = document.querySelector('[data-theme-toggle]');
  if (toggle) {
    var sync = function () {
      var isDark = body.hasAttribute('data-ds-dark-theme');
      toggle.textContent = isDark ? '切换浅色' : '切换深色';
      toggle.setAttribute('aria-label', isDark ? '切换到浅色主题' : '切换到深色主题');
    };
    sync();
    toggle.addEventListener('click', function () {
      var isDark = body.hasAttribute('data-ds-dark-theme');
      if (isDark) {
        // 深色 → 浅色：摘掉深色令牌组，同时点亮稿纸浅色底
        body.removeAttribute('data-ds-dark-theme');
        body.setAttribute('data-preview-light', '');
      } else {
        // 浅色 → 深色：摘掉浅色稿纸底，挂回深色令牌组
        body.removeAttribute('data-preview-light');
        body.setAttribute('data-ds-dark-theme', '');
      }
      try {
        window.localStorage.setItem(
          STORAGE_KEY,
          body.hasAttribute('data-ds-dark-theme') ? 'dark' : 'light'
        );
      } catch (err) {
        /* 忽略隐私模式下的写入失败 */
      }
      sync();
    });
  }

  // 变体切换：同页承载多套方案时，切换 [data-variant] 组件的显隐
  var bar = document.querySelector('[data-variant-bar]');
  if (bar) {
    var buttons = Array.prototype.slice.call(bar.querySelectorAll('button'));
    var apply = function (name) {
      buttons.forEach(function (btn) {
        btn.setAttribute('aria-pressed', String(btn.dataset.variantTarget === name));
      });
      Array.prototype.forEach.call(
        document.querySelectorAll('[data-variant]'),
        function (el) {
          el.hidden = el.dataset.variant !== name;
        }
      );
    };
    buttons.forEach(function (btn) {
      btn.addEventListener('click', function () {
        apply(btn.dataset.variantTarget);
      });
    });
    if (buttons.length > 0) {
      apply(buttons[0].dataset.variantTarget);
    }
  }
})();
