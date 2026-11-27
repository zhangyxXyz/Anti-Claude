/**
 * Anti-Claude — core/runtime.js
 * Lean, self-contained browser runtime injected by core/daemon.mjs into Google Antigravity Desktop.
 * Provides:
 * 1. Strict host-window & swarm-plugin isolation (never injects into user preview iframes or localhost web apps).
 * 2. Instant <style> mounting (#ag-custom-fonts, #ag-user-theme-vars, #antigravity-user-custom-style) & hot-reload cleanup.
 * 3. Live Light/Dark mode synchronization across main window, native titlebar/curtain, and plugin://swarm-- iframes.
 * 4. Composer live metrics pill (#ag-live-metrics-pill) + route watcher + CDP __agRequestMetrics binding.
 * 5. Execution context (ctx) & Chinese dictionary (window.__ag_i18n_dict) for user/custom.js.
 */
(function runBoot(boot, fromDcl) {
  const IS_SWARM_PLUGIN_FRAME = !!(
    window.location &&
    ((window.location.protocol === 'plugin:' && /^swarm--/i.test(window.location.hostname || '')) ||
      /^plugin:\/\/swarm--/i.test(String(window.location.href || '')))
  );
  if (window.top !== window && !IS_SWARM_PLUGIN_FRAME) return;
  if (!boot || typeof boot !== 'object') return;

  if (window.__ag_boot_dcl_handler) {
    try {
      window.removeEventListener('DOMContentLoaded', window.__ag_boot_dcl_handler);
    } catch {}
    window.__ag_boot_dcl_handler = null;
  }
  if (window.__ag_boot_doc_observer) {
    try {
      window.__ag_boot_doc_observer.disconnect();
    } catch {}
    window.__ag_boot_doc_observer = null;
  }

  const isPreloadHost = () => {
    if (IS_SWARM_PLUGIN_FRAME || (window.location && window.location.protocol === 'vscode-file:')) {
      return true;
    }
    if (window.__APP_CONFIG__ && window.__APP_CONFIG__.productName === 'antigravity') {
      return true;
    }
    return !!(
      window.electronNative &&
      ((typeof window.electronNative.setTitleBarOverlay === 'function' &&
        window.nativeStorage &&
        typeof window.nativeStorage.getItems === 'function') ||
        (typeof window.electronNative.getZoomLevel === 'function' &&
          window.electronNative.wcvBrowser &&
          typeof window.electronNative.wcvBrowser.setThemeColor === 'function'))
    );
  };

  const isAntigravityHost = () => {
    if (isPreloadHost()) return true;
    return !!(
      typeof document !== 'undefined' &&
      typeof document.querySelector === 'function' &&
      document.querySelector(
        'link[href*="/jetbox.css"], body[data-agy-theme], body[data-newux-theme], [id="antigravity.agentSidePanelInputBox"]'
      )
    );
  };

  const scheduleBootOnDcl = () => {
    if (typeof window.addEventListener !== 'function') return;
    window.__ag_boot_dcl_handler = () => {
      window.__ag_boot_dcl_handler = null;
      runBoot(boot, true);
    };
    window.addEventListener('DOMContentLoaded', window.__ag_boot_dcl_handler, { once: true });
  };

  if (typeof document === 'undefined' || !document.documentElement) {
    if (typeof document !== 'undefined') {
      if (isPreloadHost() && typeof MutationObserver === 'function') {
        try {
          const obs = new MutationObserver(() => {
            if (document.documentElement) {
              try {
                obs.disconnect();
              } catch {}
              window.__ag_boot_doc_observer = null;
              runBoot(boot, false);
            }
          });
          window.__ag_boot_doc_observer = obs;
          obs.observe(document, { childList: true });
        } catch {}
      }
      if (!fromDcl && document.readyState === 'loading') {
        scheduleBootOnDcl();
      }
    }
    return;
  }

  if (!isAntigravityHost()) {
    if (!fromDcl && document.readyState === 'loading') {
      scheduleBootOnDcl();
      return;
    }
    window.__ag_skip_non_host = true;
    return;
  }

  if (window.__ag_skip_non_host) {
    try {
      delete window.__ag_skip_non_host;
    } catch {
      window.__ag_skip_non_host = false;
    }
  }

  const PATCH_VERSION = boot.version || 'anti-claude-core';
  const DETECTED_OS =
    boot.platform || (/Win/i.test(navigator.platform || '') ? 'win32' : /Mac/i.test(navigator.platform || '') ? 'darwin' : 'linux');
  const ENABLED = boot.enabled !== false;
  const CSS_TEXT = boot.cssText || '';
  const CUSTOM_CSS_TEXT = boot.customCss || '';
  const THEME_VARS = boot.themeVars && typeof boot.themeVars === 'object' ? boot.themeVars : {};
  const DARK_THEME_VARS = boot.darkThemeVars && typeof boot.darkThemeVars === 'object' ? boot.darkThemeVars : {};
  const DICT = boot.dict && typeof boot.dict === 'object' ? boot.dict : {};
  const MODULES = Object.assign(
    {
      i18n: false,
      metrics: true,
      zoomShortcuts: true,
      customCss: true,
      customJs: true
    },
    boot.modules || {}
  );
  const SELECTORS = Object.assign(
    {
      inputBoxId: 'antigravity.agentSidePanelInputBox',
      homeGreeting: '[data-testid="home-greeting"], [data-testid="home-splash-content"]'
    },
    boot.config && typeof boot.config.selectors === 'object' ? boot.config.selectors : {},
    boot.selectors || {}
  );
  const RPC_TOKEN = typeof boot.rpcToken === 'string' ? boot.rpcToken : '';
  const RPC_SESSION_ID = typeof boot.rpcSessionId === 'string' ? boot.rpcSessionId : '';

  /* Run previous cleanup callbacks before hot-reloading or tearing down */
  if (Array.isArray(window.__ag_cleanup_fns) && window.__ag_cleanup_fns.length > 0) {
    const prevCleanups = window.__ag_cleanup_fns.splice(0, window.__ag_cleanup_fns.length);
    for (let i = 0; i < prevCleanups.length; i++) {
      try {
        if (typeof prevCleanups[i] === 'function') prevCleanups[i]();
      } catch {}
    }
  }
  window.__ag_cleanup_fns = [];
  let runtimeDisposed = false;
  window.__ag_cleanup_fns.push(() => {
    runtimeDisposed = true;
    window.__ag_rpc_session_id = '';
  });

  if (window.__ag_dcl_handler) {
    try {
      window.removeEventListener('DOMContentLoaded', window.__ag_dcl_handler);
    } catch {}
    window.__ag_dcl_handler = null;
  }
  if (window.__ag_doc_body_observer) {
    try {
      window.__ag_doc_body_observer.disconnect();
    } catch {}
    window.__ag_doc_body_observer = null;
  }
  if (window.__ag_theme_mode_observer) {
    try {
      window.__ag_theme_mode_observer.disconnect();
    } catch {}
    window.__ag_theme_mode_observer = null;
  }
  if (window.__ag_mql_cleanup) {
    try {
      window.__ag_mql_cleanup();
    } catch {}
    window.__ag_mql_cleanup = null;
  }
  if (window.__ag_metrics_raf) {
    try {
      cancelAnimationFrame(window.__ag_metrics_raf);
    } catch {}
    window.__ag_metrics_raf = 0;
  }
  if (window.__ag_metrics_ro) {
    try {
      window.__ag_metrics_ro.disconnect();
    } catch {}
    window.__ag_metrics_ro = null;
    window.__ag_metrics_ro_target = null;
    window.__ag_metrics_ro_observed = null;
    window.__ag_last_metrics_layout_sig = '';
  }
  if (window.__ag_metrics_route_watcher) {
    try {
      clearInterval(window.__ag_metrics_route_watcher);
    } catch {}
    window.__ag_metrics_route_watcher = null;
  }
  if (window.__ag_zoom_keydown_fn) {
    try {
      window.removeEventListener('keydown', window.__ag_zoom_keydown_fn, true);
    } catch {}
    window.__ag_zoom_keydown_fn = null;
  }
  window.__ag_check_route_fn = null;
  window.__ag_render_metrics = null;
  window.__ag_ensure_metrics_pill_fn = null;
  window.__ag_sync_preset_fn = null;
  window.__ag_set_host_theme_mode = null;
  window.__agProjectCall = null;
  window.__ag_project_rpc_resolve = null;
  window.__ag_custom_js_mounted = false;

  if (!window.__ag_orig_text_map) {
    window.__ag_orig_text_map = new WeakMap();
  }
  window.__ag_i18n_dict = DICT;

  function restoreAllTranslations(root = document.body) {
    if (!root) return;
    const origTextMap = window.__ag_orig_text_map;
    try {
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
      while (walker.nextNode()) {
        const node = walker.currentNode;
        const rec = origTextMap.get(node);
        if (rec) {
          if (node.nodeValue === rec.lastVal) {
            node.nodeValue = rec.origRaw;
          }
          origTextMap.delete(node);
        }
      }
      const attrNames = ['title', 'placeholder', 'aria-label'];
      const attrEls = root.querySelectorAll
        ? root.querySelectorAll(
            '[data-ag-orig-title], [data-ag-orig-title-last], [data-ag-orig-placeholder], [data-ag-orig-placeholder-last], [data-ag-orig-aria-label], [data-ag-orig-aria-label-last]'
          )
        : [];
      for (let i = 0; i < attrEls.length; i++) {
        const el = attrEls[i];
        for (let j = 0; j < attrNames.length; j++) {
          const attr = attrNames[j];
          const origAttr = 'data-ag-orig-' + attr;
          const lastAttr = origAttr + '-last';
          if (el.hasAttribute(origAttr) || el.hasAttribute(lastAttr)) {
            const savedOrig = el.getAttribute(origAttr);
            const savedLast = el.getAttribute(lastAttr);
            const cur = el.getAttribute(attr);
            if (savedOrig !== null && (savedLast === null || cur === savedLast)) {
              el.setAttribute(attr, savedOrig);
            }
            el.removeAttribute(origAttr);
            el.removeAttribute(lastAttr);
          }
        }
      }
    } catch {}
  }

  function applyThemeVars(varsObj, darkVarsObj = {}) {
    const keys = Object.keys(varsObj || {});
    const globalDecls = [];
    const lightDecls = [];
    const darkDecls = [];

    for (let i = 0; i < keys.length; i++) {
      const k = keys[i];
      const v = varsObj[k];
      if (!k.startsWith('--') || v === null || v === undefined || String(v).trim() === '') continue;
      const cleanVal = String(v).trim().replace(/[;{}]/g, '');
      if (k.startsWith('--ag-dark-')) {
        darkDecls.push(`${k}: ${cleanVal} !important;`);
      } else if (k.startsWith('--ag-')) {
        globalDecls.push(`${k}: ${cleanVal} !important;`);
      } else {
        lightDecls.push(`${k}: ${cleanVal} !important;`);
      }
    }
    const darkKeys = Object.keys(darkVarsObj || {});
    for (let i = 0; i < darkKeys.length; i++) {
      const k = darkKeys[i];
      const v = darkVarsObj[k];
      if (!k.startsWith('--') || v === null || v === undefined || String(v).trim() === '') continue;
      const cleanVal = String(v).trim().replace(/[;{}]/g, '');
      darkDecls.push(`${k}: ${cleanVal} !important;`);
    }

    let varStyle = document.getElementById('ag-user-theme-vars');
    if (globalDecls.length === 0 && lightDecls.length === 0 && darkDecls.length === 0) {
      if (varStyle) varStyle.remove();
    } else {
      const head = document.head || document.getElementsByTagName('head')[0] || document.documentElement;
      if (!varStyle) {
        varStyle = document.createElement('style');
        varStyle.id = 'ag-user-theme-vars';
      }
      if (head) {
        const customStyleEl = document.getElementById('antigravity-user-custom-style');
        if (customStyleEl && customStyleEl.parentNode === head) {
          head.insertBefore(varStyle, customStyleEl);
        } else if (varStyle.parentNode !== head) {
          head.appendChild(varStyle);
        }
      }
      const blocks = [];
      if (globalDecls.length > 0) {
        blocks.push(`:root, html[data-ag-os]:not([data-ag-disabled]), html[data-ag-os]:not([data-ag-disabled]) body { ${globalDecls.join(' ')} }`);
      }
      if (lightDecls.length > 0) {
        blocks.push(
          `html[data-ag-os]:not([data-ag-theme-mode="dark"]):not(:has(> body.dark)), html[data-ag-os]:not([data-ag-theme-mode="dark"]) body:not(.dark) { ${lightDecls.join(' ')} }`
        );
      }
      if (darkDecls.length > 0) {
        blocks.push(
          `html[data-ag-os][data-ag-theme-mode="dark"], html[data-ag-os][data-ag-theme-mode="dark"] body, html[data-ag-os]:has(> body.dark), html[data-ag-os] body.dark { ${darkDecls.join(' ')} }`
        );
      }
      const nextCss = blocks.join('\n');
      if (varStyle.textContent !== nextCss) varStyle.textContent = nextCss;
    }

    if (varsObj && varsObj['--ag-chat-font-size']) {
      document.documentElement.setAttribute('data-ag-custom-font-size', 'true');
    } else {
      document.documentElement.removeAttribute('data-ag-custom-font-size');
    }
  }

  function syncNativeWindowChrome(isDark) {
    if (IS_SWARM_PLUGIN_FRAME) return;
    try {
      const bgHex = isDark ? '#212120' : '#FFFFFF';
      const sidebarHex = isDark ? '#191918' : '#F9F9F8';
      const fgHex = isDark ? '#FAF9F5' : '#141413';
      const setThemeColor = window.electronNative?.wcvBrowser?.setThemeColor;
      if (typeof setThemeColor === 'function' && window.__ag_last_curtain_hex !== bgHex) {
        window.__ag_last_curtain_hex = bgHex;
        Promise.resolve(setThemeColor(bgHex)).catch(() => {});
      }
      if (DETECTED_OS === 'win32' && typeof window.electronNative?.setTitleBarOverlay === 'function') {
        const sig = `${sidebarHex}|${fgHex}`;
        if (window.__ag_last_overlay_sig !== sig) {
          window.__ag_last_overlay_sig = sig;
          Promise.resolve(window.electronNative.setTitleBarOverlay({ color: sidebarHex, symbolColor: fgHex })).catch(() => {});
        }
      }
    } catch {}
  }

  /* Lossless teardown when user/config.json sets enabled: false */
  if (!ENABLED) {
    runtimeDisposed = true;
    window.__ag_rpc_session_id = '';
    window.__ag_watched_cascade_id = '';
    for (const id of ['ag-custom-fonts', 'ag-user-theme-vars', 'antigravity-user-custom-style', 'ag-live-metrics-pill', 'ag-live-metrics-tooltip']) {
      const el = document.getElementById(id);
      if (el) el.remove();
    }
    applyThemeVars({}, {});
    for (const attr of ['data-ag-theme-mode', 'data-ag-page-type', 'data-ag-os', 'data-ag-ux-lang', 'data-ag-custom-font-size', 'data-ag-cjk-scale']) {
      document.documentElement.removeAttribute(attr);
    }
    if (document.body) restoreAllTranslations(document.body);
    window.__ag_resolved_theme_mode = null;
    return null;
  }

  document.documentElement.setAttribute('data-ag-os', DETECTED_OS);

  /* Ensure <style> tags stay at the end of <head> after native CSS links */
  function ensureStylesMounted() {
    const head = document.head || document.getElementsByTagName('head')[0] || document.documentElement;
    if (!head) return;

    let baseStyle = document.getElementById('ag-custom-fonts');
    if (!baseStyle) {
      baseStyle = document.createElement('style');
      baseStyle.id = 'ag-custom-fonts';
    }
    if (baseStyle.textContent !== CSS_TEXT) {
      baseStyle.textContent = CSS_TEXT;
    }
    if (baseStyle.parentNode !== head) {
      head.appendChild(baseStyle);
    }

    applyThemeVars(THEME_VARS, DARK_THEME_VARS);

    let customStyle = document.getElementById('antigravity-user-custom-style');
    if (MODULES.customCss && CUSTOM_CSS_TEXT) {
      if (!customStyle) {
        customStyle = document.createElement('style');
        customStyle.id = 'antigravity-user-custom-style';
      }
      if (customStyle.textContent !== CUSTOM_CSS_TEXT) {
        customStyle.textContent = CUSTOM_CSS_TEXT;
      }
      if (customStyle.parentNode !== head || head.lastElementChild !== customStyle) {
        head.appendChild(customStyle);
      }
    } else if (customStyle) {
      customStyle.remove();
    }
  }

  ensureStylesMounted();

  /* Resolve Light / Dark mode and sync across main window + swarm plugin iframes */
  function detectHostDarkMode() {
    if (IS_SWARM_PLUGIN_FRAME && (window.__ag_host_theme_mode === 'dark' || window.__ag_host_theme_mode === 'light')) {
      return window.__ag_host_theme_mode === 'dark';
    }
    const hEl = document.documentElement;
    const bEl = document.body;
    if (bEl) {
      if (bEl.classList.contains('dark') || bEl.classList.contains('theme-dark') || bEl.classList.contains('dark-theme')) {
        return true;
      }
      if (bEl.classList.contains('light') || bEl.classList.contains('theme-light') || bEl.classList.contains('light-theme')) {
        return false;
      }
      const agyTheme = (bEl.getAttribute('data-agy-theme') || bEl.getAttribute('data-newux-theme') || '').toLowerCase();
      if (agyTheme.includes('dark') || agyTheme.includes('onyx') || agyTheme.includes('night')) return true;
      if (agyTheme.includes('light') || agyTheme.includes('day')) return false;
    }
    if (hEl) {
      const dt = (hEl.getAttribute('data-theme') || '').toLowerCase();
      if (dt === 'dark') return true;
      if (dt === 'light') return false;
      if (hEl.classList.contains('dark')) return true;
    }
    if (typeof boot.hostThemeMode === 'string' && (boot.hostThemeMode === 'dark' || boot.hostThemeMode === 'light')) {
      return boot.hostThemeMode === 'dark';
    }
    return !!(typeof window.matchMedia === 'function' && window.matchMedia('(prefers-color-scheme: dark)').matches);
  }

  function syncThemeMode() {
    const isDark = detectHostDarkMode();
    const mode = isDark ? 'dark' : 'light';
    window.__ag_resolved_theme_mode = mode;
    if (document.documentElement.getAttribute('data-ag-theme-mode') !== mode) {
      document.documentElement.setAttribute('data-ag-theme-mode', mode);
    }
    if (IS_SWARM_PLUGIN_FRAME) {
      if (document.documentElement.getAttribute('data-theme') !== mode) {
        document.documentElement.setAttribute('data-theme', mode);
      }
      document.documentElement.style.setProperty('color-scheme', mode);
    } else {
      syncNativeWindowChrome(isDark);
      if (typeof window.__agSyncHostThemeMode === 'function' && window.__ag_last_synced_host_mode !== mode) {
        window.__ag_last_synced_host_mode = mode;
        try {
          window.__agSyncHostThemeMode(mode);
        } catch {}
      }
    }
    return mode;
  }

  window.__ag_sync_preset_fn = syncThemeMode;
  if (IS_SWARM_PLUGIN_FRAME) {
    if (boot.hostThemeMode === 'dark' || boot.hostThemeMode === 'light') {
      window.__ag_host_theme_mode = boot.hostThemeMode;
    }
    window.__ag_set_host_theme_mode = (mode) => {
      if (mode === 'dark' || mode === 'light') {
        window.__ag_host_theme_mode = mode;
        syncThemeMode();
      }
    };
  }

  syncThemeMode();

  if (typeof MutationObserver === 'function') {
    const modeObs = new MutationObserver(() => syncThemeMode());
    modeObs.observe(document.documentElement, { attributes: true, attributeFilter: ['class', 'data-theme'] });
    if (document.body) {
      modeObs.observe(document.body, { attributes: true, attributeFilter: ['class', 'data-agy-theme', 'data-newux-theme'] });
    }
    window.__ag_theme_mode_observer = modeObs;
  }
  if (typeof window.matchMedia === 'function') {
    try {
      const mql = window.matchMedia('(prefers-color-scheme: dark)');
      const onChange = () => syncThemeMode();
      mql.addEventListener('change', onChange);
      window.__ag_mql_cleanup = () => mql.removeEventListener('change', onChange);
    } catch {}
  }

  /* Optional zoom shortcuts (Cmd/Ctrl + =, -, 0) */
  if (!IS_SWARM_PLUGIN_FRAME && MODULES.zoomShortcuts !== false && window.electronNative) {
    const onZoomKey = (ev) => {
      const mod = DETECTED_OS === 'darwin' ? ev.metaKey && !ev.ctrlKey : ev.ctrlKey && !ev.metaKey;
      if (!mod || ev.altKey) return;
      const en = window.electronNative;
      if (!en || typeof en.getZoomLevel !== 'function' || typeof en.setZoomLevel !== 'function') return;
      if (ev.key === '=' || ev.key === '+') {
        ev.preventDefault();
        Promise.resolve(en.getZoomLevel()).then((z) => en.setZoomLevel(Math.min(5, (Number(z) || 0) + 0.5))).catch(() => {});
      } else if (ev.key === '-' || ev.key === '_') {
        ev.preventDefault();
        Promise.resolve(en.getZoomLevel()).then((z) => en.setZoomLevel(Math.max(-3, (Number(z) || 0) - 0.5))).catch(() => {});
      } else if (ev.key === '0') {
        ev.preventDefault();
        Promise.resolve(en.setZoomLevel(0)).catch(() => {});
      }
    };
    window.__ag_zoom_keydown_fn = onZoomKey;
    window.addEventListener('keydown', onZoomKey, true);
  }

  /* Composer live metrics pill (#ag-live-metrics-pill) & route observer */
  const MIDDLE_ENTER_BOTTOM_PX = 165;
  const MIDDLE_EXIT_BOTTOM_PX = 180;

  function extractCascadeId() {
    try {
      const m = window.location.pathname.match(/\/c\/([0-9a-f-]{36})/i);
      if (m) return m[1];
      const q = new URLSearchParams(window.location.search).get('cascadeId');
      if (q && /^[0-9a-f-]{36}$/i.test(q)) return q;
      const selected = document.querySelector('[data-testid="conversation-row-sidebar"][data-selected="true"]');
      if (selected) {
        const cid = selected.getAttribute('data-cascade-id');
        if (cid && /^[0-9a-f-]{36}$/i.test(cid)) return cid;
      }
    } catch {}
    return '';
  }

  function ensureMetricsTooltip() {
    let tt = document.getElementById('ag-live-metrics-tooltip');
    if (!tt && document.body) {
      tt = document.createElement('div');
      tt.id = 'ag-live-metrics-tooltip';
      document.body.appendChild(tt);
    } else if (tt && tt.parentElement !== document.body && document.body) {
      document.body.appendChild(tt);
    }
    return tt;
  }

  function findFooterRow(box) {
    if (!box) return null;
    const directFooter = box.querySelector('.agy-composer-footer');
    if (directFooter && directFooter.children.length >= 2) return directFooter;
    const rows = box.querySelectorAll('div.flex.w-full.items-center.justify-between');
    for (let i = rows.length - 1; i >= 0; i--) {
      const r = rows[i];
      if (r.getAttribute('data-testid') === 'input-box-bottom-toolbar') continue;
      if (r.querySelector('[data-testid="model-selector-trigger"], [data-testid="send-button"]')) return r;
    }
    for (let i = rows.length - 1; i >= 0; i--) {
      const r = rows[i];
      if (r.getAttribute('data-testid') !== 'input-box-bottom-toolbar') return r;
    }
    return directFooter || null;
  }

  function measureNaturalLeftWidth(leftGroup) {
    let w = 0;
    for (let i = 0; i < leftGroup.children.length; i++) {
      const ch = leftGroup.children[i];
      if (ch.id === 'ag-live-metrics-pill') continue;
      const cw = Math.max(ch.offsetWidth || 0, ch.scrollWidth || 0);
      if (cw > 0) w += cw;
    }
    return w;
  }

  function syncMetricsResizeObserver(bottomRow, leftGroup, rightGroup) {
    if (typeof ResizeObserver === 'undefined' || !bottomRow) return;
    if (window.__ag_metrics_ro_target !== bottomRow) {
      if (window.__ag_metrics_ro) {
        try {
          window.__ag_metrics_ro.disconnect();
        } catch {}
      }
      window.__ag_metrics_ro_target = bottomRow;
      window.__ag_metrics_ro_observed = new WeakSet();
      window.__ag_last_metrics_layout_sig = '';
      window.__ag_metrics_ro = new ResizeObserver(() => {
        if (runtimeDisposed || !ENABLED || window.__ag_metrics_raf) return;
        window.__ag_metrics_raf = requestAnimationFrame(() => {
          window.__ag_metrics_raf = 0;
          if (runtimeDisposed || !ENABLED) return;
          const curBox = document.getElementById(SELECTORS.inputBoxId);
          const curBottom = findFooterRow(curBox);
          if (!curBottom || !curBottom.children[0]) return;
          const curLeft = curBottom.children[0];
          const curRight = curBottom.children[1] || null;
          const rw = curBottom.clientWidth || 0;
          if (rw <= 0) return;
          const lw = measureNaturalLeftWidth(curLeft);
          const rgw = curRight ? curRight.offsetWidth || 0 : 0;
          const sig = rw + ':' + lw + ':' + rgw;
          if (sig !== window.__ag_last_metrics_layout_sig && typeof window.__ag_ensure_metrics_pill_fn === 'function') {
            window.__ag_ensure_metrics_pill_fn(true);
          }
        });
      });
    }
    const ro = window.__ag_metrics_ro;
    const seen = window.__ag_metrics_ro_observed;
    if (!ro || !seen) return;
    const observeOnce = (el) => {
      if (el && el.nodeType === 1 && !seen.has(el)) {
        seen.add(el);
        try {
          ro.observe(el);
        } catch {}
      }
    };
    observeOnce(bottomRow);
    if (rightGroup) observeOnce(rightGroup);
    if (leftGroup) {
      for (let i = 0; i < leftGroup.children.length; i++) {
        const ch = leftGroup.children[i];
        if (ch.id !== 'ag-live-metrics-pill') observeOnce(ch);
      }
    }
  }

  function ensureMetricsPill(forceLayout = false, resetHysteresis = false) {
    if (runtimeDisposed || !ENABLED) return null;
    if (!MODULES.metrics) {
      const existing = document.getElementById('ag-live-metrics-pill');
      if (existing) existing.style.display = 'none';
      return null;
    }
    const box = document.getElementById(SELECTORS.inputBoxId);
    if (!box) return null;
    const bottomRow = findFooterRow(box);
    if (!bottomRow || !bottomRow.children[0]) return null;
    const leftGroup = bottomRow.children[0];
    const rightGroup = bottomRow.children[1] || null;

    let pill = document.getElementById('ag-live-metrics-pill');
    let isNewPill = false;
    if (!pill) {
      isNewPill = true;
      pill = document.createElement('div');
      pill.id = 'ag-live-metrics-pill';
      pill.innerHTML = '<span id="ag-live-metrics-text"></span>';
      pill.addEventListener('mouseenter', () => {
        const tt = ensureMetricsTooltip();
        if (!tt || !tt.innerHTML) return;
        const r = pill.getBoundingClientRect();
        const ttWidth = Math.min(440, Math.max(370, tt.offsetWidth || 400));
        const left = Math.max(12, Math.min(r.left, window.innerWidth - ttWidth - 16));
        const bottomPx = Math.min(window.innerHeight - r.top + 8, window.innerHeight - (tt.offsetHeight || 220) - 12);
        tt.style.left = left + 'px';
        tt.style.bottom = Math.max(8, bottomPx) + 'px';
        tt.setAttribute('data-visible', '1');
      });
      pill.addEventListener('mouseleave', () => {
        const tt = document.getElementById('ag-live-metrics-tooltip');
        if (tt) tt.removeAttribute('data-visible');
      });
    }

    syncMetricsResizeObserver(bottomRow, leftGroup, rightGroup);

    const isMountedHere =
      pill.parentElement === leftGroup || (bottomRow.parentElement && pill.parentElement === bottomRow.parentElement);
    if (
      !forceLayout &&
      !isNewPill &&
      isMountedHere &&
      window.__ag_last_metrics_layout_sig &&
      window.__ag_metrics_ro_target === bottomRow
    ) {
      return pill;
    }

    const rowW = bottomRow.clientWidth || 0;
    if (rowW <= 0) {
      if (!pill.parentElement) leftGroup.appendChild(pill);
      return pill;
    }
    const leftW = measureNaturalLeftWidth(leftGroup);
    const rightW = rightGroup ? rightGroup.offsetWidth || 0 : 0;
    const curLayoutSig = rowW + ':' + leftW + ':' + rightW;
    if (!forceLayout && !isNewPill && isMountedHere && window.__ag_last_metrics_layout_sig === curLayoutSig) {
      return pill;
    }

    window.__ag_last_metrics_layout_sig = curLayoutSig;
    const availMiddleW = rowW - leftW - rightW - 8;
    const prevMode = resetHysteresis ? 'middle' : pill.getAttribute('data-ag-row-mode') || 'middle';
    const useBottomRow =
      prevMode === 'bottom' ? availMiddleW < MIDDLE_EXIT_BOTTOM_PX : availMiddleW < MIDDLE_ENTER_BOTTOM_PX;
    const rowMode = useBottomRow ? 'bottom' : 'middle';

    if (bottomRow.getAttribute('data-ag-row-mode') !== rowMode) {
      bottomRow.setAttribute('data-ag-row-mode', rowMode);
    }
    if (pill.getAttribute('data-ag-row-mode') !== rowMode) {
      pill.setAttribute('data-ag-row-mode', rowMode);
    }

    if (useBottomRow) {
      const cardParent = bottomRow.parentElement;
      if (cardParent && (pill.parentElement !== cardParent || pill.previousElementSibling !== bottomRow)) {
        bottomRow.after(pill);
      }
    } else if (pill.parentElement !== leftGroup) {
      leftGroup.appendChild(pill);
    }

    return pill;
  }

  window.__ag_ensure_metrics_pill_fn = ensureMetricsPill;

  window.__ag_render_metrics = function (payload) {
    try {
      if (runtimeDisposed || !ENABLED || !MODULES.metrics) return;
      window.__ag_last_metrics = payload;
      const currentId = extractCascadeId();
      const pill = ensureMetricsPill(false);
      const ttEl = ensureMetricsTooltip();
      if (!pill) return;
      if (!currentId || !payload || !payload.hasData || payload.cascadeId !== currentId) {
        if (pill.style.display !== 'none') pill.style.display = 'none';
        if (ttEl) ttEl.removeAttribute('data-visible');
        return;
      }
      const textEl = pill.querySelector('#ag-live-metrics-text');
      if (textEl && textEl.innerHTML !== payload.inlineHtml) {
        textEl.innerHTML = payload.inlineHtml;
      }
      if (ttEl && ttEl.innerHTML !== payload.tooltipHtml) {
        ttEl.innerHTML = payload.tooltipHtml;
      }
      if (pill.style.display !== 'inline-flex') {
        pill.style.display = 'inline-flex';
        ensureMetricsPill(true);
      }
    } catch {}
  };

  function checkRouteAndMountMetrics() {
    try {
      if (runtimeDisposed || !ENABLED) return;
      if (IS_SWARM_PLUGIN_FRAME) {
        if (document.documentElement.getAttribute('data-ag-page-type') !== 'plugin') {
          document.documentElement.setAttribute('data-ag-page-type', 'plugin');
        }
        return;
      }
      if (document.hidden) return;
      const pathname = window.location.pathname;
      const isChatRoute = pathname.startsWith('/c/');
      const cid = extractCascadeId();
      const isHome = pathname === '/' || (!isChatRoute && !cid) || (!isChatRoute && !!document.querySelector(SELECTORS.homeGreeting));
      const pageType = isHome ? 'home' : 'chat';
      if (document.documentElement.getAttribute('data-ag-page-type') !== pageType) {
        document.documentElement.setAttribute('data-ag-page-type', pageType);
      }

      if (!MODULES.metrics) {
        const existing = document.getElementById('ag-live-metrics-pill');
        if (existing) existing.style.display = 'none';
        return;
      }

      if (!cid) {
        window.__ag_watched_cascade_id = '';
        const pill = document.getElementById('ag-live-metrics-pill');
        if (pill && pill.style.display !== 'none') pill.style.display = 'none';
        const ttEl = document.getElementById('ag-live-metrics-tooltip');
        if (ttEl) ttEl.removeAttribute('data-visible');
        return;
      }

      if (cid !== window.__ag_watched_cascade_id) {
        window.__ag_watched_cascade_id = cid;
        window.__ag_last_metrics_layout_sig = '';
        const pill = ensureMetricsPill(true, true);
        if (pill && (!window.__ag_last_metrics || window.__ag_last_metrics.cascadeId !== cid)) {
          pill.style.display = 'none';
        }
        if (typeof window.__agRequestMetrics === 'function') {
          try {
            window.__agRequestMetrics(cid);
          } catch {}
        }
      } else if (window.__ag_last_metrics && window.__ag_last_metrics.cascadeId === cid) {
        const pill = ensureMetricsPill(false);
        if (pill && window.__ag_last_metrics.hasData && pill.style.display === 'none') {
          window.__ag_render_metrics(window.__ag_last_metrics);
        }
      }
    } catch {}
  }

  if (!IS_SWARM_PLUGIN_FRAME && !window.__ag_history_hook_installed) {
    window.__ag_history_hook_installed = true;
    const triggerRouteCheck = () => {
      requestAnimationFrame(() => {
        setTimeout(() => {
          if (typeof window.__ag_check_route_fn === 'function') window.__ag_check_route_fn();
        }, 0);
      });
      setTimeout(() => {
        if (typeof window.__ag_check_route_fn === 'function') window.__ag_check_route_fn();
      }, 120);
    };
    for (const type of ['pushState', 'replaceState']) {
      const orig = history[type];
      if (typeof orig === 'function') {
        history[type] = function (...args) {
          const ret = orig.apply(this, args);
          triggerRouteCheck();
          return ret;
        };
      }
    }
    window.addEventListener('popstate', triggerRouteCheck);
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden && typeof window.__ag_check_route_fn === 'function') {
        window.__ag_check_route_fn();
      }
    });
  }

  window.__ag_check_route_fn = checkRouteAndMountMetrics;
  if (!IS_SWARM_PLUGIN_FRAME) {
    window.__ag_metrics_route_watcher = setInterval(checkRouteAndMountMetrics, 3000);
  }
  if (document.body || IS_SWARM_PLUGIN_FRAME) {
    checkRouteAndMountMetrics();
  }

  /* Handle early NewDocument injection when document.body is not yet created */
  if (!document.body) {
    const onRuntimeBodyReady = () => {
      if (runtimeDisposed || !ENABLED || !document.body) return;
      if (window.__ag_dcl_handler) {
        try {
          window.removeEventListener('DOMContentLoaded', window.__ag_dcl_handler);
        } catch {}
        window.__ag_dcl_handler = null;
      }
      if (window.__ag_doc_body_observer) {
        try {
          window.__ag_doc_body_observer.disconnect();
        } catch {}
        window.__ag_doc_body_observer = null;
      }
      ensureStylesMounted();
      if (document.body && window.__ag_theme_mode_observer) {
        try {
          window.__ag_theme_mode_observer.observe(document.body, {
            attributes: true,
            attributeFilter: ['class', 'data-agy-theme', 'data-newux-theme']
          });
        } catch {}
      }
      syncThemeMode();
      checkRouteAndMountMetrics();
    };
    window.__ag_dcl_handler = onRuntimeBodyReady;
    window.addEventListener('DOMContentLoaded', onRuntimeBodyReady, { once: true });
    if (typeof MutationObserver === 'function' && document.documentElement) {
      const docObs = new MutationObserver(() => {
        if (document.body) onRuntimeBodyReady();
      });
      docObs.observe(document.documentElement, { childList: true });
      window.__ag_doc_body_observer = docObs;
    }
  }

  /* Local project context RPC bridge (via daemon CDP binding __agProjectRpc) */
  if (!IS_SWARM_PLUGIN_FRAME) {
    window.__ag_rpc_session_id = RPC_SESSION_ID;
    if (!(window.__ag_project_rpc_pending instanceof Map)) {
      window.__ag_project_rpc_pending = new Map();
    }
    let rpcSeq = window.__ag_project_rpc_seq || 0;
    window.__ag_project_rpc_resolve = (reqId, result) => {
      const pending = window.__ag_project_rpc_pending.get(reqId);
      if (!pending) return;
      window.__ag_project_rpc_pending.delete(reqId);
      clearTimeout(pending.timer);
      pending.resolve(result);
    };
    window.__agProjectCall = (action, payload = {}, timeoutMs = 125000) => {
      if (runtimeDisposed || !ENABLED || typeof window.__agProjectRpc !== 'function') {
        return Promise.resolve({ ok: false, error: 'rpc_unavailable' });
      }
      const reqId = `prpc_${Date.now()}_${++rpcSeq}`;
      window.__ag_project_rpc_seq = rpcSeq;
      return new Promise((resolve) => {
        const timer = setTimeout(() => {
          window.__ag_project_rpc_pending.delete(reqId);
          resolve({ ok: false, error: 'rpc_timeout' });
        }, timeoutMs);
        window.__ag_project_rpc_pending.set(reqId, { resolve, timer });
        try {
          window.__agProjectRpc(JSON.stringify({ reqId, action, payload, token: RPC_TOKEN }));
        } catch (err) {
          clearTimeout(timer);
          window.__ag_project_rpc_pending.delete(reqId);
          resolve({ ok: false, error: String(err?.message || err) });
        }
      });
    };
  }

  /* Execute user/custom.js with unified ctx */
  window.__AG_PATCH_CTX__ = {
    version: PATCH_VERSION,
    config: boot.config || {},
    modules: MODULES,
    features: MODULES,
    themeVars: THEME_VARS,
    darkThemeVars: DARK_THEME_VARS,
    dict: DICT,
    get metrics() {
      return window.__ag_last_metrics || null;
    },
    syncPreset: syncThemeMode,
    ensureMetricsPill,
    onCleanup(fn) {
      if (typeof fn === 'function') {
        window.__ag_cleanup_fns.push(fn);
      }
    }
  };

  if (MODULES.customJs && boot.customJs && typeof boot.customJs === 'string' && boot.customJs.trim()) {
    try {
      const fn = new Function('ctx', 'boot', boot.customJs);
      fn(window.__AG_PATCH_CTX__, window.__AG_PATCH_CTX__);
    } catch (err) {
      console.error('[Anti-Claude] Error in user/custom.js:', err);
    }
  }
  if (!IS_SWARM_PLUGIN_FRAME) {
    return window.__ag_resolved_theme_mode || null;
  }
})(__AG_BOOT_PAYLOAD__);
