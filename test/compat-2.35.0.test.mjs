/**
 * Compatibility regression for Antigravity v2.35.0:
 * 1. New official Fiber prop `lockedReason` on the model selector: when present the native
 *    selector is deliberately pinned shut, so the custom layered menu MUST step aside
 *    (hard gap) instead of intercepting the trigger click.
 * 2. New official context prop `orchestratorExecutors`: the whitelisted executor option
 *    list now arrives directly on the selector API. The Executor Level-3 menu MUST render
 *    from it without depending on the orchestrator-model-roles Mendel flag.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

let JSDOM = null;
try {
  JSDOM = createRequire(import.meta.url)('jsdom').JSDOM;
} catch {}
const skipDom = JSDOM ? false : 'jsdom not installed';

function makeModelApi(overrides = {}) {
  const modelOptions = [
    { label: 'Gemini 4 Neon (High)', modelId: 'gemini-4-neon-high', value: 1532, disabled: false },
    { label: 'Gemini 4 Neon (XHigh)', modelId: 'gemini-4-neon-xhigh', value: 1535, disabled: false },
    { label: 'Gemini 4 Hydrogen (Medium)', modelId: 'gemini-4-hydrogen-medium', value: 1526, disabled: false },
    { label: 'Gemini 4 Hydrogen (XHigh)', modelId: 'gemini-4-hydrogen-xhigh', value: 1528, disabled: false },
    { label: 'Claude Sonnet 5.5 (High)', modelId: 'claude-sonnet-5-5-high', value: 1405, disabled: false },
    { label: 'Orchestrator (Neon)', modelId: 'gemini-pro-orchestrator-neon', value: 1537, disabled: false }
  ];
  const api = {
    modelOptions,
    selectedModel: modelOptions[0],
    setSelectedModel: () => {},
    open: false,
    setIsOpen: () => {},
    orchestratorPick: { model: 0, select: () => {} },
    orchestratorPlanners: [modelOptions[0], modelOptions[1]],
    ...overrides
  };
  return { api, modelOptions };
}

function bootDom(extraApi = {}, modulesOverride = {}) {
  const customJsSrc = fs.readFileSync(path.join(REPO, 'user', 'custom.js'), 'utf8');
  const dom = new JSDOM(
    `<!doctype html><html><body>
      <div id="root">
        <div id="antigravity.agentSidePanelInputBox">
          <button type="button" data-testid="model-selector-trigger">Gemini 4 Neon High</button>
        </div>
      </div>
    </body></html>`,
    { runScripts: 'outside-only', url: 'https://127.0.0.1:61999/' }
  );
  const { window } = dom;
  const doc = window.document;
  const { api } = makeModelApi(extraApi);
  const triggerBtn = doc.querySelector('button[data-testid="model-selector-trigger"]');
  triggerBtn.__reactFiber$v235 = { memoizedProps: { value: api }, return: null };
  window.ctx = { dict: {}, modules: { i18n: true, claudeUxModelMenu: true, ...modulesOverride }, onCleanup: () => {} };
  window.eval(customJsSrc);
  return { dom, window, doc, triggerBtn };
}

test('[v2.35 lockedReason] official locked model selector defers to native menu instead of opening custom popover', { skip: skipDom }, async () => {
  const { dom, window, doc, triggerBtn } = bootDom({ lockedReason: 'managed_by_policy' });
  try {
    triggerBtn.dispatchEvent(new window.MouseEvent('pointerdown', { bubbles: true, button: 0 }));
    await new Promise((r) => setTimeout(r, 30));

    const mainPop = doc.getElementById('ag-claude-model-popover');
    assert.equal(
      mainPop === null || mainPop.getAttribute('data-open') !== 'true',
      true,
      'locked selector (lockedReason) must NOT open the custom layered menu'
    );
    assert.equal(
      triggerBtn.getAttribute('data-ag-model-open') === 'true',
      false,
      'trigger must not be marked open by the custom menu while locked'
    );
  } finally {
    try { window.__agClaudeUxDispose(); } catch {}
    dom.window.close();
  }
});

test('[v2.35 orchestratorExecutors] Executor Level-3 menu renders directly from official api.orchestratorExecutors without Mendel whitelist fetch', { skip: skipDom }, async () => {
  const { dom, window, doc, triggerBtn } = bootDom({
    orchestratorExecutors: [
      { label: 'Gemini 4 Hydrogen (Medium)', modelId: 'gemini-4-hydrogen-medium', value: 1526, disabled: false },
      { label: 'Gemini 4 Hydrogen (XHigh)', modelId: 'gemini-4-hydrogen-xhigh', value: 1528, disabled: false },
      { label: 'Claude Sonnet 5.5 (High)', modelId: 'claude-sonnet-5-5-high', value: 1405, disabled: false },
      { label: 'Disabled Executor (High)', modelId: 'gemini-disabled-high', value: 1601, disabled: true }
    ]
  });
  try {
    triggerBtn.dispatchEvent(new window.MouseEvent('pointerdown', { bubbles: true, button: 0 }));
    await new Promise((r) => setTimeout(r, 30));

    const mainPop = doc.getElementById('ag-claude-model-popover');
    const subPop = doc.getElementById('ag-claude-model-subpop');
    const triPop = doc.getElementById('ag-claude-model-tripop');
    assert.equal(mainPop.getAttribute('data-open'), 'true');

    mainPop.querySelector('[data-ag-cm-subtrigger="more"]').click();
    assert.equal(subPop.getAttribute('data-open'), 'true');

    const execRow = subPop.querySelector('[data-ag-cm-tritrigger="executor"]');
    assert.ok(execRow, 'Executor model row appears when official orchestratorExecutors is provided');
    execRow.click();
    assert.equal(triPop.getAttribute('data-open'), 'true');
    assert.equal(triPop.getAttribute('data-tri-kind'), 'executor');
    assert.match(triPop.textContent, /Gemini 4 Hydrogen/);
    assert.match(triPop.textContent, /Claude Sonnet 5\.5/);
    assert.doesNotMatch(triPop.textContent, /Disabled Executor/, 'disabled official executor entries are filtered out');
  } finally {
    try { window.__agClaudeUxDispose(); } catch {}
    dom.window.close();
  }
});

test('[v2.35 tooltipNote] active-turn tooltipNote is recognized without drift dot and renders localized hint', { skip: skipDom }, async () => {
  const note = 'Applies to /btw and messages sent after this turn';
  const { dom, window, doc, triggerBtn } = bootDom({ tooltipNote: note }, { i18n: true });
  try {
    triggerBtn.dispatchEvent(new window.MouseEvent('pointerdown', { bubbles: true, button: 0 }));
    await new Promise((r) => setTimeout(r, 30));

    const mainPop = doc.getElementById('ag-claude-model-popover');
    assert.equal(mainPop.getAttribute('data-open'), 'true');

    const nativeRow = mainPop.querySelector('[data-ag-cm-native="1"]');
    assert.ok(nativeRow, 'native menu row is present');
    assert.equal(nativeRow.getAttribute('data-ag-cm-native-gaps'), null, 'tooltipNote must NOT trigger unknown-field drift gap');
    assert.equal(nativeRow.querySelector('.ag-cm-dot'), null, 'native menu row must NOT show drift dot for tooltipNote');

    const noteEl = mainPop.querySelector('[data-ag-cm-note="1"]');
    assert.ok(noteEl, 'tooltipNote hint banner renders inside custom model popover');
    assert.equal(noteEl.textContent, '将用于 /btw 及本轮之后的新消息');
  } finally {
    try { window.__agClaudeUxDispose(); } catch {}
    dom.window.close();
  }

  const enRun = bootDom({ tooltipNote: note }, { i18n: false });
  try {
    enRun.triggerBtn.dispatchEvent(new enRun.window.MouseEvent('pointerdown', { bubbles: true, button: 0 }));
    await new Promise((r) => setTimeout(r, 30));
    const noteEl = enRun.doc.querySelector('#ag-claude-model-popover [data-ag-cm-note="1"]');
    assert.ok(noteEl, 'tooltipNote hint banner renders in English mode');
    assert.equal(noteEl.textContent, note);
  } finally {
    try { enRun.window.__agClaudeUxDispose(); } catch {}
    enRun.dom.window.close();
  }

  const idleRun = bootDom({});
  try {
    idleRun.triggerBtn.dispatchEvent(new idleRun.window.MouseEvent('pointerdown', { bubbles: true, button: 0 }));
    await new Promise((r) => setTimeout(r, 30));
    assert.equal(idleRun.doc.querySelector('#ag-claude-model-popover [data-ag-cm-note="1"]'), null, 'idle state hides note banner');
  } finally {
    try { idleRun.window.__agClaudeUxDispose(); } catch {}
    idleRun.dom.window.close();
  }
});
