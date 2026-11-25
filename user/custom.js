/**
 * Anti-Claude — user/custom.js
 * Non-invasive runtime UX extension for Google Antigravity Desktop 2.0:
 * 1. Unfolds outer `worked-for-collapsible` end-of-turn wrapper so interleaved narration & tool summaries stay inline.
 * 2. Adds smooth 190ms collapse transition when React unmounts finished `tool-group-collapsible` panels.
 * 3. Attaches orbiting official-blue dots + live `1s / 2s...` elapsed timer exclusively to the actively executing step row.
 *
 * Feature switches (user/config.json -> "modules", all default true):
 *   claudeUxStepUnfold, claudeUxCollapseAnimation, claudeUxRunningTimer,
 *   claudeUxContextRing, claudeUxModelMenu
 */
(function () {
  const CFG_ROOT = (typeof ctx !== 'undefined' && ctx && (ctx.config || ctx)) || {};
  const MODS =
    (typeof ctx !== 'undefined' && ctx && (ctx.modules || (ctx.config && ctx.config.modules))) || {};
  const CFG_UI_STATE =
    CFG_ROOT.uiState && typeof CFG_ROOT.uiState === 'object' && !Array.isArray(CFG_ROOT.uiState)
      ? CFG_ROOT.uiState
      : {};
  const cfgUiPrefsTs = Number(CFG_ROOT.uiPrefsUpdatedAt) > 0 ? Number(CFG_ROOT.uiPrefsUpdatedAt) : 0;
  const MODULE_STORAGE_KEY = 'ag_claude_ux_modules_v1';
  const VALID_CJK_SCALES = ['94.5', '95', '100'];
  const FONT_SLOT_KEYS = ['global', 'main', 'overview', 'mono'];
  const CUSTOM_FONT_STYLE_ID = 'ag-custom-font-overrides';
  function normalizeCjkScale(v) {
    const s = String(v == null ? '' : v).trim().replace(/%$/, '');
    return VALID_CJK_SCALES.includes(s) ? s : null;
  }
  function normalizeChatOffsetX(v) {
    if (v === '' || v == null) return 0;
    const n = Number(String(v).trim().replace(/px$/i, ''));
    if (!Number.isFinite(n)) return 0;
    return Math.max(-800, Math.min(800, Math.round(n)));
  }
  function sanitizeFontFamilyInput(raw) {
    let s = String(raw == null ? '' : raw).replace(/[\r\n]/g, ' ').trim();
    if (!s) return '';
    const kvMatch = s.match(/^(?:"?editor\.fontFamily"?|font-family)\s*:\s*(.+?)\s*,?;?$/i);
    if (kvMatch) {
      s = kvMatch[1].trim();
      if (s.length >= 2 && s.startsWith('"') && s.endsWith('"')) {
        s = s.slice(1, -1).trim();
      }
    }
    return s.replace(/[;{}<>]/g, '').trim().slice(0, 512);
  }
  function resolveInitialFonts(localOverridesObj, cfgRootObj) {
    const localFonts =
      localOverridesObj && localOverridesObj.fonts && typeof localOverridesObj.fonts === 'object'
        ? localOverridesObj.fonts
        : {};
    const cfgFonts =
      cfgRootObj && cfgRootObj.fonts && typeof cfgRootObj.fonts === 'object' ? cfgRootObj.fonts : {};
    const out = {};
    for (const key of FONT_SLOT_KEYS) {
      if (Object.prototype.hasOwnProperty.call(localFonts, key)) {
        out[key] = sanitizeFontFamilyInput(localFonts[key]);
      } else if (Object.prototype.hasOwnProperty.call(cfgFonts, key)) {
        out[key] = sanitizeFontFamilyInput(cfgFonts[key]);
      } else {
        out[key] = '';
      }
    }
    return out;
  }
  function loadLocalModuleOverrides() {
    try {
      const raw = typeof localStorage === 'object' && localStorage ? localStorage.getItem(MODULE_STORAGE_KEY) : null;
      const parsed = raw ? JSON.parse(raw) : null;
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
    } catch {
      return {};
    }
  }
  const rawLocalModOverrides = loadLocalModuleOverrides();
  const localOverrideTs = Number(rawLocalModOverrides._ts) > 0 ? Number(rawLocalModOverrides._ts) : 0;
  /* Trust localStorage overrides when daemon has never saved ui-prefs yet (migrates pre-existing in-session toggles)
     or when localStorage carries a newer/equal timestamp; discard stale overrides from reused ephemeral ports. */
  const trustLocalOverrides = cfgUiPrefsTs === 0 || localOverrideTs >= cfgUiPrefsTs;
  let localModOverrides = trustLocalOverrides ? rawLocalModOverrides : {};
  if (!trustLocalOverrides) {
    try {
      if (typeof localStorage === 'object' && localStorage) {
        localStorage.removeItem(MODULE_STORAGE_KEY);
        localStorage.removeItem('ag_claude_ux_recent_collapsed');
        localStorage.removeItem('ag_claude_ux_unified_recents_collapsed');
      }
    } catch {}
  }
  const needsInitialPrefsSync =
    trustLocalOverrides &&
    ((cfgUiPrefsTs === 0 && Object.keys(localModOverrides).some((k) => k !== '_ts')) ||
      (cfgUiPrefsTs > 0 && localOverrideTs > cfgUiPrefsTs));
  let currentCjkScale =
    normalizeCjkScale(localModOverrides.cjkFontScale) ||
    normalizeCjkScale(CFG_ROOT.cjkFontScale) ||
    '95';
  let currentChatOffsetX = Object.prototype.hasOwnProperty.call(localModOverrides, 'chatOffsetX')
    ? normalizeChatOffsetX(localModOverrides.chatOffsetX)
    : normalizeChatOffsetX(CFG_ROOT.chatOffsetX);
  let currentFonts = resolveInitialFonts(localModOverrides, CFG_ROOT);
  function applyCustomFontOverrides() {
    const rules = [];
    if (currentFonts.global) {
      const f = currentFonts.global;
      rules.push(`:root, html, body, body[data-agy-theme], body[data-agy-theme] :where(.font-sans), body[data-agy-font], body[data-agy-font="google-sans"], body[data-agy-font="inter"], body[data-agy-font] :where(.font-sans), .pdf-sdk-root {
  --ag-sans-stack: ${f} !important;
  --vscode-font-family: ${f} !important;
  --font-sans: ${f} !important;
  --font-editor-sans: ${f} !important;
  --default-font-family: ${f} !important;
  --font-family: ${f} !important;
  --sdk-font-family: ${f} !important;
  --sdk-comment-font-family: ${f} !important;
}`);
    }
    if (currentFonts.mono) {
      const m = currentFonts.mono;
      rules.push(`:root, html, body, body[data-agy-theme], body[data-agy-font], .pdf-sdk-root {
  --editor-font-family: ${m} !important;
  --vscode-editor-font-family: ${m} !important;
  --font-mono: ${m} !important;
  --default-mono-font-family: ${m} !important;
  --sdk-font-family-mono: ${m} !important;
}
:is(pre, code, kbd, samp, .font-mono, #ag-live-metrics-pill, #ag-live-metrics-pill #ag-live-metrics-text, .monaco-editor .view-lines, .cm-editor .cm-content, .cm-editor .cm-line),
:is(pre, code, .font-mono, .monaco-editor .view-lines, .cm-editor .cm-content, .cm-editor .cm-line) :is(span, td, th, div, a) {
  font-family: ${m} !important;
}`);
    }
    if (currentFonts.main) {
      const mn = currentFonts.main;
      rules.push(`:is([data-testid="planner-response-text"], [data-markdown-root], [data-testid="user-input-step"], [data-testid="user-message-content"], .agy-user-bubble, [data-lexical-editor="true"]),
:is([data-testid="planner-response-text"], [data-markdown-root], [data-testid="user-input-step"], [data-testid="user-message-content"], .agy-user-bubble, [data-lexical-editor="true"]) :is(p, li, ul, ol, blockquote, h1, h2, h3, h4, h5, h6, td, th, span, strong, b, em, div, a):not(code):not(pre):not(.font-mono):not(pre *):not(code *):not(.font-mono *) {
  --font-sans: ${mn} !important;
  --font-editor-sans: ${mn} !important;
  font-family: ${mn} !important;
}`);
    }
    if (currentFonts.overview) {
      const ov = currentFonts.overview;
      rules.push(`[data-testid="overview-panel"],
[data-testid="overview-panel"] :is(div, span, p, a, button, h1, h2, h3, h4, li, label):not(code):not(pre):not(.font-mono) {
  --font-sans: ${ov} !important;
  --font-family: ${ov} !important;
  font-family: ${ov} !important;
}`);
    }
    if (currentChatOffsetX !== 0) {
      const colW = 'max(30vw, var(--max-conversation-width, 48rem))';
      const freeSpace = `max(0px, calc(100% - ${colW}))`;
      const clampedLeft = `clamp(0px, calc((100% - ${colW}) / 2 + ${currentChatOffsetX}px), ${freeSpace})`;
      rules.push(`div.items-center:has(> div[style*="--max-conversation-width"]) {
  align-items: stretch !important;
}
div.mx-auto[style*="--max-conversation-width"],
div.items-center > div[style*="--max-conversation-width"] {
  margin-left: ${clampedLeft} !important;
  margin-right: auto !important;
}`);
    }
    let styleEl = document.getElementById(CUSTOM_FONT_STYLE_ID);
    if (rules.length === 0) {
      if (styleEl) styleEl.remove();
      return;
    }
    if (!styleEl) {
      styleEl = document.createElement('style');
      styleEl.id = CUSTOM_FONT_STYLE_ID;
      (document.head || document.documentElement).appendChild(styleEl);
    }
    styleEl.textContent = rules.join('\n');
  }
  function effectiveModBool(key, defaultVal = true) {
    if (Object.prototype.hasOwnProperty.call(localModOverrides, key)) {
      return Boolean(localModOverrides[key]);
    }
    if (Object.prototype.hasOwnProperty.call(MODS, key)) {
      return Boolean(MODS[key]);
    }
    return defaultVal;
  }
  const FEAT = {
    i18n: effectiveModBool('i18n', false),
    stepUnfold: effectiveModBool('claudeUxStepUnfold', true),
    collapseAnim: effectiveModBool('claudeUxCollapseAnimation', true),
    runningTimer: effectiveModBool('claudeUxRunningTimer', true),
    contextRing: effectiveModBool('claudeUxContextRing', true),
    modelMenu: effectiveModBool('claudeUxModelMenu', true),
    inlineUndo: effectiveModBool('claudeUxInlineUndo', true),
    folderStatus: effectiveModBool('claudeUxFolderStatus', true),
    recentSection: effectiveModBool('claudeUxRecentSection', false),
    projects: effectiveModBool('claudeUxProjects', true),
    hideSidebarProjects: effectiveModBool('claudeUxHideSidebarProjects', true),
    customizations: effectiveModBool('claudeUxCustomizations', true),
    codeFold: effectiveModBool('claudeUxCodeFold', true),
    overviewPanel: effectiveModBool('claudeUxOverviewPanel', true),
    glass: effectiveModBool('claudeUxGlass', true),
    gridBg: effectiveModBool('claudeUxGridBg', true)
  };
  const L = (zh, en) => (FEAT.i18n ? zh : en);

  /* an older instance that was never cleaned up (no ctx.onCleanup) must not keep running */
  if (typeof window.__agClaudeUxDispose === 'function') {
    try {
      window.__agClaudeUxDispose();
    } catch {}
  }

  /* Set root locale to zh-CN for Simplified Chinese CJK glyph fallback and track active UI language */
  const docRoot = document.documentElement;
  const origDocLang = docRoot ? docRoot.getAttribute('lang') : null;
  const hadDocLang = docRoot ? docRoot.hasAttribute('lang') : false;
  if (docRoot && origDocLang !== 'zh-CN') {
    docRoot.setAttribute('lang', 'zh-CN');
  }
  if (docRoot) {
    docRoot.setAttribute('data-ag-ux-lang', FEAT.i18n ? 'zh' : 'en');
    docRoot.setAttribute('data-ag-cjk-scale', currentCjkScale);
    if (FEAT.glass) docRoot.setAttribute('data-ag-glass', 'on');
    else docRoot.removeAttribute('data-ag-glass');
    if (FEAT.gridBg) docRoot.setAttribute('data-ag-grid-bg', 'on');
    else docRoot.removeAttribute('data-ag-grid-bg');
  }
  applyCustomFontOverrides();

  const userToggled = new WeakSet();
  const autoExpandCount = new WeakMap();
  const openSnapshots = new WeakMap();
  const runningTimers = new WeakMap();
  let timerIntervalId = null;
  let rafPending = false;

  /* ---- lifecycle: every async callback is tracked and becomes a no-op after cleanup ---- */
  let disposed = false;
  const pendingRafs = new Set();
  const pendingTimeouts = new Set();
  function frame(fn) {
    if (disposed) return 0;
    const id = requestAnimationFrame((ts) => {
      pendingRafs.delete(id);
      if (!disposed) fn(ts);
    });
    pendingRafs.add(id);
    return id;
  }
  function later(fn, ms) {
    if (disposed) return 0;
    const id = setTimeout(() => {
      pendingTimeouts.delete(id);
      if (!disposed) fn();
    }, ms);
    pendingTimeouts.add(id);
    return id;
  }
  function cancelLater(id) {
    if (!id) return;
    clearTimeout(id);
    pendingTimeouts.delete(id);
  }

  const PAST_LABEL_RE =
    /^(?:Explored|Ran\b|Edited\b|Done\b|Read\b|Searched|Listed|Viewed|Checked|Found\b|Created|Updated|Deleted|Wrote\b|Written|Built\b|Tested|Installed|Fetched|Analyzed|Reviewed|Thought\b|Worked\b|Completed|Finished|Failed|Stopped|Cancelled|Canceled|Skipped|已探索|已运行|已编辑|已完成|已读取|已搜索|已查看|已检查|已创建|已更新|已删除|已写入|已构建|已测试|已失败|已取消|完成了|思考了)/i;

  const onDocClick = (e) => {
    if (!e.isTrusted) return;
    const btn = e.target && e.target.closest && e.target.closest('button[data-testid="worked-for-collapsible"]');
    if (btn) userToggled.add(btn);
  };
  document.addEventListener('click', onDocClick, true);

  function captureOpenToolPanels() {
    /* Keep a reference to the live panel node (no innerHTML serialisation per frame).
       It is cloned only at the moment React collapses it. */
    const openBtns = document.querySelectorAll('button[data-testid="tool-group-collapsible"][aria-expanded="true"]');
    for (const btn of openBtns) {
      const panel = btn.nextElementSibling;
      if (!panel || panel.classList.contains('ag-collapse-ghost')) continue;
      const snap = openSnapshots.get(btn);
      if (!snap || snap.panel !== panel) openSnapshots.set(btn, { panel });
    }
  }

  function animateCollapseIfNeeded(btn) {
    const snap = openSnapshots.get(btn);
    if (!snap) return;
    openSnapshots.delete(btn);
    if (btn.getAttribute('aria-expanded') !== 'false') return;
    const parent = btn.parentElement;
    if (!parent || parent.querySelector(':scope > .ag-collapse-ghost')) return;
    const src = snap.panel;
    if (!src || !src.firstChild) return;

    const ghost = document.createElement('div');
    ghost.className = `${src.className} ag-collapse-ghost`;
    ghost.setAttribute('aria-hidden', 'true');
    for (const n of Array.from(src.childNodes)) ghost.appendChild(n.cloneNode(true));
    ghost.querySelectorAll('[id]').forEach((el) => el.removeAttribute('id'));
    ghost.style.opacity = '1';
    ghost.style.transform = 'translateY(0)';
    btn.insertAdjacentElement('afterend', ghost);

    const rectH = ghost.getBoundingClientRect ? ghost.getBoundingClientRect().height : 0;
    const height = Math.min(Math.ceil(rectH || ghost.scrollHeight || 0), 360);
    if (height <= 8) {
      ghost.remove();
      return;
    }
    ghost.style.maxHeight = `${height}px`;
    /* Commit starting box in the same frame so collapse begins immediately with zero 2-frame stall */
    void ghost.offsetHeight;
    ghost.classList.add('is-collapsing');

    let cleaned = false;
    const cleanup = () => {
      if (cleaned) return;
      cleaned = true;
      ghost.removeEventListener('transitionend', onEnd);
      if (ghost.parentNode) ghost.remove();
    };
    const onEnd = (ev) => {
      if (ev && ev.target === ghost && ev.propertyName === 'max-height') cleanup();
    };
    ghost.addEventListener('transitionend', onEnd);
    setTimeout(cleanup, 220); /* intentionally untracked: must also run after dispose */
  }

  /* One pane = one composer input box + its conversation. Computed once per sync (panes are few). */
  const INPUT_BOX_SEL = '[id="antigravity.agentSidePanelInputBox"]';
  function collectPanes() {
    const panes = [];
    for (const inputBox of document.querySelectorAll(INPUT_BOX_SEL)) {
      let cur = inputBox.parentElement;
      for (let i = 0; i < 16 && cur; i++, cur = cur.parentElement) {
        if (cur.querySelector('[data-testid="agent-response"]')) {
          if (cur.querySelectorAll(INPUT_BOX_SEL).length === 1) panes.push({ root: cur, inputBox });
          break;
        }
      }
    }
    return panes;
  }

  function paneFor(el, panes) {
    for (const p of panes) if (p.root.contains(el)) return p;
    return null;
  }

  const AGENT_WORKING_H6_RE = /^(?:Agent\s+working|Agent\s*正在执行|Agent\s*正在工作|正在工作)$/i;
  function paneHasWorkingHeading(root) {
    if (!root || !root.querySelectorAll) return false;
    const turns = root.querySelectorAll('[data-testid="agent-response"]');
    if (!turns.length) return false;
    const lastTurn = turns[turns.length - 1];
    const h6 = lastTurn.querySelector(':scope > h6.sr-only, :scope > h6');
    if (!h6) return false;
    const origMap = window.__ag_orig_text_map;
    const raw =
      (origMap && h6.firstChild && origMap.get(h6.firstChild) && origMap.get(h6.firstChild).origRaw) ||
      h6.textContent ||
      '';
    return AGENT_WORKING_H6_RE.test(raw.trim());
  }

  function isActivelyRunningRow(el, isLastCandidate, turnGenerating) {
    if (!turnGenerating || !isLastCandidate) return false;
    if (el.getAttribute('data-testid') === 'ephemeral-tool-status') return true;
    const span = el.querySelector(':scope > span[title], :scope > span[data-ag-orig-title]');
    const raw =
      (span && (span.getAttribute('data-ag-orig-title') || span.getAttribute('title'))) ||
      el.getAttribute('data-ag-orig-aria-label') ||
      el.getAttribute('aria-label') ||
      el.textContent ||
      '';
    return !PAST_LABEL_RE.test(raw.trim());
  }

  function syncRunningToolIndicators(panesArg) {
    if (disposed) return;
    const candidates = FEAT.runningTimer
      ? Array.from(document.querySelectorAll('button[data-testid="tool-group-collapsible"], [data-testid="ephemeral-tool-status"]'))
      : [];
    const panes = panesArg || collectPanes();
    const globalGenerating =
      Boolean(document.querySelector('button[data-testid="input-cancel-button"]')) ||
      panes.some((p) => paneHasWorkingHeading(p.root));

    /* "last row" and "generating" are evaluated per pane, so a busy pane never lights up another one */
    const lastInPane = new Map();
    const paneOfEl = new Map();
    for (const el of candidates) {
      const pane = paneFor(el, panes);
      paneOfEl.set(el, pane);
      lastInPane.set(pane, el);
    }
    const generatingCache = new Map();
    const paneGenerating = (pane) => {
      if (!pane) return panes.length === 0 && globalGenerating;
      if (!generatingCache.has(pane)) {
        generatingCache.set(
          pane,
          Boolean(pane.inputBox.querySelector('button[data-testid="input-cancel-button"]')) ||
            paneHasWorkingHeading(pane.root)
        );
      }
      return generatingCache.get(pane);
    };

    let activeCount = 0;
    const now = Date.now();
    for (const el of candidates) {
      const pane = paneOfEl.get(el);
      const isRunning = isActivelyRunningRow(el, lastInPane.get(pane) === el, paneGenerating(pane));
      let orbit = el.querySelector(':scope > .ag-orbit-dots');
      let timerEl = el.querySelector(':scope > .ag-elapsed-timer');

      if (isRunning) {
        activeCount += 1;
        let startTs = runningTimers.get(el);
        if (!startTs) {
          startTs = now;
          runningTimers.set(el, startTs);
        }
        if (!orbit) {
          orbit = document.createElement('span');
          orbit.className = 'ag-orbit-dots';
          orbit.setAttribute('aria-hidden', 'true');
          orbit.innerHTML = '<i></i><i></i>';
          el.insertBefore(orbit, el.firstChild);
        }
        const secs = Math.max(1, Math.floor((now - startTs) / 1000));
        if (!timerEl) {
          timerEl = document.createElement('span');
          timerEl.className = 'ag-elapsed-timer';
          const chevron = el.querySelector(':scope > svg');
          if (chevron) {
            el.insertBefore(timerEl, chevron);
          } else {
            el.appendChild(timerEl);
          }
        }
        const txt = `${secs}s`;
        if (timerEl.textContent !== txt) timerEl.textContent = txt;
      } else {
        if (orbit) orbit.remove();
        if (timerEl) timerEl.remove();
        runningTimers.delete(el);
      }
    }
    /* stale indicators on rows that are no longer candidates */
    if (!FEAT.runningTimer) {
      document.querySelectorAll('.ag-orbit-dots, .ag-elapsed-timer').forEach((n) => n.remove());
    }

    const keepPolling = activeCount > 0;
    if (keepPolling && !timerIntervalId) {
      timerIntervalId = setInterval(() => {
        const ps = collectPanes();
        syncRunningToolIndicators(ps);
      }, 450);
    } else if (!keepPolling && timerIntervalId) {
      clearInterval(timerIntervalId);
      timerIntervalId = null;
    }
  }

  /* Inline code & file-mention pill CJK boundary hygiene:
   * 1. Strips redundant ASCII spaces (`" "`) between boxed pills (`:not(pre) > code`, `bdi.context-scope-mention`)
   *    and adjacent CJK characters / fullwidth punctuation so pills don't push `，。；：（）` away with double gaps.
   * 2. Attaches U+2060 WORD JOINER between atomic inline pills (`inline-flex` file mentions) and adjacent CJK
   *    closing/middle punctuation (`、，。！？；：）》」』】`) or opening brackets (`（《「『【`) so punctuation never wraps to line start.
   * Mutates `Text.nodeValue` only (zero childList mutations, zero React Fiber interference) and restores on `dispose()`. */
  const pillSiblingEdits = new WeakMap();
  const WORD_JOINER = '\u2060';
  const CJK_OR_FULL_PUNCT_END_SPACE_RE = /([\u4e00-\u9fff\u3000-\u303f\uff01-\uff60“‘])([ \t]+)$/;
  const CJK_OR_FULL_PUNCT_LEAD_SPACE_RE = /^([ \t]+)([\u4e00-\u9fff\u3000-\u303f\uff01-\uff60”’])/;
  const CJK_OPEN_PUNCT_END_RE = /[（《「『【〈“‘]$/;
  const CJK_CLOSE_OR_MID_PUNCT_START_RE = /^[、，。！？；：）》」』】〉”’—…]/;

  function syncInlinePillBoundaries() {
    if (disposed) return;
    const pills = document.querySelectorAll(
      '[data-testid="planner-response-text"] :is(:not(pre) > code, bdi.context-scope-mention), ' +
        '[data-markdown-root] :is(:not(pre) > code, bdi.context-scope-mention), ' +
        '.select-text :is(:not(pre) > code, bdi.context-scope-mention), ' +
        '.prose :is(:not(pre) > code, bdi.context-scope-mention)'
    );
    for (const pill of pills) {
      if (pill.closest('[contenteditable="true"], [data-lexical-editor="true"], pre, ul.contains-task-list')) {
        continue;
      }

      const prev = pill.previousSibling;
      if (prev && prev.nodeType === 3) {
        const cur = prev.nodeValue || '';
        const spaceMatch = cur.match(CJK_OR_FULL_PUNCT_END_SPACE_RE);
        let next = spaceMatch ? cur.slice(0, cur.length - spaceMatch[2].length) : cur;
        let addedTrailWj = false;
        if (CJK_OPEN_PUNCT_END_RE.test(next) && !next.endsWith(WORD_JOINER)) {
          next += WORD_JOINER;
          addedTrailWj = true;
        }
        if (next !== cur) {
          const rec = pillSiblingEdits.get(prev) || {};
          if (spaceMatch && !rec.strippedTrailSpace) rec.strippedTrailSpace = spaceMatch[2];
          if (addedTrailWj) rec.addedTrailWj = true;
          pillSiblingEdits.set(prev, rec);
          prev.nodeValue = next;
        }
      }

      const fol = pill.nextSibling;
      if (fol && fol.nodeType === 3) {
        const cur = fol.nodeValue || '';
        const hadWj = cur.startsWith(WORD_JOINER);
        const withoutWj = hadWj ? cur.slice(1) : cur;
        const spaceMatch = withoutWj.match(CJK_OR_FULL_PUNCT_LEAD_SPACE_RE);
        let next = spaceMatch ? withoutWj.slice(spaceMatch[1].length) : withoutWj;
        let addedLeadWj = false;
        if (CJK_CLOSE_OR_MID_PUNCT_START_RE.test(next)) {
          next = WORD_JOINER + next;
          addedLeadWj = true;
        }
        if (next !== cur) {
          const rec = pillSiblingEdits.get(fol) || {};
          if (spaceMatch && !rec.strippedLeadSpace) rec.strippedLeadSpace = spaceMatch[1];
          if (addedLeadWj) rec.addedLeadWj = true;
          pillSiblingEdits.set(fol, rec);
          fol.nodeValue = next;
        }
      }
    }
  }

  function restoreInlinePillBoundaries() {
    const pills = document.querySelectorAll(':not(pre) > code, bdi.context-scope-mention');
    for (const pill of pills) {
      for (const node of [pill.previousSibling, pill.nextSibling]) {
        if (!node || node.nodeType !== 3 || !pillSiblingEdits.has(node)) continue;
        const rec = pillSiblingEdits.get(node);
        let val = node.nodeValue || '';
        if (rec.addedLeadWj && val.startsWith(WORD_JOINER)) val = val.slice(1);
        if (rec.strippedLeadSpace && !val.startsWith(rec.strippedLeadSpace)) val = rec.strippedLeadSpace + val;
        if (rec.addedTrailWj && val.endsWith(WORD_JOINER)) val = val.slice(0, -1);
        if (rec.strippedTrailSpace && !val.endsWith(rec.strippedTrailSpace)) val = val + rec.strippedTrailSpace;
        node.nodeValue = val;
        pillSiblingEdits.delete(node);
      }
    }
  }

  /* ==========================================================================
   * 4b. Long Code Block Folding & Sticky Header (claudeUxCodeFold)
   *     - Sticks native code block headers while scrolling long responses
   *     - Collapses blocks with >= 40 lines to a preview by default, remembering
   *       user expand/collapse choices across React virtualized remounts
   * ========================================================================== */
  const CODE_FOLD_MIN_LINES = 40;
  const CODE_FOLD_KEYS_MAX = 300;
  const codeFoldUserState = new Map();
  const codeBlockMetricCache = new WeakMap();
  const SVG_CODE_FOLD_CHEVRON =
    '<svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">' +
    '<path d="M4 6L8 10L12 6" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>' +
    '</svg>';

  function findNativeCodeBlocks() {
    const blocks = [];
    const codeEls = document.querySelectorAll('div.code-block');
    for (const codeEl of codeEls) {
      if (codeEl.classList.contains('overflow-y-auto')) continue;
      const body = codeEl.parentElement;
      if (!body || !body.classList || !body.classList.contains('p-3')) continue;
      const wrap = body.parentElement;
      if (!wrap) continue;
      const header = wrap.firstElementChild;
      if (!header || header === body || !header.classList) continue;
      if (!header.classList.contains('min-h-7') || !header.classList.contains('border-b')) continue;
      blocks.push({ wrap, header, body, codeEl });
    }
    return blocks;
  }

  function hashTextFnv1a(str) {
    let h = 0x811c9dc5;
    for (let i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 0x01000193);
    }
    return (h >>> 0).toString(36);
  }

  function getCodeBlockMetrics(header, codeEl) {
    if (!codeEl) return { lines: 0, key: '' };
    const langEl = header && header.firstElementChild;
    const lang = langEl && langEl.textContent ? langEl.textContent.trim() : '';
    const childCount = codeEl.childNodes ? codeEl.childNodes.length : 0;
    const firstNode = codeEl.firstChild;
    const lastNode = codeEl.lastChild;
    const cached = codeBlockMetricCache.get(codeEl);
    if (
      cached &&
      cached.lang === lang &&
      cached.childCount === childCount &&
      cached.firstNode === firstNode &&
      cached.lastNode === lastNode &&
      (childCount > 1 || (firstNode && firstNode.nodeValue === cached.singleText))
    ) {
      return cached;
    }
    const lineNodes = codeEl.querySelectorAll('.code-line');
    const txt = codeEl.textContent || '';
    const lines = lineNodes.length > 0 ? lineNodes.length : txt ? txt.split('\n').length : 0;
    const key = `${lang}|${txt.length}|${hashTextFnv1a(txt)}`;
    const next = {
      lang,
      childCount,
      firstNode,
      lastNode,
      singleText: childCount <= 1 && firstNode ? firstNode.nodeValue : undefined,
      lines,
      key
    };
    codeBlockMetricCache.set(codeEl, next);
    return next;
  }

  function codeBlockKey(header, codeEl) {
    return getCodeBlockMetrics(header, codeEl).key;
  }

  function rememberCodeFoldState(key, stateVal) {
    if (codeFoldUserState.has(key)) codeFoldUserState.delete(key);
    codeFoldUserState.set(key, stateVal);
    if (codeFoldUserState.size > CODE_FOLD_KEYS_MAX) {
      codeFoldUserState.delete(codeFoldUserState.keys().next().value);
    }
  }

  function findCodeBlockScrollContainer(el) {
    let cur = el ? el.parentElement : null;
    for (let i = 0; i < 25 && cur && cur !== document.documentElement; i++, cur = cur.parentElement) {
      if (typeof getComputedStyle === 'function') {
        const ov = getComputedStyle(cur).overflowY;
        if (ov === 'auto' || ov === 'scroll') return cur;
      }
    }
    return null;
  }

  function onCodeFoldClick(e) {
    e.preventDefault();
    e.stopPropagation();
    const trigger = e.currentTarget;
    const wrap = trigger && trigger.closest ? trigger.closest('[data-ag-code-wrap]') : null;
    if (wrap) toggleCodeFold(wrap);
  }

  function syncSingleCodeBlock(wrap, header, codeEl) {
    if (!wrap || !header || !codeEl) return;
    if (wrap.getAttribute('data-ag-code-wrap') !== 'true') {
      wrap.setAttribute('data-ag-code-wrap', 'true');
    }
    const { lines, key } = getCodeBlockMetrics(header, codeEl);
    if (lines >= CODE_FOLD_MIN_LINES) {
      if (wrap.getAttribute('data-ag-code-long') !== 'true') {
        wrap.setAttribute('data-ag-code-long', 'true');
      }
      const collapsed = codeFoldUserState.get(key) !== 'expanded';
      const nextAttr = collapsed ? 'true' : 'false';
      if (wrap.getAttribute('data-ag-code-collapsed') !== nextAttr) {
        wrap.setAttribute('data-ag-code-collapsed', nextAttr);
      }

      let toggleBtn = header.querySelector('.ag-code-fold-toggle');
      if (!toggleBtn) {
        toggleBtn = document.createElement('button');
        toggleBtn.type = 'button';
        toggleBtn.className =
          'ag-code-fold-toggle appearance-none bg-transparent border-0 p-0 cursor-pointer text-secondary-foreground hover:text-foreground transition-colors';
        toggleBtn.setAttribute('data-ag-i18n-ignore', '1');
        toggleBtn.innerHTML = SVG_CODE_FOLD_CHEVRON;
        toggleBtn.addEventListener('click', onCodeFoldClick);
        const btnGroup =
          header.lastElementChild && header.lastElementChild !== header.firstElementChild
            ? header.lastElementChild
            : header;
        btnGroup.insertBefore(toggleBtn, btnGroup.firstChild);
      }
      const toggleLabel = collapsed ? L('展开代码', 'Expand code') : L('收起代码', 'Collapse code');
      if (toggleBtn.getAttribute('aria-label') !== toggleLabel) {
        toggleBtn.setAttribute('aria-label', toggleLabel);
      }
      if (toggleBtn.getAttribute('title') !== toggleLabel) {
        toggleBtn.setAttribute('title', toggleLabel);
      }

      let bar = null;
      for (const ch of wrap.children) {
        if (ch.classList && ch.classList.contains('ag-code-fold-bar')) {
          bar = ch;
          break;
        }
      }
      if (!bar) {
        bar = document.createElement('button');
        bar.type = 'button';
        bar.className = 'ag-code-fold-bar';
        bar.setAttribute('data-ag-i18n-ignore', '1');
        bar.addEventListener('click', onCodeFoldClick);
        wrap.appendChild(bar);
      }
      const barText = collapsed
        ? L(`展开全部 · 共 ${lines} 行`, `Show all ${lines} lines`)
        : L('收起代码', 'Collapse code');
      if (bar.textContent !== barText) {
        bar.textContent = barText;
      }
    } else {
      if (wrap.hasAttribute('data-ag-code-long')) wrap.removeAttribute('data-ag-code-long');
      if (wrap.hasAttribute('data-ag-code-collapsed')) wrap.removeAttribute('data-ag-code-collapsed');
      header.querySelectorAll('.ag-code-fold-toggle').forEach((n) => n.remove());
      for (const ch of Array.from(wrap.children)) {
        if (ch.classList && ch.classList.contains('ag-code-fold-bar')) ch.remove();
      }
    }
  }

  function toggleCodeFold(wrap) {
    const header = wrap.firstElementChild;
    const codeEl = wrap.querySelector(':scope > div.p-3 > div.code-block');
    if (!header || !codeEl) return;
    const key = codeBlockKey(header, codeEl);
    const nextCollapsed = wrap.getAttribute('data-ag-code-collapsed') !== 'true';
    rememberCodeFoldState(key, nextCollapsed ? 'collapsed' : 'expanded');
    syncSingleCodeBlock(wrap, header, codeEl);
    if (nextCollapsed) {
      try {
        const scroller = findCodeBlockScrollContainer(wrap);
        const minTop = scroller ? scroller.getBoundingClientRect().top : 0;
        if (wrap.getBoundingClientRect().top < minTop) {
          wrap.scrollIntoView({ block: 'start', behavior: 'auto' });
        }
      } catch {}
    }
  }

  function syncCodeBlocks() {
    if (!FEAT.codeFold) return;
    for (const { wrap, header, codeEl } of findNativeCodeBlocks()) {
      syncSingleCodeBlock(wrap, header, codeEl);
    }
  }

  function teardownCodeBlocks() {
    document.querySelectorAll('[data-ag-code-wrap]').forEach((wrap) => {
      wrap.removeAttribute('data-ag-code-wrap');
      wrap.removeAttribute('data-ag-code-long');
      wrap.removeAttribute('data-ag-code-collapsed');
    });
    document.querySelectorAll('.ag-code-fold-toggle, .ag-code-fold-bar').forEach((el) => el.remove());
  }

  let lastSyncTs = 0;
  function syncStepStream() {
    rafPending = false;
    if (disposed) return;
    lastSyncTs = Date.now();
    if (FEAT.stepUnfold) {
      const workedBtns = document.querySelectorAll('button[data-testid="worked-for-collapsible"]');
      for (const btn of workedBtns) {
        const wrap = btn.parentElement;
        if (wrap && !wrap.hasAttribute('data-ag-inline-stream')) {
          wrap.setAttribute('data-ag-inline-stream', 'true');
        }
        if (btn.getAttribute('aria-expanded') === 'false' && !userToggled.has(btn)) {
          /* bounded: never fight the app in a click loop if it keeps re-collapsing the same node */
          const n = autoExpandCount.get(btn) || 0;
          if (n < 3) {
            autoExpandCount.set(btn, n + 1);
            btn.click();
          }
        }
      }
    } else {
      document.querySelectorAll('[data-ag-inline-stream]').forEach((el) => el.removeAttribute('data-ag-inline-stream'));
    }
    if (FEAT.collapseAnim) captureOpenToolPanels();
    const panes = collectPanes();
    syncRunningToolIndicators(panes);
    syncInlinePillBoundaries();
    syncCodeBlocks();
    if (FEAT.contextRing || FEAT.overviewPanel) {
      ensureMetricsWrapped();
      syncCompactVisualState(false);
    }
    if (FEAT.contextRing) {
      ensureComposerContextRing();
    } else {
      const oldRing = document.getElementById('ag-claude-ctx-ring');
      if (oldRing) oldRing.remove();
      if (typeof closeQuotaPopover === 'function') closeQuotaPopover();
    }
    syncModelTriggerDisplay();
    syncSidebarEnhancements();
    syncProjectsWorkspace();
    syncOverviewPanel(false);
    reconcileSettingsPanel();
  }

  /* ==========================================================================
   * 5. Claude-Style Composer Context Ring + Live Plan Quota Popover + Slim Pill
   *    - Strips `Ctx ...`, `Out ...` & `+N sub` from `#ag-live-metrics-pill` while keeping `tok/s · TTFT`
   *    - Transforms `#ag-live-metrics-tooltip` into a compact 272px two-section Claude popover (with TTFT)
   *    - Mounts radial context progress ring right beside the Model Selector
   *    - Clicking opens real-time Usage Popover (`retrieveUserQuotaSummary` 5h & weekly buckets)
   * ========================================================================== */
  const RING_CIRC = 2 * Math.PI * 7;
  const SVG_COMPACT_ICON =
    '<svg width="11" height="11" viewBox="0 0 16 16" fill="none" aria-hidden="true">' +
    '<path d="M4.5 2.75L8 6.25L11.5 2.75M4.5 13.25L8 9.75L11.5 13.25" stroke="currentColor" stroke-width="1.55" stroke-linecap="round" stroke-linejoin="round"/>' +
    '</svg>';
  const SVG_COMPACT_DONE =
    '<svg width="11" height="11" viewBox="0 0 16 16" fill="none" aria-hidden="true">' +
    '<path d="M3.5 8.3L6.6 11.4L12.6 4.8" stroke="currentColor" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round"/>' +
    '</svg>';
  const QUOTA_CACHE_STORAGE_KEY = 'ag_claude_ux_quota_cache_v1';
  function loadPersistedQuotaSnapshot() {
    try {
      const raw = typeof localStorage === 'object' && localStorage ? localStorage.getItem(QUOTA_CACHE_STORAGE_KEY) : null;
      const parsed = raw ? JSON.parse(raw) : null;
      if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.groups) || parsed.groups.length === 0) return null;
      return parsed;
    } catch {
      return null;
    }
  }
  function serializeQuotaGroups(groups) {
    if (!Array.isArray(groups)) return [];
    return groups.map((g) => ({
      displayName: String(g.displayName || ''),
      buckets: Array.isArray(g.buckets)
        ? g.buckets.map((b) => ({
            displayName: b && b.displayName ? String(b.displayName) : '',
            window: b && b.window ? String(b.window) : '',
            description: b && b.description ? String(b.description) : '',
            remainingFraction:
              b && b.remaining && b.remaining.case === 'remainingFraction' && typeof b.remaining.value === 'number'
                ? b.remaining.value
                : b && typeof b.remainingFraction === 'number'
                  ? b.remainingFraction
                  : 1,
            resetTime:
              b && b.resetTime && b.resetTime.seconds !== undefined
                ? { seconds: String(b.resetTime.seconds) }
                : undefined
          }))
        : []
    }));
  }
  const initialQuotaSnap = loadPersistedQuotaSnapshot();
  let cachedQuotaSvc = null;
  let cachedUserTierName = initialQuotaSnap ? String(initialQuotaSnap.tierName || '') : '';
  let cachedUserAccountKey = initialQuotaSnap ? String(initialQuotaSnap.accountKey || '') : '';
  let cachedQuotaGroups = initialQuotaSnap ? initialQuotaSnap.groups : null;
  let lastQuotaFetchTs = 0;
  let lastForceQuotaFetchTs = 0;
  let autoQuotaRefreshTimer = 0;
  let lastQuotaUsageSig = '';
  let wasOvPaneGenerating = false;
  let quotaFetchInFlight = null;
  let quotaHoldTimer = 0;
  let quotaWarmupDone = false;
  let quotaPopoverOpen = false;
  let selectedQuotaGroupIdx = -1;
  function persistQuotaSnapshot() {
    if (!Array.isArray(cachedQuotaGroups) || cachedQuotaGroups.length === 0) return;
    try {
      if (typeof localStorage === 'object' && localStorage) {
        localStorage.setItem(
          QUOTA_CACHE_STORAGE_KEY,
          JSON.stringify({
            accountKey: cachedUserAccountKey || '',
            tierName: cachedUserTierName || '',
            ts: Date.now(),
            groups: serializeQuotaGroups(cachedQuotaGroups)
          })
        );
      }
    } catch {}
  }
  let latestCtxState = { pct: 0, ratioText: '', outText: '', hasData: false, cascadeId: '' };
  let manualCompactPending = { cascadeId: '', startedAt: 0 };
  let compactedStaleSigByCid = new Map();
  let compactedMetaByCid = new Map();
  let lastObservedCompactKey = '';
  let compactPollTimerId = null;

  function getActiveCascadeId() {
    const m = (window.location.pathname || '').match(/\/c\/([0-9a-f-]+)/i);
    if (m) return m[1];
    if (window.__ag_watched_cascade_id) return String(window.__ag_watched_cascade_id);
    const sel = document.querySelector('[data-testid="conversation-row-sidebar"][data-selected="true"]');
    return (sel && sel.getAttribute('data-cascade-id')) || '';
  }

  function getActiveInputBox(anchorEl) {
    if (anchorEl && anchorEl.closest) {
      const own = anchorEl.closest('[id="antigravity.agentSidePanelInputBox"]');
      if (own) return own;
      const view = anchorEl.closest('[data-testid="conversation-view"]');
      if (view) {
        const inView = view.querySelector('[id="antigravity.agentSidePanelInputBox"]');
        if (inView) return inView;
      }
    }
    const boxes = document.querySelectorAll('[id="antigravity.agentSidePanelInputBox"]');
    if (boxes.length <= 1) return boxes[0] || null;
    const ae = document.activeElement;
    if (ae && ae.closest) {
      const aeView = ae.closest('[data-testid="conversation-view"]');
      if (aeView) {
        const aeBox = aeView.querySelector('[id="antigravity.agentSidePanelInputBox"]');
        if (aeBox) return aeBox;
      }
    }
    const cid = getActiveCascadeId();
    if (cid) {
      for (const b of boxes) {
        const v = b.closest && b.closest('[data-testid="conversation-view"]');
        if (v && v.getAttribute('data-cascade-id') === cid) return b;
      }
    }
    return boxes[0] || null;
  }

  function discoverAgentInputProps(anchorEl) {
    const inputBox = getActiveInputBox(anchorEl);
    if (!inputBox) return null;
    const fk = Object.keys(inputBox).find((k) => k.startsWith('__reactFiber$'));
    let f = fk ? inputBox[fk] : null;
    for (let i = 0; i < 45 && f; i++, f = f.return) {
      const pr = f.memoizedProps;
      if (pr && typeof pr.handleSubmit === 'function') return pr;
    }
    return null;
  }

  function discoverComposerContextFromInputBox(anchorEl) {
    const inputBox = getActiveInputBox(anchorEl);
    if (!inputBox) return null;
    const fk = Object.keys(inputBox).find((k) => k.startsWith('__reactFiber$'));
    let f = fk ? inputBox[fk] : null;
    for (let i = 0; i < 45 && f; i++, f = f.return) {
      const pr = f.memoizedProps;
      if (pr && pr.value && pr.value.inputBoxRef) return pr.value;
      let dep = f.dependencies ? f.dependencies.firstContext : null;
      while (dep) {
        const v = dep.memoizedValue;
        if (v && typeof v === 'object' && v.inputBoxRef) return v;
        dep = dep.next;
      }
    }
    return null;
  }

  function isPaneCurrentlyRunning(agentPropsArg) {
    const pr = agentPropsArg !== undefined ? agentPropsArg : discoverAgentInputProps();
    if (pr && typeof pr.isRunning === 'boolean') return pr.isRunning;
    return Boolean(document.querySelector('button[data-testid="input-cancel-button"]'));
  }

  function isCompactUserStepObj(s) {
    if (!s || (s.type !== 14 && (!s.step || s.step.case !== 'userInput'))) return false;
    const val = s.step && s.step.value;
    if (!val) return false;
    if (/^\s*\/compact\b/i.test(String(val.userResponse || ''))) return true;
    if (Array.isArray(val.items)) {
      return val.items.some(
        (it) =>
          it &&
          it.chunk &&
          it.chunk.case === 'item' &&
          it.chunk.value &&
          it.chunk.value.scopeItem &&
          it.chunk.value.scopeItem.case === 'slashCommand' &&
          it.chunk.value.scopeItem.value &&
          it.chunk.value.scopeItem.value.info &&
          it.chunk.value.scopeItem.value.info.name === 'compact'
      );
    }
    return false;
  }

  function isDomCompactUserStep(stepEl) {
    if (!stepEl) return false;
    if (stepEl.querySelector('[data-uri="slashCommand:compact"]')) return true;
    const contentEl = stepEl.querySelector('[data-testid="user-message-content"]');
    const raw = ((contentEl || stepEl).textContent || '').trim();
    return /^\/?compact$/i.test(raw);
  }

  function domTurnHasAssistantContent(turnEl) {
    if (!turnEl) return false;
    return Boolean(
      turnEl.querySelector(
        'button[data-testid="worked-for-collapsible"], [data-testid="thinking-collapsible-trigger"], button[data-testid="tool-group-collapsible"], [data-testid="ephemeral-tool-status"], .prose, p, pre, ul, ol'
      )
    );
  }

  function currentCtxStaleSig() {
    if (!latestCtxState.hasData) return '';
    return `${latestCtxState.ratioText}|${latestCtxState.outText}|${latestCtxState.pct}`;
  }

  function parseTokenLabelToCount(label) {
    const m = String(label || '').trim().match(/^([\d.]+)\s*([kKmM])?$/);
    if (!m) return 0;
    const num = Number(m[1]);
    if (!Number.isFinite(num) || num <= 0) return 0;
    const unit = (m[2] || '').toLowerCase();
    if (unit === 'm') return Math.round(num * 1000000);
    if (unit === 'k') return Math.round(num * 1000);
    return Math.round(num);
  }

  function extractCheckpointUsage(stepObj) {
    const meta = stepObj && stepObj.metadata;
    const usage =
      (meta && meta.modelUsage) ||
      (meta && Array.isArray(meta.retryInfos) && meta.retryInfos[0] && meta.retryInfos[0].usage) ||
      null;
    if (!usage) return { preTokens: 0, summaryTokens: 0 };
    const toTok = (v) => {
      const n = typeof v === 'bigint' ? Number(v) : Number(v || 0);
      return Number.isFinite(n) && n > 0 ? n : 0;
    };
    const preTokens = toTok(usage.inputTokens) + toTok(usage.cacheReadTokens);
    const respTok = toTok(usage.responseOutputTokens);
    const outTok = toTok(usage.outputTokens);
    return {
      preTokens,
      summaryTokens: respTok > 0 ? respTok : outTok
    };
  }

  /* Real-time /compact detector:
   * `daemon.mjs` reads `gen_metadata` (whose last row right after `/compact` is the summarization call itself, e.g. 483k/94%),
   * and `CHECKPOINT` (`step_type = 23`) writes no post-compact `gen_metadata` row until the user sends a new message.
   * Inspecting live `trajectorySlice` (with DOM fallback) lets the ring, popover & tooltip reflect `compacting` / `compacted` immediately. */
  function detectCompactStatus(curCidArg) {
    const curCid = curCidArg !== undefined ? curCidArg : getActiveCascadeId();
    const agentProps = discoverAgentInputProps();
    const running = isPaneCurrentlyRunning(agentProps);
    const cidKey = curCid || '__active__';
    const curSig = currentCtxStaleSig();

    const viewports = document.querySelectorAll('[data-testid="autoscroll-viewport"], .overflow-y-auto');
    for (const vp of viewports) {
      const fk = Object.keys(vp).find((k) => k.startsWith('__reactFiber$'));
      let f = fk ? vp[fk] : null;
      for (let i = 0; i < 35 && f; i++, f = f.return) {
        const p = f.memoizedProps;
        const slice = p && p.trajectorySlice;
        if (!slice || !Array.isArray(slice.stepsInSlice)) continue;
        if (curCid && slice.conversationId && slice.conversationId !== curCid) break;

        const arr = slice.stepsInSlice;
        let lastCompactUserIdx = -1;
        let lastCheckpointIdx = -1;
        let lastCheckpointStep = null;
        let lastRegularUserIdx = -1;
        let lastPlannerIdx = -1;

        for (let idx = 0; idx < arr.length; idx++) {
          const s = arr[idx];
          if (!s) continue;
          const sc = (s.step && s.step.case) || '';
          if (sc === 'checkpoint' || s.type === 23) {
            lastCheckpointIdx = idx;
            lastCheckpointStep = s;
          } else if (sc === 'userInput' || s.type === 14) {
            if (isCompactUserStepObj(s)) lastCompactUserIdx = idx;
            else lastRegularUserIdx = idx;
          } else if (sc === 'plannerResponse' || s.type === 15) {
            lastPlannerIdx = idx;
          }
        }

        const anchorIdx = Math.max(lastCompactUserIdx, lastCheckpointIdx);
        if (anchorIdx >= 0 && lastRegularUserIdx < anchorIdx && lastPlannerIdx < anchorIdx) {
          manualCompactPending = { cascadeId: '', startedAt: 0 };
          const cpStatus = lastCheckpointStep ? lastCheckpointStep.status : undefined;
          const cpFailed = Boolean(
            (lastCheckpointStep && lastCheckpointStep.step && lastCheckpointStep.step.value && lastCheckpointStep.step.value.modelSummarizationFailed) ||
              (typeof cpStatus === 'number' && cpStatus > 3)
          );
          if (cpFailed) {
            compactedStaleSigByCid.delete(cidKey);
            compactedMetaByCid.delete(cidKey);
            return 'idle';
          }
          if (running || (typeof cpStatus === 'number' && cpStatus > 0 && cpStatus < 3)) {
            if (lastCheckpointStep) {
              const cpUsage = extractCheckpointUsage(lastCheckpointStep);
              if (cpUsage.preTokens > 0 || cpUsage.summaryTokens > 0) {
                compactedMetaByCid.set(cidKey, cpUsage);
              }
            }
            return 'compacting';
          }
          if (curSig) compactedStaleSigByCid.set(cidKey, curSig);
          compactedMetaByCid.set(cidKey, extractCheckpointUsage(lastCheckpointStep));
          return 'compacted';
        }

        if (anchorIdx >= 0 && lastRegularUserIdx > anchorIdx) {
          const staleSig = compactedStaleSigByCid.get(cidKey);
          if (staleSig && curSig && staleSig === curSig && running) {
            return 'compacted';
          }
          if (staleSig && curSig && staleSig !== curSig) {
            compactedStaleSigByCid.delete(cidKey);
          }
          compactedMetaByCid.delete(cidKey);
        }

        if (
          manualCompactPending.cascadeId === cidKey &&
          Date.now() - manualCompactPending.startedAt < 15000
        ) {
          return 'compacting';
        }
        return 'idle';
      }
    }

    /* DOM fallback (covers jsdom unit tests & early mounts before trajectorySlice attaches) */
    const flowNodes = Array.from(
      document.querySelectorAll('[data-testid="user-input-step"], [data-testid="agent-response"]')
    );
    let lastUserFlowIdx = -1;
    for (let i = flowNodes.length - 1; i >= 0; i--) {
      if (flowNodes[i].getAttribute('data-testid') === 'user-input-step') {
        lastUserFlowIdx = i;
        break;
      }
    }
    if (lastUserFlowIdx >= 0 && isDomCompactUserStep(flowNodes[lastUserFlowIdx])) {
      const hasReplyAfter = flowNodes
        .slice(lastUserFlowIdx + 1)
        .some((el) => el.getAttribute('data-testid') === 'agent-response' && domTurnHasAssistantContent(el));
      if (!hasReplyAfter) {
        manualCompactPending = { cascadeId: '', startedAt: 0 };
        if (running) return 'compacting';
        if (curSig) compactedStaleSigByCid.set(cidKey, curSig);
        return 'compacted';
      }
    }

    const staleSig = compactedStaleSigByCid.get(cidKey);
    if (staleSig && curSig) {
      if (staleSig === curSig && running) return 'compacted';
      if (staleSig !== curSig) {
        compactedStaleSigByCid.delete(cidKey);
        compactedMetaByCid.delete(cidKey);
      }
    }

    if (
      manualCompactPending.cascadeId === cidKey &&
      Date.now() - manualCompactPending.startedAt < 15000
    ) {
      return 'compacting';
    }
    return 'idle';
  }

  function extractCompactLabels(ctxState, curCidArg) {
    const curCid = curCidArg !== undefined ? curCidArg : getActiveCascadeId();
    const cidKey = curCid || '__active__';
    const rawRatio = String((ctxState && ctxState.ratioText) || '');
    const parts = rawRatio.split('/');
    const preUsedFromRatio = (parts[0] || '').trim();
    const limitLabel = (parts[1] || '').trim();
    const limitTokens = parseTokenLabelToCount(limitLabel);
    const cpMeta = compactedMetaByCid.get(cidKey) || null;
    const preUsed =
      (cpMeta && cpMeta.preTokens > 0 ? fmtCompactTokens(cpMeta.preTokens) : '') || preUsedFromRatio;
    const summaryLabel =
      cpMeta && cpMeta.summaryTokens > 0 ? fmtCompactTokens(cpMeta.summaryTokens) : '';
    const summaryPct =
      cpMeta && cpMeta.summaryTokens > 0 && limitTokens > 0
        ? Math.max(1, Math.min(100, Math.round((cpMeta.summaryTokens / limitTokens) * 100)))
        : 0;
    return { preUsed, limitLabel, summaryLabel, summaryPct };
  }

  function ensureCompactPollTimer() {
    if (compactPollTimerId || disposed) return;
    compactPollTimerId = setInterval(() => {
      if (disposed) {
        clearInterval(compactPollTimerId);
        compactPollTimerId = null;
        return;
      }
      const st = detectCompactStatus();
      syncCompactVisualState(false);
      if (st !== 'compacting' && !quotaPopoverOpen) {
        clearInterval(compactPollTimerId);
        compactPollTimerId = null;
      }
    }, 500);
    if (compactPollTimerId && typeof compactPollTimerId.unref === 'function') {
      compactPollTimerId.unref();
    }
  }

  function syncCompactVisualState(forceRender) {
    if (disposed || (!FEAT.contextRing && !FEAT.overviewPanel)) return;
    const curCid = getActiveCascadeId();
    const st = detectCompactStatus(curCid);
    const running = isPaneCurrentlyRunning();
    const { summaryLabel } = extractCompactLabels(latestCtxState, curCid);
    const key = `${curCid}|${st}|${running ? '1' : '0'}|${summaryLabel}`;
    if (!forceRender && key === lastObservedCompactKey) return;
    lastObservedCompactKey = key;

    if (st === 'compacting') ensureCompactPollTimer();

    if (window.__ag_last_metrics && typeof window.__ag_render_metrics === 'function') {
      try {
        window.__ag_render_metrics(window.__ag_last_metrics);
        return;
      } catch {}
    }
    if (FEAT.contextRing) {
      updateComposerRingVisuals();
      if (quotaPopoverOpen) renderQuotaPopoverBody();
    }
    if (FEAT.overviewPanel) renderOverviewPanel(false);
  }

  async function triggerConversationCompact() {
    if (disposed) return false;
    const curCid = getActiveCascadeId();
    const cidKey = curCid || '__active__';
    const curStatus = detectCompactStatus(curCid);
    if (curStatus === 'compacting' || curStatus === 'compacted') return false;

    const agentProps = discoverAgentInputProps();
    if (isPaneCurrentlyRunning(agentProps)) return false;

    manualCompactPending = { cascadeId: cidKey, startedAt: Date.now() };
    syncCompactVisualState(true);
    ensureCompactPollTimer();

    try {
      if (agentProps && typeof agentProps.handleSubmit === 'function') {
        const hasSlashList = Array.isArray(agentProps.slashCommandItems);
        const slashItems = hasSlashList ? agentProps.slashCommandItems : [];
        const compactDef = slashItems.find(
          (x) => x && (x.title === 'compact' || (x.info && x.info.name === 'compact'))
        );
        if (!compactDef || !compactDef.info) {
          /* Never fabricate a hard-coded SlashCommandInfo proto if official /compact definition is absent */
          manualCompactPending = { cascadeId: '', startedAt: 0 };
          syncCompactVisualState(true);
          return false;
        }
        const slashInfo = compactDef.info;
        const submitItems = [
          {
            $typeName: 'exa.codeium_common_pb.TextOrScopeItem',
            chunk: {
              case: 'item',
              value: {
                $typeName: 'exa.codeium_common_pb.ContextScopeItem',
                scopeItem: {
                  case: 'slashCommand',
                  value: {
                    $typeName: 'exa.codeium_common_pb.SlashCommandScopeItem',
                    argumentValues: {},
                    info: slashInfo
                  }
                }
              }
            }
          },
          {
            $typeName: 'exa.codeium_common_pb.TextOrScopeItem',
            chunk: {
              case: 'text',
              value: ' '
            }
          }
        ];
        await agentProps.handleSubmit(submitItems, [], () => {});
        syncCompactVisualState(true);
        return true;
      }

      const compCtx = discoverComposerContextFromInputBox();
      if (compCtx && !composerHasExistingDraft(compCtx)) {
        setComposerText(compCtx, '/compact ');
        const ref = compCtx.inputBoxRef && compCtx.inputBoxRef.current;
        if (ref && typeof ref.submit === 'function') {
          ref.submit();
          syncCompactVisualState(true);
          return true;
        }
      }
    } catch {}

    manualCompactPending = { cascadeId: '', startedAt: 0 };
    syncCompactVisualState(true);
    return false;
  }

  function fmtCompactTokens(n) {
    if (!Number.isFinite(n) || n < 0) return '';
    if (n < 1000) return String(Math.round(n));
    const k = n / 1000;
    return (k >= 100 ? String(Math.round(k)) : k.toFixed(1).replace(/\.0$/, '')) + 'k';
  }

  function fmtDurationSec(sec) {
    if (!Number.isFinite(sec) || sec < 0) return '';
    if (sec >= 60) {
      const total = Math.round(sec);
      const mins = Math.floor(total / 60);
      const rem = total % 60;
      return `${mins}m ${rem}s`;
    }
    return `${sec.toFixed(1)}s`;
  }

  function cacheTierForRate(rate) {
    if (!Number.isFinite(rate)) return '';
    const pct = Math.round(rate);
    if (pct >= 90) return 'high';
    if (pct >= 85) return 'mid';
    return 'low';
  }

  function parseMetricsTooltipData(rawTooltip) {
    if (!rawTooltip || typeof rawTooltip !== 'string') return null;
    const tmp = document.createElement('div');
    tmp.innerHTML = rawTooltip;
    const data = {
      streamTps: NaN,
      isBuffered: false,
      ttftSec: NaN,
      isHold: false,
      stepDur: NaN,
      lastCacheRate: NaN,
      stepOut: NaN,
      turnSteps: 1,
      turnOut: NaN,
      turnDur: NaN,
      sessionTurns: 1,
      sessionCalls: 1,
      ctxRatio: '',
      ctxPct: '',
      sessionCacheRate: NaN,
      sessionTotalOut: '',
      subLabel: '',
      subSub: '',
      warnHtml: ''
    };

    const secHdr = tmp.querySelector('.ag-tt-hdr.ag-tt-sec');
    if (secHdr) {
      const m = (secHdr.textContent || '').match(/(\d+)\s*轮提问\s*\/\s*(\d+)\s*次/);
      if (m) {
        data.sessionTurns = Number(m[1]) || 1;
        data.sessionCalls = Number(m[2]) || 1;
      }
    }

    tmp.querySelectorAll('.ag-tt-row').forEach((row) => {
      const lbl = (row.querySelector('.ag-tt-lbl')?.textContent || '').trim();
      const val = (row.querySelector('.ag-tt-val')?.textContent || '').trim();
      if (!lbl) return;

      if (lbl === '生成速度') {
        const sm = val.match(/流式\s*([\d.]+)\s*tok\/s/i);
        if (sm) {
          data.streamTps = Number(sm[1]);
          data.isBuffered = false;
        } else {
          const em = val.match(/([\d.]+)\s*tok\/s/i);
          if (em) {
            data.streamTps = Number(em[1]);
            data.isBuffered = true;
          }
        }
      } else if (lbl === '响应耗时') {
        const fm = val.match(/(TTFT|等待)\s*([\d.]+)s/i);
        if (fm) {
          data.isHold = fm[1] === '等待';
          data.ttftSec = Number(fm[2]);
        }
        const tm = val.match(/总计\s*([\d.]+)s/i);
        if (tm) data.stepDur = Number(tm[1]);
      } else if (lbl === '当前上下文') {
        const cm = val.match(/,\s*([\d.]+)%\)/);
        if (cm) data.lastCacheRate = Number(cm[1]);
      } else if (lbl === '本步输出量') {
        const om = val.match(/^([\d,]+)/);
        if (om) data.stepOut = Number(om[1].replace(/,/g, ''));
      } else if (/^本轮合计/.test(lbl)) {
        const sm = lbl.match(/\((\d+)\s*步\)/);
        if (sm) data.turnSteps = Number(sm[1]) || 1;
        const om = val.match(/^输出\s*([\d,]+)/);
        if (om) data.turnOut = Number(om[1].replace(/,/g, ''));
        const dm = val.match(/耗时\s*([\d.]+)s/i);
        if (dm) data.turnDur = Number(dm[1]);
      } else if (lbl === '压缩水位线') {
        const wm = val.match(/^(.+?)\s*\((\d+%)\)/);
        if (wm) {
          data.ctxRatio = wm[1].trim();
          data.ctxPct = wm[2];
        }
      } else if (lbl === '累计输入量') {
        const hm = val.match(/命中率\s*([\d.]+)%/);
        if (hm) data.sessionCacheRate = Number(hm[1]);
      } else if (/^子\s*Agent/i.test(lbl)) {
        const cm = lbl.match(/\((\d+)/);
        const syncing = lbl.includes('同步中');
        if (cm) {
          data.subLabel = `+${cm[1]} 个`;
          const outM = val.match(/输出\s*([^\s·]+)/);
          if (outM) data.subSub = `输出 ${outM[1]}`;
          else if (syncing) data.subSub = '同步中';
        } else if (syncing) {
          data.subLabel = '同步中';
        }
      } else if (lbl === '累计输出量') {
        const om = val.match(/总计\s*([^\s(]+)/);
        if (om) data.sessionTotalOut = om[1];
      }
    });

    const warnEl = tmp.querySelector('.ag-tt-warn');
    if (warnEl) data.warnHtml = warnEl.outerHTML;

    if (!Number.isFinite(data.streamTps) && !data.ctxRatio) return null;
    return data;
  }

  function buildSlimMetricsTooltipHtml(d, ctxFallback, compactStatus) {
    const esc = (s) =>
      String(s || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
    const row = (lbl, valHtml) =>
      `<div class="ag-ux-tt-row"><span class="ag-ux-tt-lbl">${esc(lbl)}</span><span class="ag-ux-tt-val">${valHtml}</span></div>`;

    const steps = d.turnSteps > 1 ? d.turnSteps : 1;
    const durVal = Number.isFinite(d.turnDur) ? d.turnDur : d.stepDur;
    const outVal = Number.isFinite(d.turnOut) ? d.turnOut : d.stepOut;
    const tpsText =
      Number.isFinite(d.streamTps) && d.streamTps > 0
        ? d.streamTps < 1
          ? d.streamTps.toFixed(1)
          : String(Math.round(d.streamTps))
        : '';
    const speedHtml = tpsText
      ? `${tpsText} tok/s${d.isBuffered ? `<span class="ag-ux-tt-sub">${L('缓冲', 'buffered')}</span>` : ''}`
      : '—';
    const ttftHtml = Number.isFinite(d.ttftSec) ? fmtDurationSec(d.ttftSec) : '';
    const durHtml = fmtDurationSec(durVal) || '—';
    const outHtml = fmtCompactTokens(outVal) || '—';

    const ctxRatio = d.ctxRatio || ctxFallback.ratioText || '';
    const ctxPct = d.ctxPct || (ctxFallback.hasData ? `${ctxFallback.pct}%` : '');
    const { preUsed, limitLabel, summaryLabel } = extractCompactLabels(
      { ratioText: ctxRatio },
      ctxFallback && ctxFallback.cascadeId
    );
    let ctxHtml = '—';
    if (compactStatus === 'compacting') {
      ctxHtml = `${L('压缩中…', 'Compacting…')}${preUsed ? `<span class="ag-ux-tt-sub">${L('原 ', 'was ')}${esc(preUsed)}</span>` : ''}`;
    } else if (compactStatus === 'compacted') {
      ctxHtml =
        summaryLabel && limitLabel
          ? `${esc(summaryLabel)} / ${esc(limitLabel)}<span class="ag-ux-tt-sub">${L('已压缩', 'Compacted')}${preUsed ? ` · ${L('原 ', 'was ')}${esc(preUsed)}` : ''}</span>`
          : `${L('已压缩', 'Compacted')}${preUsed ? `<span class="ag-ux-tt-sub">${L('原 ', 'was ')}${esc(preUsed)}</span>` : ''}`;
    } else if (ctxRatio) {
      ctxHtml = `${esc(ctxRatio)}${ctxPct ? `<span class="ag-ux-tt-sub">${esc(ctxPct)}</span>` : ''}`;
    }

    const lastCache = Number.isFinite(d.lastCacheRate) ? `${Math.round(d.lastCacheRate)}%` : '';
    const lastTier = cacheTierForRate(d.lastCacheRate);
    const sessCache = Number.isFinite(d.sessionCacheRate) ? `${Math.round(d.sessionCacheRate)}%` : '';
    const sessTier = cacheTierForRate(d.sessionCacheRate);
    const cacheHtml = lastCache
      ? `<span class="ag-ux-tt-cache" data-cache-tier="${lastTier}">${lastCache}</span>${sessCache ? `<span class="ag-ux-tt-sub">${L('累计 ', 'avg ')}${sessCache}</span>` : ''}`
      : sessCache
        ? `<span class="ag-ux-tt-cache" data-cache-tier="${sessTier}">${sessCache}</span>`
        : '—';

    const sec1List = [row(L('生成速度', 'Speed'), speedHtml)];
    if (ttftHtml) {
      sec1List.push(row(d.isHold ? L('首包等待', 'Hold') : L('首字耗时', 'TTFT'), ttftHtml));
    }
    sec1List.push(row(L('本轮耗时', 'Duration'), durHtml), row(L('本轮输出', 'Output'), outHtml));

    const sec2List = [row(L('上下文', 'Context'), ctxHtml), row(L('缓存命中', 'Cache hit'), cacheHtml)];
    if ((d.sessionTurns > 1 || d.subLabel) && d.sessionTotalOut) {
      sec2List.push(row(L('累计输出', 'Total out'), esc(d.sessionTotalOut)));
    }
    if (d.subLabel) {
      const subDisplay = FEAT.i18n ? d.subLabel : d.subLabel.replace(/\s*个$/, '').replace('同步中', 'syncing');
      const subSubDisplay = FEAT.i18n ? d.subSub : String(d.subSub || '').replace(/^输出\s+/, 'out ').replace('同步中', 'syncing');
      sec2List.push(
        row(
          L('子 Agent', 'Subagents'),
          `${esc(subDisplay)}${subSubDisplay ? `<span class="ag-ux-tt-sub">${esc(subSubDisplay)}</span>` : ''}`
        )
      );
    }

    return (
      `<div class="ag-ux-tt">` +
      `<div class="ag-ux-tt-sec">` +
      `<div class="ag-ux-tt-hdr"><span class="ag-ux-tt-title">${L('本轮响应', 'This turn')}</span><span class="ag-ux-tt-badge">${FEAT.i18n ? `${steps} 步` : `${steps} ${steps === 1 ? 'step' : 'steps'}`}</span></div>` +
      sec1List.join('') +
      `</div>` +
      `<div class="ag-ux-tt-div"></div>` +
      `<div class="ag-ux-tt-sec">` +
      `<div class="ag-ux-tt-hdr"><span class="ag-ux-tt-title">${L('当前会话', 'Session')}</span><span class="ag-ux-tt-badge">${FEAT.i18n ? `${d.sessionTurns} 轮` : `${d.sessionTurns} ${d.sessionTurns === 1 ? 'turn' : 'turns'}`}</span></div>` +
      sec2List.join('') +
      `</div>` +
      (d.warnHtml || '') +
      `</div>`
    );
  }

  function parseAndSlimMetricsPayload(payload) {
    if (!payload || typeof payload !== 'object') return payload;
    const rawInline = payload.__agOrigInlineHtml || payload.inlineHtml || '';
    const rawTooltip = payload.__agOrigTooltipHtml || payload.tooltipHtml || '';
    const curCid = getActiveCascadeId();

    if (payload.hasData && rawInline && (!curCid || payload.cascadeId === curCid)) {
      const parsedTt = parseMetricsTooltipData(rawTooltip);
      const tmp = document.createElement('div');
      tmp.innerHTML = rawInline;
      let ratioText = '';
      let pct = 0;
      let outText = '';

      const kids = Array.from(tmp.children);
      for (let i = 0; i < kids.length; i++) {
        const el = kids[i];
        const txt = (el.textContent || '').trim();
        if (/^0(?:\.0+)?\s*tok\/s$/i.test(txt)) {
          if (parsedTt && Number.isFinite(parsedTt.streamTps) && parsedTt.streamTps > 0 && parsedTt.streamTps < 1) {
            el.textContent = `${parsedTt.streamTps.toFixed(1)} tok/s`;
          } else {
            const next = el.nextElementSibling;
            if (next && next.classList.contains('ag-sep')) next.remove();
            else if (el.previousElementSibling && el.previousElementSibling.classList.contains('ag-sep')) {
              el.previousElementSibling.remove();
            }
            el.remove();
          }
        } else if (/^(TTFT|Hold)\s+([\d.]+)s$/i.test(txt)) {
          const dm = txt.match(/^(TTFT|Hold)\s+([\d.]+)s$/i);
          const sec = dm ? Number(dm[2]) : NaN;
          if (Number.isFinite(sec) && sec >= 60) {
            el.textContent = `${dm[1]} ${fmtDurationSec(sec)}`;
          }
        } else if (/^Ctx\b/i.test(txt)) {
          const m = txt.match(/Ctx\s+([^\s(]+)\s*(?:\((\d+)%\))?/i);
          if (m) {
            ratioText = m[1].replace('/', ' / ');
            pct = Math.max(0, Math.min(100, Number(m[2] || 0)));
          }
          const prev = el.previousElementSibling;
          if (prev && prev.classList.contains('ag-sep')) prev.remove();
          el.remove();
        } else if (/^Out\b/i.test(txt)) {
          outText = txt;
          const prev = el.previousElementSibling;
          if (prev && prev.classList.contains('ag-sep')) prev.remove();
          el.remove();
        } else if (el.classList.contains('ag-sub-badge') || /^\+?\d+\s*sub\b/i.test(txt)) {
          const prev = el.previousElementSibling;
          if (prev && prev.classList.contains('ag-sep')) prev.remove();
          el.remove();
        }
      }
      while (tmp.firstElementChild && tmp.firstElementChild.classList.contains('ag-sep')) {
        tmp.firstElementChild.remove();
      }

      latestCtxState = {
        pct,
        ratioText,
        outText,
        hasData: Boolean(ratioText),
        cascadeId: payload.cascadeId || curCid
      };

      const compactStatus = detectCompactStatus(curCid);
      const nextTooltipHtml = parsedTt
        ? buildSlimMetricsTooltipHtml(parsedTt, latestCtxState, compactStatus)
        : rawTooltip;
      const slimmed = Object.assign({}, payload, {
        __agOrigInlineHtml: rawInline,
        __agOrigTooltipHtml: rawTooltip,
        inlineHtml: tmp.innerHTML,
        tooltipHtml: nextTooltipHtml
      });
      return slimmed;
    }

    if (!curCid || payload.cascadeId !== curCid || !payload.hasData) {
      latestCtxState = { pct: 0, ratioText: '', outText: '', hasData: false, cascadeId: curCid };
    }
    return payload;
  }

  function positionMetricsTooltip(pill, tt) {
    if (!pill || !tt || !tt.querySelector('.ag-ux-tt')) return;
    const textEl = pill.querySelector('#ag-live-metrics-text');
    const anchor = textEl && textEl.offsetWidth > 0 ? textEl : pill;
    const r = anchor.getBoundingClientRect();
    const pillRect = pill.getBoundingClientRect();
    const ttWidth = 272;
    const isBottomRow = pill.getAttribute('data-ag-row-mode') === 'bottom';
    const idealLeft = isBottomRow ? r.left + r.width / 2 - ttWidth / 2 : r.left;
    const left = Math.round(Math.max(12, Math.min(idealLeft, window.innerWidth - ttWidth - 16)));
    const bottomPx = Math.round(
      Math.max(8, Math.min(window.innerHeight - pillRect.top + 8, window.innerHeight - (tt.offsetHeight || 220) - 12))
    );
    tt.style.left = `${left}px`;
    tt.style.bottom = `${bottomPx}px`;
  }

  const onMetricsPillMouseEnter = (e) => {
    if (disposed || !FEAT.contextRing) return;
    const pill = e.target && e.target.closest && e.target.closest('#ag-live-metrics-pill');
    if (!pill) return;
    const syncPos = () => {
      const tt = document.getElementById('ag-live-metrics-tooltip');
      if (tt) positionMetricsTooltip(pill, tt);
    };
    syncPos();
    queueMicrotask(syncPos);
  };

  const onMetricsPillMouseLeave = (e) => {
    if (disposed) return;
    const pill = e.target && e.target.closest && e.target.closest('#ag-live-metrics-pill');
    if (!pill) return;
    const tt = document.getElementById('ag-live-metrics-tooltip');
    if (tt && tt.getAttribute('data-ag-pinned') === '1') {
      tt.setAttribute('data-visible', '1');
    }
  };

  const onMetricsPillClick = (e) => {
    if (disposed || !FEAT.contextRing) return;
    const pill = e.target && e.target.closest && e.target.closest('#ag-live-metrics-pill');
    const tt = document.getElementById('ag-live-metrics-tooltip');
    if (!tt) return;
    if (pill) {
      e.preventDefault();
      e.stopPropagation();
      const willPin = tt.getAttribute('data-ag-pinned') !== '1';
      if (willPin) {
        positionMetricsTooltip(pill, tt);
        tt.setAttribute('data-ag-pinned', '1');
        tt.setAttribute('data-visible', '1');
      } else {
        tt.removeAttribute('data-ag-pinned');
        tt.removeAttribute('data-visible');
      }
      return;
    }
    if (tt.getAttribute('data-ag-pinned') === '1' && !tt.contains(e.target)) {
      tt.removeAttribute('data-ag-pinned');
      tt.removeAttribute('data-visible');
    }
  };

  document.addEventListener('mouseenter', onMetricsPillMouseEnter, true);
  document.addEventListener('mouseleave', onMetricsPillMouseLeave, true);
  document.addEventListener('click', onMetricsPillClick, true);

  /* Wrapped lazily (retried every sync) so load order vs. the upstream runtime does not matter.
     A stale wrapper left by an older instance is unwrapped first; after dispose or feature toggle-off ours restores original HTML. */
  let ownMetricsWrapper = null;
  function ensureMetricsWrapped() {
    let cur = window.__ag_render_metrics;
    if (typeof cur !== 'function' || cur === ownMetricsWrapper) return;
    while (cur && cur.__agSlimWrapped && typeof cur.__agOrig === 'function') cur = cur.__agOrig;
    const origRenderMetrics = cur;
    const wrappedRender = function (payload) {
      if (disposed || !FEAT.contextRing) {
        const rawPayload =
          payload && typeof payload === 'object'
            ? Object.assign({}, payload, {
                inlineHtml: payload.__agOrigInlineHtml !== undefined ? payload.__agOrigInlineHtml : payload.inlineHtml,
                tooltipHtml: payload.__agOrigTooltipHtml !== undefined ? payload.__agOrigTooltipHtml : payload.tooltipHtml
              })
            : payload;
        const ret = origRenderMetrics.call(this, rawPayload);
        if (!disposed && FEAT.overviewPanel) renderOverviewPanel(false);
        return ret;
      }
      const slimPayload = parseAndSlimMetricsPayload(payload);
      const ret = origRenderMetrics.call(this, slimPayload);
      if (payload && payload.__agOrigInlineHtml === undefined && window.__ag_last_metrics === slimPayload) {
        window.__ag_last_metrics.__agOrigInlineHtml = payload.inlineHtml;
      }
      if (payload && payload.__agOrigTooltipHtml === undefined && window.__ag_last_metrics === slimPayload) {
        window.__ag_last_metrics.__agOrigTooltipHtml = payload.tooltipHtml;
      }
      updateComposerRingVisuals();
      if (quotaPopoverOpen) renderQuotaPopoverBody();
      if (FEAT.overviewPanel) renderOverviewPanel(false);
      if (payload && payload.hasData && payload.stats) {
        const nextUsageSig = `${payload.cascadeId || ''}:${payload.stats.calls || 0}:${payload.stats.turns || 0}:${payload.stats.childCalls || 0}`;
        const prevCid = lastQuotaUsageSig ? lastQuotaUsageSig.split(':')[0] : '';
        const curCidSig = String(payload.cascadeId || '');
        if (!lastQuotaUsageSig || prevCid !== curCidSig) {
          lastQuotaUsageSig = nextUsageSig;
          if ((isOverviewPanelVisible() || quotaPopoverOpen) && Date.now() - lastForceQuotaFetchTs >= 8000) {
            scheduleAutoQuotaRefresh(250, 5000);
          }
        } else if (nextUsageSig !== lastQuotaUsageSig) {
          lastQuotaUsageSig = nextUsageSig;
          if (FEAT.overviewPanel || FEAT.contextRing) {
            scheduleAutoQuotaRefresh(650, 4500);
          }
        }
      }
      return ret;
    };
    wrappedRender.__agSlimWrapped = true;
    wrappedRender.__agOrig = origRenderMetrics;
    ownMetricsWrapper = wrappedRender;
    window.__ag_render_metrics = wrappedRender;

    if (window.__ag_last_metrics) {
      window.__ag_render_metrics(window.__ag_last_metrics);
    }
  }
  ensureMetricsWrapped();

  let lastQuotaSvcMissTs = 0;
  function discoverQuotaService(refreshAccount = false) {
    if (!refreshAccount && cachedQuotaSvc && cachedUserTierName && cachedUserAccountKey) return cachedQuotaSvc;
    if (!refreshAccount && !cachedQuotaSvc && lastQuotaSvcMissTs && Date.now() - lastQuotaSvcMissTs < 5000) {
      return null;
    }
    const inputBox = getActiveInputBox();
    const fk = inputBox ? Object.keys(inputBox).find((k) => k.startsWith('__reactFiber$')) : null;
    let f = fk ? inputBox[fk] : null;
    const seen = new Set();
    let foundSvc = null;
    let foundTierName = '';
    let foundTierId = '';
    let foundEmail = '';

    const walkObj = (obj, depth) => {
      if (!obj || typeof obj !== 'object' || depth > 4 || seen.has(obj)) return;
      seen.add(obj);
      try {
        if (!foundSvc && typeof obj.retrieveUserQuotaSummary === 'function') {
          foundSvc = obj;
        }
        if (!foundTierName && obj.userTier && typeof obj.userTier.name === 'string' && obj.userTier.name.trim()) {
          foundTierName = obj.userTier.name.trim();
          foundTierId = typeof obj.userTier.id === 'string' ? obj.userTier.id.trim() : '';
          foundEmail = typeof obj.email === 'string' ? obj.email : typeof obj.userEmail === 'string' ? obj.userEmail : '';
        }
      } catch {}
      let keys = [];
      try {
        keys = Object.keys(obj).slice(0, 40);
      } catch {}
      for (const k of keys) {
        try {
          const v = obj[k];
          if (v && typeof v === 'object') walkObj(v, depth + 1);
        } catch {}
      }
    };

    for (let n = 0; n < 45 && f; n++, f = f.return) {
      walkObj(f.memoizedProps, 0);
      walkObj(f.memoizedState, 0);
      let dep = f.dependencies ? f.dependencies.firstContext : null;
      while (dep) {
        walkObj(dep.memoizedValue, 0);
        dep = dep.next;
      }
      if ((!foundSvc || !foundTierName) && f.alternate) {
        walkObj(f.alternate.memoizedProps, 0);
        walkObj(f.alternate.memoizedState, 0);
        let altDep = f.alternate.dependencies ? f.alternate.dependencies.firstContext : null;
        while (altDep) {
          walkObj(altDep.memoizedValue, 0);
          altDep = altDep.next;
        }
      }
      if (foundSvc && foundTierName) break;
    }

    if (!foundSvc || !foundTierName) {
      const root = document.getElementById('root');
      const rfk = root && Object.keys(root).find((k) => k.startsWith('__reactContainer') || k.startsWith('__reactFiber'));
      if (rfk && root[rfk]) {
        const rq = [root[rfk]];
        const rSeen = new Set();
        while (rq.length && rSeen.size < 320 && (!foundSvc || !foundTierName)) {
          const rf = rq.shift();
          if (!rf || rSeen.has(rf)) continue;
          rSeen.add(rf);
          walkObj(rf.memoizedProps, 0);
          for (let dep = rf.dependencies && rf.dependencies.firstContext; dep; dep = dep.next) {
            walkObj(dep.memoizedValue, 0);
          }
          if (rf.child) rq.push(rf.child);
          if (rf.sibling) rq.push(rf.sibling);
        }
      }
    }

    if (foundSvc) {
      cachedQuotaSvc = foundSvc;
      lastQuotaSvcMissTs = 0;
    } else {
      lastQuotaSvcMissTs = Date.now();
    }
    if (foundTierName) {
      const nextAccountKey = `${foundEmail}|${foundTierId}|${foundTierName}`;
      if (cachedUserAccountKey && cachedUserAccountKey !== nextAccountKey) {
        cachedQuotaGroups = null;
        lastQuotaFetchTs = 0;
        selectedQuotaGroupIdx = -1;
      }
      cachedUserTierName = foundTierName;
      cachedUserAccountKey = nextAccountKey;
    }
    return cachedQuotaSvc;
  }

  function invokeQuotaSummaryRpc(svc, forceRefresh) {
    const fn = svc && svc.retrieveUserQuotaSummary;
    if (typeof fn !== 'function') return Promise.resolve(null);
    let wantsBool = Boolean(
      typeof svc.loadCodeAssist === 'function' || typeof svc.getUserAccountSettings === 'function'
    );
    if (!wantsBool && typeof svc.getUserStatus !== 'function') {
      try {
        const src = Function.prototype.toString.call(fn).trim();
        wantsBool =
          fn.length === 1 &&
          !/\.forceRefresh\b/.test(src) &&
          /^(?:async\s+)?(?:function\s*\w*\s*\(\s*forceRefresh\s*\)|(?:\(\s*)?forceRefresh(?:\s*\))?\s*=>)/.test(src);
      } catch {}
    }
    const arg = wantsBool ? Boolean(forceRefresh) : { forceRefresh: Boolean(forceRefresh) };
    return new Promise((resolve) => resolve(svc.retrieveUserQuotaSummary(arg)));
  }

  function isOverviewPanelVisible() {
    if (!FEAT.overviewPanel) return false;
    const panel = document.querySelector('[data-testid="overview-panel"]');
    return Boolean(panel && !panel.hidden && panel.getAttribute('aria-hidden') !== 'true');
  }

  function scheduleAutoQuotaRefresh(delayMs = 650, minGapMs = 5000) {
    if (disposed) return;
    if (autoQuotaRefreshTimer) {
      cancelLater(autoQuotaRefreshTimer);
      autoQuotaRefreshTimer = 0;
    }
    const sinceLast = Date.now() - lastForceQuotaFetchTs;
    const waitMs = Math.max(delayMs, lastForceQuotaFetchTs > 0 ? minGapMs - sinceLast : delayMs);
    autoQuotaRefreshTimer = later(() => {
      autoQuotaRefreshTimer = 0;
      if (disposed) return;
      if (typeof document.visibilityState === 'string' && document.visibilityState === 'hidden') return;
      if (discoverQuotaService(false)) {
        fetchQuotaSummary(true);
      }
    }, Math.max(60, waitMs));
  }

  function fetchQuotaSummary(forceRefresh = false) {
    const svc = discoverQuotaService();
    if (!svc) return Promise.resolve(cachedQuotaGroups || []);
    const now = Date.now();
    if (!forceRefresh && cachedQuotaGroups && now - lastQuotaFetchTs < 5000) {
      return Promise.resolve(cachedQuotaGroups);
    }
    if (quotaFetchInFlight) return quotaFetchInFlight;

    quotaFetchInFlight = invokeQuotaSummaryRpc(svc, forceRefresh)
      .then((res) => {
        if (disposed) return [];
        const rawGroups = (res && res.response && res.response.groups) || (res && res.groups) || [];
        cachedQuotaGroups = rawGroups.filter((g) => g && Array.isArray(g.buckets) && g.buckets.length > 0);
        lastQuotaFetchTs = Date.now();
        if (forceRefresh) lastForceQuotaFetchTs = lastQuotaFetchTs;
        persistQuotaSnapshot();
        if (quotaHoldTimer) {
          cancelLater(quotaHoldTimer);
          quotaHoldTimer = 0;
        }
        const popEl = document.getElementById('ag-claude-quota-popover');
        if (popEl) popEl.removeAttribute('data-loading-hold');
        if (quotaPopoverOpen) renderQuotaPopoverBody();
        if (FEAT.overviewPanel) renderOverviewPanel(false);
        return cachedQuotaGroups;
      })
      .catch(() => {
        cachedQuotaSvc = null; /* service object may belong to an unmounted tree: rediscover next time */
        if (quotaHoldTimer) {
          cancelLater(quotaHoldTimer);
          quotaHoldTimer = 0;
        }
        const popEl = document.getElementById('ag-claude-quota-popover');
        if (popEl) popEl.removeAttribute('data-loading-hold');
        return cachedQuotaGroups || [];
      })
      .finally(() => {
        quotaFetchInFlight = null;
      });
    return quotaFetchInFlight;
  }

  function formatResetLabel(bucket, usedPct) {
    const win = String(bucket.window || '').trim().toLowerCase();
    const secStr = bucket.resetTime && bucket.resetTime.seconds !== undefined ? String(bucket.resetTime.seconds) : '';
    const resetMs = secStr ? Number(secStr) * 1000 : 0;

    if (win === '5h' && usedPct === 0 && !bucket.description) {
      return L('从发送第一条消息时起算', 'Starts on first message');
    }
    if (!resetMs || Number.isNaN(resetMs)) {
      return usedPct === 0 ? L('从发送第一条消息时起算', 'Starts on first message') : '';
    }
    const diffMs = resetMs - Date.now();
    if (diffMs <= 60000) return L('即将重置', 'Resets soon');

    if (win === 'weekly') {
      const dt = new Date(resetMs);
      const weekdaysZh = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
      const weekdaysEn = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
      const hh = String(dt.getHours()).padStart(2, '0');
      const mm = String(dt.getMinutes()).padStart(2, '0');
      return FEAT.i18n ? `${weekdaysZh[dt.getDay()]} ${hh}:${mm} 重置` : `Resets ${weekdaysEn[dt.getDay()]} ${hh}:${mm}`;
    }

    const totalMins = Math.floor(diffMs / 60000);
    const hrs = Math.floor(totalMins / 60);
    const mins = totalMins % 60;
    if (hrs > 0) {
      if (FEAT.i18n) return mins > 0 ? `${hrs} 小时 ${mins} 分后重置` : `${hrs} 小时后重置`;
      return mins > 0 ? `Resets in ${hrs}h ${mins}m` : `Resets in ${hrs}h`;
    }
    const m = Math.max(1, mins);
    return FEAT.i18n ? `${m} 分钟后重置` : `Resets in ${m}m`;
  }

  function localizeGroupShortName(name) {
    const s = String(name || '').trim();
    if (!s) return L('全部模型', 'All models');
    if (/^gemini(?:\s+models?)?$/i.test(s)) return L('Gemini 模型', 'Gemini');
    if (/claude/i.test(s) && /gpt/i.test(s)) return 'Claude / GPT';
    if (/^claude(?:\s+models?)?$/i.test(s)) return L('Claude 模型', 'Claude');
    return s;
  }

  function detectDefaultGroupIndex(groups) {
    if (!groups || groups.length <= 1) return 0;
    const inputBox = document.getElementById('antigravity.agentSidePanelInputBox');
    const trigger = inputBox && inputBox.querySelector('button[data-testid="model-selector-trigger"]');
    const txt = ((trigger ? trigger.textContent : inputBox ? inputBox.textContent : '') || '').trim().toLowerCase();
    const specificIdx = groups.findIndex((g) => {
      const dn = String(g.displayName || '').trim().toLowerCase();
      return dn && !/^gemini(?:\s+models?)?$/.test(dn) && !(/claude/.test(dn) && /gpt/.test(dn)) && txt.includes(dn);
    });
    if (specificIdx >= 0) return specificIdx;
    const want3p = /claude|sonnet|opus|gpt/i.test(txt);
    const exactFamilyIdx = groups.findIndex((g) => {
      const dn = String(g.displayName || '').trim();
      return want3p ? /claude|gpt/i.test(dn) : /^gemini(?:\s+models?)?$/i.test(dn);
    });
    if (exactFamilyIdx >= 0) return exactFamilyIdx;
    const broadIdx = groups.findIndex((g) =>
      want3p ? /claude|gpt/i.test(g.displayName || '') : /gemini/i.test(g.displayName || '')
    );
    return broadIdx >= 0 ? broadIdx : 0;
  }

  function barColorForPct(pct, warnAt = 70, critAt = 85) {
    if (pct >= critAt) return '#DC2626';
    if (pct >= warnAt) return '#D97706';
    return 'var(--primary, #2F75C3)';
  }

  function ensureQuotaPopover() {
    let pop = document.getElementById('ag-claude-quota-popover');
    if (pop) return pop;
    pop = document.createElement('div');
    pop.id = 'ag-claude-quota-popover';
    pop.setAttribute('data-ag-i18n-ignore', '1');
    pop.setAttribute('data-open', 'false');
    pop.addEventListener('click', (e) => {
      const compactBtn = e.target.closest('[data-ag-qp-compact]');
      if (compactBtn) {
        e.preventDefault();
        e.stopPropagation();
        if (!compactBtn.disabled) triggerConversationCompact();
        return;
      }
      const tabBtn = e.target.closest('[data-ag-quota-tab]');
      if (tabBtn) {
        e.stopPropagation();
        selectedQuotaGroupIdx = Number(tabBtn.getAttribute('data-ag-quota-tab')) || 0;
        renderQuotaPopoverBody();
        return;
      }
      const viewAll = e.target.closest('[data-ag-quota-view-all]');
      if (viewAll) {
        e.stopPropagation();
        closeQuotaPopover();
        const settingsBtn = document.querySelector('button[data-testid="settings-button"]');
        if (settingsBtn) {
          settingsBtn.click();
          let tries = 0;
          const jumpModels = () => {
            const modelsBtn = document.querySelector('button[data-testid="settings-nav-item-Models"]');
            if (modelsBtn) {
              modelsBtn.click();
            } else if (++tries < 12) {
              frame(jumpModels);
            }
          };
          frame(jumpModels);
        }
      }
    });
    document.body.appendChild(pop);
    return pop;
  }

  function positionQuotaPopover() {
    const ring = document.getElementById('ag-claude-ctx-ring');
    const pop = document.getElementById('ag-claude-quota-popover');
    if (!ring || !pop) return;
    const r = ring.getBoundingClientRect();
    const popW = 344;
    const left = Math.max(12, Math.min(Math.round(r.left - 84), window.innerWidth - popW - 14));
    const bottom = Math.max(12, Math.round(window.innerHeight - r.top + 10));
    pop.style.left = `${left}px`;
    pop.style.bottom = `${bottom}px`;
  }

  function formatQuotaUsedPctStr(val) {
    const clamped = Math.max(0, Math.min(100, val));
    if (clamped <= 0) return '0';
    if (clamped >= 99.95) return '100';
    return clamped.toFixed(1).replace(/\.0$/, '');
  }

  function renderQuotaPopoverBody() {
    const pop = ensureQuotaPopover();
    const curCid = getActiveCascadeId();
    const hasCtx = Boolean(curCid && latestCtxState.cascadeId === curCid && latestCtxState.hasData);
    const compactStatus = detectCompactStatus(curCid);
    const paneRunning = isPaneCurrentlyRunning();
    const { preUsed, limitLabel, summaryLabel, summaryPct } = extractCompactLabels(latestCtxState, curCid);

    let ctxPct = hasCtx ? latestCtxState.pct : 0;
    let ctxPctLabel = `${ctxPct}%`;
    let ctxSub = hasCtx
      ? `${latestCtxState.ratioText}${latestCtxState.outText ? ` · ${latestCtxState.outText}` : ''}`
      : L('当前会话暂无消耗', 'No usage yet');
    let ctxColor = barColorForPct(ctxPct, 70, 85);
    let fillCompactingAttr = '';
    let compactBtnHtml = '';

    if (compactStatus === 'compacting') {
      ctxPct = 14;
      ctxPctLabel = '…';
      ctxSub = preUsed ? L(`正在压缩 ${preUsed}…`, `Compacting ${preUsed}…`) : L('正在生成压缩摘要…', 'Summarizing context…');
      ctxColor = 'var(--primary, #2F75C3)';
      fillCompactingAttr = ' data-compacting="true"';
      compactBtnHtml = `<button type="button" class="ag-qp-compact-btn" data-ag-qp-compact="true" data-state="compacting" disabled title="${escapeHtml(L('正在总结历史并压缩上下文…', 'Summarizing history and compacting context…'))}">${SVG_COMPACT_ICON}<span>${L('压缩中…', 'Compacting…')}</span></button>`;
    } else if (compactStatus === 'compacted') {
      if (summaryLabel && limitLabel) {
        ctxPct = Math.max(2, summaryPct);
        ctxPctLabel = `${summaryPct}%`;
        ctxSub = `${summaryLabel} / ${limitLabel}`;
      } else {
        ctxPct = hasCtx ? 2 : 0;
        ctxPctLabel = '—';
        ctxSub = L('已完成压缩 · 下轮刷新', 'Compacted · refreshes next turn');
      }
      ctxColor = 'var(--primary, #2F75C3)';
      const doneTitle =
        preUsed && summaryLabel
          ? L(
              `已将 ${preUsed} 上下文压缩为 ${summaryLabel} 摘要，发下一条消息即按新上下文计费`,
              `Compacted ${preUsed} into a ${summaryLabel} summary; refreshes on next message`
            )
          : L('当前对话历史已完成压缩，发下一条消息即按新上下文计费', 'Context compacted; refreshes on next message');
      compactBtnHtml = `<button type="button" class="ag-qp-compact-btn" data-ag-qp-compact="true" data-state="compacted" disabled title="${escapeHtml(doneTitle)}">${SVG_COMPACT_DONE}<span>${L('已压缩', 'Compacted')}</span></button>`;
    } else if (!hasCtx) {
      compactBtnHtml = `<button type="button" class="ag-qp-compact-btn" data-ag-qp-compact="true" data-state="empty" disabled title="${escapeHtml(L('当前会话暂无可压缩上下文', 'No context to compact yet'))}">${SVG_COMPACT_ICON}<span>${L('压缩', 'Compact')}</span></button>`;
    } else if (paneRunning) {
      compactBtnHtml = `<button type="button" class="ag-qp-compact-btn" data-ag-qp-compact="true" data-state="busy" disabled title="${escapeHtml(L('请等待当前回复结束后再压缩上下文', 'Wait for the current response to finish before compacting'))}">${SVG_COMPACT_ICON}<span>${L('压缩', 'Compact')}</span></button>`;
    } else {
      const urgentAttr = ctxPct >= 85 ? ' data-urgent="crit"' : ctxPct >= 70 ? ' data-urgent="warn"' : '';
      compactBtnHtml = `<button type="button" class="ag-qp-compact-btn" data-ag-qp-compact="true" data-state="ready"${urgentAttr} title="${escapeHtml(L('立即执行 /compact 压缩当前对话上下文', 'Run /compact to compress this conversation context'))}">${SVG_COMPACT_ICON}<span>${L('压缩', 'Compact')}</span></button>`;
    }

    discoverQuotaService();
    const tierShort = cachedUserTierName
      ? cachedUserTierName.replace(/^Google\s+AI\s+/i, '').trim() || cachedUserTierName
      : '';
    const tierSuffix = tierShort ? ` · ${escapeHtml(tierShort)}` : '';

    const groups = cachedQuotaGroups || [];
    if (groups.length > 0 && (selectedQuotaGroupIdx < 0 || selectedQuotaGroupIdx >= groups.length)) {
      selectedQuotaGroupIdx = detectDefaultGroupIndex(groups);
    }

    let tabsHtml = '';
    if (groups.length > 1) {
      tabsHtml = `<div class="ag-qp-tabs">${groups
        .map((g, idx) => {
          const active = idx === selectedQuotaGroupIdx ? ' data-active="true"' : '';
          return `<button type="button" class="ag-qp-tab" data-ag-quota-tab="${idx}"${active}>${escapeHtml(localizeGroupShortName(
            g.displayName
          ))}</button>`;
        })
        .join('')}</div>`;
    }

    let quotaRowsHtml = '';
    if (!cachedQuotaGroups && quotaFetchInFlight) {
      quotaRowsHtml = `<div class="ag-qp-empty">${L('正在读取实时套餐限额…', 'Loading plan usage…')}</div>`;
    } else if (groups.length === 0) {
      quotaRowsHtml = `<div class="ag-qp-empty">${L('暂无可用套餐限额数据', 'No plan usage data available')}</div>`;
    } else {
      const grp = groups[selectedQuotaGroupIdx] || groups[0];
      const grpShort = localizeGroupShortName(grp.displayName);
      const sortedBuckets = (grp.buckets || []).slice().sort((a, b) => {
        const rank = (w) => (w === '5h' ? 0 : w === 'daily' ? 1 : 2);
        return rank(String(a.window || '').toLowerCase()) - rank(String(b.window || '').toLowerCase());
      });

      quotaRowsHtml = sortedBuckets
        .map((b) => {
          const rem =
            b.remaining && b.remaining.case === 'remainingFraction' && typeof b.remaining.value === 'number'
              ? b.remaining.value
              : typeof b.remainingFraction === 'number'
                ? b.remainingFraction
                : 1;
          const usedRaw = Math.max(0, Math.min(100, (1 - rem) * 100));
          const usedPctStr = formatQuotaUsedPctStr(usedRaw);
          const win = String(b.window || '').trim().toLowerCase();
          const title =
            win === '5h'
              ? L('5 小时限额', '5-hour limit')
              : win === 'weekly'
                ? L(`每周 · ${grpShort}`, `Weekly · ${grpShort}`)
                : win === 'daily'
                  ? L(`每日 · ${grpShort}`, `Daily · ${grpShort}`)
                  : b.displayName || L('使用限额', 'Usage limit');
          const resetTxt = formatResetLabel(b, usedRaw);
          const fillCol = barColorForPct(usedRaw, 75, 90);
          return `<div class="ag-qp-item">
            <div class="ag-qp-row">
              <span class="ag-qp-title">${escapeHtml(title)}</span>
              <span class="ag-qp-meta"><span class="ag-qp-reset">${escapeHtml(resetTxt)}</span><span class="ag-qp-pct">${usedPctStr}%</span></span>
            </div>
            <div class="ag-qp-track"><div class="ag-qp-fill" style="width:${usedRaw.toFixed(1)}%;background:${fillCol}"></div></div>
          </div>`;
        })
        .join('');
    }

    pop.innerHTML = `
      <div class="ag-qp-hdr">
        <span class="ag-qp-tier">${L('套餐使用限额', 'Plan usage')}${tierSuffix}</span>
        <button type="button" class="ag-qp-all" data-ag-quota-view-all="true">
          <span>${L('查看全部', 'View all')}</span>
          <svg width="12" height="12" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M3.5 8h9m0 0L8.8 4.3M12.5 8l-3.7 3.7" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>
        </button>
      </div>
      <div class="ag-qp-item">
        <div class="ag-qp-row">
          <span class="ag-qp-title-group">
            <span class="ag-qp-title">${L('当前上下文', 'Context window')}</span>
            ${compactBtnHtml}
          </span>
          <span class="ag-qp-meta"><span class="ag-qp-reset">${escapeHtml(ctxSub)}</span><span class="ag-qp-pct">${escapeHtml(ctxPctLabel)}</span></span>
        </div>
        <div class="ag-qp-track"><div class="ag-qp-fill"${fillCompactingAttr} style="width:${ctxPct}%;background:${ctxColor}"></div></div>
      </div>
      <div class="ag-qp-divider"></div>
      ${tabsHtml}
      <div class="ag-qp-group-list">${quotaRowsHtml}</div>
    `;
    positionQuotaPopover();
  }

  function openQuotaPopover() {
    if (typeof closeClaudeModelPopover === 'function' && modelPopoverOpen) {
      closeClaudeModelPopover();
    }
    quotaPopoverOpen = true;
    selectedQuotaGroupIdx = -1;
    discoverQuotaService(true);
    const needForce = !cachedQuotaGroups || Date.now() - lastForceQuotaFetchTs > 5000;
    fetchQuotaSummary(needForce);
    const ring = document.getElementById('ag-claude-ctx-ring');
    if (ring) ring.setAttribute('data-open', 'true');
    const pop = ensureQuotaPopover();
    if (!cachedQuotaGroups && quotaFetchInFlight) {
      pop.setAttribute('data-loading-hold', 'true');
      cancelLater(quotaHoldTimer);
      quotaHoldTimer = later(() => {
        quotaHoldTimer = 0;
        pop.removeAttribute('data-loading-hold');
      }, 90);
    } else {
      pop.removeAttribute('data-loading-hold');
    }
    renderQuotaPopoverBody();
    pop.setAttribute('data-open', 'true');
    positionQuotaPopover();
  }

  function closeQuotaPopover() {
    quotaPopoverOpen = false;
    cancelLater(quotaHoldTimer);
    quotaHoldTimer = 0;
    const ring = document.getElementById('ag-claude-ctx-ring');
    if (ring) ring.setAttribute('data-open', 'false');
    const pop = document.getElementById('ag-claude-quota-popover');
    if (pop) {
      pop.removeAttribute('data-loading-hold');
      pop.setAttribute('data-open', 'false');
    }
  }

  function updateComposerRingVisuals() {
    const ring = document.getElementById('ag-claude-ctx-ring');
    if (!ring) return;
    const curCid = getActiveCascadeId();
    const hasCtx = Boolean(curCid && latestCtxState.cascadeId === curCid && latestCtxState.hasData);
    const compactStatus = detectCompactStatus(curCid);
    const { preUsed, limitLabel, summaryLabel, summaryPct } = extractCompactLabels(latestCtxState, curCid);
    const arc = ring.querySelector('.ag-ctx-ring-arc');

    if (compactStatus === 'compacting') {
      const pct = 18;
      if (arc) {
        arc.style.strokeDashoffset = (RING_CIRC * (1 - pct / 100)).toFixed(2);
        arc.style.strokeOpacity = '1';
      }
      ring.setAttribute('data-level', 'normal');
      ring.setAttribute('data-compact-state', 'compacting');
      ring.title = preUsed
        ? L(`正在压缩上下文 (原 ${preUsed})… · 点击查看状态`, `Compacting context (was ${preUsed})… · Click for status`)
        : L('正在压缩上下文… · 点击查看状态', 'Compacting context… · Click for status');
      return;
    }

    if (compactStatus === 'compacted') {
      const pct = summaryPct > 0 ? Math.max(2, summaryPct) : hasCtx ? 2 : 0;
      if (arc) {
        arc.style.strokeDashoffset = (RING_CIRC * (1 - pct / 100)).toFixed(2);
        arc.style.strokeOpacity = pct <= 0 ? '0' : '1';
      }
      ring.setAttribute('data-level', 'normal');
      ring.setAttribute('data-compact-state', 'compacted');
      ring.title =
        summaryLabel && limitLabel
          ? L(
              `当前上下文 ${summaryLabel} / ${limitLabel} (${summaryPct}%${preUsed ? ` · 原 ${preUsed} 已压缩` : ''}) · 点击查看套餐限额`,
              `Context ${summaryLabel} / ${limitLabel} (${summaryPct}%${preUsed ? ` · compacted from ${preUsed}` : ''}) · Click for plan usage`
            )
          : L('当前上下文已压缩 · 点击查看套餐限额', 'Context compacted · Click for plan usage');
      return;
    }

    ring.removeAttribute('data-compact-state');
    const pct = hasCtx ? latestCtxState.pct : 0;
    if (arc) {
      const offset = RING_CIRC * (1 - pct / 100);
      arc.style.strokeDashoffset = offset.toFixed(2);
      arc.style.strokeOpacity = pct <= 0 ? '0' : '1';
      let level = 'normal';
      if (pct >= 85) level = 'crit';
      else if (pct >= 70) level = 'warn';
      ring.setAttribute('data-level', level);
    }
    ring.title = hasCtx
      ? L(
          `当前上下文 ${latestCtxState.ratioText} (${pct}%) · 点击查看套餐限额`,
          `Context ${latestCtxState.ratioText} (${pct}%) · Click for plan usage`
        )
      : L('当前会话暂无上下文消耗 · 点击查看套餐限额', 'No context usage yet · Click for plan usage');
  }

  function ensureComposerContextRing() {
    const inputBox = getActiveInputBox();
    if (!inputBox) return;

    /* On the Home `/` screen, the composer has a top project/location row that ALSO matches
       `div.flex.min-w-0.flex-1.items-center`; anchor off `model-selector-trigger` first so the
       ring always mounts beside the model picker in the bottom toolbar instead of top-right. */
    const modelBtn = inputBox.querySelector('button[data-testid="model-selector-trigger"]');
    let modelWrap = null;
    if (modelBtn) {
      const bar = modelBtn.closest('div.flex.min-w-0.flex-1.items-center') || modelBtn.parentElement;
      if (bar) {
        let cur = modelBtn;
        while (cur && cur.parentElement && cur.parentElement !== bar) cur = cur.parentElement;
        if (cur && cur.parentElement === bar) modelWrap = cur;
      }
    }
    if (!modelWrap) {
      const leftGroup = inputBox.querySelector('div.flex.min-w-0.flex-1.items-center');
      if (leftGroup) {
        modelWrap = Array.from(leftGroup.children).find(
          (ch) => ch.tagName === 'DIV' && ch.id !== 'ag-live-metrics-pill' && ch.querySelector('button')
        );
      }
    }
    if (!modelWrap) return;

    let ring = document.getElementById('ag-claude-ctx-ring');
    let newlyInserted = false;
    if (!ring) {
      newlyInserted = true;
      ring = document.createElement('button');
      ring.id = 'ag-claude-ctx-ring';
      ring.type = 'button';
      ring.setAttribute('data-no-drag', '');
      ring.setAttribute('data-ag-i18n-ignore', '1');
      ring.setAttribute('data-open', quotaPopoverOpen ? 'true' : 'false');
      ring.setAttribute('aria-label', L('上下文与套餐使用限额', 'Context window & plan usage'));
      ring.innerHTML =
        '<svg width="15" height="15" viewBox="0 0 20 20" aria-hidden="true">' +
        '<circle class="ag-ctx-ring-track" cx="10" cy="10" r="7" fill="none" stroke-width="2.15"/>' +
        `<circle class="ag-ctx-ring-arc" cx="10" cy="10" r="7" fill="none" stroke-width="2.15" stroke-linecap="round" stroke-dasharray="${RING_CIRC.toFixed(
          2
        )}" stroke-dashoffset="${RING_CIRC.toFixed(2)}"/>` +
        '</svg>';
      ring.addEventListener('pointerenter', () => {
        if (!quotaPopoverOpen && (!cachedQuotaGroups || Date.now() - lastForceQuotaFetchTs > 10000)) {
          fetchQuotaSummary(true);
        }
      });
      ring.addEventListener('click', (e) => {
        e.stopPropagation();
        if (quotaPopoverOpen) {
          closeQuotaPopover();
        } else {
          openQuotaPopover();
        }
      });
    }

    if (modelWrap.nextElementSibling !== ring) {
      modelWrap.insertAdjacentElement('afterend', ring);
      newlyInserted = true;
    }

    updateComposerRingVisuals();

    if (!quotaWarmupDone && discoverQuotaService(false)) {
      quotaWarmupDone = true;
      later(() => {
        if (!disposed && FEAT.contextRing && (!cachedQuotaGroups || Date.now() - lastForceQuotaFetchTs > 10000)) {
          fetchQuotaSummary(true);
        }
      }, 120);
    }

    if (newlyInserted && typeof window.__ag_ensure_metrics_pill_fn === 'function') {
      frame(() => {
        if (typeof window.__ag_ensure_metrics_pill_fn === 'function') {
          window.__ag_ensure_metrics_pill_fn(true);
        }
      });
    }
  }

  const onOutsidePopoverPointerDown = (e) => {
    if (!quotaPopoverOpen) return;
    const pop = document.getElementById('ag-claude-quota-popover');
    const ring = document.getElementById('ag-claude-ctx-ring');
    if ((pop && pop.contains(e.target)) || (ring && ring.contains(e.target))) return;
    closeQuotaPopover();
  };
  const onPopoverKeyDown = (e) => {
    if (quotaPopoverOpen && e.key === 'Escape') {
      closeQuotaPopover();
    }
  };
  const onWindowResizePopover = () => {
    if (quotaPopoverOpen) positionQuotaPopover();
    if (modelPopoverOpen) positionModelPopovers();
  };
  document.addEventListener('pointerdown', onOutsidePopoverPointerDown, true);
  document.addEventListener('keydown', onPopoverKeyDown, true);
  window.addEventListener('resize', onWindowResizePopover);

  /* ==========================================================================
   * 6. Claude-Style Stratified Model Selector Popover
   *    - Replaces crowded 9-row flat native list & noisy `新 / 快速` badges
   *    - Top: `模型 · 本次会话` + 4 core Gemini models (full names, `1-4` keys, blue `✓`)
   *    - Bottom: unified `思考强度 >` flyout (`Low/Medium/High/XHigh`) & `更多模型 >` flyout
   *    - Calls Antigravity's native React Fiber `setSelectedModel(option)` directly
   * ========================================================================== */
  const EFFORT_LABEL_RE = /^(.*?)\s*\((Low|Medium|High|XHigh|Extra|Max)\)\s*$/i;
  const EFFORT_NORM = { low: 'Low', medium: 'Medium', high: 'High', xhigh: 'XHigh', extra: 'XHigh', max: 'Max' };
  const EFFORT_DISPLAY = { XHigh: 'Extra' };
  const EFFORT_RANK = { Low: 0, Medium: 1, High: 2, XHigh: 3, Max: 4 };
  const EFFORT_DESC = {
    Low: ['最快响应，轻量日常问答', 'Fastest response for everyday tasks'],
    Medium: ['速度与推理均衡（默认）', 'Balanced speed and reasoning (default)'],
    High: ['深度推演与复杂问题排障', 'Deep analysis for complex problems'],
    XHigh: ['极限长链深度推理', 'Maximum extended reasoning'],
    Max: ['最高推理强度', 'Maximum reasoning effort']
  };
  function displayEffortDesc(effort) {
    const pair = effort && EFFORT_DESC[effort];
    return pair ? L(pair[0], pair[1]) : '';
  }
  function displayEffortLabel(effort) {
    return (effort && EFFORT_DISPLAY[effort]) || effort;
  }
  const SVG_CM_CHECK =
    '<svg class="ag-cm-check" width="15" height="15" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M3.2 8.4L6.5 11.7L13 4.5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  const SVG_CM_CHEVRON =
    '<svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M6 3.5L10.5 8L6 12.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>';

  let modelPopoverOpen = false;
  let activeModelSubmenu = null; // null | 'effort' | 'more'
  let activeModelTrimenu = null; // null | { kind: 'planner', familyName } | { kind: 'executor' }
  let activeModelTriggerBtn = null;
  let lastPreferredEffort = 'Medium';
  let currentCatalogSnapshot = null;
  let cachedPrefStore = null;
  let prefStoreUnsub = null;
  let fallbackExecutorModelVal = 0;
  let cachedExecutorRoleBaseIds = null;
  let executorRolesFetchInFlight = false;
  let executorRolesLastTryTs = 0;

  function escapeHtml(str) {
    return String(str || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function findModelTriggerBtn() {
    if (activeModelTriggerBtn && document.body.contains(activeModelTriggerBtn)) {
      return activeModelTriggerBtn;
    }
    return document.querySelector('button[data-testid="model-selector-trigger"]');
  }

  function syncModelTriggerDisplay() {
    if (disposed || !FEAT.modelMenu) return;
    const btns = document.querySelectorAll('button[data-testid="model-selector-trigger"]');
    for (const btn of btns) {
      if (btn.getAttribute('data-ag-i18n-ignore') !== '1') {
        btn.setAttribute('data-ag-i18n-ignore', '1');
      }
      const walker = document.createTreeWalker(btn, NodeFilter.SHOW_TEXT);
      let node;
      while ((node = walker.nextNode())) {
        const raw = node.nodeValue;
        if (!raw) continue;
        let next = raw.replace(/编排器\s*\(([^)]+)\)/g, 'Orchestrator ($1)');
        next = next.replace(/\b(?:Extra High|XHigh)\b/g, 'Extra');
        if (next !== raw) node.nodeValue = next;
      }
    }
  }

  function isOrchestratorModelOpt(opt) {
    if (!opt) return false;
    const id = typeof opt.modelId === 'string' ? opt.modelId : '';
    if (
      id === 'gemini-pro-coordinator' ||
      id === 'gemini-pro-orchestrator' ||
      id.startsWith('gemini-pro-orchestrator-')
    ) {
      return true;
    }
    return /orchestrator|编排器/i.test(String(opt.label || ''));
  }

  function parseModelLabelEffort(rawLabel) {
    const normalizedLabel = String(rawLabel || '')
      .replace(/编排器\s*\(([^)]+)\)/g, 'Orchestrator ($1)')
      .replace(/\s*\(Extra High\)\s*$/i, ' (XHigh)');
    const m = normalizedLabel.match(EFFORT_LABEL_RE);
    const baseName = m ? m[1].trim() : normalizedLabel.trim();
    const effort = m ? EFFORT_NORM[m[2].toLowerCase()] || m[2] : null;
    return { baseName, effort };
  }

  function modelCoreRank(name) {
    if (/carbon/i.test(name)) return 0;
    if (/neon/i.test(name)) return 1;
    if (/argon/i.test(name)) return 2;
    if (/hydrogen/i.test(name)) return 3;
    if (/flash/i.test(name)) return 4;
    return 10;
  }

  function sortFamilyVariants(variants) {
    return variants.sort((a, b) => {
      const ra = a.effort && EFFORT_RANK[a.effort] !== undefined ? EFFORT_RANK[a.effort] : 99;
      const rb = b.effort && EFFORT_RANK[b.effort] !== undefined ? EFFORT_RANK[b.effort] : 99;
      return ra - rb;
    });
  }

  function matchPlannerFromTriggerText(rawText, planners) {
    let txt = String(rawText || '').trim().replace(/\s+/g, ' ');
    if (!txt) return null;
    txt = txt
      .replace(/^Select model,\s*current:\s*/i, '')
      .replace(/\s*·\s*[^·]*$/, '')
      .trim();
    if (!/^(?:Orchestrator|编排器)\s+/i.test(txt)) return null;
    txt = txt.replace(/^(?:Orchestrator|编排器)\s+/i, '').trim();
    const m = txt.match(/^(.*?)\s+(Low|Medium|High|Extra High|XHigh|Extra|Max)$/i);
    const wantedBase = (m ? m[1] : txt).trim().toLowerCase();
    const rawEff = m ? m[2].toLowerCase() : '';
    const wantedEff = rawEff ? (rawEff === 'extra high' ? 'XHigh' : EFFORT_NORM[rawEff] || m[2]) : null;
    if (!wantedBase) return null;
    let baseMatch = null;
    for (const p of planners) {
      const parsed = parseModelLabelEffort(p.label);
      if (parsed.baseName.toLowerCase() !== wantedBase) continue;
      if (wantedEff && parsed.effort === wantedEff) return p;
      if (!baseMatch) baseMatch = p;
    }
    return baseMatch;
  }

  function resolveActiveOrchestratorPlanner(api, planners) {
    if (!Array.isArray(planners) || !planners.length) return null;
    const pickVal = api && api.orchestratorPick ? api.orchestratorPick.model : undefined;
    if (pickVal && pickVal !== 0) {
      const byPick = planners.find((p) => p.value === pickVal);
      if (byPick) return byPick;
    }
    const nativeBtn = document.querySelector('button[data-testid="model-selector-trigger"]');
    if (nativeBtn) {
      const candidates = [nativeBtn.getAttribute('aria-label'), nativeBtn.textContent];
      for (const raw of candidates) {
        const matched = matchPlannerFromTriggerText(raw, planners);
        if (matched) return matched;
      }
    }
    const defPlanner = api && api.orchestratorDefaultPlanner;
    if (defPlanner) {
      const byDef =
        planners.find(
          (p) =>
            (defPlanner.value !== undefined && p.value === defPlanner.value) ||
            (defPlanner.modelId && p.modelId === defPlanner.modelId) ||
            (defPlanner.label && p.label === defPlanner.label)
        ) || null;
      if (byDef) return byDef;
    }
    return planners[0];
  }

  function buildReduxModelSelectorApi() {
    try {
      const { store } = resolveProjectsStoreAndBindings();
      if (!store || typeof store.getState !== 'function') return null;
      const st = store.getState();
      const rawCfgs =
        (st && st.userStatus && st.userStatus.cascadeModelConfigData && st.userStatus.cascadeModelConfigData.clientModelConfigs) || [];
      if (!Array.isArray(rawCfgs) || rawCfgs.length === 0) return null;
      const modelOptions = [];
      for (const c of rawCfgs) {
        if (!c || !c.label) continue;
        const val = c.modelOrAlias && c.modelOrAlias.choice ? c.modelOrAlias.choice.value : c.value;
        modelOptions.push({
          label: c.label,
          value: val,
          modelId: c.modelId || '',
          disabled: Boolean(c.disabled)
        });
      }
      if (!modelOptions.length) return null;
      const rawCustom =
        st && st.customModels && Array.isArray(st.customModels.models)
          ? st.customModels.models
          : Array.isArray(st && st.customModels)
            ? st.customModels
            : [];
      const customModels = rawCustom
        .filter((c) => c && c.label)
        .map((c) => ({
          label: c.label,
          value: c.value,
          modelId: c.modelId || '',
          customLabel: c.label,
          disabled: Boolean(c.disabled)
        }));
      const def = (st && st.modelSelection && st.modelSelection.default) || null;
      const defVal = def && def.model;
      const selectedModel =
        (def && def.customLabel ? customModels.find((m) => m.value === defVal && m.label === def.customLabel) : null) ||
        modelOptions.find((m) => m.value === defVal) ||
        customModels.find((m) => m.value === defVal) ||
        modelOptions.find((m) => !m.disabled) ||
        modelOptions[0];
      const orchMap = (st && st.modelSelection && st.modelSelection.orchestratorByConversation) || {};
      const draftOrchModel = orchMap[''] !== undefined ? orchMap[''] : 0;
      return {
        isReduxFallback: true,
        modelOptions,
        customModels,
        selectedModel,
        open: false,
        setIsOpen: () => {},
        orchestratorPick: {
          model: draftOrchModel,
          select: (modelVal) => {
            if (modelVal === undefined || typeof store.dispatch !== 'function') return;
            store.dispatch({
              type: 'modelSelection/orchestratorModelPicked',
              payload: { model: modelVal }
            });
          }
        },
        setSelectedModel: (opt) => {
          if (!opt || opt.value === undefined || typeof store.dispatch !== 'function') return;
          store.dispatch({
            type: 'modelSelection/modelPicked',
            payload: {
              model: opt.value,
              ...(opt.customLabel ? { customLabel: opt.customLabel } : {})
            }
          });
        }
      };
    } catch {
      return null;
    }
  }

  function discoverModelSelectorApi(btnEl) {
    const isProjectTrigger = Boolean(
      (btnEl && btnEl.hasAttribute && btnEl.hasAttribute('data-ag-pd-model-trigger')) ||
      (!btnEl && activeModelTriggerBtn && activeModelTriggerBtn.hasAttribute && activeModelTriggerBtn.hasAttribute('data-ag-pd-model-trigger'))
    );
    const nativeBtn = document.querySelector('button[data-testid="model-selector-trigger"]');
    const isValidApi = (obj) =>
      Boolean(obj && typeof obj === 'object' && typeof obj.setSelectedModel === 'function' && Array.isArray(obj.modelOptions) && obj.modelOptions.length > 0);
    const readNativeApi = (btn) => {
      if (!btn) return null;
      const fk = Object.keys(btn).find((k) => k.startsWith('__reactFiber$'));
      let f = fk ? btn[fk] : null;
      let fallback = null;
      for (let i = 0; i < 28 && f; i++, f = f.return) {
        const p = f.memoizedProps;
        if (!p) continue;
        if (isValidApi(p.value)) return p.value;
        if (!fallback && isValidApi(p)) fallback = p;
      }
      return fallback;
    };

    if (isProjectTrigger) {
      const reduxApi = buildReduxModelSelectorApi();
      const nativeApi = readNativeApi(nativeBtn);
      if (reduxApi) {
        if (nativeApi) {
          const reduxPick = reduxApi.orchestratorPick;
          const nativePick = nativeApi.orchestratorPick;
          const mergedPick =
            (reduxPick && typeof reduxPick.select === 'function') || (nativePick && typeof nativePick.select === 'function')
              ? {
                  model: (reduxPick && reduxPick.model) || (nativePick && nativePick.model) || 0,
                  select: (val) => {
                    try {
                      if (reduxPick && typeof reduxPick.select === 'function') reduxPick.select(val);
                    } catch {}
                    try {
                      if (nativePick && typeof nativePick.select === 'function') nativePick.select(val);
                    } catch {}
                  }
                }
              : undefined;
          return {
            ...reduxApi,
            orchestratorPlanners: nativeApi.orchestratorPlanners,
            orchestratorPlannerIndex: nativeApi.orchestratorPlannerIndex,
            orchestratorDefaultPlanner: nativeApi.orchestratorDefaultPlanner,
            ...(mergedPick ? { orchestratorPick: mergedPick } : {}),
            setSelectedModel: (opt) => {
              reduxApi.setSelectedModel(opt);
              const match = nativeApi.modelOptions.find(
                (o) => o && ((opt.value !== undefined && o.value === opt.value) || o.label === opt.label)
              );
              try {
                nativeApi.setSelectedModel(match || opt);
              } catch {}
            }
          };
        }
        return reduxApi;
      }
      if (nativeApi) return nativeApi;
      return null;
    }

    if (btnEl && btnEl.matches && btnEl.matches('button[data-testid="model-selector-trigger"]')) {
      /* Stay scoped to this trigger's split pane; never steal another pane's native trigger API */
      const ownApi = readNativeApi(btnEl);
      if (ownApi) return ownApi;
      return buildReduxModelSelectorApi();
    }
    const candidates = [];
    if (btnEl) candidates.push(btnEl);
    if (nativeBtn && !candidates.includes(nativeBtn)) candidates.push(nativeBtn);
    const activeBtn = findModelTriggerBtn();
    if (activeBtn && !activeBtn.hasAttribute('data-ag-pd-model-trigger') && !candidates.includes(activeBtn)) {
      candidates.push(activeBtn);
    }
    for (const btn of candidates) {
      const api = readNativeApi(btn);
      if (api) return api;
    }
    return buildReduxModelSelectorApi();
  }

  /* ---- Native pass-through: this menu replaces Antigravity's own model menu, so anything the native menu
     gains in a new release would be hidden behind it. Two guards keep official features reachable:
       hard gap -> the native menu is in a mode this menu cannot drive correctly: step aside entirely;
       soft gap -> the native menu offers extra options: keep this menu, flag the "Native menu" row.
     Option/Alt + click on the trigger always opens the native menu. ---- */
  const KNOWN_MODEL_API_KEYS = new Set([
    'placement', 'selectedModel', 'setSelectedModel', 'modelSorts', 'modelOptions', 'userStatus', 'refreshModels',
    'open', 'setIsOpen', 'customModels', 'supportsCustomModels', 'showCustomModelHeader', 'onAddCustomModel',
    'onEditCustomModel', 'bestOfNConfig', 'contextWindow', 'isModelListLoading', 'finalFocus', 'footerExtra',
    'orchestratorPick', 'children', 'groups', 'effortIndex', 'orchestratorPlanners', 'orchestratorPlannerIndex',
    'orchestratorDefaultPlanner', 'orchestratorExecutors', 'lockedReason'
  ]);
  let bypassNativeModelTriggerUntil = 0;

  function isCustomCssDisabled() {
    return Boolean(typeof ctx !== 'undefined' && ctx && ctx.config && ctx.config.modules && ctx.config.modules.customCss === false);
  }

  function isNativeModelTriggerBtn(btn) {
    return Boolean(btn && btn.matches && btn.matches('button[data-testid="model-selector-trigger"]'));
  }

  function canOpenNativeModelMenu(api, btn) {
    return isNativeModelTriggerBtn(btn);
  }

  function nativeModelMenuGaps(api) {
    const gaps = { hard: [], soft: [] };
    if (!api || api.isReduxFallback) return gaps;
    /* v2.35+ `lockedReason`: the official selector is deliberately pinned shut (e.g. managed/policy
       environments). Mirroring upstream, our own popover must step aside so the locked state stays intact. */
    if (api.lockedReason !== undefined && api.lockedReason !== null) gaps.hard.push('lockedReason');
    if (api.bestOfNConfig && api.bestOfNConfig.isBestOfNEnabled === true) gaps.hard.push('bestOfN');
    if (api.footerExtra) gaps.soft.push('footerExtra');
    if (api.supportsCustomModels === true) gaps.soft.push('customModels');
    if (
      api.contextWindow &&
      (api.modelOptions || []).some((o) => o && Array.isArray(o.contextWindowOptions) && o.contextWindowOptions.length > 0)
    ) {
      gaps.soft.push('contextWindow');
    }
    for (const k of Object.keys(api)) {
      if (!KNOWN_MODEL_API_KEYS.has(k)) gaps.soft.push(`new:${k}`);
    }
    return gaps;
  }

  function shouldDeferToNativeModelMenu(e, trigger, api) {
    if (!isNativeModelTriggerBtn(trigger)) return false;
    if (Date.now() < bypassNativeModelTriggerUntil) return true;
    if (isCustomCssDisabled()) return true;
    if (e && e.altKey) return true;
    if (!api) return true;
    return nativeModelMenuGaps(api).hard.length > 0;
  }

  function formatProjectComposerModelParts(api) {
    const resolvedApi = api || buildReduxModelSelectorApi() || discoverModelSelectorApi();
    if (resolvedApi) {
      const cat = buildModelCatalog(resolvedApi);
      if (cat.activeFamily) {
        const name = cat.activeFamily.baseName;
        const eff = cat.activeVariant && cat.activeVariant.effort ? displayEffortLabel(cat.activeVariant.effort) : '';
        return { name, effort: eff };
      }
    }
    const nativeBtn = document.querySelector('button[data-testid="model-selector-trigger"]');
    const raw = nativeBtn ? (nativeBtn.textContent || '').trim().replace(/\s+/g, ' ') : '';
    if (!raw) return { name: L('默认模型', 'Default model'), effort: '' };
    const m = raw.match(/^(.*?)\s+(Low|Medium|High|Extra High|XHigh|Extra|Minimal)$/i);
    if (m) return { name: m[1].trim(), effort: displayEffortLabel(EFFORT_NORM[m[2].toLowerCase()] || m[2]) };
    return { name: raw, effort: '' };
  }

  function syncProjectDetailModelTrigger() {
    const pdBtn = document.getElementById('ag-pd-model-btn');
    if (!pdBtn) return;
    const api = discoverModelSelectorApi(pdBtn);
    const parts = formatProjectComposerModelParts(api);
    const nameEl = pdBtn.querySelector('.ag-pd-model-name');
    const effEl = pdBtn.querySelector('.ag-pd-model-effort');
    if (nameEl) nameEl.textContent = parts.name;
    if (effEl) {
      effEl.textContent = parts.effort;
      effEl.style.display = parts.effort ? '' : 'none';
    }
  }

  function applyModelSelectionOption(api, targetOpt, orchestratorPlannerOpt) {
    if (!targetOpt) return;
    const isReduxFallback = Boolean(!api || api.isReduxFallback);
    if (orchestratorPlannerOpt && orchestratorPlannerOpt.value !== undefined) {
      let calledNativeOrch = false;
      if (api && api.orchestratorPick && typeof api.orchestratorPick.select === 'function') {
        try {
          api.orchestratorPick.select(orchestratorPlannerOpt.value);
          calledNativeOrch = true;
        } catch {}
      }
      if (!calledNativeOrch || isReduxFallback) {
        try {
          const { store } = resolveProjectsStoreAndBindings();
          if (store && typeof store.dispatch === 'function') {
            store.dispatch({
              type: 'modelSelection/orchestratorModelPicked',
              payload: { model: orchestratorPlannerOpt.value }
            });
          }
        } catch {}
      }
    }
    let calledNativeSelect = false;
    if (api && typeof api.setSelectedModel === 'function') {
      try {
        api.setSelectedModel(targetOpt);
        calledNativeSelect = true;
      } catch {}
    }
    /* Only mirror into global Redux modelSelection when no native session setter handled it (or on Redux fallback) */
    if ((!calledNativeSelect || isReduxFallback) && targetOpt.value !== undefined) {
      try {
        const { store } = resolveProjectsStoreAndBindings();
        if (store && typeof store.dispatch === 'function') {
          store.dispatch({
            type: 'modelSelection/modelPicked',
            payload: {
              model: targetOpt.value,
              ...(targetOpt.customLabel ? { customLabel: targetOpt.customLabel } : {})
            }
          });
        }
      } catch {}
    }
    later(() => {
      syncModelTriggerDisplay();
      syncProjectDetailModelTrigger();
    }, 30);
  }

  function buildModelCatalog(api) {
    const rawOpts = (api.modelOptions || []).filter((o) => o && !o.disabled && o.label);
    const customOpts = Array.isArray(api.customModels)
      ? api.customModels.filter((o) => o && !o.disabled && o.label)
      : [];
    const allOpts = rawOpts.concat(customOpts);

    const rawOrchOpts = rawOpts.filter(isOrchestratorModelOpt);
    const canonicalOrchOpt =
      (api.selectedModel && !api.selectedModel.disabled && isOrchestratorModelOpt(api.selectedModel) ? api.selectedModel : null) ||
      rawOrchOpts[0] ||
      (api.modelOptions || []).find(isOrchestratorModelOpt) ||
      null;
    const orchPlanners = Array.isArray(api.orchestratorPlanners)
      ? api.orchestratorPlanners.filter((o) => o && !o.disabled && o.label)
      : [];
    const hasDynamicOrch = Boolean(
      orchPlanners.length > 0 &&
      canonicalOrchOpt &&
      api.orchestratorPick &&
      typeof api.orchestratorPick.select === 'function'
    );

    const familyMap = new Map();
    for (const opt of allOpts) {
      if (hasDynamicOrch && isOrchestratorModelOpt(opt)) continue;
      const parsed = parseModelLabelEffort(opt.label);
      const baseName = parsed.baseName;
      const effort = parsed.effort;
      let fam = familyMap.get(baseName);
      if (!fam) {
        fam = { baseName, variants: [] };
        familyMap.set(baseName, fam);
      }
      fam.variants.push({ effort, opt });
    }

    for (const fam of familyMap.values()) {
      sortFamilyVariants(fam.variants);
    }

    const orchFamilies = [];
    if (hasDynamicOrch) {
      const orchFamilyMap = new Map();
      for (const p of orchPlanners) {
        const parsed = parseModelLabelEffort(p.label);
        const famName = `Orchestrator · ${parsed.baseName}`;
        let fam = orchFamilyMap.get(famName);
        if (!fam) {
          fam = { baseName: famName, isOrchestratorFamily: true, variants: [] };
          orchFamilyMap.set(famName, fam);
        }
        fam.variants.push({ effort: parsed.effort, opt: canonicalOrchOpt, plannerOpt: p });
      }
      for (const fam of orchFamilyMap.values()) {
        sortFamilyVariants(fam.variants);
        orchFamilies.push(fam);
      }
    }

    const families = Array.from(familyMap.values());
    const isOrch = (f) => Boolean(f && (f.isOrchestratorFamily || /orchestrator/i.test(f.baseName)));
    const isCoreGemini = (f) => /^gemini\b/i.test(f.baseName) && !isOrch(f);

    let primaryFamilies = families
      .filter(isCoreGemini)
      .sort((a, b) => modelCoreRank(a.baseName) - modelCoreRank(b.baseName))
      .slice(0, 5);
    if (!primaryFamilies.length) {
      /* Accounts that only expose non-Gemini models (e.g. "Claude Opus 5.5 · Devin") would otherwise get an
         empty "Models · This chat" list with everything buried under More models: keep the native order. */
      primaryFamilies = families.filter((f) => !isOrch(f)).slice(0, 5);
    }

    const primarySet = new Set(primaryFamilies);
    const nonPrimaryEntries = families
      .filter((f) => !primarySet.has(f))
      .map((f) => ({
        group: isOrch(f) ? 'orch' : 'other',
        fam: f
      }));
    const orchEntries = hasDynamicOrch ? orchFamilies.map((f) => ({ group: 'orch', fam: f })) : [];
    const moreFamilies = orchEntries
      .concat(nonPrimaryEntries)
      .sort((a, b) => (a.group === b.group ? 0 : a.group === 'orch' ? -1 : 1));

    const sel = api.selectedModel || null;
    let activeFamily = null;
    let activeVariant = null;

    if (sel) {
      if (hasDynamicOrch && isOrchestratorModelOpt(sel)) {
        const activePlanner = resolveActiveOrchestratorPlanner(api, orchPlanners);
        if (activePlanner) {
          for (const fam of orchFamilies) {
            for (const v of fam.variants) {
              const p = v.plannerOpt;
              if (
                p &&
                ((activePlanner.value !== undefined && p.value === activePlanner.value) ||
                  (activePlanner.modelId && p.modelId === activePlanner.modelId) ||
                  p.label === activePlanner.label)
              ) {
                activeFamily = fam;
                activeVariant = v;
                break;
              }
            }
            if (activeFamily) break;
          }
        }
      }
      if (!activeFamily) {
        for (const fam of families) {
          for (const v of fam.variants) {
            if (
              (sel.value !== undefined && v.opt.value === sel.value) ||
              (sel.modelId && v.opt.modelId === sel.modelId) ||
              v.opt.label === sel.label
            ) {
              activeFamily = fam;
              activeVariant = v;
              break;
            }
          }
          if (activeFamily) break;
        }
      }
    }

    if (!activeFamily && primaryFamilies.length > 0) {
      activeFamily = primaryFamilies[0];
      activeVariant = activeFamily.variants[0] || null;
    }

    if (activeVariant && activeVariant.effort) {
      lastPreferredEffort = activeVariant.effort;
    }

    return {
      primaryFamilies,
      moreFamilies,
      activeFamily,
      activeVariant
    };
  }

  function pickVariantForFamily(fam, desiredEffort) {
    if (!fam || !fam.variants.length) return null;
    if (desiredEffort) {
      const exact = fam.variants.find((v) => v.effort === desiredEffort);
      if (exact) return exact;
      if (desiredEffort === 'XHigh' || desiredEffort === 'Max') {
        const high = fam.variants.find((v) => v.effort === 'High');
        if (high) return high;
      }
    }
    const med = fam.variants.find((v) => v.effort === 'Medium');
    return med || fam.variants[0];
  }

  function bindPrefStoreSubscription(ps) {
    if (prefStoreUnsub) {
      try {
        prefStoreUnsub();
      } catch {}
      prefStoreUnsub = null;
    }
    if (ps && typeof ps.onDidChange === 'function') {
      try {
        const sub = ps.onDidChange(() => {
          if (!disposed && modelPopoverOpen) renderModelPopovers();
        });
        if (typeof sub === 'function') prefStoreUnsub = sub;
        else if (sub && typeof sub.dispose === 'function') prefStoreUnsub = () => sub.dispose();
      } catch {}
    }
  }

  function discoverPrefStore() {
    if (
      typeof window === 'object' &&
      window &&
      window.__ag_test_pref_store &&
      typeof window.__ag_test_pref_store.getState === 'function'
    ) {
      if (cachedPrefStore !== window.__ag_test_pref_store) {
        cachedPrefStore = window.__ag_test_pref_store;
        bindPrefStoreSubscription(cachedPrefStore);
      }
      return cachedPrefStore;
    }
    if (cachedPrefStore && typeof cachedPrefStore.getState === 'function') {
      try {
        const st = cachedPrefStore.getState();
        if (st && typeof st.getPrefValue === 'function' && typeof st.setPrefValue === 'function') {
          return cachedPrefStore;
        }
      } catch {}
    }
    const root = document.getElementById('root') || (document.body && document.body.firstElementChild);
    if (!root) return null;
    const fk = Object.keys(root).find((k) => k.startsWith('__reactContainer') || k.startsWith('__reactFiber'));
    const start = fk ? root[fk] : null;
    if (!start) return null;
    const queue = [start];
    const seen = new Set();
    let steps = 0;
    const isPrefStore = (cand) => {
      if (!cand || typeof cand.getState !== 'function') return false;
      try {
        const st = cand.getState();
        return Boolean(st && typeof st.getPrefValue === 'function' && typeof st.setPrefValue === 'function');
      } catch {
        return false;
      }
    };
    while (queue.length && steps < 600) {
      const f = queue.shift();
      if (!f || seen.has(f)) continue;
      seen.add(f);
      steps++;
      const mp = f.memoizedProps;
      if (mp && isPrefStore(mp.value)) {
        cachedPrefStore = mp.value;
        bindPrefStoreSubscription(mp.value);
        return mp.value;
      }
      for (let dep = f.dependencies && f.dependencies.firstContext; dep; dep = dep.next) {
        if (isPrefStore(dep.memoizedValue)) {
          cachedPrefStore = dep.memoizedValue;
          bindPrefStoreSubscription(dep.memoizedValue);
          return dep.memoizedValue;
        }
      }
      if (f.child) queue.push(f.child);
      if (f.sibling) queue.push(f.sibling);
    }
    return null;
  }

  function extractLsClientCandidate(cand) {
    if (!cand || typeof cand !== 'object') return null;
    if (typeof cand.getMendelFlags === 'function') return cand;
    if (cand.lsClient && typeof cand.lsClient.getMendelFlags === 'function') return cand.lsClient;
    if (cand.client && typeof cand.client.getMendelFlags === 'function') return cand.client;
    return null;
  }

  function ensureOrchestratorRolesLoaded() {
    if (
      typeof window === 'object' &&
      window &&
      Array.isArray(window.__ag_test_executor_roles)
    ) {
      cachedExecutorRoleBaseIds = window.__ag_test_executor_roles.filter((s) => typeof s === 'string');
      return;
    }
    if (Array.isArray(cachedExecutorRoleBaseIds)) return;
    const now = Date.now();
    if (executorRolesFetchInFlight || now - executorRolesLastTryTs < 3000) return;

    const root = document.getElementById('root') || (document.body && document.body.firstElementChild);
    const fk = root && Object.keys(root).find((k) => k.startsWith('__reactContainer') || k.startsWith('__reactFiber'));
    if (!fk) return;
    const queue = [root[fk]];
    const seen = new Set();
    let lsClient = null;
    while (queue.length && seen.size < 600 && !lsClient) {
      const f = queue.shift();
      if (!f || seen.has(f)) continue;
      seen.add(f);
      const mp = f.memoizedProps;
      lsClient = extractLsClientCandidate(mp) || extractLsClientCandidate(mp && mp.value);
      if (!lsClient) {
        for (let dep = f.dependencies && f.dependencies.firstContext; dep; dep = dep.next) {
          lsClient = extractLsClientCandidate(dep.memoizedValue);
          if (lsClient) break;
        }
      }
      if (!lsClient && f.memoizedState) {
        let s = f.memoizedState;
        for (let k = 0; k < 15 && s && !lsClient; k++, s = s.next) {
          lsClient = extractLsClientCandidate(s.memoizedState);
        }
      }
      if (f.child) queue.push(f.child);
      if (f.sibling) queue.push(f.sibling);
    }
    if (!lsClient) return;
    executorRolesLastTryTs = now;
    executorRolesFetchInFlight = true;
    try {
      Promise.resolve(lsClient.getMendelFlags({}))
        .then((resp) => {
          executorRolesFetchInFlight = false;
          if (disposed) return;
          const exps = (resp && resp.experimentConfig && resp.experimentConfig.experiments) || [];
          const hit = Array.isArray(exps) ? exps.find((x) => x && x.keyString === 'orchestrator-model-roles') : null;
          const rawStr = hit && hit.payload && hit.payload.value;
          if (typeof rawStr === 'string' && rawStr) {
            const parsed = JSON.parse(rawStr);
            if (
              parsed &&
              Array.isArray(parsed.executors) &&
              parsed.executors.every((s) => typeof s === 'string')
            ) {
              cachedExecutorRoleBaseIds = parsed.executors.slice();
              if (modelPopoverOpen) renderModelPopovers();
            }
          }
        })
        .catch(() => {
          executorRolesFetchInFlight = false;
        });
    } catch {
      executorRolesFetchInFlight = false;
    }
  }

  function readExecutorModelPrefValue() {
    const ps = discoverPrefStore();
    if (ps) {
      try {
        const v = Number(ps.getState().getPrefValue('orchestratorExecutorModel'));
        if (Number.isFinite(v) && v >= 0) return v;
      } catch {}
    }
    try {
      const { store } = resolveProjectsStoreAndBindings();
      const st = store && typeof store.getState === 'function' ? store.getState() : null;
      const rv = Number(st && st.userConfig && st.userConfig.userSettings && st.userConfig.userSettings.orchestratorExecutorModel);
      if (Number.isFinite(rv) && rv >= 0) return rv;
    } catch {}
    return fallbackExecutorModelVal;
  }

  function applyExecutorModelPrefValue(modelVal, defaultVal) {
    const rawNext = Number(modelVal) > 0 ? Number(modelVal) : 0;
    const nextVal = defaultVal && rawNext === Number(defaultVal) ? 0 : rawNext;
    fallbackExecutorModelVal = nextVal;
    const ps = discoverPrefStore();
    if (ps) {
      try {
        ps.getState().setPrefValue('orchestratorExecutorModel', nextVal);
      } catch {}
    }
  }

  function formatShortExecutorLabel(baseName, effort) {
    const shortBase =
      String(baseName || '')
        .replace(/^Gemini\s+\d+(?:\.\d+)?\s+/i, '')
        .replace(/^Claude\s+/i, '')
        .trim() || String(baseName || '').trim();
    const eff = effort ? displayEffortLabel(effort) : '';
    return eff ? `${shortBase} · ${eff}` : shortBase;
  }

  function buildExecutorCatalog(api) {
    ensureOrchestratorRolesLoaded();
    const empty = {
      families: [],
      activeFamily: null,
      activeVariant: null,
      defaultFamily: null,
      defaultVariant: null,
      isDefault: true,
      shortSummary: '',
      defaultShortLabel: ''
    };
    /* v2.35+: the official selector context now exposes `orchestratorExecutors` — the exact
       whitelisted executor option list upstream renders. Prefer it directly when present; only
       fall back to the orchestrator-model-roles flag + modelOptions reconstruction otherwise. */
    const stripEffortId = (id) => String(id || '').replace(/-(low|medium|high|xhigh|max)$/i, '');
    let families = [];
    const officialExecOpts = Array.isArray(api && api.orchestratorExecutors)
      ? api.orchestratorExecutors.filter((o) => o && !o.disabled && o.label && o.value !== undefined)
      : [];
    if (officialExecOpts.length > 0) {
      const famMap = new Map();
      officialExecOpts.forEach((opt, idx) => {
        const parsed = parseModelLabelEffort(opt.label);
        const baseId = opt.modelId ? stripEffortId(opt.modelId) : `__exec_${idx}`;
        let fam = famMap.get(baseId);
        if (!fam) {
          fam = { baseName: parsed.baseName, baseId, variants: [], _order: idx };
          famMap.set(baseId, fam);
        }
        fam.variants.push({ effort: parsed.effort, opt });
      });
      families = Array.from(famMap.values());
      for (const fam of families) {
        sortFamilyVariants(fam.variants);
      }
      families.sort((a, b) => a._order - b._order);
    } else {
      /* Strictly mirror official Antigravity oW() / LSb(): never expose non-whitelisted executor models */
      if (!Array.isArray(cachedExecutorRoleBaseIds) || cachedExecutorRoleBaseIds.length === 0) {
        return empty;
      }
      const rawOpts = ((api && api.modelOptions) || []).filter(
        (o) => o && !o.disabled && !o.isCustom && o.value !== undefined && o.value !== 0 && o.label && !isOrchestratorModelOpt(o)
      );
      if (!rawOpts.length) return empty;
      const roleOrder = cachedExecutorRoleBaseIds;
      const roleSet = new Set(roleOrder);
      const candidateOpts = rawOpts.filter((o) => o.modelId && roleSet.has(stripEffortId(o.modelId)));
      if (!candidateOpts.length) return empty;

      const famMap = new Map();
      for (const opt of candidateOpts) {
        const parsed = parseModelLabelEffort(opt.label);
        const baseId = stripEffortId(opt.modelId);
        let fam = famMap.get(baseId);
        if (!fam) {
          fam = { baseName: parsed.baseName, baseId, variants: [] };
          famMap.set(baseId, fam);
        }
        fam.variants.push({ effort: parsed.effort, opt });
      }
      families = Array.from(famMap.values());
      for (const fam of families) {
        sortFamilyVariants(fam.variants);
      }
      families.sort((a, b) => roleOrder.indexOf(a.baseId) - roleOrder.indexOf(b.baseId));
    }

    const defaultFamily = families[0] || null;
    const defaultVariant =
      defaultFamily && defaultFamily.variants.length
        ? defaultFamily.variants[defaultFamily.variants.length - 1]
        : null;

    const prefVal = readExecutorModelPrefValue();
    let activeFamily = null;
    let activeVariant = null;
    let isDefault = true;
    if (prefVal > 0) {
      for (const fam of families) {
        for (const v of fam.variants) {
          if (v.opt && v.opt.value === prefVal) {
            activeFamily = fam;
            activeVariant = v;
            isDefault = Boolean(defaultVariant && defaultVariant.opt && defaultVariant.opt.value === prefVal);
            break;
          }
        }
        if (activeFamily) break;
      }
    }
    if (!activeFamily) {
      activeFamily = defaultFamily;
      activeVariant = defaultVariant;
      isDefault = true;
    }

    return {
      families,
      activeFamily,
      activeVariant,
      defaultFamily,
      defaultVariant,
      isDefault,
      shortSummary: activeFamily
        ? formatShortExecutorLabel(activeFamily.baseName, activeVariant && activeVariant.effort)
        : '',
      defaultShortLabel: defaultFamily
        ? formatShortExecutorLabel(defaultFamily.baseName, defaultVariant && defaultVariant.effort)
        : ''
    };
  }

  function ensureModelPopovers() {
    let mainPop = document.getElementById('ag-claude-model-popover');
    if (!mainPop) {
      mainPop = document.createElement('div');
      mainPop.id = 'ag-claude-model-popover';
      mainPop.setAttribute('data-ag-i18n-ignore', '1');
      mainPop.setAttribute('data-open', 'false');
      mainPop.addEventListener('mouseover', (e) => {
        const row = e.target.closest('[data-ag-cm-hover]');
        if (!row) return;
        const kind = row.getAttribute('data-ag-cm-hover');
        const nextSub = kind === 'none' ? null : kind;
        if (activeModelSubmenu !== nextSub) {
          activeModelSubmenu = nextSub;
          activeModelTrimenu = null;
          renderModelPopovers();
        }
      });
      mainPop.addEventListener('click', (e) => {
        e.stopPropagation();
        const famBtn = e.target.closest('[data-ag-cm-family]');
        if (famBtn) {
          const baseName = famBtn.getAttribute('data-ag-cm-family');
          const api = discoverModelSelectorApi(activeModelTriggerBtn);
          if (api) {
            const cat = buildModelCatalog(api);
            const fam = cat.primaryFamilies.find((f) => f.baseName === baseName);
            const targetVar = pickVariantForFamily(fam, lastPreferredEffort);
            if (targetVar && targetVar.opt) applyModelSelectionOption(api, targetVar.opt, targetVar.plannerOpt);
          }
          closeClaudeModelPopover();
          return;
        }
        const subTrigger = e.target.closest('[data-ag-cm-subtrigger]');
        if (subTrigger) {
          if (subTrigger.getAttribute('data-disabled') === 'true') return;
          const kind = subTrigger.getAttribute('data-ag-cm-subtrigger');
          activeModelSubmenu = activeModelSubmenu === kind ? null : kind;
          activeModelTrimenu = null;
          renderModelPopovers();
          return;
        }
        if (e.target.closest('[data-ag-cm-native]')) {
          const btn = activeModelTriggerBtn || findModelTriggerBtn();
          const api = discoverModelSelectorApi(btn);
          closeClaudeModelPopover();
          if (isNativeModelTriggerBtn(btn)) {
            later(() => {
              if (api && !api.isReduxFallback && typeof api.setIsOpen === 'function') {
                try {
                  api.setIsOpen(true);
                  return;
                } catch {}
              }
              /* Fallback pass-through when native Fiber API is unavailable */
              bypassNativeModelTriggerUntil = Date.now() + 350;
              try {
                btn.click();
              } catch {}
            }, 0);
          }
        }
      });
      document.body.appendChild(mainPop);
    }

    let subPop = document.getElementById('ag-claude-model-subpop');
    if (!subPop) {
      subPop = document.createElement('div');
      subPop.id = 'ag-claude-model-subpop';
      subPop.setAttribute('data-ag-i18n-ignore', '1');
      subPop.setAttribute('data-open', 'false');
      subPop.addEventListener('mouseover', (e) => {
        const row = e.target.closest('[data-ag-cm-tri-hover]');
        if (!row) return;
        const kind = row.getAttribute('data-ag-cm-tri-hover');
        let nextTri = null;
        if (kind === 'executor') {
          nextTri = { kind: 'executor' };
        } else if (kind === 'planner') {
          const familyName = row.getAttribute('data-ag-cm-tri-family') || '';
          if (familyName) nextTri = { kind: 'planner', familyName };
        }
        const same =
          (activeModelTrimenu === null && nextTri === null) ||
          (activeModelTrimenu &&
            nextTri &&
            activeModelTrimenu.kind === nextTri.kind &&
            activeModelTrimenu.familyName === nextTri.familyName);
        if (!same) {
          activeModelTrimenu = nextTri;
          renderModelPopovers();
        }
      });
      subPop.addEventListener('click', (e) => {
        e.stopPropagation();
        const effBtn = e.target.closest('[data-ag-cm-effort]');
        if (effBtn) {
          const eff = effBtn.getAttribute('data-ag-cm-effort');
          const api = discoverModelSelectorApi(activeModelTriggerBtn);
          if (api) {
            const cat = buildModelCatalog(api);
            if (cat.activeFamily) {
              const v = cat.activeFamily.variants.find((x) => x.effort === eff);
              if (v && v.opt) {
                lastPreferredEffort = eff;
                applyModelSelectionOption(api, v.opt, v.plannerOpt);
              }
            }
          }
          closeClaudeModelPopover();
          return;
        }
        const triTrig = e.target.closest('[data-ag-cm-tritrigger]');
        if (triTrig) {
          const kind = triTrig.getAttribute('data-ag-cm-tritrigger');
          if (kind === 'executor') {
            activeModelTrimenu =
              activeModelTrimenu && activeModelTrimenu.kind === 'executor' ? null : { kind: 'executor' };
            renderModelPopovers();
          }
          return;
        }
        const moreBtn = e.target.closest('[data-ag-cm-more-family]');
        if (moreBtn) {
          const baseName = moreBtn.getAttribute('data-ag-cm-more-family');
          const api = discoverModelSelectorApi(activeModelTriggerBtn);
          if (api) {
            const cat = buildModelCatalog(api);
            const entry = cat.moreFamilies.find((x) => x.fam.baseName === baseName);
            const targetVar = entry ? pickVariantForFamily(entry.fam, lastPreferredEffort) : null;
            if (targetVar && targetVar.opt) applyModelSelectionOption(api, targetVar.opt, targetVar.plannerOpt);
          }
          closeClaudeModelPopover();
          return;
        }
      });
      document.body.appendChild(subPop);
    }

    let triPop = document.getElementById('ag-claude-model-tripop');
    if (!triPop) {
      triPop = document.createElement('div');
      triPop.id = 'ag-claude-model-tripop';
      triPop.setAttribute('data-ag-i18n-ignore', '1');
      triPop.setAttribute('data-open', 'false');
      triPop.addEventListener('click', (e) => {
        e.stopPropagation();
        const orchEffBtn = e.target.closest('[data-ag-cm-orch-effort]');
        if (orchEffBtn) {
          const famName = orchEffBtn.getAttribute('data-ag-cm-orch-family');
          const eff = orchEffBtn.getAttribute('data-ag-cm-orch-effort');
          const api = discoverModelSelectorApi(activeModelTriggerBtn);
          if (api && famName && eff) {
            const cat = buildModelCatalog(api);
            const entry = cat.moreFamilies.find((x) => x.group === 'orch' && x.fam.baseName === famName);
            const targetVar = entry ? entry.fam.variants.find((v) => v.effort === eff) : null;
            if (targetVar && targetVar.opt) {
              lastPreferredEffort = eff;
              applyModelSelectionOption(api, targetVar.opt, targetVar.plannerOpt);
            }
          }
          closeClaudeModelPopover();
          return;
        }
        const execValBtn = e.target.closest('[data-ag-cm-exec-val]');
        if (execValBtn) {
          const val = Number(execValBtn.getAttribute('data-ag-cm-exec-val')) || 0;
          const api = discoverModelSelectorApi(activeModelTriggerBtn);
          const execCat = api ? buildExecutorCatalog(api) : null;
          const defVal = execCat && execCat.defaultVariant && execCat.defaultVariant.opt ? execCat.defaultVariant.opt.value : 0;
          applyExecutorModelPrefValue(val, defVal);
          renderModelPopovers();
          return;
        }
        const execFamBtn = e.target.closest('[data-ag-cm-exec-family]');
        if (execFamBtn) {
          const baseName = execFamBtn.getAttribute('data-ag-cm-exec-family');
          const api = discoverModelSelectorApi(activeModelTriggerBtn);
          if (api) {
            const execCat = buildExecutorCatalog(api);
            const fam = execCat.families.find((f) => f.baseName === baseName);
            if (fam && fam.variants.length) {
              const curEff = execCat.activeVariant && execCat.activeVariant.effort;
              const chosen =
                (curEff && fam.variants.find((v) => v.effort === curEff)) || fam.variants[fam.variants.length - 1];
              const defVal = execCat.defaultVariant && execCat.defaultVariant.opt ? execCat.defaultVariant.opt.value : 0;
              if (chosen && chosen.opt && chosen.opt.value !== undefined) {
                applyExecutorModelPrefValue(chosen.opt.value, defVal);
                renderModelPopovers();
              }
            }
          }
        }
      });
      document.body.appendChild(triPop);
    }

    return { mainPop, subPop, triPop };
  }

  function positionModelPopovers() {
    const btn = findModelTriggerBtn();
    const mainPop = document.getElementById('ag-claude-model-popover');
    const subPop = document.getElementById('ag-claude-model-subpop');
    const triPop = document.getElementById('ag-claude-model-tripop');
    if (!btn || !mainPop) return;

    const r = btn.getBoundingClientRect();
    const mainW = 254;
    const openBelow = btn.hasAttribute('data-ag-pd-model-trigger') || r.top < 320;
    const rawLeft = openBelow ? Math.round(r.right - mainW) : Math.round(r.left);
    const left = Math.max(12, Math.min(rawLeft, window.innerWidth - mainW - 14));
    mainPop.style.left = `${left}px`;
    if (openBelow) {
      const top = Math.max(12, Math.min(Math.round(r.bottom + 8), window.innerHeight - 280));
      mainPop.style.top = `${top}px`;
      mainPop.style.bottom = 'auto';
      mainPop.style.transformOrigin = 'top right';
    } else {
      const bottom = Math.max(12, Math.round(window.innerHeight - r.top + 8));
      mainPop.style.top = 'auto';
      mainPop.style.bottom = `${bottom}px`;
      mainPop.style.transformOrigin = 'bottom left';
    }

    if (subPop && subPop.getAttribute('data-open') === 'true') {
      const mr = mainPop.getBoundingClientRect();
      const subW = 278;
      let subLeft = Math.round(mr.right + 6);
      if (subLeft + subW > window.innerWidth - 10) {
        subLeft = Math.max(10, Math.round(mr.left - subW - 6));
      }
      subPop.style.left = `${subLeft}px`;
      if (openBelow) {
        subPop.style.top = mainPop.style.top;
        subPop.style.bottom = 'auto';
      } else {
        subPop.style.top = 'auto';
        subPop.style.bottom = mainPop.style.bottom;
      }

      if (triPop && triPop.getAttribute('data-open') === 'true') {
        const sr = subPop.getBoundingClientRect();
        const isExec = triPop.getAttribute('data-tri-kind') === 'executor';
        const triW = isExec ? 264 : 232;
        const subOnRight = sr.left >= mr.left;
        let triLeft = subOnRight ? Math.round(sr.right + 6) : Math.round(sr.left - triW - 6);
        if (triLeft + triW > window.innerWidth - 10) {
          triLeft = Math.max(10, Math.round(sr.left - triW - 6));
        }
        if (triLeft < 10) {
          triLeft = Math.min(window.innerWidth - triW - 10, Math.round(sr.right + 6));
        }
        triPop.style.left = `${Math.max(10, triLeft)}px`;

        const activeSubRow = subPop.querySelector('[data-active-sub="true"]');
        const triH = Math.max(triPop.offsetHeight || 0, isExec ? 190 : 170);
        if (activeSubRow) {
          const ar = activeSubRow.getBoundingClientRect();
          const idealTop = Math.round(ar.top - 8);
          const clampedTop = Math.max(12, Math.min(idealTop, window.innerHeight - triH - 12));
          triPop.style.top = `${clampedTop}px`;
          triPop.style.bottom = 'auto';
        } else if (openBelow) {
          triPop.style.top = subPop.style.top;
          triPop.style.bottom = 'auto';
        } else {
          triPop.style.top = 'auto';
          triPop.style.bottom = subPop.style.bottom;
        }
      }
    }
  }

  function renderModelPopoversRaw() {
    const api = discoverModelSelectorApi(activeModelTriggerBtn);
    if (!api) return;
    const { mainPop, subPop, triPop } = ensureModelPopovers();
    const cat = buildModelCatalog(api);
    currentCatalogSnapshot = cat;

    const multiEfforts = cat.activeFamily
      ? cat.activeFamily.variants.filter((v) => Boolean(v.effort))
      : [];
    const hasAdjustableEffort = multiEfforts.length > 1;
    const curEffortText =
      cat.activeVariant && cat.activeVariant.effort
        ? displayEffortLabel(cat.activeVariant.effort)
        : hasAdjustableEffort
          ? displayEffortLabel(lastPreferredEffort)
          : L('固定', 'Fixed');

    const activeInMore = cat.moreFamilies.some((x) => cat.activeFamily && x.fam.baseName === cat.activeFamily.baseName);

    const primaryRowsHtml = cat.primaryFamilies
      .map((fam, idx) => {
        const isSelected = Boolean(cat.activeFamily && cat.activeFamily.baseName === fam.baseName);
        const rightHtml = isSelected ? SVG_CM_CHECK : `<span class="ag-cm-key">${idx + 1}</span>`;
        return `<button type="button" class="ag-cm-row" data-ag-cm-hover="none" data-ag-cm-family="${escapeHtml(
          fam.baseName
        )}">
          <span>${escapeHtml(fam.baseName)}</span>
          ${rightHtml}
        </button>`;
      })
      .join('');

    /* Native menu row: always present on the native trigger. When the official menu carries options this
       menu does not render (agent selector footer, context window, custom models) the hint reads
       "More options"; the dot is reserved for fields this version has never seen (release drift). */
    const nativeGaps = nativeModelMenuGaps(api);
    const nativeHasNewFields = nativeGaps.soft.some((g) => g.startsWith('new:'));
    const nativeRowHtml = canOpenNativeModelMenu(api, activeModelTriggerBtn || findModelTriggerBtn())
      ? `<div class="ag-cm-divider"></div>
      <button type="button" class="ag-cm-row" data-ag-cm-hover="none" data-ag-cm-native="1"${
        nativeGaps.soft.length ? ` data-ag-cm-native-gaps="${escapeHtml(nativeGaps.soft.join(' '))}"` : ''
      }>
        <span style="display:inline-flex;align-items:center;gap:6px;">
          <span>${L('官方菜单', 'Native menu')}</span>
          ${nativeHasNewFields ? '<span class="ag-cm-dot"></span>' : ''}
        </span>
        <span class="ag-cm-key">${nativeGaps.soft.length ? L('更多选项', 'More options') : L('⌥ 点击', '⌥ Click')}</span>
      </button>`
      : '';

    const effSubActive = activeModelSubmenu === 'effort' && hasAdjustableEffort ? ' data-active-sub="true"' : '';
    const effDisabled = hasAdjustableEffort ? '' : ' data-disabled="true"';
    const moreSubActive = activeModelSubmenu === 'more' ? ' data-active-sub="true"' : '';

    mainPop.innerHTML = `
      <div class="ag-cm-sec-hdr">${L('模型 · 本次会话', 'Models · This chat')}</div>
      <div>${primaryRowsHtml}</div>
      <div class="ag-cm-divider"></div>
      <button type="button" class="ag-cm-row" data-ag-cm-hover="${
        hasAdjustableEffort ? 'effort' : 'none'
      }" data-ag-cm-subtrigger="effort"${effSubActive}${effDisabled}>
        <span>${L('思考强度', 'Thinking effort')}</span>
        <span class="ag-cm-right"><span>${escapeHtml(curEffortText)}</span>${
          hasAdjustableEffort ? SVG_CM_CHEVRON : ''
        }</span>
      </button>
      <button type="button" class="ag-cm-row" data-ag-cm-hover="more" data-ag-cm-subtrigger="more"${moreSubActive}>
        <span style="display:inline-flex;align-items:center;gap:6px;">
          <span>${L('更多模型', 'More models')}</span>
          ${activeInMore ? '<span class="ag-cm-dot"></span>' : ''}
        </span>
        <span class="ag-cm-right">
          ${SVG_CM_CHEVRON}
        </span>
      </button>
      ${nativeRowHtml}
    `;

    if (activeModelSubmenu === 'effort' && hasAdjustableEffort) {
      const famTitle = cat.activeFamily ? cat.activeFamily.baseName : '';
      subPop.innerHTML =
        `<div class="ag-cm-sec-hdr">${L('思考强度', 'Thinking effort')} · ${escapeHtml(famTitle)}</div>` +
        multiEfforts
          .map((v) => {
            const on = Boolean(cat.activeVariant && v.effort === cat.activeVariant.effort);
            const desc = displayEffortDesc(v.effort);
            const label = displayEffortLabel(v.effort);
            return `<button type="button" class="ag-cm-row" data-ag-cm-effort="${escapeHtml(v.effort)}">
              <span>
                <span style="display:block;line-height:1.25;">${escapeHtml(label)}</span>
                ${desc ? `<span class="ag-cm-sub-desc" style="display:block;">${escapeHtml(desc)}</span>` : ''}
              </span>
              ${on ? SVG_CM_CHECK : ''}
            </button>`;
          })
          .join('');
      subPop.setAttribute('data-open', 'true');
      triPop.setAttribute('data-open', 'false');
    } else if (activeModelSubmenu === 'more' && cat.moreFamilies.length > 0) {
      const orchEntries = cat.moreFamilies.filter((x) => x.group === 'orch');
      const otherEntries = cat.moreFamilies.filter((x) => x.group !== 'orch');
      const execCat = orchEntries.length > 0 ? buildExecutorCatalog(api) : null;
      const hasExecRow = Boolean(execCat && execCat.families.length > 0);
      const isExecTriActive = Boolean(activeModelTrimenu && activeModelTrimenu.kind === 'executor' && hasExecRow);

      let subHtml = '';
      if (orchEntries.length > 0) {
        subHtml += `<div class="ag-cm-sec-hdr">${escapeHtml(L('多智能体编排', 'Orchestrators'))}</div>`;
        subHtml += orchEntries
          .map(({ fam }) => {
            const on = Boolean(cat.activeFamily && cat.activeFamily.baseName === fam.baseName);
            const multiEff = fam.variants.filter((v) => Boolean(v.effort));
            const hasMulti = multiEff.length > 1;
            const triOn = Boolean(
              hasMulti &&
                activeModelTrimenu &&
                activeModelTrimenu.kind === 'planner' &&
                activeModelTrimenu.familyName === fam.baseName
            );
            const activeEffText =
              on && cat.activeVariant && cat.activeVariant.effort
                ? `<span class="ag-cm-orch-eff">${escapeHtml(displayEffortLabel(cat.activeVariant.effort))}</span>`
                : '';
            const rightHtml = hasMulti
              ? `<span class="ag-cm-right">${activeEffText}${SVG_CM_CHEVRON}</span>`
              : on
                ? SVG_CM_CHECK
                : '';
            return `<button type="button" class="ag-cm-row" style="min-height:34px;font-size:13.5px;" data-ag-cm-more-family="${escapeHtml(
              fam.baseName
            )}" data-ag-cm-tri-hover="${hasMulti ? 'planner' : 'none'}" data-ag-cm-tri-family="${escapeHtml(
              fam.baseName
            )}"${triOn ? ' data-active-sub="true"' : ''}>
              <span style="min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${escapeHtml(fam.baseName)}</span>
              ${rightHtml}
            </button>`;
          })
          .join('');
        if (hasExecRow) {
          subHtml += `<div class="ag-cm-sub-divider"></div>
            <button type="button" class="ag-cm-row ag-cm-sub-exec-row" data-ag-cm-tri-hover="executor" data-ag-cm-tritrigger="executor"${
              isExecTriActive ? ' data-active-sub="true"' : ''
            }>
              <span class="ag-cm-exec-label">
                <span>${L('执行模型', 'Executor model')}</span>
                ${!execCat.isDefault ? '<span class="ag-cm-dot"></span>' : ''}
              </span>
              <span class="ag-cm-right ag-cm-exec-summary">
                <span>${escapeHtml(execCat.shortSummary)}</span>
                ${SVG_CM_CHEVRON}
              </span>
            </button>`;
        }
      }

      if (otherEntries.length > 0) {
        subHtml += `${orchEntries.length > 0 ? '<div class="ag-cm-divider"></div>' : ''}<div class="ag-cm-sec-hdr">${escapeHtml(
          L('其他模型', 'Other models')
        )}</div>`;
        subHtml += otherEntries
          .map(({ fam }) => {
            const on = Boolean(cat.activeFamily && cat.activeFamily.baseName === fam.baseName);
            return `<button type="button" class="ag-cm-row" style="min-height:34px;font-size:13.5px;" data-ag-cm-more-family="${escapeHtml(
              fam.baseName
            )}" data-ag-cm-tri-hover="none">
              <span style="min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${escapeHtml(fam.baseName)}</span>
              ${on ? SVG_CM_CHECK : ''}
            </button>`;
          })
          .join('');
      }

      subPop.innerHTML = subHtml;
      subPop.setAttribute('data-open', 'true');

      /* Level 3 popover: either Orchestrator planner thinking effort OR official whitelisted Executor picker */
      let triOpen = false;
      if (activeModelTrimenu && activeModelTrimenu.kind === 'planner' && activeModelTrimenu.familyName) {
        const entry = orchEntries.find((x) => x.fam.baseName === activeModelTrimenu.familyName);
        const effs = entry ? entry.fam.variants.filter((v) => Boolean(v.effort)) : [];
        if (entry && effs.length > 1) {
          const shortTitle = entry.fam.baseName.replace(/^Orchestrator\s*·\s*/i, '').trim() || entry.fam.baseName;
          const isActiveFam = Boolean(cat.activeFamily && cat.activeFamily.baseName === entry.fam.baseName);
          triPop.setAttribute('data-tri-kind', 'planner');
          triPop.innerHTML =
            `<div class="ag-cm-sec-hdr">${L('主模型强度', 'Planner effort')} · ${escapeHtml(shortTitle)}</div>` +
            effs
              .map((v) => {
                const on = Boolean(isActiveFam && cat.activeVariant && cat.activeVariant.effort === v.effort);
                const desc = displayEffortDesc(v.effort);
                const label = displayEffortLabel(v.effort);
                return `<button type="button" class="ag-cm-row" data-ag-cm-orch-family="${escapeHtml(
                  entry.fam.baseName
                )}" data-ag-cm-orch-effort="${escapeHtml(v.effort)}">
                  <span>
                    <span style="display:block;line-height:1.25;">${escapeHtml(label)}</span>
                    ${desc ? `<span class="ag-cm-sub-desc" style="display:block;">${escapeHtml(desc)}</span>` : ''}
                  </span>
                  ${on ? SVG_CM_CHECK : ''}
                </button>`;
              })
              .join('');
          triPop.setAttribute('data-open', 'true');
          triOpen = true;
        }
      } else if (isExecTriActive && execCat) {
        const execRowsHtml = execCat.families
          .map((fam) => {
            const isFamActive = Boolean(execCat.activeFamily && execCat.activeFamily.baseName === fam.baseName);
            const pillsHtml =
              fam.variants.length > 1
                ? `<div class="ag-cm-exec-pills">${fam.variants
                    .map((v) => {
                      const isVarOn = Boolean(
                        isFamActive && execCat.activeVariant && execCat.activeVariant.opt.value === v.opt.value
                      );
                      const lbl = displayEffortLabel(v.effort) || v.opt.label;
                      return `<button type="button" class="ag-cm-exec-pill" data-ag-cm-exec-val="${escapeHtml(
                        String(v.opt.value)
                      )}" data-active="${isVarOn ? 'true' : 'false'}">${escapeHtml(lbl)}</button>`;
                    })
                    .join('')}</div>`
                : '';
            return `<div class="ag-cm-exec-item">
              <button type="button" class="ag-cm-row ag-cm-exec-row" data-ag-cm-exec-family="${escapeHtml(fam.baseName)}">
                <span class="ag-cm-exec-name">${escapeHtml(fam.baseName)}</span>
                ${isFamActive ? SVG_CM_CHECK : ''}
              </button>
              ${pillsHtml}
            </div>`;
          })
          .join('');
        const resetHtml = !execCat.isDefault
          ? `<div class="ag-cm-divider"></div>
             <button type="button" class="ag-cm-row" style="min-height:32px;font-size:13px;" data-ag-cm-exec-val="0">
               <span>${L('恢复默认执行模型', 'Reset to default')}</span>
               <span class="ag-cm-key">${escapeHtml(execCat.defaultShortLabel)}</span>
             </button>`
          : '';
        triPop.setAttribute('data-tri-kind', 'executor');
        triPop.innerHTML =
          `<div class="ag-cm-sec-hdr ag-cm-exec-hdr"><span>${L('执行模型与强度 · 全局', 'Executor · Global')}</span><span class="ag-cm-exec-tag">${L('白名单', 'Official')}</span></div>` +
          execRowsHtml +
          resetHtml;
        triPop.setAttribute('data-open', 'true');
        triOpen = true;
      }
      if (!triOpen) {
        triPop.setAttribute('data-open', 'false');
      }
    } else {
      subPop.setAttribute('data-open', 'false');
      triPop.setAttribute('data-open', 'false');
    }

    positionModelPopovers();
  }

  /* ---- menu accessibility: roles, inert when closed, focus preserved across re-renders ---- */
  const MENU_KEY_ATTRS = [
    'data-ag-cm-family',
    'data-ag-cm-subtrigger',
    'data-ag-cm-tritrigger',
    'data-ag-cm-effort',
    'data-ag-cm-orch-effort',
    'data-ag-cm-exec-family',
    'data-ag-cm-exec-val',
    'data-ag-cm-more-family',
    'data-ag-cm-native'
  ];
  let focusBeforeModelMenu = null;
  let lastKeyToggleTs = 0;

  function menuFocusKey(el) {
    if (!el || !el.getAttribute) return null;
    for (const a of MENU_KEY_ATTRS) if (el.hasAttribute(a)) return [a, el.getAttribute(a)];
    return null;
  }

  function findMenuRowByKey(key) {
    if (!key) return null;
    for (const id of ['ag-claude-model-popover', 'ag-claude-model-subpop', 'ag-claude-model-tripop']) {
      const pop = document.getElementById(id);
      if (!pop) continue;
      for (const row of pop.querySelectorAll(`[${key[0]}]`)) if (row.getAttribute(key[0]) === key[1]) return row;
    }
    return null;
  }

  function isInModelMenu(el) {
    return Boolean(el && el.closest && el.closest('#ag-claude-model-popover, #ag-claude-model-subpop, #ag-claude-model-tripop'));
  }

  function syncMenuA11y() {
    for (const id of ['ag-claude-model-popover', 'ag-claude-model-subpop', 'ag-claude-model-tripop']) {
      const pop = document.getElementById(id);
      if (!pop) continue;
      const open = pop.getAttribute('data-open') === 'true';
      pop.setAttribute('role', 'menu');
      pop.setAttribute('aria-hidden', open ? 'false' : 'true');
      if (open) pop.removeAttribute('inert');
      else pop.setAttribute('inert', '');
      pop.querySelectorAll('.ag-cm-row').forEach((row) => {
        row.setAttribute('role', 'menuitem');
        row.setAttribute('tabindex', '-1');
        if (row.getAttribute('data-disabled') === 'true') row.setAttribute('aria-disabled', 'true');
      });
      pop.querySelectorAll('[data-ag-cm-subtrigger], [data-ag-cm-tritrigger], [data-ag-cm-tri-hover="planner"]').forEach((row) => {
        row.setAttribute('aria-haspopup', 'menu');
        row.setAttribute('aria-expanded', row.hasAttribute('data-active-sub') ? 'true' : 'false');
      });
    }
  }

  function renderModelPopovers() {
    const active = document.activeElement;
    const key = isInModelMenu(active) ? menuFocusKey(active) : null;
    renderModelPopoversRaw();
    syncMenuA11y();
    if (key) {
      const row = findMenuRowByKey(key);
      if (row) row.focus();
    }
  }

  function menuRows(pop) {
    return pop ? Array.from(pop.querySelectorAll('.ag-cm-row')).filter((r) => r.getAttribute('data-disabled') !== 'true') : [];
  }

  function focusFirstRow(pop, preferSelected) {
    const rows = menuRows(pop);
    if (!rows.length) return;
    const sel = preferSelected ? rows.find((r) => r.querySelector('.ag-cm-check')) : null;
    (sel || rows[0]).focus();
  }

  function openClaudeModelPopover(btnEl, opts = {}) {
    const btn = btnEl || findModelTriggerBtn();
    const api = discoverModelSelectorApi(btn);
    if (!api) return false;
    if (quotaPopoverOpen) closeQuotaPopover();
    if (api.open && typeof api.setIsOpen === 'function') {
      try {
        api.setIsOpen(false);
      } catch {}
    }
    focusBeforeModelMenu = document.activeElement && document.activeElement !== document.body ? document.activeElement : btn;
    activeModelTriggerBtn = btn;
    modelPopoverOpen = true;
    activeModelSubmenu = null;
    activeModelTrimenu = null;
    ensureOrchestratorRolesLoaded();
    if (btn) {
      btn.setAttribute('data-ag-model-open', 'true');
      btn.setAttribute('aria-expanded', 'true');
    }
    const { mainPop } = ensureModelPopovers();
    renderModelPopoversRaw();
    mainPop.setAttribute('data-open', 'true');
    syncMenuA11y();
    positionModelPopovers();
    if (opts.focus) focusFirstRow(mainPop, true);
    return true;
  }

  function closeClaudeModelPopover(opts = {}) {
    const hadFocus = isInModelMenu(document.activeElement);
    modelPopoverOpen = false;
    activeModelSubmenu = null;
    activeModelTrimenu = null;
    currentCatalogSnapshot = null;
    if (activeModelTriggerBtn) {
      activeModelTriggerBtn.removeAttribute('data-ag-model-open');
      activeModelTriggerBtn.setAttribute('aria-expanded', 'false');
    }
    document.querySelectorAll('button[data-ag-model-open]').forEach((el) => el.removeAttribute('data-ag-model-open'));
    const mainPop = document.getElementById('ag-claude-model-popover');
    const subPop = document.getElementById('ag-claude-model-subpop');
    const triPop = document.getElementById('ag-claude-model-tripop');
    if (mainPop) mainPop.setAttribute('data-open', 'false');
    if (subPop) subPop.setAttribute('data-open', 'false');
    if (triPop) triPop.setAttribute('data-open', 'false');
    syncMenuA11y();
    if (opts.returnFocus || hadFocus) {
      const target =
        focusBeforeModelMenu && document.body.contains(focusBeforeModelMenu) ? focusBeforeModelMenu : activeModelTriggerBtn;
      if (target && typeof target.focus === 'function') target.focus();
    }
    focusBeforeModelMenu = null;
  }

  function toggleClaudeModelPopover(btnEl, opts) {
    if (modelPopoverOpen) {
      closeClaudeModelPopover({ returnFocus: Boolean(opts && opts.focus) });
      return true;
    }
    return openClaudeModelPopover(btnEl, opts);
  }

  const TRIGGER_SEL = 'button[data-testid="model-selector-trigger"], button[data-ag-pd-model-trigger="true"]';

  const onModelTriggerPointerDown = (e) => {
    if (!FEAT.modelMenu || isCustomCssDisabled()) return;
    const trigger = e.target && e.target.closest && e.target.closest(TRIGGER_SEL);
    if (trigger) {
      if (e.button !== undefined && e.button !== 0) return;
      if (e.altKey && isNativeModelTriggerBtn(trigger)) {
        if (modelPopoverOpen) closeClaudeModelPopover();
        return;
      }
      const api = discoverModelSelectorApi(trigger);
      if (!api) return;
      if (shouldDeferToNativeModelMenu(e, trigger, api)) {
        if (modelPopoverOpen) closeClaudeModelPopover();
        return;
      }
      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation();
      toggleClaudeModelPopover(trigger);
      return;
    }
    if (!modelPopoverOpen) return;
    if (isInModelMenu(e.target)) return;
    closeClaudeModelPopover();
  };

  /* Mouse: the menu already toggled on pointerdown, so swallow the follow-up mousedown/click.
     Keyboard / assistive tech: activation arrives as a click with detail === 0 -> toggle here. */
  const onModelTriggerSwallowMouseClick = (e) => {
    if (!FEAT.modelMenu || isCustomCssDisabled()) return;
    const trigger = e.target && e.target.closest && e.target.closest(TRIGGER_SEL);
    if (!trigger) return;
    if (e.altKey && isNativeModelTriggerBtn(trigger)) return;
    if (Date.now() < bypassNativeModelTriggerUntil) return;
    const api = discoverModelSelectorApi(trigger);
    if (!api) return;
    if (shouldDeferToNativeModelMenu(e, trigger, api)) return;
    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();
    if (e.type === 'click' && e.detail === 0 && Date.now() - lastKeyToggleTs > 1000) {
      lastKeyToggleTs = Date.now();
      toggleClaudeModelPopover(trigger, { focus: true });
    }
  };

  const onModelPopoverKeyDown = (e) => {
    if (disposed || !FEAT.modelMenu || isCustomCssDisabled()) return;
    const plain = !e.metaKey && !e.ctrlKey && !e.altKey;
    if ((e.metaKey || e.ctrlKey) && !e.shiftKey && !e.altKey && e.key === '/') {
      const btn = findModelTriggerBtn();
      const btnApi = btn ? discoverModelSelectorApi(btn) : null;
      if (btnApi && !shouldDeferToNativeModelMenu(null, btn, btnApi)) {
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();
        toggleClaudeModelPopover(btn, { focus: true });
        return;
      }
    }

    const trig = e.target && e.target.closest && e.target.closest(TRIGGER_SEL);
    if (trig && plain && (e.key === 'Enter' || e.key === ' ' || e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
      const trigApi = discoverModelSelectorApi(trig);
      if (trigApi && !shouldDeferToNativeModelMenu(null, trig, trigApi)) {
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();
        lastKeyToggleTs = Date.now();
        if (modelPopoverOpen && e.key.startsWith('Arrow')) {
          focusFirstRow(document.getElementById('ag-claude-model-popover'), true);
        } else {
          toggleClaudeModelPopover(trig, { focus: true });
        }
        return;
      }
    }

    if (!modelPopoverOpen) return;
    const mainPop = document.getElementById('ag-claude-model-popover');
    const subPop = document.getElementById('ag-claude-model-subpop');
    const triPop = document.getElementById('ag-claude-model-tripop');
    const active = document.activeElement;
    const inTri = Boolean(triPop && triPop.contains(active));
    const inSub = Boolean(subPop && subPop.contains(active));
    const inMain = Boolean(mainPop && mainPop.contains(active));
    const stop = () => {
      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation();
    };

    const closeTriAndFocusSub = () => {
      const prevTri = activeModelTrimenu;
      activeModelTrimenu = null;
      renderModelPopovers();
      if (!subPop || !prevTri) return;
      let target = null;
      if (prevTri.kind === 'executor') {
        target = subPop.querySelector('[data-ag-cm-tritrigger="executor"]');
      } else if (prevTri.kind === 'planner' && prevTri.familyName) {
        for (const r of subPop.querySelectorAll('[data-ag-cm-tri-family]')) {
          if (r.getAttribute('data-ag-cm-tri-family') === prevTri.familyName) {
            target = r;
            break;
          }
        }
      }
      if (target) target.focus();
    };

    if (e.key === 'Escape') {
      stop();
      if (inTri && activeModelTrimenu) {
        closeTriAndFocusSub();
      } else if (inSub && activeModelSubmenu) {
        const kind = activeModelSubmenu;
        activeModelSubmenu = null;
        activeModelTrimenu = null;
        renderModelPopovers();
        const t = mainPop && mainPop.querySelector(`[data-ag-cm-subtrigger="${kind}"]`);
        if (t) t.focus();
      } else {
        closeClaudeModelPopover({ returnFocus: true });
      }
      return;
    }
    if (e.key === 'Tab' && (inMain || inSub || inTri)) {
      stop();
      closeClaudeModelPopover({ returnFocus: true });
      return;
    }
    if (plain && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
      stop();
      const rows = menuRows(inTri ? triPop : inSub ? subPop : mainPop);
      if (!rows.length) return;
      const down = e.key === 'ArrowDown';
      let idx = rows.indexOf(active);
      idx = idx < 0 ? (down ? 0 : rows.length - 1) : (idx + (down ? 1 : -1) + rows.length) % rows.length;
      rows[idx].focus();
      return;
    }
    if (plain && e.key === 'ArrowRight' && inMain && active.hasAttribute('data-ag-cm-subtrigger')) {
      stop();
      if (active.getAttribute('data-disabled') === 'true') return;
      activeModelSubmenu = active.getAttribute('data-ag-cm-subtrigger');
      activeModelTrimenu = null;
      renderModelPopovers();
      focusFirstRow(subPop, true);
      return;
    }
    if (plain && e.key === 'ArrowRight' && inSub) {
      const triKind = active.getAttribute('data-ag-cm-tri-hover');
      if (triKind === 'executor') {
        stop();
        activeModelTrimenu = { kind: 'executor' };
        renderModelPopovers();
        focusFirstRow(triPop, true);
        return;
      }
      if (triKind === 'planner') {
        const familyName = active.getAttribute('data-ag-cm-tri-family');
        if (familyName) {
          stop();
          activeModelTrimenu = { kind: 'planner', familyName };
          renderModelPopovers();
          focusFirstRow(triPop, true);
          return;
        }
      }
    }
    if (plain && e.key === 'ArrowLeft' && inTri) {
      stop();
      closeTriAndFocusSub();
      return;
    }
    if (plain && e.key === 'ArrowLeft' && inSub) {
      stop();
      const kind = activeModelSubmenu;
      activeModelSubmenu = null;
      activeModelTrimenu = null;
      renderModelPopovers();
      const t = mainPop && mainPop.querySelector(`[data-ag-cm-subtrigger="${kind}"]`);
      if (t) t.focus();
      return;
    }
    if (plain && /^[1-5]$/.test(e.key)) {
      const inEditable = Boolean(
        active &&
          (active.isContentEditable ||
            active.tagName === 'INPUT' ||
            active.tagName === 'TEXTAREA' ||
            (active.closest && active.closest('[contenteditable="true"]')))
      );
      if (inEditable) return;
      const idx = Number(e.key) - 1;
      const api = discoverModelSelectorApi(activeModelTriggerBtn);
      if (api) {
        const cat = currentCatalogSnapshot || buildModelCatalog(api);
        const fam = cat.primaryFamilies[idx];
        if (fam) {
          stop();
          const targetVar = pickVariantForFamily(fam, lastPreferredEffort);
          if (targetVar && targetVar.opt) applyModelSelectionOption(api, targetVar.opt, targetVar.plannerOpt);
          closeClaudeModelPopover({ returnFocus: true });
        }
      }
    }
  };

  document.addEventListener('pointerdown', onModelTriggerPointerDown, true);
  document.addEventListener('mousedown', onModelTriggerSwallowMouseClick, true);
  document.addEventListener('click', onModelTriggerSwallowMouseClick, true);
  document.addEventListener('keydown', onModelPopoverKeyDown, true);
  later(() => {
    if (!disposed && FEAT.modelMenu) ensureOrchestratorRolesLoaded();
  }, 600);

  /* ==========================================================================
   * 7. Inline Undo & Edit (Claude-Style Message In-Bubble Re-Edit)
   *    - Intercepts `button[data-testid="revert-button"]` to expand a clean
   *      in-bubble editor without wiping downstream turns until confirmed.
   *    - 100% delegates file revert previews & Lexical state to native host.
   * ========================================================================== */
  let activeInlineEdit = null;
  let inlineUndoBusy = false;

  function activeReactFiber(el) {
    if (!el) return null;
    const fk = Object.keys(el).find((k) => k.startsWith('__reactFiber$'));
    let fiber = fk ? el[fk] : null;
    let top = fiber;
    while (top && top.return) top = top.return;
    if (top && top.stateNode && top.stateNode.current && top.stateNode.current !== top) {
      fiber = (fiber && fiber.alternate) || fiber;
    }
    return fiber;
  }

  function resolveNativeRevertTarget(button) {
    let state = null;
    let context = null;
    let session;
    let index;
    let text;
    let rawItems = null;
    for (let f = activeReactFiber(button), depth = 0; f && depth < 65; f = f.return, depth++) {
      const props = f.memoizedProps;
      if (!state && props && props.revertState) state = props.revertState;
      if (session === undefined && props && typeof props.cascadeId === 'string') session = props.cascadeId;
      if (index === undefined && props && Number.isInteger(props.userStepIndex)) index = props.userStepIndex;
      if (text === undefined && props && Array.isArray(props.items)) {
        rawItems = props.items.slice();
        text = props.items
          .filter((it) => it && it.chunk && it.chunk.case === 'text')
          .map((it) => it.chunk.value || '')
          .join('');
      }
      for (let d = f.dependencies && f.dependencies.firstContext; d; d = d.next) {
        const val = d.memoizedValue;
        if (!context && val && val.stepHandler && val.stepHandler.getRevertPreviews && val.inputBoxRef) {
          context = val;
        }
      }
      if (state && context && session && index !== undefined && text !== undefined) break;
    }
    if (!state || !state.canRevert || !state.revertPreviewState || !state.revertPreviewState.revert || !context || !session || index === undefined) {
      return null;
    }
    const stepEl = button.closest && button.closest('[data-testid="user-input-step"]');
    if (text === undefined) {
      const q =
        stepEl &&
        stepEl.querySelector('[data-testid="user-message-content"] [data-quotable="true"], [data-testid="user-message-content"]');
      text = (q && q.textContent) || '';
    }
    const nonTextItems = Array.isArray(rawItems)
      ? rawItems.filter((it) => it && it.chunk && it.chunk.case === 'item')
      : [];
    const hasDomRichItems = Boolean(
      stepEl &&
        stepEl.querySelector('[data-uri], bdi.context-scope-mention, [data-testid="skill-scope-item-pill"], [data-testid="context-scope-item-cider"]')
    );
    const hasRichItems = nonTextItems.length > 0 || hasDomRichItems;
    return { state: state.revertPreviewState, context, session, index, text, rawItems, nonTextItems, hasRichItems, stepEl };
  }

  function getComposerLexicalRoot(context) {
    const ref = context && context.inputBoxRef && context.inputBoxRef.current;
    return ref && ref.lexicalRef && ref.lexicalRef.current && ref.lexicalRef.current.getRootElement
      ? ref.lexicalRef.current.getRootElement()
      : null;
  }

  function composerHasExistingDraft(context) {
    const rootEl = getComposerLexicalRoot(context);
    if (rootEl && (rootEl.textContent || '').trim()) return true;
    const ref = context && context.inputBoxRef && context.inputBoxRef.current;
    const media = ref && typeof ref.getMediaAttachments === 'function' ? ref.getMediaAttachments() : null;
    return Boolean(media && media.length);
  }

  function setComposerText(context, text) {
    const value = String(text ?? '');
    const ref = context && context.inputBoxRef && context.inputBoxRef.current;
    const ed = ref && ref.lexicalRef && ref.lexicalRef.current;
    if (ed && ed._nodes && typeof ed.update === 'function') {
      const ParaNode = ed._nodes.get('paragraph') && ed._nodes.get('paragraph').klass;
      const TextNode = ed._nodes.get('text') && ed._nodes.get('text').klass;
      const LineBreakNode = ed._nodes.get('linebreak') && ed._nodes.get('linebreak').klass;
      if (ParaNode && TextNode) {
        ed.update(
          () => {
            const rootNode = ed.getEditorState()._nodeMap.get('root')?.getWritable?.();
            if (!rootNode) return;
            rootNode.clear();
            const p = new ParaNode();
            value.split(/\r?\n/).forEach((line, i) => {
              if (i > 0 && LineBreakNode) p.append(new LineBreakNode());
              if (line) p.append(new TextNode(line));
            });
            rootNode.append(p);
            if (typeof p.selectEnd === 'function') p.selectEnd();
          },
          { discrete: true }
        );
        return;
      }
    }
    const el = getComposerLexicalRoot(context);
    if (el) el.textContent = value;
  }

  function buildRebuiltRichItems(rawItems, nextText) {
    if (!Array.isArray(rawItems) || rawItems.length === 0) return null;
    const preserved = rawItems.filter((it) => it && it.chunk && it.chunk.case !== 'text');
    if (preserved.length === 0) return null;
    const out = preserved.slice();
    const val = String(nextText ?? '');
    if (val) {
      out.push({
        $typeName: 'exa.codeium_common_pb.TextOrScopeItem',
        chunk: { case: 'text', value: val }
      });
    }
    return out;
  }

  async function performNativeRevert(target) {
    const handler = target.context.stepHandler;
    const orig = handler.revertToIndex;
    let pending = null;
    let resolveCalled = null;
    const calledPromise = new Promise((r) => {
      resolveCalled = r;
    });
    const wrapped = function (...args) {
      const res = orig.apply(this, args);
      if (args[0] === target.session && args[1] === target.index - 1) {
        pending = Promise.resolve(res);
        resolveCalled(true);
      }
      return res;
    };
    handler.revertToIndex = wrapped;
    try {
      const ret = target.state.revert();
      if (ret && typeof ret.then === 'function') {
        await ret;
      }
      if (!pending) {
        /* Support async native revert implementations that call revertToIndex on a later microtask/tick */
        await Promise.race([calledPromise, new Promise((r) => setTimeout(r, 250))]);
      }
    } finally {
      if (handler.revertToIndex === wrapped) {
        handler.revertToIndex = orig;
      }
    }
    if (pending) {
      await pending;
      await new Promise((r) => setTimeout(r, 0));
      return;
    }
    if (target.stepEl && !target.stepEl.isConnected) {
      await new Promise((r) => setTimeout(r, 0));
      return;
    }
    throw new Error('revert_not_dispatched');
  }

  async function submitComposerAfterRevert(context, composerEl) {
    await new Promise((r) => setTimeout(r, 360));
    if (disposed) return;
    const ref = context && context.inputBoxRef && context.inputBoxRef.current;
    if (ref && typeof ref.submit === 'function') {
      ref.submit();
      return;
    }
    const scope =
      (getComposerLexicalRoot(context) && getComposerLexicalRoot(context).closest('[data-testid="agent-input-box"]')) ||
      composerEl ||
      document;
    const sendBtn = scope.querySelector(
      'button[data-testid="input-send-button"]:not(:disabled), button[aria-label="Send message"]:not(:disabled), button[aria-label*="发送"]:not(:disabled)'
    );
    if (sendBtn) sendBtn.click();
  }

  function closeInlineEdit(restoreFocus) {
    if (!activeInlineEdit) return;
    const { button, bubble, contentEl, hosts, editorBox } = activeInlineEdit;
    activeInlineEdit = null;
    inlineUndoBusy = false;
    if (editorBox && editorBox.parentNode) editorBox.remove();
    if (bubble) bubble.classList.remove('ag-claude-editing-bubble');
    if (hosts) hosts.forEach((h) => h.classList.remove('ag-claude-editing-host'));
    if (contentEl) {
      contentEl.hidden = false;
      contentEl.classList.remove('ag-claude-inline-hidden');
    }
    if (restoreFocus && button && button.isConnected && typeof button.focus === 'function') {
      button.focus({ preventScroll: true });
    }
  }

  function renderInlineEditMeta(stObj) {
    if (!stObj || activeInlineEdit !== stObj) return;
    const { editorBox, button } = stObj;
    const metaEl = editorBox.querySelector('[data-ag-inline-meta]');
    const filesEl = editorBox.querySelector('[data-ag-inline-files]');
    if (!metaEl) return;
    const cur = resolveNativeRevertTarget(button) || stObj.target;
    const rState = cur.state;
    const convOnly = stObj.conversationOnly !== undefined ? stObj.conversationOnly : Boolean(rState.conversationOnly);
    const loading = !convOnly && stObj.preview === null && !stObj.previewError;
    const fileSummary = convOnly
      ? L('仅撤回对话 · 保留文件修改', 'Chat only · keep file edits')
      : loading
        ? L('正在检查变更文件…', 'Checking modified files…')
        : stObj.previewError
          ? L('文件预览获取失败', 'Failed to preview file changes')
          : stObj.preview && stObj.preview.length
            ? L(`还原 ${stObj.preview.length} 个文件`, `Revert ${stObj.preview.length} ${stObj.preview.length === 1 ? 'file' : 'files'}`)
            : L('无关联文件变更', 'No modified files');
    const hasMedia = Boolean(
      stObj.bubble && stObj.bubble.querySelector('.agy-user-bubble-header, img, [data-testid*="attachment"], [data-testid*="media"]')
    );
    const hasRichRefs = Boolean(cur && cur.hasRichItems);
    metaEl.innerHTML =
      (rState.conversationOnlyRevertEnabled
        ? `<button type="button" class="ag-claude-switch" role="switch" data-ag-revert-files-switch aria-label="${escapeHtml(L('同步撤回文件修改', 'Revert modified files'))}" aria-checked="${!convOnly}"><span></span></button><span>${L('同步撤回文件', 'Revert files')}</span><span style="opacity:0.45">·</span>`
        : '') +
      `<span>${escapeHtml(fileSummary)}</span>` +
      (hasRichRefs
        ? `<span style="opacity:0.75" title="${escapeHtml(L('自动保留原消息中的 @ 引用、斜杠命令与技能胶囊；按住 ⌥ 点撤回可打开官方撤回界面', 'Preserves original @ mentions, slash commands & skills; Option+click Revert for native UI'))}">· ${L('保留原引用', 'Keep mentions')}</span>`
        : '') +
      (hasMedia
        ? `<span style="opacity:0.75" title="${escapeHtml(L('重发时自动保留原消息图片/附件；如需增删附件请点「移至底栏」', 'Keeps original attachments on resend; click Move to input to edit attachments'))}">· ${L('保留原附件', 'Keep attachments')}</span>`
        : '');

    if (filesEl) {
      if (!convOnly && !loading && !stObj.previewError && stObj.preview && stObj.preview.length) {
        const chips = stObj.preview
          .slice(0, 8)
          .map((p) => {
            const raw = String(p.fileUri || p.uri || 'file');
            const base = decodeURIComponent(raw.split('/').pop() || raw);
            return `<span class="ag-claude-inline-file-chip">${escapeHtml(base)}</span>`;
          })
          .join('');
        const extra = stObj.preview.length > 8 ? `<span class="ag-claude-inline-file-chip">+${stObj.preview.length - 8}</span>` : '';
        filesEl.innerHTML = `<div>${L(`撤回此步将一并还原以下 ${stObj.preview.length} 个文件至提问前状态：`, `Reverting will restore these ${stObj.preview.length} ${stObj.preview.length === 1 ? 'file' : 'files'}:`)}</div><div class="ag-claude-inline-file-chips">${chips}${extra}</div>`;
      } else {
        filesEl.innerHTML = '';
      }
    }

    const sw = metaEl.querySelector('[data-ag-revert-files-switch]');
    if (sw) {
      sw.addEventListener('click', () => {
        const latest = resolveNativeRevertTarget(button) || stObj.target;
        const nextConvOnly = !(stObj.conversationOnly ?? Boolean(latest.state.conversationOnly));
        stObj.conversationOnly = nextConvOnly;
        if (typeof latest.state.setConversationOnly === 'function') {
          latest.state.setConversationOnly(nextConvOnly);
        }
        if (!nextConvOnly && !stObj.previewLoaded && !stObj.previewError) {
          stObj.preview = null;
          renderInlineEditMeta(stObj);
          loadInlineRevertPreview(stObj);
          return;
        }
        renderInlineEditMeta(stObj);
      });
    }
  }

  async function loadInlineRevertPreview(stObj) {
    if (!stObj || stObj.previewLoading) return;
    stObj.previewLoading = true;
    try {
      const preview = await stObj.target.context.stepHandler.getRevertPreviews(stObj.target.session, stObj.target.index - 1);
      if (activeInlineEdit !== stObj) return;
      stObj.preview = Array.isArray(preview) ? preview : [];
      stObj.previewLoaded = true;
    } catch (err) {
      if (activeInlineEdit !== stObj) return;
      stObj.previewError = String((err && err.message) || err);
    } finally {
      stObj.previewLoading = false;
    }
    renderInlineEditMeta(stObj);
  }

  async function applyInlineUndo(shouldSubmit) {
    const stObj = activeInlineEdit;
    if (!stObj || inlineUndoBusy) return;
    let current = resolveNativeRevertTarget(stObj.button) || stObj.target;
    if (!current) return;
    inlineUndoBusy = true;
    const { editorBox } = stObj;
    const ta = editorBox.querySelector('.ag-claude-inline-textarea');
    if (ta) {
      stObj.draftText = ta.value;
      ta.disabled = true;
    }
    editorBox.querySelectorAll('button').forEach((b) => {
      b.disabled = true;
    });
    const warnEl = editorBox.querySelector('[data-ag-inline-warn]');
    if (warnEl) warnEl.textContent = shouldSubmit ? L('正在撤回并重发…', 'Reverting and resending…') : L('正在移至底栏…', 'Moving to composer…');

    const rootEl = getComposerLexicalRoot(current.context);
    const composerEl = (rootEl && rootEl.closest('[data-testid="agent-input-box"]')) || null;
    try {
      if (
        current.state &&
        current.state.conversationOnlyRevertEnabled &&
        stObj.conversationOnly !== undefined &&
        current.state.conversationOnly !== stObj.conversationOnly
      ) {
        current.state.setConversationOnly(stObj.conversationOnly);
        await new Promise((r) => setTimeout(r, 30));
        current = resolveNativeRevertTarget(stObj.button) || current;
      }
      await performNativeRevert(current);
      if (disposed || activeInlineEdit !== stObj) return;
      const textUnchanged = stObj.draftText === (stObj.target.text || '');
      const rebuiltRichItems =
        shouldSubmit && current.hasRichItems ? buildRebuiltRichItems(current.rawItems, stObj.draftText) : null;
      const agentPropsForRich = rebuiltRichItems ? discoverAgentInputProps(composerEl || rootEl) : null;
      if (rebuiltRichItems && agentPropsForRich && typeof agentPropsForRich.handleSubmit === 'function') {
        const ref = current.context && current.context.inputBoxRef && current.context.inputBoxRef.current;
        const media = ref && typeof ref.getMediaAttachments === 'function' ? ref.getMediaAttachments() : [];
        closeInlineEdit(false);
        await new Promise((r) => setTimeout(r, 360));
        if (disposed) return;
        await agentPropsForRich.handleSubmit(rebuiltRichItems, Array.isArray(media) ? media : [], () => {});
        return;
      }
      /* Preserve rich Lexical mention/slash/skill nodes restored by native revert when text was not modified */
      if (!(current.hasRichItems && textUnchanged)) {
        setComposerText(current.context, stObj.draftText);
      }
      closeInlineEdit(false);
      if (shouldSubmit) {
        await submitComposerAfterRevert(current.context, composerEl);
      } else {
        const nextRoot = getComposerLexicalRoot(current.context);
        if (nextRoot && typeof nextRoot.focus === 'function') nextRoot.focus();
      }
    } catch (err) {
      inlineUndoBusy = false;
      if (activeInlineEdit !== stObj) return;
      if (ta) ta.disabled = false;
      editorBox.querySelectorAll('button').forEach((b) => {
        b.disabled = false;
      });
      if (warnEl) warnEl.textContent = L('撤回失败，请重试', 'Revert failed, please try again');
    }
  }

  function openInlineEdit(button, target) {
    const stepEl = button.closest && button.closest('[data-testid="user-input-step"]');
    const bubble = (stepEl && stepEl.querySelector('[data-testid="user-message-bubble"]')) || button.parentElement;
    if (!bubble) return;
    const contentEl = bubble.querySelector('[data-testid="user-message-content"]');
    const hosts = [];
    for (let el = bubble.parentElement; el && el !== stepEl; el = el.parentElement) {
      const cls = String(el.className || '');
      if (el.classList.contains('agy-user-bubble-frame') || cls.includes('max-w-')) {
        hosts.push(el);
      }
    }
    bubble.classList.add('ag-claude-editing-bubble');
    hosts.forEach((h) => h.classList.add('ag-claude-editing-host'));
    if (contentEl) {
      contentEl.hidden = true;
      contentEl.classList.add('ag-claude-inline-hidden');
    }

    const editorBox = document.createElement('div');
    editorBox.className = 'ag-claude-inline-editor';
    editorBox.setAttribute('data-ag-i18n-ignore', '1');
    editorBox.setAttribute('role', 'region');
    editorBox.setAttribute('aria-label', L('原地编辑消息', 'Edit message inline'));
    editorBox.addEventListener('click', (ev) => ev.stopPropagation());

    const convOnly = Boolean(target.state && target.state.conversationOnly);
    const stObj = {
      button,
      target,
      bubble,
      contentEl,
      hosts,
      editorBox,
      draftText: target.text || '',
      conversationOnly: convOnly,
      preview: convOnly ? [] : null,
      previewError: '',
      previewLoaded: convOnly,
      previewLoading: false
    };
    activeInlineEdit = stObj;

    editorBox.innerHTML = `
      <textarea class="ag-claude-inline-textarea" aria-label="${escapeHtml(L('编辑消息内容', 'Edit message'))}" rows="1"></textarea>
      <div class="ag-claude-inline-files" data-ag-inline-files></div>
      <div class="ag-claude-inline-footer">
        <div class="ag-claude-inline-meta">
          <span data-ag-inline-meta style="display:inline-flex;align-items:center;gap:7px;flex-wrap:wrap"></span>
          <span class="ag-claude-inline-warn" data-ag-inline-warn role="status"></span>
        </div>
        <div class="ag-claude-inline-actions">
          <button type="button" class="ag-claude-inline-btn" data-ag-inline-cancel>${L('取消', 'Cancel')}</button>
          <button type="button" class="ag-claude-inline-btn" data-ag-inline-bottom title="${escapeHtml(L('撤回并移回底部输入框（可增删图片附件或切换模型）', 'Revert and move to bottom input (to edit attachments or switch model)'))}">${L('移至底栏', 'Move to input')}</button>
          <button type="button" class="ag-claude-inline-btn" data-primary="true" data-ag-inline-send>${L('重发', 'Resend')}</button>
        </div>
      </div>
    `;
    bubble.appendChild(editorBox);

    const ta = editorBox.querySelector('.ag-claude-inline-textarea');
    ta.value = stObj.draftText;
    const autoResize = () => {
      ta.style.height = 'auto';
      const h = Number(ta.scrollHeight) || 26;
      ta.style.height = `${Math.min(240, Math.max(26, h))}px`;
    };
    autoResize();
    ta.addEventListener('input', () => {
      stObj.draftText = ta.value;
      autoResize();
    });
    ta.addEventListener('keydown', (ev) => {
      if (ev.isComposing || ev.keyCode === 229) return;
      if (ev.key === 'Enter' && !ev.shiftKey) {
        ev.preventDefault();
        ev.stopPropagation();
        applyInlineUndo(true);
      } else if (ev.key === 'Escape') {
        ev.preventDefault();
        ev.stopPropagation();
        closeInlineEdit(true);
      }
    });
    editorBox.querySelector('[data-ag-inline-cancel]').addEventListener('click', () => closeInlineEdit(true));
    editorBox.querySelector('[data-ag-inline-bottom]').addEventListener('click', () => applyInlineUndo(false));
    editorBox.querySelector('[data-ag-inline-send]').addEventListener('click', () => applyInlineUndo(true));

    renderInlineEditMeta(stObj);
    if (composerHasExistingDraft(target.context)) {
      const warnEl = editorBox.querySelector('[data-ag-inline-warn]');
      if (warnEl) warnEl.textContent = L('将覆盖底栏现有草稿', 'Will replace current composer draft');
    }
    if (typeof ta.focus === 'function') {
      ta.focus({ preventScroll: true });
      const len = ta.value.length;
      if (typeof ta.setSelectionRange === 'function') ta.setSelectionRange(len, len);
    }
    if (!convOnly) loadInlineRevertPreview(stObj);
  }

  const onRevertButtonClick = (e) => {
    if (disposed || !FEAT.inlineUndo || e.altKey) return;
    const btn = e.target && e.target.closest && e.target.closest('button[data-testid="revert-button"]');
    if (!btn || btn.disabled || btn.getAttribute('aria-disabled') === 'true') return;
    const target = resolveNativeRevertTarget(btn);
    if (!target) return;
    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();
    if (inlineUndoBusy) return;
    if (activeInlineEdit && activeInlineEdit.button === btn) {
      closeInlineEdit(true);
      return;
    }
    closeInlineEdit(false);
    openInlineEdit(btn, target);
  };

  const onInlineEditDocKeyDown = (e) => {
    if (disposed || !activeInlineEdit || inlineUndoBusy) return;
    if (!activeInlineEdit.editorBox || !activeInlineEdit.editorBox.isConnected) {
      closeInlineEdit(false);
      return;
    }
    if (e.isComposing || e.keyCode === 229) return;
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation();
      closeInlineEdit(true);
    }
  };

  document.addEventListener('click', onRevertButtonClick, true);
  document.addEventListener('keydown', onInlineEditDocKeyDown, true);

  /* ==========================================================================
   * 8. Sidebar Enhancements: Collapsed Project Status Badges + Top Recents
   *    - Purely reads in-memory Redux `trajectorySummaries` (0 network calls).
   *    - Badges automatically fade on hover to yield to native `+ / ⋯` actions.
   *    - Top `最近对话` sorts `pending > running > recent` with 0ms router switch.
   * ========================================================================== */
  const SIDEBAR_IGNORED_TYPES = new Set([21, 22, 23]);
  const PENDING_TERM_SVG =
    '<svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" stroke-width="1.55" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3.5 5l3 3-3 3"/><path d="M8 11h4.5"/></svg>';
  const PENDING_LOCK_SVG =
    '<svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" stroke-width="1.45" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3.5" y="7" width="9" height="6" rx="1.5"/><path d="M5.5 7V5a2.5 2.5 0 0 1 5 0v2"/></svg>';
  const PENDING_BELL_SVG =
    '<svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" stroke-width="1.45" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M11.5 6.5a3.5 3.5 0 1 0-7 0c0 3.2-1.3 4.3-1.3 4.3h9.6s-1.3-1.1-1.3-4.3"/><path d="M6.8 13a1.3 1.3 0 0 0 2.4 0"/></svg>';
  const RECENT_PLUS_SVG =
    '<svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.55" stroke-linecap="round" aria-hidden="true"><path d="M8 3.2v9.6M3.2 8h9.6"/></svg>';
  const RECENT_PIN_SVG =
    '<svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9.7 2.8l3.5 3.5-1.4 1.4-.9-.3-2.6 2.6.4 1.6-1.1 1.1-2.5-2.5-2.6 2.6-.7-.7 2.6-2.6-2.5-2.5 1.1-1.1 1.6.4 2.6-2.6-.3-.9z"/></svg>';
  const RECENT_MORE_SVG =
    '<svg viewBox="0 0 16 16" width="13" height="13" fill="currentColor" aria-hidden="true"><circle cx="3.5" cy="8" r="1.2"/><circle cx="8" cy="8" r="1.2"/><circle cx="12.5" cy="8" r="1.2"/></svg>';
  const RECENT_FOLDER_SVG =
    '<svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2.2 4.4A1.2 1.2 0 0 1 3.4 3.2h3.1l1.2 1.3h4.9a1.2 1.2 0 0 1 1.2 1.2v6.1a1.2 1.2 0 0 1-1.2 1.2H3.4a1.2 1.2 0 0 1-1.2-1.2V4.4z"/></svg>';
  const RECENT_RENAME_SVG =
    '<svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M11.3 2.7l2 2-7.8 7.8-2.6.6.6-2.6 7.8-7.8z"/></svg>';
  const RECENT_ARCHIVE_SVG =
    '<svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="2.2" y="3" width="11.6" height="2.8" rx="0.8"/><path d="M3.2 5.8v6.4a1 1 0 0 0 1 1h7.6a1 1 0 0 0 1-1V5.8"/><path d="M6.4 8.8h3.2"/></svg>';
  const RECENT_TRASH_SVG =
    '<svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 4.5h10M6 4.5V3.3a.8.8 0 0 1 .8-.8h2.4a.8.8 0 0 1 .8.8v1.2"/><path d="M4.2 4.5l.7 8.1a1 1 0 0 0 1 .9h4.2a1 1 0 0 0 1-.9l.7-8.1"/></svg>';

  let sidebarStoreRef = null;
  let sidebarStoreUnsub = null;
  let sidebarSyncTimer = 0;
  let cachedSidebarActionsCtx = null;
  let recentExpanded = false;
  let recentPageLimit = 50;
  let recentLastSig = '';
  let recentRenamingId = '';
  let recentMenuState = null;
  let recentMenuDocBound = false;
  let recentItemsById = new Map();
  let recentLastDragEndTs = 0;

  /* ---- v2.34+ Conversation & File Drag-to-Composer (`application/context-scope-item-cider`) ---- */
  function buildCiderConversationPayload(id, title) {
    const cleanTitle = String(title || '').trim() || L('对话', 'Conversation');
    return JSON.stringify({ conversation: { id: String(id || ''), title: cleanTitle } });
  }

  function buildCiderFilePayload(absPathOrUri) {
    const raw = String(absPathOrUri || '').trim();
    if (!raw) return '';
    const uri = /^file:\/\//i.test(raw) ? raw : `file://${encodeURI(raw.startsWith('/') ? raw : `/${raw}`)}`;
    return JSON.stringify({ file: { absoluteUri: uri } });
  }

  function attachConversationDragTransfer(dt, id, title) {
    if (!dt || !id) return false;
    const payload = buildCiderConversationPayload(id, title);
    try {
      dt.effectAllowed = 'copyMove';
    } catch {}
    try {
      dt.setData('application/context-scope-item-cider', payload);
      return true;
    } catch {
      return false;
    }
  }

  function attachFileDragTransfer(dt, absPathOrUri) {
    if (!dt || !absPathOrUri) return false;
    const payload = buildCiderFilePayload(absPathOrUri);
    if (!payload) return false;
    const raw = String(absPathOrUri || '').trim();
    const uri = /^file:\/\//i.test(raw) ? raw : `file://${encodeURI(raw.startsWith('/') ? raw : `/${raw}`)}`;
    try {
      dt.effectAllowed = 'copyMove';
    } catch {}
    try {
      dt.setData('application/context-scope-item-cider', payload);
      dt.setData('application/vnd.code.uri-list', uri);
      dt.setData('text/uri-list', uri);
      return true;
    } catch {
      return false;
    }
  }

  function hasDroppedContextPayload(dt) {
    if (!dt) return false;
    const types = Array.from(dt.types || [], (t) => String(t || '').toLowerCase());
    return (
      types.includes('application/context-scope-item-cider') ||
      types.includes('application/vnd.code.uri-list') ||
      types.includes('resourceurls')
    );
  }

  function extractDroppedContextMentions(dt) {
    if (!dt) return [];
    const out = [];
    let rawCider = '';
    try {
      rawCider = dt.getData('application/context-scope-item-cider') || '';
    } catch {}
    if (rawCider && rawCider.trim()) {
      try {
        const parsed = JSON.parse(rawCider.trim());
        const arr = Array.isArray(parsed) ? parsed : [parsed];
        for (let entry of arr) {
          if (typeof entry === 'string') {
            try {
              entry = JSON.parse(entry);
            } catch {
              continue;
            }
          }
          if (!entry || typeof entry !== 'object') continue;
          const conv =
            entry.conversation ||
            (entry.scopeItem && entry.scopeItem.case === 'conversation' ? entry.scopeItem.value : null);
          if (conv && conv.id) {
            const label = String(conv.title || '').trim() || conv.id.slice(0, 8);
            out.push({
              kind: 'conversation',
              label,
              scopeItem: {
                $typeName: 'exa.codeium_common_pb.ContextScopeItem',
                scopeItem: {
                  case: 'conversation',
                  value: {
                    $typeName: 'exa.codeium_common_pb.ConversationScopeItem',
                    id: String(conv.id),
                    title: label,
                    source: String(conv.source || '')
                  }
                }
              }
            });
            continue;
          }
          const fileObj =
            entry.file ||
            entry.fileLineRange ||
            (entry.scopeItem && (entry.scopeItem.case === 'file' || entry.scopeItem.case === 'fileLineRange')
              ? entry.scopeItem.value
              : null);
          if (fileObj && fileObj.absoluteUri) {
            const uri = String(fileObj.absoluteUri);
            let label = uri.split('/').pop() || uri;
            try {
              label = decodeURIComponent(label);
            } catch {}
            out.push({
              kind: 'file',
              label,
              scopeItem: {
                $typeName: 'exa.codeium_common_pb.ContextScopeItem',
                scopeItem: {
                  case: 'file',
                  value: {
                    $typeName: 'exa.codeium_common_pb.FileScopeItem',
                    absoluteUri: uri
                  }
                }
              }
            });
            continue;
          }
          const dirObj =
            entry.directory ||
            (entry.scopeItem && entry.scopeItem.case === 'directory' ? entry.scopeItem.value : null);
          if (dirObj && dirObj.absoluteUri) {
            const uri = String(dirObj.absoluteUri);
            let label = uri.replace(/\/+$/, '').split('/').pop() || uri;
            try {
              label = decodeURIComponent(label);
            } catch {}
            out.push({
              kind: 'directory',
              label,
              scopeItem: {
                $typeName: 'exa.codeium_common_pb.ContextScopeItem',
                scopeItem: {
                  case: 'directory',
                  value: {
                    $typeName: 'exa.codeium_common_pb.DirectoryScopeItem',
                    absoluteUri: uri
                  }
                }
              }
            });
          }
        }
      } catch {}
    }
    if (out.length) return out;

    let uriList = '';
    try {
      uriList = dt.getData('application/vnd.code.uri-list') || '';
    } catch {}
    if (uriList && uriList.trim()) {
      for (const line of uriList.split(/\r?\n/)) {
        const u = line.trim();
        if (!u || u.startsWith('#') || !/^file:\/\//i.test(u)) continue;
        let label = u.split('/').pop() || u;
        try {
          label = decodeURIComponent(label);
        } catch {}
        out.push({
          kind: 'file',
          label,
          scopeItem: {
            $typeName: 'exa.codeium_common_pb.ContextScopeItem',
            scopeItem: {
              case: 'file',
              value: {
                $typeName: 'exa.codeium_common_pb.FileScopeItem',
                absoluteUri: u
              }
            }
          }
        });
      }
    }
    return out;
  }

  /* Bridge native pointer-dragged Pinned Sidebar rows (`[data-testid="conversation-row-sidebar"]`) into composers */
  let pinnedDragState = null;
  let pinnedDragOverCid = null;
  let pinnedDragGhostEl = null;
  function getLayoutReduxStore() {
    const bindings = findSidebarBindings();
    if (bindings && bindings.store && typeof bindings.store.dispatch === 'function') {
      return bindings.store;
    }
    return null;
  }
  function setPinnedChatDragOverTarget(nextCid) {
    const normalized = nextCid || null;
    if (pinnedDragOverCid === normalized) return;
    pinnedDragOverCid = normalized;
    const store = getLayoutReduxStore();
    if (store) {
      try {
        store.dispatch({ type: 'layout/setDragOverChatCascadeId', payload: normalized });
        if (normalized) {
          store.dispatch({ type: 'layout/setPendingSplitDrop', payload: null });
        }
      } catch {}
    }
  }
  function removePinnedDragGhost() {
    if (pinnedDragGhostEl) {
      try {
        pinnedDragGhostEl.remove();
      } catch {}
      pinnedDragGhostEl = null;
    }
    if (docRoot) docRoot.removeAttribute('data-ag-pinned-ghost-active');
  }
  function updatePinnedDragGhost(st, x, y) {
    if (!st || x <= st.sidebarRight - 8 || !document.body) {
      removePinnedDragGhost();
      return;
    }
    if (!pinnedDragGhostEl) {
      const ghost = document.createElement('div');
      ghost.id = 'ag-pinned-drag-ghost';
      ghost.className = 'ag-pinned-drag-ghost';
      ghost.setAttribute('aria-hidden', 'true');
      ghost.setAttribute('data-ag-i18n-ignore', '1');
      ghost.innerHTML = `<span class="ag-pinned-drag-ghost-title">${escapeHtml(st.title)}</span><span class="ag-pinned-drag-ghost-pin">${RECENT_PIN_SVG}</span>`;
      document.body.appendChild(ghost);
      pinnedDragGhostEl = ghost;
    }
    if (docRoot) docRoot.setAttribute('data-ag-pinned-ghost-active', 'true');
    pinnedDragGhostEl.style.width = `${st.rowWidth}px`;
    pinnedDragGhostEl.style.transform = `translate3d(${Math.round(x - st.grabOffsetX)}px, ${Math.round(y - st.grabOffsetY)}px, 0)`;
  }
  function clearPinnedDropZoneHighlightOnly() {
    if (docRoot) docRoot.removeAttribute('data-ag-pinned-chat-drop');
    setPinnedChatDragOverTarget(null);
    document
      .querySelectorAll('#antigravity\\.agentSidePanelInputBox[data-ag-convo-drop], [data-ag-pd-composer-box][data-drag="convo"]')
      .forEach((el) => {
        el.removeAttribute('data-ag-convo-drop');
        if (el.getAttribute('data-drag') === 'convo') el.removeAttribute('data-drag');
      });
  }
  function clearPinnedComposerDropHighlights() {
    clearPinnedDropZoneHighlightOnly();
    removePinnedDragGhost();
  }
  function findComposerUnderPoint(x, y) {
    const pdView = document.querySelector('#ag-claude-projects-view:not([hidden])');
    if (pdView) {
      const pdBox = pdView.querySelector('[data-ag-pd-composer-box]');
      if (pdBox) {
        const pdLeft = pdBox.closest('.ag-pd-left') || pdBox;
        const r = pdLeft.getBoundingClientRect();
        if (r.width > 0 && r.height > 0 && x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) {
          return { kind: 'project', el: pdBox };
        }
      }
    }
    const views = document.querySelectorAll('[data-testid="conversation-view"]');
    for (const view of views) {
      const r = view.getBoundingClientRect();
      if (r.width > 0 && r.height > 0 && x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) {
        const box = view.querySelector('[id="antigravity.agentSidePanelInputBox"]');
        const boxRect = box ? box.getBoundingClientRect() : null;
        const inBox = Boolean(
          boxRect && boxRect.width > 0 && boxRect.height > 0 && x >= boxRect.left && x <= boxRect.right && y >= boxRect.top && y <= boxRect.bottom
        );
        /* Leave left/right edge bands (~14%, capped at 96px) outside the composer free for official split-pane drag */
        const splitEdge = Math.min(96, r.width * 0.14);
        if (!inBox && r.width >= 360 && (x - r.left < splitEdge || r.right - x < splitEdge)) {
          return null;
        }
        return { kind: 'native', el: box || view, viewEl: view, targetCid: view.getAttribute('data-cascade-id') || '' };
      }
    }
    const nativeBoxes = document.querySelectorAll('[id="antigravity.agentSidePanelInputBox"]');
    for (const box of nativeBoxes) {
      const r = box.getBoundingClientRect();
      if (r.width > 0 && r.height > 0 && x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) {
        const viewEl = box.closest('[data-testid="conversation-view"]');
        return { kind: 'native', el: box, viewEl, targetCid: (viewEl && viewEl.getAttribute('data-cascade-id')) || '' };
      }
    }
    return null;
  }
  let dispatchingSyntheticPointerCancel = false;
  function cancelNativeDndSilently() {
    /* Cancel dnd-kit PointerSensor via synthetic pointercancel instead of Escape (which can stop live generation) */
    dispatchingSyntheticPointerCancel = true;
    try {
      const cancelEv =
        typeof PointerEvent === 'function'
          ? new PointerEvent('pointercancel', { bubbles: true, cancelable: false })
          : new Event('pointercancel', { bubbles: true });
      window.dispatchEvent(cancelEv);
    } catch {}
    dispatchingSyntheticPointerCancel = false;
  }
  const onPinnedRowPointerDown = (ev) => {
    if (disposed || ev.button !== 0 || ev.altKey) return;
    if (
      ev.target &&
      ev.target.closest &&
      ev.target.closest('button, input, textarea, [contenteditable="true"], .agy-row-actions')
    ) {
      return;
    }
    const row = ev.target && ev.target.closest && ev.target.closest('[data-testid="conversation-row-sidebar"][data-cascade-id]');
    if (!row) return;
    /* Only intercept Pinned rows (native unpinned rows keep native split-drag unless unified Recents replaces them) */
    const isPinnedRow =
      row.getAttribute('data-pinned') === 'true' ||
      Boolean(row.closest && row.closest('[data-ag-sb-unified="pinned"]'));
    if (!isPinnedRow) return;
    const cid = row.getAttribute('data-cascade-id');
    if (!cid) return;
    const a = row.querySelector('a[href]');
    const span = row.querySelector('.flex-col > span');
    const title =
      (span && span.textContent && span.textContent.trim()) ||
      (a && a.getAttribute('aria-label')) ||
      cid.slice(0, 8);
    const rowRect = row.getBoundingClientRect();
    const sbEl = row.closest('.bg-sidebar');
    const sbRect = sbEl ? sbEl.getBoundingClientRect() : null;
    pinnedDragState = {
      id: cid,
      title,
      startX: ev.clientX,
      startY: ev.clientY,
      active: false,
      grabOffsetX: rowRect.width > 0 ? Math.max(12, Math.min(rowRect.width - 12, ev.clientX - rowRect.left)) : 48,
      grabOffsetY: rowRect.height > 0 ? Math.max(8, Math.min(rowRect.height - 8, ev.clientY - rowRect.top)) : 16,
      rowWidth: rowRect.width > 0 ? Math.max(168, Math.min(248, Math.round(rowRect.width))) : 216,
      sidebarRight: sbRect && sbRect.width > 0 ? sbRect.right : rowRect.right || 256
    };
  };
  const onPinnedRowPointerMove = (ev) => {
    if (!pinnedDragState || disposed) return;
    if (ev.altKey) {
      clearPinnedComposerDropHighlights();
      return;
    }
    const dx = ev.clientX - pinnedDragState.startX;
    const dy = ev.clientY - pinnedDragState.startY;
    if (!pinnedDragState.active && dx * dx + dy * dy < 49) return;
    pinnedDragState.active = true;
    updatePinnedDragGhost(pinnedDragState, ev.clientX, ev.clientY);
    const hit = findComposerUnderPoint(ev.clientX, ev.clientY);
    if (!hit) {
      clearPinnedDropZoneHighlightOnly();
      return;
    }
    if (hit.kind === 'project') {
      if (docRoot) docRoot.setAttribute('data-ag-pinned-chat-drop', 'true');
      setPinnedChatDragOverTarget(null);
      hit.el.setAttribute('data-drag', 'convo');
    } else if (hit.kind === 'native') {
      const targetCid = hit.targetCid || '';
      if (targetCid && targetCid === pinnedDragState.id) {
        clearPinnedDropZoneHighlightOnly();
        return;
      }
      if (docRoot) docRoot.setAttribute('data-ag-pinned-chat-drop', 'true');
      if (targetCid) {
        setPinnedChatDragOverTarget(targetCid);
        const store = getLayoutReduxStore();
        if (store) {
          frame(() => {
            if (pinnedDragState && pinnedDragOverCid === targetCid) {
              try {
                if (store.getState && store.getState().layout && store.getState().layout.pendingSplitDrop) {
                  store.dispatch({ type: 'layout/setPendingSplitDrop', payload: null });
                }
              } catch {}
            }
          });
        }
      } else {
        setPinnedChatDragOverTarget(null);
        hit.el.setAttribute('data-ag-convo-drop', 'true');
      }
    }
  };
  const onPinnedRowPointerUp = (ev) => {
    if (!pinnedDragState) return;
    const st = pinnedDragState;
    pinnedDragState = null;
    clearPinnedComposerDropHighlights();
    if (!st.active || disposed || ev.altKey) return;
    const hit = findComposerUnderPoint(ev.clientX, ev.clientY);
    if (!hit) return;
    if (hit.kind === 'project') {
      ev.preventDefault();
      ev.stopPropagation();
      ev.stopImmediatePropagation();
      cancelNativeDndSilently();
      const projView = document.getElementById('ag-claude-projects-view');
      const projId = projView && projView.getAttribute('data-ag-pd-proj-id');
      const compInput = hit.el.querySelector('#ag-pd-composer-input');
      if (projId && compInput) {
        appendDroppedMentionsToPdComposer({ id: projId }, compInput, [
          {
            kind: 'conversation',
            label: st.title,
            scopeItem: {
              $typeName: 'exa.codeium_common_pb.ContextScopeItem',
              scopeItem: {
                case: 'conversation',
                value: {
                  $typeName: 'exa.codeium_common_pb.ConversationScopeItem',
                  id: st.id,
                  title: st.title,
                  source: ''
                }
              }
            }
          }
        ]);
      }
      return;
    }
    if (hit.kind === 'native') {
      const targetCid = hit.targetCid || '';
      if (targetCid && targetCid === st.id) return;
      ev.preventDefault();
      ev.stopPropagation();
      ev.stopImmediatePropagation();
      cancelNativeDndSilently();
      const store = getLayoutReduxStore();
      if (targetCid && store) {
        store.dispatch({ type: 'layout/setPendingSplitDrop', payload: null });
        store.dispatch({
          type: 'layout/setPendingChatDrop',
          payload: {
            cascadeId: targetCid,
            payload: { type: 'conversation', conversationId: st.id, title: st.title }
          }
        });
        return;
      }
      try {
        if (typeof DataTransfer === 'function' && typeof DragEvent === 'function') {
          const dt = new DataTransfer();
          attachConversationDragTransfer(dt, st.id, st.title);
          hit.el.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt }));
        }
      } catch {}
    }
  };
  const onPinnedRowPointerCancel = () => {
    if (dispatchingSyntheticPointerCancel) return;
    pinnedDragState = null;
    clearPinnedComposerDropHighlights();
  };
  document.addEventListener('pointerdown', onPinnedRowPointerDown, true);
  window.addEventListener('pointermove', onPinnedRowPointerMove, true);
  window.addEventListener('pointerup', onPinnedRowPointerUp, true);
  window.addEventListener('pointercancel', onPinnedRowPointerCancel, true);
  let recentCollapsed = (() => {
    try {
      if (trustLocalOverrides && typeof localStorage === 'object' && localStorage) {
        const v = localStorage.getItem('ag_claude_ux_recent_collapsed');
        if (v === '1' || v === '0') return v === '1';
      }
    } catch {}
    return Boolean(CFG_UI_STATE.recentCollapsed);
  })();
  let unifiedRecentCollapsed = (() => {
    try {
      if (trustLocalOverrides && typeof localStorage === 'object' && localStorage) {
        const v = localStorage.getItem('ag_claude_ux_unified_recents_collapsed');
        if (v === '1' || v === '0') return v === '1';
      }
    } catch {}
    return Boolean(CFG_UI_STATE.unifiedRecentCollapsed);
  })();

  function protoSeconds(ts) {
    if (!ts) return 0;
    if (typeof ts === 'number') return ts;
    if (ts.seconds !== undefined && ts.seconds !== null) return Number(ts.seconds) || 0;
    return 0;
  }

  function pendingSubkindOf(waitingStep) {
    const tool = String((waitingStep && waitingStep.metadata && waitingStep.metadata.toolCall && waitingStep.metadata.toolCall.name) || '')
      .split(':')
      .pop();
    if (tool === 'ask_permission') {
      try {
        const args = JSON.parse((waitingStep.metadata && waitingStep.metadata.toolCall && waitingStep.metadata.toolCall.argumentsJson) || '{}');
        if (args.command || args.CommandLine) return 'terminal';
        if (args.read_file || args.write_file || args.Path || args.AbsolutePath || args.TargetFile) return 'lock';
      } catch {}
      return 'lock';
    }
    if (/run_command|command/i.test(tool)) return 'terminal';
    return 'bell';
  }

  function hasIndexKey(idxCol, id) {
    if (!idxCol || !id) return false;
    if (typeof idxCol.has === 'function') return idxCol.has(id);
    if (Array.isArray(idxCol)) return idxCol.includes(id);
    if (typeof idxCol === 'object') return Object.prototype.hasOwnProperty.call(idxCol, id);
    return false;
  }

  function getIndexSize(idxCol) {
    if (!idxCol) return 0;
    if (typeof idxCol.size === 'number') return idxCol.size;
    if (Array.isArray(idxCol)) return idxCol.length;
    if (typeof idxCol === 'object') return Object.keys(idxCol).length;
    return 0;
  }

  function isSummaryPinned(id, summary, state) {
    if (summary && summary.annotations && summary.annotations.pinned) return true;
    const idxPinned =
      state && state.trajectorySummaries && state.trajectorySummaries.indexes && state.trajectorySummaries.indexes.pinned;
    return hasIndexKey(idxPinned, id);
  }

  function isSidebarVisibleSummary(id, summary, state) {
    if (!id || !summary) return false;
    if (summary.annotations && summary.annotations.archived) return false;
    if (summary.trajectoryMetadata && summary.trajectoryMetadata.parentConversationId) return false;
    if (summary.trajectoryMetadata && summary.trajectoryMetadata.isBattleModeFork) return false;
    if (
      summary.trajectoryMetadata &&
      summary.trajectoryMetadata.sourceMetadata &&
      summary.trajectoryMetadata.sourceMetadata.hideFromConversationList
    ) {
      return false;
    }
    if (SIDEBAR_IGNORED_TYPES.has(summary.trajectoryType)) return false;
    /* Antigravity partitions top-level conversations between `indexes.pinned` and `indexes.sidebar`
     * (`indexes.sidebar` excludes pinned conversations). Pinned items and external summaries are still visible. */
    if (isSummaryPinned(id, summary, state)) return true;
    const primarySummaries = state && state.trajectorySummaries && state.trajectorySummaries.summaries;
    if (primarySummaries && !Object.prototype.hasOwnProperty.call(primarySummaries, id)) {
      return true;
    }
    const idxSidebar =
      state && state.trajectorySummaries && state.trajectorySummaries.indexes && state.trajectorySummaries.indexes.sidebar;
    if (idxSidebar && getIndexSize(idxSidebar) > 0 && !hasIndexKey(idxSidebar, id)) {
      return false;
    }
    return true;
  }

  /* Left sidebar & Recents rely on native CSS `text-autospace: normal` (1/8em optical boundary, matching right-pane prose
   * without mutating DOM text nodes or polluting copied conversation titles with extra ASCII spaces). */
  function restoreLegacySidebarCjkNodes() {
    document.querySelectorAll('[data-ag-orig-cjk]').forEach((el) => {
      const orig = el.getAttribute('data-ag-orig-cjk');
      el.removeAttribute('data-ag-orig-cjk');
      if (orig !== null && el.childNodes.length === 1 && el.firstChild && el.firstChild.nodeType === 3) {
        el.firstChild.nodeValue = orig;
      }
    });
  }

  function classifySidebarConversation(id, summary, state, activeId, hasFocus) {
    if (!isSidebarVisibleSummary(id, summary, state)) return null;

    const summaries = (state && state.trajectorySummaries && state.trajectorySummaries.summaries) || {};
    const byParent = state && state.trajectorySummaries && state.trajectorySummaries.indexes && state.trajectorySummaries.indexes.byParent;
    let waitingStep = (summary.waitingSteps && summary.waitingSteps[0]) || null;
    const rawChildren = byParent && byParent[id];
    if (!waitingStep && rawChildren) {
      const childIds =
        typeof rawChildren[Symbol.iterator] === 'function'
          ? rawChildren
          : typeof rawChildren === 'object'
            ? Object.keys(rawChildren)
            : [];
      for (const cid of childIds) {
        const ch = summaries[cid];
        if (ch && ch.waitingSteps && ch.waitingSteps.length) {
          waitingStep = ch.waitingSteps[0];
          break;
        }
      }
    }
    const title = String((summary.annotations && summary.annotations.title) || summary.summary || id);
    if (waitingStep) {
      return { kind: 'pending', subkind: pendingSubkindOf(waitingStep), title };
    }

    const status = summary.status ?? 0;
    const isWorking =
      !summary.killed && (status === 2 || status === 3 || status === 4 || Boolean(summary.hasRunningSubagents));
    const isBgWorking =
      !summary.killed && (status === 1 || status === 0) && !summary.hasRunningSubagents && Boolean(summary.notFullyIdle);
    if (isWorking || isBgWorking) {
      return { kind: 'running', subkind: 'orbit', title };
    }

    if (!summary.notFullyIdle) {
      const marked = Boolean(summary.annotations && summary.annotations.markedAsUnread);
      const isFocusedHere = activeId === id && hasFocus;
      if (marked || !isFocusedHere) {
        const lastMod = protoSeconds(summary.lastModifiedTime);
        const remoteView = protoSeconds(summary.annotations && summary.annotations.lastUserViewTime);
        const localView = Number((state && state.conversation && state.conversation.localLastViewedTimes && state.conversation.localLastViewedTimes[id]) || 0);
        if (marked || (lastMod > 0 && lastMod > Math.max(remoteView, localView))) {
          return { kind: 'unread', subkind: 'dot', title };
        }
      }
    }
    return null;
  }

  function pendingGlyphSvg(subkind) {
    if (subkind === 'terminal') return PENDING_TERM_SVG;
    if (subkind === 'lock') return PENDING_LOCK_SVG;
    return PENDING_BELL_SVG;
  }

  function findSidebarBindings() {
    const sidebar = document.querySelector('[data-testid="conversation-list-sidebar"]');
    if (!sidebar) return null;
    let f = activeReactFiber(sidebar.firstElementChild || sidebar) || activeReactFiber(sidebar);
    let store = null;
    let router = null;
    let stepHandler = null;
    let actionsCtx = cachedSidebarActionsCtx;
    const groupsById = new Map();
    const projectLabels = new Map();

    const scanFiber = (startFiber, maxDepth) => {
      for (let cur = startFiber, d = 0; cur && d < maxDepth; d++, cur = cur.return) {
        const p = cur.memoizedProps;
        if (p && p.sidebarStore && !store) store = p.sidebarStore;
        if (p && p.sidebarRouter && !router) router = p.sidebarRouter;
        if (p && p.sidebarActions && !actionsCtx) actionsCtx = p.sidebarActions;
        if (p && Array.isArray(p.sidebarGroups) && !groupsById.size) {
          for (const g of p.sidebarGroups) {
            if (g && g.id) {
              groupsById.set(g.id, g.conversationIds || []);
              if (g.label || g.name) projectLabels.set(g.id, g.label || g.name);
            }
          }
        }
        if (!groupsById.size) {
          for (let s = cur.memoizedState; s; s = s.next) {
            const v = s.memoizedState;
            if (Array.isArray(v) && v.length && v[0] && Array.isArray(v[0].conversationIds)) {
              for (const g of v) {
                if (g && g.id) {
                  groupsById.set(g.id, g.conversationIds || []);
                  const lbl = g.label || g.name || g.title;
                  if (lbl) projectLabels.set(g.id, lbl);
                }
              }
              if (groupsById.size) break;
            }
          }
        }
        for (let dep = cur.dependencies && cur.dependencies.firstContext; dep; dep = dep.next) {
          const mv = dep.memoizedValue;
          if (!store && mv && mv.store && typeof mv.store.getState === 'function') {
            const st = mv.store.getState();
            if (st && st.trajectorySummaries && st.trajectorySummaries.summaries) {
              store = mv.store;
            }
          }
          if (!router && mv && typeof mv.navigate === 'function' && mv.state && mv.state.location) {
            router = mv;
          }
          if (!stepHandler && mv && mv.stepHandler && typeof mv.stepHandler.openConversation === 'function') {
            stepHandler = mv.stepHandler;
          }
          if (
            !actionsCtx &&
            mv &&
            (typeof mv.updateConversationAnnotations === 'function' || typeof mv.deleteCascadeTrajectory === 'function')
          ) {
            actionsCtx = mv;
          }
        }
        if (store && router && actionsCtx && groupsById.size) break;
      }
    };

    scanFiber(f, 36);
    if (!actionsCtx) {
      const anyRow = sidebar.querySelector('[data-testid="conversation-row-sidebar"]');
      if (anyRow) scanFiber(activeReactFiber(anyRow), 36);
    }
    if (!store) return null;
    if (actionsCtx) cachedSidebarActionsCtx = actionsCtx;

    const st = store.getState && store.getState();
    const rawProjects = (st && st.sidebarProjects && st.sidebarProjects.projects) || [];
    for (const p of rawProjects) {
      if (!p || !p.id || p.id === 'outside-of-project') continue;
      const lbl = p.id === 'default-cli-project' ? L('CLI 项目', 'CLI Project') : String(p.name || '').trim();
      if (lbl && !projectLabels.has(p.id)) projectLabels.set(p.id, lbl);
    }
    for (const hdr of sidebar.querySelectorAll('button[data-testid="project-header"]')) {
      const drop = hdr.closest('[data-sidebar-section-drop-id]');
      const pid = drop && drop.getAttribute('data-sidebar-section-drop-id');
      const lbl = hdr.getAttribute('data-project-label') || (hdr.textContent || '').trim();
      if (pid && lbl && !projectLabels.has(pid)) projectLabels.set(pid, lbl);
    }
    return { sidebar, store, router, stepHandler, actionsCtx, groupsById, projectLabels };
  }

  function resolveProjectHeaderId(btn) {
    const drop = btn.closest('[data-sidebar-section-drop-id]');
    if (drop) {
      const id = drop.getAttribute('data-sidebar-section-drop-id');
      if (id) return id;
    }
    for (let f = activeReactFiber(btn), d = 0; f && d < 10; f = f.return, d++) {
      const p = f.memoizedProps;
      if (p && typeof p.projectId === 'string' && p.projectId) return p.projectId;
      if (p && typeof p.brandedProjectId === 'string' && p.brandedProjectId) return p.brandedProjectId;
    }
    return '';
  }

  function clearAllFolderBadges() {
    document.querySelectorAll('.ag-claude-folder-badges').forEach((el) => el.remove());
    document.querySelectorAll('button[data-testid="project-header"][data-ag-folder-tip]').forEach((btn) => {
      const orig = btn.getAttribute('data-ag-orig-folder-title');
      btn.removeAttribute('data-ag-folder-tip');
      btn.removeAttribute('data-ag-orig-folder-title');
      if (orig) btn.setAttribute('title', orig);
      else btn.removeAttribute('title');
    });
  }

  function syncFolderStatusBadges(bindings, state, activeId, hasFocus) {
    if (!FEAT.folderStatus || !bindings) {
      clearAllFolderBadges();
      return;
    }
    const summaries = (state && state.trajectorySummaries && state.trajectorySummaries.summaries) || {};
    const headers = bindings.sidebar.querySelectorAll('button[data-testid="project-header"]');
    for (const btn of headers) {
      const host = btn.closest('.group\\/header') || btn.parentElement;
      if (!host) continue;
      if (!host.style.position && !host.classList.contains('relative')) {
        host.style.position = 'relative';
      }
      const collapsed = btn.getAttribute('aria-expanded') === 'false';
      const pid = collapsed ? resolveProjectHeaderId(btn) : '';
      const convIds = pid ? bindings.groupsById.get(pid) : null;
      let badgeWrap = host.querySelector(':scope > .ag-claude-folder-badges');

      if (!collapsed || !convIds || !convIds.length) {
        if (badgeWrap) badgeWrap.remove();
        if (btn.hasAttribute('data-ag-folder-tip')) {
          const orig = btn.getAttribute('data-ag-orig-folder-title');
          btn.removeAttribute('data-ag-folder-tip');
          btn.removeAttribute('data-ag-orig-folder-title');
          if (orig) btn.setAttribute('title', orig);
          else btn.removeAttribute('title');
        }
        continue;
      }

      const buckets = {
        pending: { kind: 'pending', count: 0, subkind: null, titles: [] },
        running: { kind: 'running', count: 0, subkind: 'orbit', titles: [] },
        unread: { kind: 'unread', count: 0, subkind: 'dot', titles: [] }
      };
      const seen = new Set();
      for (const cid of convIds) {
        if (!cid || seen.has(cid)) continue;
        seen.add(cid);
        const cls = classifySidebarConversation(cid, summaries[cid], state, activeId, hasFocus);
        if (!cls) continue;
        const b = buckets[cls.kind];
        b.count += 1;
        if (!b.subkind) b.subkind = cls.subkind;
        if (b.titles.length < 3 && cls.title) b.titles.push(cls.title);
      }

      const active = ['pending', 'running', 'unread'].map((k) => buckets[k]).filter((b) => b.count > 0);
      if (!active.length) {
        if (badgeWrap) badgeWrap.remove();
        if (btn.hasAttribute('data-ag-folder-tip')) {
          const orig = btn.getAttribute('data-ag-orig-folder-title');
          btn.removeAttribute('data-ag-folder-tip');
          btn.removeAttribute('data-ag-orig-folder-title');
          if (orig) btn.setAttribute('title', orig);
          else btn.removeAttribute('title');
        }
        continue;
      }

      const kindLabels = FEAT.i18n
        ? { pending: '待处理', running: '运行中', unread: '已完成未读' }
        : { pending: 'pending', running: 'running', unread: 'unread' };
      const summaryLine = active
        .map((b) => (FEAT.i18n ? `${b.count} 个${kindLabels[b.kind]}` : `${b.count} ${kindLabels[b.kind]}`))
        .join(' · ');
      const detailLines = active
        .flatMap((b) => b.titles.map((t) => `${kindLabels[b.kind]}${FEAT.i18n ? '：' : ': '}${t}`))
        .slice(0, 4);
      const tip = detailLines.length ? `${summaryLine}\n${detailLines.join('\n')}` : summaryLine;
      if (!btn.hasAttribute('data-ag-folder-tip')) {
        const orig = btn.getAttribute('title');
        if (orig) btn.setAttribute('data-ag-orig-folder-title', orig);
        btn.setAttribute('data-ag-folder-tip', 'true');
      }
      if (btn.getAttribute('title') !== tip) btn.setAttribute('title', tip);

      const html = active
        .slice(0, 2)
        .map((b) => {
          const ico =
            b.kind === 'pending'
              ? pendingGlyphSvg(b.subkind)
              : b.kind === 'running'
                ? '<span class="ag-folder-orbit"></span>'
                : '<span class="ag-claude-unread-dot"></span>';
          return `<span class="ag-claude-folder-badge" data-kind="${b.kind}">${ico}<span>${b.count}</span></span>`;
        })
        .join('');

      if (!badgeWrap) {
        badgeWrap = document.createElement('div');
        badgeWrap.className = 'ag-claude-folder-badges';
        badgeWrap.setAttribute('aria-hidden', 'true');
        host.appendChild(badgeWrap);
      }
      const sig = `${active.map((b) => `${b.kind}:${b.subkind}:${b.count}`).join('|')}`;
      if (badgeWrap.getAttribute('data-ag-sig') !== sig) {
        badgeWrap.setAttribute('data-ag-sig', sig);
        badgeWrap.innerHTML = html;
      }
    }
  }

  function formatRelativeAge(sec, nowSec) {
    if (!sec) return '';
    const diff = Math.max(0, nowSec - sec);
    if (diff < 60) return L('刚刚', 'now');
    if (diff < 3600) return `${Math.floor(diff / 60)}m`;
    if (diff < 86400) return `${Math.floor(diff / 3600)}h`;
    return `${Math.floor(diff / 86400)}d`;
  }

  function getSidebarListHost(sidebar) {
    if (!sidebar) return { host: null, container: null };
    const p = sidebar.parentElement;
    const isDedicatedWrap = Boolean(
      p &&
        p !== document.body &&
        !p.classList.contains('bg-sidebar') &&
        !p.querySelector('[data-testid="automations-button"], [data-testid="new-conversation-button"]')
    );
    const host = isDedicatedWrap ? p : sidebar;
    return { host, container: host && host.parentElement };
  }

  function resolveSummaryProjectInfo(summary, projectLabels, state) {
    const meta = (summary && summary.trajectoryMetadata) || {};
    const pid = String(meta.projectId || (summary && summary.projectId) || '');
    if (pid && pid !== 'outside-of-project') {
      if (projectLabels && projectLabels.has(pid)) return { id: pid, name: projectLabels.get(pid) };
      const rawProjects = (state && state.sidebarProjects && state.sidebarProjects.projects) || [];
      const found = rawProjects.find((p) => p && p.id === pid);
      if (found) {
        const nm = found.id === 'default-cli-project' ? L('CLI 项目', 'CLI Project') : String(found.name || '').trim();
        if (nm) return { id: pid, name: nm };
      }
      const uri = (meta.workspaceUris && meta.workspaceUris[0]) || '';
      const fallback = decodeURIComponent(String(uri).split('/').filter(Boolean).pop() || '');
      return { id: pid, name: fallback };
    }
    const wsUri = (meta.workspaceUris && meta.workspaceUris[0]) || '';
    if (wsUri) {
      const rawProjects = (state && state.sidebarProjects && state.sidebarProjects.projects) || [];
      const found = rawProjects.find((p) => p && Array.isArray(p.folderUris) && p.folderUris.includes(wsUri));
      if (found && found.id && found.id !== 'outside-of-project') {
        const nm = found.id === 'default-cli-project' ? L('CLI 项目', 'CLI Project') : String(found.name || '').trim();
        if (nm) return { id: found.id, name: nm };
      }
    }
    return { id: '', name: '' };
  }

  function navigateSidebarConversation(id, bindings) {
    if (!id) return;
    if (bindings && bindings.router && typeof bindings.router.navigate === 'function') {
      try {
        bindings.router.navigate({ to: '/c/$cascadeId', params: { cascadeId: id } });
        return;
      } catch {}
    }
    if (bindings && bindings.stepHandler && typeof bindings.stepHandler.openConversation === 'function') {
      try {
        bindings.stepHandler.openConversation(id);
        return;
      } catch {}
    }
    const link = document.querySelector(`a[href*="/c/${id}"]`);
    if (link && typeof link.click === 'function') {
      link.click();
      return;
    }
    if (typeof history === 'object' && typeof history.pushState === 'function') {
      history.pushState(null, '', `/c/${id}`);
      window.dispatchEvent(new PopStateEvent('popstate'));
    }
  }

  function triggerNewConversationFromSidebar(bindings) {
    const newBtn = document.querySelector('[data-testid="new-conversation-button"], a[href="/"]');
    if (newBtn && typeof newBtn.click === 'function') {
      try {
        newBtn.click();
        return;
      } catch {}
    }
    if (bindings && bindings.router && typeof bindings.router.navigate === 'function') {
      try {
        bindings.router.navigate({ to: '/' });
        return;
      } catch {}
    }
    if (typeof history === 'object' && typeof history.pushState === 'function') {
      history.pushState(null, '', '/');
      window.dispatchEvent(new PopStateEvent('popstate'));
    }
  }

  function getSidebarActionsCtx(bindings) {
    return (bindings && bindings.actionsCtx) || cachedSidebarActionsCtx || null;
  }

  async function mutateRecentConversationAnnotation(id, patch, bindings) {
    const act = getSidebarActionsCtx(bindings);
    if (!id || !act || typeof act.updateConversationAnnotations !== 'function') return false;
    try {
      await act.updateConversationAnnotations(id, patch, true);
      recentLastSig = '';
      scheduleSidebarSync();
      return true;
    } catch {
      return false;
    }
  }

  async function deleteRecentConversation(id, bindings) {
    const act = getSidebarActionsCtx(bindings);
    if (!id || !act || typeof act.deleteCascadeTrajectory !== 'function') return false;
    try {
      const wasActive = getActiveCascadeId() === id;
      await act.deleteCascadeTrajectory(id);
      if (wasActive) triggerNewConversationFromSidebar(bindings);
      recentLastSig = '';
      scheduleSidebarSync();
      return true;
    } catch {
      return false;
    }
  }

  function closeRecentRowMenu() {
    recentMenuState = null;
    const menu = document.getElementById('ag-recent-row-menu');
    if (menu) menu.remove();
    if (recentMenuDocBound) {
      document.removeEventListener('mousedown', onRecentMenuDocDown, true);
      document.removeEventListener('keydown', onRecentMenuDocKey, true);
      window.removeEventListener('resize', closeRecentRowMenu);
      recentMenuDocBound = false;
    }
  }

  function onRecentMenuDocDown(ev) {
    const t = ev && ev.target;
    if (t && t.closest && t.closest('#ag-recent-row-menu, [data-ag-recent-menu]')) return;
    closeRecentRowMenu();
  }

  function onRecentMenuDocKey(ev) {
    if (ev && ev.key === 'Escape') {
      ev.preventDefault();
      ev.stopPropagation();
      closeRecentRowMenu();
    }
  }

  function startRecentInlineRename(id) {
    if (!id) return;
    closeRecentRowMenu();
    recentRenamingId = id;
    recentLastSig = '';
    syncSidebarEnhancements();
    frame(() => {
      const input = document.querySelector('#ag-claude-recent-section [data-ag-recent-rename-input]');
      if (input) {
        input.focus();
        try {
          input.select();
        } catch {}
      }
    });
  }

  function commitRecentInlineRename(input, commit) {
    if (!input) return;
    const id = input.getAttribute('data-ag-recent-rename-input') || recentRenamingId;
    const orig = input.getAttribute('data-orig-title') || '';
    const nextVal = String(input.value || '').trim();
    recentRenamingId = '';
    recentLastSig = '';
    if (commit && id && nextVal && nextVal !== orig) {
      mutateRecentConversationAnnotation(id, { title: nextVal }, findSidebarBindings());
    }
    syncSidebarEnhancements();
  }

  function renderRecentRowMenu() {
    const st = recentMenuState;
    if (!st) {
      closeRecentRowMenu();
      return;
    }
    let menu = document.getElementById('ag-recent-row-menu');
    if (!menu) {
      menu = document.createElement('div');
      menu.id = 'ag-recent-row-menu';
      menu.setAttribute('role', 'menu');
      menu.setAttribute('data-ag-i18n-ignore', '1');
      menu.addEventListener('click', (ev) => {
        const btn = ev.target && ev.target.closest && ev.target.closest('[data-ag-rm-act]');
        if (!btn || !recentMenuState) return;
        ev.preventDefault();
        ev.stopPropagation();
        const act = btn.getAttribute('data-ag-rm-act');
        const cur = recentMenuState;
        const bindings = findSidebarBindings();
        if (act === 'open-project' && cur.projectId) {
          closeRecentRowMenu();
          if (FEAT.projects) openProjectsView(cur.projectId);
          return;
        }
        if (act === 'pin') {
          closeRecentRowMenu();
          mutateRecentConversationAnnotation(cur.id, { pinned: true }, bindings);
          return;
        }
        if (act === 'rename') {
          startRecentInlineRename(cur.id);
          return;
        }
        if (act === 'archive') {
          closeRecentRowMenu();
          mutateRecentConversationAnnotation(cur.id, { archived: true }, bindings);
          return;
        }
        if (act === 'delete') {
          if (!cur.confirmDelete) {
            cur.confirmDelete = true;
            renderRecentRowMenu();
            return;
          }
          closeRecentRowMenu();
          deleteRecentConversation(cur.id, bindings);
        }
      });
      document.body.appendChild(menu);
    }

    const canMutate = Boolean(getSidebarActionsCtx(findSidebarBindings()));
    const projPart =
      st.projectName && st.projectId && FEAT.projects
        ? `<button type="button" class="ag-rm-item ag-rm-project" data-ag-rm-act="open-project" title="${escapeHtml(L('打开所属项目', 'Open project'))}">${RECENT_FOLDER_SVG}<span class="ag-rm-label">${escapeHtml(st.projectName)}</span></button><div class="ag-rm-sep"></div>`
        : st.projectName
          ? `<div class="ag-rm-meta">${RECENT_FOLDER_SVG}<span class="ag-rm-label">${escapeHtml(st.projectName)}</span></div><div class="ag-rm-sep"></div>`
          : '';
    const delLabel = st.confirmDelete ? L('确认删除？', 'Confirm delete?') : L('删除', 'Delete');
    menu.innerHTML =
      projPart +
      `<button type="button" class="ag-rm-item" data-ag-rm-act="pin"${canMutate ? '' : ' disabled'}>${RECENT_PIN_SVG}<span class="ag-rm-label">${escapeHtml(L('置顶对话', 'Pin'))}</span></button>` +
      `<button type="button" class="ag-rm-item" data-ag-rm-act="rename"${canMutate ? '' : ' disabled'}>${RECENT_RENAME_SVG}<span class="ag-rm-label">${escapeHtml(L('重命名', 'Rename'))}</span></button>` +
      `<button type="button" class="ag-rm-item" data-ag-rm-act="archive"${canMutate ? '' : ' disabled'}>${RECENT_ARCHIVE_SVG}<span class="ag-rm-label">${escapeHtml(L('归档', 'Archive'))}</span></button>` +
      `<div class="ag-rm-sep"></div>` +
      `<button type="button" class="ag-rm-item ag-rm-danger" data-ag-rm-act="delete" data-confirm="${st.confirmDelete ? '1' : '0'}"${canMutate ? '' : ' disabled'}>${RECENT_TRASH_SVG}<span class="ag-rm-label">${escapeHtml(delLabel)}</span></button>`;

    const menuW = 196;
    const menuH = Math.max(152, menu.offsetHeight || 176);
    const vw = window.innerWidth || 1200;
    const vh = window.innerHeight || 800;
    const left = Math.min(Math.max(8, st.x), Math.max(8, vw - menuW - 8));
    const top = st.y + menuH > vh - 8 ? Math.max(8, st.y - menuH) : Math.max(8, st.y);
    menu.style.left = `${Math.round(left)}px`;
    menu.style.top = `${Math.round(top)}px`;

    if (!recentMenuDocBound) {
      document.addEventListener('mousedown', onRecentMenuDocDown, true);
      document.addEventListener('keydown', onRecentMenuDocKey, true);
      window.addEventListener('resize', closeRecentRowMenu);
      recentMenuDocBound = true;
    }
  }

  function openRecentRowMenu(item, x, y) {
    if (!item || !item.id) return;
    if (recentMenuState && recentMenuState.id === item.id) {
      closeRecentRowMenu();
      return;
    }
    recentMenuState = {
      id: item.id,
      title: item.title,
      projectId: item.projectId || '',
      projectName: item.project || '',
      x,
      y,
      confirmDelete: false
    };
    renderRecentRowMenu();
  }

  function removeRecentSection() {
    closeRecentRowMenu();
    recentRenamingId = '';
    const el = document.getElementById('ag-claude-recent-section');
    if (el) el.remove();
    recentLastSig = '';
  }

  function syncRecentSection(bindings, state, activeId, hasFocus) {
    const isUnified = Boolean(FEAT.hideSidebarProjects);
    if ((!isUnified && !FEAT.recentSection) || !bindings) {
      removeRecentSection();
      return;
    }
    const { host: sbParent, container: sbGrand } = getSidebarListHost(bindings.sidebar);
    if (!sbParent || !sbGrand) return;

    const summaries = (state && state.trajectorySummaries && state.trajectorySummaries.summaries) || {};
    const list = [];
    for (const [id, summary] of Object.entries(summaries)) {
      if (!isSidebarVisibleSummary(id, summary, state)) continue;
      if (isSummaryPinned(id, summary, state)) continue;
      const status = classifySidebarConversation(id, summary, state, activeId, hasFocus);
      const rawTitle = (summary.annotations && summary.annotations.title) || summary.summary;
      const isLiveOrActiveUntitled =
        !rawTitle &&
        (id === activeId ||
          (status && (status.kind === 'running' || status.kind === 'pending')) ||
          Number(summary.stepCount || 0) > 0);
      if (!rawTitle && !isLiveOrActiveUntitled) continue;
      const title = rawTitle ? String(rawTitle) : L('新对话', 'New conversation');
      const updatedAt = Math.max(protoSeconds(summary.lastModifiedTime), protoSeconds(summary.createdTime));
      const priority = status && status.kind === 'pending' ? 3 : status && status.kind === 'running' ? 2 : 1;
      const projInfo = resolveSummaryProjectInfo(summary, bindings.projectLabels, state);
      list.push({
        id,
        title,
        project: projInfo.name,
        projectId: projInfo.id,
        updatedAt,
        status,
        priority
      });
    }
    if (!list.length && !isUnified) {
      removeRecentSection();
      return;
    }
    list.sort((a, b) => b.priority - a.priority || b.updatedAt - a.updatedAt);
    recentItemsById = new Map(list.map((it) => [it.id, it]));
    const limit = isUnified ? recentPageLimit : recentExpanded ? 8 : 4;
    const items = list.slice(0, limit);
    const total = list.length;
    const nowBucket = Math.floor(Date.now() / 30000);
    const nowSec = Math.floor(Date.now() / 1000);
    const mode = isUnified ? 'unified' : 'compact';

    let sec = document.getElementById('ag-claude-recent-section');
    const desiredRef = isUnified ? sbParent.nextSibling : sbParent;
    const wrongParent = !sec || sec.parentElement !== sbGrand;
    const wrongPosition =
      sec &&
      sec.parentElement === sbGrand &&
      (isUnified ? sec.previousSibling !== sbParent : sec.nextSibling !== sbParent);

    if (wrongParent) {
      if (sec) sec.remove();
      sec = document.createElement('section');
      sec.id = 'ag-claude-recent-section';
      sec.setAttribute('data-ag-i18n-ignore', '1');
      sec.setAttribute('aria-label', L('最近对话', 'Recents'));
      sec.addEventListener('click', (ev) => {
        const newBtn = ev.target && ev.target.closest && ev.target.closest('[data-ag-recent-new]');
        if (newBtn) {
          ev.preventDefault();
          ev.stopPropagation();
          closeRecentRowMenu();
          triggerNewConversationFromSidebar(findSidebarBindings() || bindings);
          return;
        }
        const hdr = ev.target && ev.target.closest && ev.target.closest('[data-ag-recent-toggle]');
        if (hdr) {
          if (sec.getAttribute('data-mode') === 'unified') {
            unifiedRecentCollapsed = !unifiedRecentCollapsed;
            try {
              localStorage.setItem('ag_claude_ux_unified_recents_collapsed', unifiedRecentCollapsed ? '1' : '0');
            } catch {}
          } else {
            recentCollapsed = !recentCollapsed;
            try {
              localStorage.setItem('ag_claude_ux_recent_collapsed', recentCollapsed ? '1' : '0');
            } catch {}
          }
          persistUiPrefsToDaemon();
          recentLastSig = '';
          syncSidebarEnhancements();
          return;
        }
        const more = ev.target && ev.target.closest && ev.target.closest('[data-ag-recent-more]');
        if (more) {
          if (sec.getAttribute('data-mode') === 'unified') {
            recentPageLimit += 50;
          } else {
            recentExpanded = !recentExpanded;
          }
          recentLastSig = '';
          syncSidebarEnhancements();
          return;
        }
        const pinBtn = ev.target && ev.target.closest && ev.target.closest('[data-ag-recent-pin]');
        if (pinBtn) {
          ev.preventDefault();
          ev.stopPropagation();
          closeRecentRowMenu();
          const cid = pinBtn.getAttribute('data-ag-recent-pin');
          mutateRecentConversationAnnotation(cid, { pinned: true }, findSidebarBindings() || bindings);
          return;
        }
        const menuBtn = ev.target && ev.target.closest && ev.target.closest('[data-ag-recent-menu]');
        if (menuBtn) {
          ev.preventDefault();
          ev.stopPropagation();
          const cid = menuBtn.getAttribute('data-ag-recent-menu');
          const item = recentItemsById.get(cid);
          const r = menuBtn.getBoundingClientRect();
          openRecentRowMenu(item, r.right + 4, r.bottom + 4);
          return;
        }
        if (ev.target && ev.target.closest && ev.target.closest('[data-ag-recent-rename-input]')) {
          ev.stopPropagation();
          return;
        }
        const row = ev.target && ev.target.closest && ev.target.closest('[data-ag-recent-id]');
        if (row) {
          if (Date.now() - recentLastDragEndTs < 260) return;
          const cid = row.getAttribute('data-ag-recent-id');
          if (recentRenamingId && recentRenamingId === cid) return;
          closeRecentRowMenu();
          const curBindings = findSidebarBindings() || bindings;
          navigateSidebarConversation(cid, curBindings);
          scheduleSidebarSync();
        }
      });
      sec.addEventListener('dragstart', (ev) => {
        if (
          ev.target &&
          ev.target.closest &&
          ev.target.closest('[data-ag-recent-pin], [data-ag-recent-menu], [data-ag-recent-rename-input]')
        ) {
          ev.preventDefault();
          return;
        }
        const row = ev.target && ev.target.closest && ev.target.closest('[data-ag-recent-id]');
        if (!row) return;
        const cid = row.getAttribute('data-ag-recent-id');
        if (!cid || (recentRenamingId && recentRenamingId === cid)) {
          ev.preventDefault();
          return;
        }
        const item = recentItemsById.get(cid);
        const title = (item && item.title) || row.getAttribute('data-ag-recent-title') || '';
        attachConversationDragTransfer(ev.dataTransfer, cid, title);
        row.setAttribute('data-dragging', 'true');
      });
      sec.addEventListener('dragend', (ev) => {
        recentLastDragEndTs = Date.now();
        const row = ev.target && ev.target.closest && ev.target.closest('[data-ag-recent-id]');
        if (row) row.removeAttribute('data-dragging');
        sec.querySelectorAll('[data-dragging="true"]').forEach((n) => n.removeAttribute('data-dragging'));
      });
      sec.addEventListener('contextmenu', (ev) => {
        if (sec.getAttribute('data-mode') !== 'unified') return;
        const row = ev.target && ev.target.closest && ev.target.closest('[data-ag-recent-id]');
        if (!row) return;
        const cid = row.getAttribute('data-ag-recent-id');
        if (recentRenamingId && recentRenamingId === cid) return;
        const item = recentItemsById.get(cid);
        if (!item) return;
        ev.preventDefault();
        ev.stopPropagation();
        openRecentRowMenu(item, ev.clientX + 2, ev.clientY + 2);
      });
      sec.addEventListener('keydown', (ev) => {
        const input = ev.target && ev.target.closest && ev.target.closest('[data-ag-recent-rename-input]');
        if (input) {
          if (ev.key === 'Enter') {
            ev.preventDefault();
            ev.stopPropagation();
            commitRecentInlineRename(input, true);
          } else if (ev.key === 'Escape') {
            ev.preventDefault();
            ev.stopPropagation();
            commitRecentInlineRename(input, false);
          }
          return;
        }
        const row = ev.target && ev.target.closest && ev.target.closest('[data-ag-recent-id]');
        if (row && (ev.key === 'Enter' || ev.key === ' ')) {
          ev.preventDefault();
          if (projectsViewOpen) closeProjectsView();
          const cid = row.getAttribute('data-ag-recent-id');
          navigateSidebarConversation(cid, findSidebarBindings() || bindings);
          scheduleSidebarSync();
        }
      });
      sec.addEventListener(
        'blur',
        (ev) => {
          const input = ev.target && ev.target.closest && ev.target.closest('[data-ag-recent-rename-input]');
          if (input) commitRecentInlineRename(input, true);
        },
        true
      );
      sbGrand.insertBefore(sec, desiredRef);
      recentLastSig = '';
    } else if (wrongPosition) {
      sbGrand.insertBefore(sec, desiredRef);
      recentLastSig = '';
    }

    if (sec.getAttribute('data-mode') !== mode) {
      sec.setAttribute('data-mode', mode);
      recentLastSig = '';
    }

    if (recentRenamingId && sec.querySelector('[data-ag-recent-rename-input]')) {
      return;
    }

    const isCollapsed = isUnified ? unifiedRecentCollapsed : recentCollapsed;
    const sig = `${mode}|${FEAT.i18n ? 1 : 0}|${isCollapsed ? 1 : 0}|${isUnified ? recentPageLimit : recentExpanded ? 1 : 0}|${recentRenamingId}|${activeId}|${nowBucket}|${total}|${items
      .map((it) => `${it.id}:${it.title}:${it.project}:${it.status ? `${it.status.kind}-${it.status.subkind}` : 'idle'}:${Math.floor(it.updatedAt / 60)}`)
      .join(';')}`;
    if (sig === recentLastSig) return;
    recentLastSig = sig;
    sec.setAttribute('aria-label', L('最近对话', 'Recents'));

    const headerHtml = isUnified
      ? `<div class="ag-recent-hdr-bar"><button type="button" class="ag-recent-hdr" data-ag-recent-toggle aria-expanded="${!isCollapsed}"><span>${L('最近对话', 'Recents')}</span><span class="ag-recent-chevron">▾</span></button><button type="button" class="ag-recent-new-btn" data-ag-recent-new title="${escapeHtml(L('新建对话', 'New conversation'))}" aria-label="${escapeHtml(L('新建对话', 'New conversation'))}">${RECENT_PLUS_SVG}</button></div>`
      : `<button type="button" class="ag-recent-hdr" data-ag-recent-toggle aria-expanded="${!isCollapsed}"><span>${L('最近对话', 'Recents')}</span><span class="ag-recent-chevron">▾</span></button>`;

    const moreHtml = isUnified
      ? total > items.length
        ? `<button type="button" class="ag-recent-more" data-ag-recent-more>${escapeHtml(
            FEAT.i18n ? `显示更多（还有 ${total - items.length} 条）` : `Show more (${total - items.length} left)`
          )}</button>`
        : ''
      : total > 4
        ? `<button type="button" class="ag-recent-more" data-ag-recent-more>${recentExpanded ? L('收起', 'Show less') : L('展开更多', 'Show more')}</button>`
        : '';

    const rowsHtml = isCollapsed
      ? ''
      : items.length
        ? `<div class="ag-recent-list">${items
            .map((it) => {
              const isAct = it.id === activeId;
              const isRenaming = isUnified && recentRenamingId === it.id;
              const age = formatRelativeAge(it.updatedAt, nowSec);
              let sideHtml = `<span>${escapeHtml(age)}</span>`;
              if (it.status && it.status.kind === 'pending') {
                sideHtml = `<span class="ag-claude-folder-badge" data-kind="pending">${pendingGlyphSvg(it.status.subkind)}</span>`;
              } else if (it.status && it.status.kind === 'running') {
                sideHtml = '<span class="ag-folder-orbit"></span>';
              } else if (it.status && it.status.kind === 'unread') {
                sideHtml = `<span class="ag-claude-unread-dot"></span>${age ? `<span>${escapeHtml(age)}</span>` : ''}`;
              }
              const tip = it.project ? `${it.title}\n${L('所属项目：', 'Project: ')}${it.project}` : it.title;
              const actionsHtml =
                isUnified && !isRenaming
                  ? `<div class="ag-recent-actions"><button type="button" class="ag-recent-act-btn" data-ag-recent-pin="${escapeHtml(it.id)}" title="${escapeHtml(L('置顶对话', 'Pin'))}" aria-label="${escapeHtml(L('置顶对话', 'Pin'))}">${RECENT_PIN_SVG}</button><button type="button" class="ag-recent-act-btn" data-ag-recent-menu="${escapeHtml(it.id)}" title="${escapeHtml(L('更多选项', 'More options'))}" aria-label="${escapeHtml(L('更多选项', 'More options'))}">${RECENT_MORE_SVG}</button></div>`
                  : '';
              const mainInner = isRenaming
                ? `<input type="text" class="ag-recent-rename-input" data-ag-recent-rename-input="${escapeHtml(it.id)}" data-orig-title="${escapeHtml(it.title)}" value="${escapeHtml(it.title)}" />`
                : `<div class="ag-recent-title">${escapeHtml(it.title)}</div>`;
              return `<div class="ag-recent-row" role="button" tabindex="0"${isRenaming ? '' : ' draggable="true"'} data-ag-recent-id="${escapeHtml(it.id)}" data-ag-recent-title="${escapeHtml(it.title)}" data-active="${isAct ? 'true' : 'false'}"${it.project ? ` data-has-project="true"` : ''}${isRenaming ? ' data-renaming="true"' : ''} title="${escapeHtml(tip)}"><div class="ag-recent-main">${mainInner}</div>${isRenaming ? '' : `<div class="ag-recent-side">${sideHtml}</div>${actionsHtml}`}</div>`;
            })
            .join('')}</div>` + moreHtml
        : `<div class="ag-recent-empty">${escapeHtml(L('暂无最近对话', 'No recent conversations'))}</div>`;

    sec.innerHTML = `${headerHtml}${rowsHtml}`;
  }

  function scheduleSidebarSync() {
    if (disposed || sidebarSyncTimer) return;
    sidebarSyncTimer = later(() => {
      sidebarSyncTimer = 0;
      syncSidebarEnhancements();
    }, 90);
  }

  let sidebarHideRaf = 0;
  function scheduleSidebarHideSync() {
    if (disposed || sidebarHideRaf) return;
    sidebarHideRaf = frame(() => {
      sidebarHideRaf = 0;
      if (!disposed && FEAT.hideSidebarProjects) syncSidebarHideNativeProjects();
    });
  }

  function syncSidebarEnhancements() {
    if (disposed) return;
    restoreLegacySidebarCjkNodes();
    const unifiedRecentsOn = Boolean(FEAT.hideSidebarProjects);
    if (!FEAT.folderStatus && !FEAT.recentSection && !unifiedRecentsOn) {
      if (sidebarStoreUnsub) {
        sidebarStoreUnsub();
        sidebarStoreUnsub = null;
        sidebarStoreRef = null;
      }
      clearAllFolderBadges();
      removeRecentSection();
      return;
    }
    const bindings = findSidebarBindings();
    if (!bindings) {
      if (unifiedRecentsOn) clearSidebarHideNativeProjects();
      return;
    }
    if (sidebarStoreRef !== bindings.store) {
      if (sidebarStoreUnsub) sidebarStoreUnsub();
      sidebarStoreRef = bindings.store;
      if (typeof bindings.store.subscribe === 'function') {
        sidebarStoreUnsub = bindings.store.subscribe(() => {
          scheduleSidebarSync();
          if (FEAT.hideSidebarProjects) scheduleSidebarHideSync();
        });
      } else {
        sidebarStoreUnsub = null;
      }
    }
    const state = bindings.store.getState();
    const activeId = getActiveCascadeId();
    const hasFocus = typeof document.hasFocus === 'function' ? document.hasFocus() : true;
    syncFolderStatusBadges(bindings, state, activeId, hasFocus);
    syncRecentSection(bindings, state, activeId, hasFocus);
  }

  const onWindowSidebarEvent = () => scheduleSidebarSync();
  window.addEventListener('focus', onWindowSidebarEvent);
  window.addEventListener('blur', onWindowSidebarEvent);
  window.addEventListener('popstate', onWindowSidebarEvent);

  /* ==========================================================================
   * 8b. Live Zero-Reload UI Localization Engine (`i18n`, off / English by default)
   *     - Reuses upstream `ctx.dict` / `window.__ag_i18n_dict` and `window.__ag_orig_text_map`
   *     - Toggling `i18n` in Settings immediately translates or restores all native Antigravity
   *       text nodes & title/placeholder/aria-label attributes with zero page reload.
   * ========================================================================== */
  const UX_I18N_BASE_EXCLUDE =
    'code, pre, kbd, samp, textarea, input, style, script, noscript, [contenteditable="true"], [data-markdown-root], [data-testid="user-message-content"], .agy-user-bubble, [data-testid="skill-scope-item-pill"], bdi.context-scope-mention, .monaco-editor, .monaco-diff-editor, .xterm, [class*="onyx-key"], .prose, .markdown, [class*="chat-message"], [class*="group/file-title"], [data-testid="conversation-row-sidebar"] a[href^="/c/"], [data-testid="conversation-row-sidebar"] span.truncate, [data-testid="conversation-navigator-turn"], .msg-body, #raw, #swarm-title, #ag-live-metrics-pill, #ag-live-metrics-tooltip, [data-ag-i18n-ignore="1"], #ag-claude-model-popover, #ag-claude-model-subpop, #ag-claude-model-tripop, #ag-claude-quota-popover, #ag-claude-ux-settings-nav, #ag-claude-ux-settings-panel, #ag-claude-recent-section, #ag-recent-row-menu, #ag-project-action-menu, [data-testid="model-selector-trigger"], [data-testid="permissions-selector-trigger"]';
  const UX_I18N_ATTR_EXCLUDE =
    'code, pre, kbd, samp, style, script, noscript, [data-markdown-root], [data-testid="user-message-content"], .agy-user-bubble, [data-testid="skill-scope-item-pill"], bdi.context-scope-mention, .monaco-editor, .monaco-diff-editor, .xterm, #ag-live-metrics-pill, #ag-live-metrics-tooltip, [data-ag-i18n-ignore="1"], #ag-claude-model-popover, #ag-claude-model-subpop, #ag-claude-model-tripop, #ag-claude-quota-popover, #ag-claude-ux-settings-nav, #ag-claude-ux-settings-panel, #ag-claude-recent-section, #ag-recent-row-menu, #ag-project-action-menu, [data-testid="model-selector-trigger"], [data-testid="permissions-selector-trigger"]';
  let uxI18nObserver = null;
  let uxI18nFlushTimer = 0;
  let uxI18nDirtyRoots = new Set();
  let uxI18nDictRef = null;
  let uxI18nDictCi = null;

  function getUxI18nExcludeSelector() {
    const extra =
      typeof ctx !== 'undefined' && ctx && ctx.config && ctx.config.selectors && ctx.config.selectors.excludeI18n
        ? String(ctx.config.selectors.excludeI18n).trim()
        : '';
    return extra ? `${UX_I18N_BASE_EXCLUDE}, ${extra}` : UX_I18N_BASE_EXCLUDE;
  }

  function getUxI18nDict() {
    const d =
      (typeof ctx !== 'undefined' && ctx && ctx.dict && typeof ctx.dict === 'object' ? ctx.dict : null) ||
      (window.__ag_i18n_dict && typeof window.__ag_i18n_dict === 'object' ? window.__ag_i18n_dict : null);
    if (!d) return null;
    if (d !== uxI18nDictRef) {
      uxI18nDictRef = d;
      uxI18nDictCi = Object.create(null);
      for (const k of Object.keys(d)) {
        const v = d[k];
        if (typeof v === 'string') uxI18nDictCi[k.toLowerCase()] = v;
      }
    }
    return d;
  }

  function getOrigTextMap() {
    if (!window.__ag_orig_text_map) {
      window.__ag_orig_text_map = new WeakMap();
    }
    return window.__ag_orig_text_map;
  }

  const UX_RE_EPHEMERAL_SUMMARY =
    /^(Explored(?:\s+(?:\d+\s+)?(?:files?|artifacts?)(?:\s+and\s+(?:\d+\s+)?(?:files?|artifacts?))?)?|Ran\s+(?:\d+\s+)?commands?|Edited(?:\s+(?:\d+\s+)?(?:files?|artifacts?)(?:\s+and\s+(?:\d+\s+)?(?:files?|artifacts?))?)?)(?:,\s*(explored(?:\s+(?:\d+\s+)?(?:files?|artifacts?)(?:\s+and\s+(?:\d+\s+)?(?:files?|artifacts?))?)?|ran\s+(?:\d+\s+)?commands?|edited(?:\s+(?:\d+\s+)?(?:files?|artifacts?)(?:\s+and\s+(?:\d+\s+)?(?:files?|artifacts?))?)?))*$/i;
  const UX_EPHEMERAL_CLAUSE_MAP = {
    explored: '已探索',
    'explored file': '已探索文件',
    'explored files': '已探索文件',
    'explored artifact': '已探索 Artifact',
    'explored artifacts': '已探索 Artifact',
    'explored file and artifact': '已探索文件与 Artifact',
    'explored files and artifact': '已探索文件与 Artifact',
    'explored file and artifacts': '已探索文件与 Artifact',
    'explored files and artifacts': '已探索文件与 Artifact',
    'ran command': '已运行命令',
    'ran commands': '已运行命令',
    edited: '已编辑',
    'edited file': '已编辑文件',
    'edited files': '已编辑文件',
    'edited artifact': '已编辑 Artifact',
    'edited artifacts': '已编辑 Artifact',
    'edited file and artifact': '已编辑文件与 Artifact',
    'edited files and artifact': '已编辑文件与 Artifact',
    'edited file and artifacts': '已编辑文件与 Artifact',
    'edited files and artifacts': '已编辑文件与 Artifact'
  };
  const UX_RE_EPHEMERAL_COUNT = /^(explored|edited|ran)\s+(\d+)\s+(files?|artifacts?|commands?)$/i;
  const UX_RE_EPHEMERAL_ACTIVE = /^(Editing|Reading|Listing|Searching)\s+(.+)$/;
  const UX_EPHEMERAL_VERB_MAP = { Editing: '正在编辑', Reading: '正在读取', Listing: '正在列出', Searching: '正在搜索' };
  const UX_EPHEMERAL_NOUN_MAP = {
    file: '文件',
    files: '文件',
    artifact: 'Artifact',
    artifacts: 'Artifact',
    'file and artifact': '文件与 Artifact',
    'files and artifact': '文件与 Artifact',
    'file and artifacts': '文件与 Artifact',
    'files and artifacts': '文件与 Artifact'
  };
  const UX_RE_RUNNING_FOR = /^Running\s+for\s+([<0-9smhd]+(?:\s+\d+[smhd])*)$/i;
  const UX_RE_RUNNING_CMD = /^Running\s+(?!commands?\b|processes\b|for\b|\(Dev\b)(.+)$/;

  function translateUxEphemeralClause(clause) {
    const low = clause.trim().toLowerCase();
    if (UX_EPHEMERAL_CLAUSE_MAP[low]) return UX_EPHEMERAL_CLAUSE_MAP[low];
    const mCount = low.match(UX_RE_EPHEMERAL_COUNT);
    if (mCount) {
      const vMap = { explored: '已探索', edited: '已编辑', ran: '已运行' };
      const nMap = { file: '个文件', files: '个文件', artifact: '个 Artifact', artifacts: '个 Artifact', command: '条命令', commands: '条命令' };
      return `${vMap[mCount[1]]} ${mCount[2]} ${nMap[mCount[3]]}`;
    }
    return clause.trim();
  }

  function translateUxQuotaWindow(rawWin) {
    const w = String(rawWin || '').trim();
    const low = w.toLowerCase();
    if (low === 'weekly' || low === '7-day' || low === '7d') return '每周';
    if (low === 'daily' || low === '24-hour' || low === '24h') return '每日';
    if (low === 'hourly' || low === '1-hour' || low === '1h') return '每小时';
    if (low === 'monthly' || low === '30-day' || low === '30d') return '每月';
    const mHr = low.match(/^(\d+)\s*-?\s*hours?$/i) || low.match(/^(\d+)h$/i);
    if (mHr) return `${mHr[1]} 小时`;
    const mDay = low.match(/^(\d+)\s*-?\s*days?$/i) || low.match(/^(\d+)d$/i);
    if (mDay) return `${mDay[1]} 天`;
    return w;
  }

  function translateUxDurationPhrase(rawDur) {
    let s = String(rawDur || '').trim().replace(/\.$/, '');
    if (!s) return '';
    if (/^(?:<1m|less than a minute|under a minute)$/i.test(s)) return '不到 1 分钟';
    s = s
      .replace(/(\d+)\s*days?\b/gi, '$1 天')
      .replace(/(\d+)\s*hours?\b/gi, '$1 小时')
      .replace(/(\d+)\s*minutes?\b/gi, '$1 分钟')
      .replace(/(\d+)\s*mins?\b/gi, '$1 分钟')
      .replace(/(\d+)\s*seconds?\b/gi, '$1 秒')
      .replace(/\b(\d+)d\b/gi, '$1 天')
      .replace(/\b(\d+)h\b/gi, '$1 小时')
      .replace(/\b(\d+)m\b/gi, '$1 分钟')
      .replace(/\b(\d+)s\b/gi, '$1 秒')
      .replace(/\s*,\s*(?:and\s+)?/gi, ' ')
      .replace(/\s+and\s+/gi, ' ')
      .replace(/\s{2,}/g, ' ')
      .trim();
    return s;
  }

  function uxI18nLookup(trimmed, contextEl) {
    const dict = getUxI18nDict();
    if (!dict || !trimmed) return null;
    if (typeof dict[trimmed] === 'string') return dict[trimmed];
    if (uxI18nDictCi && typeof uxI18nDictCi[trimmed.toLowerCase()] === 'string') {
      return uxI18nDictCi[trimmed.toLowerCase()];
    }
    if (trimmed.endsWith('.')) {
      const base = trimmed.slice(0, -1);
      const hit =
        (typeof dict[base] === 'string' && dict[base]) ||
        (uxI18nDictCi && typeof uxI18nDictCi[base.toLowerCase()] === 'string' && uxI18nDictCi[base.toLowerCase()]);
      if (hit) return hit.endsWith('。') ? hit : `${hit}。`;
    }
    /* High-frequency dynamic Antigravity UI strings when runtime.js i18n is disabled */
    if (!/[A-Za-z]/.test(trimmed) || trimmed.length > 340) return null;
    let m;
    if (UX_RE_EPHEMERAL_SUMMARY.test(trimmed)) {
      return trimmed.split(/,\s*/).map((part) => translateUxEphemeralClause(part)).join('、');
    }
    const inHdr = Boolean(contextEl && contextEl.closest && contextEl.closest('header, [data-testid="breadcrumb-segment"]'));
    if (!inHdr && (m = trimmed.match(UX_RE_EPHEMERAL_ACTIVE))) {
      const noun = UX_EPHEMERAL_NOUN_MAP[m[2].toLowerCase()];
      const verbZh = UX_EPHEMERAL_VERB_MAP[m[1]];
      return noun ? (/^[A-Za-z0-9]/.test(noun) ? `${verbZh} ${noun}` : `${verbZh}${noun}`) : `${verbZh} ${m[2]}`;
    }
    if ((m = trimmed.match(UX_RE_RUNNING_FOR))) return `已运行 ${m[1]}`;
    if (!inHdr && (m = trimmed.match(UX_RE_RUNNING_CMD))) return `正在运行 ${m[1]}`;
    if ((m = trimmed.match(/^(\d+)\s+files?\s+changed$/i))) return `${m[1]} 个文件变更`;
    if ((m = trimmed.match(/^(\d+)\s+tools?$/i))) return `${m[1]} 个工具`;
    if ((m = trimmed.match(/^(\d+)\s+updates?$/i))) return `${m[1]} 条进展`;
    if ((m = trimmed.match(/^Worked\s+for\s+(.+)$/i))) return `已工作 ${m[1]}`;
    if ((m = trimmed.match(/^Working\s+for\s+(.+)$/i))) return `正在工作 ${m[1]}`;
    if ((m = trimmed.match(/^Thought\s+for\s+(.+)$/i))) return `已思考 ${m[1]}`;
    if ((m = trimmed.match(/^Thinking\s+for\s+(.+)$/i))) return `正在思考 ${m[1]}`;
    if ((m = trimmed.match(/^(\d+)\s+(seconds?|minutes?|hours?|days?)\s+ago$/i))) {
      const unitMap = { second: '秒', seconds: '秒', minute: '分钟', minutes: '分钟', hour: '小时', hours: '小时', day: '天', days: '天' };
      return `${m[1]} ${unitMap[m[2].toLowerCase()] || m[2]}前`;
    }
    if ((m = trimmed.match(/^(\d+(?:\.\d+)?)%\s+left$/i))) return `${m[1]}% 剩余`;
    if ((m = trimmed.match(/^Your Plan:\s*(.+)$/i))) return `当前方案：${m[1]}`;
    if ((m = trimmed.match(/^You can upgrade to a higher\s+(.+?)\s+plan to receive the highest rate limits\.?$/i))) {
      return `您可以升级到更高的 ${m[1]} 方案以获取最高速率配额。`;
    }
    const padWinZh = (raw) => {
      const w = translateUxQuotaWindow(raw);
      return /^[0-9A-Za-z]/.test(w) ? ` ${w}` : w;
    };
    if (
      (m = trimmed.match(
        /^You have used (some|all|most|\d+(?:\.\d+)?%?) of your (.+?) limit,\s*it will (?:(fully)\s+)?refresh in (.+?)\.?$/i
      ))
    ) {
      const amt = m[1].toLowerCase();
      const winZh = padWinZh(m[2]);
      const fullZh = m[3] ? '完全' : '';
      const durZh = translateUxDurationPhrase(m[4]);
      if (amt === 'all') return `您的${winZh}额度已用尽，将在 ${durZh}后${fullZh}恢复。`;
      if (amt === 'some') return `您已使用部分${winZh}额度，将在 ${durZh}后${fullZh}恢复。`;
      if (amt === 'most') return `您已使用大部分${winZh}额度，将在 ${durZh}后${fullZh}恢复。`;
      return `您已使用 ${m[1]} 的${winZh}额度，将在 ${durZh}后${fullZh}恢复。`;
    }
    if ((m = trimmed.match(/^You (?:haven't|have not) used any of your (.+?) limit(?:\s+yet)?\.?$/i))) {
      return `您尚未消耗${padWinZh(m[1])}额度。`;
    }
    if ((m = trimmed.match(/^You have reached your (.+?) limit(?:,\s*it will (?:(fully)\s+)?refresh in (.+?))?\.?$/i))) {
      const winZh = padWinZh(m[1]);
      if (m[3]) {
        return `您已达到${winZh}额度上限，将在 ${translateUxDurationPhrase(m[3])}后${m[2] ? '完全' : ''}恢复。`;
      }
      return `您已达到${winZh}额度上限。`;
    }
    if ((m = trimmed.match(/^Your (.+?) limit (?:will )?(?:(fully)\s+)?refresh(?:es)? in (.+?)\.?$/i))) {
      return `您的${padWinZh(m[1])}额度将在 ${translateUxDurationPhrase(m[3])}后${m[2] ? '完全' : ''}恢复。`;
    }
    if ((m = trimmed.match(/^Your (.+?) limit starts when you send your first message\.?$/i))) {
      return `您的${padWinZh(m[1])}额度将从发送第一条消息时起算。`;
    }
    if ((m = trimmed.match(/^Resets in\s+(.+)$/i))) {
      return `${translateUxDurationPhrase(m[1])}后重置`;
    }
    if ((m = trimmed.match(/^(?:Quota is )?shared across\s+(.+?)\.?$/i))) {
      return `由 ${m[1].replace(/,\s*and\s+/gi, '、').replace(/\s+and\s+/gi, ' 与 ')} 共享额度。`;
    }
    if ((m = trimmed.match(/^Show\s+(\d+)\s+breakdowns?$/i))) return `展开 ${m[1]} 项明细`;
    if ((m = trimmed.match(/^Hide\s+(?:\d+\s+)?breakdowns?$/i))) return '收起明细';
    if ((m = trimmed.match(/^Send feedback as\s+(.+)$/i))) return `以 ${m[1]} 身份发送反馈`;
    if (
      (m = trimmed.match(
        /^You have (a|\d+) conversations? in progress\.\s*Updating will (interrupt|cancel) (?:it|them),\s*and (.+?)\.?$/i
      ))
    ) {
      const cnt = m[1].toLowerCase() === 'a' ? '1' : m[1];
      if (m[2].toLowerCase() === 'interrupt') {
        return `当前有 ${cnt} 个对话正在运行。更新将暂时中断对话，并在更新完成后自动恢复。`;
      }
      return `当前有 ${cnt} 个对话正在运行。更新将取消这些对话，更新后需手动重新发起。`;
    }
    return null;
  }

  function uxRestoreAllTranslations(root) {
    const scope = root || document.body;
    if (!scope) return;
    const origMap = getOrigTextMap();
    try {
      const walker = document.createTreeWalker(scope, NodeFilter.SHOW_TEXT);
      let node;
      while ((node = walker.nextNode())) {
        const rec = origMap.get(node);
        if (rec) {
          if (node.nodeValue === rec.lastVal) {
            node.nodeValue = rec.origRaw;
          }
          origMap.delete(node);
        }
      }
      const attrNames = ['title', 'placeholder', 'aria-label'];
      const els = scope.querySelectorAll
        ? scope.querySelectorAll(
            '[data-ag-orig-title], [data-ag-orig-title-last], [data-ag-orig-placeholder], [data-ag-orig-placeholder-last], [data-ag-orig-aria-label], [data-ag-orig-aria-label-last]'
          )
        : [];
      for (const el of els) {
        for (const attr of attrNames) {
          const origAttr = `data-ag-orig-${attr}`;
          const lastAttr = `${origAttr}-last`;
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

  function uxTranslateSubtree(root) {
    if (!root || !FEAT.i18n || disposed) return;
    if (!getUxI18nDict()) return;
    const exclSel = getUxI18nExcludeSelector();
    const origMap = getOrigTextMap();
    const isExcluded = (el) => {
      if (!el || el.nodeType !== 1) return true;
      try {
        return Boolean(el.closest(exclSel));
      } catch {
        return Boolean(el.closest(UX_I18N_BASE_EXCLUDE));
      }
    };
    try {
      const translateText = (node) => {
        if (!node || node.nodeType !== 3) return;
        const p = node.parentElement;
        if (!p || isExcluded(p)) return;
        const cur = node.nodeValue;
        if (!cur) return;
        const rec = origMap.get(node);
        if (rec && rec.lastVal === cur) return;
        const origRaw = rec && rec.lastVal === cur ? rec.origRaw : cur;
        const trimmed = origRaw.trim();
        if (!trimmed) return;
        const hit = uxI18nLookup(trimmed, p);
        if (typeof hit === 'string' && hit !== trimmed) {
          const next = origRaw.replace(trimmed, () => hit);
          origMap.set(node, { origRaw, lastVal: next, ver: 'ux' });
          if (node.nodeValue !== next) node.nodeValue = next;
        }
      };

      if (root.nodeType === 3) {
        translateText(root);
        return;
      }
      if (root.nodeType === 1 && isExcluded(root)) return;
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
      let node;
      while ((node = walker.nextNode())) translateText(node);

      const attrTargets = [];
      if (root.nodeType === 1 && root.matches && root.matches('[title], [placeholder], [aria-label]')) {
        attrTargets.push(root);
      }
      if (root.querySelectorAll) {
        root.querySelectorAll('[title], [placeholder], [aria-label]').forEach((el) => attrTargets.push(el));
      }
      for (const el of attrTargets) {
        try {
          if (el.closest(UX_I18N_ATTR_EXCLUDE)) continue;
        } catch {}
        for (const attr of ['title', 'placeholder', 'aria-label']) {
          const cur = el.getAttribute(attr);
          if (!cur) continue;
          const origAttr = `data-ag-orig-${attr}`;
          const lastAttr = `${origAttr}-last`;
          const savedOrig = el.getAttribute(origAttr);
          const savedLast = el.getAttribute(lastAttr);
          if (savedOrig !== null && savedLast === cur) continue;
          const origVal = savedOrig !== null && savedLast === cur ? savedOrig : cur;
          const hit = uxI18nLookup(origVal.trim(), el);
          if (typeof hit === 'string' && hit !== origVal.trim()) {
            const nextVal = origVal.replace(origVal.trim(), () => hit);
            if (savedOrig !== origVal) el.setAttribute(origAttr, origVal);
            el.setAttribute(lastAttr, nextVal);
            if (cur !== nextVal) el.setAttribute(attr, nextVal);
          }
        }
      }
    } catch {}
  }

  function stopUxI18nObserver() {
    if (uxI18nObserver) {
      try {
        uxI18nObserver.disconnect();
      } catch {}
      uxI18nObserver = null;
    }
    if (uxI18nFlushTimer) {
      cancelLater(uxI18nFlushTimer);
      uxI18nFlushTimer = 0;
    }
    uxI18nDirtyRoots.clear();
  }

  function applyUiI18nState(enabled) {
    if (docRoot) {
      docRoot.setAttribute('data-ag-ux-lang', enabled ? 'zh' : 'en');
    }
    if (!enabled) {
      stopUxI18nObserver();
      if (window.__ag_i18n_observer) {
        try {
          window.__ag_i18n_observer.disconnect();
        } catch {}
        window.__ag_i18n_observer = null;
      }
      if (document.body) uxRestoreAllTranslations(document.body);
      return;
    }
    if (document.body) {
      uxTranslateSubtree(document.body);
      if (!uxI18nObserver && typeof MutationObserver !== 'undefined') {
        uxI18nObserver = new MutationObserver((mutations) => {
          if (disposed || !FEAT.i18n) return;
          const roots = new Set();
          for (const m of mutations) {
            if (m.type === 'characterData' && m.target) {
              roots.add(m.target);
            } else if (m.type === 'childList') {
              for (const n of m.addedNodes) {
                if (n.nodeType === 1 || n.nodeType === 3) roots.add(n);
              }
            } else if (m.type === 'attributes' && m.target && m.target.nodeType === 1) {
              roots.add(m.target);
            }
          }
          if (!roots.size) return;
          for (const r of roots) {
            if (!r || !r.isConnected) continue;
            let covered = false;
            let p = r.parentElement;
            while (p && p !== document.body) {
              if (roots.has(p)) {
                covered = true;
                break;
              }
              p = p.parentElement;
            }
            if (!covered) uxTranslateSubtree(r);
          }
          if (uxI18nObserver) uxI18nObserver.takeRecords();
        });
        uxI18nObserver.observe(document.body, {
          childList: true,
          subtree: true,
          characterData: true,
          attributes: true,
          attributeFilter: ['title', 'placeholder', 'aria-label']
        });
      }
    }
  }

  /* ---- Native Electron NSMenu Context Menu Localization (e.g., Pinned Conversations) ---- */
  function normalizeNativeMenuAccelerator(acc) {
    if (typeof acc !== 'string' || !acc) return undefined;
    return acc
      .replace(/\u2303/g, 'Control+')
      .replace(/\u2325/g, 'Alt+')
      .replace(/\u21e7/g, 'Shift+')
      .replace(/\u2318/g, 'CmdOrCtrl+')
      .replace(/\u23ce/g, 'Enter');
  }

  function translateNativeMenuLabel(rawLabel) {
    if (typeof rawLabel !== 'string' || !rawLabel) return rawLabel;
    const trimmed = rawLabel.trim();
    if (!trimmed) return rawLabel;
    const hit = uxI18nLookup(trimmed, null);
    if (typeof hit === 'string' && hit) return hit;
    const mGroup = trimmed.match(/^Move to Group:\s*(.+)$/i);
    if (mGroup) return `移至分组：${mGroup[1]}`;
    return rawLabel;
  }

  function resolveNativeContextMenuFromTarget(targetEl, nativeEv) {
    const startEl = targetEl && targetEl.nodeType === 1 ? targetEl : targetEl && targetEl.parentElement;
    if (!startEl) return null;
    let cur = startEl;
    let startFiber = null;
    for (let up = 0; up < 8 && cur && !startFiber; up++, cur = cur.parentElement) {
      const fk = Object.keys(cur).find((k) => k.startsWith('__reactFiber$'));
      if (fk && cur[fk]) startFiber = cur[fk];
    }
    if (!startFiber) return null;
    let f = startFiber;
    for (let depth = 0; depth < 16 && f; depth++, f = f.return) {
      const p = f.memoizedProps;
      if (!p || p.disabled) continue;
      if (typeof p.items !== 'function' && !Array.isArray(p.items)) continue;
      const childHasCtx = Boolean(
        f.child && f.child.memoizedProps && typeof f.child.memoizedProps.onContextMenu === 'function'
      );
      if (!childHasCtx) continue;
      let rawItems;
      try {
        rawItems = typeof p.items === 'function' ? p.items(nativeEv) : p.items;
      } catch {
        return null;
      }
      if (!Array.isArray(rawItems) || rawItems.length === 0) return null;
      const valid = rawItems.some(
        (it) =>
          it &&
          (it.type === 'separator' ||
            (typeof it.label === 'string' &&
              (typeof it.onClick === 'function' || typeof it.click === 'function' || Array.isArray(it.items))))
      );
      if (!valid) continue;
      return {
        items: rawItems,
        onOpenChange: typeof p.onOpenChange === 'function' ? p.onOpenChange : null
      };
    }
    return null;
  }

  function buildLocalizedNativeMenuPayload(items, cbMap, prefix = 'cmi') {
    const out = [];
    for (let idx = 0; idx < items.length; idx++) {
      const d = items[idx];
      if (!d) continue;
      const id = d.id || `${prefix}-${idx}`;
      const handler = typeof d.onClick === 'function' ? d.onClick : typeof d.click === 'function' ? d.click : null;
      if (handler) cbMap.set(id, handler);
      const disabled =
        d.type === 'label'
          ? true
          : d.disabled !== undefined
            ? Boolean(d.disabled)
            : d.enabled !== undefined
              ? !d.enabled
              : false;
      const entry = {
        id,
        label: typeof d.label === 'string' ? translateNativeMenuLabel(d.label) : d.label,
        type: d.type && d.type !== 'item' && d.type !== 'label' ? d.type : 'normal',
        checked: d.checked,
        disabled,
        accelerator: normalizeNativeMenuAccelerator(d.accelerator)
      };
      if (Array.isArray(d.items) && d.items.length > 0) {
        entry.submenu = buildLocalizedNativeMenuPayload(d.items, cbMap, `${id}-sub`);
      }
      out.push(entry);
    }
    return out;
  }

  const onNativeContextMenuCapture = (e) => {
    if (disposed || !FEAT.i18n || e.altKey) return;
    if (typeof window.electronNative?.showContextMenu !== 'function') return;
    const t = e.target;
    const el = t && t.nodeType === 1 ? t : t && t.parentElement;
    if (!el || !el.closest) return;
    if (
      el.closest(
        'input, textarea, [contenteditable="true"], .monaco-editor, .monaco-diff-editor, .xterm, #ag-recent-row-menu, #ag-project-action-menu, #ag-claude-model-popover, #ag-claude-model-subpop, #ag-claude-model-tripop'
      )
    ) {
      return;
    }
    if (el.closest('.prose, .markdown, [data-markdown-root], [data-testid="user-message-content"]')) {
      try {
        const sel = window.getSelection && window.getSelection();
        if (sel && String(sel).trim()) return;
      } catch {}
    }
    const resolved = resolveNativeContextMenuFromTarget(el, e);
    if (!resolved) return;
    const cbMap = new Map();
    const payload = buildLocalizedNativeMenuPayload(resolved.items, cbMap);
    if (!payload.length) return;
    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();
    try {
      if (resolved.onOpenChange) resolved.onOpenChange(true);
    } catch {}
    try {
      Promise.resolve(window.electronNative.showContextMenu(payload))
        .then((chosenId) => {
          if (chosenId && cbMap.has(chosenId)) {
            try {
              cbMap.get(chosenId)();
            } catch {}
          }
        })
        .catch(() => {})
        .finally(() => {
          try {
            if (resolved.onOpenChange) resolved.onOpenChange(false);
          } catch {}
        });
    } catch {
      try {
        if (resolved.onOpenChange) resolved.onOpenChange(false);
      } catch {}
    }
  };
  document.addEventListener('contextmenu', onNativeContextMenuCapture, true);

  /* ==========================================================================
   * 9. Native Settings -> `UI Enhancements` / `界面增强` Live Module Toggle Panel
   *    - Injects `settings-nav-item-ClaudeUX` right after `Appearance` (`外观`)
   *      inside `[data-testid="settings-sidebar"]`.
   *    - Toggles persist to `localStorage` and take effect in 0ms without reload.
   * ========================================================================== */
  const CJK_SCALE_OPTIONS = [
    ['94.5', '94.5%'],
    ['95', '95%'],
    ['100', '100%']
  ];

  const DEFAULT_SANS_FONT_STACK =
    "ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, 'PingFang SC', 'Hiragino Sans GB', 'Microsoft YaHei UI', 'Segoe UI', Roboto, sans-serif";
  const DEFAULT_MONO_FONT_STACK =
    "'SF Mono', 'Anthropic Mono', 'Anthropic Mono Web', Menlo, Consolas, 'PingFang SC', 'Microsoft YaHei UI', ui-monospace, monospace";

  const FONT_SETTING_ITEMS = [
    [
      'global',
      'UI 字体',
      'Interface UI Font',
      '留空使用默认，控制整个界面 UI（侧边栏、底栏按钮、设置与菜单）',
      'Blank uses default. Controls all UI chrome (sidebar, footer, settings, menus).',
      DEFAULT_SANS_FONT_STACK
    ],
    [
      'main',
      '对话界面字体',
      'Conversation Font',
      '留空继承 UI 字体（仅控制中间回复、气泡与输入正文）',
      'Blank inherits UI font (responses, bubbles, composer text).',
      DEFAULT_SANS_FONT_STACK
    ],
    [
      'overview',
      '右侧概览字体',
      'Overview Panel Font',
      '留空继承 UI 字体',
      'Blank inherits UI font.',
      DEFAULT_SANS_FONT_STACK
    ],
    [
      'mono',
      '代码 / 等宽字体 (editor.fontFamily)',
      'Code & Monospace Font (editor.fontFamily)',
      '留空使用默认，覆盖代码块、行内代码、Diff 视图与指标栏',
      'Blank uses default. Overrides code blocks, inline code, diffs, and metrics.',
      DEFAULT_MONO_FONT_STACK
    ]
  ];

  const SETTINGS_GROUPS = [
    {
      id: 'lang-typo',
      headingZh: '语言与排印',
      headingEn: 'Language & Typography',
      items: [
        [
          'i18n',
          'i18n',
          '中文界面汉化',
          'Chinese UI Localization',
          '将 Antigravity 原生界面与增强面板切换为简体中文（默认关闭，保持英文原版界面）',
          'Translate Antigravity UI and enhancement panels into Simplified Chinese (English by default)'
        ],
        [
          'claudeUxGlass',
          'glass',
          '通透毛玻璃质感',
          'Subtle Frosted Glass',
          '为侧边栏、底部输入框、右侧概览与浮层卡片开启轻度半透磨砂与微高光描边，层次更通透',
          'Enables subtle frosted glass translucency and hairline highlights on sidebar, composer, overview panel, and popovers'
        ],
        [
          'claudeUxGridBg',
          'gridBg',
          '对话区方格网格背景',
          'Conversation Grid Background',
          '在中间对话画布叠加细腻的 24px 工程方格底纹，不影响侧边栏与内置浏览器视图',
          'Overlays a subtle 24px square graph-paper grid on the main conversation canvas (sidebar and browser cutouts unaffected)'
        ]
      ]
    },
    {
      headingZh: '对话与过程流增强',
      headingEn: 'Conversation & Stream',
      items: [
        [
          'claudeUxModelMenu',
          'modelMenu',
          '分层模型选择器 (⌘/)',
          'Layered Model Picker (⌘/)',
          '精简主列表为 5 款主力模型，独立拆分思考强度与更多模型二级菜单',
          'Compact 5-model primary list with dedicated Thinking effort & More models flyouts'
        ],
        [
          'claudeUxContextRing',
          'contextRing',
          '上下文圆环与套餐限额浮层 (◎)',
          'Context Ring & Plan Usage Popover (◎)',
          '模型旁显示占用圆环，点击查看 5 小时 / 每周真实限额与一键压缩',
          'Shows context ring beside the model selector with live 5-hour / weekly quotas and one-click Compact'
        ],
        [
          'claudeUxStepUnfold',
          'stepUnfold',
          '自动展开回合步骤折叠',
          'Auto-Expand Turn Steps',
          '回合结束时保持中间进展与工具摘要平铺可见，不被外层折叠吞没',
          'Keeps mid-turn narration and tool summaries inline instead of collapsing them at turn end'
        ],
        [
          'claudeUxRunningTimer',
          'runningTimer',
          '运行中官方蓝旋转点与实时读秒',
          'Live Running Dots & Elapsed Timer',
          '在正在执行的工具步骤行挂载官方蓝双点旋转与 1s / 2s 读秒器',
          'Shows orbiting blue dots and live elapsed seconds on actively executing tool rows'
        ],
        [
          'claudeUxCollapseAnimation',
          'collapseAnim',
          '工具面板平滑收起动画',
          'Smooth Tool Panel Collapse',
          '收拢工具详情面板时补齐 190ms 丝滑过渡动画',
          'Adds a 190ms smooth collapse transition when closing tool detail panels'
        ],
        [
          'claudeUxCodeFold',
          'codeFold',
          '长代码块折叠与顶栏吸顶',
          'Long Code Folding & Sticky Header',
          '超过 40 行的代码块默认收起为预览并可一键展开，滚动时语言名与复制按钮保持吸顶',
          'Collapses code blocks over 40 lines into a preview with one-click expand, and pins the language label & copy button while scrolling'
        ]
      ]
    },
    {
      headingZh: '侧边栏与消息编辑增强',
      headingEn: 'Sidebar & Editing',
      items: [
        [
          'claudeUxInlineUndo',
          'inlineUndo',
          '原地撤回重编消息',
          'In-Bubble Undo & Edit',
          '点击撤回时在原气泡直接展开编辑框，支持变更文件还原预览与原附件保留',
          'Expands an inline editor inside the user bubble with file-revert preview and attachment preservation'
        ],
        [
          'claudeUxFolderStatus',
          'folderStatus',
          '折叠项目状态聚合角标',
          'Collapsed Project Status Badges',
          '项目文件夹折叠时在右侧安静汇总待审批、运行中与已完成未读状态',
          'Summarizes pending, running, and unread sessions beside collapsed project folders'
        ],
        [
          'claudeUxProjects',
          'projects',
          '项目工作区与本地上下文',
          'Projects Workspace & Local Context',
          '在「自动化任务」与「技能与自定义」之间加入 Claude 风格项目入口，纯本地管理指令（AGENTS.md）、参考文件与定时任务',
          'Adds a Claude-style Projects nav entry between Automations and Skills to manage local AGENTS.md, context files & scheduled tasks'
        ],
        [
          'claudeUxHideSidebarProjects',
          'hideSidebarProjects',
          '侧栏统一「最近对话」',
          'Unified Sidebar Recents',
          '隐藏原生「项目」与「对话」分组，保留置顶对话并在下方用全量混排的「最近对话」统一展示全部项目与普通对话（关闭即恢复原生分组）',
          'Replaces native Projects & standalone Conversations with a single Claude-style Recents list mixing all project and standalone chats'
        ],
        [
          'claudeUxCustomizations',
          'customizations',
          '技能与自定义页优化及导入',
          'Customizations Layout & Skill Importer',
          '为「技能与自定义」页增加分类标签切换、防卡片硬切底线、技能卡片化排版以及「+ 添加技能 / 打开技能目录」快捷入口',
          'Adds category tabs, sticky header divider, framed skill cards, and local + Add Skill / Open Folder actions to Customizations'
        ],
        [
          'claudeUxOverviewPanel',
          'overviewPanel',
          '右侧「概览」增强仪表盘',
          'Enhanced Right Overview Panel',
          '在右侧「概览」面板整合紧凑导航、工作环境、实时上下文与缓存拆解、谷歌蓝双窗口配额、子智能体状态及 MCP / 技能清单',
          'Enhances the right Overview panel with compact shortcuts, workspace environment, live Context & cache breakdown, Google Blue dual-window quotas, subagents, and MCP/skills inventory'
        ]
      ]
    }
  ];

  let settingsSidebarRef = null;
  let settingsRightRef = null;
  let settingsNavWrap = null;
  let settingsNavBtn = null;
  let settingsPanelEl = null;
  let settingsToastTimer = 0;
  let settingsStatsOpen = false;
  let settingsStatsProjOpen = false;
  let settingsStatsUnlinkedOpen = false;
  let settingsStatsBtnWrap = null;

  function renderSettingsPanelContent(panel) {
    if (!panel) return;
    panel.setAttribute('aria-label', L('界面增强设置', 'UI Enhancements Settings'));
    panel.innerHTML = `
      <div class="ag-cux-settings-wrap">
        <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:12px">
          <div>
            <h2 class="text-2xl m-0" style="color:var(--foreground)">${L('界面增强', 'UI Enhancements')}</h2>
            <div class="ag-cux-settings-desc" style="margin-top:4px">${L(
              '管理 Anti-Claude 语言、视觉、过程流与侧边栏效率模块，点击开关即时生效并跨重启自动记忆。',
              'Configure Anti-Claude language, layout, execution stream, and sidebar modules. Changes apply immediately and persist across restarts.'
            )}</div>
          </div>
          <span class="ag-cux-toast" data-ag-cux-toast data-visible="false">${L('✓ 已保存并即时生效', '✓ Saved and applied')}</span>
        </div>
        ${SETTINGS_GROUPS.map(
          (grp) => `
          <div style="display:flex;flex-direction:column;gap:8px">
            <h3 class="m-0">${escapeHtml(L(grp.headingZh, grp.headingEn))}</h3>
            <div class="ag-cux-settings-group">
              ${grp.items
                .map(
                  ([modKey, featKey, titleZh, titleEn, descZh, descEn]) => `
                <div class="ag-cux-settings-row">
                  <div style="min-width:0">
                    <div class="ag-cux-settings-title">${escapeHtml(L(titleZh, titleEn))}</div>
                    <div class="ag-cux-settings-desc">${escapeHtml(L(descZh, descEn))}</div>
                  </div>
                  <button type="button" class="ag-claude-switch" role="switch" data-ag-cux-switch="${modKey}" data-ag-cux-feat="${featKey}" aria-label="${escapeHtml(L(titleZh, titleEn))}" aria-checked="${Boolean(FEAT[featKey])}"><span></span></button>
                </div>`
                )
                .join('')}
              ${
                grp.id === 'lang-typo'
                  ? `
                <div class="ag-cux-settings-row">
                  <div style="min-width:0">
                    <div class="ag-cux-settings-title">${escapeHtml(L('中文字体字高校准', 'CJK Optical Font Scale'))}</div>
                    <div class="ag-cux-settings-desc">${escapeHtml(
                      L(
                        '调整苹方汉字与西文的视觉字高比例：94.5%（Apple 官网排印）、95%（均衡默认）、100%（系统原生字高）',
                        'Calibrate CJK glyph height relative to Latin text: 94.5% (Apple typography), 95% (balanced default), or 100% (native)'
                      )
                    )}</div>
                  </div>
                  <div class="ag-cux-seg-group" role="radiogroup" aria-label="${escapeHtml(
                    L('中文字体字高校准', 'CJK Optical Font Scale')
                  )}">
                    ${CJK_SCALE_OPTIONS.map(
                      ([val, label]) =>
                        `<button type="button" class="ag-cux-seg-btn" role="radio" data-ag-cux-cjk-scale="${val}" aria-checked="${
                          currentCjkScale === val
                        }">${label}</button>`
                    ).join('')}
                  </div>
                </div>
                <div class="ag-cux-settings-row-stack">
                  <div class="ag-cux-font-header">
                    <div style="min-width:0">
                      <div class="ag-cux-settings-title">${escapeHtml(L('自定义字体覆盖', 'Custom Font Families'))}</div>
                      <div class="ag-cux-settings-desc">${escapeHtml(
                        L(
                          '留空即使用默认字体，填写 CSS font-family 字体栈（支持直接粘贴 VS Code 的 "editor.fontFamily": "..."），回车或失焦后即时生效。',
                          'Leave blank to use defaults. Enter a CSS font-family stack (or paste VS Code "editor.fontFamily": "..."), then press Enter or blur to apply.'
                        )
                      )}</div>
                    </div>
                    <button type="button" class="ag-cux-font-btn" data-ag-cux-font-reset-all ${
                      FONT_SLOT_KEYS.some((k) => Boolean(currentFonts[k])) ? '' : 'hidden'
                    }>${escapeHtml(L('全部恢复默认', 'Reset All'))}</button>
                  </div>
                  <div class="ag-cux-font-list">
                    ${FONT_SETTING_ITEMS.map(
                      ([slot, labelZh, labelEn, hintZh, hintEn, ph]) => `
                      <div class="ag-cux-font-item">
                        <div class="ag-cux-font-label">
                          <span>${escapeHtml(L(labelZh, labelEn))}</span>
                          <span class="ag-cux-font-hint">${escapeHtml(L(hintZh, hintEn))}</span>
                        </div>
                        <div class="ag-cux-font-input-row">
                          <input
                            type="text"
                            class="ag-cux-font-input"
                            data-ag-cux-font-input="${slot}"
                            value="${escapeHtml(currentFonts[slot] || '')}"
                            placeholder="${escapeHtml(
                              slot === 'main' || slot === 'overview' ? currentFonts.global || ph : ph
                            )}"
                            spellcheck="false"
                            autocomplete="off"
                          />
                          <button
                            type="button"
                            class="ag-cux-font-btn"
                            data-ag-cux-font-clear="${slot}"
                            ${currentFonts[slot] ? '' : 'hidden'}
                          >${escapeHtml(L('清空', 'Clear'))}</button>
                        </div>
                      </div>`
                    ).join('')}
                  </div>
                </div>
                <div class="ag-cux-settings-row">
                  <div style="min-width:0">
                    <div class="ag-cux-settings-title">${escapeHtml(L('对话区水平偏移 (px)', 'Conversation Horizontal Offset (px)'))}</div>
                    <div class="ag-cux-settings-desc">${escapeHtml(
                      L(
                        '宽屏下微调居中位置：填负数向左移（如 -160），填 0 或留空恢复原版居中，回车或失焦即时生效。',
                        'Shift centered chat and composer horizontally on wide screens: negative moves left (e.g. -160), 0 or blank restores default.'
                      )
                    )}</div>
                  </div>
                  <div class="ag-cux-font-input-row" style="flex-shrink:0">
                    <input
                      type="number"
                      step="10"
                      min="-800"
                      max="800"
                      class="ag-cux-font-input"
                      style="width:96px !important;flex:0 0 96px !important;text-align:right"
                      data-ag-cux-chat-offset-x
                      value="${currentChatOffsetX !== 0 ? String(currentChatOffsetX) : ''}"
                      placeholder="0"
                    />
                    <button
                      type="button"
                      class="ag-cux-font-btn"
                      data-ag-cux-chat-offset-reset
                      ${currentChatOffsetX !== 0 ? '' : 'hidden'}
                    >${escapeHtml(L('归零', 'Reset'))}</button>
                  </div>
                </div>`
                  : ''
              }
            </div>
          </div>`
        ).join('')}
      </div>
    `;
    panel.querySelectorAll('[data-ag-cux-switch]').forEach((sw) => {
      sw.addEventListener('click', () => {
        const modKey = sw.getAttribute('data-ag-cux-switch');
        const featKey = sw.getAttribute('data-ag-cux-feat');
        setModuleOverride(modKey, featKey, !FEAT[featKey]);
      });
    });
    panel.querySelectorAll('[data-ag-cux-cjk-scale]').forEach((btn) => {
      btn.addEventListener('click', () => {
        setCjkScaleOverride(btn.getAttribute('data-ag-cux-cjk-scale'));
      });
    });
    const offsetInput = panel.querySelector('[data-ag-cux-chat-offset-x]');
    if (offsetInput) {
      const commitOffset = () => setChatOffsetXOverride(offsetInput.value);
      offsetInput.addEventListener('change', commitOffset);
      offsetInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          commitOffset();
          offsetInput.blur();
        }
      });
    }
    const offsetResetBtn = panel.querySelector('[data-ag-cux-chat-offset-reset]');
    if (offsetResetBtn) {
      offsetResetBtn.addEventListener('click', () => setChatOffsetXOverride(0));
    }
    panel.querySelectorAll('[data-ag-cux-font-input]').forEach((input) => {
      const slot = input.getAttribute('data-ag-cux-font-input');
      const commit = () => setFontOverride(slot, input.value);
      input.addEventListener('change', commit);
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          commit();
          input.blur();
        }
      });
    });
    panel.querySelectorAll('[data-ag-cux-font-clear]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const slot = btn.getAttribute('data-ag-cux-font-clear');
        setFontOverride(slot, '');
      });
    });
    const resetAllBtn = panel.querySelector('[data-ag-cux-font-reset-all]');
    if (resetAllBtn) {
      resetAllBtn.addEventListener('click', () => resetAllFonts());
    }
  }

  function applyImmediateFeatureEffects(featKey, on) {
    if (featKey === 'i18n') {
      applyUiI18nState(on);
      if (settingsNavBtn) {
        settingsNavBtn.innerHTML = `<span class="truncate">${L('界面增强', 'UI Enhancements')}</span>`;
      }
      if (settingsPanelEl && !settingsPanelEl.hidden) {
        renderSettingsPanelContent(settingsPanelEl);
      }
      syncSettingsStatsGroup();
      if (modelPopoverOpen) renderModelPopovers();
      if (quotaPopoverOpen) renderQuotaPopoverBody();
      updateComposerRingVisuals();
      if (typeof window.__ag_render_metrics === 'function' && window.__ag_last_metrics) {
        try {
          window.__ag_render_metrics(window.__ag_last_metrics);
        } catch {}
      }
      recentLastSig = '';
      if (activeInlineEdit) renderInlineEditMeta(activeInlineEdit);
      refreshProjectsLanguageUi();
      syncCustomizationsEnhancement();
      renderOverviewPanel(true);
    } else if (featKey === 'projects') {
      if (!on) teardownProjectsWorkspace();
      else syncProjectsWorkspace();
    } else if (featKey === 'hideSidebarProjects') {
      syncSidebarHideNativeProjects();
    } else if (featKey === 'customizations') {
      if (!on) teardownCustomizationsEnhancement();
      else syncCustomizationsEnhancement();
    } else if (featKey === 'modelMenu' && !on) {
      closeClaudeModelPopover();
    } else if (featKey === 'contextRing') {
      if (!on) {
        const ring = document.getElementById('ag-claude-ctx-ring');
        if (ring) ring.remove();
        closeQuotaPopover();
        const tt = document.getElementById('ag-live-metrics-tooltip');
        if (tt) tt.removeAttribute('data-ag-pinned');
      }
      if (typeof window.__ag_render_metrics === 'function' && window.__ag_last_metrics) {
        try {
          window.__ag_render_metrics(window.__ag_last_metrics);
        } catch {}
      }
    } else if (featKey === 'stepUnfold' && !on) {
      document.querySelectorAll('[data-ag-inline-stream]').forEach((el) => el.removeAttribute('data-ag-inline-stream'));
    } else if (featKey === 'runningTimer' && !on) {
      document.querySelectorAll('.ag-orbit-dots, .ag-elapsed-timer').forEach((n) => n.remove());
    } else if (featKey === 'inlineUndo' && !on) {
      closeInlineEdit(false);
    } else if (featKey === 'codeFold' && !on) {
      teardownCodeBlocks();
    } else if (featKey === 'overviewPanel') {
      if (!on) teardownOverviewPanel();
      else syncOverviewPanel(true);
    } else if (featKey === 'glass') {
      if (docRoot) {
        if (on) docRoot.setAttribute('data-ag-glass', 'on');
        else docRoot.removeAttribute('data-ag-glass');
      }
    } else if (featKey === 'gridBg') {
      if (docRoot) {
        if (on) docRoot.setAttribute('data-ag-grid-bg', 'on');
        else docRoot.removeAttribute('data-ag-grid-bg');
      }
    }
    syncSidebarEnhancements();
    scheduleSync();
  }

  function flashSettingsSavedToast() {
    if (!settingsPanelEl) return;
    const toast = settingsPanelEl.querySelector('[data-ag-cux-toast]');
    if (!toast) return;
    toast.setAttribute('data-visible', 'true');
    cancelLater(settingsToastTimer);
    settingsToastTimer = later(() => {
      toast.setAttribute('data-visible', 'false');
    }, 1400);
  }

  let prefsSyncRetryTimer = 0;
  function persistUiPrefsToDaemon(explicitTs = 0) {
    const updatedAt = explicitTs > 0 ? explicitTs : Date.now();
    localModOverrides._ts = updatedAt;
    try {
      if (typeof localStorage === 'object' && localStorage) {
        localStorage.setItem(MODULE_STORAGE_KEY, JSON.stringify(localModOverrides));
      }
    } catch {}
    if (typeof window.__agProjectCall !== 'function') return;
    const modulesPayload = {};
    for (const grp of SETTINGS_GROUPS) {
      for (const [modKey, featKey] of grp.items) {
        modulesPayload[modKey] = Boolean(FEAT[featKey]);
      }
    }
    const reqPayload = {
      updatedAt,
      modules: modulesPayload,
      cjkFontScale: currentCjkScale,
      chatOffsetX: currentChatOffsetX,
      fonts: Object.assign({}, currentFonts),
      uiState: {
        recentCollapsed: Boolean(recentCollapsed),
        unifiedRecentCollapsed: Boolean(unifiedRecentCollapsed)
      }
    };
    window
      .__agProjectCall('saveUiPrefs', reqPayload, 5000)
      .then((res) => {
        if (disposed) return;
        if (!res || !res.ok) {
          cancelLater(prefsSyncRetryTimer);
          prefsSyncRetryTimer = later(() => {
            if (!disposed && typeof window.__agProjectCall === 'function') {
              window.__agProjectCall('saveUiPrefs', reqPayload, 5000).catch(() => {});
            }
          }, 450);
        }
      })
      .catch(() => {});
  }

  function setCjkScaleOverride(rawScale) {
    const next = normalizeCjkScale(rawScale);
    if (!next) return;
    currentCjkScale = next;
    localModOverrides.cjkFontScale = next;
    persistUiPrefsToDaemon();
    if (docRoot) {
      docRoot.setAttribute('data-ag-cjk-scale', next);
    }
    syncSettingsSwitchesUi();
    flashSettingsSavedToast();
  }

  function setChatOffsetXOverride(rawVal) {
    const next = normalizeChatOffsetX(rawVal);
    if (currentChatOffsetX === next) {
      syncSettingsSwitchesUi();
      return;
    }
    currentChatOffsetX = next;
    localModOverrides.chatOffsetX = next;
    persistUiPrefsToDaemon();
    applyCustomFontOverrides();
    syncSettingsSwitchesUi();
    flashSettingsSavedToast();
  }

  function setFontOverride(slot, rawValue) {
    if (!FONT_SLOT_KEYS.includes(slot)) return;
    const next = sanitizeFontFamilyInput(rawValue);
    if (currentFonts[slot] === next) {
      syncSettingsSwitchesUi();
      return;
    }
    currentFonts[slot] = next;
    localModOverrides.fonts = Object.assign({}, currentFonts);
    persistUiPrefsToDaemon();
    applyCustomFontOverrides();
    syncSettingsSwitchesUi();
    flashSettingsSavedToast();
  }

  function resetAllFonts() {
    let changed = false;
    for (const key of FONT_SLOT_KEYS) {
      if (currentFonts[key]) {
        currentFonts[key] = '';
        changed = true;
      }
    }
    if (!changed) return;
    localModOverrides.fonts = Object.assign({}, currentFonts);
    persistUiPrefsToDaemon();
    applyCustomFontOverrides();
    syncSettingsSwitchesUi();
    flashSettingsSavedToast();
  }

  function setModuleOverride(modKey, featKey, nextBool) {
    localModOverrides[modKey] = Boolean(nextBool);
    FEAT[featKey] = Boolean(nextBool);
    persistUiPrefsToDaemon();
    applyImmediateFeatureEffects(featKey, FEAT[featKey]);
    syncSettingsSwitchesUi();
    flashSettingsSavedToast();
  }

  function syncSettingsSwitchesUi() {
    if (!settingsPanelEl) return;
    for (const grp of SETTINGS_GROUPS) {
      for (const [modKey, featKey] of grp.items) {
        const sw = settingsPanelEl.querySelector(`[data-ag-cux-switch="${modKey}"]`);
        if (sw) sw.setAttribute('aria-checked', String(Boolean(FEAT[featKey])));
      }
    }
    settingsPanelEl.querySelectorAll('[data-ag-cux-cjk-scale]').forEach((btn) => {
      btn.setAttribute('aria-checked', String(btn.getAttribute('data-ag-cux-cjk-scale') === currentCjkScale));
    });
    const offsetInput = settingsPanelEl.querySelector('[data-ag-cux-chat-offset-x]');
    if (offsetInput) {
      const nextStr = currentChatOffsetX !== 0 ? String(currentChatOffsetX) : '';
      if (offsetInput.value !== nextStr) offsetInput.value = nextStr;
    }
    const offsetResetBtn = settingsPanelEl.querySelector('[data-ag-cux-chat-offset-reset]');
    if (offsetResetBtn) offsetResetBtn.hidden = currentChatOffsetX === 0;
    let anyFont = false;
    const inheritedSans = currentFonts.global || DEFAULT_SANS_FONT_STACK;
    for (const slot of FONT_SLOT_KEYS) {
      const val = currentFonts[slot] || '';
      if (val) anyFont = true;
      const inp = settingsPanelEl.querySelector(`[data-ag-cux-font-input="${slot}"]`);
      if (inp) {
        if (inp.value !== val) inp.value = val;
        if (slot === 'main' || slot === 'overview') {
          inp.placeholder = inheritedSans;
        }
      }
      const clr = settingsPanelEl.querySelector(`[data-ag-cux-font-clear="${slot}"]`);
      if (clr) clr.hidden = !val;
    }
    const resetAllBtn = settingsPanelEl.querySelector('[data-ag-cux-font-reset-all]');
    if (resetAllBtn) resetAllBtn.hidden = !anyFont;
  }

  function closeClaudeUxSettingsPane() {
    if (settingsRightRef) settingsRightRef.removeAttribute('data-ag-claude-settings-open');
    if (settingsSidebarRef) settingsSidebarRef.removeAttribute('data-ag-claude-nav-open');
    if (settingsNavBtn) {
      settingsNavBtn.classList.remove('bg-sidebar-secondary');
      settingsNavBtn.removeAttribute('aria-current');
    }
    if (settingsPanelEl) settingsPanelEl.hidden = true;
  }

  function onNativeSettingsNavClick(e) {
    if (
      e.target &&
      e.target.closest &&
      !e.target.closest('#ag-claude-ux-settings-nav, #ag-settings-stats-wrap, [data-ag-stats-subhdr="1"]') &&
      e.target.closest('button')
    ) {
      closeClaudeUxSettingsPane();
      requestAnimationFrame(() => syncSettingsStatsGroup());
    }
  }

  function openClaudeUxSettingsPane() {
    if (!settingsSidebarRef || !settingsRightRef || !settingsNavBtn) return;
    settingsSidebarRef.setAttribute('data-ag-claude-nav-open', 'true');
    settingsRightRef.setAttribute('data-ag-claude-settings-open', 'true');
    settingsNavBtn.classList.add('bg-sidebar-secondary');
    settingsNavBtn.setAttribute('aria-current', 'page');
    syncSettingsStatsGroup(settingsSidebarRef);

    if (!settingsPanelEl || settingsPanelEl.parentElement !== settingsRightRef) {
      if (settingsPanelEl) settingsPanelEl.remove();
      const panel = document.createElement('div');
      panel.id = 'ag-claude-ux-settings-panel';
      panel.setAttribute('data-ag-i18n-ignore', '1');
      panel.setAttribute('role', 'region');
      settingsRightRef.appendChild(panel);
      settingsPanelEl = panel;
    }
    renderSettingsPanelContent(settingsPanelEl);
    settingsPanelEl.hidden = false;
    syncSettingsSwitchesUi();
    settingsRightRef.scrollTop = 0;
  }

  const SVG_SETTINGS_CHEVRON =
    '<svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4.5 6.2L8 9.8l3.5-3.6"/></svg>';

  function cleanupSettingsStatsGroup(sb) {
    if (settingsStatsBtnWrap && settingsStatsBtnWrap.parentNode) settingsStatsBtnWrap.remove();
    settingsStatsBtnWrap = null;
    const root = sb || null;
    if (!root) return;
    root.removeAttribute('data-ag-stats-ready');
    root.querySelectorAll('.ag-settings-subhdr-chev').forEach((el) => el.remove());
    root
      .querySelectorAll(
        '[data-ag-stats-hidden], [data-ag-stats-subhdr], [data-ag-stats-list], [data-ag-stats-open], [data-ag-stats-active], [data-ag-stats-passthrough]'
      )
      .forEach((el) => {
        if (el.__agStatsHandlers) {
          el.removeEventListener('click', el.__agStatsHandlers.onClick);
          el.removeEventListener('keydown', el.__agStatsHandlers.onKeyDown);
          delete el.__agStatsHandlers;
        }
        delete el.__agStatsBound;
        el.removeAttribute('data-ag-stats-hidden');
        el.removeAttribute('data-ag-stats-subhdr');
        el.removeAttribute('data-ag-stats-list');
        el.removeAttribute('data-ag-stats-open');
        el.removeAttribute('data-ag-stats-active');
        el.removeAttribute('data-ag-stats-passthrough');
        el.removeAttribute('role');
        el.removeAttribute('tabindex');
        el.removeAttribute('aria-expanded');
      });
  }

  function syncSettingsStatsGroup(sb) {
    const sidebar = sb || settingsSidebarRef || document.querySelector('[data-testid="settings-sidebar"]');
    if (!sidebar || disposed) return;

    let projHdr = null;
    let projList = null;
    let unlinkedHdr = null;
    let unlinkedList = null;

    for (const h2 of sidebar.querySelectorAll('h2')) {
      const txt = (h2.textContent || '').trim();
      const wrap = h2.parentElement;
      if (!wrap || wrap === sidebar) continue;
      if (!projHdr && /^(Projects|项目)$/i.test(txt)) {
        wrap.removeAttribute('data-ag-stats-passthrough');
        projHdr = wrap;
        const next = wrap.nextElementSibling;
        if (next && !next.querySelector('h2')) {
          next.removeAttribute('data-ag-stats-passthrough');
          projList = next;
        }
      } else if (!unlinkedHdr && /^(Not in Project|Outside of Project|未关联项目)$/i.test(txt)) {
        wrap.removeAttribute('data-ag-stats-passthrough');
        unlinkedHdr = wrap;
        const next = wrap.nextElementSibling;
        if (next && !next.querySelector('h2')) {
          next.removeAttribute('data-ag-stats-passthrough');
          unlinkedList = next;
        }
      } else {
        wrap.setAttribute('data-ag-stats-passthrough', '1');
        const next = wrap.nextElementSibling;
        if (next && !next.querySelector('h2')) next.setAttribute('data-ag-stats-passthrough', '1');
      }
    }

    const firstAnchor = projHdr || unlinkedHdr;
    if (!firstAnchor || !firstAnchor.parentElement) {
      cleanupSettingsStatsGroup(sidebar);
      return;
    }
    sidebar.setAttribute('data-ag-stats-ready', '1');

    /* Mount top-level "统计 / Stats" collapsible row styled identically to native Settings nav items */
    const nativeNavBtn =
      sidebar.querySelector('button[data-testid="settings-nav-item-Browser"]') ||
      sidebar.querySelector('button[data-testid="settings-nav-item-Appearance"]') ||
      sidebar.querySelector('button[data-testid^="settings-nav-item-"]:not([data-testid="settings-nav-item-Stats"])');
    const navWrapCls = (nativeNavBtn && nativeNavBtn.parentElement && nativeNavBtn.parentElement.className) || 'relative group/nav-item mx-2';
    const navBtnCls = nativeNavBtn
      ? (nativeNavBtn.className || '').replace(/\bbg-sidebar-secondary\b/g, 'hover:bg-sidebar-muted')
      : '';

    if (!settingsStatsBtnWrap || !settingsStatsBtnWrap.isConnected || settingsStatsBtnWrap.parentElement !== firstAnchor.parentElement) {
      if (settingsStatsBtnWrap && settingsStatsBtnWrap.parentNode) settingsStatsBtnWrap.remove();
      const wrap = document.createElement('div');
      wrap.id = 'ag-settings-stats-wrap';
      wrap.setAttribute('data-ag-i18n-ignore', '1');
      wrap.className = navWrapCls;
      wrap.innerHTML = `<button type="button" id="ag-settings-stats-toggle" data-testid="settings-nav-item-Stats" class="${escapeHtml(navBtnCls)} ag-settings-stats-toggle" aria-expanded="${
        settingsStatsOpen ? 'true' : 'false'
      }"><span class="transition-colors select-none truncate flex-1 ag-settings-stats-lbl">${L('统计', 'Stats')}</span><span class="ag-settings-stats-chev" aria-hidden="true">${SVG_SETTINGS_CHEVRON}</span></button>`;
      wrap.querySelector('#ag-settings-stats-toggle').addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        settingsStatsOpen = !settingsStatsOpen;
        syncSettingsStatsGroup(sidebar);
      });
      firstAnchor.insertAdjacentElement('beforebegin', wrap);
      settingsStatsBtnWrap = wrap;
    }

    const claudePaneOpen = sidebar.hasAttribute('data-ag-claude-nav-open');
    const projHasActive = !claudePaneOpen && Boolean(projList && projList.querySelector('.bg-sidebar-secondary'));
    const unlinkedHasActive = !claudePaneOpen && Boolean(unlinkedList && unlinkedList.querySelector('.bg-sidebar-secondary'));

    const statsToggle = settingsStatsBtnWrap.querySelector('#ag-settings-stats-toggle');
    if (statsToggle) {
      statsToggle.setAttribute('aria-expanded', settingsStatsOpen ? 'true' : 'false');
      statsToggle.setAttribute('data-open', settingsStatsOpen ? 'true' : 'false');
      statsToggle.classList.toggle('bg-sidebar-secondary', !settingsStatsOpen && (projHasActive || unlinkedHasActive));
      const lbl = statsToggle.querySelector('.ag-settings-stats-lbl');
      if (lbl) lbl.textContent = L('统计', 'Stats');
    }

    const bindSubHdr = (hdrEl, isOpen, hasActiveChild, onToggle) => {
      if (!hdrEl) return;
      hdrEl.setAttribute('data-ag-stats-subhdr', '1');
      hdrEl.setAttribute('data-ag-stats-open', isOpen ? 'true' : 'false');
      hdrEl.setAttribute('data-ag-stats-active', !isOpen && hasActiveChild ? 'true' : 'false');
      hdrEl.setAttribute('role', 'button');
      hdrEl.setAttribute('tabindex', '0');
      hdrEl.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
      if (!hdrEl.querySelector('.ag-settings-subhdr-chev')) {
        const chev = document.createElement('span');
        chev.className = 'ag-settings-subhdr-chev';
        chev.setAttribute('data-ag-i18n-ignore', '1');
        chev.setAttribute('aria-hidden', 'true');
        chev.innerHTML = SVG_SETTINGS_CHEVRON;
        hdrEl.appendChild(chev);
      }
      if (settingsStatsOpen) hdrEl.removeAttribute('data-ag-stats-hidden');
      else hdrEl.setAttribute('data-ag-stats-hidden', '1');
      if (!hdrEl.__agStatsBound) {
        hdrEl.__agStatsBound = true;
        const onClick = (e) => {
          if (e.target && e.target !== hdrEl && e.target.closest && e.target.closest('button, a, input, select')) {
            return;
          }
          e.preventDefault();
          e.stopPropagation();
          onToggle();
        };
        const onKeyDown = (e) => {
          if (e.target && e.target !== hdrEl && e.target.closest && e.target.closest('button, a, input, select')) {
            return;
          }
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            e.stopPropagation();
            onToggle();
          }
        };
        hdrEl.__agStatsHandlers = { onClick, onKeyDown };
        hdrEl.addEventListener('click', onClick);
        hdrEl.addEventListener('keydown', onKeyDown);
      }
    };

    bindSubHdr(projHdr, settingsStatsProjOpen, projHasActive, () => {
      settingsStatsProjOpen = !settingsStatsProjOpen;
      syncSettingsStatsGroup(sidebar);
    });
    if (projList) {
      projList.setAttribute('data-ag-stats-list', '1');
      if (settingsStatsOpen && settingsStatsProjOpen) projList.removeAttribute('data-ag-stats-hidden');
      else projList.setAttribute('data-ag-stats-hidden', '1');
    }

    bindSubHdr(unlinkedHdr, settingsStatsUnlinkedOpen, unlinkedHasActive, () => {
      settingsStatsUnlinkedOpen = !settingsStatsUnlinkedOpen;
      syncSettingsStatsGroup(sidebar);
    });
    if (unlinkedList) {
      unlinkedList.setAttribute('data-ag-stats-list', '1');
      if (settingsStatsOpen && settingsStatsUnlinkedOpen) unlinkedList.removeAttribute('data-ag-stats-hidden');
      else unlinkedList.setAttribute('data-ag-stats-hidden', '1');
    }
  }

  function detachSettingsPanel() {
    closeClaudeUxSettingsPane();
    cleanupSettingsStatsGroup(settingsSidebarRef || document.querySelector('[data-testid="settings-sidebar"]'));
    if (settingsSidebarRef) {
      settingsSidebarRef.removeEventListener('click', onNativeSettingsNavClick, true);
    }
    if (settingsNavWrap && settingsNavWrap.parentNode) settingsNavWrap.remove();
    if (settingsPanelEl && settingsPanelEl.parentNode) settingsPanelEl.remove();
    settingsSidebarRef = null;
    settingsRightRef = null;
    settingsNavWrap = null;
    settingsNavBtn = null;
    settingsPanelEl = null;
  }

  function reconcileSettingsPanel() {
    if (disposed) return;
    const sb = document.querySelector('[data-testid="settings-sidebar"]');
    if (!sb) {
      if (settingsSidebarRef || settingsStatsBtnWrap) {
        settingsStatsOpen = false;
        settingsStatsProjOpen = false;
        settingsStatsUnlinkedOpen = false;
        detachSettingsPanel();
      }
      return;
    }
    if (settingsNavWrap && settingsNavWrap.isConnected && settingsSidebarRef === sb) {
      if (!settingsRightRef || !settingsRightRef.isConnected) {
        const splitRootLive =
          sb.closest('[data-split-root="true"], [data-split-root]') ||
          (sb.parentElement && sb.parentElement.parentElement && sb.parentElement.parentElement.parentElement);
        const rightOuterLive =
          splitRootLive && splitRootLive.children && splitRootLive.children.length >= 2
            ? splitRootLive.children[splitRootLive.children.length - 1]
            : null;
        const rightContentLive = (rightOuterLive && rightOuterLive.firstElementChild) || rightOuterLive;
        if (rightContentLive) settingsRightRef = rightContentLive;
      }
      syncSettingsStatsGroup(sb);
      return;
    }
    if (settingsSidebarRef && settingsSidebarRef !== sb) {
      detachSettingsPanel();
    }

    const anchorBtn =
      sb.querySelector('button[data-testid="settings-nav-item-Appearance"]') ||
      sb.querySelector('button[data-testid="settings-nav-item-General"]') ||
      sb.querySelector('button[data-testid^="settings-nav-item-"]:not([data-testid="settings-nav-item-Stats"])');
    const splitRoot = sb.closest('[data-split-root="true"], [data-split-root]') || (sb.parentElement && sb.parentElement.parentElement && sb.parentElement.parentElement.parentElement);
    const rightOuter = splitRoot && splitRoot.children && splitRoot.children.length >= 2 ? splitRoot.children[splitRoot.children.length - 1] : null;
    const rightContent = (rightOuter && rightOuter.firstElementChild) || rightOuter;
    if (!anchorBtn || !anchorBtn.parentElement || !anchorBtn.parentElement.parentElement || !rightContent) {
      syncSettingsStatsGroup(sb);
      return;
    }

    settingsSidebarRef = sb;
    settingsRightRef = rightContent;
    const navWrap = document.createElement('div');
    navWrap.id = 'ag-claude-ux-settings-nav';
    navWrap.setAttribute('data-ag-i18n-ignore', '1');
    navWrap.className = anchorBtn.parentElement.className || 'relative group/nav-item mx-2';

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.setAttribute('data-testid', 'settings-nav-item-ClaudeUX');
    btn.className = (anchorBtn.className || '').replace(/\bbg-sidebar-secondary\b/g, 'hover:bg-sidebar-muted');
    btn.innerHTML = `<span class="truncate">${L('界面增强', 'UI Enhancements')}</span>`;
    btn.addEventListener('click', () => openClaudeUxSettingsPane());
    navWrap.appendChild(btn);

    anchorBtn.parentElement.insertAdjacentElement('afterend', navWrap);
    sb.addEventListener('click', onNativeSettingsNavClick, true);
    settingsNavWrap = navWrap;
    settingsNavBtn = btn;
    syncSettingsStatsGroup(sb);
  }

  /* ==========================================================================
   * 10. Claude-Style Projects Workspace & Pure-Local Context Manager
   *     - Mounts a `Projects` (`项目`) nav entry with Claude's stacked-box icon
   *       between `Automations` (`automations-button`) and `Skills` (`/customizations`).
   *     - Opens a right-pane Projects card wall reading real `sidebarProjects.projects`.
   *     - Clicking any project opens a Claude-style pure-local config modal for
   *       `Instructions` & `Add files` (written directly to `<dir>/AGENTS.md` +
   *       `<dir>/.anti-claude/files/` via `window.__agProjectCall`).
   * ========================================================================== */
  const SVG_CLAUDE_PROJECTS_ICON =
    '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.35" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
    '<path d="M5.25 2.75h5.5"/>' +
    '<path d="M3.75 5.25h8.5"/>' +
    '<path d="M2.6 7.75h10.8l-.68 4.8a1.4 1.4 0 0 1-1.39 1.2H4.67a1.4 1.4 0 0 1-1.39-1.2l-.68-4.8Z"/>' +
    '</svg>';

  const SVG_PROJ_SEARCH_ICON =
    '<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" aria-hidden="true"><circle cx="7.2" cy="7.2" r="4.6"/><path d="M10.8 10.8l2.8 2.8"/></svg>';

  let projectsViewOpen = false;
  let activeProjectId = null; // null = Level 1 grid; string = Level 2 project detail workspace
  let projectsSearchQuery = '';
  let projectsSortMode = 'recent'; // 'recent' | 'name'
  let projectsContextMap = {};
  let projectsNativeMtimeMap = {};
  const projectComposerDrafts = new Map();
  const projectComposerMentions = new Map(); // projectId -> Map<token, { token, label, kind, scopeItem }>
  const projectComposerMedia = new Map(); // projectId -> Array<{ id, file, name, mimeType, dataUrl, bytes }>
  let pdMediaSeq = 0;
  let cascadeRpcSvcRef = null;
  let pdMentionState = {
    open: false,
    projectId: '',
    startIdx: -1,
    endIdx: -1,
    rawQuery: '',
    category: '',
    subQuery: '',
    items: [],
    activeIndex: 0,
    loading: false,
    reqSeq: 0
  };
  const pdMentionCache = {
    rulesByKey: new Map(),
    pluginsByKey: new Map(),
    hasDriveProvider: null
  };
  let projectsSidebarRo = null;
  let projectsSidebarRoTarget = null;
  let projectsViewEl = null;
  let projectsModalEl = null;
  let projectsModalState = null; // { project, dirPath, instructions, hasOtherAgentsMd, saving, error }
  let projectsDocListenerBound = false;
  let projectsContextBusy = false;
  let projectFolderDropdownOpen = false;
  let projectFolderSearch = '';
  let projectSelectedFolderPath = '';
  let newProjectWatchCleanup = null;
  let projectMgmtSvcRef = null;
  let projectMenuState = null; // { project, x, y, confirmDelete }
  let projectMenuDocBound = false;
  const optimisticallyDeletedProjectIds = new Set();
  const optimisticProjectNames = new Map();

  const SVG_PROJ_SETTINGS =
    '<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.35" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="8" cy="8" r="2.2"/><path d="M8 1.9v1.5M8 12.6v1.5M1.9 8h1.5M12.6 8h1.5M3.7 3.7l1.1 1.1M11.2 11.2l1.1 1.1M12.3 3.7l-1.1 1.1M4.8 11.2l-1.1 1.1"/></svg>';

  const SVG_PD_MENTION_FILE =
    '<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.35" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 2.2h5.2L12.5 5.5v8.3a1 1 0 0 1-1 1h-7.5a1 1 0 0 1-1-1V3.2a1 1 0 0 1 1-1Z"/><path d="M9 2.2v3.4h3.4"/></svg>';
  const SVG_PD_MENTION_RULE =
    '<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.35" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3.2 2.6A1.4 1.4 0 0 1 4.6 1.2h8.2v12.2H4.6a1.4 1.4 0 0 0-1.4 1.4V2.6Z"/><path d="M3.2 13.4A1.4 1.4 0 0 1 4.6 12h8.2"/><path d="M6 4.8h4.2M6 7.4h4.2"/></svg>';
  const SVG_PD_MENTION_CHAT =
    '<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.35" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2.5 3.5a1.5 1.5 0 0 1 1.5-1.5h8a1.5 1.5 0 0 1 1.5 1.5v6a1.5 1.5 0 0 1-1.5 1.5H6.2L3.2 13.6V11H4a1.5 1.5 0 0 1-1.5-1.5v-6Z"/></svg>';
  const SVG_PD_MENTION_PLUGIN =
    '<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6.3 2.5a1.5 1.5 0 0 1 3 0v.9h2.2a1 1 0 0 1 1 1v2.2h.9a1.5 1.5 0 0 1 0 3h-.9v2.2a1 1 0 0 1-1 1H9.3v-.9a1.5 1.5 0 0 0-3 0v.9H3.5a1 1 0 0 1-1-1V9.6h.9a1.5 1.5 0 0 0 0-3h-.9V4.4a1 1 0 0 1 1-1h2.8v-.9Z"/></svg>';
  const SVG_PD_MENTION_DRIVE =
    '<svg width="14" height="14" viewBox="0 0 24 24" aria-hidden="true"><path fill="#0066DA" d="M3.4 18.5l2.5 4.3c.3.5.7.9 1.2 1.1L12 15.5H2c0 .6.2 1.1.5 1.6l.9 1.4z"/><path fill="#00AC47" d="M12 7.2L7.1 15.5H2l6.9-12c.5-.3 1-.5 1.6-.5h3c.6 0 1.1.2 1.6.5L12 7.2z"/><path fill="#EA4335" d="M16.9 23.9c.5-.2.9-.6 1.2-1.1l3.4-5.9c.3-.5.5-1 .5-1.6h-10l4.9 8.6z"/><path fill="#00832D" d="M12 7.2l3.1-4.2c-.5-.3-1-.5-1.6-.5h-3c-.6 0-1.1.2-1.6.5L12 7.2z"/><path fill="#2684FC" d="M12 15.5h10l-3.1-5.4L15.8 15l-3.8.5z"/><path fill="#FFBA00" d="M22 15.5c0-.6-.2-1.1-.5-1.6L15.1 2.7c-.3-.5-.7-.9-1.2-1.1L12 7.2l4.9 8.3H22z"/></svg>';

  function encodePathToFileUri(absPath) {
    const raw = String(absPath || '').trim();
    if (!raw) return '';
    if (raw.startsWith('file://')) return raw;
    const norm = raw.replace(/\\/g, '/');
    const withLead = norm.startsWith('/') ? norm : `/${norm}`;
    const parts = withLead.split('/').map((seg, i) => {
      if (i === 1 && /^[A-Za-z]:$/.test(seg)) return seg;
      return encodeURIComponent(seg);
    });
    return `file://${parts.join('/')}`;
  }

  function resolveCascadeRpcService() {
    if (
      cascadeRpcSvcRef &&
      (typeof cascadeRpcSvcRef.searchFiles === 'function' ||
        typeof cascadeRpcSvcRef.getAllRules === 'function' ||
        typeof cascadeRpcSvcRef.getAllPlugins === 'function')
    ) {
      return cascadeRpcSvcRef;
    }
    const rootEl = document.getElementById('root');
    const anchors = [
      document.querySelector('.bg-sidebar'),
      document.querySelector('[data-testid="automations-button"]'),
      document.querySelector('[data-testid="project-header"]'),
      rootEl && rootEl.firstElementChild
    ];
    const isRpc = (v) =>
      v &&
      typeof v === 'object' &&
      (typeof v.searchFiles === 'function' || typeof v.getAllRules === 'function' || typeof v.getAllPlugins === 'function');
    for (const anchor of anchors) {
      let cur = anchor ? activeReactFiber(anchor) : null;
      for (let d = 0; cur && d < 42; d++, cur = cur.return) {
        const pv = cur.memoizedProps && cur.memoizedProps.value;
        if (isRpc(pv)) {
          cascadeRpcSvcRef = pv;
          return pv;
        }
        for (let dep = cur.dependencies && cur.dependencies.firstContext; dep; dep = dep.next) {
          if (isRpc(dep.memoizedValue)) {
            cascadeRpcSvcRef = dep.memoizedValue;
            return dep.memoizedValue;
          }
        }
      }
    }
    return null;
  }

  function getProjectMentionMap(projectId, create = false) {
    if (!projectId) return null;
    let m = projectComposerMentions.get(projectId);
    if (!m && create) {
      m = new Map();
      projectComposerMentions.set(projectId, m);
    }
    return m || null;
  }

  function iconForMentionKind(kind, logoUrl = '') {
    if (logoUrl && /^(https?:|data:|blob:)/i.test(logoUrl)) {
      return `<img src="${escapeHtml(logoUrl)}" alt="" />`;
    }
    if (kind === 'directory') return SVG_PROJ_FOLDER_OPEN;
    if (kind === 'file') return SVG_PD_MENTION_FILE;
    if (kind === 'rule') return SVG_PD_MENTION_RULE;
    if (kind === 'conversation') return SVG_PD_MENTION_CHAT;
    if (kind === 'drive') return SVG_PD_MENTION_DRIVE;
    return SVG_PD_MENTION_PLUGIN;
  }

  function closePdMentionMenu() {
    pdMentionState.open = false;
    pdMentionState.items = [];
    pdMentionState.loading = false;
    pdMentionState.reqSeq += 1;
    const pop = document.getElementById('ag-pd-mention-popover');
    if (pop) {
      pop.setAttribute('data-open', 'false');
      pop.innerHTML = '';
    }
  }

  function parsePdMentionTrigger(text, caretPos) {
    const pos = typeof caretPos === 'number' ? caretPos : String(text || '').length;
    const before = String(text || '').slice(0, pos);
    const catMatch = before.match(/(?:^|[\s(\[{"'，。；：！？])@(files|rules|conversation|drive):([^@\n]*)$/i);
    if (catMatch) {
      const sub = catMatch[2] || '';
      const cat = catMatch[1].toLowerCase();
      const tokenLen = 1 + catMatch[1].length + 1 + sub.length;
      return {
        startIdx: pos - tokenLen,
        endIdx: pos,
        rawQuery: `${cat}:${sub}`,
        category: cat,
        subQuery: sub
      };
    }
    const rootMatch = before.match(/(?:^|[\s(\[{"'，。；：！？])@([^\s@\n\[]*)$/);
    if (rootMatch) {
      const q = rootMatch[1] || '';
      return {
        startIdx: pos - 1 - q.length,
        endIdx: pos,
        rawQuery: q,
        category: '',
        subQuery: q
      };
    }
    return null;
  }

  function getProjectWorkspaceUris(project) {
    if (!project) return [];
    const dirs = [];
    if (project.dirPath) dirs.push(project.dirPath);
    const ctx = project.dirPath ? projectsContextMap[project.dirPath] : null;
    if (ctx && Array.isArray(ctx.extraFolders)) {
      for (const ef of ctx.extraFolders) {
        if (ef && ef.absPath && !dirs.includes(ef.absPath)) dirs.push(ef.absPath);
      }
    }
    return dirs.map(encodePathToFileUri).filter(Boolean);
  }

  function collectMentionConversationOptions(project, filterQuery) {
    const { store } = resolveProjectsStoreAndBindings();
    const state = store ? store.getState() : null;
    const summaries = Object.assign(
      {},
      (state && state.trajectorySummaries && state.trajectorySummaries.summaries) || {},
      (state && state.trajectorySummaries && state.trajectorySummaries.externalSummaries) || {}
    );
    const projNameById = new Map();
    const rawProjs = (state && state.sidebarProjects && state.sidebarProjects.projects) || [];
    for (const rp of rawProjs) {
      if (rp && rp.id && rp.name) projNameById.set(rp.id, rp.name);
    }
    const q = String(filterQuery || '').trim().toLowerCase();
    const rows = [];
    for (const [cid, sum] of Object.entries(summaries)) {
      if (!sum || !isSidebarVisibleSummary(cid, sum, state)) continue;
      const title = String((sum.annotations && sum.annotations.title) || sum.summary || '').trim();
      if (!title) continue;
      const bodyPreview = String(sum.summary || '').trim();
      if (q && !title.toLowerCase().includes(q) && !bodyPreview.toLowerCase().includes(q)) continue;
      const pid = sum.projectId || (sum.trajectoryMetadata && sum.trajectoryMetadata.projectId) || '';
      const inCurrentProj = Boolean(project && project.id && pid === project.id);
      const isPinned = isSummaryPinned(cid, sum, state);
      const ownerLabel = inCurrentProj
        ? L('本项目', 'This project')
        : pid && pid !== 'outside-of-project' && projNameById.get(pid)
          ? projNameById.get(pid)
          : L('项目外对话', 'Outside of project');
      const lastSec = protoSeconds(sum.lastModifiedTime);
      const timeStr = lastSec ? formatProjectTimeAgo(lastSec) : '';
      rows.push({
        kind: 'conversation',
        label: title,
        desc: [isPinned ? L('置顶', 'Pinned') : '', ownerLabel, timeStr].filter(Boolean).join(' · '),
        inCurrentProj,
        isPinned,
        lastSec,
        scopeItem: {
          $typeName: 'exa.codeium_common_pb.ContextScopeItem',
          scopeItem: {
            case: 'conversation',
            value: Object.assign(
              {
                $typeName: 'exa.codeium_common_pb.ConversationScopeItem',
                id: cid,
                title,
                source: ''
              },
              sum.lastModifiedTime ? { lastModifiedTime: sum.lastModifiedTime } : {}
            )
          }
        }
      });
    }
    rows.sort((a, b) => {
      if (a.inCurrentProj !== b.inCurrentProj) return a.inCurrentProj ? -1 : 1;
      if (a.isPinned !== b.isPinned) return a.isPinned ? -1 : 1;
      return b.lastSec - a.lastSec;
    });
    return rows.slice(0, 60);
  }

  async function fetchPdMentionRules(workspaceUris) {
    const key = workspaceUris.join('|') || '__global__';
    const cached = pdMentionCache.rulesByKey.get(key);
    if (cached && Date.now() - cached.ts < 15000) return cached.items;
    const rt = resolveCascadeRpcService();
    if (!rt || typeof rt.getAllRules !== 'function') return [];
    try {
      const memories = (await rt.getAllRules(workspaceUris)) || [];
      const items = memories
        .map((d) => {
          if (!d) return null;
          const isProjScope = d.scope && d.scope.scope && d.scope.scope.case === 'projectScope';
          const rulePath = isProjScope ? d.scope.scope.value.absoluteFilePath : d.memoryId || d.rulePath || '';
          const ruleName = isProjScope ? d.scope.scope.value.filePath : d.memoryId || d.ruleName || '';
          const rawContent = d.memory && d.memory.case === 'textMemory' ? d.memory.value.content : d.description || '';
          const oneLine = String(rawContent || '')
            .replace(/<!--[\s\S]*?-->/g, ' ')
            .replace(/[#>*`\-\r\n]+/g, ' ')
            .replace(/\s+/g, ' ')
            .trim()
            .slice(0, 120);
          if (!ruleName) return null;
          return {
            kind: 'rule',
            label: ruleName,
            desc: oneLine || rulePath,
            scopeItem: {
              $typeName: 'exa.codeium_common_pb.ContextScopeItem',
              scopeItem: {
                case: 'rule',
                value: {
                  $typeName: 'exa.codeium_common_pb.RuleScopeItem',
                  rulePath,
                  ruleName,
                  description: String(rawContent || '')
                }
              }
            }
          };
        })
        .filter(Boolean);
      pdMentionCache.rulesByKey.set(key, { ts: Date.now(), items });
      return items;
    } catch {
      return [];
    }
  }

  async function fetchPdMentionPlugins(workspaceUris) {
    const key = workspaceUris.join('|') || '__global__';
    const cached = pdMentionCache.pluginsByKey.get(key);
    if (cached && Date.now() - cached.ts < 15000) return cached.items;
    const rt = resolveCascadeRpcService();
    if (!rt || typeof rt.getAllPlugins !== 'function') return [];
    try {
      const res = await rt.getAllPlugins({ workspaceUris });
      const rawList = Array.isArray(res) ? res : (res && Array.isArray(res.plugins) ? res.plugins : []);
      const items = rawList
        .filter(
          (p) =>
            p &&
            (p.name || p.displayName) &&
            p.enabled !== false &&
            ((Array.isArray(p.skills) && p.skills.length) ||
              (Array.isArray(p.workflows) && p.workflows.length) ||
              (Array.isArray(p.agents) && p.agents.length) ||
              (Array.isArray(p.rules) && p.rules.length) ||
              (Array.isArray(p.mcpServers) && p.mcpServers.length) ||
              (Array.isArray(p.sidecars) && p.sidecars.length) ||
              Boolean(p.hooksJson && String(p.hooksJson).trim()) ||
              !('skills' in p))
        )
        .map((p) => ({
          kind: 'plugin',
          label: p.displayName || p.name,
          desc: String(p.description || '').replace(/\s+/g, ' ').trim(),
          logo: p.logo || '',
          scopeItem: {
            $typeName: 'exa.codeium_common_pb.ContextScopeItem',
            scopeItem: {
              case: 'plugin',
              value: {
                $typeName: 'exa.codeium_common_pb.PluginScopeItem',
                name: p.name || p.displayName,
                displayName: p.displayName || p.name,
                path: p.path || '',
                logo: p.logo || ''
              }
            }
          }
        }));
      pdMentionCache.pluginsByKey.set(key, { ts: Date.now(), items });
      return items;
    } catch {
      return [];
    }
  }

  async function fetchPdMentionProjectFiles(project, subQuery, seq) {
    const wsUris = getProjectWorkspaceUris(project);
    if (!wsUris.length) return [];
    const rt = resolveCascadeRpcService();
    const q = String(subQuery || '').trim();
    const out = [];
    const seenUris = new Set();

    if (rt && typeof rt.searchFiles === 'function') {
      const batches = await Promise.all(
        wsUris.map(async (wsUri, idx) => {
          try {
            const res = await rt.searchFiles({
              query: q,
              workspaceUri: wsUri,
              includeDirectories: true,
              cancelToken: BigInt(6767 + seq * 10 + idx),
              maxResults: 28
            });
            return (res && Array.isArray(res.results) ? res.results : []).map((u) => ({ wsUri, u }));
          } catch {
            return [];
          }
        })
      );
      for (const { wsUri, u } of batches.flat()) {
        if (!u || !u.absoluteUri || seenUris.has(u.absoluteUri)) continue;
        seenUris.add(u.absoluteUri);
        const relMap = u.workspaceUrisToRelativePaths || {};
        const relPath = relMap[wsUri] || Object.values(relMap)[0] || decodeFileUriToPath(u.absoluteUri);
        const cleanRel = String(relPath || '').replace(/\/+$/, '');
        const baseName = cleanRel.split(/[\\/]/).pop() || cleanRel;
        const isDir = Number(u.numFiles || 0) > 1;
        out.push({
          kind: isDir ? 'directory' : 'file',
          label: baseName,
          desc: cleanRel !== baseName ? cleanRel : formatShortHomePath(decodeFileUriToPath(u.absoluteUri)),
          scopeItem: {
            $typeName: 'exa.codeium_common_pb.ContextScopeItem',
            scopeItem: {
              case: isDir ? 'directory' : 'file',
              value: {
                $typeName: 'exa.codeium_common_pb.PathScopeItem',
                absoluteUri: u.absoluteUri,
                workspaceUrisToRelativePaths: Object.assign({}, relMap),
                numFiles: Number(u.numFiles || 0)
              }
            }
          }
        });
      }
    }

    /* Also surface attached project context files if not already returned */
    const ctx = project.dirPath ? projectsContextMap[project.dirPath] : null;
    if (ctx && Array.isArray(ctx.files)) {
      const primaryUri = encodePathToFileUri(project.dirPath);
      const qLower = q.toLowerCase();
      for (const cf of ctx.files) {
        if (!cf || !cf.name) continue;
        if (qLower && !cf.name.toLowerCase().includes(qLower) && !String(cf.relPath || '').toLowerCase().includes(qLower)) continue;
        const abs = cf.absPath || (project.dirPath && cf.relPath ? `${project.dirPath.replace(/\/+$/, '')}/${cf.relPath}` : '');
        const uri = encodePathToFileUri(abs);
        if (!uri || seenUris.has(uri)) continue;
        seenUris.add(uri);
        const rel = cf.relPath || cf.name;
        out.push({
          kind: 'file',
          label: cf.name,
          desc: rel,
          scopeItem: {
            $typeName: 'exa.codeium_common_pb.ContextScopeItem',
            scopeItem: {
              case: 'file',
              value: {
                $typeName: 'exa.codeium_common_pb.PathScopeItem',
                absoluteUri: uri,
                workspaceUrisToRelativePaths: primaryUri ? { [primaryUri]: rel } : {},
                numFiles: 0
              }
            }
          }
        });
      }
    }
    return out.slice(0, 28);
  }

  async function fetchPdMentionDriveItems(subQuery) {
    const rt = resolveCascadeRpcService();
    if (!rt || typeof rt.searchContext !== 'function') return [];
    try {
      const res = await rt.searchContext({ providerLabel: 'drive', query: String(subQuery || '').trim() });
      const items = (res && (res.items || res.results)) || [];
      return items.slice(0, 20).map((it) => {
        const label = it.label || it.itemLabel || it.title || it.name || it.uri || 'Google Drive';
        const desc = it.description || it.subtitle || it.uri || '';
        return {
          kind: 'drive',
          label,
          desc,
          scopeItem: it.scopeItem && it.scopeItem.$typeName
            ? it.scopeItem
            : {
                $typeName: 'exa.codeium_common_pb.ContextScopeItem',
                scopeItem: {
                  case: 'dynamicContext',
                  value: {
                    $typeName: 'exa.codeium_common_pb.DynamicContextScopeItem',
                    providerLabel: 'drive',
                    itemLabel: label,
                    itemValue: it.value || it.itemValue || it.id || '',
                    uri: it.uri || it.url || ''
                  }
                }
              }
        };
      });
    } catch {
      return [];
    }
  }

  function renderPdMentionPopover() {
    const pop = document.getElementById('ag-pd-mention-popover');
    if (!pop) return;
    if (!pdMentionState.open) {
      pop.setAttribute('data-open', 'false');
      pop.innerHTML = '';
      return;
    }
    pop.setAttribute('data-open', 'true');
    const items = pdMentionState.items || [];
    if (pdMentionState.activeIndex >= items.length) {
      pdMentionState.activeIndex = Math.max(0, items.length - 1);
    }

    const catLabels = {
      files: L('项目文件', 'Project files'),
      rules: L('项目规则', 'Rules'),
      conversation: L('历史对话', 'Conversations'),
      drive: 'Google Drive'
    };

    let html = '';
    if (pdMentionState.category) {
      html += `<div class="ag-pd-mention-sec-hdr">
        <button type="button" class="ag-pd-mention-back" data-ag-pd-m-back="true">← ${escapeHtml(L('返回分类', 'Back'))}</button>
        <span>${escapeHtml(catLabels[pdMentionState.category] || pdMentionState.category)}</span>
      </div>`;
    }

    if (!items.length) {
      const emptyMsg = pdMentionState.loading
        ? L('正在加载选项…', 'Loading options…')
        : L('没有匹配的引用项', 'No matching items');
      html += `<div class="ag-pd-mention-empty">${escapeHtml(emptyMsg)}</div>`;
    } else {
      let lastSection = '';
      items.forEach((it, idx) => {
        if (it.section && it.section !== lastSection && !pdMentionState.category) {
          lastSection = it.section;
          html += `<div class="ag-pd-mention-sec-hdr"><span>${escapeHtml(it.section)}</span></div>`;
        }
        const active = idx === pdMentionState.activeIndex;
        const iconHtml = iconForMentionKind(it.kind, it.logo || '');
        html += `<button type="button" class="ag-pd-mention-row" role="option" aria-selected="${active ? 'true' : 'false'}" data-active="${active ? 'true' : 'false'}" data-ag-pd-m-idx="${idx}">
          <span class="ag-pd-mention-icon">${iconHtml}</span>
          <span class="ag-pd-mention-label">${escapeHtml(it.label)}</span>
          ${it.desc ? `<span class="ag-pd-mention-desc">${escapeHtml(it.desc)}</span>` : '<span class="ag-pd-mention-desc"></span>'}
          ${it.isCategory ? '<span class="ag-pd-mention-chev">›</span>' : ''}
        </button>`;
      });
    }

    pop.innerHTML = html;

    pop.querySelectorAll('img').forEach((img) => {
      img.addEventListener(
        'error',
        () => {
          if (img.parentElement) img.parentElement.innerHTML = SVG_PD_MENTION_PLUGIN;
        },
        { once: true }
      );
    });

    const backBtn = pop.querySelector('[data-ag-pd-m-back]');
    if (backBtn) {
      backBtn.addEventListener('mousedown', (e) => {
        e.preventDefault();
        e.stopPropagation();
        resetPdMentionToRoot();
      });
    }

    pop.querySelectorAll('[data-ag-pd-m-idx]').forEach((row) => {
      const idx = Number(row.getAttribute('data-ag-pd-m-idx'));
      row.addEventListener('mouseenter', () => {
        if (pdMentionState.activeIndex !== idx) {
          pdMentionState.activeIndex = idx;
          pop.querySelectorAll('[data-ag-pd-m-idx]').forEach((r2, i2) => {
            r2.setAttribute('data-active', i2 === idx ? 'true' : 'false');
            r2.setAttribute('aria-selected', i2 === idx ? 'true' : 'false');
          });
        }
      });
      row.addEventListener('mousedown', (e) => {
        /* mousedown + preventDefault keeps focus inside #ag-pd-composer-input cleanly */
        e.preventDefault();
        e.stopPropagation();
        applyPdMentionSelection(idx);
      });
    });

    const activeRow = pop.querySelector('.ag-pd-mention-row[data-active="true"]');
    if (activeRow && typeof activeRow.scrollIntoView === 'function') {
      try {
        activeRow.scrollIntoView({ block: 'nearest' });
      } catch {}
    }
  }

  function syncPdMentionPills(project, compInput) {
    const bar = document.getElementById('ag-pd-mention-pills');
    if (!bar || !project) return;
    const mMap = getProjectMentionMap(project.id, false);
    const val = String((compInput && compInput.value) || '');
    if (!mMap || !mMap.size || !val) {
      if (mMap && !val) mMap.clear();
      bar.style.display = 'none';
      bar.innerHTML = '';
      return;
    }
    const activeEntries = [];
    for (const [token, entry] of [...mMap.entries()]) {
      if (val.includes(token)) {
        activeEntries.push(entry);
      } else {
        mMap.delete(token);
      }
    }
    if (!activeEntries.length) {
      bar.style.display = 'none';
      bar.innerHTML = '';
      return;
    }
    bar.style.display = 'flex';
    bar.innerHTML = activeEntries
      .map(
        (en) => `<span class="ag-pd-mention-pill" data-ag-pd-pill-tok="${escapeHtml(en.token)}">
          <span class="ag-pd-mention-pill-icon">${iconForMentionKind(en.kind, en.logo || '')}</span>
          <span class="ag-pd-mention-pill-lbl">${escapeHtml(en.label)}</span>
          <button type="button" class="ag-pd-mention-pill-rm" data-ag-pd-pill-rm="${escapeHtml(en.token)}" aria-label="${escapeHtml(L('移除引用', 'Remove mention'))}">×</button>
        </span>`
      )
      .join('');

    bar.querySelectorAll('[data-ag-pd-pill-rm]').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        const tok = btn.getAttribute('data-ag-pd-pill-rm');
        if (!tok || !compInput) return;
        const nextVal = compInput.value
          .split(tok)
          .join('')
          .replace(/  +/g, ' ');
        compInput.value = nextVal;
        mMap.delete(tok);
        compInput.dispatchEvent(new Event('input', { bubbles: true }));
        compInput.focus();
      });
    });
  }

  function getProjectMediaList(projectId, create = false) {
    if (!projectId) return null;
    let list = projectComposerMedia.get(projectId);
    if (!list && create) {
      list = [];
      projectComposerMedia.set(projectId, list);
    }
    return list || null;
  }

  function inferComposerImageMime(file) {
    const rawType = String((file && file.type) || '').trim().toLowerCase();
    if (rawType.startsWith('image/')) return rawType;
    const name = String((file && file.name) || '').trim().toLowerCase();
    if (/\.(jpe?g)$/.test(name)) return 'image/jpeg';
    if (/\.gif$/.test(name)) return 'image/gif';
    if (/\.webp$/.test(name)) return 'image/webp';
    if (/\.svg$/.test(name)) return 'image/svg+xml';
    if (/\.bmp$/.test(name)) return 'image/bmp';
    if (/\.avif$/.test(name)) return 'image/avif';
    if (/\.heic$/.test(name)) return 'image/heic';
    if (/\.tiff?$/.test(name)) return 'image/tiff';
    if (/\.png$/.test(name)) return 'image/png';
    return '';
  }

  function extractComposerImageFiles(dt) {
    if (!dt) return [];
    const out = [];
    if (dt.items && typeof dt.items.length === 'number') {
      for (let i = 0; i < dt.items.length; i++) {
        const it = dt.items[i];
        if (!it || it.kind !== 'file' || typeof it.getAsFile !== 'function') continue;
        const f = it.getAsFile();
        if (f && inferComposerImageMime(f)) out.push(f);
      }
    }
    if (!out.length && dt.files && typeof dt.files.length === 'number') {
      for (let i = 0; i < dt.files.length; i++) {
        const f = dt.files[i];
        if (f && inferComposerImageMime(f)) out.push(f);
      }
    }
    return out;
  }

  function uint8ToBase64(bytes) {
    if (!bytes || !bytes.length) return '';
    let bin = '';
    for (let i = 0; i < bytes.length; i++) {
      bin += String.fromCharCode(bytes[i]);
    }
    return typeof btoa === 'function' ? btoa(bin) : '';
  }

  async function readBlobBytes(file) {
    if (!file) return new Uint8Array(0);
    if (typeof file.arrayBuffer === 'function') {
      const ab = await file.arrayBuffer();
      return new Uint8Array(ab);
    }
    if (typeof FileReader !== 'undefined') {
      return new Promise((resolve) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result ? new Uint8Array(reader.result) : new Uint8Array(0));
        reader.onerror = () => resolve(new Uint8Array(0));
        reader.readAsArrayBuffer(file);
      });
    }
    return new Uint8Array(0);
  }

  async function stagePdComposerImageFiles(project, rawFiles, onUpdated) {
    if (!project || !project.id || !rawFiles || !rawFiles.length) return 0;
    const list = getProjectMediaList(project.id, true);
    const maxTotal = 10;
    const maxBytes = 20 * 1024 * 1024;
    let added = 0;
    for (const f of Array.from(rawFiles)) {
      if (list.length >= maxTotal) break;
      const mimeType = inferComposerImageMime(f);
      if (!mimeType) continue;
      if (typeof f.size === 'number' && f.size > maxBytes) continue;
      const bytes = await readBlobBytes(f);
      if (!bytes.length || bytes.length > maxBytes) continue;
      const id = `pdm-${++pdMediaSeq}`;
      const ext = (mimeType.split('/')[1] || 'png').replace(/\+.*$/, '').replace('jpeg', 'jpg');
      const rawName = String(f.name || '').trim();
      const name = !rawName || /^image\.[a-z0-9]+$/i.test(rawName) ? `pasted-image-${pdMediaSeq}.${ext}` : rawName;
      const normalizedFile =
        typeof File === 'function' ? new File([bytes], name, { type: mimeType }) : f;
      const dataUrl = `data:${mimeType};base64,${uint8ToBase64(bytes)}`;
      list.push({ id, file: normalizedFile, name, mimeType, dataUrl, bytes });
      added += 1;
    }
    if (added > 0 && typeof onUpdated === 'function') {
      onUpdated();
    }
    return added;
  }

  function syncPdMediaStrip(project, onMutated) {
    const strip = document.getElementById('ag-pd-media-strip');
    if (!strip || !project) return;
    const list = getProjectMediaList(project.id, false);
    const sig = list && list.length ? list.map((m) => m.id).join(',') : '';
    if (strip.dataset.agMediaSig === sig) return;
    strip.dataset.agMediaSig = sig;
    if (!list || !list.length) {
      strip.style.display = 'none';
      strip.innerHTML = '';
      return;
    }
    strip.style.display = 'flex';
    strip.innerHTML = list
      .map(
        (m) => `<div class="ag-pd-media-card" data-ag-pd-media-id="${escapeHtml(m.id)}" title="${escapeHtml(m.name)}">
          <img class="ag-pd-media-img" src="${escapeHtml(m.dataUrl)}" alt="${escapeHtml(m.name)}" />
          <button type="button" class="ag-pd-media-rm" data-ag-pd-media-rm="${escapeHtml(m.id)}" aria-label="${escapeHtml(L('移除图片', 'Remove image'))}">×</button>
        </div>`
      )
      .join('');
    strip.querySelectorAll('[data-ag-pd-media-rm]').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        const mid = btn.getAttribute('data-ag-pd-media-rm');
        const cur = getProjectMediaList(project.id, false);
        if (!cur || !mid) return;
        const idx = cur.findIndex((x) => x.id === mid);
        if (idx >= 0) cur.splice(idx, 1);
        if (!cur.length) projectComposerMedia.delete(project.id);
        syncPdMediaStrip(project, onMutated);
        if (typeof onMutated === 'function') onMutated();
      });
    });
  }

  function resetPdMentionToRoot() {
    const compInput = document.getElementById('ag-pd-composer-input');
    if (!compInput || !pdMentionState.open) return;
    const val = compInput.value || '';
    const start = pdMentionState.startIdx;
    const end = pdMentionState.endIdx;
    if (start < 0 || end < start) return;
    const nextVal = `${val.slice(0, start)}@${val.slice(end)}`;
    compInput.value = nextVal;
    const nextCaret = start + 1;
    compInput.focus();
    try {
      compInput.setSelectionRange(nextCaret, nextCaret);
    } catch {}
    compInput.dispatchEvent(new Event('input', { bubbles: true }));
  }

  function movePdMentionSelection(delta) {
    if (!pdMentionState.open || !pdMentionState.items.length) return;
    const len = pdMentionState.items.length;
    pdMentionState.activeIndex = (pdMentionState.activeIndex + delta + len) % len;
    renderPdMentionPopover();
  }

  function getMentionScopeIdentity(scopeItem) {
    const inner = scopeItem && scopeItem.scopeItem;
    if (!inner || !inner.case) return '';
    const v = inner.value || {};
    if (inner.case === 'file' || inner.case === 'directory') return `${inner.case}:${v.absoluteUri || ''}`;
    if (inner.case === 'conversation') return `conversation:${v.id || ''}`;
    if (inner.case === 'dynamicContext') return `dyn:${v.providerLabel || ''}:${v.uri || v.itemValue || v.itemLabel || ''}`;
    if (inner.case === 'rule' || inner.case === 'skill' || inner.case === 'workflow') {
      return `${inner.case}:${v.uri || v.name || v.id || ''}`;
    }
    try {
      return `${inner.case}:${JSON.stringify(v)}`;
    } catch {
      return inner.case;
    }
  }

  function allocateUniqueMentionToken(mMap, rawLabel, item) {
    const cleanLabel = String(rawLabel || '').replace(/[\[\]\r\n]+/g, ' ').trim() || 'item';
    const identity = getMentionScopeIdentity(item && item.scopeItem);
    if (identity) {
      for (const [existingTok, existingEntry] of mMap.entries()) {
        if (getMentionScopeIdentity(existingEntry && existingEntry.scopeItem) === identity) {
          return { token: existingTok, label: existingEntry.label || cleanLabel };
        }
      }
    }
    const baseToken = `@[${cleanLabel}]`;
    if (!mMap.has(baseToken)) {
      return { token: baseToken, label: cleanLabel };
    }
    /* Disambiguate colliding display names (e.g. src/a/index.ts vs src/b/index.ts) using parent path or index */
    const rawDesc = String((item && item.desc) || '').replace(/[\[\]\r\n]+/g, ' ').trim();
    const absUri = item && item.scopeItem && item.scopeItem.scopeItem && item.scopeItem.scopeItem.value && item.scopeItem.scopeItem.value.absoluteUri;
    const hintPath = rawDesc || (absUri ? decodeFileUriToPath(absUri) : '');
    if (hintPath) {
      const segs = hintPath.split(/[\\/]/).filter(Boolean);
      for (let take = 2; take <= Math.min(segs.length, 4); take++) {
        const candidateLbl = segs.slice(-take).join('/');
        const candidateTok = `@[${candidateLbl}]`;
        if (!mMap.has(candidateTok)) {
          return { token: candidateTok, label: candidateLbl };
        }
      }
    }
    let n = 2;
    while (mMap.has(`@[${cleanLabel} (${n})]`)) n += 1;
    const numbered = `${cleanLabel} (${n})`;
    return { token: `@[${numbered}]`, label: numbered };
  }

  function applyPdMentionSelection(index) {
    if (!pdMentionState.open) return;
    const item = pdMentionState.items[index];
    const compInput = document.getElementById('ag-pd-composer-input');
    const allProjects = collectNativeProjects();
    const project = allProjects.find((p) => p.id === pdMentionState.projectId);
    if (!item || !compInput || !project) return;

    const val = compInput.value || '';
    const start = pdMentionState.startIdx;
    const end = pdMentionState.endIdx;
    if (start < 0 || end < start) return;

    if (item.isCategory && item.categoryTrigger) {
      const replacement = `@${item.categoryTrigger}:`;
      compInput.value = `${val.slice(0, start)}${replacement}${val.slice(end)}`;
      const nextCaret = start + replacement.length;
      compInput.focus();
      try {
        compInput.setSelectionRange(nextCaret, nextCaret);
      } catch {}
      compInput.dispatchEvent(new Event('input', { bubbles: true }));
      return;
    }

    const mMap = getProjectMentionMap(project.id, true);
    const { token, label: finalLabel } = allocateUniqueMentionToken(mMap, item.label, item);
    mMap.set(token, {
      token,
      label: finalLabel,
      kind: item.kind || 'plugin',
      logo: item.logo || '',
      scopeItem: item.scopeItem
    });
    const afterChar = val.slice(end, end + 1);
    const trailingSpace = afterChar && /\s/.test(afterChar) ? '' : ' ';
    const inserted = `${token}${trailingSpace}`;
    compInput.value = `${val.slice(0, start)}${inserted}${val.slice(end)}`;
    const nextCaret = start + inserted.length;
    closePdMentionMenu();
    compInput.focus();
    try {
      compInput.setSelectionRange(nextCaret, nextCaret);
    } catch {}
    compInput.dispatchEvent(new Event('input', { bubbles: true }));
  }

  function appendDroppedMentionsToPdComposer(project, compInput, items) {
    if (!project || !compInput || !Array.isArray(items) || !items.length) return;
    const mMap = getProjectMentionMap(project.id, true);
    let curVal = compInput.value || '';
    for (const item of items) {
      if (!item || !item.scopeItem) continue;
      const { token, label: finalLabel } = allocateUniqueMentionToken(mMap, item.label, item);
      mMap.set(token, {
        token,
        label: finalLabel,
        kind: item.kind || 'conversation',
        logo: item.logo || '',
        scopeItem: item.scopeItem
      });
      if (!curVal.includes(token)) {
        const sep = curVal && !/\s$/.test(curVal) ? ' ' : '';
        curVal = `${curVal}${sep}${token} `;
      }
    }
    compInput.value = curVal;
    compInput.focus();
    try {
      compInput.setSelectionRange(curVal.length, curVal.length);
    } catch {}
    compInput.dispatchEvent(new Event('input', { bubbles: true }));
  }

  const PD_INLINE_URL_RE = /(?<![\w./@-])(?:https?:\/\/|www\.)[^\s<>"'`]*[^\s<>"'`.,;:!?)\]}]/g;
  function openUrlAtTextareaCaret(textarea) {
    if (!textarea || typeof textarea.selectionStart !== 'number') return false;
    const text = textarea.value || '';
    const pos = textarea.selectionStart;
    PD_INLINE_URL_RE.lastIndex = 0;
    let m;
    while ((m = PD_INLINE_URL_RE.exec(text)) !== null) {
      const start = m.index;
      const end = start + m[0].length;
      if (pos >= start && pos <= end) {
        const url = m[0].startsWith('www.') ? `https://${m[0]}` : m[0];
        try {
          window.open(url, '_blank', 'noopener,noreferrer');
        } catch {}
        return true;
      }
    }
    return false;
  }

  async function updatePdMentionMenuForInput(project, compInput) {
    if (!project || !compInput) {
      closePdMentionMenu();
      return;
    }
    const parsed = parsePdMentionTrigger(compInput.value || '', compInput.selectionStart);
    if (!parsed) {
      if (pdMentionState.open) closePdMentionMenu();
      return;
    }

    const seq = ++pdMentionState.reqSeq;
    const sameCategory = pdMentionState.open && pdMentionState.category === parsed.category && pdMentionState.rawQuery === parsed.rawQuery;
    pdMentionState.open = true;
    pdMentionState.projectId = project.id;
    pdMentionState.startIdx = parsed.startIdx;
    pdMentionState.endIdx = parsed.endIdx;
    pdMentionState.rawQuery = parsed.rawQuery;
    pdMentionState.category = parsed.category;
    pdMentionState.subQuery = parsed.subQuery;
    if (!sameCategory) pdMentionState.activeIndex = 0;

    const wsUris = getProjectWorkspaceUris(project);
    const hasLocalFolder = wsUris.length > 0;
    const browseSecTitle = L('分类浏览', 'Browse');
    const pluginSecTitle = L('扩展插件', 'Plugins');

    const baseCategories = [
      ...(hasLocalFolder
        ? [
            {
              isCategory: true,
              categoryTrigger: 'files',
              kind: 'file',
              section: browseSecTitle,
              label: L('项目文件', 'Project files'),
              desc: L('浏览本项目文件夹中的文件与目录', 'Browse files & folders in project')
            }
          ]
        : []),
      {
        isCategory: true,
        categoryTrigger: 'rules',
        kind: 'rule',
        section: browseSecTitle,
        label: L('项目规则', 'Rules'),
        desc: L('浏览规则', 'Browse rules')
      },
      {
        isCategory: true,
        categoryTrigger: 'conversation',
        kind: 'conversation',
        section: browseSecTitle,
        label: L('历史对话', 'Conversations'),
        desc: L('搜索并引用任意对话（含项目外对话）', 'Search conversations')
      },
      {
        isCategory: true,
        categoryTrigger: 'drive',
        kind: 'drive',
        section: browseSecTitle,
        label: 'Google Drive',
        desc: L('搜索云端硬盘文档', 'Search Google Drive')
      }
    ];

    /* 1. Drilled into a specific category (`@files:`, `@rules:`, `@conversation:`, `@drive:`) */
    if (parsed.category === 'conversation') {
      pdMentionState.loading = false;
      pdMentionState.items = collectMentionConversationOptions(project, parsed.subQuery);
      renderPdMentionPopover();
      return;
    }

    if (parsed.category === 'rules') {
      pdMentionState.loading = true;
      renderPdMentionPopover();
      const rules = await fetchPdMentionRules(wsUris);
      if (disposed || pdMentionState.reqSeq !== seq) return;
      const q = parsed.subQuery.trim().toLowerCase();
      pdMentionState.loading = false;
      pdMentionState.items = q
        ? rules.filter((r) => r.label.toLowerCase().includes(q) || String(r.desc || '').toLowerCase().includes(q))
        : rules;
      renderPdMentionPopover();
      return;
    }

    if (parsed.category === 'files') {
      pdMentionState.loading = true;
      renderPdMentionPopover();
      const files = await fetchPdMentionProjectFiles(project, parsed.subQuery, seq);
      if (disposed || pdMentionState.reqSeq !== seq) return;
      pdMentionState.loading = false;
      pdMentionState.items = files;
      renderPdMentionPopover();
      return;
    }

    if (parsed.category === 'drive') {
      pdMentionState.loading = true;
      renderPdMentionPopover();
      const driveItems = await fetchPdMentionDriveItems(parsed.subQuery);
      if (disposed || pdMentionState.reqSeq !== seq) return;
      pdMentionState.loading = false;
      pdMentionState.items = driveItems;
      renderPdMentionPopover();
      return;
    }

    /* 2. Root `@` (`rawQuery === ""`) -> instant Browse categories + Plugins (matching native @ menu) */
    const q = parsed.subQuery.trim().toLowerCase();
    if (!q) {
      const cachedPlugins = pdMentionCache.pluginsByKey.get(wsUris.join('|') || '__global__');
      pdMentionState.loading = !cachedPlugins;
      pdMentionState.items = [
        ...baseCategories,
        ...((cachedPlugins ? cachedPlugins.items : []).map((p) => Object.assign({}, p, { section: pluginSecTitle })))
      ];
      renderPdMentionPopover();
      const plugins = await fetchPdMentionPlugins(wsUris);
      if (disposed || pdMentionState.reqSeq !== seq) return;
      pdMentionState.loading = false;
      pdMentionState.items = [
        ...baseCategories,
        ...plugins.map((p) => Object.assign({}, p, { section: pluginSecTitle }))
      ];
      renderPdMentionPopover();
      return;
    }

    /* 3. Direct filter `@<q>` -> search Categories + Conversations + Project Files + Rules + Plugins in parallel! */
    const catHits = baseCategories.filter(
      (c) =>
        c.categoryTrigger.startsWith(q) ||
        c.label.toLowerCase().includes(q) ||
        String(c.desc || '').toLowerCase().includes(q)
    );
    const convHits = collectMentionConversationOptions(project, q)
      .slice(0, 6)
      .map((c) => Object.assign({}, c, { section: L('历史对话', 'Conversations') }));

    pdMentionState.loading = true;
    pdMentionState.items = [...catHits, ...convHits];
    renderPdMentionPopover();

    const [fileHits, ruleAll, pluginAll] = await Promise.all([
      hasLocalFolder ? fetchPdMentionProjectFiles(project, q, seq) : Promise.resolve([]),
      fetchPdMentionRules(wsUris),
      fetchPdMentionPlugins(wsUris)
    ]);
    if (disposed || pdMentionState.reqSeq !== seq) return;

    const ruleHits = ruleAll
      .filter((r) => r.label.toLowerCase().includes(q) || String(r.desc || '').toLowerCase().includes(q))
      .slice(0, 6)
      .map((r) => Object.assign({}, r, { section: L('项目规则', 'Rules') }));
    const pluginHits = pluginAll
      .filter((p) => p.label.toLowerCase().includes(q) || String(p.desc || '').toLowerCase().includes(q))
      .slice(0, 6)
      .map((p) => Object.assign({}, p, { section: pluginSecTitle }));
    const taggedFiles = fileHits.slice(0, 8).map((f) => Object.assign({}, f, { section: L('项目文件', 'Project files') }));

    pdMentionState.loading = false;
    pdMentionState.items = [...catHits, ...taggedFiles, ...convHits, ...ruleHits, ...pluginHits];
    renderPdMentionPopover();
  }

  function buildComposerSubmitChunks(rawPrompt, mentionEntries = []) {
    const prompt = String(rawPrompt || '');
    if (!prompt.trim()) return [];
    const valid = (Array.isArray(mentionEntries) ? mentionEntries : []).filter(
      (e) => e && e.token && e.scopeItem && prompt.includes(e.token)
    );
    if (!valid.length) {
      return [{ $typeName: 'exa.codeium_common_pb.TextOrScopeItem', chunk: { case: 'text', value: prompt } }];
    }
    /* Sort longest token first to prevent prefix collisions */
    const sorted = valid.slice().sort((a, b) => b.token.length - a.token.length);
    const chunks = [];
    let cursor = 0;
    while (cursor < prompt.length) {
      let bestIdx = -1;
      let bestEntry = null;
      for (const en of sorted) {
        const idx = prompt.indexOf(en.token, cursor);
        if (idx !== -1 && (bestIdx === -1 || idx < bestIdx)) {
          bestIdx = idx;
          bestEntry = en;
        }
      }
      if (bestIdx === -1 || !bestEntry) {
        const tail = prompt.slice(cursor);
        if (tail) {
          chunks.push({ $typeName: 'exa.codeium_common_pb.TextOrScopeItem', chunk: { case: 'text', value: tail } });
        }
        break;
      }
      if (bestIdx > cursor) {
        chunks.push({
          $typeName: 'exa.codeium_common_pb.TextOrScopeItem',
          chunk: { case: 'text', value: prompt.slice(cursor, bestIdx) }
        });
      }
      chunks.push({
        $typeName: 'exa.codeium_common_pb.TextOrScopeItem',
        chunk: { case: 'item', value: bestEntry.scopeItem }
      });
      cursor = bestIdx + bestEntry.token.length;
    }
    return chunks;
  }

  function clearNewProjectWatcher() {
    if (typeof newProjectWatchCleanup === 'function') {
      const fn = newProjectWatchCleanup;
      newProjectWatchCleanup = null;
      try {
        fn();
      } catch {}
    }
  }

  const SVG_PROJ_CHEVRON =
    '<svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4.5 6.2L8 9.8l3.5-3.6"/></svg>';

  const SVG_PROJ_FOLDER_ADD =
    '<svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2 4.5A1.5 1.5 0 0 1 3.5 3h3l1.3 1.5h4.7A1.5 1.5 0 0 1 14 6v2.2M2 4.5v7A1.5 1.5 0 0 0 3.5 13H8"/><path d="M11.5 9.2v4.6M9.2 11.5h4.6"/></svg>';

  const SVG_PROJ_SEND_ARROW =
    '<svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M8 12.5V3.5M4 7.2L8 3.2l4 4"/></svg>';

  const SVG_PROJ_FOLDER_OPEN =
    '<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2 4.5A1.5 1.5 0 0 1 3.5 3h3l1.3 1.5h4.7A1.5 1.5 0 0 1 14 6v5.5a1.5 1.5 0 0 1-1.5 1.5h-9A1.5 1.5 0 0 1 2 11.5v-7Z"/></svg>';

  const SVG_PROJ_PLUS =
    '<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" aria-hidden="true"><path d="M8 3.2v9.6M3.2 8h9.6"/></svg>';

  const SVG_PROJ_EDIT =
    '<svg width="13.5" height="13.5" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M11.2 2.4a1.4 1.4 0 0 1 2 2L5.5 12.1 2.7 13l.9-2.8 7.6-7.8Z"/></svg>';

  function decodeFileUriToPath(uri) {
    const s = String(uri || '').trim();
    if (!s) return '';
    if (!/^file:\/\//i.test(s)) return s;
    try {
      let p = decodeURIComponent(new URL(s).pathname);
      if (/^\/[A-Za-z]:/.test(p)) p = p.slice(1);
      return p;
    } catch {
      return '';
    }
  }

  function formatShortHomePath(absPath) {
    const p = String(absPath || '').trim();
    if (!p) return '';
    return p.replace(/^\/Users\/[^/]+/, '~').replace(/^\/home\/[^/]+/, '~').replace(/^[A-Za-z]:\\Users\\[^\\]+/i, '~');
  }

  function formatProjectTimeAgo(sec) {
    const s = Number(sec) || 0;
    if (!s) return '';
    const diff = Math.max(0, Math.floor(Date.now() / 1000) - s);
    if (diff < 60) return L('刚刚', 'now');
    if (diff < 3600) {
      const mins = Math.floor(diff / 60);
      return FEAT.i18n ? `${mins} 分钟前` : `${mins}m`;
    }
    if (diff < 86400) {
      const hrs = Math.floor(diff / 3600);
      return FEAT.i18n ? `${hrs} 小时前` : `${hrs}h`;
    }
    const days = Math.floor(diff / 86400);
    if (days < 30) return FEAT.i18n ? `${days} 天前` : `${days}d ago`;
    const dt = new Date(s * 1000);
    return FEAT.i18n ? `${dt.getMonth() + 1}月${dt.getDate()}日` : `${dt.getMonth() + 1}/${dt.getDate()}`;
  }

  function resolveProjectsStoreAndBindings() {
    let bindings = findSidebarBindings();
    let store = (bindings && bindings.store) || sidebarStoreRef || null;
    let router = (bindings && bindings.router) || null;
    if (!store || !router) {
      const rootEl = document.getElementById('root');
      const anchors = [
        document.querySelector('[data-testid="project-header"]'),
        document.querySelector('[data-testid="automations-button"]'),
        document.querySelector('.bg-sidebar'),
        rootEl && rootEl.firstElementChild
      ];
      for (const anchor of anchors) {
        let f = anchor ? activeReactFiber(anchor) : null;
        for (let d = 0; f && d < 42 && (!store || !router); d++, f = f.return) {
          const mp = f.memoizedProps;
          if (!store && mp && mp.sidebarStore && typeof mp.sidebarStore.getState === 'function') {
            store = mp.sidebarStore;
          }
          if (!router && mp && mp.sidebarRouter && typeof mp.sidebarRouter.navigate === 'function') {
            router = mp.sidebarRouter;
          }
          if (!router && mp && mp.value && typeof mp.value.navigate === 'function' && mp.value.state && mp.value.state.location) {
            router = mp.value;
          }
          for (let dep = f.dependencies && f.dependencies.firstContext; dep; dep = dep.next) {
            const mv = dep.memoizedValue;
            if (!store && mv && mv.store && typeof mv.store.getState === 'function') {
              store = mv.store;
            }
            if (!router && mv && typeof mv.navigate === 'function' && mv.state && mv.state.location) {
              router = mv;
            }
          }
        }
        if (store && router) break;
      }
    }
    if (!bindings && (store || router)) {
      bindings = { store, router, stepHandler: null, actionsCtx: null, groupsById: new Map(), projectLabels: new Map() };
    } else if (bindings && router && !bindings.router) {
      bindings = Object.assign({}, bindings, { router });
    }
    return { store, bindings };
  }

  function collectProjectConversations(project, state) {
    if (!project || !state) return [];
    const summaries = (state.trajectorySummaries && state.trajectorySummaries.summaries) || {};
    const byProject = state.trajectorySummaries && state.trajectorySummaries.indexes && state.trajectorySummaries.indexes.byProject;
    const rawIds = byProject && byProject[project.id];
    const candidateIds = new Set();

    if (rawIds) {
      const arr =
        typeof rawIds[Symbol.iterator] === 'function'
          ? Array.from(rawIds)
          : typeof rawIds === 'object'
            ? Object.keys(rawIds)
            : [];
      for (const id of arr) candidateIds.add(id);
    }

    const normDir = String(project.dirPath || '').replace(/\/+$/, '');
    for (const [cid, sum] of Object.entries(summaries)) {
      if (!sum) continue;
      const pid = sum.projectId || (sum.trajectoryMetadata && sum.trajectoryMetadata.projectId) || '';
      if (pid === project.id) {
        candidateIds.add(cid);
        continue;
      }
      if (normDir) {
        const wsList = (sum.workspaces || []).concat((sum.trajectoryMetadata && sum.trajectoryMetadata.workspaces) || []);
        for (const ws of wsList) {
          const rawUri = ws && (ws.workspaceFolderAbsoluteUri || ws.uri || ws);
          const norm = typeof rawUri === 'string' ? decodeFileUriToPath(rawUri).replace(/\/+$/, '') : '';
          if (norm && norm === normDir) {
            candidateIds.add(cid);
            break;
          }
        }
      }
    }

    const items = [];
    for (const cid of candidateIds) {
      const sum = summaries[cid];
      if (!sum || !isSidebarVisibleSummary(cid, sum, state)) continue;
      const title = String((sum.annotations && sum.annotations.title) || sum.summary || '').trim();
      if (!title) continue;
      const lastSec = protoSeconds(sum.lastModifiedTime);
      const status = sum.status ?? 0;
      const waiting = Boolean(sum.waitingSteps && sum.waitingSteps.length);
      const running = !sum.killed && (status === 2 || status === 3 || status === 4 || Boolean(sum.hasRunningSubagents));
      items.push({
        id: cid,
        title,
        lastSec,
        pinned: isSummaryPinned(cid, sum, state),
        waiting,
        running
      });
    }
    items.sort((a, b) => (a.pinned !== b.pinned ? (a.pinned ? -1 : 1) : b.lastSec - a.lastSec));
    return items;
  }

  function resolveProjectManagementService() {
    if (projectMgmtSvcRef && typeof projectMgmtSvcRef.deleteProject === 'function') {
      return projectMgmtSvcRef;
    }
    const rootEl = document.getElementById('root');
    const anchors = [
      document.querySelector('.bg-sidebar'),
      document.querySelector('[data-testid="automations-button"]'),
      document.querySelector('[data-testid="project-header"]'),
      rootEl && rootEl.firstElementChild
    ];
    const pickSvc = (val) => {
      if (!val || typeof val !== 'object') return null;
      if (val.core && val.core.projectManagementService && typeof val.core.projectManagementService.deleteProject === 'function') {
        return val.core.projectManagementService;
      }
      if (typeof val.deleteProject === 'function') return val;
      return null;
    };
    for (const anchor of anchors) {
      let cur = anchor ? activeReactFiber(anchor) : null;
      for (let d = 0; cur && d < 42; d++, cur = cur.return) {
        const fromProps = pickSvc(cur.memoizedProps && cur.memoizedProps.value);
        if (fromProps) {
          projectMgmtSvcRef = fromProps;
          return fromProps;
        }
        for (let dep = cur.dependencies && cur.dependencies.firstContext; dep; dep = dep.next) {
          const fromDep = pickSvc(dep.memoizedValue);
          if (fromDep) {
            projectMgmtSvcRef = fromDep;
            return fromDep;
          }
        }
      }
    }
    return null;
  }

  function getRawNativeProjectRecord(projectId, svc) {
    const pm = svc || resolveProjectManagementService();
    if (pm && typeof pm.getProjectStateProvider === 'function') {
      try {
        const prov = pm.getProjectStateProvider(projectId);
        const st = prov && typeof prov.getState === 'function' ? prov.getState() : null;
        if (st && st.project && typeof st.project === 'object') return st.project;
      } catch {}
    }
    if (pm && pm.projectsStateProvider && typeof pm.projectsStateProvider.getState === 'function') {
      try {
        const list = pm.projectsStateProvider.getState() || [];
        const hit = list.find((item) => item && item.project && item.project.id === projectId);
        if (hit && hit.project) return hit.project;
      } catch {}
    }
    return null;
  }

  const optimisticallyArchivedProjectIds = new Map(); // projectId -> ts

  async function renameNativeProject(project, nextName) {
    const trimmed = String(nextName || '').trim();
    if (!project || !project.id || project.isBuiltin || !trimmed) return { ok: false, error: 'invalid_name' };
    const pm = resolveProjectManagementService();
    if (!pm || typeof pm.updateProject !== 'function') return { ok: false, error: 'service_unavailable' };
    const raw = getRawNativeProjectRecord(project.id, pm);
    if (!raw) return { ok: false, error: 'project_record_unavailable' };
    optimisticProjectNames.set(project.id, trimmed);
    if (projectsViewOpen) renderProjectsView();
    try {
      await pm.updateProject(Object.assign({}, raw, { name: trimmed }));
      if (!disposed) {
        if (projectsViewOpen) renderProjectsView();
        scheduleSidebarSync();
      }
      return { ok: true };
    } catch (err) {
      optimisticProjectNames.delete(project.id);
      if (!disposed && projectsViewOpen) renderProjectsView();
      return { ok: false, error: String((err && err.message) || err || 'rename_failed') };
    }
  }

  async function archiveNativeProject(project) {
    if (!project || !project.id || project.isBuiltin) return false;
    const pm = resolveProjectManagementService();
    if (!pm || typeof pm.updateProject !== 'function') return false;
    const raw = getRawNativeProjectRecord(project.id, pm);
    if (!raw) return false;
    optimisticallyArchivedProjectIds.set(project.id, Date.now());
    if (activeProjectId === project.id) {
      activeProjectId = null;
      projectSelectedFolderPath = '';
    }
    if (projectsViewOpen) renderProjectsView();
    try {
      await pm.updateProject(Object.assign({}, raw, { archived: true }));
      if (!disposed) {
        if (projectsViewOpen) renderProjectsView();
        scheduleSidebarSync();
      }
      return true;
    } catch {
      optimisticallyArchivedProjectIds.delete(project.id);
      if (!disposed && projectsViewOpen) renderProjectsView();
      return false;
    }
  }

  async function deleteNativeProject(project) {
    if (!project || !project.id || project.isBuiltin) return false;
    const pm = resolveProjectManagementService();
    if (!pm || typeof pm.deleteProject !== 'function') return false;
    const { bindings } = resolveProjectsStoreAndBindings();
    optimisticallyDeletedProjectIds.add(project.id);
    optimisticProjectNames.delete(project.id);
    projectComposerDrafts.delete(project.id);
    if (activeProjectId === project.id) {
      activeProjectId = null;
      projectFolderDropdownOpen = false;
      projectFolderSearch = '';
      projectSelectedFolderPath = '';
    }
    if (projectsViewOpen) renderProjectsView();
    try {
      await pm.deleteProject(project.id);
      const router = bindings && bindings.router;
      const loc = router && router.state && router.state.location;
      if (router && typeof router.navigate === 'function' && loc && loc.search && loc.search.project === project.id) {
        try {
          router.navigate({
            to: loc.pathname || '/',
            search: (prev) => {
              const next = Object.assign({}, prev || {});
              delete next.project;
              return next;
            },
            replace: true
          });
        } catch {}
      }
      if (!disposed) {
        if (projectsViewOpen) renderProjectsView();
        scheduleSidebarSync();
      }
      return true;
    } catch {
      optimisticallyDeletedProjectIds.delete(project.id);
      if (!disposed && projectsViewOpen) renderProjectsView();
      return false;
    }
  }

  function openNativeProjectSettings(project) {
    if (!project || !project.id || project.isBuiltin) return;
    const { bindings } = resolveProjectsStoreAndBindings();
    const router = bindings && bindings.router;
    if (router && typeof router.navigate === 'function') {
      try {
        router.navigate({
          search: (prev) =>
            Object.assign({}, prev || {}, {
              settingsOpen: 'true',
              settingsProjectId: project.id
            })
        });
        return;
      } catch {}
    }
    const settingsBtn = document.querySelector('[data-testid="settings-button"]');
    if (settingsBtn) settingsBtn.click();
  }

  function closeProjectActionMenu() {
    projectMenuState = null;
    const menu = document.getElementById('ag-project-action-menu');
    if (menu) menu.remove();
    document.querySelectorAll('[data-ag-proj-menu][data-menu-open], [data-ag-pd-proj-menu][data-menu-open]').forEach((b) => {
      b.removeAttribute('data-menu-open');
    });
    if (projectMenuDocBound) {
      document.removeEventListener('mousedown', onProjectMenuDocDown, true);
      window.removeEventListener('resize', closeProjectActionMenu);
      projectMenuDocBound = false;
    }
  }

  function onProjectMenuDocDown(ev) {
    const t = ev && ev.target;
    if (t && t.closest && t.closest('#ag-project-action-menu, [data-ag-proj-menu], [data-ag-pd-proj-menu]')) return;
    closeProjectActionMenu();
  }

  function renderProjectActionMenu() {
    const st = projectMenuState;
    if (!st || !st.project) {
      closeProjectActionMenu();
      return;
    }
    let menu = document.getElementById('ag-project-action-menu');
    if (!menu) {
      menu = document.createElement('div');
      menu.id = 'ag-project-action-menu';
      menu.setAttribute('role', 'menu');
      menu.setAttribute('data-ag-i18n-ignore', '1');
      menu.addEventListener('click', (ev) => {
        const btn = ev.target && ev.target.closest && ev.target.closest('[data-ag-pm-act]');
        if (!btn || !projectMenuState) return;
        ev.preventDefault();
        ev.stopPropagation();
        const act = btn.getAttribute('data-ag-pm-act');
        const cur = projectMenuState;
        const proj = cur.project;
        if (act === 'rename') {
          closeProjectActionMenu();
          openRenameProjectModal(proj);
          return;
        }
        if (act === 'reveal') {
          closeProjectActionMenu();
          if (proj.dirPath && typeof window.__agProjectCall === 'function') {
            window.__agProjectCall('revealFile', { dirPath: proj.dirPath, targetPath: proj.dirPath }, 8000);
          }
          return;
        }
        if (act === 'settings') {
          closeProjectActionMenu();
          openNativeProjectSettings(proj);
          return;
        }
        if (act === 'archive') {
          closeProjectActionMenu();
          archiveNativeProject(proj);
          return;
        }
        if (act === 'delete') {
          if (!cur.confirmDelete) {
            cur.confirmDelete = true;
            renderProjectActionMenu();
            return;
          }
          closeProjectActionMenu();
          deleteNativeProject(proj);
        }
      });
      document.body.appendChild(menu);
    }

    const proj = st.project;
    const pm = resolveProjectManagementService();
    const canUpdate = Boolean(!proj.isBuiltin && pm && typeof pm.updateProject === 'function');
    const canDelete = Boolean(!proj.isBuiltin && pm && typeof pm.deleteProject === 'function');
    const canReveal = Boolean(proj.dirPath && typeof window.__agProjectCall === 'function');
    const revealLabel = /Win/i.test((navigator && navigator.platform) || '')
      ? L('在资源管理器中显示', 'Show in Explorer')
      : L('在访达中显示', 'Reveal in Finder');
    const delLabel = st.confirmDelete
      ? L('确认删除？（保留本地文件）', 'Confirm delete? (keeps files)')
      : L('删除项目', 'Delete project');

    let itemsHtml = '';
    itemsHtml += `<button type="button" class="ag-rm-item" data-ag-pm-act="rename"${canUpdate ? '' : ' disabled'}>${RECENT_RENAME_SVG}<span class="ag-rm-label">${escapeHtml(L('重命名项目', 'Rename project'))}</span></button>`;
    if (proj.dirPath) {
      itemsHtml += `<button type="button" class="ag-rm-item" data-ag-pm-act="reveal"${canReveal ? '' : ' disabled'}>${RECENT_FOLDER_SVG}<span class="ag-rm-label">${escapeHtml(revealLabel)}</span></button>`;
    }
    itemsHtml += `<button type="button" class="ag-rm-item" data-ag-pm-act="settings"${!proj.isBuiltin ? '' : ' disabled'}>${SVG_PROJ_SETTINGS}<span class="ag-rm-label">${escapeHtml(L('项目权限设置', 'Project settings'))}</span></button>`;
    if (canUpdate && getRawNativeProjectRecord(proj.id, pm)) {
      itemsHtml += `<button type="button" class="ag-rm-item" data-ag-pm-act="archive">${RECENT_ARCHIVE_SVG}<span class="ag-rm-label">${escapeHtml(L('归档项目', 'Archive project'))}</span></button>`;
    }
    itemsHtml += `<div class="ag-rm-sep"></div>`;
    itemsHtml += `<button type="button" class="ag-rm-item ag-rm-danger" data-ag-pm-act="delete" data-confirm="${st.confirmDelete ? '1' : '0'}"${canDelete ? '' : ' disabled'}>${RECENT_TRASH_SVG}<span class="ag-rm-label">${escapeHtml(delLabel)}</span></button>`;

    menu.innerHTML = itemsHtml;

    const menuW = 216;
    const menuH = Math.max(140, menu.offsetHeight || 168);
    const vw = window.innerWidth || 1200;
    const vh = window.innerHeight || 800;
    const left = Math.min(Math.max(8, st.x), Math.max(8, vw - menuW - 8));
    const top = st.y + menuH > vh - 8 ? Math.max(8, st.y - menuH) : Math.max(8, st.y);
    menu.style.left = `${Math.round(left)}px`;
    menu.style.top = `${Math.round(top)}px`;

    if (!projectMenuDocBound) {
      document.addEventListener('mousedown', onProjectMenuDocDown, true);
      window.addEventListener('resize', closeProjectActionMenu);
      projectMenuDocBound = true;
    }
  }

  function openProjectActionMenu(project, x, y, triggerBtn = null) {
    if (!project || !project.id || project.isBuiltin) return;
    closeRecentRowMenu();
    if (projectMenuState && projectMenuState.project && projectMenuState.project.id === project.id && triggerBtn) {
      closeProjectActionMenu();
      return;
    }
    closeProjectActionMenu();
    if (triggerBtn) triggerBtn.setAttribute('data-menu-open', 'true');
    projectMenuState = { project, x, y, confirmDelete: false };
    renderProjectActionMenu();
  }

  function openRenameProjectModal(project) {
    if (!project || !project.id || project.isBuiltin) return;
    closeProjectsModal();
    projectsModalState = {
      kind: 'renameProject',
      project,
      name: project.name || '',
      saving: false,
      error: ''
    };
    renderRenameProjectModal();
  }

  function renderRenameProjectModal() {
    if (!projectsModalState || projectsModalState.kind !== 'renameProject') return;
    if (!projectsModalEl || !projectsModalEl.isConnected) {
      projectsModalEl = document.createElement('div');
      projectsModalEl.id = 'ag-claude-project-modal';
      projectsModalEl.setAttribute('data-ag-i18n-ignore', '1');
      projectsModalEl.addEventListener('click', (e) => {
        if (e.target === projectsModalEl) closeProjectsModal();
      });
      document.body.appendChild(projectsModalEl);
    }
    const st = projectsModalState;
    const errHtml = st.error ? `<div class="ag-pm-error">${escapeHtml(st.error)}</div>` : '';
    projectsModalEl.innerHTML = `
      <div class="ag-pm-dialog" role="dialog" aria-modal="true" aria-label="${escapeHtml(L('重命名项目', 'Rename project'))}">
        <div class="ag-pm-hdr">
          <div class="ag-pm-title-wrap">
            <span class="ag-pm-icon">${SVG_CLAUDE_PROJECTS_ICON}</span>
            <h2 class="ag-pm-title">${escapeHtml(L('重命名项目', 'Rename project'))}</h2>
          </div>
          <button type="button" class="ag-pm-close" data-ag-pm-close="true" aria-label="${escapeHtml(L('关闭', 'Close'))}">×</button>
        </div>
        <div class="ag-pm-field">
          <input id="ag-pm-rename-input" class="ag-pm-input" type="text" value="${escapeHtml(st.name)}" placeholder="${escapeHtml(L('输入项目名称…', 'Enter project name…'))}" />
        </div>
        ${errHtml}
        <div class="ag-pm-footer">
          <button type="button" class="ag-pm-secondary-btn" data-ag-pm-close="true">${L('取消', 'Cancel')}</button>
          <button type="button" class="ag-pm-primary-btn" data-ag-pm-rename-save="true" ${st.saving || !String(st.name || '').trim() ? 'disabled' : ''}>${
            st.saving ? L('保存中…', 'Saving…') : L('保存', 'Save')
          }</button>
        </div>
      </div>
    `;
    const input = projectsModalEl.querySelector('#ag-pm-rename-input');
    const saveBtn = projectsModalEl.querySelector('[data-ag-pm-rename-save]');
    const doSubmit = async () => {
      const modalRef = projectsModalState;
      if (!modalRef || modalRef.kind !== 'renameProject' || modalRef.saving) return;
      const nextName = String(modalRef.name || '').trim();
      if (!nextName) return;
      if (nextName === st.project.name) {
        closeProjectsModal();
        return;
      }
      modalRef.saving = true;
      modalRef.error = '';
      renderRenameProjectModal();
      const res = await renameNativeProject(st.project, nextName);
      if (disposed || projectsModalState !== modalRef) return;
      if (res && res.ok) {
        closeProjectsModal();
      } else {
        modalRef.saving = false;
        modalRef.error = L('重命名失败：', 'Rename failed: ') + String((res && res.error) || 'unknown');
        renderRenameProjectModal();
      }
    };
    if (input) {
      input.focus();
      try {
        input.select();
      } catch {}
      input.addEventListener('input', () => {
        if (!projectsModalState || projectsModalState.kind !== 'renameProject') return;
        projectsModalState.name = input.value;
        if (saveBtn) saveBtn.disabled = !input.value.trim();
      });
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          doSubmit();
        }
      });
    }
    projectsModalEl.querySelectorAll('[data-ag-pm-close]').forEach((b) => {
      b.addEventListener('click', () => closeProjectsModal());
    });
    if (saveBtn) {
      saveBtn.addEventListener('click', () => doSubmit());
    }
  }

  function collectNativeProjects() {
    const { store } = resolveProjectsStoreAndBindings();
    const state = store ? store.getState() : null;
    const rawProjects = (state && state.sidebarProjects && state.sidebarProjects.projects) || [];
    const presentRawIds = new Set();
    const out = [];
    const nowArchMs = Date.now();
    for (const p of rawProjects) {
      if (!p || !p.id) continue;
      presentRawIds.add(p.id);
      if (p.archived) {
        /* Once Redux reflects archived: true, release optimistic archive mask so un-archiving reappears immediately */
        optimisticallyArchivedProjectIds.delete(p.id);
        continue;
      }
      const optArchTs = optimisticallyArchivedProjectIds.get(p.id);
      if (optArchTs !== undefined) {
        if (nowArchMs - optArchTs < 10000) continue;
        optimisticallyArchivedProjectIds.delete(p.id);
      }
      if (optimisticallyDeletedProjectIds.has(p.id)) continue;
      const rawName = String(p.name || '').trim();
      if (!rawName || rawName === 'swarm/swarm_board' || p.id === 'outside-of-project') continue;
      const isCliProject = p.id === 'default-cli-project';
      const uris = Array.isArray(p.folderUris) ? p.folderUris : [];
      const dirPath = uris.length ? decodeFileUriToPath(uris[0]) : '';
      const optName = optimisticProjectNames.get(p.id);
      if (optName && optName === rawName) optimisticProjectNames.delete(p.id);
      const name = isCliProject ? L('CLI 项目', 'CLI Project') : optName || rawName;
      const base = {
        id: p.id,
        name,
        dirPath,
        shortPath: formatShortHomePath(dirPath),
        isVirtual: !dirPath,
        isCliProject,
        isBuiltin: isCliProject
      };
      const chats = collectProjectConversations(base, state);
      out.push({
        ...base,
        chats,
        chatCount: chats.length,
        lastSec: chats.length ? chats[0].lastSec : 0
      });
    }
    for (const delId of [...optimisticallyDeletedProjectIds]) {
      if (!presentRawIds.has(delId)) optimisticallyDeletedProjectIds.delete(delId);
    }
    return out;
  }

  function positionProjectsOverlay() {
    if (!projectsViewEl || !projectsViewOpen) return;
    const sidebar = document.querySelector('.bg-sidebar');
    let leftPx = 0;
    if (sidebar) {
      const r = sidebar.getBoundingClientRect();
      if (r.width > 20 && r.right > 0 && r.right < window.innerWidth - 160) {
        leftPx = Math.round(r.right);
      }
    }
    const collapsed = leftPx < 220;
    const safeLeftPad = collapsed ? Math.max(24, 224 - leftPx) : 24;
    projectsViewEl.style.left = `${leftPx}px`;
    projectsViewEl.setAttribute('data-sidebar-collapsed', collapsed ? 'true' : 'false');
    projectsViewEl.style.setProperty('--ag-proj-topbar-pl', `${safeLeftPad}px`);
  }

  function ensureProjectsSidebarObserver() {
    if (typeof ResizeObserver === 'undefined') return;
    const sb = document.querySelector('.bg-sidebar');
    if (!sb || projectsSidebarRoTarget === sb) return;
    if (projectsSidebarRo) {
      try {
        projectsSidebarRo.disconnect();
      } catch {}
    }
    projectsSidebarRoTarget = sb;
    projectsSidebarRo = new ResizeObserver(() => positionProjectsOverlay());
    try {
      projectsSidebarRo.observe(sb);
    } catch {}
  }

  function updateProjectsNavActiveVisual() {
    const btn = document.getElementById('ag-claude-projects-nav-btn');
    if (!btn) return;
    btn.setAttribute('data-active', projectsViewOpen ? 'true' : 'false');
    btn.setAttribute('aria-current', projectsViewOpen ? 'page' : 'false');
    const lbl = btn.querySelector('.ag-proj-nav-label');
    if (lbl) lbl.textContent = L('项目', 'Projects');
  }

  let projectsOpenedPathname = '';
  let sharedModalEscBound = false;

  function isCustomizationsModalKind(st) {
    return Boolean(st && (st.kind === 'addSkill' || st.kind === 'addAgent'));
  }

  function onSharedModalEscKeyDown(e) {
    if (disposed || e.key !== 'Escape' || e.isComposing || e.keyCode === 229) return;
    if (!projectsModalEl || !projectsModalEl.isConnected) return;
    if (projectsDocListenerBound) return; // handled by onProjectsGlobalKeyDown when Projects is enabled
    e.preventDefault();
    e.stopPropagation();
    closeProjectsModal();
  }

  function ensureSharedModalEscBound() {
    if (sharedModalEscBound) return;
    sharedModalEscBound = true;
    document.addEventListener('keydown', onSharedModalEscKeyDown, true);
  }

  function closeProjectsModal() {
    projectsModalState = null;
    if (projectsModalEl) {
      projectsModalEl.remove();
      projectsModalEl = null;
    }
  }

  function closeProjectsView(opts = {}) {
    clearNewProjectWatcher();
    closeProjectActionMenu();
    closePdMentionMenu();
    const keepCustModal = !opts.forceCloseAllModals && isCustomizationsModalKind(projectsModalState);
    if (!projectsViewOpen && (keepCustModal || !projectsModalEl)) return;
    if (!keepCustModal) closeProjectsModal();
    projectFolderDropdownOpen = false;
    projectFolderSearch = '';
    projectsViewOpen = false;
    projectsOpenedPathname = '';
    if (projectsViewEl) {
      projectsViewEl.setAttribute('data-open', 'false');
    }
    updateProjectsNavActiveVisual();
  }

  function isNativeModalDialogOpen() {
    const dialogs = document.querySelectorAll('[role="dialog"], .agy-dialog, [role="menu"], [role="listbox"], [data-popover-popup]');
    for (const el of dialogs) {
      if (
        !el ||
        !el.isConnected ||
        el.closest(
          '#ag-claude-project-modal, #ag-claude-projects-view, #ag-claude-model-popover, #ag-claude-model-subpop, #ag-claude-model-tripop, #ag-claude-quota-popover, #ag-recent-row-menu, #ag-project-action-menu'
        )
      ) {
        continue;
      }
      if (el.getAttribute('aria-hidden') === 'true' || el.hasAttribute('inert')) continue;
      try {
        const cs = window.getComputedStyle(el);
        if (cs && (cs.display === 'none' || cs.visibility === 'hidden' || cs.opacity === '0')) continue;
      } catch {}
      return true;
    }
    return false;
  }

  function onProjectsGlobalClick(e) {
    if (!projectsViewOpen) return;
    const t = e.target;
    if (!t || !t.closest) return;
    if (t.closest('[data-testid="sidebar-toggle"]')) {
      frame(() => {
        ensureProjectsSidebarObserver();
        positionProjectsOverlay();
      });
      later(() => {
        ensureProjectsSidebarObserver();
        positionProjectsOverlay();
      }, 160);
      later(() => {
        ensureProjectsSidebarObserver();
        positionProjectsOverlay();
      }, 320);
      return;
    }
    if (pdMentionState.open && !t.closest('.ag-pd-composer-anchor, #ag-pd-mention-popover')) {
      closePdMentionMenu();
    }
    if (projectFolderDropdownOpen && !t.closest('[data-ag-pd-folder-menu], [data-ag-pd-folder-toggle]')) {
      projectFolderDropdownOpen = false;
      projectFolderSearch = '';
      if (projectsViewEl) {
        const openMenu = projectsViewEl.querySelector('[data-ag-pd-folder-menu]');
        if (openMenu) openMenu.remove();
        const toggleBtn = projectsViewEl.querySelector('[data-ag-pd-folder-toggle]');
        if (toggleBtn) toggleBtn.setAttribute('data-open', 'false');
      }
    }
    if (
      t.closest(
        '#ag-claude-projects-nav-btn, #ag-claude-projects-view, #ag-claude-project-modal, #ag-claude-model-popover, #ag-claude-model-subpop, #ag-claude-model-tripop, #ag-recent-row-menu, #ag-project-action-menu, .agy-dialog, [role="dialog"]'
      )
    ) {
      return;
    }
    if (
      t.closest(
        'a[href="/"], [data-testid="new-conversation-button"], [data-testid="automations-button"], a[href="/customizations"], [data-testid="settings-button"], [data-testid="conversation-row-sidebar"], #ag-claude-recent-section [data-ag-recent-new]'
      ) ||
      (t.closest('#ag-claude-recent-section .ag-recent-row') &&
        !t.closest('[data-ag-recent-pin], [data-ag-recent-menu], [data-ag-recent-rename-input]'))
    ) {
      closeProjectsView();
    }
  }

  function onProjectsGlobalKeyDown(e) {
    if (e.key !== 'Escape' || e.isComposing || e.keyCode === 229) return;
    /* Let sidebar inline rename, recent row menu, model/quota popovers handle Escape first */
    if (
      (e.target && e.target.closest && e.target.closest('[data-ag-recent-rename-input]')) ||
      document.getElementById('ag-recent-row-menu') ||
      modelPopoverOpen ||
      quotaPopoverOpen
    ) {
      return;
    }
    if (pdMentionState.open) {
      e.preventDefault();
      e.stopPropagation();
      closePdMentionMenu();
    } else if (projectMenuState) {
      e.preventDefault();
      e.stopPropagation();
      closeProjectActionMenu();
    } else if (projectsModalEl && projectsModalEl.isConnected) {
      e.preventDefault();
      e.stopPropagation();
      closeProjectsModal();
    } else if (isNativeModalDialogOpen()) {
      return;
    } else if (projectFolderDropdownOpen) {
      e.preventDefault();
      e.stopPropagation();
      projectFolderDropdownOpen = false;
      projectFolderSearch = '';
      renderProjectsView();
    } else if (projectsViewOpen && activeProjectId) {
      e.preventDefault();
      e.stopPropagation();
      activeProjectId = null;
      projectSelectedFolderPath = '';
      renderProjectsView();
    } else if (projectsViewOpen) {
      e.preventDefault();
      e.stopPropagation();
      closeProjectsView();
    }
  }

  function findNativeNewProjectEntryAction(addBtn) {
    if (!addBtn) return null;
    let f = activeReactFiber(addBtn);
    for (let d = 0; f && d < 24; d++, f = f.return) {
      for (let h = f.memoizedState; h; h = h.next) {
        const ms = h.memoizedState;
        const list = Array.isArray(ms) && Array.isArray(ms[0]) ? ms[0] : Array.isArray(ms) ? ms : null;
        if (!list || !list.length) continue;
        for (const it of list) {
          if (!it || typeof it !== 'object' || it.disabled || typeof it.onClick !== 'function') continue;
          const lbl = String(it.label || it.title || '').trim();
          if (
            it.type === 'NEW_PROJECT' ||
            /^(new project|create(?: new)? project|新建项目)$/i.test(lbl)
          ) {
            return () => it.onClick();
          }
        }
      }
    }
    return null;
  }

  function armNewProjectCompletionWatcher(store, bindings) {
    clearNewProjectWatcher();
    if (!projectsViewOpen || !store || typeof store.subscribe !== 'function' || typeof store.getState !== 'function') {
      return;
    }
    const beforeIds = new Set(collectNativeProjects().map((p) => p.id));
    const readSearchProj = () => {
      const loc = bindings && bindings.router && bindings.router.state && bindings.router.state.location;
      return (loc && loc.search && loc.search.project) || '';
    };
    const beforeSearchProj = readSearchProj();
    let sawDialogOpen = false;
    let closeGraceTimer = 0;
    let lastWatchSig = '';

    const focusProjectInOverlay = (proj) => {
      clearNewProjectWatcher();
      if (disposed || !projectsViewOpen || !proj) return;
      activeProjectId = proj.id;
      projectSelectedFolderPath = proj.dirPath || '';
      renderProjectsView();
      refreshProjectsContexts([proj]);
    };

    const unsub = store.subscribe(() => {
      if (disposed || !projectsViewOpen) {
        clearNewProjectWatcher();
        return;
      }
      const st = store.getState();
      const rawList = (st && st.sidebarProjects && st.sidebarProjects.projects) || [];
      const isOpen = Boolean((st && st.newProject && st.newProject.isOpen) || isNativeModalDialogOpen());
      const nextSearchProj = readSearchProj();
      const watchSig = `${isOpen ? 1 : 0}|${nextSearchProj}|${rawList.length}|${rawList.map((p) => (p && p.id) || '').join(',')}`;
      if (watchSig === lastWatchSig) return;
      lastWatchSig = watchSig;

      if (isOpen) {
        sawDialogOpen = true;
        if (closeGraceTimer) {
          clearTimeout(closeGraceTimer);
          closeGraceTimer = 0;
        }
      }
      const curProjects = collectNativeProjects();
      const created = curProjects.find((p) => p.id && !beforeIds.has(p.id));
      if (created) {
        focusProjectInOverlay(created);
        return;
      }
      if (sawDialogOpen && !isOpen && nextSearchProj && nextSearchProj !== beforeSearchProj) {
        const selectedExisting = curProjects.find((p) => p.id === nextSearchProj);
        if (selectedExisting) {
          focusProjectInOverlay(selectedExisting);
          return;
        }
      }
      if (sawDialogOpen && !isOpen && !closeGraceTimer) {
        closeGraceTimer = later(() => {
          clearNewProjectWatcher();
        }, 2500);
      }
    });

    const maxTimer = later(() => {
      clearNewProjectWatcher();
    }, 60000);

    newProjectWatchCleanup = () => {
      if (closeGraceTimer) {
        clearTimeout(closeGraceTimer);
        closeGraceTimer = 0;
      }
      if (maxTimer) clearTimeout(maxTimer);
      if (typeof unsub === 'function') unsub();
    };
  }

  function triggerNativeNewProject() {
    const addBtn = document.querySelector('[data-testid="sidebar-add-project-button"]');
    const { store, bindings } = resolveProjectsStoreAndBindings();
    const directEntryAction = findNativeNewProjectEntryAction(addBtn);
    const st = store && typeof store.getState === 'function' ? store.getState() : null;
    const hasNewProjectSlice = Boolean(
      st && st.newProject && typeof st.newProject === 'object' && store && typeof store.dispatch === 'function'
    );

    if (directEntryAction) {
      armNewProjectCompletionWatcher(store, bindings);
      directEntryAction();
      return;
    }

    if (hasNewProjectSlice) {
      armNewProjectCompletionWatcher(store, bindings);
      store.dispatch({ type: 'newProject/reset' });
      store.dispatch({ type: 'newProject/setStep', payload: 'folderSelection' });
      store.dispatch({ type: 'newProject/setIsOpen', payload: true });
      return;
    }

    if (!addBtn) return;

    const isMultiMenuTrigger =
      addBtn.hasAttribute('data-base-ui-click-trigger') ||
      addBtn.getAttribute('aria-haspopup') === 'dialog' ||
      addBtn.getAttribute('aria-haspopup') === 'menu';

    if (isMultiMenuTrigger) {
      armNewProjectCompletionWatcher(store, bindings);
      addBtn.click();
      later(() => {
        if (disposed) return;
        const popups = document.querySelectorAll('[data-popover-popup], [role="menu"], [role="dialog"]');
        for (const pop of popups) {
          if (!pop || pop.closest('#ag-claude-project-modal, #ag-claude-projects-view, .agy-dialog')) continue;
          const items = pop.querySelectorAll('button, [role="menuitem"], [role="option"], .main-row-trigger');
          for (const item of items) {
            const txt = String(item.textContent || '').trim();
            if (/^(new project|create(?: new)? project|新建项目)$/i.test(txt)) {
              item.click();
              return;
            }
          }
        }
      }, 24);
      return;
    }

    closeProjectsView();
    addBtn.click();
  }

  function openConversationFromProject(cid) {
    const { bindings } = resolveProjectsStoreAndBindings();
    closeProjectsView();
    if (cid) navigateSidebarConversation(cid, bindings);
  }

  function buildFallbackMediaObjects(mediaList) {
    const zeroTs = typeof BigInt === 'function' ? BigInt(0) : 0;
    return mediaList.map((m) => ({
      $typeName: 'exa.codeium_common_pb.Media',
      mimeType: m.mimeType || 'image/png',
      description: m.name || 'pasted-image.png',
      payload: { case: 'inlineData', value: m.bytes || new Uint8Array(0) },
      uri: '',
      thumbnail: m.bytes || new Uint8Array(0),
      durationSeconds: 0,
      mediaId: '',
      displayName: '',
      startTimeMs: zeroTs,
      endTimeMs: zeroTs,
      fps: 0,
      mediaResolution: 0,
      contentLayers: [],
      documentContentLayers: [],
      visibleCells: '',
      spreadsheetContentLayers: []
    }));
  }

  function showProjectsFloatingNotice(msg) {
    if (disposed || !document.body || !msg) return;
    const old = document.getElementById('ag-projects-float-toast');
    if (old) old.remove();
    const toast = document.createElement('div');
    toast.id = 'ag-projects-float-toast';
    toast.setAttribute('role', 'status');
    toast.setAttribute('data-ag-i18n-ignore', '1');
    toast.style.cssText =
      'position:fixed;bottom:24px;right:24px;z-index:2147483000;max-width:360px;padding:10px 14px;border-radius:10px;background:rgba(30,30,30,0.92);color:#fff;font-size:13px;line-height:1.4;box-shadow:0 8px 24px rgba(0,0,0,0.28);pointer-events:none;';
    toast.textContent = msg;
    document.body.appendChild(toast);
    later(() => {
      if (toast.isConnected) toast.remove();
    }, 4500);
  }

  function startNewChatInProject(project, initialPrompt = '', mentionEntries = [], mediaEntries = [], rollbackDraft = null) {
    const { store, bindings } = resolveProjectsStoreAndBindings();
    const prompt = String(initialPrompt || '').trim();
    const submitChunks = buildComposerSubmitChunks(prompt, mentionEntries);
    const mediaList = Array.isArray(mediaEntries) ? mediaEntries.filter(Boolean) : [];
    const prevInputBox = document.getElementById('antigravity.agentSidePanelInputBox');
    const prevPath =
      bindings && bindings.router && bindings.router.state && bindings.router.state.location
        ? bindings.router.state.location.pathname
        : '';
    const wasOnHome = prevPath === '/';

    const restoreComposerDraftOnFailure = () => {
      if (!rollbackDraft || !project || !project.id) return;
      if (rollbackDraft.raw) projectComposerDrafts.set(project.id, rollbackDraft.raw);
      if (Array.isArray(rollbackDraft.mediaArr) && rollbackDraft.mediaArr.length) {
        projectComposerMedia.set(project.id, rollbackDraft.mediaArr.slice());
      }
      if (Array.isArray(rollbackDraft.mentionEntries) && rollbackDraft.mentionEntries.length) {
        const mMap = getProjectMentionMap(project.id, true);
        for (const en of rollbackDraft.mentionEntries) {
          if (en && en.token) mMap.set(en.token, en);
        }
      }
      showProjectsFloatingNotice(
        L('未能找到主输入框，消息与附件已保留在项目草稿中，请重试。', 'Composer unavailable — your draft and attachments were preserved.')
      );
    };

    if (store && typeof store.dispatch === 'function' && project && project.id) {
      try {
        store.dispatch({ type: 'newConvoResourceSelector/setMagicWorkspaceSelected', payload: false });
        store.dispatch({ type: 'newConvoResourceSelector/setPseudoProjectSelected', payload: false });
        store.dispatch({ type: 'newConvoResourceSelector/setLastSelectedProject', payload: project.id });
      } catch {}
    }
    if (modelPopoverOpen) closeClaudeModelPopover();
    closeProjectsView();
    if (bindings && bindings.router && typeof bindings.router.navigate === 'function') {
      try {
        bindings.router.navigate({
          to: '/',
          search: project && project.id ? { project: project.id } : {}
        });
      } catch {}
    } else {
      const newBtn = document.querySelector('[data-testid="new-conversation-button"]');
      if (newBtn) newBtn.click();
    }

    if (!submitChunks.length && !mediaList.length) return;
    let tries = 0;
    let landedAtTry = -1;
    let submitting = false;
    const trySubmit = () => {
      if (disposed || submitting) return;
      const loc = bindings && bindings.router && bindings.router.state && bindings.router.state.location;
      const atHome = !loc || loc.pathname === '/';
      const projectMatched = !loc || !project || !project.id || (loc.search && loc.search.project === project.id);
      const box = document.getElementById('antigravity.agentSidePanelInputBox');
      const readyDom = Boolean(box && (wasOnHome || box !== prevInputBox || tries >= 16));
      if (!atHome || !projectMatched || !readyDom) {
        if (++tries < 35) later(trySubmit, 70);
        else restoreComposerDraftOnFailure();
        return;
      }
      /* Give the newly mounted Home composer one extra tick so its project & workspace hooks settle */
      if (landedAtTry === -1) {
        landedAtTry = tries;
        later(trySubmit, 140);
        return;
      }
      let handleSubmit = null;
      let inputBoxRef = null;
      let f = activeReactFiber(box);
      for (let d = 0; f && d < 36 && (!handleSubmit || !inputBoxRef); d++, f = f.return) {
        const mp = f.memoizedProps;
        if (!handleSubmit && mp && typeof mp.handleSubmit === 'function') {
          handleSubmit = mp.handleSubmit;
        }
        if (!inputBoxRef && mp && mp.inputBoxRef && mp.inputBoxRef.current) {
          inputBoxRef = mp.inputBoxRef.current;
        }
      }
      if (handleSubmit) {
        submitting = true;
        (async () => {
          let resolvedMedia = [];
          if (mediaList.length) {
            if (
              inputBoxRef &&
              typeof inputBoxRef.attachFiles === 'function' &&
              typeof inputBoxRef.getMediaAttachments === 'function'
            ) {
              try {
                if (typeof inputBoxRef.setMediaAttachments === 'function') {
                  inputBoxRef.setMediaAttachments([]);
                }
                const filesToAttach = mediaList.map((m) =>
                  typeof File === 'function' && !(m.file instanceof File)
                    ? new File([m.bytes || new Uint8Array(0)], m.name || 'pasted-image.png', {
                        type: m.mimeType || 'image/png'
                      })
                    : m.file
                );
                await inputBoxRef.attachFiles(filesToAttach);
                const deadline = Date.now() + 1500;
                while (Date.now() < deadline) {
                  const curAtt = inputBoxRef.getMediaAttachments() || [];
                  if (curAtt.length >= filesToAttach.length && curAtt.every((a) => Boolean(a && a.uri))) {
                    break;
                  }
                  await new Promise((r) => setTimeout(r, 40));
                }
                resolvedMedia = (inputBoxRef.getMediaAttachments() || []).slice();
              } catch {}
            }
            if (!resolvedMedia.length) {
              resolvedMedia = buildFallbackMediaObjects(mediaList);
            }
          }
          const clearEditor = () => {
            if (inputBoxRef && typeof inputBoxRef.setMediaAttachments === 'function') {
              try {
                inputBoxRef.setMediaAttachments([]);
                if (typeof inputBoxRef.forgetTrackedUploads === 'function') {
                  inputBoxRef.forgetTrackedUploads();
                }
              } catch {}
            }
          };
          try {
            await handleSubmit(submitChunks, resolvedMedia, clearEditor);
          } catch {
            restoreComposerDraftOnFailure();
          } finally {
            if (mediaList.length) clearEditor();
          }
        })();
        return;
      }
      if (++tries < 35) later(trySubmit, 70);
      else restoreComposerDraftOnFailure();
    };
    later(trySubmit, 110);
  }

  const projectsContextQueueByDir = new Map();

  async function saveProjectContextDelta(project, mutator) {
    if (!project || !project.dirPath || typeof window.__agProjectCall !== 'function') {
      return { ok: false, error: 'unavailable' };
    }
    const dirKey = project.dirPath;
    const prevTail = projectsContextQueueByDir.get(dirKey) || Promise.resolve();
    const runTask = async () => {
      if (disposed) return { ok: false, error: 'disposed' };
      projectsContextBusy = true;
      try {
        let cur = projectsContextMap[dirKey];
        if (!cur || !cur.ok) {
          cur = await window.__agProjectCall('readContext', { dirPath: dirKey }, 8000);
        }
        /* Never submit a full replacement save if current context failed to load (prevents wiping attachments/instructions) */
        if (!cur || !cur.ok) {
          const errMsg = (cur && cur.error) || 'context_read_failed';
          showProjectsFloatingNotice(
            L(`读取项目上下文失败（${errMsg}），已中止保存以防丢失现有文件。`, `Failed to load project context (${errMsg}); save aborted to protect existing files.`)
          );
          return { ok: false, error: errMsg };
        }
        const existingFiles = (Array.isArray(cur.files) ? cur.files : []).map((f) => ({
          action: 'keep',
          relPath: f.relPath,
          name: f.name,
          absPath: f.absPath
        }));
        const existingFolders = (Array.isArray(cur.extraFolders) ? cur.extraFolders : []).map((f) => ({
          name: f.name,
          absPath: f.absPath
        }));
        const draft = {
          instructions: cur.instructions || '',
          files: existingFiles,
          extraFolders: existingFolders
        };
        const updated =
          typeof mutator === 'function'
            ? mutator(draft)
            : mutator && typeof mutator === 'object'
              ? Object.assign({}, draft, mutator)
              : null;
        if (!updated) return { ok: true, skipped: true };
        const saved = await window.__agProjectCall(
          'saveContext',
          {
            dirPath: dirKey,
            instructions: updated.instructions,
            files: updated.files.map((x) =>
              x.action === 'keep'
                ? { action: 'keep', relPath: x.relPath, name: x.name }
                : x.action === 'add'
                  ? { action: 'add', sourcePath: x.sourcePath, name: x.name }
                  : { action: 'addContent', name: x.name, base64: x.base64 }
            ),
            extraFolders: updated.extraFolders
          },
          30000
        );
        if (!disposed && saved && saved.ok) {
          projectsContextMap[dirKey] = saved;
          if (projectsViewOpen) renderProjectsView();
          invalidateOverviewSnapshotCache();
        }
        return saved || { ok: false, error: 'save_failed' };
      } finally {
        projectsContextBusy = false;
      }
    };
    const nextPromise = prevTail.catch(() => {}).then(runTask);
    projectsContextQueueByDir.set(dirKey, nextPromise);
    nextPromise.finally(() => {
      if (projectsContextQueueByDir.get(dirKey) === nextPromise) {
        projectsContextQueueByDir.delete(dirKey);
      }
    });
    return nextPromise;
  }

  async function saveFilesDeltaForProject(project, mutator) {
    return saveProjectContextDelta(project, (draft) => {
      const nextFiles = mutator(draft.files);
      if (!nextFiles) return null;
      return Object.assign({}, draft, { files: nextFiles });
    });
  }

  async function pickAndAddFolderToProject(project) {
    if (!project || !project.dirPath || typeof window.__agProjectCall !== 'function') return;
    const picked = await window.__agProjectCall('pickFolder', {}, 120000);
    if (disposed || !picked || !picked.ok || picked.canceled || !picked.folderPath) return;
    const fp = picked.folderPath;
    if (fp === project.dirPath) {
      projectSelectedFolderPath = fp;
      projectFolderDropdownOpen = false;
      if (projectsViewOpen) renderProjectsView();
      return;
    }
    await saveProjectContextDelta(project, (draft) => {
      const next = draft.extraFolders.slice();
      if (!next.some((f) => f.absPath === fp)) {
        next.push({ name: picked.name || fp.split(/[\\/]/).pop() || fp, absPath: fp });
      }
      return Object.assign({}, draft, { extraFolders: next });
    });
    projectSelectedFolderPath = fp;
    projectFolderDropdownOpen = false;
    if (projectsViewOpen) renderProjectsView();
  }

  async function removeExtraFolderFromProject(project, absPath) {
    if (!project || !absPath) return;
    if (projectSelectedFolderPath === absPath) projectSelectedFolderPath = project.dirPath;
    await saveProjectContextDelta(project, (draft) =>
      Object.assign({}, draft, { extraFolders: draft.extraFolders.filter((f) => f.absPath !== absPath) })
    );
  }

  function openInstantNativeFilePicker(project) {
    if (!project || !project.dirPath || !document.body) return;
    const input = document.createElement('input');
    input.type = 'file';
    input.multiple = true;
    input.style.cssText = 'position:fixed;left:-9999px;top:0;opacity:0;pointer-events:none';
    document.body.appendChild(input);
    const cleanup = () => {
      try {
        input.remove();
      } catch {}
    };
    input.addEventListener(
      'change',
      () => {
        const files = input.files;
        cleanup();
        if (!disposed && files && files.length) {
          addDroppedFilesToProject(project, files);
        }
      },
      { once: true }
    );
    input.addEventListener('cancel', cleanup, { once: true });
    input.click();
  }

  async function pickAndAddFilesToProject(project) {
    if (!project || !project.dirPath) return;
    const en = window.electronNative;
    if (en && typeof en.getPathForFile === 'function') {
      openInstantNativeFilePicker(project);
      return;
    }
    if (typeof window.__agProjectCall === 'function') {
      const picked = await window.__agProjectCall('pickFiles', {}, 120000);
      if (disposed) return;
      if (picked && picked.ok) {
        if (!Array.isArray(picked.paths) || !picked.paths.length) return;
        await saveFilesDeltaForProject(project, (ops) => {
          const next = ops.slice();
          for (const p of picked.paths) {
            if (!next.some((x) => x.absPath === p || x.sourcePath === p)) {
              next.push({ action: 'add', sourcePath: p, name: p.split(/[\\/]/).pop() || p });
            }
          }
          return next;
        });
        return;
      }
    }
    openInstantNativeFilePicker(project);
  }

  async function addDroppedFilesToProject(project, fileList) {
    if (!project || !project.dirPath || !fileList || !fileList.length) return;
    const en = window.electronNative;
    const additions = [];
    for (const f of Array.from(fileList)) {
      if (!f) continue;
      let realPath = '';
      if (en && typeof en.getPathForFile === 'function') {
        try {
          realPath = en.getPathForFile(f) || '';
        } catch {}
      }
      if (!realPath && typeof f.path === 'string' && f.path) realPath = f.path;
      if (realPath) {
        additions.push({ action: 'add', sourcePath: realPath, name: f.name || realPath.split(/[\\/]/).pop() });
      } else if (typeof FileReader !== 'undefined' && f.size <= 25 * 1024 * 1024) {
        const b64 = await new Promise((resolve) => {
          const reader = new FileReader();
          reader.onload = () => {
            const s = String(reader.result || '');
            const i = s.indexOf(',');
            resolve(i >= 0 ? s.slice(i + 1) : '');
          };
          reader.onerror = () => resolve('');
          reader.readAsDataURL(f);
        });
        if (b64) additions.push({ action: 'addContent', name: f.name, base64: b64 });
      }
    }
    if (!additions.length) return;
    await saveFilesDeltaForProject(project, (ops) => {
      const next = ops.slice();
      for (const item of additions) {
        const p = item.sourcePath;
        if (p && next.some((x) => x.absPath === p || x.sourcePath === p)) continue;
        next.push(item);
      }
      return next;
    });
  }

  async function removeFileFromProject(project, relPath) {
    if (!project || !relPath) return;
    await saveFilesDeltaForProject(project, (ops) => ops.filter((x) => x.relPath !== relPath));
  }

  async function refreshProjectsContexts(projects) {
    if (typeof window.__agProjectCall !== 'function') return;
    const paths = projects.map((p) => p.dirPath).filter(Boolean);
    const projectIds = projects.map((p) => p.id).filter(Boolean);
    if (!paths.length && !projectIds.length) return;
    const res = await window.__agProjectCall('listContexts', { paths, projectIds }, 8000);
    if (disposed || !res || !res.ok) return;
    if (res.contexts) projectsContextMap = Object.assign({}, projectsContextMap, res.contexts);
    if (res.projectMtimes) projectsNativeMtimeMap = Object.assign({}, projectsNativeMtimeMap, res.projectMtimes);
    if (projectsViewOpen) renderProjectsView();
  }

  function ensureProjectsViewEl() {
    if (projectsViewEl && projectsViewEl.isConnected) return projectsViewEl;
    const el = document.createElement('section');
    el.id = 'ag-claude-projects-view';
    el.setAttribute('data-ag-i18n-ignore', '1');
    el.setAttribute('data-open', 'false');
    el.setAttribute('aria-label', L('项目工作区', 'Projects Workspace'));
    document.body.appendChild(el);
    projectsViewEl = el;
    return el;
  }

  function renderProjectDetailView(el, project) {
    const hasLocalDir = Boolean(project.dirPath);
    const ctx = hasLocalDir ? projectsContextMap[project.dirPath] : null;
    const instructions = ctx && typeof ctx.instructions === 'string' ? ctx.instructions.trim() : '';
    const files = ctx && Array.isArray(ctx.files) ? ctx.files : [];
    const extraFolders = ctx && Array.isArray(ctx.extraFolders) ? ctx.extraFolders : [];
    const allFolders = hasLocalDir
      ? [
          { name: project.name, absPath: project.dirPath, primary: true },
          ...extraFolders.map((f) => ({ name: f.name || f.absPath.split(/[\\/]/).pop(), absPath: f.absPath, primary: false }))
        ]
      : [];
    const activeFolder = allFolders.length
      ? allFolders.find((f) => f.absPath === projectSelectedFolderPath) || allFolders[0]
      : { name: project.name, absPath: '', primary: true };
    const folderTriggerLabel =
      extraFolders.length > 0 && activeFolder.primary
        ? FEAT.i18n
          ? `${activeFolder.name}（+${extraFolders.length} 个文件夹）`
          : `${activeFolder.name} (+${extraFolders.length})`
        : activeFolder.name;

    const modelParts = formatProjectComposerModelParts(buildReduxModelSelectorApi() || discoverModelSelectorApi());

    const chatsHtml = project.chats.length
      ? project.chats
          .map((c) => {
            const statusDot = c.waiting
              ? `<span class="ag-pd-dot ag-pd-dot-wait" title="${escapeHtml(L('待确认', 'Waiting'))}"></span>`
              : c.running
                ? `<span class="ag-pd-dot ag-pd-dot-run" title="${escapeHtml(L('运行中', 'Running'))}"></span>`
                : '';
            const pinBadge = c.pinned
              ? `<span class="ag-pd-chat-pin" title="${escapeHtml(L('已置顶', 'Pinned'))}">${RECENT_PIN_SVG}</span>`
              : '';
            const timeTxt = c.lastSec ? formatProjectTimeAgo(c.lastSec) : '';
            return `<button type="button" class="ag-pd-chat-row" draggable="true" data-ag-pd-chat="${escapeHtml(c.id)}" data-ag-pd-chat-title="${escapeHtml(c.title)}">
              <div class="ag-pd-chat-main">
                <span class="ag-pd-chat-title">${statusDot}${pinBadge}${escapeHtml(c.title)}</span>
              </div>
              <span class="ag-pd-chat-time">${escapeHtml(timeTxt)}</span>
            </button>`;
          })
          .join('')
      : `<div class="ag-pd-chat-empty">${L(
          '这个项目下还没有历史对话，在上方输入内容即可直接开始第一场对话。',
          'No conversations in this project yet. Start one above.'
        )}</div>`;

    const agentsFilePath = hasLocalDir ? `${String(project.dirPath).replace(/[\\/]+$/, '')}/AGENTS.md` : '';
    const instBodyHtml = instructions
      ? `<div class="ag-pd-inst-preview">${escapeHtml(instructions)}</div>`
      : `<div class="ag-pd-card-muted">${L(
          '编写项目指令，保存后直接生成或更新项目根目录下的 AGENTS.md',
          'Write project instructions — saved directly to root AGENTS.md'
        )}</div>`;

    const filesBodyHtml = files.length
      ? `<div class="ag-pd-file-list">${files
          .map((f) => {
            const modeTag = f.inlined
              ? `<span class="ag-pm-tag ag-pm-tag-inline">${L('自动内联', 'Inline')}</span>`
              : `<span class="ag-pm-tag">${L('按需读取', 'On-demand')}</span>`;
            return `<div class="ag-pd-file-row" draggable="true" data-ag-pd-drag-file="${escapeHtml(f.absPath || '')}">
              <button type="button" class="ag-pd-file-name" data-ag-pd-reveal-file="${escapeHtml(f.absPath || '')}" title="${escapeHtml(f.absPath || f.name)}">${escapeHtml(f.name)}</button>
              <span class="ag-pd-file-meta">${modeTag}<span>${escapeHtml(f.sizeText || '')}</span></span>
              <button type="button" class="ag-pd-file-del" data-ag-pd-rm-file="${escapeHtml(f.relPath)}" aria-label="${escapeHtml(L('移除文件', 'Remove file'))}">×</button>
            </div>`;
          })
          .join('')}</div>`
      : `<div class="ag-pd-card-muted">${L(
          '尚未添加参考文件。点右上角 + 或直接把文件拖到这里。',
          'No context added yet. Click + or drop files here.'
        )}</div>`;

    const scheduledTasks = ctx && Array.isArray(ctx.scheduledTasks) ? ctx.scheduledTasks : [];
    const formatSchedFreq = (t) => {
      const f = String((t && t.frequency) || 'manual');
      if (f === 'manual') return L('手动', 'Manual');
      if (f === 'hourly') return `${L('每小时', 'Hourly')} :${String(t.minute || 0).padStart(2, '0')}`;
      if (f === 'daily') return `${L('每天', 'Daily')} ${t.time || '09:00'}`;
      if (f === 'weekdays') return `${L('工作日', 'Weekdays')} ${t.time || '09:00'}`;
      if (f === 'weekly') {
        const dowsZh = ['日', '一', '二', '三', '四', '五', '六'];
        const dowsEn = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
        const rawDow = Number(t.dayOfWeek);
        const idx = Number.isFinite(rawDow) ? Math.min(6, Math.max(0, rawDow)) : 1;
        return `${L(`每周${dowsZh[idx]}`, `Weekly ${dowsEn[idx]}`)} ${t.time || '09:00'}`;
      }
      return t.customCron || 'Cron';
    };
    const hasSyncedCron = scheduledTasks.some((t) => t && t.frequency !== 'manual');
    const scheduledBodyHtml = scheduledTasks.length
      ? `<div class="ag-pd-sched-list">${scheduledTasks
          .map((t) => {
            const freqLabel = formatSchedFreq(t);
            const isAuto = t.frequency && t.frequency !== 'manual';
            return `<div class="ag-pd-sched-row" data-ag-pd-sched-id="${escapeHtml(t.id)}">
              <button type="button" class="ag-pd-sched-main" data-ag-pd-edit-sched="${escapeHtml(t.id)}" title="${escapeHtml(t.description || t.name)}">
                <div class="ag-pd-sched-top">
                  <span class="ag-pd-sched-name">${escapeHtml(t.name)}</span>
                  <span class="ag-pm-tag${isAuto ? ' ag-pm-tag-inline' : ''}">${escapeHtml(freqLabel)}</span>
                </div>
                ${t.description ? `<div class="ag-pd-sched-desc">${escapeHtml(t.description)}</div>` : ''}
              </button>
              <button type="button" class="ag-pd-sched-run" data-ag-pd-run-sched="${escapeHtml(t.id)}" title="${escapeHtml(L('立即运行一次', 'Run now'))}" aria-label="${escapeHtml(L('立即运行', 'Run now'))}">▶</button>
              <button type="button" class="ag-pd-file-del" data-ag-pd-del-sched="${escapeHtml(t.id)}" aria-label="${escapeHtml(L('删除定时任务', 'Delete scheduled task'))}">×</button>
            </div>`;
          })
          .join('')}</div>${
          hasSyncedCron
            ? `<button type="button" class="ag-pd-sched-auto-link" data-ag-pd-open-automations="true">${L(
                '在「自动化任务」中启用与管理 ↗',
                'Enable & manage in Automations ↗'
              )}</button>`
            : ''
        }`
      : `<div class="ag-pd-card-muted">${L(
          '为这个项目设置定期自动执行的任务。',
          'Set up recurring tasks for this project.'
        )}</div>`;

    const fq = projectFolderSearch.trim().toLowerCase();
    const filteredFolders = allFolders.filter(
      (f) => !fq || f.name.toLowerCase().includes(fq) || f.absPath.toLowerCase().includes(fq)
    );
    const folderMenuHtml = projectFolderDropdownOpen
      ? `<div class="ag-pd-folder-menu" data-ag-pd-folder-menu="true">
          <div class="ag-pd-fm-search">
            ${SVG_PROJ_SEARCH_ICON}
            <input id="ag-pd-fm-search-input" type="search" value="${escapeHtml(projectFolderSearch)}" placeholder="${escapeHtml(L('搜索文件夹…', 'Search folders…'))}" />
          </div>
          <div class="ag-pd-fm-list">${filteredFolders
            .map((fld) => {
              const isSelected = fld.absPath === activeFolder.absPath;
              return `<div class="ag-pd-fm-item" data-selected="${isSelected ? 'true' : 'false'}" data-ag-pd-select-folder="${escapeHtml(fld.absPath)}">
                <span class="ag-pd-fm-icon">${SVG_PROJ_FOLDER_OPEN}</span>
                <div class="ag-pd-fm-text">
                  <div class="ag-pd-fm-name">${escapeHtml(fld.name)}${fld.primary ? ` <span class="ag-pd-fm-badge">${L('主目录', 'Primary')}</span>` : ''}</div>
                  <div class="ag-pd-fm-path">${escapeHtml(fld.absPath)}</div>
                </div>
                ${
                  fld.primary
                    ? ''
                    : `<button type="button" class="ag-pd-file-del" data-ag-pd-rm-folder="${escapeHtml(fld.absPath)}" aria-label="${escapeHtml(L('移除文件夹', 'Remove folder'))}">×</button>`
                }
              </div>`;
            })
            .join('')}</div>
          <div class="ag-pd-fm-divider"></div>
          <button type="button" class="ag-pd-fm-add" data-ag-pd-add-folder="true">
            ${SVG_PROJ_FOLDER_ADD}
            <span>${L('添加文件夹', 'Add folder')}</span>
          </button>
        </div>`
      : '';

    const prevFmSearch = el.querySelector('#ag-pd-fm-search-input');
    const hadFmFocus = prevFmSearch && document.activeElement === prevFmSearch;
    const fmSelStart = hadFmFocus ? prevFmSearch.selectionStart : null;

    const prevComp = el.getAttribute('data-ag-pd-proj-id') === project.id ? el.querySelector('#ag-pd-composer-input') : null;
    const hadCompFocus = Boolean(prevComp && document.activeElement === prevComp);
    const compSelStart = hadCompFocus ? prevComp.selectionStart : null;
    const compSelEnd = hadCompFocus ? prevComp.selectionEnd : null;
    if (prevComp) {
      if (prevComp.value) projectComposerDrafts.set(project.id, prevComp.value);
      else projectComposerDrafts.delete(project.id);
    }
    const savedDraft = projectComposerDrafts.get(project.id) || '';
    el.setAttribute('data-ag-pd-proj-id', project.id);

    el.innerHTML = `
      <div class="ag-pd-topbar">
        <nav class="ag-pd-breadcrumb" aria-label="Breadcrumb">
          <button type="button" class="ag-pd-crumb-root" data-ag-pd-back="true">${L('项目', 'Projects')}</button>
          <span class="ag-pd-crumb-sep">/</span>
          <span class="ag-pd-crumb-cur">${escapeHtml(project.name)}</span>
        </nav>
      </div>
      <div class="ag-pd-shell">
        <div class="ag-pd-title-row">
          <h1 class="ag-pd-title">${escapeHtml(project.name)}</h1>
          ${
            !project.isBuiltin
              ? `<button type="button" class="ag-pd-more-btn" data-ag-pd-proj-menu="true" aria-label="${escapeHtml(L('项目操作', 'Project options'))}" title="${escapeHtml(L('更多操作', 'More options'))}">${RECENT_MORE_SVG}</button>`
              : ''
          }
        </div>
        <div class="ag-pd-columns">
          <div class="ag-pd-left">
            <div class="ag-pd-composer-anchor">
              <div class="ag-pd-composer-wrap">
                <div class="ag-pd-composer-box" data-ag-pd-composer-box="true">
                  <div id="ag-pd-media-strip" class="ag-pd-media-strip" style="display:none"></div>
                  <div id="ag-pd-mention-pills" class="ag-pd-mention-pills" style="display:none"></div>
                  <textarea id="ag-pd-composer-input" class="ag-pd-composer-input" rows="2" placeholder="${escapeHtml(
                    L('想在这个项目里处理什么？（输入 @ 引用，支持直接粘贴图片）', 'What would you like to work on? (Type @ to mention, paste images directly)')
                  )}">${escapeHtml(savedDraft)}</textarea>
                  <div class="ag-pd-composer-foot">
                    ${
                      hasLocalDir
                        ? `<button type="button" class="ag-pd-composer-add" data-ag-pd-composer-add="true" title="${escapeHtml(L('添加参考文件到本项目', 'Add context files to project'))}" aria-label="${escapeHtml(L('添加参考文件', 'Add files'))}">${SVG_PROJ_PLUS}</button>`
                        : '<span></span>'
                    }
                    <div class="ag-pd-composer-right">
                      <button type="button" id="ag-pd-model-btn" class="ag-pd-model-btn" data-ag-pd-model-trigger="true" aria-haspopup="menu" aria-expanded="false">
                        <span class="ag-pd-model-name">${escapeHtml(modelParts.name)}</span>
                        <span class="ag-pd-model-effort"${modelParts.effort ? '' : ' style="display:none"'}>${escapeHtml(modelParts.effort)}</span>
                        <span class="ag-pd-model-chev">${SVG_PROJ_CHEVRON}</span>
                      </button>
                      <button type="button" class="ag-pd-send-btn" data-ag-pd-send="true" aria-label="${escapeHtml(L('发送', 'Send'))}" disabled>${SVG_PROJ_SEND_ARROW}</button>
                    </div>
                  </div>
                </div>
                ${
                  hasLocalDir
                    ? `<div class="ag-pd-folder-bar">
                        <button type="button" class="ag-pd-folder-trigger" data-ag-pd-folder-toggle="true" data-open="${projectFolderDropdownOpen ? 'true' : 'false'}" title="${escapeHtml(activeFolder.absPath)}">
                          <span class="ag-pd-folder-strip-icon">${SVG_CLAUDE_PROJECTS_ICON}</span>
                          <span class="ag-pd-folder-strip-path">${escapeHtml(folderTriggerLabel)}</span>
                          <span class="ag-pd-folder-chevron">${SVG_PROJ_CHEVRON}</span>
                        </button>
                      </div>`
                    : `<div class="ag-pd-folder-bar">
                        <span class="ag-pd-virtual-note">${SVG_CLAUDE_PROJECTS_ICON}<span>${
                          project.isCliProject
                            ? L('终端 CLI 会话分组（未绑定本地文件夹）', 'CLI session container (no local folder)')
                            : L('未绑定本地文件夹', 'No local folder linked')
                        }</span></span>
                      </div>`
                }
              </div>
              ${hasLocalDir ? folderMenuHtml : ''}
              <div id="ag-pd-mention-popover" class="ag-pd-mention-popover" role="listbox" data-open="false"></div>
            </div>

            <div class="ag-pd-recents">
              <div class="ag-pd-recents-hdr">${L('最近对话', 'Recents')}</div>
              <div class="ag-pd-chat-list">${chatsHtml}</div>
            </div>
          </div>

          <aside class="ag-pd-right">
            <div class="ag-pd-sidecard">
              <div class="ag-pd-section"${hasLocalDir ? ' data-ag-pd-inst-sec="true"' : ''}>
                <div class="ag-pd-sec-hdr">
                  <span class="ag-pd-sec-title">${L('项目指令', 'Instructions')} <span class="ag-pd-sec-file-tag"${agentsFilePath ? ` title="${escapeHtml(agentsFilePath)}"` : ''}>AGENTS.md</span></span>
                  ${
                    hasLocalDir
                      ? `<button type="button" class="ag-pd-sec-btn" data-ag-pd-edit-inst="true" aria-label="${escapeHtml(L('编辑 AGENTS.md', 'Edit AGENTS.md'))}">${
                          instructions ? SVG_PROJ_EDIT : SVG_PROJ_PLUS
                        }</button>`
                      : ''
                  }
                </div>
                ${
                  hasLocalDir
                    ? instBodyHtml
                    : `<div class="ag-pd-card-muted">${L('该分组无对应本地文件夹，暂不支持写入项目级 AGENTS.md。', 'Virtual container without a local folder.')}</div>`
                }
              </div>

              <div class="ag-pd-section${hasLocalDir ? ' ag-pd-drop-sec' : ''}"${hasLocalDir ? ' data-ag-pd-ctx-drop="true"' : ''}>
                <div class="ag-pd-sec-hdr">
                  <span class="ag-pd-sec-title">${L('参考文件', 'Context')}</span>
                  ${
                    hasLocalDir
                      ? `<button type="button" class="ag-pd-sec-btn" data-ag-pd-add-files="true" aria-label="${escapeHtml(L('添加参考文件', 'Add context files'))}">${SVG_PROJ_PLUS}</button>`
                      : ''
                  }
                </div>
                ${
                  hasLocalDir
                    ? filesBodyHtml
                    : `<div class="ag-pd-card-muted">${L('仅绑定本地文件夹的项目支持添加参考文件。', 'Available for projects linked to a local folder.')}</div>`
                }
              </div>

              <div class="ag-pd-section" data-ag-pd-sched-sec="true">
                <div class="ag-pd-sec-hdr">
                  <span class="ag-pd-sec-title">${L('定时任务', 'Scheduled')}</span>
                  ${
                    hasLocalDir
                      ? `<button type="button" class="ag-pd-sec-btn" data-ag-pd-add-sched="true" aria-label="${escapeHtml(L('创建定时任务', 'Create scheduled task'))}">${SVG_PROJ_PLUS}</button>`
                      : ''
                  }
                </div>
                ${
                  hasLocalDir
                    ? scheduledBodyHtml
                    : `<div class="ag-pd-card-muted">${L('仅绑定本地文件夹的项目支持创建项目定时任务。', 'Available for projects linked to a local folder.')}</div>`
                }
              </div>
            </div>
          </aside>
        </div>
      </div>
    `;

    const backBtn = el.querySelector('[data-ag-pd-back]');
    if (backBtn) {
      backBtn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        closeProjectActionMenu();
        closePdMentionMenu();
        activeProjectId = null;
        projectFolderDropdownOpen = false;
        projectFolderSearch = '';
        projectSelectedFolderPath = '';
        renderProjectsView();
      });
    }

    const pdTitleRow = el.querySelector('.ag-pd-title-row');
    if (pdTitleRow && !project.isBuiltin) {
      pdTitleRow.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        e.stopPropagation();
        openProjectActionMenu(project, e.clientX, e.clientY);
      });
    }

    const pdMoreBtn = el.querySelector('[data-ag-pd-proj-menu]');
    if (pdMoreBtn && !project.isBuiltin) {
      pdMoreBtn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        const r = pdMoreBtn.getBoundingClientRect();
        openProjectActionMenu(project, Math.max(8, Math.round(r.right - 216)), Math.round(r.bottom + 6), pdMoreBtn);
      });
    }

    const folderToggleBtn = el.querySelector('[data-ag-pd-folder-toggle]');
    if (folderToggleBtn) {
      folderToggleBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        projectFolderDropdownOpen = !projectFolderDropdownOpen;
        if (!projectFolderDropdownOpen) projectFolderSearch = '';
        renderProjectsView();
      });
    }

    const fmSearchInput = el.querySelector('#ag-pd-fm-search-input');
    if (fmSearchInput) {
      if (hadFmFocus) {
        fmSearchInput.focus();
        if (typeof fmSelStart === 'number') {
          try {
            fmSearchInput.setSelectionRange(fmSelStart, fmSelStart);
          } catch {}
        }
      }
      fmSearchInput.addEventListener('input', () => {
        projectFolderSearch = fmSearchInput.value || '';
        renderProjectsView();
      });
    }

    el.querySelectorAll('[data-ag-pd-select-folder]').forEach((item) => {
      item.addEventListener('click', (e) => {
        if (e.target.closest('button')) return;
        projectSelectedFolderPath = item.getAttribute('data-ag-pd-select-folder') || project.dirPath;
        projectFolderDropdownOpen = false;
        projectFolderSearch = '';
        renderProjectsView();
      });
    });

    el.querySelectorAll('[data-ag-pd-add-folder]').forEach((b) => {
      b.addEventListener('click', (e) => {
        e.stopPropagation();
        pickAndAddFolderToProject(project);
      });
    });

    el.querySelectorAll('[data-ag-pd-rm-folder]').forEach((b) => {
      b.addEventListener('click', (e) => {
        e.stopPropagation();
        removeExtraFolderFromProject(project, b.getAttribute('data-ag-pd-rm-folder'));
      });
    });

    const compAddBtn = el.querySelector('[data-ag-pd-composer-add]');
    if (compAddBtn) {
      compAddBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        pickAndAddFilesToProject(project);
      });
    }

    const compBox = el.querySelector('[data-ag-pd-composer-box]');
    const compInput = el.querySelector('#ag-pd-composer-input');
    const sendBtn = el.querySelector('[data-ag-pd-send]');
    const dispatchPrompt = () => {
      const raw = ((compInput && compInput.value) || '').trim();
      const mediaArr = (getProjectMediaList(project.id, false) || []).slice();
      if (!raw && !mediaArr.length) return;
      const mMap = getProjectMentionMap(project.id, false);
      const mentionEntries = mMap ? [...mMap.values()] : [];
      const rollbackDraft = { raw, mentionEntries: mentionEntries.slice(), mediaArr: mediaArr.slice() };
      if (compInput) compInput.value = '';
      projectComposerDrafts.delete(project.id);
      projectComposerMedia.delete(project.id);
      if (mMap) mMap.clear();
      closePdMentionMenu();
      const finalPrompt =
        activeFolder && !activeFolder.primary && activeFolder.absPath
          ? raw
            ? `[${L('关联文件夹', 'Linked folder')}: ${activeFolder.absPath}]\n${raw}`
            : `[${L('关联文件夹', 'Linked folder')}: ${activeFolder.absPath}]`
          : raw;
      startNewChatInProject(project, finalPrompt, mentionEntries, mediaArr, rollbackDraft);
    };
    if (compInput && sendBtn) {
      if (compInput.value !== savedDraft) compInput.value = savedDraft;
      const syncSend = () => {
        if (compInput.value) projectComposerDrafts.set(project.id, compInput.value);
        else projectComposerDrafts.delete(project.id);
        const hasMedia = Boolean((getProjectMediaList(project.id, false) || []).length);
        sendBtn.disabled = !compInput.value.trim() && !hasMedia;
        syncPdMediaStrip(project, () => {
          const stillHasMedia = Boolean((getProjectMediaList(project.id, false) || []).length);
          sendBtn.disabled = !compInput.value.trim() && !stillHasMedia;
        });
        syncPdMentionPills(project, compInput);
        compInput.style.height = 'auto';
        compInput.style.height = `${Math.min(180, Math.max(48, compInput.scrollHeight))}px`;
      };
      syncSend();
      if (hadCompFocus && !hadFmFocus) {
        compInput.focus();
        if (typeof compSelStart === 'number' && typeof compSelEnd === 'number') {
          try {
            compInput.setSelectionRange(compSelStart, compSelEnd);
          } catch {}
        }
      }
      if (pdMentionState.open && pdMentionState.projectId === project.id) {
        renderPdMentionPopover();
      }
      compInput.addEventListener('input', () => {
        syncSend();
        updatePdMentionMenuForInput(project, compInput);
      });
      compInput.addEventListener('click', (e) => {
        if (e.metaKey || e.ctrlKey) {
          if (openUrlAtTextareaCaret(compInput)) {
            e.preventDefault();
            return;
          }
        }
        updatePdMentionMenuForInput(project, compInput);
      });
      compInput.addEventListener('paste', (e) => {
        const imgs = extractComposerImageFiles(e.clipboardData);
        if (!imgs.length) return;
        e.preventDefault();
        e.stopPropagation();
        stagePdComposerImageFiles(project, imgs, syncSend);
      });
      if (compBox) {
        compBox.addEventListener('dragover', (e) => {
          const dt = e.dataTransfer;
          if (
            dt &&
            (Array.from(dt.types || []).includes('Files') || hasDroppedContextPayload(dt))
          ) {
            e.preventDefault();
            try {
              dt.dropEffect = 'copy';
            } catch {}
            compBox.setAttribute('data-drag', 'true');
          }
        });
        compBox.addEventListener('dragleave', (e) => {
          if (!compBox.contains(e.relatedTarget)) {
            compBox.removeAttribute('data-drag');
          }
        });
        compBox.addEventListener('drop', (e) => {
          compBox.removeAttribute('data-drag');
          const droppedMentions = extractDroppedContextMentions(e.dataTransfer);
          if (droppedMentions.length > 0) {
            e.preventDefault();
            e.stopPropagation();
            appendDroppedMentionsToPdComposer(project, compInput, droppedMentions);
            return;
          }
          const imgs = extractComposerImageFiles(e.dataTransfer);
          if (!imgs.length) return;
          e.preventDefault();
          e.stopPropagation();
          stagePdComposerImageFiles(project, imgs, syncSend);
        });
      }
      compInput.addEventListener('keydown', (e) => {
        if (pdMentionState.open && !e.isComposing) {
          if (e.key === 'ArrowDown') {
            e.preventDefault();
            movePdMentionSelection(1);
            return;
          }
          if (e.key === 'ArrowUp') {
            e.preventDefault();
            movePdMentionSelection(-1);
            return;
          }
          if ((e.key === 'Enter' && !e.shiftKey) || e.key === 'Tab') {
            if (pdMentionState.items.length > 0) {
              e.preventDefault();
              e.stopPropagation();
              applyPdMentionSelection(pdMentionState.activeIndex);
              return;
            }
          }
          if (e.key === 'Escape') {
            e.preventDefault();
            e.stopPropagation();
            closePdMentionMenu();
            return;
          }
        }
        const hasMedia = Boolean((getProjectMediaList(project.id, false) || []).length);
        if (e.key === 'Enter' && !e.shiftKey && !e.isComposing && (compInput.value.trim() || hasMedia)) {
          e.preventDefault();
          dispatchPrompt();
        }
      });
      sendBtn.addEventListener('click', dispatchPrompt);
    }

    let pdLastDragEndTs = 0;
    el.querySelectorAll('[data-ag-pd-chat]').forEach((btn) => {
      btn.addEventListener('click', () => {
        if (Date.now() - pdLastDragEndTs < 260) return;
        openConversationFromProject(btn.getAttribute('data-ag-pd-chat'));
      });
      btn.addEventListener('dragstart', (e) => {
        const cid = btn.getAttribute('data-ag-pd-chat');
        const title = btn.getAttribute('data-ag-pd-chat-title') || '';
        attachConversationDragTransfer(e.dataTransfer, cid, title);
        btn.setAttribute('data-dragging', 'true');
      });
      btn.addEventListener('dragend', () => {
        pdLastDragEndTs = Date.now();
        btn.removeAttribute('data-dragging');
      });
    });

    el.querySelectorAll('[data-ag-pd-drag-file]').forEach((row) => {
      row.addEventListener('dragstart', (e) => {
        if (e.target && e.target.closest && e.target.closest('[data-ag-pd-rm-file]')) {
          e.preventDefault();
          return;
        }
        const abs = row.getAttribute('data-ag-pd-drag-file');
        if (!abs) {
          e.preventDefault();
          return;
        }
        attachFileDragTransfer(e.dataTransfer, abs);
      });
    });

    const editInstBtn = el.querySelector('[data-ag-pd-edit-inst]');
    const instSec = el.querySelector('[data-ag-pd-inst-sec]');
    const openInst = () => openProjectInstructionsModal(project);
    if (editInstBtn) editInstBtn.addEventListener('click', (e) => (e.stopPropagation(), openInst()));
    if (instSec) {
      instSec.addEventListener('click', (e) => {
        if (!e.target.closest('button')) openInst();
      });
    }

    const addFilesBtn = el.querySelector('[data-ag-pd-add-files]');
    if (addFilesBtn) {
      addFilesBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        pickAndAddFilesToProject(project);
      });
    }

    const dropSec = el.querySelector('[data-ag-pd-ctx-drop]');
    if (dropSec) {
      dropSec.addEventListener('dragover', (e) => {
        e.preventDefault();
        dropSec.setAttribute('data-drag', 'true');
      });
      dropSec.addEventListener('dragleave', () => dropSec.removeAttribute('data-drag'));
      dropSec.addEventListener('drop', (e) => {
        e.preventDefault();
        dropSec.removeAttribute('data-drag');
        if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files.length) {
          addDroppedFilesToProject(project, e.dataTransfer.files);
        }
      });
    }

    el.querySelectorAll('[data-ag-pd-reveal-file]').forEach((b) => {
      b.addEventListener('click', () => {
        const p = b.getAttribute('data-ag-pd-reveal-file');
        if (p && typeof window.__agProjectCall === 'function') {
          window.__agProjectCall('revealFile', { dirPath: project.dirPath, targetPath: p }, 5000);
        }
      });
    });

    el.querySelectorAll('[data-ag-pd-rm-file]').forEach((b) => {
      b.addEventListener('click', (e) => {
        e.stopPropagation();
        removeFileFromProject(project, b.getAttribute('data-ag-pd-rm-file'));
      });
    });

    const addSchedBtn = el.querySelector('[data-ag-pd-add-sched]');
    if (addSchedBtn) {
      addSchedBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        openProjectScheduledModal(project, null);
      });
    }

    const schedById = new Map(scheduledTasks.map((t) => [t.id, t]));
    el.querySelectorAll('[data-ag-pd-edit-sched]').forEach((b) => {
      b.addEventListener('click', () => {
        const task = schedById.get(b.getAttribute('data-ag-pd-edit-sched'));
        if (task) openProjectScheduledModal(project, task);
      });
    });

    el.querySelectorAll('[data-ag-pd-run-sched]').forEach((b) => {
      b.addEventListener('click', (e) => {
        e.stopPropagation();
        const task = schedById.get(b.getAttribute('data-ag-pd-run-sched'));
        if (task) runProjectScheduledTask(project, task);
      });
    });

    el.querySelectorAll('[data-ag-pd-del-sched]').forEach((b) => {
      b.addEventListener('click', async (e) => {
        e.stopPropagation();
        const task = schedById.get(b.getAttribute('data-ag-pd-del-sched'));
        if (!task) return;
        if (b.getAttribute('data-confirm') !== '1') {
          b.setAttribute('data-confirm', '1');
          b.textContent = task.externalSidecar ? L('确认删官方任务?', 'Delete native?') : L('确认?', 'Confirm?');
          b.style.width = 'auto';
          b.style.padding = '0 6px';
          b.style.fontSize = '11px';
          later(() => {
            if (b.isConnected && b.getAttribute('data-confirm') === '1') {
              b.removeAttribute('data-confirm');
              b.textContent = '×';
              b.style.width = '';
              b.style.padding = '';
              b.style.fontSize = '';
            }
          }, 3500);
          return;
        }
        b.disabled = true;
        const res = await deleteProjectScheduledTaskFromUi(project, task);
        if (res && !res.ok && b.isConnected) {
          b.disabled = false;
          b.removeAttribute('data-confirm');
          b.textContent = '×';
          b.style.width = '';
          b.style.padding = '';
          b.style.fontSize = '';
          showProjectsFloatingNotice(
            L('删除定时任务失败：', 'Failed to delete task: ') + String(res.error || 'unknown')
          );
        }
      });
    });

    const openAutoBtn = el.querySelector('[data-ag-pd-open-automations]');
    if (openAutoBtn) {
      openAutoBtn.addEventListener('click', () => {
        closeProjectsView();
        const autoNav = document.querySelector('[data-testid="automations-button"]');
        if (autoNav) autoNav.click();
      });
    }
  }

  function renderProjectsView() {
    const el = ensureProjectsViewEl();
    const prevProjId = el.getAttribute('data-ag-pd-proj-id');
    const prevComp = prevProjId ? el.querySelector('#ag-pd-composer-input') : null;
    if (prevProjId && prevComp) {
      if (prevComp.value) projectComposerDrafts.set(prevProjId, prevComp.value);
      else projectComposerDrafts.delete(prevProjId);
    }
    const allProjects = collectNativeProjects();
    if (activeProjectId) {
      const target = allProjects.find((p) => p.id === activeProjectId);
      if (target) {
        renderProjectDetailView(el, target);
        return;
      }
      activeProjectId = null;
    }
    el.removeAttribute('data-ag-pd-proj-id');

    const q = projectsSearchQuery.trim().toLowerCase();
    const filtered = allProjects
      .filter((p) => !q || p.name.toLowerCase().includes(q) || p.shortPath.toLowerCase().includes(q))
      .sort((a, b) => {
        if (projectsSortMode === 'name') return a.name.localeCompare(b.name, 'zh-Hans-CN');
        const ctxA = a.dirPath ? projectsContextMap[a.dirPath] : null;
        const ctxB = b.dirPath ? projectsContextMap[b.dirPath] : null;
        const tA = Math.max(
          a.lastSec * 1000,
          Number(projectsNativeMtimeMap[a.id] || 0),
          ctxA ? Number(ctxA.lastModifiedMs || 0) : 0
        );
        const tB = Math.max(
          b.lastSec * 1000,
          Number(projectsNativeMtimeMap[b.id] || 0),
          ctxB ? Number(ctxB.lastModifiedMs || 0) : 0
        );
        return tB - tA || a.name.localeCompare(b.name, 'zh-Hans-CN');
      });

    const cardsHtml = filtered.length
      ? filtered
          .map((p) => {
            const ctx = p.dirPath ? projectsContextMap[p.dirPath] : null;
            const nativeProjMs = Number(projectsNativeMtimeMap[p.id] || 0);
            const ctxActivityMs = ctx ? Math.max(Number(ctx.lastModifiedMs || 0), Number(ctx.dirMtimeMs || 0)) : 0;
            const effectiveSec = p.lastSec || Math.floor(Math.max(nativeProjMs, ctxActivityMs) / 1000);
            const timeLabel = effectiveSec ? formatProjectTimeAgo(effectiveSec) : L('刚刚', 'now');
            const chatLabel = FEAT.i18n
              ? `${p.chatCount} 个对话`
              : `${p.chatCount} ${p.chatCount === 1 ? 'chat' : 'chats'}`;
            const metaText = `${timeLabel} · ${chatLabel}`;
            const moreBtnHtml = !p.isBuiltin
              ? `<button type="button" class="ag-proj-card-more" data-ag-proj-menu="${escapeHtml(p.id)}" aria-label="${escapeHtml(L('项目操作', 'Project options'))}" title="${escapeHtml(L('更多操作', 'More options'))}">${RECENT_MORE_SVG}</button>`
              : '';
            const metaTitleAttr = p.shortPath ? ` title="${escapeHtml(p.shortPath)}"` : '';
            return `<article class="ag-proj-card" data-ag-proj-id="${escapeHtml(p.id)}" tabindex="0">
              <div class="ag-proj-card-head">
                <div class="ag-proj-card-title">${escapeHtml(p.name)}</div>
                ${moreBtnHtml}
              </div>
              <div class="ag-proj-card-foot">
                <span class="ag-proj-card-meta"${metaTitleAttr}>${escapeHtml(metaText)}</span>
              </div>
            </article>`;
          })
          .join('')
      : `<div class="ag-proj-empty">${
          q
            ? L(`没有匹配「${escapeHtml(projectsSearchQuery)}」的项目`, `No projects matching "${escapeHtml(projectsSearchQuery)}"`)
            : L('还没有本地项目文件夹，点击右上角「新建项目」添加一个吧。', 'No local project folders yet. Click "New project" to add one.')
        }</div>`;

    const sortLabel = projectsSortMode === 'recent' ? L('最近活跃', 'Recent') : L('按名称', 'Name');
    const prevSearchEl = el.querySelector('#ag-proj-search-input');
    const hadSearchFocus = prevSearchEl && document.activeElement === prevSearchEl;
    const selStart = hadSearchFocus ? prevSearchEl.selectionStart : null;

    el.innerHTML = `
      <div class="ag-proj-shell">
        <header class="ag-proj-header">
          <h1 class="ag-proj-heading">${L('项目', 'Projects')}</h1>
          <div class="ag-proj-header-controls">
            <label class="ag-proj-search-wrap">
              ${SVG_PROJ_SEARCH_ICON}
              <input id="ag-proj-search-input" type="search" value="${escapeHtml(projectsSearchQuery)}" placeholder="${escapeHtml(L('搜索项目…', 'Search projects…'))}" />
            </label>
            <button type="button" class="ag-proj-sort-btn" data-ag-proj-sort="true" title="${escapeHtml(L('切换排序方式', 'Toggle sort order'))}">⇅ ${escapeHtml(sortLabel)}</button>
            <button type="button" class="ag-proj-new-btn" data-ag-proj-new="true">${L('新建项目', 'New project')}</button>
          </div>
        </header>
        <div class="ag-proj-grid">${cardsHtml}</div>
      </div>
    `;

    const searchInput = el.querySelector('#ag-proj-search-input');
    if (searchInput) {
      if (hadSearchFocus) {
        searchInput.focus();
        if (typeof selStart === 'number') {
          try {
            searchInput.setSelectionRange(selStart, selStart);
          } catch {}
        }
      }
      searchInput.addEventListener('input', () => {
        projectsSearchQuery = searchInput.value || '';
        renderProjectsView();
      });
    }

    const sortBtn = el.querySelector('[data-ag-proj-sort]');
    if (sortBtn) {
      sortBtn.addEventListener('click', () => {
        projectsSortMode = projectsSortMode === 'recent' ? 'name' : 'recent';
        renderProjectsView();
      });
    }

    const newBtn = el.querySelector('[data-ag-proj-new]');
    if (newBtn) {
      newBtn.addEventListener('click', () => triggerNativeNewProject());
    }

    const byId = new Map(allProjects.map((p) => [p.id, p]));
    const enterProject = (proj) => {
      activeProjectId = proj.id;
      renderProjectsView();
      if (proj.dirPath && typeof window.__agProjectCall === 'function') {
        const prevSig = JSON.stringify(projectsContextMap[proj.dirPath] || null);
        window.__agProjectCall('readContext', { dirPath: proj.dirPath }, 8000).then((fresh) => {
          if (!disposed && fresh && fresh.ok) {
            projectsContextMap[proj.dirPath] = fresh;
            if (projectsViewOpen && activeProjectId === proj.id && JSON.stringify(fresh) !== prevSig) {
              renderProjectsView();
            }
          }
        });
      }
    };

    el.querySelectorAll('.ag-proj-card').forEach((card) => {
      const proj = byId.get(card.getAttribute('data-ag-proj-id'));
      if (!proj) return;
      card.addEventListener('click', (e) => {
        if (e.target && e.target.closest && e.target.closest('[data-ag-proj-menu]')) return;
        closeProjectActionMenu();
        enterProject(proj);
      });
      if (!proj.isBuiltin) {
        card.addEventListener('contextmenu', (e) => {
          e.preventDefault();
          e.stopPropagation();
          openProjectActionMenu(proj, e.clientX, e.clientY);
        });
        const moreBtn = card.querySelector('[data-ag-proj-menu]');
        if (moreBtn) {
          moreBtn.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            const r = moreBtn.getBoundingClientRect();
            openProjectActionMenu(proj, Math.max(8, Math.round(r.right - 216)), Math.round(r.bottom + 6), moreBtn);
          });
        }
      }
      card.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !(e.target && e.target.closest && e.target.closest('[data-ag-proj-menu]'))) {
          e.preventDefault();
          closeProjectActionMenu();
          enterProject(proj);
        }
      });
    });
  }

  async function openProjectInstructionsModal(project) {
    if (!project || !project.dirPath) return;
    closeProjectsModal();
    const cached = projectsContextMap[project.dirPath] || null;
    const modalRef = {
      kind: 'instructions',
      project,
      dirPath: project.dirPath,
      instructions: cached ? cached.instructions || '' : '',
      hasAgentsMd: Boolean(cached && (cached.hasAgentsMd || (cached.instructions && cached.instructions.trim()))),
      userEdited: false,
      saving: false,
      error: ''
    };
    projectsModalState = modalRef;
    renderProjectContextModal();

    if (typeof window.__agProjectCall === 'function') {
      const fresh = await window.__agProjectCall('readContext', { dirPath: project.dirPath }, 8000);
      if (disposed || projectsModalState !== modalRef) return;
      if (fresh && fresh.ok) {
        projectsContextMap[project.dirPath] = fresh;
        const nextHasAgents = Boolean(fresh.hasAgentsMd || (fresh.instructions && fresh.instructions.trim()));
        const needRender = !modalRef.userEdited || modalRef.hasAgentsMd !== nextHasAgents;
        if (!modalRef.userEdited) {
          modalRef.instructions = fresh.instructions || '';
        }
        modalRef.hasAgentsMd = nextHasAgents;
        if (needRender && !modalRef.userEdited) {
          renderProjectContextModal();
        }
      }
    }
  }

  function renderProjectContextModal() {
    if (!projectsModalState) return;
    if (!projectsModalEl || !projectsModalEl.isConnected) {
      projectsModalEl = document.createElement('div');
      projectsModalEl.id = 'ag-claude-project-modal';
      projectsModalEl.setAttribute('data-ag-i18n-ignore', '1');
      projectsModalEl.addEventListener('click', (e) => {
        if (e.target === projectsModalEl) closeProjectsModal();
      });
      document.body.appendChild(projectsModalEl);
    }

    const st = projectsModalState;
    const errHtml = st.error ? `<div class="ag-pm-error">${escapeHtml(st.error)}</div>` : '';

    projectsModalEl.innerHTML = `
      <div class="ag-pm-dialog" role="dialog" aria-modal="true" aria-label="${escapeHtml(L('编辑项目 AGENTS.md', 'Edit project AGENTS.md'))}">
        <div class="ag-pm-hdr">
          <div class="ag-pm-title-wrap">
            <span class="ag-pm-icon">${SVG_CLAUDE_PROJECTS_ICON}</span>
            <h2 class="ag-pm-title">${escapeHtml(st.project.name)} · AGENTS.md</h2>
          </div>
          <button type="button" class="ag-pm-close" data-ag-pm-close="true" aria-label="${escapeHtml(L('关闭', 'Close'))}">×</button>
        </div>
        <p class="ag-pm-desc">${L(
          '直接读写项目根目录下的 AGENTS.md 正文（右侧添加的「参考文件」与「关联文件夹」会自动维护在文件末尾，互不覆盖）。',
          'Directly reads and writes root AGENTS.md for this project (attached context files and linked folders are maintained automatically at the end of the file).'
        )}</p>
        <div class="ag-pm-field">
          <textarea id="ag-pm-instructions" class="ag-pm-textarea" rows="12" placeholder="${escapeHtml(
            L('例如：填写本项目的架构约定、目录结构、测试命令或回复风格约束……', 'Write project rules, architecture notes, or constraints for AGENTS.md…')
          )}">${escapeHtml(st.instructions)}</textarea>
        </div>
        ${errHtml}
        <div class="ag-pm-footer${st.hasAgentsMd ? ' ag-pm-footer-split' : ''}">
          ${
            st.hasAgentsMd
              ? `<button type="button" class="ag-pm-reveal-link" data-ag-pm-reveal-agents="true">${L('在 Finder 中定位 AGENTS.md', 'Reveal AGENTS.md in Finder')}</button>`
              : ''
          }
          <div class="ag-pm-footer-actions">
            <button type="button" class="ag-pm-secondary-btn" data-ag-pm-close="true">${L('取消', 'Cancel')}</button>
            <button type="button" class="ag-pm-primary-btn" data-ag-pm-save="true" ${st.saving ? 'disabled' : ''}>${
              st.saving ? L('保存中…', 'Saving…') : L('保存 AGENTS.md', 'Save AGENTS.md')
            }</button>
          </div>
        </div>
      </div>
    `;

    const textarea = projectsModalEl.querySelector('#ag-pm-instructions');
    if (textarea) {
      textarea.focus();
      textarea.addEventListener('input', () => {
        if (projectsModalState) {
          projectsModalState.instructions = textarea.value;
          projectsModalState.userEdited = true;
        }
      });
    }

    const revealBtn = projectsModalEl.querySelector('[data-ag-pm-reveal-agents]');
    if (revealBtn) {
      revealBtn.addEventListener('click', () => {
        if (st.dirPath && typeof window.__agProjectCall === 'function') {
          const targetPath = `${String(st.dirPath).replace(/[\\/]+$/, '')}/AGENTS.md`;
          window.__agProjectCall('revealFile', { dirPath: st.dirPath, targetPath }, 5000);
        }
      });
    }

    projectsModalEl.querySelectorAll('[data-ag-pm-close]').forEach((b) => {
      b.addEventListener('click', () => closeProjectsModal());
    });

    const saveBtn = projectsModalEl.querySelector('[data-ag-pm-save]');
    if (saveBtn) {
      saveBtn.addEventListener('click', async () => {
        const modalRef = projectsModalState;
        if (!modalRef || modalRef.saving) return;
        if (typeof window.__agProjectCall !== 'function') {
          modalRef.error = L('本地写入桥接不可用，请重启 Anti-Claude 守护进程', 'Local write bridge unavailable');
          renderProjectContextModal();
          return;
        }
        modalRef.saving = true;
        modalRef.error = '';
        renderProjectContextModal();
        /* Submit only `instructions` so in-flight context loads can never overwrite existing attachments or folders */
        const res = await window.__agProjectCall(
          'saveContext',
          {
            dirPath: modalRef.dirPath,
            instructions: modalRef.instructions
          },
          20000
        );
        if (disposed || projectsModalState !== modalRef) return;
        if (res && res.ok) {
          projectsContextMap[modalRef.dirPath] = res;
          closeProjectsModal();
          if (projectsViewOpen) renderProjectsView();
          invalidateOverviewSnapshotCache();
        } else {
          modalRef.saving = false;
          modalRef.error = L('保存失败：', 'Save failed: ') + String((res && res.error) || 'unknown');
          renderProjectContextModal();
        }
      });
    }
  }

  function runProjectScheduledTask(project, task) {
    if (!project || !task) return;
    const raw = String(task.instructions || '').trim();
    if (!raw) return;
    const taskModelId = String(task.model || '').trim();
    if (taskModelId) {
      const api = discoverModelSelectorApi() || buildReduxModelSelectorApi();
      if (api) {
        const allOpts = []
          .concat(Array.isArray(api.modelOptions) ? api.modelOptions : [])
          .concat(Array.isArray(api.customModels) ? api.customModels : []);
        const matched = allOpts.find((o) => o && !o.disabled && o.modelId === taskModelId);
        if (matched) applyModelSelectionOption(api, matched);
      }
    }
    const normProj = String(project.dirPath || '').replace(/\/+$/, '');
    const normTaskDir = String(task.folderPath || '').replace(/\/+$/, '');
    const finalPrompt =
      normTaskDir && normTaskDir !== normProj
        ? `[${L('关联文件夹', 'Linked folder')}: ${normTaskDir}]\n${raw}`
        : raw;
    startNewChatInProject(project, finalPrompt);
  }

  async function deleteProjectScheduledTaskFromUi(project, task) {
    if (!project || !project.dirPath || !task || typeof window.__agProjectCall !== 'function') {
      return { ok: false, error: 'unavailable' };
    }
    const res = await window.__agProjectCall(
      'deleteScheduledTask',
      { dirPath: project.dirPath, taskId: task.id, sidecarId: task.sidecarId || '' },
      10000
    );
    if (!disposed && res && res.ok) {
      projectsContextMap[project.dirPath] = res;
      if (projectsViewOpen) renderProjectsView();
    }
    return res || { ok: false, error: 'delete_failed' };
  }

  function openProjectScheduledModal(project, existingTask = null) {
    if (!project || !project.dirPath) return;
    closeProjectsModal();
    const tz = (() => {
      try {
        return Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Shanghai';
      } catch {
        return 'Asia/Shanghai';
      }
    })();
    projectsModalState = {
      kind: 'scheduled',
      project,
      dirPath: project.dirPath,
      editingId: existingTask ? existingTask.id : '',
      sidecarId: existingTask ? existingTask.sidecarId || '' : '',
      name: existingTask ? existingTask.name || '' : '',
      description: existingTask ? existingTask.description || '' : '',
      instructions: existingTask ? existingTask.instructions || '' : '',
      folderPath: (existingTask && existingTask.folderPath) || projectSelectedFolderPath || project.dirPath,
      model: existingTask ? existingTask.model || '' : '',
      frequency: existingTask ? existingTask.frequency || 'manual' : 'manual',
      time: existingTask ? existingTask.time || '09:00' : '09:00',
      dayOfWeek: existingTask && Number.isFinite(Number(existingTask.dayOfWeek)) ? Number(existingTask.dayOfWeek) : 1,
      minute: existingTask && Number.isFinite(Number(existingTask.minute)) ? Number(existingTask.minute) : 0,
      customCron: existingTask ? existingTask.customCron || '0 9 * * *' : '0 9 * * *',
      timezone: (existingTask && existingTask.timezone) || tz,
      saving: false,
      error: ''
    };
    renderProjectScheduledModal();
  }

  function buildScheduledTaskModelGroups(currentModelId) {
    const api = discoverModelSelectorApi() || buildReduxModelSelectorApi();
    const rawOpts = api && Array.isArray(api.modelOptions) ? api.modelOptions : [];
    const customOpts = api && Array.isArray(api.customModels) ? api.customModels : [];
    const seenIds = new Set();
    const dynamicOpts = [];
    for (const o of rawOpts.concat(customOpts)) {
      if (!o || o.disabled || !o.label) continue;
      const id = typeof o.modelId === 'string' ? o.modelId.trim() : '';
      if (!id || seenIds.has(id)) continue;
      seenIds.add(id);
      dynamicOpts.push(o);
    }

    if (!dynamicOpts.length) {
      const flatOptions = [
        { value: 'gemini-4-neon-high', label: 'Gemini 4 Neon High' },
        { value: 'gemini-4-argon-high', label: 'Gemini 4 Argon High' },
        { value: 'gemini-4-carbon-high', label: 'Gemini 4 Carbon High' },
        { value: 'gemini-4-hydrogen-low', label: 'Gemini 4 Hydrogen Low' }
      ];
      if (currentModelId && !flatOptions.some((m) => m.value === currentModelId)) {
        flatOptions.push({ value: currentModelId, label: currentModelId });
      }
      return { groups: [], flatOptions, extraOptions: [] };
    }

    const buckets = { primary: new Map(), orch: new Map(), other: new Map() };
    for (const o of dynamicOpts) {
      const parsed = parseModelLabelEffort(o.label);
      const isOrch = isOrchestratorModelOpt(o);
      const famMap = buckets[isOrch ? 'orch' : /^gemini\b/i.test(parsed.baseName) ? 'primary' : 'other'];
      let fam = famMap.get(parsed.baseName);
      if (!fam) {
        fam = { baseName: parsed.baseName, variants: [] };
        famMap.set(parsed.baseName, fam);
      }
      fam.variants.push({
        effort: parsed.effort,
        opt: o,
        label: parsed.effort ? `${parsed.baseName} · ${displayEffortLabel(parsed.effort)}` : parsed.baseName
      });
    }

    const toOptions = (famList) => {
      const out = [];
      for (const fam of famList) {
        sortFamilyVariants(fam.variants);
        for (const v of fam.variants) out.push({ value: v.opt.modelId, label: v.label });
      }
      return out;
    };

    const primaryFams = Array.from(buckets.primary.values()).sort(
      (a, b) => modelCoreRank(a.baseName) - modelCoreRank(b.baseName)
    );
    const groups = [
      { label: L('主力模型', 'Primary models'), options: toOptions(primaryFams) },
      { label: L('多智能体编排', 'Orchestrators'), options: toOptions(Array.from(buckets.orch.values())) },
      { label: L('其他模型', 'Other models'), options: toOptions(Array.from(buckets.other.values())) }
    ].filter((g) => g.options.length > 0);

    const extraOptions =
      currentModelId && !groups.some((g) => g.options.some((o) => o.value === currentModelId))
        ? [{ value: currentModelId, label: currentModelId }]
        : [];
    return { groups, flatOptions: [], extraOptions };
  }

  function renderProjectScheduledModal() {
    if (!projectsModalState || projectsModalState.kind !== 'scheduled') return;
    if (!projectsModalEl || !projectsModalEl.isConnected) {
      projectsModalEl = document.createElement('div');
      projectsModalEl.id = 'ag-claude-project-modal';
      projectsModalEl.setAttribute('data-ag-i18n-ignore', '1');
      projectsModalEl.addEventListener('click', (e) => {
        if (e.target === projectsModalEl) closeProjectsModal();
      });
      document.body.appendChild(projectsModalEl);
    }

    const st = projectsModalState;
    const isEdit = Boolean(st.editingId);
    const ctx = projectsContextMap[st.dirPath] || null;
    const extraFolders = ctx && Array.isArray(ctx.extraFolders) ? ctx.extraFolders : [];
    const folderOptions = [
      { absPath: st.dirPath, label: `${st.project.name} (${L('主目录', 'Primary')})` },
      ...extraFolders.map((f) => ({ absPath: f.absPath, label: f.name || f.absPath }))
    ];
    if (st.folderPath && !folderOptions.some((o) => o.absPath === st.folderPath)) {
      const segs = st.folderPath.split('/').filter(Boolean);
      folderOptions.push({ absPath: st.folderPath, label: segs[segs.length - 1] || st.folderPath });
    }

    const modelData = buildScheduledTaskModelGroups(st.model);
    const renderSchedModelOpt = (m) =>
      `<option value="${escapeHtml(m.value)}"${m.value === st.model ? ' selected' : ''}>${escapeHtml(m.label)}</option>`;
    const modelOptionsHtml =
      renderSchedModelOpt({ value: '', label: L('默认模型', 'Default model') }) +
      modelData.flatOptions.map(renderSchedModelOpt).join('') +
      modelData.groups
        .map(
          (grp) =>
            `<optgroup label="${escapeHtml(grp.label)}">${grp.options.map(renderSchedModelOpt).join('')}</optgroup>`
        )
        .join('') +
      modelData.extraOptions.map(renderSchedModelOpt).join('');

    const freqOptions = [
      { value: 'manual', label: L('手动', 'Manual') },
      { value: 'hourly', label: L('每小时', 'Hourly') },
      { value: 'daily', label: L('每天', 'Daily') },
      { value: 'weekdays', label: L('工作日（周一至周五）', 'Weekdays (Mon–Fri)') },
      { value: 'weekly', label: L('每周', 'Weekly') },
      { value: 'custom', label: L('自定义 Cron', 'Custom cron') }
    ];

    let freqExtraHtml = '';
    if (st.frequency === 'hourly') {
      const mins = [0, 15, 30, 45];
      freqExtraHtml = `<select id="ag-sched-minute" class="ag-sched-select" aria-label="${escapeHtml(L('分钟', 'Minute'))}">${mins
        .map((m) => `<option value="${m}"${Number(st.minute) === m ? ' selected' : ''}>:${String(m).padStart(2, '0')}</option>`)
        .join('')}</select>`;
    } else if (st.frequency === 'daily' || st.frequency === 'weekdays') {
      freqExtraHtml = `<input id="ag-sched-time" class="ag-sched-time-input" type="time" value="${escapeHtml(st.time || '09:00')}" />`;
    } else if (st.frequency === 'weekly') {
      const days = [
        { v: 1, l: L('周一', 'Monday') },
        { v: 2, l: L('周二', 'Tuesday') },
        { v: 3, l: L('周三', 'Wednesday') },
        { v: 4, l: L('周四', 'Thursday') },
        { v: 5, l: L('周五', 'Friday') },
        { v: 6, l: L('周六', 'Saturday') },
        { v: 0, l: L('周日', 'Sunday') }
      ];
      freqExtraHtml = `<select id="ag-sched-dow" class="ag-sched-select" aria-label="${escapeHtml(L('星期', 'Day of week'))}">${days
        .map((d) => `<option value="${d.v}"${Number(st.dayOfWeek) === d.v ? ' selected' : ''}>${escapeHtml(d.l)}</option>`)
        .join('')}</select><input id="ag-sched-time" class="ag-sched-time-input" type="time" value="${escapeHtml(st.time || '09:00')}" />`;
    } else if (st.frequency === 'custom') {
      freqExtraHtml = `<input id="ag-sched-cron" class="ag-sched-cron-input" type="text" value="${escapeHtml(st.customCron || '0 9 * * *')}" placeholder="0 9 * * *" />`;
    }

    const canSave = Boolean(st.name.trim() && st.description.trim() && st.instructions.trim() && !st.saving);
    const errHtml = st.error ? `<div class="ag-pm-error">${escapeHtml(st.error)}</div>` : '';
    const autoHintHtml =
      st.frequency !== 'manual'
        ? `<div class="ag-sched-hint">${escapeHtml(
            L(
              `保存后同步写入 Antigravity 原生「自动化任务」（时区 ${st.timezone}），可在左侧「自动化任务」中启用调度，或直接点 ▶ 立即试跑。`,
              `Syncs to Antigravity Automations (${st.timezone}). Enable it in the Automations dashboard or click ▶ to run now.`
            )
          )}</div>`
        : '';

    projectsModalEl.innerHTML = `
      <div class="ag-pm-dialog ag-pm-sched-dialog" role="dialog" aria-modal="true" aria-label="${escapeHtml(
        isEdit ? L('编辑定时任务', 'Edit scheduled task') : L('创建定时任务', 'Create scheduled task')
      )}">
        <div class="ag-pm-hdr ag-sched-hdr">
          <h2 class="ag-pm-title">${escapeHtml(
            isEdit ? L('编辑定时任务', 'Edit scheduled task') : L('创建定时任务', 'Create scheduled task')
          )}</h2>
          <button type="button" class="ag-pm-close" data-ag-pm-close="true" aria-label="${escapeHtml(L('关闭', 'Close'))}">×</button>
        </div>

        <div class="ag-sched-field">
          <label class="ag-sched-label" for="ag-sched-name">${L('名称', 'Name')} <span class="ag-sched-req">*</span></label>
          <input id="ag-sched-name" class="ag-sched-input" type="text" value="${escapeHtml(st.name)}" placeholder="daily-briefing" />
        </div>

        <div class="ag-sched-field">
          <label class="ag-sched-label" for="ag-sched-desc">${L('描述', 'Description')} <span class="ag-sched-req">*</span></label>
          <input id="ag-sched-desc" class="ag-sched-input" type="text" value="${escapeHtml(st.description)}" placeholder="${escapeHtml(
            L('汇总今日日程与待办事项', 'Summarize my calendar and inbox for the day')
          )}" />
        </div>

        <div class="ag-sched-field">
          <label class="ag-sched-label" for="ag-sched-instructions">${L('执行指令', 'Instructions')} <span class="ag-sched-req">*</span></label>
          <div class="ag-sched-inst-box">
            <textarea id="ag-sched-instructions" class="ag-sched-textarea" rows="5" placeholder="${escapeHtml(
              L('汇总今日日程与未读邮件，标出需要优先处理的紧急事项。', 'Summarize my calendar and unread emails. Flag anything urgent.')
            )}">${escapeHtml(st.instructions)}</textarea>
            <div class="ag-sched-inst-bar">
              <label class="ag-sched-picker-wrap">
                <span class="ag-sched-picker-icon">${SVG_CLAUDE_PROJECTS_ICON}</span>
                <select id="ag-sched-folder" class="ag-sched-inline-select" aria-label="${escapeHtml(L('工作文件夹', 'Work in a folder'))}">
                  ${folderOptions
                    .map(
                      (o) =>
                        `<option value="${escapeHtml(o.absPath)}"${o.absPath === st.folderPath ? ' selected' : ''}>${escapeHtml(o.label)}</option>`
                    )
                    .join('')}
                  <option value="__add_folder__">${L('+ 添加文件夹…', '+ Add folder…')}</option>
                </select>
              </label>
              <label class="ag-sched-picker-wrap ag-sched-picker-model">
                <select id="ag-sched-model" class="ag-sched-inline-select" aria-label="${escapeHtml(L('模型', 'Model'))}">
                  ${modelOptionsHtml}
                </select>
              </label>
            </div>
          </div>
        </div>

        <div class="ag-sched-freq-row">
          <label class="ag-sched-label ag-sched-freq-lbl" for="ag-sched-freq">${L('执行频率', 'Frequency')}</label>
          <div class="ag-sched-freq-controls">
            <select id="ag-sched-freq" class="ag-sched-select">
              ${freqOptions
                .map(
                  (o) =>
                    `<option value="${escapeHtml(o.value)}"${o.value === st.frequency ? ' selected' : ''}>${escapeHtml(o.label)}</option>`
                )
                .join('')}
            </select>
            ${freqExtraHtml}
          </div>
        </div>

        ${autoHintHtml}
        ${errHtml}

        <div class="ag-pm-footer ag-sched-footer">
          ${
            isEdit
              ? `<button type="button" class="ag-sched-del-btn" data-ag-sched-del="true" ${st.saving ? 'disabled' : ''}>${L('删除任务', 'Delete')}</button>`
              : '<span></span>'
          }
          <div class="ag-sched-footer-right">
            <button type="button" class="ag-pm-secondary-btn" data-ag-pm-close="true">${L('取消', 'Cancel')}</button>
            <button type="button" class="ag-pm-primary-btn" data-ag-sched-save="true" ${canSave ? '' : 'disabled'}>${
              st.saving ? L('保存中…', 'Saving…') : L('保存', 'Save')
            }</button>
          </div>
        </div>
      </div>
    `;

    const nameEl = projectsModalEl.querySelector('#ag-sched-name');
    const descEl = projectsModalEl.querySelector('#ag-sched-desc');
    const instEl = projectsModalEl.querySelector('#ag-sched-instructions');
    const saveBtn = projectsModalEl.querySelector('[data-ag-sched-save]');
    const syncSaveDisabled = () => {
      if (!saveBtn || !projectsModalState) return;
      saveBtn.disabled = !(
        projectsModalState.name.trim() &&
        projectsModalState.description.trim() &&
        projectsModalState.instructions.trim() &&
        !projectsModalState.saving
      );
    };
    if (nameEl) {
      if (!isEdit && !st.name) nameEl.focus();
      nameEl.addEventListener('input', () => {
        if (!projectsModalState) return;
        projectsModalState.name = nameEl.value;
        syncSaveDisabled();
      });
    }
    if (descEl) {
      descEl.addEventListener('input', () => {
        if (!projectsModalState) return;
        projectsModalState.description = descEl.value;
        syncSaveDisabled();
      });
    }
    if (instEl) {
      instEl.addEventListener('input', () => {
        if (!projectsModalState) return;
        projectsModalState.instructions = instEl.value;
        syncSaveDisabled();
      });
    }

    const folderSel = projectsModalEl.querySelector('#ag-sched-folder');
    if (folderSel) {
      folderSel.addEventListener('change', async () => {
        const modalRef = projectsModalState;
        if (!modalRef) return;
        if (folderSel.value === '__add_folder__') {
          if (typeof window.__agProjectCall === 'function') {
            try {
              const picked = await window.__agProjectCall('pickFolder', {}, 120000);
              if (disposed || projectsModalState !== modalRef) return;
              if (picked && picked.ok && !picked.canceled && picked.folderPath) {
                const nextPath = picked.folderPath;
                if (nextPath !== modalRef.dirPath) {
                  const saveRes = await saveProjectContextDelta(modalRef.project, (draft) => {
                    const nextExtra = draft.extraFolders.slice();
                    if (!nextExtra.some((f) => f.absPath === nextPath)) {
                      nextExtra.push({
                        name: picked.name || nextPath.split(/[\\/]/).pop() || nextPath,
                        absPath: nextPath
                      });
                    }
                    return Object.assign({}, draft, { extraFolders: nextExtra });
                  });
                  if (disposed || projectsModalState !== modalRef) return;
                  if (saveRes && saveRes.ok === false) {
                    modalRef.error =
                      L('关联文件夹保存失败：', 'Failed to link folder: ') + String(saveRes.error || 'unknown');
                  } else {
                    modalRef.folderPath = nextPath;
                    modalRef.error = '';
                  }
                } else {
                  modalRef.folderPath = nextPath;
                  modalRef.error = '';
                }
              }
            } catch (err) {
              if (!disposed && projectsModalState === modalRef) {
                modalRef.error =
                  L('关联文件夹保存失败：', 'Failed to link folder: ') + String((err && err.message) || err);
              }
            }
          }
          if (!disposed && projectsModalState === modalRef) renderProjectScheduledModal();
          return;
        }
        modalRef.folderPath = folderSel.value || modalRef.dirPath;
      });
    }

    const modelSel = projectsModalEl.querySelector('#ag-sched-model');
    if (modelSel) {
      modelSel.addEventListener('change', () => {
        if (projectsModalState) projectsModalState.model = modelSel.value || '';
      });
    }

    const freqSel = projectsModalEl.querySelector('#ag-sched-freq');
    if (freqSel) {
      freqSel.addEventListener('change', () => {
        if (!projectsModalState) return;
        projectsModalState.frequency = freqSel.value || 'manual';
        renderProjectScheduledModal();
      });
    }

    const minSel = projectsModalEl.querySelector('#ag-sched-minute');
    if (minSel) {
      minSel.addEventListener('change', () => {
        if (projectsModalState) projectsModalState.minute = Number(minSel.value) || 0;
      });
    }
    const timeEl = projectsModalEl.querySelector('#ag-sched-time');
    if (timeEl) {
      timeEl.addEventListener('input', () => {
        if (projectsModalState) projectsModalState.time = timeEl.value || '09:00';
      });
    }
    const dowSel = projectsModalEl.querySelector('#ag-sched-dow');
    if (dowSel) {
      dowSel.addEventListener('change', () => {
        if (projectsModalState) projectsModalState.dayOfWeek = Number(dowSel.value);
      });
    }
    const cronEl = projectsModalEl.querySelector('#ag-sched-cron');
    if (cronEl) {
      cronEl.addEventListener('input', () => {
        if (projectsModalState) projectsModalState.customCron = cronEl.value;
      });
    }

    projectsModalEl.querySelectorAll('[data-ag-pm-close]').forEach((b) => {
      b.addEventListener('click', () => closeProjectsModal());
    });

    const delBtn = projectsModalEl.querySelector('[data-ag-sched-del]');
    if (delBtn) {
      delBtn.addEventListener('click', async () => {
        const modalRef = projectsModalState;
        if (!modalRef || modalRef.saving) return;
        if (!modalRef.confirmDelete) {
          modalRef.confirmDelete = true;
          delBtn.textContent = L('再次点击确认删除', 'Click again to confirm');
          return;
        }
        modalRef.saving = true;
        modalRef.error = '';
        renderProjectScheduledModal();
        const res = await deleteProjectScheduledTaskFromUi(modalRef.project, {
          id: modalRef.editingId,
          sidecarId: modalRef.sidecarId
        });
        if (disposed || projectsModalState !== modalRef) return;
        if (res && res.ok) {
          closeProjectsModal();
        } else {
          modalRef.saving = false;
          modalRef.confirmDelete = false;
          modalRef.error = L('删除失败：', 'Delete failed: ') + String((res && res.error) || 'unknown');
          renderProjectScheduledModal();
        }
      });
    }

    if (saveBtn) {
      saveBtn.addEventListener('click', async () => {
        const modalRef = projectsModalState;
        if (!modalRef || modalRef.saving) return;
        if (typeof window.__agProjectCall !== 'function') {
          modalRef.error = L('本地写入桥接不可用，请重启 Anti-Claude 守护进程', 'Local write bridge unavailable');
          renderProjectScheduledModal();
          return;
        }
        modalRef.saving = true;
        modalRef.error = '';
        renderProjectScheduledModal();
        const res = await window.__agProjectCall(
          'saveScheduledTask',
          {
            dirPath: modalRef.dirPath,
            task: {
              id: modalRef.editingId || undefined,
              sidecarId: modalRef.sidecarId || undefined,
              name: modalRef.name,
              description: modalRef.description,
              instructions: modalRef.instructions,
              folderPath: modalRef.folderPath,
              model: modalRef.model,
              frequency: modalRef.frequency,
              time: modalRef.time,
              dayOfWeek: modalRef.dayOfWeek,
              minute: modalRef.minute,
              customCron: modalRef.customCron,
              timezone: modalRef.timezone
            }
          },
          20000
        );
        if (disposed || projectsModalState !== modalRef) return;
        if (res && res.ok) {
          projectsContextMap[modalRef.dirPath] = res;
          closeProjectsModal();
          if (projectsViewOpen) renderProjectsView();
          invalidateOverviewSnapshotCache();
        } else {
          modalRef.saving = false;
          modalRef.error = L('保存失败：', 'Save failed: ') + String((res && res.error) || 'unknown');
          renderProjectScheduledModal();
        }
      });
    }
  }

  function openProjectsView(targetProjectId) {
    projectsViewOpen = true;
    projectsOpenedPathname = String((window.location && window.location.pathname) || '');
    activeProjectId = typeof targetProjectId === 'string' && targetProjectId ? targetProjectId : null;
    projectSelectedFolderPath = '';
    ensureProjectsSidebarObserver();
    const el = ensureProjectsViewEl();
    renderProjectsView();
    positionProjectsOverlay();
    el.setAttribute('data-open', 'true');
    updateProjectsNavActiveVisual();
    refreshProjectsContexts(collectNativeProjects());
  }

  function toggleProjectsView() {
    if (projectsViewOpen && activeProjectId) {
      activeProjectId = null;
      renderProjectsView();
    } else if (projectsViewOpen) {
      closeProjectsView();
    } else {
      openProjectsView();
    }
  }

  function refreshProjectsLanguageUi() {
    updateProjectsNavActiveVisual();
    if (projectsViewOpen) renderProjectsView();
    if (projectMenuState) renderProjectActionMenu();
    if (projectsModalState) {
      if (projectsModalState.kind === 'scheduled') renderProjectScheduledModal();
      else if (projectsModalState.kind === 'renameProject') renderRenameProjectModal();
      else renderProjectContextModal();
    }
  }

  let sidebarHideScrollEl = null;
  let sidebarListLayoutMo = null;
  let sidebarListLayoutTarget = null;

  function syncPinnedSidebarRowTooltips(root) {
    const scope = root || document;
    const rows = scope.querySelectorAll('[data-testid="conversation-row-sidebar"][data-pinned="true"][data-subtext]');
    for (const row of rows) {
      const subtext = String(row.getAttribute('data-subtext') || '').trim();
      const link = row.querySelector('a[href]');
      if (!subtext) {
        if (link && link.getAttribute('data-ag-pin-tip') === '1') {
          link.removeAttribute('title');
          link.removeAttribute('data-ag-pin-tip');
        }
        continue;
      }
      const titleSpan = row.querySelector('.flex-col > span');
      const baseTitle = String((link && link.getAttribute('aria-label')) || (titleSpan && titleSpan.textContent) || '').trim();
      const tip = baseTitle ? `${baseTitle}\n${L('所属项目：', 'Project: ')}${subtext}` : `${L('所属项目：', 'Project: ')}${subtext}`;
      const target = link || row;
      if (target.getAttribute('title') !== tip) {
        target.setAttribute('title', tip);
        target.setAttribute('data-ag-pin-tip', '1');
      }
    }
  }

  function clearPinnedSidebarRowTooltips() {
    document.querySelectorAll('[data-ag-pin-tip="1"]').forEach((el) => {
      el.removeAttribute('title');
      el.removeAttribute('data-ag-pin-tip');
    });
  }

  function parseVirtualTranslateY(el) {
    if (!el) return 0;
    const tf = String((el.style && el.style.transform) || '');
    const m = tf.match(/translateY\(([-\d.]+)px\)/i);
    if (m) return Number(m[1]) || 0;
    return 0;
  }

  function clearSidebarHideNativeProjects() {
    if (sidebarHideScrollEl) {
      sidebarHideScrollEl.removeEventListener('scroll', onSidebarHideScroll);
      sidebarHideScrollEl = null;
    }
    if (sidebarListLayoutMo) {
      try {
        sidebarListLayoutMo.disconnect();
      } catch {}
      sidebarListLayoutMo = null;
      sidebarListLayoutTarget = null;
    }
    const scrollBox = document.querySelector('[data-testid="conversation-list-sidebar"]');
    const { host: sbParent } = getSidebarListHost(scrollBox);
    if (sbParent) {
      sbParent.removeAttribute('data-ag-sb-unified');
      sbParent.style.removeProperty('--ag-sb-pinned-height');
    }
    if (scrollBox && scrollBox !== sbParent) {
      scrollBox.removeAttribute('data-ag-sb-unified');
      scrollBox.style.removeProperty('--ag-sb-pinned-height');
    }
    const list = scrollBox && scrollBox.firstElementChild;
    if (!list) return;
    list.style.removeProperty('--ag-sb-proj-shift');
    delete list.dataset.agProjIdx;
    delete list.dataset.agConvIdx;
    delete list.dataset.agProjShift;
    delete list.dataset.agCutIdx;
    delete list.dataset.agPinnedH;
    for (const child of list.children) {
      child.removeAttribute('data-ag-sb-hide-proj');
      child.removeAttribute('data-ag-sb-shift-up');
    }
  }

  function onSidebarHideScroll() {
    syncSidebarHideNativeProjects();
  }

  function syncSidebarHideNativeProjects() {
    const scrollBox = document.querySelector('[data-testid="conversation-list-sidebar"]');
    if (scrollBox && !disposed) {
      syncPinnedSidebarRowTooltips(scrollBox);
    }
    if (disposed || !FEAT.hideSidebarProjects) {
      clearSidebarHideNativeProjects();
      return;
    }
    const { host: sbParent } = getSidebarListHost(scrollBox);
    const list = scrollBox && scrollBox.firstElementChild;
    if (!scrollBox || !sbParent || !list) return;

    /* Guard against hiding native sidebar lists when Unified Recents failed to mount on a live React host */
    const hasReactHost = Boolean(
      document.getElementById('root') ||
        Object.keys(list).some((k) => k.startsWith('__react')) ||
        Object.keys(scrollBox).some((k) => k.startsWith('__react'))
    );
    if (hasReactHost && !document.getElementById('ag-claude-recent-section')) {
      const bindings = findSidebarBindings();
      if (bindings) {
        syncRecentSection(
          bindings,
          bindings.store.getState(),
          getActiveCascadeId(),
          typeof document.hasFocus === 'function' ? document.hasFocus() : true
        );
      }
      if (!document.getElementById('ag-claude-recent-section')) {
        clearSidebarHideNativeProjects();
        return;
      }
    }

    const indexed = [];
    for (const child of list.children) {
      const rawIdx = child.getAttribute('data-index');
      if (rawIdx === null || rawIdx === '') continue;
      const idx = Number(rawIdx);
      if (Number.isFinite(idx)) indexed.push({ idx, el: child });
    }
    if (!indexed.length) return;
    indexed.sort((a, b) => a.idx - b.idx);

    /* Sections that stay native above the cut: Pinned and (v2.34+) Coordinators, which the native list
       renders BEFORE Pinned. Match by testid / data-title first so localized header text cannot misfire. */
    const KEPT_HDR_RE = /^(pinned|置顶对话|coordinators|协调器|编排器)$/i;
    const isKeptSectionHeader = (sh) =>
      Boolean(
        sh &&
        (sh.querySelector('[data-testid="pinned-section-header"], [data-testid="coordinator-section-header"]') ||
          KEPT_HDR_RE.test(String(sh.getAttribute('data-title') || '').trim()) ||
          KEPT_HDR_RE.test(String(sh.textContent || '').trim()))
      );
    let cutItem = indexed.find((x) => Boolean(x.el.querySelector('[data-testid="sidebar-add-project-button"]')));
    if (!cutItem) {
      cutItem = indexed.find((x) => {
        const sh = x.el.querySelector('[data-testid="section-header"]');
        return Boolean(sh && !isKeptSectionHeader(sh));
      });
    }

    if (cutItem) {
      const pinnedH = cutItem.idx === 0 ? 0 : Math.max(0, Math.round(parseVirtualTranslateY(cutItem.el)));
      list.dataset.agCutIdx = String(cutItem.idx);
      list.dataset.agPinnedH = String(pinnedH);
    }

    const hasPinnedHdr = indexed.some((x) => {
      const sh = x.el.querySelector('[data-testid="section-header"]');
      return isKeptSectionHeader(sh);
    });

    if (list.dataset.agCutIdx === undefined && !hasPinnedHdr) {
      /* Structure did not match any known section header — do NOT lock scrollTop or hide native list */
      clearSidebarHideNativeProjects();
      return;
    }

    /* Bind scroll lock & virtual-list observer only after confirming the native sidebar structure matches */
    if (sidebarHideScrollEl !== scrollBox) {
      if (sidebarHideScrollEl) sidebarHideScrollEl.removeEventListener('scroll', onSidebarHideScroll);
      sidebarHideScrollEl = scrollBox;
      scrollBox.addEventListener('scroll', onSidebarHideScroll, { passive: true });
    }
    if (typeof MutationObserver !== 'undefined' && sidebarListLayoutTarget !== list) {
      if (sidebarListLayoutMo) {
        try {
          sidebarListLayoutMo.disconnect();
        } catch {}
      }
      sidebarListLayoutTarget = list;
      sidebarListLayoutMo = new MutationObserver((muts) => {
        if (disposed || !FEAT.hideSidebarProjects) return;
        for (const m of muts) {
          if (m.attributeName === 'data-subtext') {
            syncPinnedSidebarRowTooltips(scrollBox);
            return;
          }
          if (m.attributeName === 'style' && m.target && m.target.parentElement === list) {
            syncSidebarHideNativeProjects();
            return;
          }
        }
      });
      sidebarListLayoutMo.observe(list, {
        subtree: true,
        attributes: true,
        attributeFilter: ['style', 'data-subtext']
      });
    }
    if (scrollBox.scrollTop > 0) {
      try {
        scrollBox.scrollTop = 0;
      } catch {}
    }

    if (list.dataset.agCutIdx === undefined) {
      // Only pinned section exists in virtual list (no native Projects/Conversations headers rendered)
      const last = indexed[indexed.length - 1];
      const estH = Math.max(0, Math.round(parseVirtualTranslateY(last.el) + ((last.el.getBoundingClientRect && last.el.getBoundingClientRect().height) || 33) + 12));
      sbParent.setAttribute('data-ag-sb-unified', estH > 0 ? 'pinned' : 'empty');
      sbParent.style.setProperty('--ag-sb-pinned-height', `${estH}px`);
      for (const { el } of indexed) {
        el.removeAttribute('data-ag-sb-hide-proj');
        el.removeAttribute('data-ag-sb-shift-up');
      }
      return;
    }

    let cutIdx = Number(list.dataset.agCutIdx);
    let pinnedH = Number(list.dataset.agPinnedH) || 0;
    /* If a newly pinned row pushed past the cached cutIdx while the cut header scrolled out, expand cutIdx safely */
    if (!cutItem) {
      let maxPinnedIdx = -1;
      let maxPinnedBottom = pinnedH;
      for (const { idx, el } of indexed) {
        const rowEl = el.querySelector('[data-testid="conversation-row-sidebar"][data-pinned="true"]');
        if (rowEl) {
          if (idx > maxPinnedIdx) maxPinnedIdx = idx;
          const b = Math.round(parseVirtualTranslateY(el) + ((el.getBoundingClientRect && el.getBoundingClientRect().height) || 33));
          if (b > maxPinnedBottom) maxPinnedBottom = b;
        }
      }
      if (maxPinnedIdx >= cutIdx) {
        cutIdx = maxPinnedIdx + 1;
        pinnedH = maxPinnedBottom;
        list.dataset.agCutIdx = String(cutIdx);
        list.dataset.agPinnedH = String(pinnedH);
      }
    }
    sbParent.setAttribute('data-ag-sb-unified', pinnedH > 0 ? 'pinned' : 'empty');
    sbParent.style.setProperty('--ag-sb-pinned-height', `${pinnedH}px`);
    list.style.removeProperty('--ag-sb-proj-shift');

    for (const { idx, el } of indexed) {
      el.removeAttribute('data-ag-sb-shift-up');
      const isPinnedRow = Boolean(el.querySelector('[data-testid="conversation-row-sidebar"][data-pinned="true"]'));
      if (idx >= cutIdx && !isPinnedRow) {
        el.setAttribute('data-ag-sb-hide-proj', '1');
      } else {
        el.removeAttribute('data-ag-sb-hide-proj');
      }
    }
  }

  function teardownProjectsWorkspace(opts = {}) {
    closeProjectsView({ forceCloseAllModals: Boolean(opts.forceCloseAllModals) });
    projectMgmtSvcRef = null;
    cascadeRpcSvcRef = null;
    projectComposerMentions.clear();
    projectComposerMedia.clear();
    pdMentionCache.rulesByKey.clear();
    pdMentionCache.pluginsByKey.clear();
    optimisticallyDeletedProjectIds.clear();
    optimisticallyArchivedProjectIds.clear();
    optimisticProjectNames.clear();
    const btn = document.getElementById('ag-claude-projects-nav-btn');
    if (btn) btn.remove();
    if (projectsViewEl) {
      projectsViewEl.remove();
      projectsViewEl = null;
    }
    if (projectsSidebarRo) {
      try {
        projectsSidebarRo.disconnect();
      } catch {}
      projectsSidebarRo = null;
      projectsSidebarRoTarget = null;
    }
    if (projectsDocListenerBound) {
      document.removeEventListener('click', onProjectsGlobalClick, true);
      document.removeEventListener('keydown', onProjectsGlobalKeyDown, true);
      window.removeEventListener('resize', positionProjectsOverlay);
      window.removeEventListener('popstate', onProjectsNavRouteChange);
      projectsDocListenerBound = false;
    }
  }

  function onProjectsNavRouteChange() {
    if (!projectsViewOpen) return;
    const curPath = String((window.location && window.location.pathname) || '');
    const curSearch = String((window.location && window.location.search) || '');
    if (curPath !== projectsOpenedPathname || /(?:^|[?&])settingsOpen=true(?:&|$)/i.test(curSearch)) {
      closeProjectsView();
    }
  }

  /* ==========================================================================
   * 10. Claude-Style Customizations Enhancement (`claudeUxCustomizations`)
   *     - Non-destructively adds category tabs (Skills / Plugins / MCP / Agents / All)
   *       on `/customizations/installed`, crisp sticky header border (no clipped cards),
   *       framed Claude card rows for Skills & Rules, and local `+ Add skill` + Open Folder.
   * ========================================================================== */
  let custActiveCat = 'skills';
  let custUserPickedCat = false;
  let custSearchInputRef = null;

  function onCustSearchInput() {
    syncCustomizationsEnhancement();
  }

  function teardownCustomizationsEnhancement() {
    if (custSearchInputRef) {
      custSearchInputRef.removeEventListener('input', onCustSearchInput);
      custSearchInputRef = null;
    }
    const bar = document.getElementById('ag-cust-cat-bar');
    if (bar) bar.remove();
    const skillActions = document.getElementById('ag-cust-skill-actions');
    if (skillActions) skillActions.remove();
    const agentActions = document.getElementById('ag-cust-agent-actions');
    if (agentActions) agentActions.remove();
    document.querySelectorAll('[data-ag-cust-page]').forEach((el) => {
      el.removeAttribute('data-ag-cust-page');
      el.removeAttribute('data-ag-cust-tab');
      el.removeAttribute('data-ag-cust-searching');
    });
    document.querySelectorAll('[data-ag-cust-sticky]').forEach((el) => el.removeAttribute('data-ag-cust-sticky'));
    document.querySelectorAll('[data-ag-cust-sec]').forEach((el) => {
      el.removeAttribute('data-ag-cust-sec');
      el.removeAttribute('data-ag-cust-hidden');
    });
  }

  function classifyCustomizationsSection(sec) {
    if (!sec) return '';
    if (sec.getAttribute('data-testid') === 'customizations-installed-plugins') return 'plugins';
    if (sec.querySelector('[data-testid="skills-rules-filter"]')) return 'skills';
    if (sec.querySelector('[data-testid="add-mcp-button"]')) return 'mcp';
    const h3 = sec.querySelector('h3');
    const txt = h3 ? (h3.textContent || '').trim() : '';
    if (/Skills\s*&\s*Rules|技能与规则/i.test(txt)) return 'skills';
    if (/Custom Agents|自定义.*Agent|自定义智能体|自定义代理/i.test(txt)) return 'agents';
    if (/MCP/i.test(txt)) return 'mcp';
    if (/Installed Plugins|Plugins|已安装插件|插件/i.test(txt)) return 'plugins';
    return '';
  }

  function openAddSkillModal() {
    ensureSharedModalEscBound();
    closeProjectsModal();
    projectsModalState = {
      kind: 'addSkill',
      mode: 'create',
      name: '',
      description: '',
      instructions: '',
      saving: false,
      error: '',
      successMsg: '',
      createdDir: ''
    };
    renderAddSkillModal();
  }

  function renderAddSkillModal() {
    if (!projectsModalState || projectsModalState.kind !== 'addSkill') return;
    if (!projectsModalEl || !projectsModalEl.isConnected) {
      projectsModalEl = document.createElement('div');
      projectsModalEl.id = 'ag-claude-project-modal';
      projectsModalEl.setAttribute('data-ag-i18n-ignore', '1');
      projectsModalEl.addEventListener('click', (e) => {
        if (e.target === projectsModalEl) closeProjectsModal();
      });
      document.body.appendChild(projectsModalEl);
    }

    const st = projectsModalState;
    const isCreate = st.mode === 'create';
    const canSave = Boolean(st.name.trim() && st.description.trim() && st.instructions.trim() && !st.saving);
    const errHtml = st.error ? `<div class="ag-pm-error">${escapeHtml(st.error)}</div>` : '';
    const okHtml = st.successMsg
      ? `<div class="ag-cust-ok-banner"><span>${escapeHtml(st.successMsg)}</span>${
          st.createdDir
            ? `<button type="button" class="ag-cust-ok-open" data-ag-skill-reveal="${escapeHtml(st.createdDir)}">${L('打开目录', 'Open folder')}</button>`
            : ''
        }</div>`
      : '';

    const bodyHtml = isCreate
      ? `
        <div class="ag-sched-field">
          <label class="ag-sched-label" for="ag-skill-name">${L('技能名称', 'Skill name')} <span class="ag-sched-req">*</span></label>
          <input id="ag-skill-name" class="ag-sched-input" type="text" value="${escapeHtml(st.name)}" placeholder="contract-audit" />
        </div>
        <div class="ag-sched-field">
          <label class="ag-sched-label" for="ag-skill-desc">${L('触发描述', 'Description')} <span class="ag-sched-req">*</span></label>
          <input id="ag-skill-desc" class="ag-sched-input" type="text" value="${escapeHtml(st.description)}" placeholder="${escapeHtml(
            L('说明何时自动激活该技能（例如：审查商事合同条款并标出风险点）', 'Describe when the agent should activate this skill')
          )}" />
        </div>
        <div class="ag-sched-field">
          <label class="ag-sched-label" for="ag-skill-body">${L('技能正文（SKILL.md）', 'Instructions (SKILL.md)')} <span class="ag-sched-req">*</span></label>
          <textarea id="ag-skill-body" class="ag-pm-textarea" rows="6" placeholder="${escapeHtml(
            L('# 执行步骤\n1. 先通读用户提供的材料……', '# Workflow\n1. Read the user material carefully...')
          )}">${escapeHtml(st.instructions)}</textarea>
        </div>
        <div class="ag-sched-hint">${L(
          '保存到 ~/.gemini/config/skills/<技能名称>/SKILL.md，Antigravity 会自动扫描识别。',
          'Saved to ~/.gemini/config/skills/<name>/SKILL.md and auto-discovered by Antigravity.'
        )}</div>
      `
      : `
        <div class="ag-cust-import-box">
          <div class="ag-cust-import-title">${L('从本机文件夹导入技能', 'Import a local skill folder')}</div>
          <p class="ag-cust-import-desc">${L(
            '选择一个包含 SKILL.md 的本地技能文件夹，系统将自动完整复制到 ~/.gemini/config/skills/ 目录中。',
            'Pick a local folder containing SKILL.md. It will be copied into ~/.gemini/config/skills/ automatically.'
          )}</p>
          <div class="ag-cust-import-btns">
            <button type="button" class="ag-pm-primary-btn" data-ag-skill-import="true" ${st.saving ? 'disabled' : ''}>${
              st.saving ? L('导入中…', 'Importing…') : L('选择技能文件夹导入…', 'Choose skill folder…')
            }</button>
            <button type="button" class="ag-pm-secondary-btn" data-ag-skill-open-dir="true">${L('打开技能目录', 'Open skills folder')}</button>
          </div>
        </div>
      `;

    projectsModalEl.innerHTML = `
      <div class="ag-pm-dialog ag-pm-sched-dialog" role="dialog" aria-modal="true" aria-label="${escapeHtml(L('添加技能', 'Add skill'))}">
        <div class="ag-pm-hdr ag-sched-hdr">
          <h2 class="ag-pm-title">${L('添加技能', 'Add skill')}</h2>
          <button type="button" class="ag-pm-close" data-ag-pm-close="true" aria-label="${escapeHtml(L('关闭', 'Close'))}">×</button>
        </div>
        <div class="ag-cust-modal-tabs">
          <button type="button" class="ag-cust-mtab" data-ag-skill-mode="create" data-active="${isCreate ? 'true' : 'false'}">${L('新建技能', 'Create skill')}</button>
          <button type="button" class="ag-cust-mtab" data-ag-skill-mode="import" data-active="${!isCreate ? 'true' : 'false'}">${L('导入本地目录', 'Import folder')}</button>
        </div>
        ${bodyHtml}
        ${okHtml}
        ${errHtml}
        <div class="ag-pm-footer ag-sched-footer">
          <button type="button" class="ag-pm-secondary-btn" data-ag-skill-open-dir="true">${L('打开 ~/.gemini/config/skills', 'Open skills folder')}</button>
          <div class="ag-sched-footer-right">
            <button type="button" class="ag-pm-secondary-btn" data-ag-pm-close="true">${L('关闭', 'Close')}</button>
            ${
              isCreate
                ? `<button type="button" class="ag-pm-primary-btn" data-ag-skill-save="true" ${canSave ? '' : 'disabled'}>${
                    st.saving ? L('创建中…', 'Creating…') : L('创建技能', 'Create skill')
                  }</button>`
                : ''
            }
          </div>
        </div>
      </div>
    `;

    projectsModalEl.querySelectorAll('[data-ag-pm-close]').forEach((b) => {
      b.addEventListener('click', () => closeProjectsModal());
    });
    projectsModalEl.querySelectorAll('[data-ag-skill-mode]').forEach((b) => {
      b.addEventListener('click', () => {
        if (!projectsModalState) return;
        projectsModalState.mode = b.getAttribute('data-ag-skill-mode') || 'create';
        projectsModalState.error = '';
        renderAddSkillModal();
      });
    });
    projectsModalEl.querySelectorAll('[data-ag-skill-open-dir]').forEach((b) => {
      b.addEventListener('click', () => {
        if (typeof window.__agProjectCall === 'function') {
          window.__agProjectCall('openSkillsDir', {}, 5000);
        }
      });
    });
    const revealBtn = projectsModalEl.querySelector('[data-ag-skill-reveal]');
    if (revealBtn) {
      revealBtn.addEventListener('click', () => {
        const p = revealBtn.getAttribute('data-ag-skill-reveal');
        if (p && typeof window.__agProjectCall === 'function') {
          window.__agProjectCall('revealFile', { targetPath: p }, 5000);
        }
      });
    }

    const nameEl = projectsModalEl.querySelector('#ag-skill-name');
    const descEl = projectsModalEl.querySelector('#ag-skill-desc');
    const bodyEl = projectsModalEl.querySelector('#ag-skill-body');
    const saveBtn = projectsModalEl.querySelector('[data-ag-skill-save]');
    const syncBtn = () => {
      if (!saveBtn || !projectsModalState) return;
      saveBtn.disabled = !(
        projectsModalState.name.trim() &&
        projectsModalState.description.trim() &&
        projectsModalState.instructions.trim() &&
        !projectsModalState.saving
      );
    };
    if (nameEl) {
      if (!st.name) nameEl.focus();
      nameEl.addEventListener('input', () => {
        if (!projectsModalState) return;
        projectsModalState.name = nameEl.value;
        syncBtn();
      });
    }
    if (descEl) {
      descEl.addEventListener('input', () => {
        if (!projectsModalState) return;
        projectsModalState.description = descEl.value;
        syncBtn();
      });
    }
    if (bodyEl) {
      bodyEl.addEventListener('input', () => {
        if (!projectsModalState) return;
        projectsModalState.instructions = bodyEl.value;
        syncBtn();
      });
    }
    if (saveBtn) {
      saveBtn.addEventListener('click', async () => {
        const modalRef = projectsModalState;
        if (!modalRef || modalRef.saving) return;
        if (typeof window.__agProjectCall !== 'function') {
          modalRef.error = L('本地写入桥接不可用，请重启 Anti-Claude 守护进程', 'Local write bridge unavailable');
          renderAddSkillModal();
          return;
        }
        modalRef.saving = true;
        modalRef.error = '';
        modalRef.successMsg = '';
        renderAddSkillModal();
        const res = await window.__agProjectCall(
          'createLocalSkill',
          {
            name: modalRef.name,
            description: modalRef.description,
            instructions: modalRef.instructions
          },
          15000
        );
        if (disposed || projectsModalState !== modalRef) return;
        modalRef.saving = false;
        if (res && res.ok) {
          modalRef.name = '';
          modalRef.description = '';
          modalRef.instructions = '';
          modalRef.createdDir = res.dirPath || '';
          modalRef.successMsg = L(`已创建技能「${res.folderName}」，重新进入页面或稍候即可在列表中看到。`, `Skill "${res.folderName}" created successfully.`);
          invalidateOverviewSnapshotCache();
          renderAddSkillModal();
        } else {
          const code = (res && res.error) || 'unknown';
          modalRef.error =
            code === 'skill_already_exists'
              ? L('同名技能目录已存在，请换一个名称。', 'A skill with this folder name already exists.')
              : L('创建失败：', 'Create failed: ') + String(code);
          renderAddSkillModal();
        }
      });
    }

    const importBtn = projectsModalEl.querySelector('[data-ag-skill-import]');
    if (importBtn) {
      importBtn.addEventListener('click', async () => {
        const modalRef = projectsModalState;
        if (!modalRef || modalRef.saving) return;
        if (typeof window.__agProjectCall !== 'function') {
          modalRef.error = L('本地写入桥接不可用', 'Local write bridge unavailable');
          renderAddSkillModal();
          return;
        }
        modalRef.saving = true;
        modalRef.error = '';
        modalRef.successMsg = '';
        renderAddSkillModal();
        const res = await window.__agProjectCall('importLocalSkill', {}, 120000);
        if (disposed || projectsModalState !== modalRef) return;
        modalRef.saving = false;
        if (res && res.ok && res.canceled) {
          renderAddSkillModal();
          return;
        }
        if (res && res.ok) {
          modalRef.createdDir = res.dirPath || '';
          modalRef.successMsg = res.alreadyInstalled
            ? L(`「${res.folderName}」已在全局技能目录中。`, `"${res.folderName}" is already in the skills folder.`)
            : L(`已成功导入技能「${res.folderName}」。`, `Imported skill "${res.folderName}" successfully.`);
          invalidateOverviewSnapshotCache();
          renderAddSkillModal();
        } else {
          const code = (res && res.error) || 'unknown';
          modalRef.error =
            code === 'missing_skill_md'
              ? L('所选文件夹根目录未找到 SKILL.md，请选择包含 SKILL.md 的技能目录。', 'No SKILL.md found in the selected folder.')
              : L('导入失败：', 'Import failed: ') + String(code);
          renderAddSkillModal();
        }
      });
    }
  }

  function openAddAgentModal() {
    ensureSharedModalEscBound();
    closeProjectsModal();
    projectsModalState = {
      kind: 'addAgent',
      mode: 'create',
      name: '',
      description: '',
      roleMode: 'subagent',
      tools: ['read_file', 'search_web'],
      systemPrompt: '',
      saving: false,
      error: '',
      successMsg: '',
      createdPath: ''
    };
    renderAddAgentModal();
  }

  function renderAddAgentModal() {
    if (!projectsModalState || projectsModalState.kind !== 'addAgent') return;
    if (!projectsModalEl || !projectsModalEl.isConnected) {
      projectsModalEl = document.createElement('div');
      projectsModalEl.id = 'ag-claude-project-modal';
      projectsModalEl.setAttribute('data-ag-i18n-ignore', '1');
      projectsModalEl.addEventListener('click', (e) => {
        if (e.target === projectsModalEl) closeProjectsModal();
      });
      document.body.appendChild(projectsModalEl);
    }

    const st = projectsModalState;
    const isCreate = st.mode === 'create';
    const canSave = Boolean(st.name.trim() && st.description.trim() && st.systemPrompt.trim() && !st.saving);
    const errHtml = st.error ? `<div class="ag-pm-error">${escapeHtml(st.error)}</div>` : '';
    const okHtml = st.successMsg
      ? `<div class="ag-cust-ok-banner"><span>${escapeHtml(st.successMsg)}</span>${
          st.createdPath
            ? `<button type="button" class="ag-cust-ok-open" data-ag-agent-reveal="${escapeHtml(st.createdPath)}">${L('在 Finder 查看', 'Reveal')}</button>`
            : ''
        }</div>`
      : '';

    const toolDefs = [
      ['read_file', L('读取文件', 'Read files'), 'read_file'],
      ['search_web', L('联网检索', 'Web search'), 'search_web'],
      ['edit_file', L('编辑文件', 'Edit files'), 'edit_file'],
      ['write_file', L('创建/写入文件', 'Write files'), 'write_file'],
      ['run_command', L('运行命令', 'Run shell'), 'run_command'],
      ['manage_task', L('管理后台任务', 'Manage tasks'), 'manage_task']
    ];
    const selectedSet = new Set(Array.isArray(st.tools) ? st.tools : ['read_file']);
    const hasPreset = (arr) => arr.length === selectedSet.size && arr.every((t) => selectedSet.has(t));

    const bodyHtml = isCreate
      ? `
        <div class="ag-agent-grid-2">
          <div class="ag-sched-field">
            <label class="ag-sched-label" for="ag-agent-name">${L('子 Agent 名称', 'Agent name')} <span class="ag-sched-req">*</span></label>
            <input id="ag-agent-name" class="ag-sched-input" type="text" value="${escapeHtml(st.name)}" placeholder="contract-reviewer" />
          </div>
          <div class="ag-sched-field">
            <label class="ag-sched-label" for="ag-agent-role">${L('角色模式', 'Role mode')}</label>
            <select id="ag-agent-role" class="ag-sched-select ag-agent-full-select">
              <option value="subagent"${st.roleMode === 'subagent' ? ' selected' : ''}>${L('仅子 Agent（推荐，后台委派）', 'Subagent only (Recommended)')}</option>
              <option value="both"${st.roleMode === 'both' ? ' selected' : ''}>${L('子 Agent + 主 Agent', 'Both subagent & main agent')}</option>
              <option value="main_only"${st.roleMode === 'main_only' ? ' selected' : ''}>${L('仅主 Agent', 'Main agent only')}</option>
            </select>
          </div>
        </div>

        <div class="ag-sched-field">
          <label class="ag-sched-label" for="ag-agent-desc">${L('职责描述（主 AI 据此判断何时委派）', 'Description (when to delegate)')} <span class="ag-sched-req">*</span></label>
          <input id="ag-agent-desc" class="ag-sched-input" type="text" value="${escapeHtml(st.description)}" placeholder="${escapeHtml(
            L('例如：专注核对合同与证据原件的只读审计专员，输出逐条出处与风险点', 'Specialized reviewer for contracts and evidence citations')
          )}" />
        </div>

        <div class="ag-sched-field">
          <div class="ag-agent-tools-hdr">
            <label class="ag-sched-label" style="margin-bottom:0 !important;">${L('工具权限（tools）', 'Tool permissions')}</label>
            <div class="ag-agent-presets">
              <button type="button" class="ag-agent-preset-btn" data-ag-agent-preset="readonly" data-active="${hasPreset(['read_file', 'search_web']) ? 'true' : 'false'}">${L('只读研究', 'Read-only')}</button>
              <button type="button" class="ag-agent-preset-btn" data-ag-agent-preset="editor" data-active="${hasPreset(['read_file', 'edit_file', 'write_file', 'search_web']) ? 'true' : 'false'}">${L('文档编辑', 'Editor')}</button>
              <button type="button" class="ag-agent-preset-btn" data-ag-agent-preset="full" data-active="${hasPreset(['read_file', 'edit_file', 'write_file', 'run_command', 'manage_task', 'search_web']) ? 'true' : 'false'}">${L('完整执行', 'Full tools')}</button>
            </div>
          </div>
          <div class="ag-agent-tools-grid">
            ${toolDefs
              .map(
                ([key, label, code]) => `<label class="ag-agent-tool-chk">
                  <input type="checkbox" data-ag-agent-tool="${key}"${selectedSet.has(key) ? ' checked' : ''} />
                  <span>${escapeHtml(label)}</span>
                  <code>${code}</code>
                </label>`
              )
              .join('')}
          </div>
        </div>

        <div class="ag-sched-field">
          <label class="ag-sched-label" for="ag-agent-prompt">${L('系统提示词（角色设定、工作流程与输出要求）', 'System prompt')} <span class="ag-sched-req">*</span></label>
          <textarea id="ag-agent-prompt" class="ag-pm-textarea" rows="5" placeholder="${escapeHtml(
            L('你是一名严谨的专职审查员。收到任务后：\n1. 逐句核对原始文件；\n2. 仅输出有明确出处的结论……', 'You are a focused specialist subagent. When invoked:\n1. Verify every claim against source files...')
          )}">${escapeHtml(st.systemPrompt)}</textarea>
        </div>
        <div class="ag-sched-hint">${L(
          '自动生成官方格式 ~/.gemini/config/agents/<名称>.md（避免与 self / browser / research 等内置名重名）；模型由主 AI 委派时动态指定（官方 agents/*.md 不设固定 model 字段）。',
          'Saves to ~/.gemini/config/agents/<name>.md using native frontmatter (model is chosen dynamically at invoke time; official agents/*.md does not take a fixed model field).'
        )}</div>
      `
      : `
        <div class="ag-cust-import-box">
          <div class="ag-cust-import-title">${L('导入已有子 Agent 定义文件（.md）', 'Import existing agent Markdown (.md)')}</div>
          <p class="ag-cust-import-desc">${L(
            '选择一个或多个 .md 文件（例如从 Claude Code ~/.claude/agents/ 导出的子 Agent），自动复制到 ~/.gemini/config/agents/。',
            'Pick one or more .md agent files to copy directly into ~/.gemini/config/agents/.'
          )}</p>
          <div class="ag-cust-import-btns">
            <button type="button" class="ag-pm-primary-btn" data-ag-agent-import="true" ${st.saving ? 'disabled' : ''}>${
              st.saving ? L('导入中…', 'Importing…') : L('选择 .md 文件导入…', 'Choose .md file(s)…')
            }</button>
            <button type="button" class="ag-pm-secondary-btn" data-ag-agent-open-dir="true">${L('打开目录', 'Open agents folder')}</button>
          </div>
        </div>
      `;

    projectsModalEl.innerHTML = `
      <div class="ag-pm-dialog ag-pm-sched-dialog" role="dialog" aria-modal="true" aria-label="${escapeHtml(L('新建子 Agent', 'New subagent'))}">
        <div class="ag-pm-hdr ag-sched-hdr">
          <h2 class="ag-pm-title">${L('新建子 Agent', 'New subagent')}</h2>
          <button type="button" class="ag-pm-close" data-ag-pm-close="true" aria-label="${escapeHtml(L('关闭', 'Close'))}">×</button>
        </div>
        <div class="ag-cust-modal-tabs">
          <button type="button" class="ag-cust-mtab" data-ag-agent-mode="create" data-active="${isCreate ? 'true' : 'false'}">${L('新建配置', 'Create')}</button>
          <button type="button" class="ag-cust-mtab" data-ag-agent-mode="import" data-active="${!isCreate ? 'true' : 'false'}">${L('导入 .md 文件', 'Import .md')}</button>
        </div>
        ${bodyHtml}
        ${okHtml}
        ${errHtml}
        <div class="ag-pm-footer ag-sched-footer">
          <button type="button" class="ag-pm-secondary-btn" data-ag-agent-open-dir="true">${L('打开 ~/.gemini/config/agents', 'Open agents folder')}</button>
          <div class="ag-sched-footer-right">
            <button type="button" class="ag-pm-secondary-btn" data-ag-pm-close="true">${L('关闭', 'Close')}</button>
            ${
              isCreate
                ? `<button type="button" class="ag-pm-primary-btn" data-ag-agent-save="true" ${canSave ? '' : 'disabled'}>${
                    st.saving ? L('创建中…', 'Creating…') : L('创建子 Agent', 'Create subagent')
                  }</button>`
                : ''
            }
          </div>
        </div>
      </div>
    `;

    projectsModalEl.querySelectorAll('[data-ag-pm-close]').forEach((b) => {
      b.addEventListener('click', () => closeProjectsModal());
    });
    projectsModalEl.querySelectorAll('[data-ag-agent-mode]').forEach((b) => {
      b.addEventListener('click', () => {
        if (!projectsModalState) return;
        projectsModalState.mode = b.getAttribute('data-ag-agent-mode') || 'create';
        projectsModalState.error = '';
        renderAddAgentModal();
      });
    });
    projectsModalEl.querySelectorAll('[data-ag-agent-open-dir]').forEach((b) => {
      b.addEventListener('click', () => {
        if (typeof window.__agProjectCall === 'function') {
          window.__agProjectCall('openAgentsDir', {}, 5000);
        }
      });
    });
    const revealBtn = projectsModalEl.querySelector('[data-ag-agent-reveal]');
    if (revealBtn) {
      revealBtn.addEventListener('click', () => {
        const p = revealBtn.getAttribute('data-ag-agent-reveal');
        if (p && typeof window.__agProjectCall === 'function') {
          window.__agProjectCall('revealFile', { targetPath: p }, 5000);
        }
      });
    }

    const nameEl = projectsModalEl.querySelector('#ag-agent-name');
    const roleEl = projectsModalEl.querySelector('#ag-agent-role');
    const descEl = projectsModalEl.querySelector('#ag-agent-desc');
    const promptEl = projectsModalEl.querySelector('#ag-agent-prompt');
    const saveBtn = projectsModalEl.querySelector('[data-ag-agent-save]');
    const syncBtn = () => {
      if (!saveBtn || !projectsModalState) return;
      saveBtn.disabled = !(
        projectsModalState.name.trim() &&
        projectsModalState.description.trim() &&
        projectsModalState.systemPrompt.trim() &&
        !projectsModalState.saving
      );
    };
    if (nameEl) {
      if (!st.name) nameEl.focus();
      nameEl.addEventListener('input', () => {
        if (!projectsModalState) return;
        projectsModalState.name = nameEl.value;
        syncBtn();
      });
    }
    if (roleEl) {
      roleEl.addEventListener('change', () => {
        if (projectsModalState) projectsModalState.roleMode = roleEl.value || 'subagent';
      });
    }
    if (descEl) {
      descEl.addEventListener('input', () => {
        if (!projectsModalState) return;
        projectsModalState.description = descEl.value;
        syncBtn();
      });
    }
    if (promptEl) {
      promptEl.addEventListener('input', () => {
        if (!projectsModalState) return;
        projectsModalState.systemPrompt = promptEl.value;
        syncBtn();
      });
    }

    projectsModalEl.querySelectorAll('[data-ag-agent-preset]').forEach((b) => {
      b.addEventListener('click', () => {
        if (!projectsModalState) return;
        const p = b.getAttribute('data-ag-agent-preset');
        if (p === 'readonly') projectsModalState.tools = ['read_file', 'search_web'];
        else if (p === 'editor') projectsModalState.tools = ['read_file', 'edit_file', 'write_file', 'search_web'];
        else projectsModalState.tools = ['read_file', 'edit_file', 'write_file', 'run_command', 'manage_task', 'search_web'];
        renderAddAgentModal();
      });
    });

    projectsModalEl.querySelectorAll('[data-ag-agent-tool]').forEach((chk) => {
      chk.addEventListener('change', () => {
        if (!projectsModalState) return;
        const set = new Set(projectsModalState.tools || []);
        const key = chk.getAttribute('data-ag-agent-tool');
        if (chk.checked) set.add(key);
        else set.delete(key);
        projectsModalState.tools = Array.from(set);
      });
    });

    if (saveBtn) {
      saveBtn.addEventListener('click', async () => {
        const modalRef = projectsModalState;
        if (!modalRef || modalRef.saving) return;
        if (typeof window.__agProjectCall !== 'function') {
          modalRef.error = L('本地写入桥接不可用，请重启 Anti-Claude 守护进程', 'Local write bridge unavailable');
          renderAddAgentModal();
          return;
        }
        modalRef.saving = true;
        modalRef.error = '';
        modalRef.successMsg = '';
        renderAddAgentModal();
        const res = await window.__agProjectCall(
          'createLocalAgent',
          {
            name: modalRef.name,
            description: modalRef.description,
            roleMode: modalRef.roleMode,
            tools: modalRef.tools,
            systemPrompt: modalRef.systemPrompt
          },
          15000
        );
        if (disposed || projectsModalState !== modalRef) return;
        modalRef.saving = false;
        if (res && res.ok) {
          modalRef.name = '';
          modalRef.description = '';
          modalRef.systemPrompt = '';
          modalRef.createdPath = res.filePath || res.dirPath || '';
          modalRef.successMsg = L(
            `已创建子 Agent「${res.name}」（~/.gemini/config/agents/${res.name}.md），稍候或重进页面即可看到。`,
            `Subagent "${res.name}" created in ~/.gemini/config/agents/${res.name}.md.`
          );
          invalidateOverviewSnapshotCache();
          renderAddAgentModal();
        } else {
          const code = (res && res.error) || 'unknown';
          modalRef.error =
            code === 'reserved_agent_name'
              ? L('该名称与系统内置 Agent（self / browser / research 等）冲突，请换一个名称。', 'Name conflicts with a built-in agent (self, browser, research, etc.).')
              : code === 'agent_already_exists'
                ? L('同名子 Agent 文件已存在，请换一个名称。', 'An agent with this name already exists.')
                : L('创建失败：', 'Create failed: ') + String(code);
          renderAddAgentModal();
        }
      });
    }

    const importBtn = projectsModalEl.querySelector('[data-ag-agent-import]');
    if (importBtn) {
      importBtn.addEventListener('click', async () => {
        const modalRef = projectsModalState;
        if (!modalRef || modalRef.saving) return;
        if (typeof window.__agProjectCall !== 'function') {
          modalRef.error = L('本地写入桥接不可用', 'Local write bridge unavailable');
          renderAddAgentModal();
          return;
        }
        modalRef.saving = true;
        modalRef.error = '';
        modalRef.successMsg = '';
        renderAddAgentModal();
        const res = await window.__agProjectCall('importLocalAgent', {}, 120000);
        if (disposed || projectsModalState !== modalRef) return;
        modalRef.saving = false;
        if (res && res.ok && res.canceled) {
          renderAddAgentModal();
          return;
        }
        if (res && res.ok) {
          const names = (res.imported || []).map((x) => x.name).join('、');
          modalRef.createdPath = (res.imported && res.imported[0] && res.imported[0].filePath) || res.dirPath || '';
          modalRef.successMsg = L(`已成功导入子 Agent：${names}`, `Imported subagent(s): ${names}`);
          invalidateOverviewSnapshotCache();
          renderAddAgentModal();
        } else {
          const code = (res && res.error) || 'unknown';
          modalRef.error =
            code === 'missing_md_file'
              ? L('请选择 .md 格式的子 Agent 定义文件。', 'Please select .md agent definition file(s).')
              : L('导入失败：', 'Import failed: ') + String(code);
          renderAddAgentModal();
        }
      });
    }
  }

  function syncCustomizationsEnhancement() {
    if (disposed || !FEAT.customizations) {
      teardownCustomizationsEnhancement();
      return;
    }
    const searchInput = document.querySelector('[data-testid="customizations-search"]');
    if (!searchInput) {
      teardownCustomizationsEnhancement();
      return;
    }
    const stickyHdr = searchInput.closest('.sticky');
    const scrollRoot = stickyHdr && stickyHdr.parentElement;
    const bodyWrap = stickyHdr && stickyHdr.nextElementSibling;
    if (!stickyHdr || !scrollRoot || !bodyWrap) return;

    if (custSearchInputRef !== searchInput) {
      if (custSearchInputRef) custSearchInputRef.removeEventListener('input', onCustSearchInput);
      custSearchInputRef = searchInput;
      searchInput.addEventListener('input', onCustSearchInput);
    }

    const instTab = document.querySelector('[data-testid="plugins-tab-installed"]');
    const browseTab = document.querySelector('[data-testid="plugins-tab-browse"]');
    const isBrowse = Boolean(browseTab && browseTab.getAttribute('aria-current') === 'page');
    const isInstalled = !isBrowse && (Boolean(instTab && instTab.getAttribute('aria-current') === 'page') || !browseTab);

    scrollRoot.setAttribute('data-ag-cust-page', '1');
    scrollRoot.setAttribute('data-ag-cust-tab', isInstalled ? 'installed' : 'browse');
    stickyHdr.setAttribute('data-ag-cust-sticky', '1');

    const searching = Boolean((searchInput.value || '').trim());
    if (searching) scrollRoot.setAttribute('data-ag-cust-searching', '1');
    else scrollRoot.removeAttribute('data-ag-cust-searching');

    if (!isInstalled) {
      const oldBar = document.getElementById('ag-cust-cat-bar');
      if (oldBar) oldBar.remove();
      const oldAct = document.getElementById('ag-cust-skill-actions');
      if (oldAct) oldAct.remove();
      const oldAgentAct = document.getElementById('ag-cust-agent-actions');
      if (oldAgentAct) oldAgentAct.remove();
      return;
    }

    const sections = Array.from(bodyWrap.querySelectorAll('section'));
    const foundByCat = new Map();
    for (const sec of sections) {
      const cat = classifyCustomizationsSection(sec);
      if (!cat) continue;
      sec.setAttribute('data-ag-cust-sec', cat);
      const cntEl = sec.querySelector('[data-testid="customization-section-count"]');
      const countTxt = cntEl ? (cntEl.textContent || '').trim() : '';
      foundByCat.set(cat, { sec, countTxt });
    }

    const orderedCats = ['skills', 'plugins', 'mcp', 'agents'].filter((c) => foundByCat.has(c));
    if (orderedCats.length === 0) return;

    if (!custUserPickedCat && foundByCat.has('skills')) {
      custActiveCat = 'skills';
    } else if (custActiveCat !== 'all' && !foundByCat.has(custActiveCat)) {
      custActiveCat = orderedCats[0] || 'all';
    }

    const catLabels = {
      all: L('全部', 'All'),
      skills: L('技能与规则', 'Skills & Rules'),
      plugins: L('已安装插件', 'Plugins'),
      mcp: L('MCP 服务器', 'MCP Servers'),
      agents: L('自定义 Agent', 'Agents')
    };

    const hdrInner = stickyHdr.firstElementChild || stickyHdr;
    let catBar = document.getElementById('ag-cust-cat-bar');
    if (!catBar || !hdrInner.contains(catBar)) {
      if (catBar) catBar.remove();
      catBar = document.createElement('div');
      catBar.id = 'ag-cust-cat-bar';
      catBar.setAttribute('data-ag-i18n-ignore', '1');
      catBar.setAttribute('role', 'tablist');
      hdrInner.appendChild(catBar);
    }

    const tabsSpec = [...orderedCats, 'all'];
    const sig = tabsSpec.map((k) => `${k}:${k === custActiveCat ? 1 : 0}:${foundByCat.get(k)?.countTxt || ''}:${FEAT.i18n ? 1 : 0}`).join('|');
    if (catBar.dataset.agSig !== sig) {
      catBar.dataset.agSig = sig;
      catBar.innerHTML = tabsSpec
        .map((k) => {
          const active = k === custActiveCat;
          const cnt = k !== 'all' ? foundByCat.get(k)?.countTxt || '' : '';
          return `<button type="button" role="tab" class="ag-cust-cat-tab" data-ag-cust-cat="${k}" data-active="${active ? 'true' : 'false'}" aria-selected="${active ? 'true' : 'false'}"><span>${escapeHtml(
            catLabels[k] || k
          )}</span>${cnt ? `<span class="ag-cust-cat-cnt">${escapeHtml(cnt)}</span>` : ''}</button>`;
        })
        .join('');
      catBar.querySelectorAll('[data-ag-cust-cat]').forEach((b) => {
        b.addEventListener('click', () => {
          custUserPickedCat = true;
          custActiveCat = b.getAttribute('data-ag-cust-cat') || 'all';
          syncCustomizationsEnhancement();
          try {
            scrollRoot.scrollTop = 0;
          } catch {}
        });
      });
    }

    for (const [cat, { sec }] of foundByCat.entries()) {
      const shouldHide = !searching && custActiveCat !== 'all' && cat !== custActiveCat;
      if (shouldHide) sec.setAttribute('data-ag-cust-hidden', '1');
      else sec.removeAttribute('data-ag-cust-hidden');
    }

    /* Inject native-missing "+ Add skill" & "Open skills folder" buttons into Skills & Rules header */
    const skillsEntry = foundByCat.get('skills');
    if (skillsEntry && skillsEntry.sec) {
      const skillsSec = skillsEntry.sec;
      const filterBtn = skillsSec.querySelector('[data-testid="skills-rules-filter"]');
      const hdrRow = (filterBtn && filterBtn.parentElement) || (skillsSec.firstElementChild && skillsSec.firstElementChild);
      if (hdrRow) {
        let actWrap = document.getElementById('ag-cust-skill-actions');
        if (!actWrap || !hdrRow.contains(actWrap)) {
          if (actWrap) actWrap.remove();
          actWrap = document.createElement('div');
          actWrap.id = 'ag-cust-skill-actions';
          actWrap.setAttribute('data-ag-i18n-ignore', '1');
          actWrap.innerHTML =
            `<button type="button" id="ag-cust-open-skills-dir-btn" class="ag-cust-act-icon" title="${escapeHtml(
              L('打开技能目录 (~/.gemini/config/skills)', 'Open skills folder')
            )}" aria-label="${escapeHtml(L('打开技能目录', 'Open skills folder'))}">${SVG_PROJ_FOLDER_OPEN}</button>` +
            `<button type="button" id="ag-cust-add-skill-btn" class="ag-cust-act-btn">${SVG_PROJ_PLUS}<span>${L('添加技能', 'Add skill')}</span></button>`;
          if (filterBtn && filterBtn.parentElement === hdrRow) {
            filterBtn.insertAdjacentElement('beforebegin', actWrap);
          } else {
            hdrRow.appendChild(actWrap);
          }
          actWrap.querySelector('#ag-cust-open-skills-dir-btn')?.addEventListener('click', (e) => {
            e.stopPropagation();
            if (typeof window.__agProjectCall === 'function') {
              window.__agProjectCall('openSkillsDir', {}, 5000);
            }
          });
          actWrap.querySelector('#ag-cust-add-skill-btn')?.addEventListener('click', (e) => {
            e.stopPropagation();
            openAddSkillModal();
          });
        } else {
          const addLbl = actWrap.querySelector('#ag-cust-add-skill-btn span');
          if (addLbl) addLbl.textContent = L('添加技能', 'Add skill');
        }
      }
    }

    /* Inject native-missing "+ New subagent" & "Open agents folder" buttons into Custom Agents header */
    const agentsEntry = foundByCat.get('agents');
    if (agentsEntry && agentsEntry.sec) {
      const agentsSec = agentsEntry.sec;
      const hdrRow = agentsSec.firstElementChild;
      if (hdrRow) {
        let actWrap = document.getElementById('ag-cust-agent-actions');
        if (!actWrap || !hdrRow.contains(actWrap)) {
          if (actWrap) actWrap.remove();
          actWrap = document.createElement('div');
          actWrap.id = 'ag-cust-agent-actions';
          actWrap.className = 'ag-cust-hdr-actions';
          actWrap.setAttribute('data-ag-i18n-ignore', '1');
          actWrap.innerHTML =
            `<button type="button" id="ag-cust-open-agents-dir-btn" class="ag-cust-act-icon" title="${escapeHtml(
              L('打开子 Agent 目录 (~/.gemini/config/agents)', 'Open agents folder')
            )}" aria-label="${escapeHtml(L('打开子 Agent 目录', 'Open agents folder'))}">${SVG_PROJ_FOLDER_OPEN}</button>` +
            `<button type="button" id="ag-cust-add-agent-btn" class="ag-cust-act-btn">${SVG_PROJ_PLUS}<span>${L('新建子 Agent', 'New subagent')}</span></button>`;
          hdrRow.appendChild(actWrap);
          actWrap.querySelector('#ag-cust-open-agents-dir-btn')?.addEventListener('click', (e) => {
            e.stopPropagation();
            if (typeof window.__agProjectCall === 'function') {
              window.__agProjectCall('openAgentsDir', {}, 5000);
            }
          });
          actWrap.querySelector('#ag-cust-add-agent-btn')?.addEventListener('click', (e) => {
            e.stopPropagation();
            openAddAgentModal();
          });
        } else {
          const addLbl = actWrap.querySelector('#ag-cust-add-agent-btn span');
          if (addLbl) addLbl.textContent = L('新建子 Agent', 'New subagent');
        }
      }
    }
  }

  function syncProjectsWorkspace() {
    syncSidebarHideNativeProjects();
    syncCustomizationsEnhancement();
    if (!FEAT.projects) {
      if (projectsViewOpen || projectsViewEl || projectsDocListenerBound || document.getElementById('ag-claude-projects-nav-btn')) {
        teardownProjectsWorkspace();
      }
      return;
    }
    if (projectsViewOpen) {
      onProjectsNavRouteChange();
    }
    const autoBtn = document.querySelector('[data-testid="automations-button"]');
    if (!autoBtn || !autoBtn.parentElement) return;
    let navBtn = document.getElementById('ag-claude-projects-nav-btn');
    if (!navBtn) {
      navBtn = document.createElement('button');
      navBtn.type = 'button';
      navBtn.id = 'ag-claude-projects-nav-btn';
      navBtn.setAttribute('data-testid', 'claude-projects-nav-button');
      navBtn.setAttribute('data-ag-i18n-ignore', '1');
      navBtn.className = autoBtn.className;
      navBtn.innerHTML =
        `<span class="shrink-0 flex items-center">${SVG_CLAUDE_PROJECTS_ICON}</span>` +
        `<span class="truncate ag-proj-nav-label">${L('项目', 'Projects')}</span>`;
      navBtn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        toggleProjectsView();
      });
    }
    /* Keep positioned directly between Automations (`automations-button`) and Skills (`/customizations`) */
    if (navBtn.previousElementSibling !== autoBtn) {
      autoBtn.insertAdjacentElement('afterend', navBtn);
    }
    updateProjectsNavActiveVisual();
    if (!projectsDocListenerBound) {
      projectsDocListenerBound = true;
      document.addEventListener('click', onProjectsGlobalClick, true);
      document.addEventListener('keydown', onProjectsGlobalKeyDown, true);
      window.addEventListener('resize', positionProjectsOverlay);
      window.addEventListener('popstate', onProjectsNavRouteChange);
    }
    if (projectsViewOpen) {
      ensureProjectsSidebarObserver();
      positionProjectsOverlay();
    }
    syncSidebarHideNativeProjects();
  }

  /* ==========================================================================
   * 11. Enhanced Right Overview Panel (`claudeUxOverviewPanel`)
   *     - Re-styles native quick shortcuts into a 4-tile toolbar via CSS `order: 0`
   *     - Keeps native Artifact section right below shortcuts (`order: 1`)
   *     - Appends `#ag-claude-ov-sections` as last DOM child (`order: 2`, React-safe)
   *     - Combines Environment, T3 Context/Cache breakdown + Compact, Google Blue
   *       dual-window Used-% Quotas + time cursor, Side chats, and Connectors list
   * ========================================================================== */
  const OV_COLLAPSE_STORAGE_KEY = 'ag_claude_ov_collapse_v2';
  const OV_DEFAULT_OPEN = {
    environment: true,
    context: true,
    quota: true,
    otherPools: true,
    sidechats: true,
    connectors: false,
    invMemory: false,
    invSkills: false,
    invAgents: false,
    connectorsExtra: false
  };
  let ovCollapseState = (() => {
    try {
      const raw = typeof localStorage === 'object' && localStorage ? localStorage.getItem(OV_COLLAPSE_STORAGE_KEY) : null;
      const parsed = raw ? JSON.parse(raw) : null;
      if (parsed && typeof parsed === 'object') return Object.assign({}, OV_DEFAULT_OPEN, parsed);
    } catch {}
    return Object.assign({}, OV_DEFAULT_OPEN);
  })();
  function persistOvCollapseState() {
    try {
      if (typeof localStorage === 'object' && localStorage) {
        localStorage.setItem(OV_COLLAPSE_STORAGE_KEY, JSON.stringify(ovCollapseState));
      }
    } catch {}
  }

  const ovSnapshotCache = new Map(); // dirKey -> { ts, data }
  const ovSnapshotInFlight = new Map(); // dirKey -> Promise
  let ovLastQuotaAutoTryTs = 0;
  let ovQuotaSpinTimer = 0;
  let ovRefreshSpinUntil = 0;
  let ovMinuteTickerId = null;
  let ovWorkspaceMemo = { ts: 0, key: '', value: null };
  let ovCompactMemo = { ts: 0, key: '', status: 'idle' };

  function invalidateOverviewSnapshotCache() {
    ovSnapshotCache.clear();
    ovWorkspaceMemo = { ts: 0, key: '', value: null };
    if (!disposed && FEAT.overviewPanel) {
      const sec = document.getElementById('ag-claude-ov-sections');
      if (sec) sec.removeAttribute('data-render-sig');
      renderOverviewPanel(true);
    }
  }

  function fmtOvTokens(n) {
    const v = Number(n) || 0;
    if (!Number.isFinite(v) || v <= 0) return '0';
    if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(2).replace(/\.?0+$/, '')}M`;
    if (v >= 1000) return fmtCompactTokens(v);
    return String(Math.round(v));
  }

  function ovQuotaUsedColor(usedPct) {
    if (usedPct >= 90) return '#DC2626';
    if (usedPct >= 75) return '#D97706';
    return 'var(--ag-ov-blue, #2F75C3)';
  }

  function localizeQuotaWindowTag(rawWin, fallbackName = '') {
    const win = String(rawWin || '').trim().toLowerCase();
    if (win === '5h') return L('5 小时', '5h');
    if (win === 'weekly') return L('每周', 'Weekly');
    if (win === 'daily') return L('每日', 'Daily');
    return fallbackName || L('配额', 'Quota');
  }

  function readOverviewModelLabel() {
    const inputBox = document.getElementById('antigravity.agentSidePanelInputBox');
    const trigger = inputBox && inputBox.querySelector('button[data-testid="model-selector-trigger"]');
    return ((trigger ? trigger.textContent : '') || '').trim();
  }

  function computeWindowElapsedPct(bucket, usedPct) {
    const win = String(bucket?.window || '').trim().toLowerCase();
    if (win === '5h' && usedPct === 0 && !bucket?.description) return null;
    const secStr = bucket?.resetTime && bucket.resetTime.seconds !== undefined ? String(bucket.resetTime.seconds) : '';
    const resetSec = secStr ? Number(secStr) : 0;
    if (!resetSec || Number.isNaN(resetSec)) return null;
    const totalSec = win === '5h' ? 5 * 3600 : win === 'daily' ? 86400 : win === 'weekly' ? 7 * 86400 : 0;
    if (!totalSec) return null;
    const nowSec = Math.floor(Date.now() / 1000);
    const remSec = Math.max(0, Math.min(totalSec, resetSec - nowSec));
    const elapsedFrac = Math.max(0, Math.min(1, 1 - remSec / totalSec));
    return Math.round(elapsedFrac * 100);
  }

  function resolveActiveOverviewWorkspace(force = false) {
    const curCid = getActiveCascadeId();
    const locSearch = String(window.location.search || '');
    const memoKey = `${curCid}|${locSearch}`;
    const now = Date.now();
    if (!force && ovWorkspaceMemo.value && ovWorkspaceMemo.key === memoKey && now - ovWorkspaceMemo.ts < 400) {
      return ovWorkspaceMemo.value;
    }

    let urlPid = '';
    try {
      urlPid = new URLSearchParams(locSearch).get('project') || '';
    } catch {}
    const { store } = resolveProjectsStoreAndBindings();
    const state = store && typeof store.getState === 'function' ? store.getState() : null;
    const summaries = (state && state.trajectorySummaries && state.trajectorySummaries.summaries) || {};
    const sum = curCid ? summaries[curCid] : null;
    const projects = typeof collectNativeProjects === 'function' ? collectNativeProjects() : [];
    const norm = (p) => String(p || '').replace(/\/+$/, '').toLowerCase();

    const pid = (sum && (sum.projectId || (sum.trajectoryMetadata && sum.trajectoryMetadata.projectId))) || urlPid || '';
    let wsDir = '';
    if (sum) {
      const wsList = (sum.workspaces || []).concat((sum.trajectoryMetadata && sum.trajectoryMetadata.workspaces) || []);
      for (const ws of wsList) {
        const rawUri = ws && (ws.workspaceFolderAbsoluteUri || ws.uri || ws);
        if (typeof rawUri === 'string' && rawUri.trim()) {
          const decoded = decodeFileUriToPath(rawUri).replace(/\/+$/, '');
          if (decoded) {
            wsDir = decoded;
            break;
          }
        }
      }
    }

    let matchedProj = pid ? projects.find((p) => p.id === pid) : null;
    if (!matchedProj && wsDir) {
      matchedProj = projects.find((p) => norm(p.dirPath) === norm(wsDir)) || null;
    }
    const dirPath = (matchedProj && matchedProj.dirPath) || wsDir || '';
    const project = matchedProj || (dirPath ? { id: '', name: dirPath.split(/[\\/]/).filter(Boolean).pop() || dirPath, dirPath } : null);
    const result = { cid: curCid, dirPath, project, state, summaries };
    ovWorkspaceMemo = { ts: now, key: memoKey, value: result };
    return result;
  }

  function getOverviewCompactStatus(curCid, force = false) {
    const key = `${curCid}|${manualCompactPending.cascadeId}:${manualCompactPending.startedAt}`;
    const now = Date.now();
    if (!force && ovCompactMemo.key === key && now - ovCompactMemo.ts < 350) {
      return ovCompactMemo.status;
    }
    const status = detectCompactStatus(curCid);
    ovCompactMemo = { ts: now, key, status };
    return status;
  }

  function ensureOverviewSnapshot(dirPath, force = false) {
    if (typeof window.__agProjectCall !== 'function') return null;
    const key = String(dirPath || '').trim() || '__global__';
    const now = Date.now();
    const cached = ovSnapshotCache.get(key);
    if (!force && cached && now - cached.ts < 15000) return cached.data;
    if (!ovSnapshotInFlight.has(key)) {
      const p = Promise.resolve(window.__agProjectCall('getOverviewSnapshot', { dirPath: dirPath || '' }, 6000))
        .then((res) => {
          if (disposed || !res || !res.ok) return;
          ovSnapshotCache.set(key, { ts: Date.now(), data: res });
          if (FEAT.overviewPanel) renderOverviewPanel(false);
        })
        .catch(() => {})
        .finally(() => {
          ovSnapshotInFlight.delete(key);
        });
      ovSnapshotInFlight.set(key, p);
    }
    return cached ? cached.data : null;
  }

  function collectMergedSidechats(curCid, stats, summaries) {
    const byId = new Map();
    if (stats && Array.isArray(stats.children)) {
      for (const ch of stats.children) {
        if (!ch || !ch.id) continue;
        byId.set(ch.id, Object.assign({}, ch));
      }
    }
    if (curCid && summaries && typeof summaries === 'object') {
      for (const [id, sum] of Object.entries(summaries)) {
        if (!sum || id === curCid) continue;
        const parentId = sum.parentConversationId || (sum.trajectoryMetadata && sum.trajectoryMetadata.parentConversationId) || '';
        if (parentId !== curCid) continue;
        const title = String((sum.annotations && sum.annotations.title) || sum.summary || '').trim();
        const agentName = String(sum.agentName || (sum.trajectoryMetadata && sum.trajectoryMetadata.agentName) || '').trim();
        const status = sum.status ?? '';
        const running = Boolean(
          !sum.killed &&
            (Boolean(sum.notFullyIdle) ||
              status === 2 ||
              status === 3 ||
              status === 4 ||
              /RUNNING|IN_PROGRESS|ACTIVE/i.test(String(status)))
        );
        const prev = byId.get(id) || { id, calls: 0, outTok: 0 };
        byId.set(id, Object.assign({}, prev, {
          title: title || prev.title || '',
          agentName: agentName || prev.agentName || '',
          running: running || Boolean(prev.running),
          killed: Boolean(sum.killed || prev.killed)
        }));
      }
    }
    return Array.from(byId.values()).slice(0, 12);
  }

  function buildOvChevronSvg(isOpen) {
    return `<svg class="ag-ov-chev" data-open="${isOpen ? 'true' : 'false'}" width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="M6 4l4 4-4 4" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
  }

  function onOverviewSectionsClick(e) {
    if (disposed || !FEAT.overviewPanel) return;
    const collapseBtn = e.target.closest('[data-ag-ov-collapse]');
    if (collapseBtn) {
      e.preventDefault();
      e.stopPropagation();
      const key = collapseBtn.getAttribute('data-ag-ov-collapse');
      if (key) {
        ovCollapseState[key] = !ovCollapseState[key];
        persistOvCollapseState();
        renderOverviewPanel(true);
      }
      return;
    }

    const actionEl = e.target.closest('[data-ag-ov-action]');
    if (!actionEl) return;
    e.preventDefault();
    e.stopPropagation();
    const action = actionEl.getAttribute('data-ag-ov-action');
    const ws = resolveActiveOverviewWorkspace(true);

    if (action === 'finder') {
      if (ws.dirPath && typeof window.__agProjectCall === 'function') {
        window.__agProjectCall('revealFile', { targetPath: ws.dirPath, dirPath: ws.dirPath, openFolder: true }, 5000);
      }
    } else if (action === 'copy-path') {
      if (ws.dirPath && navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
        navigator.clipboard.writeText(ws.dirPath).then(
          () => showProjectsFloatingNotice(L('已复制工作区路径', 'Workspace path copied')),
          () => {}
        );
      }
    } else if (action === 'edit-rules') {
      if (ws.project && ws.project.dirPath) {
        openProjectInstructionsModal(ws.project);
      } else {
        const globalPath = actionEl.getAttribute('data-path') || '';
        if (globalPath && typeof window.__agProjectCall === 'function') {
          window.__agProjectCall('revealFile', { targetPath: globalPath, dirPath: '' }, 5000);
        }
      }
    } else if (action === 'compact') {
      if (!actionEl.disabled) {
        ovCompactMemo = { ts: 0, key: '', status: 'idle' };
        triggerConversationCompact();
      }
    } else if (action === 'refresh-quota') {
      ovRefreshSpinUntil = Date.now() + 600;
      const icon = actionEl.querySelector('svg');
      if (icon) {
        icon.classList.remove('ag-ov-spinning');
        void icon.offsetWidth;
        icon.classList.add('ag-ov-spinning');
      }
      cancelLater(ovQuotaSpinTimer);
      ovQuotaSpinTimer = later(() => {
        ovQuotaSpinTimer = 0;
        ovRefreshSpinUntil = 0;
        const curIcon = document.querySelector('#ag-claude-ov-sections [data-ag-ov-action="refresh-quota"] svg');
        if (curIcon) curIcon.classList.remove('ag-ov-spinning');
      }, 620);
      discoverQuotaService(true);
      fetchQuotaSummary(true);
    } else if (action === 'sidechat') {
      const cid = actionEl.getAttribute('data-cid') || '';
      if (cid) openConversationFromProject(cid);
    } else if (action === 'reveal-path') {
      const targetPath = actionEl.getAttribute('data-path') || '';
      if (targetPath && typeof window.__agProjectCall === 'function') {
        window.__agProjectCall('revealFile', { targetPath, dirPath: ws.dirPath || '' }, 5000);
      }
    } else if (action === 'open-plugins') {
      const pluginsBtn = document.querySelector('button[data-testid="overview-panel-row-plugins"]');
      if (pluginsBtn) pluginsBtn.click();
    } else if (action === 'open-skills-dir') {
      if (typeof window.__agProjectCall === 'function') {
        window.__agProjectCall('openSkillsDir', {}, 5000);
      }
    } else if (action === 'open-agents-dir') {
      if (typeof window.__agProjectCall === 'function') {
        window.__agProjectCall('openAgentsDir', {}, 5000);
      }
    } else if (action === 'toggle-connectors-more') {
      ovCollapseState.connectorsExtra = !ovCollapseState.connectorsExtra;
      persistOvCollapseState();
      renderOverviewPanel(true);
    }
  }

  function renderOverviewPanel(force = false) {
    if (disposed || !FEAT.overviewPanel) return;
    const sectionsEl = document.getElementById('ag-claude-ov-sections');
    if (!sectionsEl) return;

    const ws = resolveActiveOverviewWorkspace(force);
    const snap = ensureOverviewSnapshot(ws.dirPath, false);
    const curCid = ws.cid;
    const rawM = window.__ag_last_metrics;
    const hasCtx = Boolean(rawM && rawM.hasData && (!curCid || rawM.cascadeId === curCid) && rawM.stats);
    const stats = hasCtx ? rawM.stats : null;
    const compactStatus = getOverviewCompactStatus(curCid, force);
    const paneRunning = isPaneCurrentlyRunning();
    if (wasOvPaneGenerating && !paneRunning) {
      scheduleAutoQuotaRefresh(500, 3000);
    }
    wasOvPaneGenerating = paneRunning;
    const { preUsed, limitLabel, summaryLabel, summaryPct } = extractCompactLabels(latestCtxState, curCid);

    const groups = cachedQuotaGroups || [];
    const curModelLabel = readOverviewModelLabel();
    const ovPrimaryIdx = groups.length > 0 ? detectDefaultGroupIndex(groups) : 0;
    const minuteBucket = Math.floor(Date.now() / 60000);

    const mergedChildren = collectMergedSidechats(curCid, stats, ws.summaries);
    const snapSig = snap
      ? `${snap.workspace?.dirPath}|${snap.workspace?.git?.branch}:${snap.workspace?.git?.added}:${snap.workspace?.git?.deleted}:${snap.workspace?.git?.changedFiles}|r${snap.rules?.length}|s${snap.skills?.total}|a${snap.agents?.total}|c${snap.connectors?.length}`
      : 'nosnap';
    const ctxSig = stats
      ? `${stats.ctx}/${stats.limit}|${stats.cached}|${stats.uncached}|${stats.lastCacheRate}|${stats.sessionCacheRate}|${stats.turns}/${stats.calls}|${stats.totalThink}|${stats.totalResp}|${compactStatus}|${paneRunning ? 1 : 0}|${summaryLabel}`
      : `noctx|${compactStatus}|${paneRunning ? 1 : 0}`;
    const quotaSig = `${cachedUserTierName}|${ovPrimaryIdx}|${curModelLabel}|m${minuteBucket}|${groups
      .map((g) => `${g.displayName}:${(g.buckets || []).map((b) => `${b.window}=${b.remaining?.value ?? b.remainingFraction}:${b.resetTime?.seconds ?? ''}`).join(',')}`)
      .join(';')}`;
    const subSig = mergedChildren.map((c) => `${c.id}:${c.running ? 1 : 0}:${c.title}:${c.calls}`).join('|');
    const colSig = Object.keys(OV_DEFAULT_OPEN)
      .map((k) => (ovCollapseState[k] ? '1' : '0'))
      .join('');
    const renderSig = `${FEAT.i18n ? 'zh' : 'en'}||${curCid}||${ws.dirPath}||${snapSig}||${ctxSig}||${quotaSig}||${subSig}||${colSig}`;

    if (!force && sectionsEl.getAttribute('data-render-sig') === renderSig) return;
    sectionsEl.setAttribute('data-render-sig', renderSig);

    /* ---- 1. Environment Card ---- */
    const git = snap && snap.workspace && snap.workspace.git ? snap.workspace.git : null;
    const gitPillHtml = git
      ? `<span class="ag-ov-git-pill">${escapeHtml(git.branch)}${
          git.added > 0 || git.deleted > 0
            ? ` · <span class="ag-ov-git-add">+${git.added}</span> <span class="ag-ov-git-del">-${git.deleted}</span>`
            : git.changedFiles > 0
              ? ` · <span class="ag-ov-muted">${git.changedFiles} ${L('变更', 'chg')}</span>`
              : ''
        }</span>`
      : '';
    const dirName = (ws.project && ws.project.name) || (snap && snap.workspace && snap.workspace.name) || '';
    const shortDir = ws.dirPath ? formatShortHomePath(ws.dirPath) : '';
    const folderRowHtml = ws.dirPath
      ? `<button type="button" class="ag-ov-row-btn ag-ov-folder-btn" data-ag-ov-action="copy-path" title="${escapeHtml(ws.dirPath)}">
          <span class="ag-ov-row-left">
            <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" aria-hidden="true"><path d="M2 4.2a1 1 0 0 1 1-1h3.5l1.3 1.4H13a1 1 0 0 1 1 1v6.2a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V4.2z"/></svg>
            <span class="ag-ov-row-title">${escapeHtml(dirName)}</span>
          </span>
          <span class="ag-ov-mono-muted">${escapeHtml(shortDir)}</span>
        </button>`
      : `<div class="ag-ov-empty-inline ag-ov-env-pad">${L('未绑定项目目录', 'No workspace folder bound')}</div>`;

    const rulesList = (snap && Array.isArray(snap.rules) && snap.rules) || [];
    const hasGlobalRule = rulesList.some((r) => r.scope === 'global');
    const hasProjRule = rulesList.some((r) => r.scope === 'project');
    const hasPluginRule = rulesList.some((r) => r.scope === 'plugin');
    const globalRulePath = (rulesList.find((r) => r.scope === 'global') || {}).path || '';
    const scopeParts = [];
    if (hasGlobalRule) scopeParts.push(L('全局', 'Global'));
    if (hasProjRule) scopeParts.push(L('项目', 'Project'));
    if (hasPluginRule) scopeParts.push(L('插件', 'Plugin'));
    const ruleSummary = scopeParts.length
      ? `${scopeParts.join(' + ')} · ${L(`${rulesList.length} 份`, String(rulesList.length))}`
      : L('未配置', 'None');
    const canEditRules = Boolean((ws.project && ws.project.dirPath) || globalRulePath);

    const envCardHtml = `
      <section class="ag-ov-card" data-ov-card="environment">
        <div class="ag-ov-card-hdr">
          <button type="button" class="ag-ov-hdr-toggle" data-ag-ov-collapse="environment">
            ${buildOvChevronSvg(ovCollapseState.environment)}
            <span>${L('工作环境', 'Environment')}</span>
          </button>
          ${
            ws.dirPath
              ? `<button type="button" class="ag-ov-hdr-action" data-ag-ov-action="finder">Finder ↗</button>`
              : ''
          }
        </div>
        ${
          ovCollapseState.environment
            ? `<div class="ag-ov-card-body ag-ov-env-body">
                <div class="ag-ov-kv-row ag-ov-env-pad">
                  <span class="ag-ov-row-left">
                    <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" aria-hidden="true"><rect x="1.8" y="2.5" width="12.4" height="8.5" rx="1.4"/><path d="M5.5 13.5h5M8 11v2.5" stroke-linecap="round"/></svg>
                    <span>${L('本机工作区', 'This computer')}</span>
                  </span>
                  ${gitPillHtml}
                </div>
                ${folderRowHtml}
                <div class="ag-ov-rule-pill">
                  <span class="ag-ov-row-left">
                    <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" aria-hidden="true"><path d="M4 2h5.2l3.3 3.3V14H4V2z"/><path d="M9 2v3.5h3.5M6 8.5h4M6 11h3" stroke-linecap="round"/></svg>
                    <span class="ag-ov-mono">AGENTS.md</span>
                    <span class="ag-ov-muted ag-ov-trunc">${escapeHtml(ruleSummary)}</span>
                  </span>
                  ${
                    canEditRules
                      ? `<button type="button" class="ag-ov-mini-btn" data-ag-ov-action="edit-rules" data-path="${escapeHtml(globalRulePath)}">${ws.project && ws.project.dirPath ? L('编辑', 'Edit') : L('查看', 'Open')}</button>`
                      : ''
                  }
                </div>
              </div>`
            : ''
        }
      </section>`;

    /* ---- 2. Context Card (T3 Style) ---- */
    let topPctText = hasCtx ? `${stats.pct}% ${L('已用', 'used')}` : L('暂无消耗', 'No data');
    let topRatioText = hasCtx ? `${fmtOvTokens(stats.ctx)} / ${stats.limitStr}` : '';
    let topPctLevel = '';
    if (stats) {
      if (stats.pct >= 90) topPctLevel = 'crit';
      else if (stats.pct >= 75) topPctLevel = 'warn';
    }

    const limitTok = stats ? Math.max(1, Number(stats.limit) || 1) : 1;
    const shareDenom = stats
      ? Math.max(limitTok, Number(stats.ctx || 0), Number(stats.cached || 0) + Number(stats.uncached || 0))
      : 1;
    let cachedBarW = stats ? Math.min(100, (Number(stats.cached || 0) / shareDenom) * 100) : 0;
    let uncachedBarW = stats ? Math.min(100 - cachedBarW, (Number(stats.uncached || 0) / shareDenom) * 100) : 0;
    let compactBtnHtml = '';

    if (compactStatus === 'compacting') {
      topPctText = preUsed ? L(`正在压缩 ${preUsed}…`, `Compacting ${preUsed}…`) : L('正在压缩…', 'Compacting…');
      topRatioText = '';
      topPctLevel = '';
      cachedBarW = 14;
      uncachedBarW = 0;
      compactBtnHtml = `<button type="button" class="ag-ov-compact-btn" data-ag-ov-action="compact" data-state="compacting" disabled>${SVG_COMPACT_ICON}<span>${L('压缩中…', 'Compacting…')}</span></button>`;
    } else if (compactStatus === 'compacted') {
      topPctText = summaryLabel && limitLabel ? `${summaryPct}% ${L('已用', 'used')}` : L('已完成压缩', 'Compacted');
      topRatioText = summaryLabel && limitLabel ? `${summaryLabel} / ${limitLabel}` : L('下轮刷新', 'Next turn');
      topPctLevel = '';
      cachedBarW = summaryPct > 0 ? Math.max(2, summaryPct) : 2;
      uncachedBarW = 0;
      compactBtnHtml = `<button type="button" class="ag-ov-compact-btn" data-ag-ov-action="compact" data-state="compacted" disabled>${SVG_COMPACT_DONE}<span>${L('已压缩', 'Compacted')}</span></button>`;
    } else if (!hasCtx) {
      compactBtnHtml = `<button type="button" class="ag-ov-compact-btn" data-ag-ov-action="compact" data-state="empty" disabled>${SVG_COMPACT_ICON}<span>${L('压缩', 'Compact')}</span></button>`;
    } else if (paneRunning) {
      compactBtnHtml = `<button type="button" class="ag-ov-compact-btn" data-ag-ov-action="compact" data-state="busy" disabled title="${escapeHtml(L('请等待当前回复结束后压缩', 'Wait for response to finish'))}">${SVG_COMPACT_ICON}<span>${L('压缩', 'Compact')}</span></button>`;
    } else {
      const urgAttr = stats.pct >= 85 ? ' data-urgent="crit"' : stats.pct >= 70 ? ' data-urgent="warn"' : '';
      compactBtnHtml = `<button type="button" class="ag-ov-compact-btn" data-ag-ov-action="compact" data-state="ready"${urgAttr} title="${escapeHtml(L('立即执行 /compact 压缩上下文', 'Run /compact'))}">${SVG_COMPACT_ICON}<span>${L('压缩', 'Compact')}</span></button>`;
    }

    const cachedPctStr = stats ? ((Number(stats.cached || 0) / shareDenom) * 100).toFixed(1) : '0.0';
    const uncachedPctStr = stats ? ((Number(stats.uncached || 0) / shareDenom) * 100).toFixed(1) : '0.0';
    const freePctVal = stats ? Math.max(0, 100 - Number(cachedPctStr) - Number(uncachedPctStr)) : 100;
    const freePctStr = freePctVal.toFixed(1);

    const ctxCardHtml = `
      <section class="ag-ov-card" data-ov-card="context">
        <div class="ag-ov-card-hdr">
          <button type="button" class="ag-ov-hdr-toggle" data-ag-ov-collapse="context">
            ${buildOvChevronSvg(ovCollapseState.context)}
            <span>${L('上下文', 'Context')}</span>
          </button>
          <div class="ag-ov-ctx-hdr-meta">
            <span class="ag-ov-ctx-pct" data-level="${topPctLevel}">${escapeHtml(topPctText)}</span>
            ${topRatioText ? `<span class="ag-ov-muted">${escapeHtml(topRatioText)}</span>` : ''}
          </div>
        </div>
        ${
          ovCollapseState.context
            ? `<div class="ag-ov-card-body">
                <div class="ag-ov-stacked-bar">
                  <div class="ag-ov-bar-cached" style="width:${cachedBarW.toFixed(2)}%"></div>
                  <div class="ag-ov-bar-uncached" style="width:${uncachedBarW.toFixed(2)}%"></div>
                </div>
                ${
                  stats
                    ? `<div class="ag-ov-breakdown">
                        <div class="ag-ov-bd-row">
                          <span class="ag-ov-bd-lbl"><i class="ag-ov-dot ag-ov-dot-blue"></i><span>${L('缓存上下文', 'Cached context')}</span></span>
                          <span class="ag-ov-bd-vals"><span>${escapeHtml(fmtOvTokens(stats.cached))}</span><span class="ag-ov-muted ag-ov-pct-w">${cachedPctStr}%</span></span>
                        </div>
                        <div class="ag-ov-bd-row">
                          <span class="ag-ov-bd-lbl"><i class="ag-ov-dot ag-ov-dot-amber"></i><span>${L('新增上下文', 'Uncached context')}</span></span>
                          <span class="ag-ov-bd-vals"><span>${escapeHtml(fmtOvTokens(stats.uncached))}</span><span class="ag-ov-muted ag-ov-pct-w">${uncachedPctStr}%</span></span>
                        </div>
                        <div class="ag-ov-bd-row">
                          <span class="ag-ov-bd-lbl"><i class="ag-ov-dot ag-ov-dot-free"></i><span class="ag-ov-muted">${L('剩余空间', 'Free space')}</span></span>
                          <span class="ag-ov-bd-vals ag-ov-muted"><span>${escapeHtml(fmtOvTokens(stats.remain))}</span><span class="ag-ov-pct-w">${freePctStr}%</span></span>
                        </div>
                      </div>
                      <div class="ag-ov-submetrics">
                        <div class="ag-ov-kv-row">
                          <span class="ag-ov-muted">${L('缓存命中率', 'Prompt cache')}</span>
                          <span><strong class="ag-ov-blue-txt">${stats.lastCacheRate}%</strong> <span class="ag-ov-muted">${L('· 累计', '· avg')} ${stats.sessionCacheRate}%</span></span>
                        </div>
                        <div class="ag-ov-kv-row">
                          <span class="ag-ov-muted">${L('累计输出', 'Output split')}</span>
                          <span>${L('思考', 'Think')} ${escapeHtml(fmtOvTokens(stats.totalThink))} · ${L('正文', 'Resp')} ${escapeHtml(fmtOvTokens(stats.totalResp))}</span>
                        </div>
                      </div>`
                    : `<div class="ag-ov-empty-inline">${L('发送消息后将显示实时上下文与缓存拆解', 'Context and cache telemetry appear after the first turn')}</div>`
                }
                <div class="ag-ov-ctx-footer">
                  <span class="ag-ov-muted">${stats ? `${stats.turns} ${L('轮', 'turns')} · ${stats.calls} ${L('次调用', 'calls')}` : ''}</span>
                  ${compactBtnHtml}
                </div>
              </div>`
            : ''
        }
      </section>`;

    /* ---- 3. Quota Card (Google Blue + Used % aligned with elapsed time cursor) ---- */
    const tierDisplay = cachedUserTierName ? cachedUserTierName.trim() : '';
    const isQuotaSpinning = Date.now() < ovRefreshSpinUntil;
    let quotaInnerHtml = '';
    if (groups.length === 0) {
      quotaInnerHtml = `<div class="ag-ov-empty-inline">${
        quotaFetchInFlight ? L('正在读取实时套餐限额…', 'Loading plan quotas…') : L('点击右上角刷新读取实时配额', 'Click refresh to load plan quotas')
      }</div>`;
    } else {
      const pIdx = ovPrimaryIdx >= 0 && ovPrimaryIdx < groups.length ? ovPrimaryIdx : 0;
      const primaryGrp = groups[pIdx];
      const pShort = localizeGroupShortName(primaryGrp.displayName);
      const sortBuckets = (list) =>
        (list || []).slice().sort((a, b) => {
          const r = (w) => (w === '5h' ? 0 : w === 'daily' ? 1 : 2);
          return r(String(a.window || '').toLowerCase()) - r(String(b.window || '').toLowerCase());
        });
      const primaryBuckets = sortBuckets(primaryGrp.buckets);

      const fmtOvQuotaPct = formatQuotaUsedPctStr;
      const renderQuotaBucketBox = (groupShortName, b) => {
        const rem =
          b.remaining && b.remaining.case === 'remainingFraction' && typeof b.remaining.value === 'number'
            ? b.remaining.value
            : typeof b.remainingFraction === 'number'
              ? b.remainingFraction
              : 1;
        const usedRaw = Math.max(0, Math.min(100, (1 - rem) * 100));
        const usedPctStr = fmtOvQuotaPct(usedRaw);
        const remPctStr = fmtOvQuotaPct(100 - usedRaw);
        const winTag = localizeQuotaWindowTag(b.window, b.displayName || '');
        const col = ovQuotaUsedColor(usedRaw);
        const litCount = usedRaw <= 0 ? 0 : Math.min(20, Math.max(1, Math.round(usedRaw / 5)));
        const segsHtml = Array.from({ length: 20 }, (_, i) =>
          `<span class="ag-ov-seg" style="background:${i < litCount ? col : 'var(--ag-ov-track)'}"></span>`
        ).join('');
        const elapsedPct = computeWindowElapsedPct(b, usedRaw);
        const cursorHtml =
          elapsedPct !== null
            ? `<div class="ag-ov-time-track" title="${escapeHtml(L(`窗口时间已流逝 ${elapsedPct}%`, `Window elapsed ${elapsedPct}%`))}">
                <div class="ag-ov-time-fill" style="width:${elapsedPct}%"></div>
                <span class="ag-ov-time-cursor" style="left:${elapsedPct}%"></span>
              </div>`
            : '';
        const resetTxt = formatResetLabel(b, usedRaw);
        return `<div class="ag-ov-quota-box" title="${escapeHtml(L(`已用 ${usedPctStr}% · 剩余 ${remPctStr}%`, `${usedPctStr}% used · ${remPctStr}% left`))}">
          <div class="ag-ov-kv-row">
            <span class="ag-ov-row-left">
              <i class="ag-ov-qdot" style="background:${col}"></i>
              <span class="ag-ov-qtitle">${escapeHtml(groupShortName)}${winTag ? ` · ${escapeHtml(winTag)}` : ''}</span>
            </span>
            <span class="ag-ov-qpct">${usedPctStr}% ${L('已用', 'used')}</span>
          </div>
          <div class="ag-ov-seg-bar">${segsHtml}</div>
          ${cursorHtml}
          ${resetTxt ? `<div class="ag-ov-reset-txt">${escapeHtml(resetTxt)}</div>` : ''}
        </div>`;
      };

      const primaryHtml = primaryBuckets.map((b) => renderQuotaBucketBox(pShort, b)).join('');

      const otherRows = [];
      groups.forEach((g, idx) => {
        if (idx === pIdx) return;
        const gShort = localizeGroupShortName(g.displayName);
        for (const b of sortBuckets(g.buckets)) {
          otherRows.push(renderQuotaBucketBox(gShort, b));
        }
      });

      const otherHtml =
        otherRows.length > 0
          ? `<div class="ag-ov-other-pools">
              <button type="button" class="ag-ov-sub-toggle" data-ag-ov-collapse="otherPools">
                <span class="ag-ov-row-left">
                  ${buildOvChevronSvg(ovCollapseState.otherPools)}
                  <span class="ag-ov-muted">${L('其他模型池', 'Other model pools')}</span>
                </span>
                <span class="ag-ov-muted">${otherRows.length}</span>
              </button>
              ${ovCollapseState.otherPools ? `<div class="ag-ov-other-pools-list">${otherRows.join('')}</div>` : ''}
            </div>`
          : '';

      quotaInnerHtml = `${primaryHtml}${otherHtml}`;
    }

    const quotaCardHtml = `
      <section class="ag-ov-card" data-ov-card="quota">
        <div class="ag-ov-card-hdr">
          <button type="button" class="ag-ov-hdr-toggle" data-ag-ov-collapse="quota">
            ${buildOvChevronSvg(ovCollapseState.quota)}
            <span>Antigravity</span>
            ${tierDisplay ? `<span class="ag-ov-tier-pill">${escapeHtml(tierDisplay)}</span>` : ''}
          </button>
          <div class="ag-ov-hdr-actions">
            <button type="button" class="ag-ov-icon-btn" data-ag-ov-action="refresh-quota" title="${escapeHtml(L('刷新实时配额', 'Refresh quota'))}" aria-label="${escapeHtml(L('刷新配额', 'Refresh quota'))}">
              <svg class="${isQuotaSpinning ? 'ag-ov-spinning' : ''}" width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path d="M13.2 8a5.2 5.2 0 1 1-1.4-3.55" stroke-linecap="round"/><path d="M13.4 2.5v2.6h-2.6" stroke-linecap="round" stroke-linejoin="round"/></svg>
            </button>
          </div>
        </div>
        ${ovCollapseState.quota ? `<div class="ag-ov-card-body ag-ov-quota-body">${quotaInnerHtml}</div>` : ''}
      </section>`;

    /* ---- 4. Side chats / Subagents (Rendered only when children exist) ---- */
    const sidechatsCardHtml =
      mergedChildren.length > 0
        ? `<section class="ag-ov-card" data-ov-card="sidechats">
            <div class="ag-ov-card-hdr">
              <button type="button" class="ag-ov-hdr-toggle" data-ag-ov-collapse="sidechats">
                ${buildOvChevronSvg(ovCollapseState.sidechats)}
                <span>${L('子智能体', 'Side chats')}</span>
              </button>
              <span class="ag-ov-count-pill">${mergedChildren.length}</span>
            </div>
            ${
              ovCollapseState.sidechats
                ? `<div class="ag-ov-list-body">
                    ${mergedChildren
                      .map((ch) => {
                        const label = ch.title || ch.agentName || ch.id.slice(0, 8);
                        const statusHtml = ch.running
                          ? `<span class="ag-ov-status-run">${L('运行中', 'Running')}</span>`
                          : `<span class="ag-ov-muted">${L('已完成', 'Done')}</span>`;
                        const iconHtml = ch.running
                          ? `<i class="ag-ov-dot-live"></i>`
                          : `<svg width="13" height="13" class="ag-ov-muted ag-ov-shrink0" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><path d="M3.5 8.2 6.5 11.2 12.5 4.8" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
                        return `<button type="button" class="ag-ov-row-btn" data-ag-ov-action="sidechat" data-cid="${escapeHtml(ch.id)}">
                          <span class="ag-ov-row-left">${iconHtml}<span class="ag-ov-trunc">${escapeHtml(label)}</span></span>
                          ${statusHtml}
                        </button>`;
                      })
                      .join('')}
                  </div>`
                : ''
            }
          </section>`
        : '';

    /* ---- 5. Connectors & Inventory (Claude Code Style, Default Collapsed) ---- */
    const skillsData = (snap && snap.skills) || { total: 0, userCount: 0, items: [] };
    const agentsData = (snap && snap.agents) || { total: 0, items: [] };
    const connList = (snap && Array.isArray(snap.connectors) && snap.connectors) || [];
    const shownConns = ovCollapseState.connectorsExtra ? connList : connList.slice(0, 5);
    const hiddenConnCount = Math.max(0, connList.length - 5);

    const connectorsCardHtml = `
      <section class="ag-ov-card" data-ov-card="connectors">
        <div class="ag-ov-card-hdr">
          <button type="button" class="ag-ov-hdr-toggle" data-ag-ov-collapse="connectors">
            ${buildOvChevronSvg(ovCollapseState.connectors)}
            <span>${L('连接器与能力', 'Connectors & Skills')}</span>
          </button>
          <span class="ag-ov-muted ag-ov-tabular">${L(`${connList.length} MCP · ${skillsData.total} 技能`, `${connList.length} MCP · ${skillsData.total} Skills`)}</span>
        </div>
        ${
          ovCollapseState.connectors
            ? `<div class="ag-ov-card-body ag-ov-conn-wrap">
                <div class="ag-ov-inv-group">
                  <button type="button" class="ag-ov-inv-toggle" data-ag-ov-collapse="invMemory">
                    <span class="ag-ov-row-left">${buildOvChevronSvg(ovCollapseState.invMemory)}<span>${L('记忆与规则', 'Memory / Rules')}</span></span>
                    <span class="ag-ov-muted ag-ov-tabular">${rulesList.length}</span>
                  </button>
                  ${
                    ovCollapseState.invMemory
                      ? `<div class="ag-ov-inv-items">
                          ${
                            rulesList.length > 0
                              ? rulesList
                                  .map(
                                    (r) =>
                                      `<button type="button" class="ag-ov-inv-link" data-ag-ov-action="${r.scope === 'project' ? 'edit-rules' : 'reveal-path'}" data-path="${escapeHtml(r.path)}">${escapeHtml(r.label)}</button>`
                                  )
                                  .join('')
                              : `<div class="ag-ov-empty-inline">${L('暂无规则文件', 'No rule files')}</div>`
                          }
                        </div>`
                      : ''
                  }

                  <button type="button" class="ag-ov-inv-toggle" data-ag-ov-collapse="invSkills">
                    <span class="ag-ov-row-left">${buildOvChevronSvg(ovCollapseState.invSkills)}<span>${L('技能清单', 'Skills')}</span></span>
                    <span class="ag-ov-muted ag-ov-tabular">${skillsData.total}</span>
                  </button>
                  ${
                    ovCollapseState.invSkills
                      ? `<div class="ag-ov-inv-items">
                          ${skillsData.items
                            .slice(0, 12)
                            .map(
                              (s) =>
                                `<button type="button" class="ag-ov-inv-link" data-ag-ov-action="reveal-path" data-path="${escapeHtml(s.path)}" title="${escapeHtml(s.source)}">${escapeHtml(s.name)}</button>`
                            )
                            .join('')}
                          ${
                            skillsData.total > 12
                              ? `<button type="button" class="ag-ov-inv-more" data-ag-ov-action="open-skills-dir">${L(`… 其余 ${skillsData.total - 12} 项（打开技能目录）`, `… ${skillsData.total - 12} more (open folder)`)}</button>`
                              : ''
                          }
                        </div>`
                      : ''
                  }

                  <button type="button" class="ag-ov-inv-toggle" data-ag-ov-collapse="invAgents">
                    <span class="ag-ov-row-left">${buildOvChevronSvg(ovCollapseState.invAgents)}<span>${L('自定义子 Agent', 'Custom agents')}</span></span>
                    <span class="ag-ov-muted ag-ov-tabular">${agentsData.total}</span>
                  </button>
                  ${
                    ovCollapseState.invAgents
                      ? `<div class="ag-ov-inv-items">
                          ${
                            agentsData.items.length > 0
                              ? agentsData.items
                                  .map(
                                    (a) =>
                                      `<button type="button" class="ag-ov-inv-link" data-ag-ov-action="reveal-path" data-path="${escapeHtml(a.path)}">${escapeHtml(a.name)}</button>`
                                  )
                                  .join('')
                              : `<button type="button" class="ag-ov-inv-more" data-ag-ov-action="open-agents-dir">${L('暂无自定义 Agent · 打开目录', 'None yet · open folder')}</button>`
                          }
                        </div>`
                      : ''
                  }
                </div>

                <div class="ag-ov-conn-sub">
                  <div class="ag-ov-conn-title">${L('已连接服务', 'Connectors')}</div>
                  ${
                    shownConns.length > 0
                      ? shownConns
                          .map((c) => {
                            const letterMatch = String(c.name || c.id || 'M').match(/[A-Za-z0-9]/);
                            const mono = letterMatch ? letterMatch[0].toUpperCase() : 'M';
                            return `<button type="button" class="ag-ov-conn-row" data-ag-ov-action="open-plugins" title="${escapeHtml(L('打开扩展插件管理', 'Open Extensions & Plugins'))}">
                              <span class="ag-ov-row-left">
                                <span class="ag-ov-monogram">${escapeHtml(mono)}</span>
                                <span class="ag-ov-trunc">${escapeHtml(c.name)}</span>
                              </span>
                              <i class="ag-ov-dot ag-ov-dot-green"></i>
                            </button>`;
                          })
                          .join('')
                      : `<div class="ag-ov-empty-inline">${L('暂无已配置的 MCP 连接器', 'No MCP connectors configured')}</div>`
                  }
                  ${
                    hiddenConnCount > 0
                      ? `<button type="button" class="ag-ov-show-more" data-ag-ov-action="toggle-connectors-more">${
                          ovCollapseState.connectorsExtra ? L('收起', 'Show less') : L(`展开更多 (${hiddenConnCount})`, `Show more (${hiddenConnCount})`)
                        }</button>`
                      : ''
                  }
                </div>
              </div>`
            : ''
        }
      </section>`;

    sectionsEl.innerHTML = `${envCardHtml}${ctxCardHtml}${quotaCardHtml}${sidechatsCardHtml}${connectorsCardHtml}`;
  }

  function isNativeArtifactOverviewBlock(el) {
    if (!el || !el.querySelector) return false;
    if (el.querySelector('[data-testid="artifact-row"], [data-testid*="artifact"]')) return true;
    const hdrLbl = el.querySelector('span.agy-hover-label');
    const txt = hdrLbl ? String(hdrLbl.textContent || '').trim() : '';
    return /^(?:artifacts?|产物)$/i.test(txt);
  }

  const OV_LIVE_POLL_MS = 12000;

  function onQuotaVisibilityOrFocus() {
    if (disposed) return;
    if (typeof document.visibilityState === 'string' && document.visibilityState === 'hidden') return;
    if ((isOverviewPanelVisible() || quotaPopoverOpen) && Date.now() - lastForceQuotaFetchTs >= 5000) {
      scheduleAutoQuotaRefresh(150, 4000);
    }
  }
  window.addEventListener('focus', onQuotaVisibilityOrFocus);
  document.addEventListener('visibilitychange', onQuotaVisibilityOrFocus);

  function stopOverviewMinuteTicker() {
    if (ovMinuteTickerId) {
      clearInterval(ovMinuteTickerId);
      ovMinuteTickerId = null;
    }
  }

  function ensureOverviewMinuteTicker() {
    if (ovMinuteTickerId || disposed) return;
    ovMinuteTickerId = setInterval(() => {
      if (disposed || !FEAT.overviewPanel || !isOverviewPanelVisible()) {
        stopOverviewMinuteTicker();
        return;
      }
      if (
        (typeof document.visibilityState !== 'string' || document.visibilityState !== 'hidden') &&
        Date.now() - lastForceQuotaFetchTs >= OV_LIVE_POLL_MS
      ) {
        if (discoverQuotaService(false)) fetchQuotaSummary(true);
      }
      renderOverviewPanel(false);
    }, OV_LIVE_POLL_MS);
    if (ovMinuteTickerId && typeof ovMinuteTickerId.unref === 'function') {
      ovMinuteTickerId.unref();
    }
  }

  function syncOverviewPanel(force = false) {
    if (disposed || !FEAT.overviewPanel) {
      teardownOverviewPanel();
      return;
    }
    const panel = document.querySelector('[data-testid="overview-panel"]');
    if (!panel || panel.hidden || panel.getAttribute('aria-hidden') === 'true') {
      stopOverviewMinuteTicker();
      return;
    }

    if (panel.getAttribute('data-ag-ov-enhanced') !== '1') {
      panel.setAttribute('data-ag-ov-enhanced', '1');
    }

    const scrollBody =
      Array.from(panel.children).find((ch) => ch.classList && ch.classList.contains('overflow-y-auto')) || panel.children[1];
    if (!scrollBody) return;

    let sectionsEl = document.getElementById('ag-claude-ov-sections');
    if (sectionsEl && sectionsEl.parentElement !== scrollBody) {
      sectionsEl.remove();
      sectionsEl = null;
    }

    for (const child of Array.from(scrollBody.children)) {
      if (child.id === 'ag-claude-ov-sections') continue;
      if (child.querySelector && child.querySelector('button[data-testid^="overview-panel-row-"]')) {
        if (child.getAttribute('data-ag-ov-shortcuts') !== '1') child.setAttribute('data-ag-ov-shortcuts', '1');
        child.removeAttribute('data-ag-ov-native-artifact');
        child.removeAttribute('data-ag-ov-native-tail');
      } else if (isNativeArtifactOverviewBlock(child)) {
        if (child.getAttribute('data-ag-ov-native-artifact') !== '1') child.setAttribute('data-ag-ov-native-artifact', '1');
        child.removeAttribute('data-ag-ov-shortcuts');
        child.removeAttribute('data-ag-ov-native-tail');
      } else {
        if (child.getAttribute('data-ag-ov-native-tail') !== '1') child.setAttribute('data-ag-ov-native-tail', '1');
        child.removeAttribute('data-ag-ov-shortcuts');
        child.removeAttribute('data-ag-ov-native-artifact');
      }
    }

    if (!sectionsEl) {
      sectionsEl = document.createElement('div');
      sectionsEl.id = 'ag-claude-ov-sections';
      sectionsEl.setAttribute('data-ag-i18n-ignore', '1');
      sectionsEl.addEventListener('click', onOverviewSectionsClick);
      scrollBody.appendChild(sectionsEl);
    }

    ensureOverviewMinuteTicker();

    const now = Date.now();
    if ((!cachedQuotaGroups || now - lastForceQuotaFetchTs >= OV_LIVE_POLL_MS) && now - ovLastQuotaAutoTryTs > 4000) {
      ovLastQuotaAutoTryTs = now;
      if (discoverQuotaService(false)) fetchQuotaSummary(true);
    }

    renderOverviewPanel(force);
  }

  function teardownOverviewPanel() {
    stopOverviewMinuteTicker();
    if (ovQuotaSpinTimer) {
      cancelLater(ovQuotaSpinTimer);
      ovQuotaSpinTimer = 0;
    }
    ovRefreshSpinUntil = 0;
    ovSnapshotCache.clear();
    ovWorkspaceMemo = { ts: 0, key: '', value: null };
    ovCompactMemo = { ts: 0, key: '', status: 'idle' };
    const sectionsEl = document.getElementById('ag-claude-ov-sections');
    if (sectionsEl) sectionsEl.remove();
    document.querySelectorAll('[data-ag-ov-enhanced]').forEach((el) => el.removeAttribute('data-ag-ov-enhanced'));
    document.querySelectorAll('[data-ag-ov-shortcuts]').forEach((el) => el.removeAttribute('data-ag-ov-shortcuts'));
    document.querySelectorAll('[data-ag-ov-native-artifact]').forEach((el) => el.removeAttribute('data-ag-ov-native-artifact'));
    document.querySelectorAll('[data-ag-ov-native-tail]').forEach((el) => el.removeAttribute('data-ag-ov-native-tail'));
  }

  /* ---- scheduling: rAF-coalesced, throttled, and blind to our own DOM writes ---- */
  const MIN_SYNC_GAP_MS = 80;
  let throttleTimer = 0;
  function scheduleSync() {
    if (disposed || rafPending || throttleTimer) return;
    const wait = MIN_SYNC_GAP_MS - (Date.now() - lastSyncTs);
    if (wait > 0) {
      throttleTimer = later(() => {
        throttleTimer = 0;
        scheduleSync();
      }, wait);
      return;
    }
    rafPending = true;
    frame(syncStepStream);
  }

  const OWN_SEL =
    '.ag-collapse-ghost, .ag-orbit-dots, .ag-elapsed-timer, #ag-claude-ctx-ring, #ag-claude-quota-popover, #ag-claude-model-popover, #ag-claude-model-subpop, #ag-claude-model-tripop, .ag-claude-inline-editor, .ag-claude-folder-badges, #ag-claude-recent-section, #ag-recent-row-menu, #ag-project-action-menu, #ag-claude-ux-settings-nav, #ag-claude-ux-settings-panel, #ag-settings-stats-wrap, .ag-settings-subhdr-chev, #ag-claude-projects-nav-btn, #ag-claude-projects-view, #ag-claude-project-modal, .ag-code-fold-toggle, .ag-code-fold-bar, #ag-claude-ov-sections';
  const CLASS_WATCH_SEL =
    '[id="antigravity.agentSidePanelInputBox"], [data-testid="tool-group-collapsible"], [data-testid="worked-for-collapsible"], [data-testid="progress-updates-collapsible"], [data-testid="ephemeral-tool-status"]';

  function isOwnNode(n) {
    const el = n && (n.nodeType === 1 ? n : n.parentElement);
    return Boolean(el && el.closest && el.closest(OWN_SEL));
  }

  function isOwnChildListMutation(m) {
    if (isOwnNode(m.target)) return true;
    const total = m.addedNodes.length + m.removedNodes.length;
    if (!total) return true;
    for (const n of m.addedNodes) if (!isOwnNode(n)) return false;
    for (const n of m.removedNodes) if (!isOwnNode(n)) return false;
    return true;
  }

  const observer = new MutationObserver((mutations) => {
    if (disposed) return;
    let needSync = false;
    let sawChildList = false;
    for (const m of mutations) {
      if (m.type === 'attributes') {
        const t = m.target;
        if (!t || !t.getAttribute) continue;
        if (m.attributeName === 'aria-expanded') {
          if (FEAT.collapseAnim && t.getAttribute('data-testid') === 'tool-group-collapsible') {
            const exp = t.getAttribute('aria-expanded');
            if (exp === 'false') {
              animateCollapseIfNeeded(t);
            } else if (exp === 'true' && t.parentElement) {
              t.parentElement.querySelectorAll(':scope > .ag-collapse-ghost').forEach((g) => g.remove());
            }
          }
          if (!isOwnNode(t)) needSync = true;
        } else if (m.attributeName === 'class') {
          if (!isOwnNode(t) && t.closest && t.closest(CLASS_WATCH_SEL)) needSync = true;
        }
      } else if (m.type === 'childList') {
        if (!isOwnChildListMutation(m)) {
          needSync = true;
          sawChildList = true;
        }
      }
    }
    /* Synchronously translate & reconcile Settings in the microtask BEFORE Frame 0 paints so nothing ever flashes */
    if (sawChildList) {
      const sbNow = document.querySelector('[data-testid="settings-sidebar"]');
      if (sbNow !== settingsSidebarRef || sbNow) {
        if (FEAT.i18n && sbNow) {
          const dlgRoot = sbNow.closest('[role="dialog"]') || sbNow.closest('[data-split-root]') || sbNow.parentElement || sbNow;
          uxTranslateSubtree(dlgRoot);
        }
        reconcileSettingsPanel();
      }
    }
    if (needSync) scheduleSync();
  });

  let bodyEnhancementsMounted = false;
  let pendingBodyReadyCleanup = null;

  function mountBodyEnhancements() {
    if (disposed || bodyEnhancementsMounted || !document.body) return false;
    bodyEnhancementsMounted = true;
    window.__ag_custom_js_mounted = true;
    if (pendingBodyReadyCleanup) {
      pendingBodyReadyCleanup();
      pendingBodyReadyCleanup = null;
    }
    const staleThemeToggle = document.getElementById('ag-claude-topbar-theme');
    if (staleThemeToggle) staleThemeToggle.remove();
    document.querySelectorAll('[data-ag-todo-dock], [data-ag-todo-mount]').forEach((el) => el.remove());
    document
      .querySelectorAll('[data-ag-todo-primary], [data-ag-todo-merged], [data-ag-todo-empty-wrap], [data-ag-todo-marker-line]')
      .forEach((el) => {
        el.removeAttribute('data-ag-todo-primary');
        el.removeAttribute('data-ag-todo-merged');
        el.removeAttribute('data-ag-todo-empty-wrap');
        el.removeAttribute('data-ag-todo-marker-line');
      });
    applyUiI18nState(FEAT.i18n);
    if (needsInitialPrefsSync) {
      persistUiPrefsToDaemon(localOverrideTs || Date.now());
    }
    observer.observe(document.body, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ['aria-expanded', 'class']
    });
    syncStepStream();
    return true;
  }

  if (!mountBodyEnhancements()) {
    const onBodyReady = () => {
      mountBodyEnhancements();
    };
    window.addEventListener('DOMContentLoaded', onBodyReady, { once: true });
    document.addEventListener('readystatechange', onBodyReady);
    let docElObs = null;
    if (typeof MutationObserver === 'function' && document.documentElement) {
      docElObs = new MutationObserver(() => {
        if (document.body) mountBodyEnhancements();
      });
      docElObs.observe(document.documentElement, { childList: true });
    }
    pendingBodyReadyCleanup = () => {
      window.removeEventListener('DOMContentLoaded', onBodyReady);
      document.removeEventListener('readystatechange', onBodyReady);
      if (docElObs) {
        docElObs.disconnect();
        docElObs = null;
      }
    };
  }

  function dispose() {
    if (disposed) return;
    disposed = true;
    window.__ag_custom_js_mounted = false;
    if (pendingBodyReadyCleanup) {
      pendingBodyReadyCleanup();
      pendingBodyReadyCleanup = null;
    }
    projectComposerDrafts.clear();
    observer.disconnect();
    stopUxI18nObserver();
    try {
      teardownCodeBlocks();
    } catch {}
    for (const id of pendingRafs) cancelAnimationFrame(id);
    pendingRafs.clear();
    for (const id of pendingTimeouts) clearTimeout(id);
    pendingTimeouts.clear();
    if (timerIntervalId) {
      clearInterval(timerIntervalId);
      timerIntervalId = null;
    }
    if (compactPollTimerId) {
      clearInterval(compactPollTimerId);
      compactPollTimerId = null;
    }
    compactedMetaByCid.clear();
    compactedStaleSigByCid.clear();
    document.removeEventListener('click', onDocClick, true);
    document.removeEventListener('pointerdown', onOutsidePopoverPointerDown, true);
    document.removeEventListener('keydown', onPopoverKeyDown, true);
    document.removeEventListener('pointerdown', onModelTriggerPointerDown, true);
    document.removeEventListener('mousedown', onModelTriggerSwallowMouseClick, true);
    document.removeEventListener('click', onModelTriggerSwallowMouseClick, true);
    document.removeEventListener('keydown', onModelPopoverKeyDown, true);
    document.removeEventListener('contextmenu', onNativeContextMenuCapture, true);
    document.removeEventListener('click', onRevertButtonClick, true);
    document.removeEventListener('keydown', onInlineEditDocKeyDown, true);
    document.removeEventListener('mouseenter', onMetricsPillMouseEnter, true);
    document.removeEventListener('mouseleave', onMetricsPillMouseLeave, true);
    document.removeEventListener('click', onMetricsPillClick, true);
    document.removeEventListener('pointerdown', onPinnedRowPointerDown, true);
    window.removeEventListener('pointermove', onPinnedRowPointerMove, true);
    window.removeEventListener('pointerup', onPinnedRowPointerUp, true);
    window.removeEventListener('pointercancel', onPinnedRowPointerCancel, true);
    clearPinnedComposerDropHighlights();
    window.removeEventListener('resize', onWindowResizePopover);
    window.removeEventListener('focus', onWindowSidebarEvent);
    window.removeEventListener('blur', onWindowSidebarEvent);
    window.removeEventListener('popstate', onWindowSidebarEvent);
    window.removeEventListener('focus', onQuotaVisibilityOrFocus);
    document.removeEventListener('visibilitychange', onQuotaVisibilityOrFocus);
    if (autoQuotaRefreshTimer) {
      cancelLater(autoQuotaRefreshTimer);
      autoQuotaRefreshTimer = 0;
    }
    if (sidebarStoreUnsub) {
      sidebarStoreUnsub();
      sidebarStoreUnsub = null;
      sidebarStoreRef = null;
    }
    closeInlineEdit(false);
    clearAllFolderBadges();
    removeRecentSection();
    clearSidebarHideNativeProjects();
    teardownCustomizationsEnhancement();
    teardownOverviewPanel();
    if (prefStoreUnsub) {
      try {
        prefStoreUnsub();
      } catch {}
      prefStoreUnsub = null;
    }
    cachedPrefStore = null;
    cachedExecutorRoleBaseIds = null;
    executorRolesFetchInFlight = false;
    executorRolesLastTryTs = 0;
    teardownProjectsWorkspace({ forceCloseAllModals: true });
    if (sharedModalEscBound) {
      document.removeEventListener('keydown', onSharedModalEscKeyDown, true);
      sharedModalEscBound = false;
    }
    const floatToast = document.getElementById('ag-projects-float-toast');
    if (floatToast) floatToast.remove();
    detachSettingsPanel();
    const ttEl = document.getElementById('ag-live-metrics-tooltip');
    if (ttEl) {
      ttEl.removeAttribute('data-ag-pinned');
      ttEl.removeAttribute('data-visible');
    }
    if (ownMetricsWrapper && window.__ag_render_metrics === ownMetricsWrapper) {
      window.__ag_render_metrics = ownMetricsWrapper.__agOrig;
      if (window.__ag_last_metrics && typeof window.__ag_last_metrics === 'object') {
        if (window.__ag_last_metrics.__agOrigInlineHtml !== undefined) {
          window.__ag_last_metrics.inlineHtml = window.__ag_last_metrics.__agOrigInlineHtml;
        }
        if (window.__ag_last_metrics.__agOrigTooltipHtml !== undefined) {
          window.__ag_last_metrics.tooltipHtml = window.__ag_last_metrics.__agOrigTooltipHtml;
        }
      }
      if (typeof window.__ag_render_metrics === 'function' && window.__ag_last_metrics) {
        try {
          window.__ag_render_metrics(window.__ag_last_metrics);
        } catch {}
      }
    }
    document
      .querySelectorAll(
        '.ag-collapse-ghost, .ag-orbit-dots, .ag-elapsed-timer, #ag-claude-ctx-ring, #ag-claude-quota-popover, #ag-claude-model-popover, #ag-claude-model-subpop, #ag-claude-model-tripop, #ag-custom-font-overrides'
      )
      .forEach((el) => el.remove());
    document
      .querySelectorAll(
        '[data-ag-model-open], [data-ag-inline-stream]'
      )
      .forEach((el) => {
        el.removeAttribute('data-ag-model-open');
        el.removeAttribute('data-ag-inline-stream');
      });
    restoreInlinePillBoundaries();
    restoreLegacySidebarCjkNodes();
    clearSidebarHideNativeProjects();
    clearPinnedSidebarRowTooltips();
    if (docRoot && docRoot.getAttribute('lang') === 'zh-CN') {
      if (hadDocLang && origDocLang !== null) docRoot.setAttribute('lang', origDocLang);
      else docRoot.removeAttribute('lang');
    }
    if (docRoot) {
      docRoot.removeAttribute('data-ag-ux-lang');
      docRoot.removeAttribute('data-ag-cjk-scale');
      docRoot.removeAttribute('data-ag-glass');
      docRoot.removeAttribute('data-ag-grid-bg');
    }
    if (window.__agClaudeUxDispose === dispose) window.__agClaudeUxDispose = null;
  }

  window.__agClaudeUxDispose = dispose;
  if (typeof ctx !== 'undefined' && ctx && typeof ctx.onCleanup === 'function') {
    ctx.onCleanup(dispose);
  }
})();
