/**
 * Regression test suite for v2.6.2 code audit findings (Reports 1 & 2, items #1–#16 + security & minor items).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const INSTALL = path.join(REPO, 'install.mjs');
const HERMETIC_DAEMON_STATE = fs.mkdtempSync(path.join(os.tmpdir(), 'ac-daemon-state-'));
process.env.ANTI_CLAUDE_STATE_DIR = HERMETIC_DAEMON_STATE;
process.on('exit', () => {
  try {
    fs.rmSync(HERMETIC_DAEMON_STATE, { recursive: true, force: true });
  } catch {}
});

let JSDOM = null;
try {
  JSDOM = createRequire(process.env.JSDOM_FROM || import.meta.url)('jsdom').JSDOM;
} catch {}
const skipDom = JSDOM ? false : 'jsdom not installed';

function parseTrailingJson(s) {
  const str = String(s || '');
  const starts = str.startsWith('{') ? [0] : [];
  for (let i = str.indexOf('\n{'); i !== -1; i = str.indexOf('\n{', i + 1)) starts.push(i + 1);
  for (let j = starts.length - 1; j >= 0; j--) {
    try {
      return JSON.parse(str.slice(starts[j]).trim());
    } catch {}
  }
  return null;
}

function makeSandboxHome() {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'ac-audit-home-'));
  const agy = path.join(home, '.gemini', 'antigravity');
  fs.mkdirSync(agy, { recursive: true });
  fs.writeFileSync(path.join(agy, 'antigravity_state.pbtxt'), 'product_skin: PRODUCT_SKIN_NON_TECHNICAL\n');
  fs.mkdirSync(path.join(home, '.gemini', 'config'), { recursive: true });
  fs.writeFileSync(
    path.join(home, '.gemini', 'config', 'config.json'),
    JSON.stringify({ userSettings: { verboseConversationSteps: false } })
  );
  fs.writeFileSync(path.join(home, '.gemini', 'AGENTS.md'), '# my global rules\n');
  return {
    home,
    cleanup: () => fs.rmSync(home, { recursive: true, force: true })
  };
}

function runInstallCli(home, args, extraEnv = {}) {
  const r = spawnSync(process.execPath, [INSTALL, ...args], {
    encoding: 'utf8',
    env: {
      ...process.env,
      HOME: home,
      ANTI_CLAUDE_NO_NETWORK: '1',
      ANTI_CLAUDE_NO_LAUNCHD: '1',
      ANTI_CLAUDE_NO_CDP: '1',
      ANTI_CLAUDE_NO_FONTS: '1',
      ANTI_CLAUDE_NO_CLI: '1',
      FAKE_VERIFY_OK: '1',
      ...extraEnv
    }
  });
  return { status: r.status, out: parseTrailingJson(r.stdout), stdout: r.stdout, stderr: r.stderr };
}

/* -------------------------------------------------------------------------- */
/* Daemon, PID, Bootstrap, Project Context, Sidecars, YAML & Security         */
/* -------------------------------------------------------------------------- */

test('[Audit #1 & #9-R2] unified WYSIWYG AGENTS.md read/write preserves attachments, strips --- divider on clear, and migrates legacy schema 1', async () => {
  const daemon = await import(pathToFileURL(path.join(REPO, 'core', 'daemon.mjs')).href);
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ac-proj-partial-'));
  const projDir = path.join(tmpRoot, 'my-proj');
  const legacyDir = path.join(tmpRoot, 'legacy-proj');
  const linkedDir = path.join(tmpRoot, 'linked-lib');
  const extSrc = path.join(tmpRoot, 'spec.md');
  fs.mkdirSync(projDir, { recursive: true });
  fs.mkdirSync(legacyDir, { recursive: true });
  fs.mkdirSync(linkedDir, { recursive: true });
  fs.writeFileSync(extSrc, '# Spec Document\nImportant details.\n');
  fs.writeFileSync(path.join(projDir, 'AGENTS.md'), '# Existing Project Rules\nKeep me intact.\n');

  try {
    /* 1. Direct WYSIWYG read: pre-existing AGENTS.md is immediately surfaced as `instructions` */
    const preRead = daemon.saveProjectContext(
      {
        dirPath: projDir,
        files: [{ action: 'add', sourcePath: extSrc, name: 'spec.md' }],
        extraFolders: [{ name: 'linked-lib', absPath: linkedDir }]
      },
      { registryFile: null }
    );
    assert.equal(preRead.ok, true);
    assert.equal(preRead.instructions, '# Existing Project Rules\nKeep me intact.');
    assert.equal(preRead.hasAgentsMd, true);
    assert.equal(preRead.files.length, 1);
    assert.equal(preRead.extraFolders.length, 1);
    const managedPath = preRead.files[0].absPath;
    assert.equal(fs.existsSync(managedPath), true, 'managed attachment copy created');

    /* 2. Partial update with ONLY `instructions` updates AGENTS.md body while preserving files & folders at bottom */
    const afterInstOnly = daemon.saveProjectContext(
      {
        dirPath: projDir,
        instructions: '# Updated Project Rules\nEdited directly in UI.'
      },
      { registryFile: null }
    );
    assert.equal(afterInstOnly.ok, true);
    assert.equal(afterInstOnly.instructions, '# Updated Project Rules\nEdited directly in UI.');
    assert.equal(afterInstOnly.files.length, 1, 'attachment preserved on instructions-only save');
    assert.equal(afterInstOnly.extraFolders.length, 1, 'linked folder preserved on instructions-only save');
    assert.equal(fs.existsSync(managedPath), true, 'managed copy on disk still exists');
    const diskWithFooter = fs.readFileSync(path.join(projDir, 'AGENTS.md'), 'utf8');
    assert.equal(diskWithFooter.startsWith('# Updated Project Rules\nEdited directly in UI.\n\n---\n\n<!-- BEGIN anti-claude-project -->'), true);

    /* 3. Removing attachments/folders while keeping instructions strips managed footer AND `---` cleanly */
    const filesCleared = daemon.saveProjectContext(
      {
        dirPath: projDir,
        files: [],
        extraFolders: []
      },
      { registryFile: null }
    );
    assert.equal(filesCleared.ok, true);
    assert.equal(filesCleared.files.length, 0);
    assert.equal(fs.existsSync(managedPath), false, 'explicit empty files array removes managed copy');
    const cleanAgents = fs.readFileSync(path.join(projDir, 'AGENTS.md'), 'utf8');
    assert.equal(cleanAgents, '# Updated Project Rules\nEdited directly in UI.\n');
    assert.equal(cleanAgents.includes('---'), false, 'no orphan --- divider left behind');
    assert.equal(fs.existsSync(path.join(projDir, '.anti-claude')), false, '.anti-claude dir removed when only AGENTS.md prose remains');

    /* 4. Legacy schema 1 project merges both outside AGENTS.md rules and legacy managed instructions without loss */
    fs.mkdirSync(path.join(legacyDir, '.anti-claude'), { recursive: true });
    fs.writeFileSync(
      path.join(legacyDir, '.anti-claude', 'project-context.json'),
      JSON.stringify({ schema: 1, instructions: 'Legacy modal note', files: [], extraFolders: [], scheduledTasks: [] })
    );
    fs.writeFileSync(
      path.join(legacyDir, 'AGENTS.md'),
      '<!-- BEGIN anti-claude-project -->\n## Project Context & Instructions\n\nLegacy modal note\n<!-- END anti-claude-project -->\n\n---\n\n# Repo Base Rules\n'
    );
    const migrated = daemon.saveProjectContext({ dirPath: legacyDir }, { registryFile: null });
    assert.equal(migrated.instructions, '# Repo Base Rules\n\nLegacy modal note');
    assert.equal(fs.readFileSync(path.join(legacyDir, 'AGENTS.md'), 'utf8'), '# Repo Base Rules\n\nLegacy modal note\n');
  } finally {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }
});

test('[Audit #7 & R2-#1] PID management never kills unrelated processes and reclaims stale reused PIDs', async () => {
  const daemon = await import(pathToFileURL(path.join(REPO, 'core', 'daemon.mjs')).href);
  const tmpState = fs.mkdtempSync(path.join(os.tmpdir(), 'ac-pid-test-'));
  const pidFile = path.join(tmpState, 'daemon.pid');
  const killed = [];

  try {
    assert.equal(
      daemon.isOwnDaemonProcess(42424, {
        killProbe: () => true,
        commandReader: () => 'sleep 60'
      }),
      false,
      'sleep 60 is not recognized as Anti-Claude daemon'
    );
    assert.equal(
      daemon.isOwnDaemonProcess(42425, {
        killProbe: () => true,
        commandReader: () => '/opt/homebrew/bin/node /Users/dev/Anti-Claude/core/daemon.mjs --user-dir /x'
      }),
      true,
      'node core/daemon.mjs is recognized as Anti-Claude daemon'
    );

    /* Stale PID reused by unrelated process (`sleep 60`): must NOT send SIGTERM */
    fs.writeFileSync(pidFile, '42424\n');
    daemon.claimPidFile({
      pidFile,
      stateDir: tmpState,
      runOnce: false,
      bindExit: false,
      isDaemonFn: () => false,
      killFn: (pid, sig) => killed.push([pid, sig])
    });
    assert.equal(killed.length, 0, 'unrelated process was not killed');
    assert.equal(fs.readFileSync(pidFile, 'utf8').trim(), String(process.pid));

    /* checkPidOwnership reclaims PID file instead of exiting when owner is a live non-daemon PID */
    fs.writeFileSync(pidFile, '42424\n');
    let supersededCalled = false;
    const status = daemon.checkPidOwnership({
      pidFile,
      stateDir: tmpState,
      runOnce: false,
      isDaemonFn: () => false,
      onSuperseded: () => {
        supersededCalled = true;
      }
    });
    assert.equal(status, 'reclaimed_stale');
    assert.equal(supersededCalled, false);
    assert.equal(fs.readFileSync(pidFile, 'utf8').trim(), String(process.pid));
  } finally {
    fs.rmSync(tmpState, { recursive: true, force: true });
  }
});

test('[Audit #5] macOS cold-boot waitForMacRelaunchReady waits past 900ms SingletonLock release and launches cleanly', async () => {
  const daemon = await import(pathToFileURL(path.join(REPO, 'core', 'daemon.mjs')).href);
  let clockMs = 0;
  let opened = 0;

  const res = await daemon.waitForMacRelaunchReady({
    targetPid: 66954,
    isProcessAlive: () => clockMs < 150, // exits at 150ms
    listMainProcs: async () => [], // no replacement process
    hasLock: () => clockMs < 950, // SingletonLock lingers until 950ms (> 350ms initial settle)
    onReadyToOpen: async () => {
      opened += 1;
    },
    nowFn: () => clockMs,
    sleepFn: async (ms) => {
      clockMs += ms;
    },
    pollMs: 120,
    initialSettleMs: 350
  });

  assert.equal(res.relaunched, true);
  assert.equal(opened, 1, 'relaunch executed once SingletonLock cleared at ~950ms');
  assert.ok(clockMs >= 950 && clockMs < 2000);

  /* Also verify abort when Electron's own replacement process spawns during settle */
  let openedWhenReplaced = 0;
  const replaced = await daemon.waitForMacRelaunchReady({
    targetPid: 66955,
    isProcessAlive: () => false,
    listMainProcs: async () => [{ pid: 67001, age: 0, hasCdp: false }],
    hasLock: () => true,
    onReadyToOpen: async () => {
      openedWhenReplaced += 1;
    },
    nowFn: () => 0,
    sleepFn: async () => {}
  });
  assert.equal(replaced.relaunched, false);
  assert.equal(replaced.reason, 'replaced_by_other_instance');
  assert.equal(openedWhenReplaced, 0);
});

test('[Audit #14 & R2-#8] editing native scheduled task preserves multi-folder workspace_uris; foreign sidecar delete is rejected', async () => {
  const daemon = await import(pathToFileURL(path.join(REPO, 'core', 'daemon.mjs')).href);
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ac-sidecar-test-'));
  const projA = path.join(tmpRoot, 'proj-a');
  const projB = path.join(tmpRoot, 'proj-b');
  const unrelatedDir = path.join(tmpRoot, 'other-proj');
  const sidecarsDir = path.join(tmpRoot, 'sidecars');
  fs.mkdirSync(projA, { recursive: true });
  fs.mkdirSync(projB, { recursive: true });
  fs.mkdirSync(unrelatedDir, { recursive: true });

  try {
    const uriA = pathToFileURL(projA).href;
    const uriB = pathToFileURL(projB).href;
    const uriOther = pathToFileURL(unrelatedDir).href;

    const nativeScDir = path.join(sidecarsDir, 'native-multi-ws');
    fs.mkdirSync(nativeScDir, { recursive: true });
    fs.writeFileSync(
      path.join(nativeScDir, 'sidecar.json'),
      JSON.stringify(
        {
          builtin: 'schedule',
          display_name: 'Old Name',
          description: 'Multi-workspace job',
          args: ['CRON_TZ=Asia/Shanghai 0 9 * * *', 'agentapi', 'new-conversation', '--', 'Check status'],
          restart_policy: 'always',
          agent_permissions: { workspace_uris: [uriA, uriB] }
        },
        null,
        2
      )
    );

    const foreignScDir = path.join(sidecarsDir, 'foreign-automation');
    fs.mkdirSync(foreignScDir, { recursive: true });
    fs.writeFileSync(
      path.join(foreignScDir, 'sidecar.json'),
      JSON.stringify({
        builtin: 'schedule',
        display_name: 'Foreign Job',
        args: ['0 8 * * *', 'agentapi', 'new-conversation', '--', 'Do other work'],
        agent_permissions: { workspace_uris: [uriOther] }
      })
    );

    /* Rename native task without changing folderPath -> both workspace_uris must survive */
    const saved = daemon.saveProjectScheduledTask(
      {
        dirPath: projA,
        task: {
          id: 'sidecar:native-multi-ws',
          sidecarId: 'native-multi-ws',
          name: 'Renamed Multi-WS Job',
          description: 'Multi-workspace job',
          instructions: 'Check status',
          folderPath: projA,
          frequency: 'daily',
          time: '09:00',
          timezone: 'Asia/Shanghai'
        }
      },
      { sidecarsDir }
    );
    assert.equal(saved.ok, true);
    const updatedSc = JSON.parse(fs.readFileSync(path.join(nativeScDir, 'sidecar.json'), 'utf8'));
    assert.equal(updatedSc.display_name, 'Renamed Multi-WS Job');
    assert.deepEqual(updatedSc.agent_permissions.workspace_uris, [uriA, uriB], 'both workspace_uris preserved');

    /* Attempting to delete a sidecar belonging to another project must be blocked */
    const delForeign = daemon.deleteProjectScheduledTask(
      { dirPath: projA, taskId: 'sidecar:foreign-automation', sidecarId: 'foreign-automation' },
      { sidecarsDir }
    );
    assert.equal(delForeign.ok, false);
    assert.equal(delForeign.error, 'sidecar_not_in_project');
    assert.equal(fs.existsSync(foreignScDir), true, 'foreign sidecar untouched');
  } finally {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }
});

test('[Audit R2-#10] createLocalSkill & createLocalAgent escape colons, hashes, backslashes, and quotes in YAML frontmatter', async () => {
  const daemon = await import(pathToFileURL(path.join(REPO, 'core', 'daemon.mjs')).href);
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ac-yaml-test-'));
  const skillsDir = path.join(tmpRoot, 'skills');
  const agentsDir = path.join(tmpRoot, 'agents');

  try {
    const sk = daemon.createLocalSkill(
      {
        name: 'Audit: Check #1',
        description: 'Path C:\\Users\\test\\notes and "quoted" value',
        instructions: 'Run check.'
      },
      { skillsDir }
    );
    assert.equal(sk.ok, true);
    const skillMd = fs.readFileSync(sk.skillMdPath, 'utf8');
    assert.match(skillMd, /^---\nname: "Audit: Check #1"\ndescription: "Path C:\\\\Users\\\\test\\\\notes and \\"quoted\\" value"\n---/);

    const ag = daemon.createLocalAgent(
      {
        name: 'reviewer-pro',
        description: 'Handles C:\\temp\\x: #tag "safe"',
        systemPrompt: 'Review carefully.'
      },
      { agentsDir }
    );
    assert.equal(ag.ok, true);
    const agentMd = fs.readFileSync(ag.filePath, 'utf8');
    assert.match(agentMd, /description: "Handles C:\\\\temp\\\\x: #tag \\"safe\\""/);
  } finally {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }
});

test('[Audit #4, #8 & R2-#3, R2-#7] CDP host verification: loading retry, Electron-only probe, context-scoped RPC auth & navigation revocation', async () => {
  const daemon = await import(pathToFileURL(path.join(REPO, 'core', 'daemon.mjs')).href);
  const realWS = globalThis.WebSocket;

  /* 1. Origin & non-Electron Chrome spoofing guards */
  assert.equal(daemon.isAllowedOrigin('file:///Users/alice/Downloads/evil.html'), false, 'arbitrary file:// rejected');
  assert.equal(
    daemon.isAllowedOrigin('file:///Applications/Antigravity.app/Contents/Resources/app/out/vs/code/electron-sandbox/workbench/workbench.html'),
    true
  );
  assert.equal(daemon.isAllowedOrigin('vscode-file://vscode-app/workbench.html'), true);

  if (JSDOM) {
    const spoofDom = new JSDOM('<!doctype html><body data-agy-theme="dark"></body>', {
      runScripts: 'outside-only',
      url: 'http://127.0.0.1:3000/',
      userAgent: 'Mozilla/5.0 Chrome/134.0.0.0 Safari/537.36'
    });
    spoofDom.window.__APP_CONFIG__ = { productName: 'antigravity' };
    assert.equal(
      spoofDom.window.eval(daemon.HOST_IDENTITY_PROBE_EXPR),
      'non_host',
      'regular Chrome tab spoofing __APP_CONFIG__ and data-agy-theme is rejected'
    );
    spoofDom.window.close();
  }

  /* 2. Slow-loading window (`loading` x3) is NOT blacklisted, then attaches once ready;
        subframe context & post-navigation context cannot invoke __agProjectRpc */
  daemon.rebuildBundleIfNeeded();
  daemon.attachedTargets.clear();
  daemon.skippedNonHostTargets.clear();

  let probeMode = 'loading';
  const rpcReplies = [];
  let lastSocket = null;

  class FakeCdpSocket extends EventTarget {
    static OPEN = 1;
    constructor() {
      super();
      this.readyState = 1;
      lastSocket = this;
      queueMicrotask(() => this.dispatchEvent(new Event('open')));
    }
    emitEvent(method, params) {
      this.dispatchEvent(new MessageEvent('message', { data: JSON.stringify({ method, params }) }));
    }
    send(raw) {
      const { id, method, params } = JSON.parse(raw);
      const reply = (result = {}) =>
        this.dispatchEvent(new MessageEvent('message', { data: JSON.stringify({ id, result }) }));
      queueMicrotask(() => {
        if (method === 'Page.getFrameTree') {
          reply({ frameTree: { frame: { id: 'main-frame' } } });
        } else if (method === 'Runtime.enable') {
          this.emitEvent('Runtime.executionContextCreated', {
            context: { id: 101, origin: 'http://127.0.0.1:5199', auxData: { frameId: 'main-frame', isDefault: true, type: 'default' } }
          });
          this.emitEvent('Runtime.executionContextCreated', {
            context: { id: 202, origin: 'https://untrusted.example', auxData: { frameId: 'sub-frame', isDefault: true, type: 'default' } }
          });
          reply({});
        } else if (method === 'Runtime.evaluate') {
          if (String(params.expression).startsWith('window.__ag_project_rpc_resolve &&')) {
            rpcReplies.push(params.expression);
            reply({ result: { value: undefined } });
          } else if (String(params.expression).includes("return 'swarm'")) {
            reply({ result: { value: probeMode } });
          } else {
            reply({ result: { value: 'dark' } });
          }
        } else {
          reply({});
        }
      });
    }
    close() {
      this.readyState = 3;
      this.dispatchEvent(new Event('close'));
    }
  }

  const fakePage = {
    id: 'target-slow-1',
    type: 'page',
    url: 'http://127.0.0.1:5199/',
    webSocketDebuggerUrl: 'ws://127.0.0.1:5199/devtools/page/target-slow-1'
  };
  const fakeEndpoint = { channel: 'test', portFile: '', fallbackPort: 0, conversationsDir: os.tmpdir() };

  try {
    globalThis.WebSocket = FakeCdpSocket;

    /* Pass 1: window returns 'loading' 3 times -> must NOT enter skippedNonHostTargets */
    await daemon.attachTarget(fakePage, fakeEndpoint);
    assert.equal(daemon.attachedTargets.size, 0);
    assert.equal(daemon.skippedNonHostTargets.has(fakePage.id), false, 'loading window is not added to skippedNonHostTargets');

    /* Pass 2: window is now 'host' -> attaches cleanly with main context 101 */
    probeMode = 'host';
    await daemon.attachTarget(fakePage, fakeEndpoint);
    assert.equal(daemon.attachedTargets.size, 1, 'slow window attached on subsequent pass');
    const entry = daemon.attachedTargets.get(fakePage.id);
    assert.equal(entry.trustedContextId, 101);
    assert.ok(entry.rpcToken.length >= 32);

    const tmpProj = fs.mkdtempSync(path.join(os.tmpdir(), 'ac-rpc-sec-'));
    try {
      /* Subframe context (202) attempting RPC even with stolen token -> silently dropped */
      lastSocket.emitEvent('Runtime.bindingCalled', {
        name: '__agProjectRpc',
        executionContextId: 202,
        payload: JSON.stringify({ reqId: 'sub_1', action: 'readContext', payload: { dirPath: tmpProj }, token: entry.rpcToken })
      });
      await new Promise((r) => setTimeout(r, 30));
      assert.equal(rpcReplies.length, 0, 'subframe executionContextId rejected');

      /* Main context (101) without valid token -> rejected with unauthorized_context */
      lastSocket.emitEvent('Runtime.bindingCalled', {
        name: '__agProjectRpc',
        executionContextId: 101,
        payload: JSON.stringify({ reqId: 'bad_tok', action: 'readContext', payload: { dirPath: tmpProj }, token: 'wrong' })
      });
      await new Promise((r) => setTimeout(r, 30));
      assert.equal(rpcReplies.length, 1);
      assert.match(rpcReplies[0], /unauthorized_context/);

      /* Main context (101) with valid token -> succeeds */
      lastSocket.emitEvent('Runtime.bindingCalled', {
        name: '__agProjectRpc',
        executionContextId: 101,
        payload: JSON.stringify({ reqId: 'ok_1', action: 'readContext', payload: { dirPath: tmpProj }, token: entry.rpcToken })
      });
      await new Promise((r) => setTimeout(r, 30));
      assert.equal(rpcReplies.length, 2);
      assert.match(rpcReplies[1], /"ok_1"/);
      assert.match(rpcReplies[1], /"ok":true/);

      /* Top-level navigation to untrusted page immediately revokes authorization */
      const oldToken = entry.rpcToken;
      probeMode = 'non_host';
      lastSocket.emitEvent('Page.frameNavigated', {
        frame: { id: 'main-frame', url: 'https://evil.example/phish' }
      });
      assert.equal(entry.hostConfirmed, false, 'hostConfirmed revoked synchronously on top-level navigation');
      assert.equal(entry.rpcToken, '', 'rpcToken cleared synchronously on top-level navigation');

      lastSocket.emitEvent('Runtime.bindingCalled', {
        name: '__agProjectRpc',
        executionContextId: 101,
        payload: JSON.stringify({ reqId: 'after_nav', action: 'readContext', payload: { dirPath: tmpProj }, token: oldToken })
      });
      await new Promise((r) => setTimeout(r, 90));
      assert.equal(rpcReplies.length, 2, 'post-navigation RPC call blocked');
    } finally {
      fs.rmSync(tmpProj, { recursive: true, force: true });
    }
  } finally {
    for (const [, e] of daemon.attachedTargets.entries()) {
      try {
        e.ws.close();
      } catch {}
    }
    daemon.attachedTargets.clear();
    daemon.skippedNonHostTargets.clear();
    globalThis.WebSocket = realWS;
  }
});

/* -------------------------------------------------------------------------- */
/* Installer, Migration, Backup, CLI Scope, Validation & Subcommand Tests     */
/* -------------------------------------------------------------------------- */

test('[Audit #2 & R2-#2] first-time install preserves standalone theme-patch user files and archives extra custom files', () => {
  const h = makeSandboxHome();
  try {
    const legacyPatchDir = path.join(h.home, '.gemini', 'antigravity', 'theme-patch');
    const legacyUserDir = path.join(legacyPatchDir, 'user');
    fs.mkdirSync(legacyUserDir, { recursive: true });
    fs.writeFileSync(path.join(legacyUserDir, 'custom.css'), '/* standalone theme-patch custom css */\n');
    fs.writeFileSync(path.join(legacyUserDir, 'my-extra-snippet.css'), 'body { --my-var: 1; }\n');

    const inst = runInstallCli(h.home, ['install']);
    assert.equal(inst.status, 0, inst.stderr);
    assert.ok(inst.out.legacyMigration.backupDir, 'standalone theme-patch archived to backupDir');
    assert.equal(
      fs.readFileSync(path.join(inst.out.legacyMigration.backupDir, 'user', 'my-extra-snippet.css'), 'utf8'),
      'body { --my-var: 1; }\n',
      'custom extra file preserved in archive'
    );
    assert.equal(
      fs.readFileSync(path.join(inst.out.legacyMigration.backupDir, 'user', 'custom.css'), 'utf8'),
      '/* standalone theme-patch custom css */\n'
    );

    /* Uninstalling restores the user's pre-existing custom.css */
    const un = runInstallCli(h.home, ['uninstall']);
    assert.equal(un.status, 0, un.stderr);
    assert.equal(
      fs.readFileSync(path.join(h.home, '.gemini', 'antigravity', 'anti-claude', 'user', 'custom.css'), 'utf8'),
      '/* standalone theme-patch custom css */\n',
      'pre-existing standalone custom.css restored on uninstall'
    );
  } finally {
    h.cleanup();
  }
});

test('[Audit #3] migrating from v1 with user-modified CSS preserves modified CSS and writes new template to incoming/', () => {
  const h = makeSandboxHome();
  try {
    const agy = path.join(h.home, '.gemini', 'antigravity');
    const legacyUserDir = path.join(agy, 'theme-patch', 'user');
    const legacyBak = path.join(legacyUserDir, '.backup-before-claude-ux');
    fs.mkdirSync(legacyBak, { recursive: true });
    for (const f of ['custom.css', 'custom.js', 'config.json', 'i18n.override.json']) {
      fs.writeFileSync(path.join(legacyBak, f), `/* stock ${f} */\n`);
      fs.copyFileSync(path.join(REPO, 'user', f), path.join(legacyUserDir, f));
    }
    /* User customized v1 custom.css */
    fs.writeFileSync(path.join(legacyUserDir, 'custom.css'), '/* user v1 custom css modification */\n.my-rule { color: red; }\n');

    const up = runInstallCli(h.home, ['sync-upgrade']);
    assert.equal(up.status, 0, up.stderr);
    const liveCss = fs.readFileSync(path.join(agy, 'anti-claude', 'user', 'custom.css'), 'utf8');
    assert.match(liveCss, /user v1 custom css modification/, 'modified v1 CSS was NOT overwritten');
    assert.equal(
      fs.existsSync(path.join(agy, 'anti-claude', 'incoming', 'custom.css')),
      true,
      'new template saved alongside in incoming/custom.css for comparison'
    );
  } finally {
    h.cleanup();
  }
});

test('[Audit #9 & #10 & R2-#5] --cli-only does not disable existing desktop upgrades; uninstall preserves local-saves backups', () => {
  const h = makeSandboxHome();
  try {
    const cliDir = path.join(h.home, '.gemini', 'antigravity-cli');
    fs.mkdirSync(cliDir, { recursive: true });

    /* 1. Install Desktop first */
    const inst = runInstallCli(h.home, ['install']);
    assert.equal(inst.status, 0, inst.stderr);

    /* 2. Run `install --cli-only` on top of existing Desktop install */
    const cliInst = runInstallCli(h.home, ['install', '--cli-only']);
    assert.equal(cliInst.status, 0, cliInst.stderr);
    assert.equal(cliInst.out.mode, 'desktop+cli', 'existing desktop mode preserved');

    /* Remove desktop custom.css -> sync-upgrade must still restore it! */
    const cssPath = path.join(h.home, '.gemini', 'antigravity', 'anti-claude', 'user', 'custom.css');
    fs.rmSync(cssPath, { force: true });
    const sync = runInstallCli(h.home, ['sync-upgrade', '--force']);
    assert.equal(sync.status, 0, sync.stderr);
    assert.equal(fs.existsSync(cssPath), true, 'desktop CSS restored by sync-upgrade after --cli-only');

    /* Positive flags re-enable previously disabled options */
    runInstallCli(h.home, ['install', '--no-step-unlock', '--no-agents-rule']);
    const reEnabled = runInstallCli(h.home, ['install', '--step-unlock', '--agents-rule']);
    assert.equal(reEnabled.status, 0);
    const st = JSON.parse(
      fs.readFileSync(path.join(h.home, '.gemini', 'antigravity', 'anti-claude', 'install-state.json'), 'utf8')
    );
    assert.equal(st.options.stepUnlock, true);
    assert.equal(st.options.agentsRule, true);

    /* 3. Edit CSS, run `sync-upgrade --overwrite-local` (creates only copy in local-saves/), then `uninstall` */
    fs.appendFileSync(cssPath, '\n/* precious local tweak before overwrite */\n');
    const ov = runInstallCli(h.home, ['sync-upgrade', '--overwrite-local']);
    assert.equal(ov.status, 0);

    const un = runInstallCli(h.home, ['uninstall']);
    assert.equal(un.status, 0, un.stderr);
    assert.ok(un.out.files.savedLocalEdits.length >= 1, 'local-saves backup preserved and listed on uninstall');
    const preservedFile = un.out.files.savedLocalEdits.find((p) => p.endsWith('custom.css'));
    assert.ok(preservedFile && fs.existsSync(preservedFile), 'preserved backup exists outside removed state dir');
    assert.match(fs.readFileSync(preservedFile, 'utf8'), /precious local tweak before overwrite/);
  } finally {
    h.cleanup();
  }
});

test('[Audit #11 & R2-M6] validateSourceRoot rejects missing/corrupt JSON and unknown CLI subcommand exits non-zero', async () => {
  const installer = await import(pathToFileURL(INSTALL).href);
  const fakeRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ac-bad-src-'));
  try {
    fs.mkdirSync(path.join(fakeRoot, 'core'), { recursive: true });
    fs.mkdirSync(path.join(fakeRoot, 'user'), { recursive: true });
    fs.mkdirSync(path.join(fakeRoot, 'cli'), { recursive: true });
    fs.mkdirSync(path.join(fakeRoot, 'rules'), { recursive: true });
    for (const rel of ['install.mjs', 'core/daemon.mjs', 'core/runtime.js', 'user/custom.js', 'cli/statusline.mjs']) {
      fs.writeFileSync(path.join(fakeRoot, rel), 'export const ok = 1;\n');
    }
    fs.writeFileSync(path.join(fakeRoot, 'core', 'base.css'), '/* css */\n');
    fs.writeFileSync(path.join(fakeRoot, 'rules', 'claude-execution-sync.md'), '# rule\n');
    /* 1 invalid JSON + 2 missing JSON files */
    fs.writeFileSync(path.join(fakeRoot, 'core', 'i18n.json'), '{corrupt json');

    const res = installer.validateSourceRoot(fakeRoot);
    assert.equal(res.ok, false, 'validation must fail on corrupt and missing JSON');
    assert.equal(res.problems.length, 3);
  } finally {
    fs.rmSync(fakeRoot, { recursive: true, force: true });
  }

  const h = makeSandboxHome();
  try {
    const typo = runInstallCli(h.home, ['isntall']);
    assert.equal(typo.status, 1, 'unknown subcommand exits with status 1');
    assert.match(JSON.stringify(typo.out), /unknown command: isntall/);
  } finally {
    h.cleanup();
  }
});

/* -------------------------------------------------------------------------- */
/* Runtime, Early Body Injection, Hot-Disable, Projects Drafts & CLI Width    */
/* -------------------------------------------------------------------------- */

test('[Audit #6 & #15 & R2-#4] early pre-body injection mounts full UI once body attaches; hot-disable stops route metrics callbacks', { skip: skipDom }, async () => {
  const runtimeSrc = fs.readFileSync(path.join(REPO, 'core', 'runtime.js'), 'utf8');
  const customJsSrc = fs.readFileSync(path.join(REPO, 'user', 'custom.js'), 'utf8');

  const runRuntime = (win, bootOverrides = {}) => {
    const payload = {
      version: 'anti-claude-test',
      platform: 'darwin',
      enabled: true,
      config: { selectors: { inputBoxId: 'custom.composerBox' } },
      modules: { i18n: false, metrics: true, customCss: true, customJs: true },
      themeVars: {},
      darkThemeVars: {},
      cssText: '/* base */',
      customCss: '/* user */',
      customJs: customJsSrc,
      dict: {},
      ...bootOverrides
    };
    const script = runtimeSrc.replace('(__AG_BOOT_PAYLOAD__);', () => `(${JSON.stringify(payload)});`);
    return win.eval(script);
  };

  const dom = new JSDOM('<!doctype html><html><head></head></html>', {
    runScripts: 'outside-only',
    url: 'http://127.0.0.1/c/11111111-2222-3333-4444-555555555555',
    pretendToBeVisual: true
  });
  const { window } = dom;
  window.__APP_CONFIG__ = { productName: 'antigravity' };
  /* Remove default body created by HTML5 parser to simulate pre-body document_start execution */
  window.document.body.remove();
  assert.equal(window.document.body, null);

  const metricsRequests = [];
  window.__agRequestMetrics = (cid) => metricsRequests.push(cid);

  try {
    /* Inject BEFORE body exists */
    runRuntime(window);
    assert.ok(window.document.getElementById('ag-custom-fonts'), 'styles mounted in head before body exists');
    assert.equal(window.__ag_custom_js_mounted, false);

    /* Now attach body containing a live checklist + sidebar + custom composer selector */
    const body = window.document.createElement('body');
    body.innerHTML = `
      <aside class="bg-sidebar"><button data-testid="automations-button">Automations</button></aside>
      <section>
        <div data-testid="agent-response">
          <ul class="contains-task-list">
            <li class="task-list-item"><div class="bg-primary"></div>Step 1</li>
            <li class="task-list-item"><div></div>Step 2</li>
          </ul>
        </div>
        <div id="custom.composerBox">
          <div class="agy-composer-footer"><div><span>Model</span></div><div><button data-testid="send-button"></button></div></div>
        </div>
      </section>
    `;
    window.document.documentElement.appendChild(body);
    await new Promise((r) => setTimeout(r, 20));

    assert.equal(window.__ag_custom_js_mounted, true, 'custom.js mounted automatically once body appeared');
    assert.equal(window.document.querySelector('.ag-claude-todo-card'), null, 'TodoWrite card is retired and checklists remain native');
    assert.ok(window.document.getElementById('ag-claude-projects-nav-btn'), 'Projects nav entry mounted after pre-body injection');
    assert.ok(window.document.getElementById('ag-live-metrics-pill'), 'metrics pill honored boot.config.selectors.inputBoxId');
    const countBeforeDisable = metricsRequests.length;
    assert.ok(countBeforeDisable >= 1);

    /* Hot-disable runtime (`enabled: false`), then navigate to a new chat route */
    runRuntime(window, { enabled: false });
    assert.equal(window.document.getElementById('ag-live-metrics-pill'), null, 'metrics pill removed on disable');

    window.history.pushState({}, '', '/c/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee');
    await new Promise((r) => setTimeout(r, 180));

    assert.equal(metricsRequests.length, countBeforeDisable, 'no metrics requests fired after hot-disable');
    assert.equal(window.document.getElementById('ag-live-metrics-pill'), null, 'no metrics DOM node re-inserted after hot-disable');
  } finally {
    window.close();
  }
});

test('[Audit #1, #12 & #13 UI] Projects workspace preserves compose draft on folder menu open, saves instructions safely while loading, and links new folder in Scheduled modal', { skip: skipDom }, async () => {
  const customJsSrc = fs.readFileSync(path.join(REPO, 'user', 'custom.js'), 'utf8');
  const dom = new JSDOM(
    `<!doctype html><body>
      <aside class="bg-sidebar">
        <div data-testid="project-header"></div>
        <button data-testid="automations-button">Automations</button>
      </aside>
      <main><div id="antigravity.agentSidePanelInputBox"></div></main>
    </body>`,
    { runScripts: 'outside-only', url: 'http://127.0.0.1/', pretendToBeVisual: true }
  );
  const { window } = dom;
  const doc = window.document;

  /* Mock Redux store on project-header fiber */
  const fakeStore = {
    getState: () => ({
      sidebarProjects: {
        projects: [{ id: 'proj-1', name: 'Alpha Case', folderUris: ['file:///tmp/alpha-case'] }]
      },
      trajectorySummaries: { summaries: {}, indexes: { byProject: {} } }
    }),
    subscribe: () => () => {},
    dispatch: () => {}
  };
  const headerEl = doc.querySelector('[data-testid="project-header"]');
  headerEl.__reactFiber$test = {
    dependencies: { firstContext: { memoizedValue: { store: fakeStore }, next: null } },
    return: null
  };

  const rpcCalls = [];
  let resolveSlowRead = null;
  window.__agProjectCall = (action, payload) => {
    rpcCalls.push({ action, payload: JSON.parse(JSON.stringify(payload || {})) });
    if (action === 'listContexts') {
      /* Delay initial listContexts so cache is NOT populated yet when user edits instructions */
      return new Promise((r) => {
        resolveSlowRead = () =>
          r({
            ok: true,
            contexts: {
              '/tmp/alpha-case': {
                ok: true,
                dirPath: '/tmp/alpha-case',
                instructions: 'Old',
                files: [{ name: 'contract.pdf', relPath: '.anti-claude/files/contract.pdf', managedCopy: true }],
                extraFolders: [{ name: 'shared', absPath: '/tmp/shared' }],
                scheduledTasks: []
              }
            }
          });
      });
    }
    if (action === 'readContext') {
      return new Promise((r) => setTimeout(() => r({
        ok: true,
        dirPath: '/tmp/alpha-case',
        instructions: 'Old',
        files: [{ name: 'contract.pdf', relPath: '.anti-claude/files/contract.pdf', managedCopy: true }],
        extraFolders: [{ name: 'shared', absPath: '/tmp/shared' }],
        scheduledTasks: []
      }), 80));
    }
    if (action === 'pickFolder') {
      return Promise.resolve({ ok: true, canceled: false, folderPath: '/tmp/newly-linked', name: 'newly-linked' });
    }
    if (action === 'saveContext') {
      return Promise.resolve({
        ok: true,
        dirPath: payload.dirPath,
        instructions: payload.instructions ?? 'Old',
        files: [{ name: 'contract.pdf', relPath: '.anti-claude/files/contract.pdf', managedCopy: true }],
        extraFolders: payload.extraFolders || [{ name: 'shared', absPath: '/tmp/shared' }],
        scheduledTasks: []
      });
    }
    return Promise.resolve({ ok: true });
  };

  window.ctx = { modules: { i18n: false }, onCleanup: () => {} };
  window.eval(customJsSrc);

  try {
    /* Open Projects -> click Alpha Case card */
    doc.getElementById('ag-claude-projects-nav-btn').click();
    doc.querySelector('.ag-proj-card').click();

    /* #1 UI: Immediately open Instructions modal BEFORE context cache resolves, edit, and click Save */
    doc.querySelector('[data-ag-pd-edit-inst]').click();
    const instBox = doc.getElementById('ag-pm-instructions');
    instBox.value = 'New instructions while loading';
    instBox.dispatchEvent(new window.Event('input', { bubbles: true }));
    doc.querySelector('[data-ag-pm-save]').click();
    await new Promise((r) => setTimeout(r, 20));

    const instSaveCall = rpcCalls.find((c) => c.action === 'saveContext');
    assert.ok(instSaveCall, 'saveContext called');
    assert.equal(instSaveCall.payload.instructions, 'New instructions while loading');
    assert.equal(instSaveCall.payload.files, undefined, 'instructions modal never submits empty files: []');
    assert.equal(instSaveCall.payload.extraFolders, undefined, 'instructions modal never submits empty extraFolders: []');

    if (resolveSlowRead) resolveSlowRead();
    await new Promise((r) => setTimeout(r, 20));

    /* #12: Type unsent chat draft -> click folder dropdown -> draft & Send button stay intact */
    const comp = doc.getElementById('ag-pd-composer-input');
    comp.value = 'Draft message that must not disappear';
    comp.dispatchEvent(new window.Event('input', { bubbles: true }));
    assert.equal(doc.querySelector('[data-ag-pd-send]').disabled, false);

    doc.querySelector('[data-ag-pd-folder-toggle]').click();
    const compAfterMenu = doc.getElementById('ag-pd-composer-input');
    assert.equal(compAfterMenu.value, 'Draft message that must not disappear', 'unsent compose draft preserved when opening folder menu');
    assert.equal(doc.querySelector('[data-ag-pd-send]').disabled, false);

    /* #13: Open Scheduled Task modal -> select `+ Add folder…` -> links new folder without TypeError */
    doc.querySelector('[data-ag-pd-add-sched]').click();
    const folderSel = doc.getElementById('ag-sched-folder');
    folderSel.value = '__add_folder__';
    folderSel.dispatchEvent(new window.Event('change', { bubbles: true }));
    await new Promise((r) => setTimeout(r, 120));

    const updatedFolderSel = doc.getElementById('ag-sched-folder');
    assert.equal(updatedFolderSel.value, '/tmp/newly-linked', 'newly picked folder added and selected in scheduled modal');
    assert.equal(doc.querySelector('.ag-pm-error'), null, 'no mutator error displayed');
  } finally {
    window.close();
  }
});

test('[Audit #16] CLI statusline measures CJK East Asian display column width accurately', async () => {
  const { formatStatusLine, stringDisplayWidth } = await import(pathToFileURL(path.join(REPO, 'cli', 'statusline.mjs')).href);

  assert.equal(stringDisplayWidth('测试模型 · 项目功能开发测试分支'), 31);

  const out28 = formatStatusLine(
    {
      model: { display_name: '测试模型' },
      vcs: { branch: '项目功能开发测试分支', dirty: false },
      terminal_width: 28
    },
    { noColor: true }
  );
  assert.ok(
    stringDisplayWidth(out28) <= 26,
    `expected display width <= 26 on 28-col terminal, got ${stringDisplayWidth(out28)} ("${out28}")`
  );
  assert.equal(out28, '测试模型');

  const ultraLong = formatStatusLine(
    {
      model: { display_name: '超长中文测试模型名称超过二十八列终端宽度上限' },
      terminal_width: 28
    },
    { noColor: false }
  );
  assert.ok(stringDisplayWidth(ultraLong) <= 26, `truncated CJK model width <= 26, got ${stringDisplayWidth(ultraLong)}`);
});

test('[v2.33 New Project] clicking New project bypasses sidebar multi-item popover, keeps Projects view open on Escape, enters created project, and falls back to Redux when sidebar button is virtualized out', { skip: skipDom }, async () => {
  const customJsSrc = fs.readFileSync(path.join(REPO, 'user', 'custom.js'), 'utf8');
  const dom = new JSDOM(
    `<!doctype html><body>
      <aside class="bg-sidebar">
        <div data-testid="project-header"></div>
        <button data-testid="automations-button">Automations</button>
        <button data-testid="sidebar-add-project-button" data-base-ui-click-trigger="" aria-haspopup="dialog"></button>
      </aside>
      <main><div id="antigravity.agentSidePanelInputBox"></div></main>
    </body>`,
    { runScripts: 'outside-only', url: 'http://127.0.0.1/', pretendToBeVisual: true }
  );
  const { window } = dom;
  const doc = window.document;

  const listeners = new Set();
  const dispatched = [];
  const state = {
    newProject: { currentStep: 'folderSelection', selectedFolders: [], isOpen: false },
    sidebarProjects: {
      projects: [{ id: 'proj-existing', name: 'Existing Project', folderUris: ['file:///tmp/existing'] }]
    },
    trajectorySummaries: { summaries: {}, indexes: { byProject: {} } }
  };
  const notify = () => {
    for (const fn of [...listeners]) fn();
  };
  const fakeStore = {
    getState: () => state,
    subscribe: (fn) => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    dispatch: (act) => {
      dispatched.push(act);
      if (act?.type === 'newProject/setIsOpen') {
        state.newProject.isOpen = Boolean(act.payload);
        notify();
      }
    }
  };

  const headerEl = doc.querySelector('[data-testid="project-header"]');
  headerEl.__reactFiber$test = {
    dependencies: { firstContext: { memoizedValue: { store: fakeStore }, next: null } },
    return: null
  };

  let sidebarPopoverClicked = 0;
  let newProjEntryCalled = 0;
  let sshEntryCalled = 0;
  const addBtn = doc.querySelector('[data-testid="sidebar-add-project-button"]');
  addBtn.addEventListener('click', () => {
    sidebarPopoverClicked += 1;
  });
  addBtn.__reactFiber$test = {
    memoizedState: null,
    return: {
      memoizedState: {
        memoizedState: [
          [
            {
              type: 'NEW_PROJECT',
              label: 'New Project',
              disabled: false,
              onClick: () => {
                newProjEntryCalled += 1;
                state.newProject.isOpen = true;
                const dlg = doc.createElement('div');
                dlg.className = 'agy-dialog';
                dlg.setAttribute('role', 'dialog');
                doc.body.appendChild(dlg);
                notify();
              }
            },
            {
              type: 'SSH_HOST',
              label: 'SSH Host…',
              disabled: false,
              onClick: () => {
                sshEntryCalled += 1;
              }
            }
          ]
        ],
        next: null
      },
      return: null
    }
  };

  window.__agProjectCall = async () => ({
    ok: true,
    contexts: {},
    instructions: '',
    files: [],
    extraFolders: [],
    scheduledTasks: []
  });
  window.ctx = { modules: { i18n: false }, onCleanup: () => {} };
  window.eval(customJsSrc);

  try {
    doc.getElementById('ag-claude-projects-nav-btn').click();
    const view = doc.getElementById('ag-claude-projects-view');
    assert.equal(view.getAttribute('data-open'), 'true');

    /* 1. Clicking New project invokes NEW_PROJECT entry directly without clicking the sidebar popover trigger or closing Projects view */
    view.querySelector('[data-ag-proj-new]').click();
    assert.equal(newProjEntryCalled, 1, 'invoked NEW_PROJECT entry handler directly');
    assert.equal(sshEntryCalled, 0, 'did not invoke SSH_HOST');
    assert.equal(sidebarPopoverClicked, 0, 'did not trigger sidebar Base UI dropdown menu');
    assert.equal(view.getAttribute('data-open'), 'true', 'Projects view remains open behind the native modal');

    /* 2. Pressing Escape while native .agy-dialog is open does NOT close Projects view */
    const escWhileModal = new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
    doc.dispatchEvent(escWhileModal);
    assert.equal(view.getAttribute('data-open'), 'true', 'Escape does not dismiss Projects view while native dialog is open');

    /* 3. Completing project creation automatically enters the newly created project detail view */
    doc.querySelector('.agy-dialog').remove();
    state.newProject.isOpen = false;
    state.sidebarProjects.projects.push({
      id: 'proj-brand-new',
      name: 'Brand New Case',
      folderUris: ['file:///tmp/brand-new-case']
    });
    notify();

    assert.equal(view.getAttribute('data-open'), 'true');
    assert.equal(
      view.querySelector('.ag-pd-crumb-cur')?.textContent?.trim(),
      'Brand New Case',
      'automatically navigated into the newly created project detail workspace'
    );

    /* 4. Return to Projects grid, remove sidebar-add-project-button (virtual scroll unmounted), and verify Redux fallback */
    view.querySelector('[data-ag-pd-back]').click();
    addBtn.remove();
    dispatched.length = 0;
    view.querySelector('[data-ag-proj-new]').click();
    assert.deepEqual(
      dispatched.map((a) => a.type),
      ['newProject/reset', 'newProject/setStep', 'newProject/setIsOpen'],
      'dispatches native newProject Redux actions when sidebar button is virtualized out of DOM'
    );
    assert.equal(state.newProject.isOpen, true);
  } finally {
    window.close();
  }
});

test('[Projects Context Menu & Topbar] right-click / more menu renames & deletes projects (including folderless Skip projects), and collapsed sidebar applies safe topbar inset', { skip: skipDom }, async () => {
  const customJsSrc = fs.readFileSync(path.join(REPO, 'user', 'custom.js'), 'utf8');
  const dom = new JSDOM(
    `<!doctype html><body>
      <div id="root">
        <div class="app-shell">
          <aside class="bg-sidebar">
            <div data-testid="project-header"></div>
            <button data-testid="automations-button">Automations</button>
          </aside>
          <main><div id="antigravity.agentSidePanelInputBox"></div></main>
        </div>
      </div>
    </body>`,
    { runScripts: 'outside-only', url: 'http://127.0.0.1/?project=proj-folderless', pretendToBeVisual: true }
  );
  const { window } = dom;
  const doc = window.document;

  const state = {
    sidebarProjects: {
      projects: [
        { id: 'proj-uikit', name: '前端组件库', folderUris: ['file:///tmp/ui-kit'] },
        { id: 'proj-folderless', name: '1', folderUris: [] },
        { id: 'default-cli-project', name: 'CLI Project', folderUris: [] }
      ]
    },
    trajectorySummaries: { summaries: {}, indexes: { byProject: {} } }
  };

  const deletedIds = [];
  const updatedProjects = [];
  const rawRecords = new Map([
    ['proj-uikit', { $typeName: 'exa.project_pb.Project', id: 'proj-uikit', name: '前端组件库' }],
    ['proj-folderless', { $typeName: 'exa.project_pb.Project', id: 'proj-folderless', name: '1' }]
  ]);
  const mockPmSvc = {
    getProjectStateProvider: (id) => ({
      getState: () => ({ project: rawRecords.get(id) || null })
    }),
    updateProject: async (proj) => {
      updatedProjects.push(proj);
      rawRecords.set(proj.id, proj);
      const hit = state.sidebarProjects.projects.find((p) => p.id === proj.id);
      if (hit) Object.assign(hit, { name: proj.name, archived: Boolean(proj.archived) });
    },
    deleteProject: async (id) => {
      deletedIds.push(id);
      rawRecords.delete(id);
      state.sidebarProjects.projects = state.sidebarProjects.projects.filter((p) => p.id !== id);
    }
  };

  const navigated = [];
  const mockRouter = {
    state: { location: { pathname: '/', search: { project: 'proj-folderless' } } },
    navigate: (opts) => {
      navigated.push(opts);
      if (opts && typeof opts.search === 'function') {
        mockRouter.state.location.search = opts.search(mockRouter.state.location.search);
      }
    }
  };
  const fakeStore = {
    getState: () => state,
    subscribe: () => () => {},
    dispatch: () => {}
  };

  const sidebarEl = doc.querySelector('.bg-sidebar');
  sidebarEl.__reactFiber$test = {
    memoizedProps: { sidebarStore: fakeStore, sidebarRouter: mockRouter },
    dependencies: {
      firstContext: {
        memoizedValue: { store: fakeStore },
        next: {
          memoizedValue: { core: { projectManagementService: mockPmSvc } },
          next: null
        }
      }
    },
    return: null
  };
  doc.querySelector('[data-testid="project-header"]').__reactFiber$test = sidebarEl.__reactFiber$test;

  window.__agProjectCall = async () => ({
    ok: true,
    contexts: {},
    instructions: '',
    files: [],
    extraFolders: [],
    scheduledTasks: []
  });
  window.ctx = { modules: { i18n: true }, onCleanup: () => {} };
  window.eval(customJsSrc);

  try {
    doc.getElementById('ag-claude-projects-nav-btn').click();
    const view = doc.getElementById('ag-claude-projects-view');
    /* JSDOM sidebar has 0x0 rect -> simulates collapsed sidebar (leftPx = 0) */
    assert.equal(view.getAttribute('data-sidebar-collapsed'), 'true');
    assert.equal(view.style.getPropertyValue('--ag-proj-topbar-pl'), '224px');

    /* Folderless user project "1" is shown alongside folder project & CLI Project, while CLI Project has no destructive menu */
    const cards = [...view.querySelectorAll('.ag-proj-card')];
    assert.equal(cards.length, 3);
    const cliCard = cards.find((c) => c.getAttribute('data-ag-proj-id') === 'default-cli-project');
    assert.equal(cliCard.querySelector('[data-ag-proj-menu]'), null, 'builtin CLI Project hides destructive menu');

    /* Right-click on "前端组件库" card opens #ag-project-action-menu -> Rename updates title immediately */
    const uikitCard = cards.find((c) => c.getAttribute('data-ag-proj-id') === 'proj-uikit');
    uikitCard.dispatchEvent(new window.MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 320, clientY: 220 }));
    const menu = doc.getElementById('ag-project-action-menu');
    assert.ok(menu, 'right-click opened #ag-project-action-menu');
    menu.querySelector('[data-ag-pm-act="rename"]').click();
    assert.equal(doc.getElementById('ag-project-action-menu'), null, 'context menu closed on rename');

    const renameInput = doc.getElementById('ag-pm-rename-input');
    assert.ok(renameInput, 'rename modal opened');
    renameInput.value = '前端组件库（v2）';
    renameInput.dispatchEvent(new window.Event('input', { bubbles: true }));
    doc.querySelector('[data-ag-pm-rename-save]').click();
    await new Promise((r) => setTimeout(r, 20));

    assert.equal(updatedProjects.length, 1);
    assert.equal(updatedProjects[0].name, '前端组件库（v2）');
    assert.match(view.querySelector('[data-ag-proj-id="proj-uikit"]').textContent, /前端组件库（v2）/);

    /* Enter folderless project "1" -> verify breadcrumb back works -> re-enter and delete via Detail ⋯ menu (2-step confirm) */
    view.querySelector('[data-ag-proj-id="proj-folderless"]').click();
    assert.equal(view.querySelector('.ag-pd-crumb-cur')?.textContent?.trim(), '1');
    view.querySelector('[data-ag-pd-back]').click();
    assert.ok(view.querySelector('.ag-proj-grid'), 'clicking breadcrumb root returns to Projects grid');

    view.querySelector('[data-ag-proj-id="proj-folderless"]').click();
    view.querySelector('[data-ag-pd-proj-menu]').click();
    const detailMenu = doc.getElementById('ag-project-action-menu');
    assert.ok(detailMenu, 'detail header ⋯ button opened #ag-project-action-menu');
    detailMenu.querySelector('[data-ag-pm-act="delete"]').click();
    assert.equal(
      detailMenu.querySelector('[data-ag-pm-act="delete"]').getAttribute('data-confirm'),
      '1',
      'first click arms confirmation'
    );
    assert.equal(deletedIds.length, 0, 'does not delete on first click');

    detailMenu.querySelector('[data-ag-pm-act="delete"]').click();
    await new Promise((r) => setTimeout(r, 20));
    assert.deepEqual(deletedIds, ['proj-folderless'], 'second click invokes projectManagementService.deleteProject');
    assert.ok(view.querySelector('.ag-proj-grid'), 'deleting active project returns cleanly to Projects grid');
    assert.equal(view.querySelector('[data-ag-proj-id="proj-folderless"]'), null, 'deleted project card removed immediately');
    assert.equal(mockRouter.state.location.search.project, undefined, 'active URL search.project cleared when deleted');
  } finally {
    window.close();
  }
});

test('[Project @ Mentions] typing @ in Project Detail opens Browse & Plugins menu, drills into Conversations/Files, renders removable pills, and submits structured TextOrScopeItem chunks', { skip: skipDom }, async () => {
  const customJsSrc = fs.readFileSync(path.join(REPO, 'user', 'custom.js'), 'utf8');
  const dom = new JSDOM(
    `<!doctype html><body>
      <div id="root">
        <div class="app-shell">
          <aside class="bg-sidebar">
            <div data-testid="project-header"></div>
            <button data-testid="automations-button">Automations</button>
          </aside>
          <main><div id="antigravity.agentSidePanelInputBox"></div></main>
        </div>
      </div>
    </body>`,
    { runScripts: 'outside-only', url: 'http://127.0.0.1/', pretendToBeVisual: true }
  );
  const { window } = dom;
  const doc = window.document;

  const state = {
    sidebarProjects: {
      projects: [{ id: 'proj-agy', name: '技术（Antigravity）', folderUris: ['file:///tmp/agy-tech'] }]
    },
    trajectorySummaries: {
      summaries: {
        'conv-outside-1': {
          projectId: 'outside-of-project',
          summary: '讨论反重力 UI 改造方案',
          lastModifiedTime: { seconds: 1795152000 },
          annotations: { title: '反重力界面改造' }
        }
      },
      indexes: { byProject: {} }
    }
  };

  const mockRpcSvc = {
    getAllPlugins: async () => ({
      plugins: [
        {
          name: 'gdocs-plugin',
          displayName: 'Google Docs（协作版）',
          description: '云端文档同步插件',
          path: 'file:///Users/demo/.gemini/config/plugins/gdocs-plugin',
          logo: '',
          skills: ['doc-sync']
        }
      ]
    }),
    getAllRules: async () => [
      {
        memoryId: 'user_global',
        memory: { case: 'textMemory', value: { content: 'Always sync progress.' } }
      }
    ],
    searchFiles: async ({ query, workspaceUri }) => ({
      results: [
        {
          $typeName: 'exa.codeium_common_pb.PathScopeItem',
          absoluteUri: `${workspaceUri}/notes.md`,
          workspaceUrisToRelativePaths: { [workspaceUri]: 'notes.md' },
          numFiles: 0
        }
      ].filter((r) => !query || r.absoluteUri.includes(query))
    })
  };

  const mockRouter = {
    state: { location: { pathname: '/', search: { project: 'proj-agy' } } },
    navigate: (opts) => {
      if (opts && opts.to) {
        mockRouter.state.location = { pathname: opts.to, search: opts.search || {} };
      }
    }
  };
  const fakeStore = { getState: () => state, subscribe: () => () => {}, dispatch: () => {} };

  const sidebarEl = doc.querySelector('.bg-sidebar');
  sidebarEl.__reactFiber$test = {
    memoizedProps: { sidebarStore: fakeStore, sidebarRouter: mockRouter },
    dependencies: {
      firstContext: {
        memoizedValue: { store: fakeStore },
        next: { memoizedValue: mockRpcSvc, next: null }
      }
    },
    return: null
  };
  doc.querySelector('[data-testid="project-header"]').__reactFiber$test = sidebarEl.__reactFiber$test;

  const submittedCalls = [];
  const inputBoxEl = doc.getElementById('antigravity.agentSidePanelInputBox');
  inputBoxEl.__reactFiber$test = {
    memoizedProps: {
      handleSubmit: (chunks, media, flag) => {
        submittedCalls.push({ chunks, media, flag });
      }
    },
    return: null
  };

  window.__agProjectCall = async () => ({
    ok: true,
    contexts: {},
    instructions: '',
    files: [],
    extraFolders: [],
    scheduledTasks: []
  });
  window.ctx = { modules: { i18n: true }, onCleanup: () => {} };
  window.eval(customJsSrc);

  try {
    doc.getElementById('ag-claude-projects-nav-btn').click();
    const view = doc.getElementById('ag-claude-projects-view');
    view.querySelector('[data-ag-proj-id="proj-agy"]').click();
    await new Promise((r) => setTimeout(r, 10));

    const comp = doc.getElementById('ag-pd-composer-input');
    const pop = doc.getElementById('ag-pd-mention-popover');

    /* 1. Typing `@` opens root menu with Browse categories + Plugins */
    comp.value = '@';
    comp.setSelectionRange(1, 1);
    comp.dispatchEvent(new window.Event('input', { bubbles: true }));
    await new Promise((r) => setTimeout(r, 30));

    assert.equal(pop.getAttribute('data-open'), 'true', 'typing @ opens mention popover');
    assert.match(pop.textContent, /项目文件/, 'shows Project files browse category');
    assert.match(pop.textContent, /项目规则/, 'shows Rules browse category');
    assert.match(pop.textContent, /历史对话/, 'shows Conversations browse category');
    assert.match(pop.textContent, /Google Docs（协作版）/, 'shows installed plugins inline');

    /* 2. Select Conversations category -> drills into @conversation: -> pick Outside of Project chat "反重力界面改造" */
    const convCatIdx = [...pop.querySelectorAll('.ag-pd-mention-row')].findIndex((r) => /历史对话/.test(r.textContent));
    assert.ok(convCatIdx >= 0);
    pop.querySelector(`[data-ag-pd-m-idx="${convCatIdx}"]`).dispatchEvent(new window.MouseEvent('mousedown', { bubbles: true }));
    assert.equal(comp.value, '@conversation:', 'selecting category inserts @conversation: prefix');
    assert.match(pop.textContent, /反重力界面改造/, 'lists Outside of Project conversation');

    /* Press Enter to select highlighted conversation */
    comp.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    assert.equal(comp.value, '@[反重力界面改造] ', 'inserts bracketed mention token');
    assert.equal(pop.getAttribute('data-open'), 'false', 'popover closes after leaf selection');
    assert.equal(doc.querySelectorAll('.ag-pd-mention-pill').length, 1, 'renders removable mention pill above input');

    /* 3. Add text + a project file mention `@files:notes` */
    comp.value = '结合 @[反重力界面改造] 更新 @files:notes';
    comp.setSelectionRange(comp.value.length, comp.value.length);
    comp.dispatchEvent(new window.Event('input', { bubbles: true }));
    await new Promise((r) => setTimeout(r, 30));
    assert.equal(pop.getAttribute('data-open'), 'true');
    assert.match(pop.textContent, /notes\.md/, 'searches project files via searchFiles');
    comp.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true }));

    assert.equal(comp.value, '结合 @[反重力界面改造] 更新 @[notes.md] ');
    assert.equal(doc.querySelectorAll('.ag-pd-mention-pill').length, 2, 'renders 2 mention pills');

    /* 4. Submit -> verifies structured TextOrScopeItem[] chunks passed to native handleSubmit */
    doc.querySelector('[data-ag-pd-send]').click();
    await new Promise((r) => setTimeout(r, 320));

    assert.equal(submittedCalls.length, 1, 'native handleSubmit invoked');
    const chunks = submittedCalls[0].chunks;
    assert.deepEqual(
      Array.from(chunks, (c) => c.chunk.case),
      ['text', 'item', 'text', 'item'],
      'interleaves text chunks and ContextScopeItem chunks accurately'
    );
    assert.equal(chunks[1].chunk.value.scopeItem.case, 'conversation');
    assert.equal(chunks[1].chunk.value.scopeItem.value.id, 'conv-outside-1');
    assert.equal(chunks[3].chunk.value.scopeItem.case, 'file');
    assert.equal(chunks[3].chunk.value.scopeItem.value.absoluteUri, 'file:///tmp/agy-tech/notes.md');
  } finally {
    window.close();
  }
});

test('[Pinned History & Image Paste] Pinned conversations (excluded from indexes.sidebar) appear in @ Conversations & Project chats, and Project composer supports pasting images', { skip: skipDom }, async () => {
  const customJsSrc = fs.readFileSync(path.join(REPO, 'user', 'custom.js'), 'utf8');
  const dom = new JSDOM(
    `<!doctype html><html><body>
      <div id="root">
        <div class="bg-sidebar">
          <button data-testid="automations-button">Automations</button>
          <div data-sidebar-section-drop-id="proj-agy">
            <button data-testid="project-header" data-project-label="技术（Antigravity）">技术（Antigravity）</button>
          </div>
        </div>
        <div id="antigravity.agentSidePanelInputBox"></div>
      </div>
    </body></html>`,
    { url: 'http://localhost:3310/', pretendToBeVisual: true, runScripts: 'outside-only' }
  );
  const { window } = dom;
  const doc = window.document;

  /* Mirror real Antigravity Redux: `indexes.sidebar` ONLY contains unpinned conversations,
   * while pinned conversations live in `indexes.pinned` (`inSidebarIdx === false`). */
  const state = {
    sidebarProjects: {
      projects: [
        {
          id: 'proj-agy',
          name: '技术（Antigravity）',
          folderUris: ['file:///tmp/agy-tech']
        },
        {
          id: 'proj-empty',
          name: '移动端网关',
          folderUris: ['file:///Users/demo/Desktop/移动端网关']
        },
        {
          id: 'default-cli-project',
          name: 'CLI Project',
          folderUris: []
        }
      ]
    },
    trajectorySummaries: {
      summaries: {
        'conv-unpinned-outside': {
          projectId: 'outside-of-project',
          summary: '普通未置顶会话',
          lastModifiedTime: { seconds: 1795152000 },
          annotations: { title: '反重力界面改造' }
        },
        'conv-pinned-outside': {
          projectId: 'outside-of-project',
          summary: 'LLM 读书笔记',
          lastModifiedTime: { seconds: 1790000000 },
          annotations: { title: '大模型学习', pinned: true }
        },
        'conv-pinned-proj': {
          projectId: 'proj-agy',
          summary: '项目内置顶记录',
          lastModifiedTime: { seconds: 1791000000 },
          annotations: { title: '置顶架构纪要' }
        }
      },
      indexes: {
        byProject: { 'proj-agy': ['conv-pinned-proj'] },
        sidebar: { 'conv-unpinned-outside': true },
        pinned: { 'conv-pinned-outside': true, 'conv-pinned-proj': true }
      }
    }
  };

  const mockRouter = {
    state: { location: { pathname: '/', search: { project: 'proj-agy' } } },
    navigate: (opts) => {
      if (opts && opts.to) {
        mockRouter.state.location = { pathname: opts.to, search: opts.search || {} };
      }
    }
  };
  const fakeStore = { getState: () => state, subscribe: () => () => {}, dispatch: () => {} };

  const sidebarEl = doc.querySelector('.bg-sidebar');
  sidebarEl.__reactFiber$test = {
    memoizedProps: { sidebarStore: fakeStore, sidebarRouter: mockRouter },
    dependencies: { firstContext: { memoizedValue: { store: fakeStore }, next: null } },
    return: null
  };
  doc.querySelector('[data-testid="project-header"]').__reactFiber$test = sidebarEl.__reactFiber$test;

  let currentAttachments = [];
  const attachedFileCalls = [];
  const submittedCalls = [];
  const mockInputBoxRef = {
    current: {
      attachFiles: async (files) => {
        attachedFileCalls.push(files);
        currentAttachments = Array.from(files).map((f, idx) => ({
          $typeName: 'exa.codeium_common_pb.Media',
          mimeType: f.type || 'image/png',
          description: f.name || `img-${idx}.png`,
          uri: `file:///tmp/tempmediaStorage/pasted_${idx}.png`
        }));
      },
      getMediaAttachments: () => currentAttachments,
      setMediaAttachments: (next) => {
        currentAttachments = typeof next === 'function' ? next(currentAttachments) : next;
      },
      forgetTrackedUploads: () => {}
    }
  };

  /* Mirror real Antigravity fiber hierarchy: handleSubmit on inner fiber, inputBoxRef higher up */
  const inputBoxEl = doc.getElementById('antigravity.agentSidePanelInputBox');
  inputBoxEl.__reactFiber$test = {
    memoizedProps: {
      handleSubmit: async (chunks, media, clearEditor) => {
        submittedCalls.push({ chunks, media });
        if (typeof clearEditor === 'function') clearEditor();
      }
    },
    return: {
      memoizedProps: { inputBoxRef: mockInputBoxRef },
      return: null
    }
  };

  window.__agProjectCall = async (action) => ({
    ok: true,
    contexts: {},
    projectMtimes:
      action === 'listContexts'
        ? {
            'proj-empty': Date.now() - 2 * 3600 * 1000,
            'default-cli-project': Date.now() - 5 * 86400 * 1000
          }
        : {},
    instructions: '',
    files: [],
    extraFolders: [],
    scheduledTasks: []
  });
  window.ctx = { modules: { i18n: true }, onCleanup: () => {} };
  window.eval(customJsSrc);

  try {
    doc.getElementById('ag-claude-projects-nav-btn').click();
    await new Promise((r) => setTimeout(r, 20));
    const view = doc.getElementById('ag-claude-projects-view');

    /* Verify ALL project cards uniformly show `<时间> · <N 个对话>` (even 0-chat local & CLI projects, never raw folder path) */
    const emptyCardMeta = view.querySelector('[data-ag-proj-id="proj-empty"] .ag-proj-card-meta').textContent.trim();
    const cliCardMeta = view.querySelector('[data-ag-proj-id="default-cli-project"] .ag-proj-card-meta').textContent.trim();
    assert.equal(emptyCardMeta, '2 小时前 · 0 个对话', '0-chat folder project shows unified time + 0 chats instead of path');
    assert.equal(cliCardMeta, '5 天前 · 0 个对话', 'CLI project shows unified time + 0 chats instead of blank');

    view.querySelector('[data-ag-proj-id="proj-agy"]').click();
    await new Promise((r) => setTimeout(r, 15));

    /* 1. Project Detail conversation list includes pinned project conversation despite not being in indexes.sidebar */
    const projChatListText = view.querySelector('.ag-pd-chat-list').textContent;
    assert.match(projChatListText, /置顶架构纪要/, 'pinned project conversation appears in project chat list');

    /* 2. `@conversation:` includes pinned outside-of-project conversation "大模型学习" AND pinned project chat */
    const comp = doc.getElementById('ag-pd-composer-input');
    const pop = doc.getElementById('ag-pd-mention-popover');
    const sendBtn = doc.querySelector('[data-ag-pd-send]');
    comp.value = '@conversation:';
    comp.setSelectionRange(comp.value.length, comp.value.length);
    comp.dispatchEvent(new window.Event('input', { bubbles: true }));
    await new Promise((r) => setTimeout(r, 15));

    assert.equal(pop.getAttribute('data-open'), 'true');
    assert.match(pop.textContent, /大模型学习/, 'pinned outside-of-project chat is listed in Conversations');
    assert.match(pop.textContent, /置顶/, 'pinned conversation displays Pinned badge in subtitle');

    /* Clear input so text is empty -> verify image-only paste enables Send and renders thumbnail */
    comp.value = '';
    comp.dispatchEvent(new window.Event('input', { bubbles: true }));
    assert.equal(sendBtn.disabled, true, 'send disabled when both text and media are empty');

    const pngBytes = Uint8Array.from(
      Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
        'base64'
      )
    );
    const imgFile = new window.File([pngBytes], 'image.png', { type: 'image/png' });
    const pasteEv = new window.Event('paste', { bubbles: true, cancelable: true });
    Object.defineProperty(pasteEv, 'clipboardData', {
      value: {
        items: [{ kind: 'file', type: 'image/png', getAsFile: () => imgFile }],
        files: [imgFile]
      }
    });
    comp.dispatchEvent(pasteEv);
    await new Promise((r) => setTimeout(r, 30));

    assert.equal(pasteEv.defaultPrevented, true, 'paste event default prevented for image');
    const strip = doc.getElementById('ag-pd-media-strip');
    assert.equal(strip.querySelectorAll('.ag-pd-media-card').length, 1, 'renders pasted image thumbnail card');
    assert.equal(sendBtn.disabled, false, 'pasting image enables send button even with empty text');

    /* Test removing image via × button disables send again, then paste + text and submit */
    strip.querySelector('[data-ag-pd-media-rm]').click();
    assert.equal(strip.querySelectorAll('.ag-pd-media-card').length, 0, 'clicking remove deletes thumbnail');
    assert.equal(sendBtn.disabled, true, 'removing last image with empty text disables send button');

    const pasteEv2 = new window.Event('paste', { bubbles: true, cancelable: true });
    Object.defineProperty(pasteEv2, 'clipboardData', {
      value: {
        items: [{ kind: 'file', type: 'image/png', getAsFile: () => imgFile }],
        files: [imgFile]
      }
    });
    comp.dispatchEvent(pasteEv2);
    await new Promise((r) => setTimeout(r, 30));
    comp.value = '看看这张报错截图';
    comp.dispatchEvent(new window.Event('input', { bubbles: true }));

    sendBtn.click();
    await new Promise((r) => setTimeout(r, 360));

    assert.equal(attachedFileCalls.length, 1, 'delegates pasted File to native inputBoxRef.attachFiles');
    assert.equal(submittedCalls.length, 1, 'invokes native handleSubmit');
    assert.equal(submittedCalls[0].chunks[0].chunk.value, '看看这张报错截图');
    assert.equal(submittedCalls[0].media.length, 1, 'passes resolved Media attachment to handleSubmit');
    assert.equal(submittedCalls[0].media[0].uri, 'file:///tmp/tempmediaStorage/pasted_0.png');
    assert.equal(currentAttachments.length, 0, 'cleans up composer media state after submit');
  } finally {
    window.close();
  }
});

test('[Pinned Sidebar Single-Line] hides redundant project folder subtitle line in Pinned Conversations, exposes project on hover tooltip, and compacts --ag-sb-pinned-height on virtual translateY reflow', { skip: skipDom }, async () => {
  const customCssSrc = fs.readFileSync(path.join(REPO, 'user', 'custom.css'), 'utf8');
  assert.match(
    customCssSrc,
    /\[data-testid="conversation-row-sidebar"\]\[data-pinned="true"\][\s\S]*?svg\[data-project-glyph\][\s\S]*?display:\s*none\s*!important/,
    'custom.css hides redundant project folder subtitle line inside Pinned Conversations'
  );

  const customJsSrc = fs.readFileSync(path.join(REPO, 'user', 'custom.js'), 'utf8');
  const dom = new JSDOM(
    `<!doctype html><html><body>
      <div class="bg-sidebar">
        <div data-testid="conversation-list-sidebar">
          <div class="w-full relative" style="height: 220px;">
            <div data-index="0" style="position: sticky; top: 0px;"><div data-testid="section-header">置顶对话</div></div>
            <div data-index="1" style="position: absolute; transform: translateY(24px);">
              <div data-testid="conversation-row-sidebar" data-pinned="true" data-subtext="技术（Antigravity）">
                <a href="/c/c-pin-1" aria-label="Fix Bugs in Chat History"></a>
                <div class="flex-col">
                  <span>Fix Bugs in Chat History</span>
                  <span><svg data-project-glyph="folder"></svg>技术（Antigravity）</span>
                </div>
              </div>
            </div>
            <div data-index="2" style="position: absolute; transform: translateY(159px);">
              <div data-testid="section-header"><span>项目</span><button data-testid="sidebar-add-project-button"></button></div>
            </div>
          </div>
        </div>
      </div>
    </body></html>`,
    { url: 'http://127.0.0.1/', pretendToBeVisual: true, runScripts: 'outside-only' }
  );
  const { window } = dom;
  const doc = window.document;
  window.ctx = { modules: { i18n: true, claudeUxHideSidebarProjects: true }, onCleanup: () => {} };
  window.eval(customJsSrc);

  try {
    const sb = doc.querySelector('[data-testid="conversation-list-sidebar"]');
    const link = doc.querySelector('[data-testid="conversation-row-sidebar"] a[href]');
    assert.equal(
      link.getAttribute('title'),
      'Fix Bugs in Chat History\n所属项目：技术（Antigravity）',
      'preserves owning project name in hover tooltip'
    );
    assert.equal(sb.style.getPropertyValue('--ag-sb-pinned-height'), '159px');

    /* Simulate TanStack Virtual ResizeObserver compacting translateY from 159px -> 139px after 2nd line hides */
    doc.querySelector('[data-index="2"]').setAttribute('style', 'position: absolute; transform: translateY(139px);');
    await new Promise((r) => setTimeout(r, 20));
    assert.equal(
      sb.style.getPropertyValue('--ag-sb-pinned-height'),
      '139px',
      'automatically shrinks --ag-sb-pinned-height when virtualizer compacts pinned row height'
    );
  } finally {
    window.close();
  }
});

test('[Language Persistence Across Ephemeral Port Restarts] persists Chinese/English UI mode & CJK scale to daemon ui-prefs.json across random 127.0.0.1:<port> restarts and discards stale reused-port localStorage', { skip: skipDom }, async () => {
  const daemon = await import(pathToFileURL(path.join(REPO, 'core', 'daemon.mjs')).href);
  const customJsSrc = fs.readFileSync(path.join(REPO, 'user', 'custom.js'), 'utf8');
  const uiPrefsPath = path.join(HERMETIC_DAEMON_STATE, 'ui-prefs.json');
  const userDir = path.join(HERMETIC_DAEMON_STATE, 'user');
  fs.mkdirSync(userDir, { recursive: true });
  fs.copyFileSync(path.join(REPO, 'user', 'config.json'), path.join(userDir, 'config.json'));
  fs.rmSync(uiPrefsPath, { force: true });

  const openSimulatedWindow = (port, preseedLocalStorage = null) => {
    daemon.rebuildBundleIfNeeded();
    const boot = daemon.getCachedBootPayload();
    const dom = new JSDOM(
      `<!doctype html><html><body>
        <div data-split-root="true">
          <div>
            <div data-testid="settings-sidebar">
              <div class="flex flex-col gap-0.5">
                <div class="group/nav-item"><button type="button" data-testid="settings-nav-item-General" class="bg-sidebar-secondary"><span>General</span></button></div>
                <div class="group/nav-item"><button type="button" data-testid="settings-nav-item-Appearance"><span>Appearance</span></button></div>
              </div>
            </div>
          </div>
          <div>
            <div id="settings-right-host"><div>Native Content</div></div>
          </div>
        </div>
      </body></html>`,
      { url: `https://127.0.0.1:${port}/`, pretendToBeVisual: true, runScripts: 'outside-only' }
    );
    const { window } = dom;
    if (preseedLocalStorage) {
      window.localStorage.setItem('ag_claude_ux_modules_v1', JSON.stringify(preseedLocalStorage));
    }
    window.__agProjectCall = async (action, payload) => {
      if (action === 'saveUiPrefs') {
        const res = daemon.saveUiPrefs(payload);
        daemon.rebuildBundleIfNeeded();
        return res;
      }
      return { ok: false, error: 'unsupported' };
    };
    window.ctx = {
      config: boot.config,
      modules: boot.modules,
      dict: boot.dict,
      onCleanup: () => {}
    };
    window.eval(customJsSrc);
    return dom;
  };

  let dom1 = null;
  let dom2 = null;
  let dom3 = null;
  let dom4 = null;
  try {
    /* 1. Boot on port 51016 with legacy unsynced localStorage { i18n: true } -> auto-migrates to ui-prefs.json */
    dom1 = openSimulatedWindow(51016, { i18n: true, cjkFontScale: '94.5' });
    await new Promise((r) => setTimeout(r, 30));
    assert.equal(dom1.window.document.documentElement.getAttribute('data-ag-ux-lang'), 'zh');
    assert.equal(dom1.window.document.documentElement.getAttribute('data-ag-cjk-scale'), '94.5');
    assert.equal(fs.existsSync(uiPrefsPath), true, 'auto-migrates existing session localStorage to ui-prefs.json');
    const saved1 = JSON.parse(fs.readFileSync(uiPrefsPath, 'utf8'));
    assert.equal(saved1.modules.i18n, true);
    assert.equal(saved1.cjkFontScale, '94.5');

    /* 2. Simulate Antigravity restart on a brand-new ephemeral port 58432 (empty localStorage) -> stays Chinese! */
    dom2 = openSimulatedWindow(58432);
    assert.equal(
      dom2.window.document.documentElement.getAttribute('data-ag-ux-lang'),
      'zh',
      'new random port restart keeps Chinese mode without resetting to English'
    );
    assert.equal(dom2.window.document.documentElement.getAttribute('data-ag-cjk-scale'), '94.5');

    /* 3. User opens UI Enhancements on port 58432 and switches i18n OFF (back to English) */
    const navBtn = dom2.window.document.querySelector('button[data-testid="settings-nav-item-ClaudeUX"]');
    assert.ok(navBtn, 'mounts UI Enhancements settings nav button');
    navBtn.click();
    const i18nSwitch = dom2.window.document.querySelector('[data-ag-cux-switch="i18n"]');
    assert.equal(i18nSwitch.getAttribute('aria-checked'), 'true');
    i18nSwitch.click();
    await new Promise((r) => setTimeout(r, 30));
    assert.equal(dom2.window.document.documentElement.getAttribute('data-ag-ux-lang'), 'en');
    const saved2 = JSON.parse(fs.readFileSync(uiPrefsPath, 'utf8'));
    assert.equal(saved2.modules.i18n, false, 'persists English selection to disk');

    /* 4. Restart on BOTH a new port (61200) AND a reused old port (51016 with stale _ts) -> both boot in English! */
    dom3 = openSimulatedWindow(61200);
    assert.equal(dom3.window.document.documentElement.getAttribute('data-ag-ux-lang'), 'en');

    dom4 = openSimulatedWindow(51016, { i18n: true, _ts: saved1.updatedAt });
    assert.equal(
      dom4.window.document.documentElement.getAttribute('data-ag-ux-lang'),
      'en',
      'discards stale localStorage when OS reuses an older ephemeral port'
    );
  } finally {
    if (dom1) dom1.window.close();
    if (dom2) dom2.window.close();
    if (dom3) dom3.window.close();
    if (dom4) dom4.window.close();
    fs.rmSync(uiPrefsPath, { force: true });
  }
});

test('[v2.34 Conversation Drag, URL Auto-Link & Skill Pill] supports dragging Unified Recents & Project chats as context-scope-item-cider mentions, styles Lexical/bubble URL links, and preserves clickable skill-scope-item-pill', { skip: skipDom }, async () => {
  const customCssSrc = fs.readFileSync(path.join(REPO, 'user', 'custom.css'), 'utf8');
  assert.match(
    customCssSrc,
    /\[data-lexical-editor="true"\]\s*:is\(a\.text-link,\s*a\[href\]\)[\s\S]*?text-decoration-line:\s*underline\s*!important/,
    'custom.css keeps Lexical AutoLink URLs visually underlined & clickable'
  );
  assert.match(
    customCssSrc,
    /\[data-testid="skill-scope-item-pill"\][\s\S]*?pointer-events:\s*auto\s*!important/,
    'custom.css keeps skill-scope-item-pill clickable'
  );

  const customJsSrc = fs.readFileSync(path.join(REPO, 'user', 'custom.js'), 'utf8');
  const dom = new JSDOM(
    `<!doctype html><html><body>
      <div id="root">
        <div style="display:flex">
          <div class="bg-sidebar">
            <div class="flex flex-col gap-1.5">
              <a data-testid="new-conversation-button" href="/">New chat</a>
              <button data-testid="automations-button" class="agy-button">Automations</button>
              <a href="/customizations" class="agy-button">Skills &amp; Customizations</a>
            </div>
            <div class="sb-grand flex-1 min-h-0 overflow-y-auto flex flex-col">
              <div class="sb-parent w-full relative flex-1">
                <div data-testid="conversation-list-sidebar">
                  <div class="w-full relative" style="height: 200px;">
                    <div data-index="0" style="position: absolute; transform: translateY(0px);"><div data-testid="section-header"><span>Projects</span><button data-testid="sidebar-add-project-button"></button></div></div>
                  </div>
                </div>
              </div>
            </div>
          </div>
          <main style="flex:1;position:relative">
            <div data-testid="conversation-view" data-cascade-id="c-active">
              <div data-testid="user-input-step">
                <div class="agy-user-bubble">
                  <div data-testid="user-message-content">
                    <bdi class="context-scope-mention" data-quotable-inline="true">
                      <span data-testid="skill-scope-item-pill" role="button" data-uri="file:///Users/dev/.gemini/config/skills/browse/SKILL.md">Browse</span>
                    </bdi>
                  </div>
                </div>
              </div>
              <div id="antigravity.agentSidePanelInputBox"><div data-lexical-editor="true"></div></div>
            </div>
          </main>
        </div>
      </div>
    </body></html>`,
    { url: 'https://127.0.0.1:62683/c/c-active', pretendToBeVisual: true, runScripts: 'outside-only' }
  );

  const { window } = dom;
  const doc = window.document;
  const openedUrls = [];
  window.open = (u) => {
    openedUrls.push(u);
    return null;
  };
  let skillPillClicks = 0;
  doc.querySelector('[data-testid="skill-scope-item-pill"]').addEventListener('click', () => {
    skillPillClicks += 1;
  });

  const storeState = {
    sidebarProjects: {
      projects: [{ id: 'proj-1', name: '技术（Antigravity）', folderUris: ['file:///Users/dev/agy'] }]
    },
    projects: {
      projects: {
        'proj-1': { id: 'proj-1', name: '技术（Antigravity）', workspaceUris: ['file:///Users/dev/agy'] }
      },
      order: ['proj-1'],
      archivedOrder: []
    },
    trajectorySummaries: {
      summaries: {
        'c-rec-1': {
          annotations: { title: '反重力界面改造记录' },
          summary: '反重力界面改造记录',
          trajectoryMetadata: { projectId: 'proj-1' },
          lastModifiedTime: { seconds: Math.floor(Date.now() / 1000) - 90 },
          status: 1
        }
      },
      externalSummaries: {},
      indexes: { sidebar: ['c-rec-1'], pinned: [] }
    }
  };
  let navigatedCid = null;
  const mockStore = { getState: () => storeState, subscribe: () => () => {}, dispatch: () => {} };
  const mockRouter = { state: { location: { pathname: '/c/c-active' } }, navigate: ({ to }) => (navigatedCid = to) };
  doc.querySelector('[data-testid="conversation-list-sidebar"]').firstElementChild.__reactFiber$v234 = {
    memoizedProps: { sidebarStore: mockStore, sidebarRouter: mockRouter },
    return: null
  };
  window.__agProjectCall = async (action) => {
    if (action === 'listContexts') return { ok: true, contexts: {}, projectMtimes: {} };
    if (action === 'readContext') return { ok: true, instructions: '', files: [], scheduledTasks: [] };
    if (action === 'saveUiPrefs') return { ok: true };
    return { ok: false };
  };
  window.ctx = {
    modules: { i18n: true, claudeUxProjects: true, claudeUxHideSidebarProjects: true },
    dict: { Browse: '分类浏览', Skills: '技能' },
    onCleanup: () => {}
  };
  window.eval(customJsSrc);

  try {
    await new Promise((r) => setTimeout(r, 40));

    /* 1. Skill pill text is NOT mangled by i18n ("Browse" stays "Browse", not "分类浏览") and click fires cleanly */
    const skillPill = doc.querySelector('[data-testid="skill-scope-item-pill"]');
    assert.equal(skillPill.textContent, 'Browse', 'preserves exact skill name inside skill-scope-item-pill');
    skillPill.click();
    assert.equal(skillPillClicks, 1, 'skill pill click propagates cleanly to native side-pane opener');

    /* 2. Unified Recents row sets application/context-scope-item-cider on dragstart and suppresses accidental click navigation */
    const recRow = doc.querySelector('.ag-recent-row[data-ag-recent-id="c-rec-1"]');
    assert.ok(recRow, 'renders Unified Recents row');
    assert.equal(recRow.getAttribute('draggable'), 'true');
    const dragBag = new Map();
    const dragStartEv = new window.Event('dragstart', { bubbles: true, cancelable: true });
    Object.defineProperty(dragStartEv, 'dataTransfer', {
      value: {
        effectAllowed: 'none',
        setData: (k, v) => dragBag.set(k, v),
        getData: (k) => dragBag.get(k) || '',
        types: ['application/context-scope-item-cider']
      }
    });
    recRow.dispatchEvent(dragStartEv);
    assert.equal(
      dragBag.get('application/context-scope-item-cider'),
      JSON.stringify({ conversation: { id: 'c-rec-1', title: '反重力界面改造记录' } }),
      'emits v2.34 ContextScopeItemSchema JSON payload on dragstart'
    );
    recRow.dispatchEvent(new window.Event('dragend', { bubbles: true }));
    recRow.click();
    assert.equal(navigatedCid, null, 'suppresses post-drag accidental click navigation');

    /* 3. Drop conversation onto Project Detail composer -> inserts @[反重力界面改造记录] pill, and Cmd+Click opens URL */
    doc.getElementById('ag-claude-projects-nav-btn').click();
    await new Promise((r) => setTimeout(r, 20));
    doc.querySelector('[data-ag-proj-id="proj-1"]').click();
    await new Promise((r) => setTimeout(r, 20));

    const compBox = doc.querySelector('[data-ag-pd-composer-box]');
    const compInput = doc.getElementById('ag-pd-composer-input');
    const dropEv = new window.Event('drop', { bubbles: true, cancelable: true });
    Object.defineProperty(dropEv, 'dataTransfer', {
      value: {
        types: ['application/context-scope-item-cider'],
        getData: (k) => dragBag.get(k) || '',
        files: [],
        items: []
      }
    });
    compBox.dispatchEvent(dropEv);
    assert.match(compInput.value, /@\[反重力界面改造记录\]/, 'inserts dragged conversation mention into Project composer');
    assert.ok(doc.querySelector('#ag-pd-mention-pills .ag-pd-mention-pill'), 'renders conversation mention pill above composer');

    compInput.value += '请参考 https://antigravity.google/docs 文档';
    const urlPos = compInput.value.indexOf('antigravity.google');
    compInput.setSelectionRange(urlPos, urlPos);
    compInput.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true, metaKey: true }));
    assert.deepEqual(openedUrls, ['https://antigravity.google/docs'], 'Cmd+Click on URL inside Project composer opens link');

    /* 4. Drop non-image local files (e.g. .srt subtitle), folders, and mixed file+image payloads onto Project composer */
    const pathMap = new WeakMap();
    window.electronNative = {
      getPathForFile: (f) => pathMap.get(f) || ''
    };
    const srtFile = new window.File(['1\n00:00:01,000 --> 00:00:02,000\nHello\n'], 'episode 01 字幕.srt', { type: '' });
    pathMap.set(srtFile, '/Users/demo/project/subtitles/episode 01 字幕.srt');
    const dirFile = new window.File([], 'captions-dir', { type: '' });
    pathMap.set(dirFile, '/Users/demo/project/captions-dir');
    const pngFile = new window.File([new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])], 'frame.png', { type: 'image/png' });
    pathMap.set(pngFile, '/Users/demo/project/frame.png');

    compInput.value = '';
    compInput.dispatchEvent(new window.Event('input', { bubbles: true }));

    const dragOverEv = new window.Event('dragover', { bubbles: true, cancelable: true });
    const dragOverDt = { types: ['Files'], dropEffect: 'none' };
    Object.defineProperty(dragOverEv, 'dataTransfer', { value: dragOverDt });
    compBox.dispatchEvent(dragOverEv);
    assert.equal(dragOverEv.defaultPrevented, true, 'dragover with Files calls preventDefault');
    assert.equal(dragOverDt.dropEffect, 'copy', 'dragover sets copy dropEffect');
    assert.equal(compBox.getAttribute('data-drag'), 'true', 'dragover highlights Project composer');

    const mixedDropEv = new window.Event('drop', { bubbles: true, cancelable: true });
    Object.defineProperty(mixedDropEv, 'dataTransfer', {
      value: {
        types: ['Files'],
        getData: () => '',
        files: [srtFile, dirFile, pngFile],
        items: [
          { kind: 'file', getAsFile: () => srtFile, webkitGetAsEntry: () => ({ isDirectory: false }) },
          { kind: 'file', getAsFile: () => dirFile, webkitGetAsEntry: () => ({ isDirectory: true }) },
          { kind: 'file', getAsFile: () => pngFile, webkitGetAsEntry: () => ({ isDirectory: false }) }
        ]
      }
    });
    compBox.dispatchEvent(mixedDropEv);
    await new Promise((r) => setTimeout(r, 40));

    assert.equal(mixedDropEv.defaultPrevented, true, 'mixed drop prevents default navigation');
    assert.equal(compBox.getAttribute('data-drag'), null, 'drop clears drag highlight');
    assert.match(compInput.value, /@\[episode 01 字幕\.srt\]/, 'dropped .srt subtitle inserts file mention token');
    assert.match(compInput.value, /@\[captions-dir\]/, 'dropped folder inserts directory mention token');
    const pills = [...doc.querySelectorAll('#ag-pd-mention-pills .ag-pd-mention-pill')];
    assert.equal(pills.length, 2, 'renders both file and directory mention pills');
    assert.ok(doc.querySelector('#ag-pd-media-strip .ag-pd-media-card'), 'stages image thumbnail in the same mixed drop');
    assert.equal(doc.querySelector('[data-ag-pd-send]').disabled, false, 'send button is enabled after file drop');

    /* 5. Paste a copied local file from Finder (Cmd+C -> Cmd+V) into Project composer */
    const vttFile = new window.File(['WEBVTT\n'], 'clip.vtt', { type: 'text/vtt' });
    pathMap.set(vttFile, '/Users/demo/project/clip.vtt');
    const pasteEv = new window.Event('paste', { bubbles: true, cancelable: true });
    Object.defineProperty(pasteEv, 'clipboardData', {
      value: {
        types: ['Files'],
        getData: () => '',
        files: [vttFile],
        items: [{ kind: 'file', getAsFile: () => vttFile }]
      }
    });
    compInput.dispatchEvent(pasteEv);
    assert.equal(pasteEv.defaultPrevented, true, 'pasting local file prevents default');
    assert.match(compInput.value, /@\[clip\.vtt\]/, 'pasted .vtt file attaches as mention token');
  } finally {
    window.close();
  }
});

test('[Pinned Drag Drop Animation] dispatches layout/setDragOverChatCascadeId across conversation-view and suppresses competing split preview when dragging a Pinned row', { skip: skipDom }, async () => {
  const customCssSrc = fs.readFileSync(path.join(REPO, 'user', 'custom.css'), 'utf8');
  assert.match(
    customCssSrc,
    /html\[data-ag-pinned-chat-drop="true"\]\s+body\s*>\s*div\.fixed\.pointer-events-none\.bg-primary\.opacity-15:not\(\[data-testid\]\)\s*\{\s*display:\s*none\s*!important;/,
    'custom.css suppresses competing split-pane preview portal during pinned drag-to-cite'
  );

  const customJsSrc = fs.readFileSync(path.join(REPO, 'user', 'custom.js'), 'utf8');
  const dom = new JSDOM(
    `<!doctype html><html><body>
      <div id="root">
        <div class="bg-sidebar">
          <div data-testid="conversation-list-sidebar">
            <div class="w-full relative">
              <div data-testid="conversation-row-sidebar" data-pinned="true" data-cascade-id="c-pin-other">
                <a href="/c/c-pin-other" aria-label="Pinned Source Chat"></a>
                <div class="flex-col"><span>Pinned Source Chat</span></div>
              </div>
            </div>
          </div>
        </div>
        <main>
          <div data-testid="conversation-view" data-cascade-id="c-active">
            <div id="antigravity.agentSidePanelInputBox"></div>
          </div>
        </main>
      </div>
    </body></html>`,
    { url: 'https://127.0.0.1:62683/c/c-active', pretendToBeVisual: true, runScripts: 'outside-only' }
  );

  const { window } = dom;
  const doc = window.document;
  const dispatches = [];
  const storeState = {
    layout: { dragOverChatCascadeId: null, pendingChatDrop: null, pendingSplitDrop: { paneId: 'p1', direction: 'right' } },
    sidebarProjects: { projects: [] },
    trajectorySummaries: { summaries: {}, indexes: { sidebar: [], pinned: ['c-pin-other'] } }
  };
  const mockStore = {
    getState: () => storeState,
    subscribe: () => () => {},
    dispatch: (action) => dispatches.push(action)
  };
  doc.querySelector('[data-testid="conversation-list-sidebar"]').firstElementChild.__reactFiber$pin = {
    memoizedProps: { sidebarStore: mockStore },
    return: null
  };
  const sbEl = doc.querySelector('.bg-sidebar');
  sbEl.getBoundingClientRect = () => ({ left: 0, top: 0, right: 256, bottom: 900, width: 256, height: 900 });
  const pinnedRowEl = doc.querySelector('[data-testid="conversation-row-sidebar"][data-cascade-id="c-pin-other"]');
  pinnedRowEl.getBoundingClientRect = () => ({ left: 8, top: 84, right: 244, bottom: 117, width: 236, height: 33 });
  const viewEl = doc.querySelector('[data-testid="conversation-view"]');
  viewEl.getBoundingClientRect = () => ({ left: 260, top: 40, right: 1200, bottom: 900, width: 940, height: 860 });

  window.ctx = { modules: { i18n: false, claudeUxHideSidebarProjects: false }, onCleanup: () => {} };
  window.eval(customJsSrc);

  try {
    const pinnedRow = doc.querySelector('[data-testid="conversation-row-sidebar"][data-cascade-id="c-pin-other"]');
    pinnedRow.dispatchEvent(new window.MouseEvent('pointerdown', { bubbles: true, button: 0, clientX: 80, clientY: 100 }));
    window.dispatchEvent(new window.MouseEvent('pointermove', { bubbles: true, clientX: 500, clientY: 300 }));
    await new Promise((r) => setTimeout(r, 20));

    assert.equal(doc.documentElement.getAttribute('data-ag-pinned-chat-drop'), 'true');
    assert.equal(doc.documentElement.getAttribute('data-ag-pinned-ghost-active'), 'true');
    const ghostEl = doc.getElementById('ag-pinned-drag-ghost');
    assert.ok(ghostEl, 'mounts floating cursor-following ghost card when pinned row exits sidebar');
    assert.match(ghostEl.textContent, /Pinned Source Chat/, 'ghost card displays pinned conversation title');
    assert.match(ghostEl.style.transform, /^translate3d\(/, 'positions ghost card via translate3d');
    assert.ok(
      dispatches.some((a) => a.type === 'layout/setDragOverChatCascadeId' && a.payload === 'c-active'),
      'triggers native Hgb+Igb drop highlight animation via setDragOverChatCascadeId'
    );
    assert.ok(
      dispatches.some((a) => a.type === 'layout/setPendingSplitDrop' && a.payload === null),
      'clears competing pendingSplitDrop highlight'
    );

    window.dispatchEvent(new window.MouseEvent('pointerup', { bubbles: true, button: 0, clientX: 500, clientY: 300 }));
    assert.equal(doc.documentElement.getAttribute('data-ag-pinned-chat-drop'), null);
    assert.equal(doc.documentElement.getAttribute('data-ag-pinned-ghost-active'), null);
    assert.equal(doc.getElementById('ag-pinned-drag-ghost'), null, 'removes ghost card on drop');
    assert.ok(
      dispatches.some((a) => a.type === 'layout/setDragOverChatCascadeId' && a.payload === null),
      'clears setDragOverChatCascadeId on drop'
    );
    assert.ok(
      dispatches.some(
        (a) =>
          a.type === 'layout/setPendingChatDrop' &&
          a.payload &&
          a.payload.cascadeId === 'c-active' &&
          a.payload.payload.conversationId === 'c-pin-other'
      ),
      'dispatches pendingChatDrop to cite pinned conversation'
    );
  } finally {
    window.close();
  }
});

test('[v2.34.0 Orchestrator Planners & Thinking Effort] unlocks thinking effort on Orchestrators and exposes Claude Opus 5.5 from v7c.Provider', { skip: skipDom }, async () => {
  const customJsSrc = fs.readFileSync(path.join(REPO, 'user', 'custom.js'), 'utf8');
  const dom = new JSDOM(
    `<!doctype html><html><body>
      <div id="root">
        <button type="button" data-testid="model-selector-trigger" aria-label="Select model, current: Orchestrator Gemini 4 Neon Extra High">Orchestrator Gemini 4 Neon Extra</button>
      </div>
    </body></html>`,
    { url: 'https://127.0.0.1:62683/c/c-orch', pretendToBeVisual: true, runScripts: 'outside-only' }
  );
  const { window } = dom;
  const doc = window.document;
  const btn = doc.querySelector('button[data-testid="model-selector-trigger"]');
  btn.getBoundingClientRect = () => ({ left: 40, top: 760, right: 240, bottom: 788, width: 200, height: 28 });

  const modelOptions = [
    { label: 'Gemini 4 Carbon (Low)', value: 1438, modelId: 'gemini-4-carbon-low', disabled: false },
    { label: 'Gemini 4 Carbon (Medium)', value: 1437, modelId: 'gemini-4-carbon-medium', disabled: false },
    { label: 'Gemini 4 Carbon (High)', value: 1427, modelId: 'gemini-4-carbon-high', disabled: false },
    { label: 'Orchestrator (Neon)', value: 1537, modelId: 'gemini-pro-orchestrator-neon', disabled: false },
    { label: 'Orchestrator (Carbon)', value: 1538, modelId: 'gemini-pro-orchestrator-carbon', disabled: false },
    { label: 'Orchestrator (Argon)', value: 1539, modelId: 'gemini-pro-orchestrator-argon', disabled: false }
  ];
  const orchestratorPlanners = [
    { label: 'Gemini 4 Neon (High)', value: 1532, modelId: 'gemini-4-neon-high', disabled: false },
    { label: 'Gemini 4 Neon (XHigh)', value: 1535, modelId: 'gemini-4-neon-xhigh', disabled: false },
    { label: 'Gemini 4 Neon (Medium)', value: 1533, modelId: 'gemini-4-neon-medium', disabled: false },
    { label: 'Gemini 4 Neon (Low)', value: 1534, modelId: 'gemini-4-neon-low', disabled: false },
    { label: 'Gemini 4 Carbon (Medium)', value: 1437, modelId: 'gemini-4-carbon-medium', disabled: false },
    { label: 'Gemini 4 Carbon (High)', value: 1427, modelId: 'gemini-4-carbon-high', disabled: false },
    { label: 'Gemini 4 Carbon (Low)', value: 1438, modelId: 'gemini-4-carbon-low', disabled: false },
    { label: 'Gemini 4 Argon (Medium)', value: 1418, modelId: 'gemini-4-argon-medium', disabled: false },
    { label: 'Gemini 4 Argon (High)', value: 1417, modelId: 'gemini-4-argon-high', disabled: false },
    { label: 'Gemini 4 Argon (Low)', value: 1419, modelId: 'gemini-4-argon-low', disabled: false },
    { label: 'Claude Opus 5.5 (Low)', value: 1400, modelId: 'claude-opus-5-5-low', disabled: false },
    { label: 'Claude Opus 5.5 (Medium)', value: 1401, modelId: 'claude-opus-5-5-medium', disabled: false },
    { label: 'Claude Opus 5.5 (High)', value: 1402, modelId: 'claude-opus-5-5-high', disabled: false }
  ];

  let selectedModel = modelOptions[3];
  let orchPickModel = 0;
  const calls = [];

  const outerWrapperFiber = {
    memoizedProps: {
      modelOptions,
      get selectedModel() {
        return selectedModel;
      },
      setSelectedModel(o) {
        calls.push(['setSelected', o && o.value]);
        selectedModel = o;
      }
    },
    return: null
  };

  btn.__reactFiber$orch = {
    memoizedProps: {
      value: {
        modelOptions,
        orchestratorPlanners,
        orchestratorDefaultPlanner: { label: 'Gemini 4 Neon (XHigh)', value: 1535, modelId: 'gemini-4-neon-xhigh' },
        orchestratorPick: {
          get model() {
            return orchPickModel;
          },
          select(v) {
            calls.push(['orchSelect', v]);
            orchPickModel = v;
          }
        },
        get selectedModel() {
          return selectedModel;
        },
        setSelectedModel(o) {
          calls.push(['setSelected', o && o.value]);
          selectedModel = o;
        }
      }
    },
    return: outerWrapperFiber
  };

  window.ctx = { modules: { i18n: false, claudeUxModelMenu: true }, onCleanup: () => {} };
  window.eval(customJsSrc);

  try {
    const openMenu = () => btn.dispatchEvent(new window.Event('pointerdown', { bubbles: true, cancelable: true }));

    /* 1. Opening menu while on Neon Orchestrator with model:0 unlocks Thinking effort & shows Extra */
    openMenu();
    const mainPop = doc.getElementById('ag-claude-model-popover');
    const subPop = doc.getElementById('ag-claude-model-subpop');
    const effTrigger = mainPop.querySelector('[data-ag-cm-subtrigger="effort"]');
    assert.notEqual(effTrigger.getAttribute('data-disabled'), 'true', 'Orchestrator thinking effort must not be disabled');
    assert.match(effTrigger.textContent, /Extra/, 'displays default Neon XHigh as Extra');
    assert.doesNotMatch(effTrigger.textContent, /固定|Fixed/);

    effTrigger.click();
    assert.equal(subPop.getAttribute('data-open'), 'true');
    assert.deepEqual(
      Array.from(subPop.querySelectorAll('[data-ag-cm-effort]')).map((el) => el.getAttribute('data-ag-cm-effort')),
      ['Low', 'Medium', 'High', 'XHigh'],
      'Neon Orchestrator offers all 4 thinking efforts'
    );
    assert.ok(subPop.querySelector('[data-ag-cm-effort="XHigh"] .ag-cm-check'), 'XHigh row is checked initially');

    /* 2. Switching Neon Orchestrator effort to High dispatches orchestratorPick.select(1532) before setSelectedModel(1537) */
    subPop.querySelector('[data-ag-cm-effort="High"]').click();
    assert.deepEqual(calls, [
      ['orchSelect', 1532],
      ['setSelected', 1537]
    ]);

    /* 3. More models lists all 4 dynamic Orchestrator planners including Claude Opus 5.5 without legacy duplicates */
    openMenu();
    mainPop.querySelector('[data-ag-cm-subtrigger="more"]').click();
    const moreLabels = Array.from(subPop.querySelectorAll('[data-ag-cm-more-family]')).map((el) =>
      el.getAttribute('data-ag-cm-more-family')
    );
    assert.deepEqual(moreLabels, [
      'Orchestrator · Gemini 4 Neon',
      'Orchestrator · Gemini 4 Carbon',
      'Orchestrator · Gemini 4 Argon',
      'Orchestrator · Claude Opus 5.5'
    ]);

    /* 4. Selecting Claude Opus 5.5 inherits High effort, calls select(1402), and exposes Low/Medium/High only */
    calls.length = 0;
    subPop.querySelector('[data-ag-cm-more-family="Orchestrator · Claude Opus 5.5"]').click();
    assert.deepEqual(calls, [
      ['orchSelect', 1402],
      ['setSelected', 1537]
    ]);

    openMenu();
    assert.match(mainPop.querySelector('[data-ag-cm-subtrigger="effort"]').textContent, /High/);
    mainPop.querySelector('[data-ag-cm-subtrigger="effort"]').click();
    assert.match(subPop.querySelector('.ag-cm-sec-hdr').textContent, /Orchestrator · Claude Opus 5\.5/);
    assert.deepEqual(
      Array.from(subPop.querySelectorAll('[data-ag-cm-effort]')).map((el) => el.getAttribute('data-ag-cm-effort')),
      ['Low', 'Medium', 'High'],
      'Claude Opus 5.5 Orchestrator offers Low/Medium/High efforts'
    );
    calls.length = 0;
    subPop.querySelector('[data-ag-cm-effort="Low"]').click();
    assert.deepEqual(calls, [
      ['orchSelect', 1400],
      ['setSelected', 1537]
    ]);

    /* 5. Switching back to a standard primary model invokes setSelectedModel only */
    calls.length = 0;
    openMenu();
    mainPop.querySelector('[data-ag-cm-family="Gemini 4 Carbon"]').click();
    assert.deepEqual(calls, [['setSelected', 1438]]);
  } finally {
    window.close();
  }
});

test('[Code Fold & Sticky Header] collapses native code blocks over 40 lines, remembers expand across remount, and leaves short blocks untouched', { skip: skipDom }, async () => {
  const customCssSrc = fs.readFileSync(path.join(REPO, 'user', 'custom.css'), 'utf8');
  assert.match(
    customCssSrc,
    /\[data-ag-code-wrap="true"\]\s*>\s*div\.min-h-7:first-child\s*\{[^}]*position:\s*sticky/,
    'custom.css pins native code block headers via sticky positioning'
  );

  const makeCodeBlockHtml = (lang, lines, prefix) => {
    const rows = Array.from({ length: lines }, (_, i) =>
      `<div class="code-line" data-line-number="${i + 1}"><span>${prefix} line ${i + 1}</span></div>`
    ).join('');
    return (
      `<div class="relative whitespace-pre-wrap word-break-all my-2 rounded-xl bg-muted border">` +
      `<div class="min-h-7 relative box-border flex flex-row items-center justify-between rounded-t border-b border-border px-2 py-0.5">` +
      `<div class="font-sans text-base text-muted-foreground">${lang}</div>` +
      `<div class="flex flex-row items-center gap-2 justify-end"><button type="button" aria-label="Copy code"></button></div>` +
      `</div>` +
      `<div class="p-3"><div class="code-block w-full text-sm cursor-text" dir="ltr"><div class="flex flex-col w-full">${rows}</div></div></div>` +
      `</div>`
    );
  };

  const longHtml = makeCodeBlockHtml('js', 60, 'const alpha =');
  const shortHtml = makeCodeBlockHtml('js', 5, 'const beta =');
  const customJsSrc = fs.readFileSync(path.join(REPO, 'user', 'custom.js'), 'utf8');
  const dom = new JSDOM(
    `<!doctype html><html><body><div id="root"><div data-testid="planner-response-text" id="resp">${longHtml}${shortHtml}</div></div></body></html>`,
    { url: 'https://127.0.0.1:62683/c/c-code', pretendToBeVisual: true, runScripts: 'outside-only' }
  );
  const { window } = dom;
  const doc = window.document;
  window.ctx = { modules: { i18n: false, claudeUxCodeFold: true }, onCleanup: () => {} };
  window.eval(customJsSrc);

  try {
    await new Promise((r) => setTimeout(r, 30));
    const resp = doc.getElementById('resp');
    const longWrap = resp.children[0];
    const shortWrap = resp.children[1];

    /* 1. Long block (>=40 lines) is collapsed by default with toggle + expand bar */
    assert.equal(longWrap.getAttribute('data-ag-code-wrap'), 'true');
    assert.equal(longWrap.getAttribute('data-ag-code-long'), 'true');
    assert.equal(longWrap.getAttribute('data-ag-code-collapsed'), 'true');
    assert.ok(longWrap.querySelector('.ag-code-fold-toggle'), 'header fold toggle button mounted');
    const bar = longWrap.querySelector('.ag-code-fold-bar');
    assert.ok(bar && /60/.test(bar.textContent), 'bottom expand bar displays total line count (60)');

    /* 2. Short block (<40 lines) gets sticky wrapper attr only */
    assert.equal(shortWrap.getAttribute('data-ag-code-wrap'), 'true');
    assert.equal(shortWrap.hasAttribute('data-ag-code-long'), false);
    assert.equal(shortWrap.querySelector('.ag-code-fold-toggle'), null);
    assert.equal(shortWrap.querySelector('.ag-code-fold-bar'), null);

    /* 3. Expanding updates state & bar text */
    bar.click();
    assert.equal(longWrap.getAttribute('data-ag-code-collapsed'), 'false');
    assert.equal(bar.textContent, 'Collapse code');

    /* 4. Unmounting and remounting identical block remembers expanded state */
    longWrap.remove();
    resp.insertAdjacentHTML('afterbegin', longHtml);
    await new Promise((r) => setTimeout(r, 180));
    const remountedWrap = resp.children[0];
    assert.equal(remountedWrap.getAttribute('data-ag-code-collapsed'), 'false', 'remount preserves user expanded state');

    /* 5. Clicking header toggle collapses block back */
    remountedWrap.querySelector('.ag-code-fold-toggle').click();
    assert.equal(remountedWrap.getAttribute('data-ag-code-collapsed'), 'true');
  } finally {
    window.close();
  }
});

test('[RPC Token Drift Auto-Heal & Read-Only Verify] heals drifted rpcSessionId on checkAndInject, leaves readOnly attach passive, and falls back to file input on pickFiles failure', { skip: skipDom }, async () => {
  const daemon = await import(pathToFileURL(path.join(REPO, 'core', 'daemon.mjs')).href);
  daemon.rebuildBundleIfNeeded();
  daemon.attachedTargets.clear();
  daemon.skippedNonHostTargets.clear();

  const origWs = globalThis.WebSocket;
  const cdpCalls = [];
  const simState = { hasFonts: true, customJsMounted: true, sessionId: '', injectCount: 0 };

  class MockCdpSocket extends EventTarget {
    static OPEN = 1;
    constructor() {
      super();
      this.readyState = 1;
      queueMicrotask(() => this.dispatchEvent(new Event('open')));
    }
    emitEvent(method, params) {
      this.dispatchEvent(new MessageEvent('message', { data: JSON.stringify({ method, params }) }));
    }
    send(raw) {
      const { id, method, params } = JSON.parse(raw);
      cdpCalls.push({ method, params });
      const reply = (result = {}) =>
        this.dispatchEvent(new MessageEvent('message', { data: JSON.stringify({ id, result }) }));
      queueMicrotask(() => {
        if (method === 'Page.getFrameTree') {
          reply({ frameTree: { frame: { id: 'main-frame' } } });
        } else if (method === 'Runtime.enable') {
          this.emitEvent('Runtime.executionContextCreated', {
            context: { id: 101, origin: 'http://127.0.0.1:5199', auxData: { frameId: 'main-frame', isDefault: true, type: 'default' } }
          });
          reply({});
        } else if (method === 'Runtime.evaluate') {
          const expr = String(params && params.expression || '');
          if (expr.includes("return 'swarm'")) {
            reply({ result: { value: 'host' } });
          } else if (expr.includes('document.getElementById("ag-custom-fonts")')) {
            const ok = new Function('document', 'window', `return (${expr});`)(
              { getElementById: (eid) => (eid === 'ag-custom-fonts' && simState.hasFonts ? {} : null) },
              { __ag_custom_js_mounted: simState.customJsMounted, __ag_rpc_session_id: simState.sessionId }
            );
            reply({ result: { value: Boolean(ok) } });
          } else {
            const m = expr.match(/"rpcSessionId":"([a-f0-9]+)"/i);
            if (m) {
              simState.sessionId = m[1];
              simState.injectCount += 1;
            }
            reply({ result: { value: 'dark' } });
          }
        } else {
          reply({});
        }
      });
    }
    close() {
      this.readyState = 3;
      this.dispatchEvent(new Event('close'));
    }
  }

  try {
    globalThis.WebSocket = MockCdpSocket;
    const endpoint = { channel: 'test', portFile: '', fallbackPort: 0, conversationsDir: os.tmpdir() };

    /* 1. Normal attach mints distinct rpcSessionId & heals drifted page token without tearing down fonts */
    const page1 = {
      id: 'target-heal-1',
      type: 'page',
      url: 'http://127.0.0.1:5199/',
      webSocketDebuggerUrl: 'ws://127.0.0.1:5199/devtools/page/target-heal-1'
    };
    await daemon.attachTarget(page1, endpoint);
    const entry1 = daemon.attachedTargets.get(page1.id);
    assert.ok(entry1 && entry1.rpcSessionId.length === 24, 'mints 24-hex rpcSessionId');
    assert.notEqual(entry1.rpcSessionId, entry1.rpcToken);
    assert.equal(simState.sessionId, entry1.rpcSessionId);
    const baseInjects = simState.injectCount;

    /* Same sessionId -> heartbeat probe passes with zero re-inject */
    await entry1.checkAndInject(false);
    assert.equal(simState.injectCount, baseInjects);

    /* Simulate transient verifier overwriting page token/sessionId -> daemon heals on checkAndInject */
    simState.sessionId = 'stale_verify_once_sid';
    await entry1.checkAndInject(false);
    assert.equal(simState.injectCount, baseInjects + 1, 're-injects on rpcSessionId drift');
    assert.equal(simState.sessionId, entry1.rpcSessionId, 'restores daemon rpcSessionId on page');

    entry1.revokeHostAuth();
    assert.equal(entry1.rpcToken, '');
    assert.equal(entry1.rpcSessionId, '');

    /* 2. Read-only attach (used by --verify-once) emits zero addBinding, NewDocument, or runtime inject */
    cdpCalls.length = 0;
    const page2 = {
      id: 'target-ro-1',
      type: 'page',
      url: 'http://127.0.0.1:5199/',
      webSocketDebuggerUrl: 'ws://127.0.0.1:5199/devtools/page/target-ro-1'
    };
    await daemon.attachTarget(page2, endpoint, { readOnly: true });
    const entry2 = daemon.attachedTargets.get(page2.id);
    assert.equal(entry2.hostConfirmed, true);
    assert.equal(entry2.rpcToken, '');
    assert.equal(entry2.rpcSessionId, '');
    assert.equal(
      cdpCalls.some((c) => c.method === 'Runtime.addBinding' || c.method === 'Page.addScriptToEvaluateOnNewDocument'),
      false,
      'readOnly attach registers zero bindings or NewDocument scripts'
    );
    assert.equal(
      cdpCalls.some((c) => c.method === 'Runtime.evaluate' && String(c.params?.expression || '').includes('__AG_BOOT_PAYLOAD__')),
      false,
      'readOnly attach never injects or overwrites live runtime payload'
    );
  } finally {
    globalThis.WebSocket = origWs;
    for (const [, e] of daemon.attachedTargets.entries()) {
      try {
        e.ws.close();
      } catch {}
    }
    daemon.attachedTargets.clear();
    daemon.skippedNonHostTargets.clear();
  }

  /* 3. Project Detail [data-ag-pd-add-files] uses pickFiles when ok and falls back to <input type="file"> on error */
  const customJsSrc = fs.readFileSync(path.join(REPO, 'user', 'custom.js'), 'utf8');
  const dom = new JSDOM(
    `<!doctype html><html><body>
      <div id="root">
        <div style="display:flex">
          <div class="bg-sidebar">
            <a data-testid="new-conversation-button" href="/">New chat</a>
            <button data-testid="automations-button" class="agy-button">Automations</button>
            <a href="/customizations" class="agy-button">Skills &amp; Customizations</a>
            <div data-testid="conversation-list-sidebar"><div class="w-full relative"></div></div>
          </div>
          <main style="flex:1;position:relative"></main>
        </div>
      </div>
    </body></html>`,
    { url: 'https://127.0.0.1:62683/c/c-active', pretendToBeVisual: true, runScripts: 'outside-only' }
  );
  const { window } = dom;
  const doc = window.document;
  const projCtx = { ok: true, instructions: '', files: [], scheduledTasks: [] };
  const storeState = {
    sidebarProjects: {
      projects: [{ id: 'p-1', name: 'DemoProj', folderUris: ['file:///tmp/p-1'] }]
    },
    trajectorySummaries: { summaries: {}, externalSummaries: {}, indexes: { sidebar: [], pinned: [], byProject: {} } }
  };
  doc.querySelector('[data-testid="conversation-list-sidebar"]').firstElementChild.__reactFiber$pf = {
    memoizedProps: { sidebarStore: { getState: () => storeState, subscribe: () => () => {}, dispatch: () => {} } },
    return: null
  };

  let pickMode = 'ok';
  const savedPayloads = [];
  window.__agProjectCall = async (action, payload) => {
    if (action === 'listContexts') return { ok: true, contexts: { '/tmp/p-1': projCtx }, projectMtimes: {} };
    if (action === 'readContext') return projCtx;
    if (action === 'saveContext') {
      savedPayloads.push(payload);
      return { ...projCtx, files: payload.files || [] };
    }
    if (action === 'pickFiles') {
      return pickMode === 'ok'
        ? { ok: true, canceled: false, paths: ['/tmp/p-1/spec.md'] }
        : { ok: false, error: 'unauthorized_context' };
    }
    if (action === 'saveUiPrefs') return { ok: true };
    return { ok: false };
  };
  window.ctx = { modules: { i18n: false, claudeUxProjects: true }, onCleanup: () => {} };
  window.eval(customJsSrc);

  try {
    doc.getElementById('ag-claude-projects-nav-btn').click();
    await new Promise((r) => setTimeout(r, 20));
    doc.querySelector('.ag-proj-card[data-ag-proj-id="p-1"]').click();
    await new Promise((r) => setTimeout(r, 20));

    const addFilesBtn = doc.querySelector('[data-ag-pd-add-files]');
    assert.ok(addFilesBtn, 'renders Reference Files + button on Project Detail');

    /* Path A: pickFiles succeeds -> calls saveContext */
    addFilesBtn.click();
    await new Promise((r) => setTimeout(r, 30));
    assert.equal(savedPayloads.length, 1);
    assert.equal(savedPayloads[0].files[0].sourcePath, '/tmp/p-1/spec.md');

    /* Path B: pickFiles returns unauthorized_context -> triggers native <input type="file"> fallback */
    pickMode = 'err';
    let fallbackFileClicks = 0;
    const origInputClick = window.HTMLInputElement.prototype.click;
    window.HTMLInputElement.prototype.click = function () {
      if (this.type === 'file') fallbackFileClicks += 1;
      return origInputClick.apply(this, arguments);
    };
    addFilesBtn.click();
    await new Promise((r) => setTimeout(r, 30));
    assert.equal(fallbackFileClicks, 1, 'triggers native file input picker fallback when RPC pickFiles fails');

    /* Path C: Electron host (electronNative.getPathForFile) opens instant native <input type="file"> without calling pickFiles RPC */
    let pickFilesCalledWhenElectron = 0;
    const origProjectCall = window.__agProjectCall;
    window.__agProjectCall = (action, payload) => {
      if (action === 'pickFiles') {
        pickFilesCalledWhenElectron += 1;
        return Promise.resolve({ ok: false });
      }
      return origProjectCall(action, payload);
    };
    window.electronNative = { getPathForFile: (f) => (f && f.name ? `/tmp/p-1/${f.name}` : '') };
    let instantInputEl = null;
    window.HTMLInputElement.prototype.click = function () {
      if (this.type === 'file') instantInputEl = this;
    };
    addFilesBtn.click();
    assert.ok(instantInputEl, 'synchronously triggers <input type="file"> when electronNative.getPathForFile exists');
    assert.equal(pickFilesCalledWhenElectron, 0, 'skips slow osascript pickFiles RPC on Electron host');
    Object.defineProperty(instantInputEl, 'files', {
      value: [{ name: 'instant-doc.pdf', size: 128 }],
      configurable: true
    });
    instantInputEl.dispatchEvent(new window.Event('change'));
    await new Promise((r) => setTimeout(r, 30));
    assert.equal(savedPayloads.length, 2);
    assert.equal(savedPayloads[1].files.some((f) => f.sourcePath === '/tmp/p-1/instant-doc.pdf'), true);
  } finally {
    window.close();
  }
});

test('[Scheduled Task Dynamic Models] populates account models & all effort tiers from Redux, preserves legacy IDs on edit, and syncs model on Run Now', { skip: skipDom }, async () => {
  const customJsSrc = fs.readFileSync(path.join(REPO, 'user', 'custom.js'), 'utf8');
  const dom = new JSDOM(
    `<!doctype html><html><body>
      <div id="root">
        <div style="display:flex">
          <div class="bg-sidebar">
            <a data-testid="new-conversation-button" href="/">New chat</a>
            <button data-testid="automations-button" class="agy-button">Automations</button>
            <a href="/customizations" class="agy-button">Skills &amp; Customizations</a>
            <div data-testid="conversation-list-sidebar"><div class="w-full relative"></div></div>
          </div>
          <main style="flex:1;position:relative"></main>
        </div>
      </div>
    </body></html>`,
    { url: 'https://127.0.0.1:62683/c/c-active', pretendToBeVisual: true, runScripts: 'outside-only' }
  );
  const { window } = dom;
  const doc = window.document;
  const dispatched = [];
  const storeState = {
    sidebarProjects: { projects: [{ id: 'p-1', name: 'DemoProj', folderUris: ['file:///tmp/p-1'] }] },
    trajectorySummaries: { summaries: {}, externalSummaries: {}, indexes: { sidebar: [], pinned: [], byProject: {} } },
    userStatus: {
      cascadeModelConfigData: {
        clientModelConfigs: [
          { label: 'Gemini 4 Neon (XHigh)', modelId: 'gemini-4-neon-xhigh', value: 1535, disabled: false },
          { label: 'Gemini 4 Neon (High)', modelId: 'gemini-4-neon-high', value: 1532, disabled: false },
          { label: 'Gemini 4 Neon (Medium)', modelId: 'gemini-4-neon-medium', value: 1533, disabled: false },
          { label: 'Gemini 4 Neon (Low)', modelId: 'gemini-4-neon-low', value: 1534, disabled: false },
          { label: 'Claude Opus 5.5 (Low)', modelId: 'claude-opus-5-5-low', value: 1400, disabled: false },
          { label: 'Claude Opus 5.5 (Medium)', modelId: 'claude-opus-5-5-medium', value: 1401, disabled: false },
          { label: 'Claude Opus 5.5 (High)', modelId: 'claude-opus-5-5-high', value: 1402, disabled: false },
          { label: 'Orchestrator (Neon)', modelId: 'gemini-pro-orchestrator-neon', value: 1537, disabled: false },
          { label: 'Legacy Disabled Model', modelId: 'legacy-disabled-id', value: 9999, disabled: true }
        ]
      }
    },
    modelSelection: { default: { model: 1532 } }
  };
  doc.querySelector('[data-testid="conversation-list-sidebar"]').firstElementChild.__reactFiber$sm = {
    memoizedProps: {
      sidebarStore: { getState: () => storeState, subscribe: () => () => {}, dispatch: (a) => dispatched.push(a) },
      sidebarRouter: { state: { location: { pathname: '/c/c-active' } }, navigate: () => {} }
    },
    return: null
  };

  const projCtx = {
    ok: true,
    instructions: '',
    files: [],
    scheduledTasks: [
      {
        id: 'sched-legacy',
        name: 'legacy-job',
        description: 'Legacy job',
        instructions: 'Run legacy flow',
        folderPath: '/tmp/p-1',
        model: 'legacy-custom-id',
        frequency: 'manual'
      }
    ]
  };
  let savedScheduledPayload = null;
  window.__agProjectCall = async (action, payload) => {
    if (action === 'listContexts') return { ok: true, contexts: { '/tmp/p-1': projCtx }, projectMtimes: {} };
    if (action === 'readContext') return projCtx;
    if (action === 'saveScheduledTask') {
      savedScheduledPayload = payload;
      const saved = Object.assign({}, payload.task, { id: 'sched-new' });
      projCtx.scheduledTasks = projCtx.scheduledTasks.concat([saved]);
      return projCtx;
    }
    if (action === 'saveUiPrefs') return { ok: true };
    return { ok: false };
  };
  window.ctx = { modules: { i18n: false, claudeUxProjects: true }, onCleanup: () => {} };
  window.eval(customJsSrc);

  try {
    doc.getElementById('ag-claude-projects-nav-btn').click();
    await new Promise((r) => setTimeout(r, 20));
    doc.querySelector('.ag-proj-card[data-ag-proj-id="p-1"]').click();
    await new Promise((r) => setTimeout(r, 20));

    /* 1. Editing existing task with unknown legacy-custom-id preserves & selects it */
    doc.querySelector('[data-ag-pd-edit-sched="sched-legacy"]').click();
    await new Promise((r) => setTimeout(r, 10));
    const editSel = doc.getElementById('ag-sched-model');
    assert.equal(editSel.value, 'legacy-custom-id', 'preserves legacy unknown modelId when editing existing task');
    doc.querySelector('[data-ag-pm-close]').click();

    /* 2. Creating new task dynamically lists all enabled models & effort tiers in grouped <optgroup>s */
    doc.querySelector('[data-ag-pd-add-sched]').click();
    await new Promise((r) => setTimeout(r, 10));
    const modelSel = doc.getElementById('ag-sched-model');
    assert.equal(modelSel.querySelectorAll('optgroup').length, 3, 'renders Primary / Orchestrators / Other optgroups');
    const optMap = new Map(Array.from(modelSel.querySelectorAll('option')).map((o) => [o.value, o.textContent]));
    for (const reqId of [
      'gemini-4-neon-low',
      'gemini-4-neon-medium',
      'gemini-4-neon-high',
      'gemini-4-neon-xhigh',
      'claude-opus-5-5-low',
      'claude-opus-5-5-medium',
      'claude-opus-5-5-high',
      'gemini-pro-orchestrator-neon'
    ]) {
      assert.equal(optMap.has(reqId), true, `contains dynamic model ${reqId}`);
    }
    assert.equal(optMap.get('gemini-4-neon-xhigh'), 'Gemini 4 Neon · Extra', 'formats XHigh as Extra');
    assert.equal(optMap.has('legacy-disabled-id'), false, 'filters out disabled models');

    /* 3. Selecting Neon Extra + saving passes gemini-4-neon-xhigh to saveScheduledTask */
    const setVal = (sel, val, ev = 'input') => {
      const el = doc.querySelector(sel);
      el.value = val;
      el.dispatchEvent(new window.Event(ev, { bubbles: true }));
    };
    setVal('#ag-sched-name', 'neon-extra-job');
    setVal('#ag-sched-desc', 'Deep nightly check');
    setVal('#ag-sched-instructions', 'Inspect codebase deeply');
    setVal('#ag-sched-model', 'gemini-4-neon-xhigh', 'change');
    doc.querySelector('[data-ag-sched-save]').click();
    await new Promise((r) => setTimeout(r, 30));
    assert.equal(savedScheduledPayload.task.model, 'gemini-4-neon-xhigh');

    /* 4. Clicking Run Now dispatches modelSelection/modelPicked for task.model (1535) */
    dispatched.length = 0;
    doc.querySelector('[data-ag-pd-run-sched="sched-new"]').click();
    assert.ok(
      dispatched.some((a) => a && a.type === 'modelSelection/modelPicked' && a.payload && a.payload.model === 1535),
      'Run Now syncs selected task model before starting conversation'
    );
  } finally {
    window.close();
  }
});

/* -------------------------------------------------------------------------- */
/* Native pass-through: official features must never be masked by this layer   */
/* -------------------------------------------------------------------------- */

function mountModelMenuDom(apiValue, { triggerText = 'Claude Opus 5.5 · Devin High' } = {}) {
  const customJsSrc = fs.readFileSync(path.join(REPO, 'user', 'custom.js'), 'utf8');
  const dom = new JSDOM(
    `<!doctype html><html><body><div id="root">
      <button type="button" data-testid="model-selector-trigger">${triggerText}</button>
    </div></body></html>`,
    { url: 'https://127.0.0.1:62683/c/c-native', pretendToBeVisual: true, runScripts: 'outside-only' }
  );
  const { window } = dom;
  const btn = window.document.querySelector('button[data-testid="model-selector-trigger"]');
  btn.getBoundingClientRect = () => ({ left: 40, top: 760, right: 240, bottom: 788, width: 200, height: 28 });
  btn.__reactFiber$native = { memoizedProps: { value: apiValue }, return: null };
  window.ctx = { modules: { i18n: false, claudeUxModelMenu: true }, onCleanup: () => {} };
  window.eval(customJsSrc);
  const fire = (type, init = {}) => {
    const ev = new window.MouseEvent(type, { bubbles: true, cancelable: true, button: 0, ...init });
    btn.dispatchEvent(ev);
    return ev;
  };
  return { window, doc: window.document, btn, fire };
}

function thirdPartyOnlyApi(extra = {}) {
  const modelOptions = [
    { label: 'Claude Opus 5.5 · Devin (Medium)', value: 1356, modelId: 'devin/claude-opus-5-5:medium', disabled: false },
    { label: 'Claude Fable 5.2 · Devin (Low)', value: 1349, modelId: 'devin/claude-fable-5-2:low', disabled: false },
    { label: 'Claude Fable 5.2 · Devin (High)', value: 1344, modelId: 'devin/claude-fable-5-2:high', disabled: false },
    { label: 'Claude Opus 5.5 · Devin (High)', value: 1359, modelId: 'devin/claude-opus-5-5:high', disabled: false }
  ];
  const state = { open: false, openCalls: [], selected: modelOptions[3] };
  const api = {
    placement: 'top-start',
    modelOptions,
    customModels: [],
    orchestratorPlanners: [],
    orchestratorPlannerIndex: {},
    bestOfNConfig: { isBestOfNEnabled: false, selectedBestOfNModels: [] },
    get selectedModel() {
      return state.selected;
    },
    setSelectedModel(o) {
      state.selected = o;
    },
    get open() {
      return state.open;
    },
    setIsOpen(v) {
      state.openCalls.push(v);
      state.open = v;
    },
    ...extra
  };
  return { api, state };
}

test('[Native Pass-through · third-party-only account] primary model list is not empty when the account exposes no Gemini family', { skip: skipDom }, () => {
  const { api } = thirdPartyOnlyApi();
  const { window, doc, fire } = mountModelMenuDom(api);
  try {
    fire('pointerdown');
    const mainPop = doc.getElementById('ag-claude-model-popover');
    assert.equal(mainPop.getAttribute('data-open'), 'true');
    assert.deepEqual(
      Array.from(mainPop.querySelectorAll('[data-ag-cm-family]')).map((el) => el.getAttribute('data-ag-cm-family')),
      ['Claude Opus 5.5 · Devin', 'Claude Fable 5.2 · Devin'],
      'non-Gemini families fill "Models · This chat" in native order instead of leaving it empty'
    );
    assert.ok(
      mainPop.querySelector('[data-ag-cm-family="Claude Opus 5.5 · Devin"] .ag-cm-check'),
      'the selected third-party family is checked in the primary list'
    );
  } finally {
    window.close();
  }
});

test('[Native Pass-through · escape hatch] Native menu row and Option+click hand the trigger back to the official menu', { skip: skipDom }, async () => {
  const { api, state } = thirdPartyOnlyApi();
  const { window, doc, fire } = mountModelMenuDom(api);
  try {
    /* 1. Plain click is still taken over by the custom menu, which now carries a Native menu row */
    const plain = fire('pointerdown');
    assert.equal(plain.defaultPrevented, true);
    const mainPop = doc.getElementById('ag-claude-model-popover');
    const nativeRow = mainPop.querySelector('[data-ag-cm-native]');
    assert.ok(nativeRow, 'custom menu exposes a Native menu row');
    assert.equal(nativeRow.hasAttribute('data-ag-cm-native-gaps'), false, 'no hint dot when the native API has nothing extra');

    /* 2. Clicking it closes the custom menu and opens the official one */
    nativeRow.click();
    await new Promise((r) => setTimeout(r, 20));
    assert.equal(mainPop.getAttribute('data-open'), 'false');
    assert.deepEqual(state.openCalls, [true], 'native setIsOpen(true) is called exactly once');

    /* 3. Option/Alt + click is never intercepted (pointerdown, mousedown and click all pass through) */
    state.open = false;
    for (const type of ['pointerdown', 'mousedown', 'click']) {
      const ev = fire(type, { altKey: true, detail: 1 });
      assert.equal(ev.defaultPrevented, false, `${type} with Alt reaches the native trigger`);
    }
    assert.equal(mainPop.getAttribute('data-open'), 'false', 'custom menu stays closed on Alt+click');
  } finally {
    window.close();
  }
});

test('[Native Pass-through · gap detection] unknown native fields flag the Native menu row; Best-of-N mode steps aside entirely', { skip: skipDom }, () => {
  /* soft gap: a future release adds a field this menu does not know -> keep the menu, flag the row */
  {
    const { api } = thirdPartyOnlyApi({ someFutureFeature: { enabled: true } });
    const { window, doc, fire } = mountModelMenuDom(api);
    try {
      fire('pointerdown');
      const row = doc.querySelector('#ag-claude-model-popover [data-ag-cm-native]');
      assert.match(row.getAttribute('data-ag-cm-native-gaps'), /new:someFutureFeature/);
      assert.ok(row.querySelector('.ag-cm-dot'), 'hint dot is rendered');
    } finally {
      window.close();
    }
  }
  /* known soft gap: the agent selector lives in the native footer (footerExtra) -> "More options", no drift dot */
  {
    const { api } = thirdPartyOnlyApi({ footerExtra: { type: 'AgentSelector' } });
    const { window, doc, fire } = mountModelMenuDom(api);
    try {
      fire('pointerdown');
      const row = doc.querySelector('#ag-claude-model-popover [data-ag-cm-native]');
      assert.equal(row.getAttribute('data-ag-cm-native-gaps'), 'footerExtra');
      assert.match(row.textContent, /More options/);
      assert.equal(row.querySelector('.ag-cm-dot'), null, 'known gaps do not raise the release-drift dot');
    } finally {
      window.close();
    }
  }
  /* hard gap: Best-of-N turns the native menu into a multi-select this menu cannot drive */
  {
    const { api } = thirdPartyOnlyApi({ bestOfNConfig: { isBestOfNEnabled: true, selectedBestOfNModels: [] } });
    const { window, doc, fire } = mountModelMenuDom(api);
    try {
      const ev = fire('pointerdown');
      assert.equal(ev.defaultPrevented, false, 'trigger click is left to the native menu');
      const mainPop = doc.getElementById('ag-claude-model-popover');
      assert.ok(!mainPop || mainPop.getAttribute('data-open') !== 'true', 'custom menu does not open');
    } finally {
      window.close();
    }
  }
});

test('[Native Pass-through · sidebar] Coordinators section above Pinned is never used as the hide cut-off', { skip: skipDom }, () => {
  const customJsSrc = fs.readFileSync(path.join(REPO, 'user', 'custom.js'), 'utf8');
  const dom = new JSDOM(
    `<!doctype html><html><body>
      <div class="bg-sidebar">
        <div data-testid="conversation-list-sidebar">
          <div class="w-full relative" style="height: 400px;">
            <div data-index="0" style="position: sticky; top: 0px;"><div data-testid="section-header" data-title="Coordinators"><div data-testid="coordinator-section-header">协调者</div></div></div>
            <div data-index="1" style="position: absolute; transform: translateY(24px);"><div data-testid="conversation-row-sidebar"><a href="/c/c-coord-1"></a></div></div>
            <div data-index="2" style="position: absolute; transform: translateY(69px);"><div data-testid="section-header" data-title="Pinned"><div data-testid="pinned-section-header">置顶对话</div></div></div>
            <div data-index="3" style="position: absolute; transform: translateY(93px);"><div data-testid="conversation-row-sidebar" data-pinned="true"><a href="/c/c-pin-1"></a></div></div>
            <div data-index="4" style="position: absolute; transform: translateY(138px);"><div data-testid="section-header" data-title="Conversations">对话</div></div>
            <div data-index="5" style="position: absolute; transform: translateY(162px);"><div data-testid="conversation-row-sidebar"><a href="/c/c-plain-1"></a></div></div>
          </div>
        </div>
      </div>
    </body></html>`,
    { url: 'http://127.0.0.1/', pretendToBeVisual: true, runScripts: 'outside-only' }
  );
  const { window } = dom;
  const doc = window.document;
  window.ctx = { modules: { i18n: true, claudeUxHideSidebarProjects: true }, onCleanup: () => {} };
  window.eval(customJsSrc);
  try {
    const hidden = (i) => doc.querySelector(`[data-index="${i}"]`).getAttribute('data-ag-sb-hide-proj') === '1';
    assert.deepEqual(
      [0, 1, 2, 3, 4, 5].map(hidden),
      [false, false, false, false, true, true],
      'Coordinators + Pinned stay visible; only the native Conversations section is folded into Recents'
    );
  } finally {
    window.close();
  }
});

/* -------------------------------------------------------------------------- */
/* 2026-11-21 Comprehensive Audit Bug-Fix Regression Tests                    */
/* -------------------------------------------------------------------------- */

test('[Audit-2026-11-21 · Installer] preserves backup on corrupt state, respects statusLine on re-install, spares native ac-* sidecars, keeps symlink/mode, valid Win VBS', async () => {
  const installer = await import(pathToFileURL(path.join(REPO, 'install.mjs')).href);

  /* Bug #36: Windows VBS quoting for space + CJK username */
  const vbs = installer.buildWinStartupVbs(
    'C:\\Program Files\\nodejs\\node.exe',
    'C:\\Users\\张三\\Anti-Claude\\core\\daemon.mjs',
    'C:\\Users\\张三\\.gemini\\user'
  );
  assert.doesNotMatch(vbs, /""""/, 'VBS does not double-escape quotes into invalid quadruple quotes');
  assert.match(vbs, /ChrW\(24352\)/, 'VBS encodes CJK characters with ChrW()');
  assert.match(vbs, /sh\.Run "/, 'VBS emits clean WScript.Shell Run invocation');

  const h = makeSandboxHome();
  try {
    /* Pre-existing user CSS and symlinked AGENTS.md with 0600 permissions */
    const agyUserDir = path.join(h.home, '.gemini', 'antigravity', 'anti-claude', 'user');
    fs.mkdirSync(agyUserDir, { recursive: true });
    fs.writeFileSync(path.join(agyUserDir, 'custom.css'), '/* original user css */\n', 'utf8');

    const realAgents = path.join(h.home, 'real-AGENTS.md');
    fs.writeFileSync(realAgents, '# Personal Rules\n', { mode: 0o600 });
    fs.chmodSync(realAgents, 0o600);
    fs.rmSync(path.join(h.home, '.gemini', 'AGENTS.md'), { force: true });
    fs.symlinkSync(realAgents, path.join(h.home, '.gemini', 'AGENTS.md'));

    /* Official automation whose folder happens to start with ac- (no created_by: 'anti-claude') */
    const nativeAcSidecar = path.join(h.home, '.gemini', 'config', 'sidecars', 'ac-official-report');
    fs.mkdirSync(nativeAcSidecar, { recursive: true });
    fs.writeFileSync(
      path.join(nativeAcSidecar, 'sidecar.json'),
      JSON.stringify({ builtin: 'schedule', display_name: 'Official AC Job', args: ['0 9 * * *'] })
    );
    const oursSidecar = path.join(h.home, '.gemini', 'config', 'sidecars', 'ac-ours-task');
    fs.mkdirSync(oursSidecar, { recursive: true });
    fs.writeFileSync(
      path.join(oursSidecar, 'sidecar.json'),
      JSON.stringify({ builtin: 'schedule', created_by: 'anti-claude', display_name: 'Ours', args: ['0 9 * * *'] })
    );

    /* CLI settings setup */
    const cliDir = path.join(h.home, '.gemini', 'antigravity-cli');
    fs.mkdirSync(cliDir, { recursive: true });
    fs.writeFileSync(path.join(cliDir, 'settings.json'), JSON.stringify({ toolPermission: 'ask' }, null, 2));

    const inst1 = runInstallCli(h.home, ['install', '--cli']);
    assert.equal(inst1.status, 0, inst1.stderr);

    /* Bug #35: symlink & 0600 mode preserved on AGENTS.md */
    const agentsPath = path.join(h.home, '.gemini', 'AGENTS.md');
    assert.equal(fs.lstatSync(agentsPath).isSymbolicLink(), true, 'AGENTS.md symlink preserved');
    assert.equal(fs.statSync(realAgents).mode & 0o777, 0o600, 'AGENTS.md target 0600 mode preserved');

    /* Bug #6: User sets custom statusLine, then re-runs install -> custom statusLine must be respected */
    const customSettings = JSON.parse(fs.readFileSync(path.join(cliDir, 'settings.json'), 'utf8'));
    customSettings.statusLine = { type: 'command', command: '/usr/local/bin/user-custom-sl', enabled: true };
    fs.writeFileSync(path.join(cliDir, 'settings.json'), JSON.stringify(customSettings, null, 2));

    const inst2 = runInstallCli(h.home, ['install', '--cli']);
    assert.equal(inst2.status, 0, inst2.stderr);
    assert.equal(
      JSON.parse(fs.readFileSync(path.join(cliDir, 'settings.json'), 'utf8')).statusLine.command,
      '/usr/local/bin/user-custom-sl',
      're-running install preserves user custom statusLine'
    );

    /* Bug #5: Corrupt install-state.json -> re-running install must NOT overwrite original backup/custom.css */
    const stateFile = path.join(h.home, '.gemini', 'antigravity', 'anti-claude', 'install-state.json');
    fs.writeFileSync(stateFile, '{corrupt json', 'utf8');
    const inst3 = runInstallCli(h.home, ['install']);
    assert.equal(inst3.status, 0, inst3.stderr);
    const bakCss = fs.readFileSync(
      path.join(h.home, '.gemini', 'antigravity', 'anti-claude', 'backup', 'custom.css'),
      'utf8'
    );
    assert.equal(bakCss, '/* original user css */\n', 'pre-install backup survives corrupt install-state.json');

    /* Bug #3: Uninstall deletes anti-claude sidecar but spares native ac-* sidecar */
    const un = runInstallCli(h.home, ['uninstall']);
    assert.equal(un.status, 0, un.stderr);
    assert.equal(fs.existsSync(nativeAcSidecar), true, 'official ac-* sidecar is NOT deleted on uninstall');
    assert.equal(fs.existsSync(oursSidecar), false, 'anti-claude owned sidecar is removed on uninstall');
  } finally {
    h.cleanup();
  }
});

test('[Audit-2026-11-21 · Daemon Security & CDP] blocks symlink/case bypasses, sensitive file copy, spoofed Electron host, forged repo sidecarId; restores all 3 bindings on reload', async () => {
  const daemon = await import(pathToFileURL(path.join(REPO, 'core', 'daemon.mjs')).href);

  /* Bug #38: Case-insensitive & symlink bypasses */
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ac-sec-2026-'));
  try {
    const fakeSshTarget = path.join(os.homedir(), '.ssh');
    if (process.platform === 'darwin') {
      assert.equal(daemon.isSafeProjectDir(os.homedir().toLowerCase()), false, 'lowercase HOME rejected on macOS');
      assert.equal(daemon.isSafeProjectDir(path.join(os.homedir(), '.SSH')), false, 'uppercase .SSH rejected on macOS');
    }
    assert.equal(daemon.isSensitiveSourcePath(path.join(os.homedir(), '.ssh', 'id_ed25519')), true);

    const projDir = path.join(tmpRoot, 'safe-proj');
    fs.mkdirSync(projDir, { recursive: true });
    const fakeKeyFile = path.join(tmpRoot, 'id_ed25519');
    fs.writeFileSync(fakeKeyFile, 'PRIVATE KEY');
    const saved = daemon.saveProjectContext(
      {
        dirPath: projDir,
        files: [{ action: 'add', sourcePath: fakeKeyFile, name: 'id_ed25519' }]
      },
      { registryFile: null }
    );
    assert.equal(saved.ok, true);
    assert.equal(saved.files.length, 0, 'sensitive key file refused by saveProjectContext add');

    if (fs.existsSync(fakeSshTarget)) {
      const symToSsh = path.join(tmpRoot, 'innocent-link');
      fs.symlinkSync(fakeSshTarget, symToSsh);
      assert.equal(daemon.isSafeProjectDir(symToSsh), false, 'symlink pointing to ~/.ssh is rejected');
    }

    /* Suspicious #22: Cloned repo claiming a foreign sidecarId in project-context.json cannot delete it */
    const sidecarsDir = path.join(tmpRoot, 'sidecars');
    const victimDir = path.join(tmpRoot, 'victim-proj');
    fs.mkdirSync(victimDir, { recursive: true });
    const victimScDir = path.join(sidecarsDir, 'victim-job');
    fs.mkdirSync(victimScDir, { recursive: true });
    fs.writeFileSync(
      path.join(victimScDir, 'sidecar.json'),
      JSON.stringify({
        builtin: 'schedule',
        display_name: 'Victim',
        args: ['0 9 * * *', 'agentapi', 'new-conversation', '--', 'hi'],
        agent_permissions: { workspace_uris: [pathToFileURL(victimDir).href] }
      })
    );
    const clonedDir = path.join(tmpRoot, 'cloned-malicious');
    fs.mkdirSync(path.join(clonedDir, '.anti-claude'), { recursive: true });
    fs.writeFileSync(
      path.join(clonedDir, '.anti-claude', 'project-context.json'),
      JSON.stringify({
        schema: 1,
        scheduledTasks: [{ id: 'forged', name: 'Forged', sidecarId: 'victim-job' }]
      })
    );
    const delForged = daemon.deleteProjectScheduledTask(
      { dirPath: clonedDir, taskId: 'forged', sidecarId: 'victim-job' },
      { sidecarsDir }
    );
    assert.equal(delForged.ok, false);
    assert.equal(delForged.error, 'sidecar_not_in_project');
    assert.equal(fs.existsSync(victimScDir), true, 'victim sidecar untouched when cloned repo forges sidecarId');
  } finally {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }

  /* Bug #37: Electron-UA localhost page spoofing __APP_CONFIG__ & data-agy-theme is rejected */
  if (JSDOM) {
    const spoofEl = new JSDOM('<!doctype html><body data-agy-theme="dark"></body>', {
      runScripts: 'outside-only',
      url: 'http://127.0.0.1:3000/',
      userAgent: 'Mozilla/5.0 Antigravity/2.34.0 Chrome/152.0.0.0 Electron/44.9.1 Safari/537.36'
    });
    spoofEl.window.__APP_CONFIG__ = { productName: 'antigravity' };
    assert.equal(
      spoofEl.window.eval(daemon.HOST_IDENTITY_PROBE_EXPR),
      'non_host',
      'spoofed __APP_CONFIG__ and data-agy-theme in Electron webview is rejected'
    );
    spoofEl.window.close();
  }

  /* Bug #32 & Suspicious #19: reload re-binds all 3 bindings; stale socket close does not delete newer entry */
  const realWS = globalThis.WebSocket;
  daemon.rebuildBundleIfNeeded();
  daemon.attachedTargets.clear();
  daemon.skippedNonHostTargets.clear();
  const sockets = [];
  const addedBindings = [];

  class ReloadFakeSocket extends EventTarget {
    static OPEN = 1;
    constructor() {
      super();
      this.readyState = 1;
      sockets.push(this);
      queueMicrotask(() => this.dispatchEvent(new Event('open')));
    }
    emitEvent(method, params) {
      this.dispatchEvent(new MessageEvent('message', { data: JSON.stringify({ method, params }) }));
    }
    send(raw) {
      const { id, method, params } = JSON.parse(raw);
      const reply = (result = {}) =>
        this.dispatchEvent(new MessageEvent('message', { data: JSON.stringify({ id, result }) }));
      queueMicrotask(() => {
        if (method === 'Page.getFrameTree') reply({ frameTree: { frame: { id: 'f-main' } } });
        else if (method === 'Runtime.enable') {
          this.emitEvent('Runtime.executionContextCreated', {
            context: { id: 10, origin: 'https://127.0.0.1:60000', auxData: { frameId: 'f-main', isDefault: true } }
          });
          reply({});
        } else if (method === 'Runtime.addBinding') {
          addedBindings.push(params.name);
          reply({});
        } else if (method === 'Runtime.evaluate' && String(params.expression).includes("return 'swarm'")) {
          reply({ result: { value: 'host' } });
        } else reply({ result: { value: 'dark' } });
      });
    }
    close() {
      this.readyState = 3;
      this.dispatchEvent(new Event('close'));
    }
  }

  try {
    globalThis.WebSocket = ReloadFakeSocket;
    const fakePage = {
      id: 'reload-target-1',
      type: 'page',
      url: 'https://127.0.0.1:60000/c/11111111-1111-1111-1111-111111111111',
      webSocketDebuggerUrl: 'ws://127.0.0.1:60000/devtools/page/reload-target-1'
    };
    const ep = { channel: 'test', portFile: '', fallbackPort: 0, conversationsDir: os.tmpdir() };
    await daemon.attachTarget(fakePage, ep);
    addedBindings.length = 0;

    /* Trigger top-level navigation reload */
    sockets[0].emitEvent('Page.frameNavigated', { frame: { id: 'f-main', url: fakePage.url } });
    sockets[0].emitEvent('Runtime.executionContextCreated', {
      context: { id: 20, origin: 'https://127.0.0.1:60000', auxData: { frameId: 'f-main', isDefault: true } }
    });
    await new Promise((r) => setTimeout(r, 120));
    assert.deepEqual(
      addedBindings.sort(),
      ['__agProjectRpc', '__agRequestMetrics', '__agSyncHostThemeMode'],
      'all 3 Runtime bindings are restored after top-level reload'
    );

    /* Replace target with a newer socket, then fire delayed close on old socket */
    const firstSock = sockets[0];
    await daemon.attachTarget(fakePage, ep);
    const newerEntry = daemon.attachedTargets.get(fakePage.id);
    firstSock.close();
    assert.equal(daemon.attachedTargets.get(fakePage.id), newerEntry, 'delayed close on old socket preserves newer entry');
  } finally {
    for (const [, e] of daemon.attachedTargets.entries()) {
      try {
        e.ws.close();
      } catch {}
    }
    daemon.attachedTargets.clear();
    globalThis.WebSocket = realWS;
  }
});

test('[Audit-2026-11-21 · Projects UI] aborts save when readContext fails, renders Sunday correctly, escapes search XSS, requires confirm on task delete, disambiguates same-name @ mentions, keeps skill modal alive when Projects off', { skip: skipDom }, async () => {
  const customJsSrc = fs.readFileSync(path.join(REPO, 'user', 'custom.js'), 'utf8');
  const dom = new JSDOM(
    `<!doctype html><html><body>
      <div id="root">
        <div class="bg-sidebar">
          <button data-testid="automations-button">Automations</button>
          <div data-testid="conversation-list-sidebar"><div class="w-full relative"></div></div>
        </div>
        <main>
          <div data-testid="customizations-page">
            <div class="sticky top-0"><div><input data-testid="customizations-search" type="search" /></div></div>
            <div>
              <section><div><h3>Skills &amp; Rules</h3><button data-testid="skills-rules-filter">All</button></div></section>
            </div>
          </div>
        </main>
      </div>
    </body></html>`,
    { url: 'https://127.0.0.1:62683/customizations/installed', pretendToBeVisual: true, runScripts: 'outside-only' }
  );
  const { window } = dom;
  const doc = window.document;
  const projDir = '/tmp/proj-audit-ui';
  const state = {
    sidebarProjects: {
      projects: [{ id: 'p-1', name: 'Alpha Case', folderUris: [pathToFileURL(projDir).href], archived: false }]
    },
    trajectorySummaries: { summaries: {}, indexes: { byProject: {} } }
  };
  const mockStore = { getState: () => state, subscribe: () => () => {}, dispatch: () => {} };
  const mockRpcSvc = {
    findFiles: async () => ({
      uris: [
        {
          absoluteUri: pathToFileURL(path.join(projDir, 'src/a/index.ts')).href,
          workspaceUrisToRelativePaths: { [pathToFileURL(projDir).href]: 'src/a/index.ts' },
          numFiles: 1
        },
        {
          absoluteUri: pathToFileURL(path.join(projDir, 'src/b/index.ts')).href,
          workspaceUrisToRelativePaths: { [pathToFileURL(projDir).href]: 'src/b/index.ts' },
          numFiles: 1
        }
      ]
    })
  };
  doc.querySelector('.bg-sidebar').__reactFiber$u = {
    memoizedProps: { sidebarStore: mockStore },
    dependencies: {
      firstContext: { memoizedValue: { store: mockStore }, next: { memoizedValue: mockRpcSvc, next: null } }
    },
    return: null
  };

  const mockCtxFiles = [
    { name: 'index.ts', relPath: 'src/a/index.ts', absPath: path.join(projDir, 'src/a/index.ts'), size: 120 },
    { name: 'index.ts', relPath: 'src/b/index.ts', absPath: path.join(projDir, 'src/b/index.ts'), size: 140 }
  ];
  const mockSchedTasks = [
    {
      id: 't-sun',
      name: 'Sunday Digest',
      description: 'Weekly review',
      instructions: 'Summarize week',
      frequency: 'weekly',
      dayOfWeek: 0,
      time: '10:00',
      externalSidecar: true
    }
  ];
  let saveContextCalls = 0;
  let deleteTaskCalls = 0;
  let readShouldFail = false;
  window.__agProjectCall = async (action, payload) => {
    if (action === 'listContexts') {
      return {
        ok: true,
        contexts: {
          [projDir]: {
            ok: true,
            dirPath: projDir,
            instructions: 'Keep me',
            files: mockCtxFiles,
            extraFolders: [],
            scheduledTasks: mockSchedTasks
          }
        }
      };
    }
    if (action === 'readContext') {
      if (readShouldFail || payload?.dirPath === '/tmp/proj-timeout-case') return { ok: false, error: 'timeout' };
      return {
        ok: true,
        dirPath: projDir,
        instructions: 'Keep me',
        files: mockCtxFiles,
        extraFolders: [],
        scheduledTasks: mockSchedTasks
      };
    }
    if (action === 'saveContext') {
      saveContextCalls += 1;
      return { ok: true, dirPath: projDir, instructions: '', files: [], extraFolders: [], scheduledTasks: [] };
    }
    if (action === 'deleteScheduledTask') {
      deleteTaskCalls += 1;
      return { ok: true, dirPath: projDir, instructions: 'Keep me', files: [], extraFolders: [], scheduledTasks: [] };
    }
    if (action === 'pickFolder') {
      return { ok: true, folderPath: '/tmp/other-folder', name: 'other-folder' };
    }
    return { ok: true };
  };

  window.ctx = {
    modules: { i18n: false, claudeUxProjects: true, claudeUxCustomizations: true, claudeUxHideSidebarProjects: false },
    onCleanup: () => {}
  };
  window.eval(customJsSrc);

  try {
    /* Open Projects -> verify XSS search escaping (Bug #39) */
    doc.getElementById('ag-claude-projects-nav-btn').click();
    await new Promise((r) => setTimeout(r, 30));
    const searchInput = doc.getElementById('ag-proj-search-input');
    searchInput.value = '<img id="xss-probe" src=x>';
    searchInput.dispatchEvent(new window.Event('input', { bubbles: true }));
    assert.equal(doc.getElementById('xss-probe'), null, 'search empty state escapes HTML markup');
    searchInput.value = '';
    searchInput.dispatchEvent(new window.Event('input', { bubbles: true }));

    /* Enter project -> verify Sunday display (Bug #40) & 2-step delete confirm (Bug #2) */
    doc.querySelector('.ag-proj-card').click();
    await new Promise((r) => setTimeout(r, 40));
    const schedHtml = doc.querySelector('.ag-pd-sched-list')?.textContent || '';
    assert.match(schedHtml, /Weekly Sun/, 'dayOfWeek=0 renders as Sunday, not Monday');

    const delBtn = doc.querySelector('[data-ag-pd-del-sched="t-sun"]');
    delBtn.click();
    assert.equal(deleteTaskCalls, 0, 'first click on task delete arms confirmation without deleting immediately');
    assert.equal(delBtn.getAttribute('data-confirm'), '1');

    /* Bug #8: Same-name files src/a/index.ts and src/b/index.ts get distinct mention tokens */
    const comp = doc.getElementById('ag-pd-composer-input');
    comp.value = '@files:index';
    comp.selectionStart = comp.value.length;
    comp.dispatchEvent(new window.Event('input', { bubbles: true }));
    await new Promise((r) => setTimeout(r, 40));
    const rows1 = doc.querySelectorAll('#ag-pd-mention-popover .ag-pd-mention-row');
    assert.equal(rows1.length, 2);
    rows1[0].dispatchEvent(new window.MouseEvent('mousedown', { bubbles: true, cancelable: true }));

    comp.value += '@files:index';
    comp.selectionStart = comp.value.length;
    comp.dispatchEvent(new window.Event('input', { bubbles: true }));
    await new Promise((r) => setTimeout(r, 40));
    const rows2 = doc.querySelectorAll('#ag-pd-mention-popover .ag-pd-mention-row');
    rows2[1].dispatchEvent(new window.MouseEvent('mousedown', { bubbles: true, cancelable: true }));
    const pills = doc.querySelectorAll('#ag-pd-mention-pills .ag-pd-mention-pill');
    assert.equal(pills.length, 2, 'two same-named files produce two distinct mention pills without overwriting');
    const pillTokens = Array.from(pills).map((el) => el.getAttribute('data-ag-pd-pill-tok'));
    assert.notEqual(pillTokens[0], pillTokens[1], 'same-name files receive distinct disambiguated tokens');

    /* Bug #1: readContext timeout on uncached project aborts saveContext instead of wiping attachments */
    state.sidebarProjects.projects.push({
      id: 'p-timeout',
      name: 'Timeout Case',
      folderUris: [pathToFileURL('/tmp/proj-timeout-case').href],
      archived: false
    });
    doc.querySelector('[data-ag-pd-back]').click();
    await new Promise((r) => setTimeout(r, 20));
    doc.querySelector('.ag-proj-card[data-ag-proj-id="p-timeout"]').click();
    await new Promise((r) => setTimeout(r, 30));
    doc.querySelector('[data-ag-pd-folder-toggle]').click();
    doc.querySelector('[data-ag-pd-add-folder]').click();
    await new Promise((r) => setTimeout(r, 40));
    assert.equal(saveContextCalls, 0, 'saveContext is never called when readContext fails/times out');

    /* Bug #23: Even when Projects feature is disabled, Add Skill modal survives sync cycles and closes on Escape */
    doc.getElementById('ag-claude-projects-nav-btn').click(); // back to grid
    doc.getElementById('ag-claude-projects-nav-btn').click(); // close projects view
    doc.getElementById('ag-cust-add-skill-btn').click();
    assert.ok(doc.getElementById('ag-claude-project-modal'), 'Add skill modal opened');
    const escEv = new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
    doc.dispatchEvent(escEv);
    assert.equal(doc.getElementById('ag-claude-project-modal'), null, 'Escape closes Add Skill modal');
  } finally {
    window.close();
  }

  /* Bug #23 dedicated test: claudeUxProjects: false must NOT destroy Add Skill modal across sync ticks and Escape works */
  const domOff = new JSDOM(
    `<!doctype html><html><body>
      <div id="root">
        <div class="sticky top-0"><div><input data-testid="customizations-search" type="search" /></div></div>
        <div><section><div><h3>Skills &amp; Rules</h3><button data-testid="skills-rules-filter">All</button></div></section></div>
      </div>
    </body></html>`,
    { url: 'https://127.0.0.1:62683/customizations/installed', pretendToBeVisual: true, runScripts: 'outside-only' }
  );
  domOff.window.ctx = { modules: { i18n: false, claudeUxProjects: false, claudeUxCustomizations: true }, onCleanup: () => {} };
  domOff.window.eval(customJsSrc);
  try {
    const docOff = domOff.window.document;
    docOff.getElementById('ag-cust-add-skill-btn').click();
    assert.ok(docOff.getElementById('ag-claude-project-modal'), 'Add skill modal opens with Projects off');
    /* Trigger a DOM mutation to invoke syncStepStream -> syncProjectsWorkspace */
    const ping = docOff.createElement('span');
    docOff.body.appendChild(ping);
    await new Promise((r) => setTimeout(r, 120));
    assert.ok(docOff.getElementById('ag-claude-project-modal'), 'Add skill modal survives sync ticks with Projects disabled');
    docOff.dispatchEvent(new domOff.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    assert.equal(docOff.getElementById('ag-claude-project-modal'), null, 'Escape closes Add skill modal even when Projects is disabled');
  } finally {
    domOff.window.close();
  }
});

test('[Audit-2026-11-21 · Model Menu & Pill] Option+click works on fallback path, customCss:false skips hijack, 1-5 ignored in input, pill restore keeps streamed suffix, checklists stay native', { skip: skipDom }, async () => {
  const customJsSrc = fs.readFileSync(path.join(REPO, 'user', 'custom.js'), 'utf8');

  /* Bug #13 & #19: Redux fallback path still allows Option+click and renders Native menu row; 1-5 ignored when input focused */
  {
    const dom = new JSDOM(
      `<!doctype html><html><body><div id="root">
        <div class="bg-sidebar"><div data-testid="conversation-list-sidebar"><div class="w-full relative"></div></div></div>
        <div id="antigravity.agentSidePanelInputBox">
          <div contenteditable="true" id="chat-ed">hello</div>
          <button type="button" data-testid="model-selector-trigger">Gemini 4 Neon High</button>
        </div>
      </div></body></html>`,
      { url: 'https://127.0.0.1:62683/c/c-fb', pretendToBeVisual: true, runScripts: 'outside-only' }
    );
    const { window } = dom;
    const doc = window.document;
    const mockStore = {
      getState: () => ({
        userStatus: {
          cascadeModelConfigData: {
            clientModelConfigs: [
              { label: 'Gemini 4 Neon (High)', value: 1 },
              { label: 'Gemini 4 Argon (High)', value: 2 },
              { label: 'Gemini 4 Carbon (High)', value: 3 }
            ]
          }
        },
        modelSelection: {
          default: { model: 1 }
        },
        trajectorySummaries: { summaries: {} },
        sidebarProjects: { projects: [] }
      }),
      subscribe: () => () => {},
      dispatch: () => {}
    };
    doc.querySelector('.bg-sidebar').__reactFiber$s = { memoizedProps: { sidebarStore: mockStore }, return: null };
    const btn = doc.querySelector('button[data-testid="model-selector-trigger"]');
    btn.getBoundingClientRect = () => ({ left: 40, top: 760, right: 240, bottom: 788, width: 200, height: 28 });

    window.ctx = { config: { modules: { customCss: true } }, modules: { i18n: false, claudeUxModelMenu: true }, onCleanup: () => {} };
    window.eval(customJsSrc);
    try {
      /* Option+click on Redux fallback path must NOT be prevented */
      const altEv = new window.MouseEvent('pointerdown', { bubbles: true, cancelable: true, button: 0, altKey: true });
      btn.dispatchEvent(altEv);
      assert.equal(altEv.defaultPrevented, false, 'Option+click passes through even on Redux fallback path');

      /* Plain click opens custom menu with Native menu row */
      btn.dispatchEvent(new window.MouseEvent('pointerdown', { bubbles: true, cancelable: true, button: 0 }));
      const pop = doc.getElementById('ag-claude-model-popover');
      assert.equal(pop.getAttribute('data-open'), 'true');
      assert.ok(pop.querySelector('[data-ag-cm-native]'), 'Native menu row rendered even on Redux fallback path');

      /* Bug #19: Focusing editable composer and typing '2' must NOT be swallowed by open model menu */
      const ed = doc.getElementById('chat-ed');
      ed.focus();
      Object.defineProperty(doc, 'activeElement', { value: ed, configurable: true });
      const key2 = new window.KeyboardEvent('keydown', { key: '2', bubbles: true, cancelable: true });
      ed.dispatchEvent(key2);
      assert.equal(key2.defaultPrevented, false, 'digit key 2 inside composer is not swallowed by open model menu');
    } finally {
      window.close();
    }
  }

  /* Bug #24: customCss: false disables model trigger interception */
  {
    const { api } = thirdPartyOnlyApi();
    const dom = new JSDOM(
      `<!doctype html><html><body><div id="root"><button type="button" data-testid="model-selector-trigger">Model</button></div></body></html>`,
      { url: 'https://127.0.0.1:62683/c/c-nocss', pretendToBeVisual: true, runScripts: 'outside-only' }
    );
    const { window } = dom;
    const btn = window.document.querySelector('button[data-testid="model-selector-trigger"]');
    btn.__reactFiber$n = { memoizedProps: { value: api }, return: null };
    window.ctx = { config: { modules: { customCss: false } }, modules: { claudeUxModelMenu: true }, onCleanup: () => {} };
    window.eval(customJsSrc);
    try {
      const ev = new window.MouseEvent('pointerdown', { bubbles: true, cancelable: true, button: 0 });
      btn.dispatchEvent(ev);
      assert.equal(ev.defaultPrevented, false, 'model menu does not hijack trigger when customCss is false');
    } finally {
      window.close();
    }
  }

  /* Bug #11 & Bug #10: Pill restore preserves streamed text suffix; unrelated all-[x] list after interrupted todo stays visible */
  {
    const dom = new JSDOM(
      `<!doctype html><html><body><div id="root">
        <div data-testid="conversation-view">
          <div data-testid="agent-response" id="turn-1">
            <ul class="contains-task-list">
              <li><input type="checkbox" checked /> Step A</li>
              <li>[/] Step B</li>
              <li><input type="checkbox" /> Step C</li>
            </ul>
          </div>
          <div data-testid="agent-response" id="turn-2">
            <div data-markdown-root><p><code>foo</code> ，开头</p></div>
            <ul class="contains-task-list" id="ordinary-checked">
              <li><input type="checkbox" checked /> Buy milk</li>
              <li><input type="checkbox" checked /> Walk dog</li>
            </ul>
          </div>
          <div id="antigravity.agentSidePanelInputBox"></div>
        </div>
      </div></body></html>`,
      { url: 'https://127.0.0.1:62683/c/c-pill', pretendToBeVisual: true, runScripts: 'outside-only' }
    );
    const { window } = dom;
    const doc = window.document;
    window.ctx = { modules: { i18n: false }, onCleanup: () => {} };
    window.eval(customJsSrc);
    try {
      /* Ordinary checklists remain native and untouched */
      const ordinaryUl = doc.getElementById('ordinary-checked');
      assert.equal(ordinaryUl.hasAttribute('data-ag-todo-merged'), false, 'ordinary checklist stays native and visible');

      /* Bug #11: simulate streaming appending more text to the text node after <code> */
      const codeEl = doc.querySelector('code');
      const fol = codeEl.nextSibling;
      assert.equal(fol.nodeValue, '\u2060，开头');
      fol.nodeValue = '\u2060，开头之后流式追加了很长一段重要内容';
      window.__agClaudeUxDispose();
      assert.equal(
        fol.nodeValue,
        ' ，开头之后流式追加了很长一段重要内容',
        'dispose restores boundary whitespace/WJ without truncating streamed suffix'
      );
    } finally {
      window.close();
    }
  }
});

test('[Audit-2026-11-21 · Sidebar & Settings Safety] refuses to hide sidebar or lock scroll when Recents fails to mount; settings CSS guard leaves drifted headers visible', { skip: skipDom }, () => {
  const customJsSrc = fs.readFileSync(path.join(REPO, 'user', 'custom.js'), 'utf8');
  const customCssSrc = fs.readFileSync(path.join(REPO, 'user', 'custom.css'), 'utf8');

  /* Bug #17: CSS FOUC shield must be gated on data-ag-stats-ready="1" */
  assert.match(
    customCssSrc,
    /\[data-testid="settings-sidebar"\]\[data-ag-stats-ready="1"\]/,
    'settings sidebar CSS hide rules are gated by JS data-ag-stats-ready flag'
  );
  /* Settings panel switches must match Antigravity native h-6 w-11 (44x24px) & thumb h-4 w-4 (16x16px, 4px/24px) */
  assert.match(
    customCssSrc,
    /#ag-claude-ux-settings-panel\s+\.ag-claude-switch\s*\{[^}]*width:\s*44px\s*!important;[^}]*height:\s*24px\s*!important;/s,
    'UI Enhancements settings switches match native 44x24px size'
  );
  assert.match(
    customCssSrc,
    /#ag-claude-ux-settings-panel\s+\.ag-claude-switch\[aria-checked="true"\]\s*>\s*span\s*\{[^}]*translateX\(24px\)/s,
    'UI Enhancements settings switch checked thumb offset matches native 24px'
  );

  /* Bug #12 & #18: On a React host (#root present) where sidebar store cannot be found, native rows stay visible and scrollTop is not forced to 0 */
  const dom = new JSDOM(
    `<!doctype html><html><body><div id="root">
      <div class="bg-sidebar">
        <div data-testid="conversation-list-sidebar">
          <div class="w-full relative" style="height: 400px;">
            <div data-index="0"><div data-testid="section-header" data-title="Conversations">Conversations</div></div>
            <div data-index="1"><div data-testid="conversation-row-sidebar"><a href="/c/c-1">Chat 1</a></div></div>
          </div>
        </div>
      </div>
      <div data-testid="settings-sidebar">
        <div class="px-4 mt-2"><h2>Renamed Unknown Section</h2></div>
        <div class="flex flex-col gap-0.5"><button>Item 1</button></div>
      </div>
    </div></body></html>`,
    { url: 'https://127.0.0.1:62683/c/c-1', pretendToBeVisual: true, runScripts: 'outside-only' }
  );
  const { window } = dom;
  const doc = window.document;
  const scrollBox = doc.querySelector('[data-testid="conversation-list-sidebar"]');
  scrollBox.scrollTop = 120;

  window.ctx = { modules: { i18n: false, claudeUxHideSidebarProjects: true }, onCleanup: () => {} };
  window.eval(customJsSrc);
  try {
    assert.equal(doc.querySelector('[data-index="1"]').hasAttribute('data-ag-sb-hide-proj'), false, 'native rows stay visible when Recents cannot mount');
    assert.equal(scrollBox.scrollTop, 120, 'scrollTop is not locked to 0 when unified Recents is not active');
    assert.equal(
      doc.querySelector('[data-testid="settings-sidebar"]').hasAttribute('data-ag-stats-ready'),
      false,
      'drifted settings sidebar does not activate CSS hide shield'
    );
  } finally {
    window.close();
  }
});

test('[claudeUxOverviewPanel] collectOverviewSnapshot reads local config safely without leaking secrets', async () => {
  const daemon = await import(pathToFileURL(path.join(REPO, 'core', 'daemon.mjs')).href);
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ac-ov-snap-'));
  const homeDir = path.join(tmpRoot, 'home');
  const geminiDir = path.join(homeDir, '.gemini');
  const configDir = path.join(geminiDir, 'config');
  const skillsDir = path.join(configDir, 'skills');
  const agentsDir = path.join(configDir, 'agents');
  const builtinSkillsDir = path.join(geminiDir, 'antigravity', 'builtin', 'skills');
  const projDir = path.join(tmpRoot, 'demo-proj');

  try {
    fs.mkdirSync(path.join(skillsDir, 'demo-skill'), { recursive: true });
    fs.writeFileSync(path.join(skillsDir, 'demo-skill', 'SKILL.md'), '# Demo Skill\n');
    fs.mkdirSync(path.join(builtinSkillsDir, 'builtin-one'), { recursive: true });
    fs.writeFileSync(path.join(builtinSkillsDir, 'builtin-one', 'SKILL.md'), '# Builtin\n');
    fs.mkdirSync(agentsDir, { recursive: true });
    fs.writeFileSync(path.join(agentsDir, 'helper.md'), '# Helper Agent\n');
    fs.mkdirSync(path.join(configDir, 'plugins', 'gcalendar'), { recursive: true });
    fs.writeFileSync(
      path.join(configDir, 'plugins', 'gcalendar', 'plugin.json'),
      JSON.stringify({ name: 'gcalendar', displayName: 'Google Calendar' })
    );
    fs.writeFileSync(
      path.join(configDir, 'config.json'),
      JSON.stringify({
        plugins: {
          gcalendar: { installedFrom: { id: 'official/gcalendar', version: '0.0.8' } }
        }
      })
    );
    fs.writeFileSync(
      path.join(configDir, 'mcp_config.json'),
      JSON.stringify({
        mcpServers: {
          atlassian: { command: '/usr/local/bin/acli', args: ['mcp'], env: { SECRET: 'top-secret-token' } },
          disabledOne: { disabled: true, args: ['--token=abc'] }
        }
      })
    );
    fs.writeFileSync(path.join(geminiDir, 'AGENTS.md'), '# Global\n');
    fs.mkdirSync(projDir, { recursive: true });
    fs.writeFileSync(path.join(projDir, 'AGENTS.md'), '# Project rules\n');

    const snap = daemon.collectOverviewSnapshot(
      { dirPath: projDir },
      { homeDir, geminiDir, configDir, skillsDir, agentsDir, builtinSkillsDir, skipGit: true }
    );
    assert.equal(snap.ok, true);
    assert.equal(snap.workspace.dirPath, path.resolve(projDir));
    assert.equal(snap.rules.length, 2);
    assert.equal(snap.skills.total, 2);
    assert.equal(snap.skills.userCount, 1);
    assert.equal(snap.agents.total, 1);
    assert.equal(snap.agents.items[0].name, 'helper');
    const connIds = snap.connectors.map((c) => c.id);
    assert.deepEqual(connIds, ['atlassian', 'gcalendar']);
    const serialized = JSON.stringify(snap);
    assert.equal(serialized.includes('top-secret-token'), false, 'MCP env secrets never leak');
    assert.equal(serialized.includes('--token=abc'), false, 'disabled MCP args never leak');

    /* Verify async git status counts both staged and unstaged changes without blocking */
    const gitInit = spawnSync('git', ['-C', projDir, 'init'], { encoding: 'utf8' });
    if (gitInit.status === 0) {
      spawnSync('git', ['-C', projDir, 'config', 'user.email', 'test@example.com']);
      spawnSync('git', ['-C', projDir, 'config', 'user.name', 'Tester']);
      spawnSync('git', ['-C', projDir, 'add', 'AGENTS.md']);
      spawnSync('git', ['-C', projDir, 'commit', '-m', 'init']);
      fs.writeFileSync(path.join(projDir, 'staged.txt'), 'line1\nline2\n');
      spawnSync('git', ['-C', projDir, 'add', 'staged.txt']);
      fs.writeFileSync(path.join(projDir, 'AGENTS.md'), '# Project rules\nextra unstaged\n');
      const snapAsync = await daemon.collectOverviewSnapshotAsync(
        { dirPath: projDir },
        { homeDir, geminiDir, configDir, skillsDir, agentsDir, builtinSkillsDir }
      );
      assert.ok(snapAsync.workspace.git && snapAsync.workspace.git.branch, 'async git branch detected');
      assert.equal(snapAsync.workspace.git.added >= 3, true, 'async git diff HEAD counts staged + unstaged additions');
      assert.equal(snapAsync.workspace.git.changedFiles >= 2, true, 'porcelain v2 counts staged + unstaged files');
    }
  } finally {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }
});

test('[claudeUxOverviewPanel] enhances right Overview panel with Google Blue Used-% quotas, model-switch pool reactivity, promoted Artifact & clean teardown', { skip: skipDom }, async () => {
  const customJsSrc = fs.readFileSync(path.join(REPO, 'user', 'custom.js'), 'utf8');
  const customCssSrc = fs.readFileSync(path.join(REPO, 'user', 'custom.css'), 'utf8');

  assert.match(customCssSrc, /--ag-ov-blue:\s*var\(--primary,\s*#2F75C3\)/);
  assert.match(customCssSrc, /--ag-ov-blue:\s*var\(--primary,\s*#2F71E3\)/);
  assert.match(customCssSrc, /#ag-claude-ov-sections\s+\.ag-ov-seg-bar\s*\{[^}]*repeat\(20,\s*minmax\(0,\s*1fr\)\)/s);
  assert.match(customCssSrc, /\[data-ag-ov-native-artifact="1"\]\s*\{[^}]*order:\s*1\s*!important/s);

  const cid = 'aaaaaaaa-1111-4222-8333-444444444444';
  const childCid = 'bbbbbbbb-1111-4222-8333-444444444444';
  const projDir = '/tmp/ov-demo-proj';
  const dom = new JSDOM(
    `<!doctype html><html><body><div id="root">
      <div class="bg-sidebar"></div>
      <div id="antigravity.agentSidePanelInputBox">
        <div class="flex min-w-0 flex-1 items-center">
          <div><button type="button" data-testid="model-selector-trigger">Gemini 4 Neon High</button></div>
        </div>
      </div>
      <div data-testid="overview-panel" class="flex flex-auto w-full min-h-0 flex-col">
        <div class="flex shrink-0 flex-col px-1 pt-1 pb-px"><span>Overview</span></div>
        <div class="flex flex-col overflow-y-auto outline-none scrollbar-none w-full flex-grow min-h-0 divide-y divide-border empty:hidden">
          <div class="flex flex-col gap-px px-1 pb-1 empty:hidden">
            <button type="button" data-testid="overview-panel-row-review"><span>Review</span><span data-testid="overview-panel-row-review-detail"></span></button>
            <button type="button" data-testid="overview-panel-row-files"><span>Files</span></button>
            <button type="button" data-testid="overview-panel-row-terminal"><span>Terminal</span></button>
            <button type="button" data-testid="overview-panel-row-plugins"><span>Plugins</span><div class="ml-auto"></div></button>
          </div>
          <div class="p-1"><button type="button">Background tasks</button></div>
          <div class="p-1"><span class="agy-hover-label">Artifact</span><button type="button" data-testid="artifact-row">Prototype</button></div>
        </div>
      </div>
    </div></body></html>`,
    { url: `https://127.0.0.1:62683/c/${cid}`, pretendToBeVisual: true, runScripts: 'outside-only' }
  );

  const { window } = dom;
  const doc = window.document;
  const future5h = String(Math.floor(Date.now() / 1000) + 3 * 3600);
  const futureWk = String(Math.floor(Date.now() / 1000) + 5 * 86400);

  doc.getElementById('antigravity.agentSidePanelInputBox').__reactFiber$q = {
    memoizedProps: {
      quotaSvc: {
        userTier: { id: 'pro', name: 'Google AI Pro' },
        retrieveUserQuotaSummary: () =>
          Promise.resolve({
            groups: [
              {
                displayName: 'Gemini Models',
                buckets: [
                  { window: '5h', remainingFraction: 0.65, resetTime: { seconds: future5h } },
                  { window: 'weekly', remainingFraction: 0.59, resetTime: { seconds: futureWk } }
                ]
              },
              {
                displayName: 'Claude & GPT',
                buckets: [{ window: '5h', remainingFraction: 0.8, resetTime: { seconds: future5h } }]
              }
            ]
          })
      }
    },
    return: null
  };

  const mockStore = {
    getState: () => ({
      sidebarProjects: {
        projects: [{ id: 'proj-ov', name: 'DemoProj', folderUris: [pathToFileURL(projDir).href], archived: false }]
      },
      trajectorySummaries: {
        summaries: {
          [cid]: { projectId: 'proj-ov', workspaces: [{ workspaceFolderAbsoluteUri: pathToFileURL(projDir).href }] },
          [childCid]: { parentConversationId: cid, title: 'Subagent task', notFullyIdle: true, status: 2 }
        }
      }
    }),
    subscribe: () => () => {},
    dispatch: () => {}
  };
  doc.querySelector('.bg-sidebar').__reactFiber$s = { memoizedProps: { sidebarStore: mockStore }, return: null };

  window.__agProjectCall = async (action) => {
    if (action === 'getOverviewSnapshot') {
      return {
        ok: true,
        workspace: { dirPath: projDir, name: 'DemoProj', git: { branch: 'main', added: 12, deleted: 3, changedFiles: 2 } },
        rules: [
          { label: '~/.gemini/AGENTS.md', path: '/tmp/.gemini/AGENTS.md', scope: 'global', bytes: 128 },
          { label: 'AGENTS.md', path: `${projDir}/AGENTS.md`, scope: 'project', bytes: 64 },
          { label: 'fast-io/AGENTS.md', path: '/tmp/plugins/fast-io/rules/AGENTS.md', scope: 'plugin', bytes: 32 }
        ],
        skills: { total: 5, userCount: 2, items: [{ name: 'code-review', path: '/tmp/code-review/SKILL.md', source: 'user' }] },
        agents: { total: 1, items: [{ name: 'helper', path: '/tmp/agents/helper.md', source: 'user' }] },
        connectors: [
          { id: 'atlassian', name: 'Atlassian', kind: 'mcp', configPath: '/tmp/mcp_config.json' },
          { id: 'gcalendar', name: 'Google Calendar', kind: 'plugin', configPath: '/tmp/plugin.json' }
        ]
      };
    }
    return { ok: true };
  };

  window.__ag_render_metrics = (payload) => {
    window.__ag_last_metrics = payload;
  };
  window.ctx = {
    modules: { i18n: false, claudeUxContextRing: true, claudeUxOverviewPanel: true },
    onCleanup: () => {}
  };
  window.eval(customJsSrc);

  try {
    window.__ag_render_metrics({
      cascadeId: cid,
      hasData: true,
      inlineHtml: '<span>120 tok/s</span>',
      tooltipHtml: '<div></div>',
      stats: {
        ctx: 443200,
        cached: 440000,
        uncached: 3200,
        limit: 1000000,
        limitStr: '1M',
        remain: 556800,
        pct: 44,
        lastCacheRate: 99,
        sessionCacheRate: 91.5,
        turns: 30,
        calls: 161,
        totalThink: 215000,
        totalResp: 284000,
        totalOut: 499000,
        childCount: 1,
        childCalls: 4,
        children: [{ id: childCid, title: 'Subagent task', agentName: 'research', running: true, killed: false, calls: 4, outTok: 1200 }]
      }
    });
    await new Promise((r) => setTimeout(r, 40));

    const panel = doc.querySelector('[data-testid="overview-panel"]');
    const sec = doc.getElementById('ag-claude-ov-sections');
    assert.equal(panel.getAttribute('data-ag-ov-enhanced'), '1');
    assert.ok(doc.querySelector('[data-ag-ov-shortcuts="1"]'), 'native shortcuts marked as compact grid');
    assert.ok(doc.querySelector('[data-ag-ov-native-artifact="1"]'), 'native Artifact block promoted to order:1');
    assert.ok(doc.querySelector('[data-ag-ov-native-tail="1"]'), 'native background tasks marked as tail');
    assert.ok(sec && sec.parentElement.lastElementChild === sec, 'custom sections appended safely as last DOM child');

    const txt = sec.textContent || '';
    assert.match(txt, /DemoProj/);
    assert.match(txt, /Global \+ Project \+ Plugin · 3/);
    assert.match(txt, /440k/);
    assert.match(txt, /3\.2k/);
    assert.match(txt, /99%/);
    assert.match(txt, /30 turns · 161 calls/);
    assert.match(txt, /Google AI Pro/);
    assert.match(txt, /35% used/);
    assert.match(txt, /41% used/);
    assert.match(txt, /Subagent task/);
    assert.equal(txt.includes('Atlassian'), false, 'Connectors card starts collapsed by default');

    const firstQuotaSegs = sec.querySelectorAll('.ag-ov-quota-box')[0].querySelectorAll('.ag-ov-seg');
    assert.equal(firstQuotaSegs.length, 20, '20-segment quota bar rendered');
    assert.match(firstQuotaSegs[0].style.background, /var\(--ag-ov-blue/, 'lit quota segments use Google Blue token');
    assert.match(firstQuotaSegs[7].style.background, /var\(--ag-ov-track\)/, 'unused segments beyond 35% (7/20) use track');
    assert.ok(sec.querySelector('.ag-ov-time-cursor'), 'elapsed time cursor rendered');

    /* Expand Connectors card on click */
    sec.querySelector('[data-ag-ov-collapse="connectors"]').click();
    assert.match(sec.textContent || '', /Atlassian/, 'clicking Connectors header expands list');

    /* Switching active model to Claude dynamically switches primary quota pool to Claude / GPT */
    const modelBtn = doc.querySelector('button[data-testid="model-selector-trigger"]');
    modelBtn.textContent = 'Claude Sonnet 4.5';
    await new Promise((r) => setTimeout(r, 120));
    const primaryTitleAfterSwitch = sec.querySelector('.ag-ov-quota-box .ag-ov-qtitle')?.textContent || '';
    assert.match(primaryTitleAfterSwitch, /Claude \/ GPT/, 'primary quota card follows model switch to Claude/GPT');
    assert.match(sec.querySelector('.ag-ov-quota-box .ag-ov-qpct')?.textContent || '', /20% used/);

    window.__agClaudeUxDispose();
    assert.equal(doc.getElementById('ag-claude-ov-sections'), null, 'teardown removes overview sections cleanly');
    assert.equal(panel.hasAttribute('data-ag-ov-enhanced'), false, 'teardown removes enhanced marker');
    assert.equal(doc.querySelector('[data-ag-ov-native-artifact]'), null, 'teardown removes artifact marker');
  } finally {
    window.close();
  }
});

test('[v3.1.4 · v2.34 Models i18n & Clean Titlebar] omits titlebar theme pill, localizes Models/Quota strings, and keeps main model menu free of Executor Model row', { skip: !JSDOM }, async () => {
  const customJsSrc = fs.readFileSync(path.join(REPO, 'user', 'custom.js'), 'utf8');
  const customCssSrc = fs.readFileSync(path.join(REPO, 'user', 'custom.css'), 'utf8');
  const i18nDict = JSON.parse(fs.readFileSync(path.join(REPO, 'core', 'i18n.json'), 'utf8'));

  assert.doesNotMatch(
    customCssSrc,
    /#ag-claude-topbar-theme\b/,
    'removed topbar theme pill CSS should not linger in custom.css'
  );
  assert.match(
    customCssSrc,
    /#ag-claude-ov-sections\s+\.ag-ov-row-title\s*\{[\s\S]*?overflow:\s*hidden;[\s\S]*?text-overflow:\s*ellipsis;/,
    'Overview row title clips long CJK workspace names cleanly instead of overlapping path text'
  );
  assert.match(
    customCssSrc,
    /#ag-claude-ov-sections\s+\.ag-ov-folder-btn\s*\{[\s\S]*?flex-direction:\s*column;/,
    'Overview workspace folder row stacks title above path so long names never collide with path'
  );

  const dom = new JSDOM(
    `<!doctype html><html><body>
      <div id="root">
        <header>
          <div class="flex items-center gap-1" id="topbar-actions">
            <button type="button" data-testid="titlebar-more-actions">⋮</button>
            <button type="button" data-testid="toggle-overview-panel">Overview</button>
          </div>
        </header>
        <div id="settings-models-mock">
          <h2>Orchestrator Settings</h2>
          <p id="orch-sub">Choose the models Orchestrator uses. A larger, smarter orchestrator model with a faster, cheaper executor gives high quality for fewer tokens.</p>
          <div id="orch-lbl">Orchestrator Model</div>
          <div id="exec-lbl">Executor Model</div>
          <div id="exec-desc">Carries out the plan: searches, edits, builds, and tests. Pick a faster, cheaper model.</div>
          <div id="quota-desc">You have used some of your weekly limit, it will fully refresh in 6 days, 6 hours.</div>
          <div id="quota-zero">You haven't used any of your 5-hour limit.</div>
          <div id="plan-lbl">Your Plan: Google AI Ultra</div>
          <button type="button" id="bd-btn">Show 57 breakdowns</button>
        </div>
        <div id="antigravity.agentSidePanelInputBox">
          <button type="button" data-testid="model-selector-trigger">Gemini 4 Carbon High</button>
        </div>
      </div>
    </body></html>`,
    { runScripts: 'outside-only', url: 'https://127.0.0.1:61999/' }
  );
  const { window } = dom;
  const doc = window.document;

  /* 1. Attach native model-selector-trigger React fiber API */
  const modelOptions = [
    { label: 'Gemini 4 Carbon (High)', modelId: 'gemini-4-carbon-high', value: 1427, disabled: false },
    { label: 'Gemini 4 Carbon (Low)', modelId: 'gemini-4-carbon-low', value: 1438, disabled: false },
    { label: 'Gemini 4 Neon (High)', modelId: 'gemini-4-neon-high', value: 1532, disabled: false },
    { label: 'Gemini 4 Neon (XHigh)', modelId: 'gemini-4-neon-xhigh', value: 1535, disabled: false },
    { label: 'Gemini 4 Hydrogen (Low)', modelId: 'gemini-4-hydrogen-low', value: 1527, disabled: false },
    { label: 'Gemini 4 Hydrogen (High)', modelId: 'gemini-4-hydrogen-high', value: 1525, disabled: false },
    { label: 'Gemini 4 Hydrogen (XHigh)', modelId: 'gemini-4-hydrogen-xhigh', value: 1528, disabled: false },
    { label: 'Gemini 3.8 Flash (Low)', modelId: 'gemini-3.8-flash-low', value: 1320, disabled: false },
    { label: 'Gemini 3.8 Flash (High)', modelId: 'gemini-3.8-flash-high', value: 1318, disabled: false },
    { label: 'Orchestrator (Neon)', modelId: 'gemini-pro-orchestrator-neon', value: 1537, disabled: false }
  ];
  let selectedOpt = modelOptions[0];
  const triggerBtn = doc.querySelector('button[data-testid="model-selector-trigger"]');
  triggerBtn.__reactFiber$test = {
    memoizedProps: {
      value: {
        modelOptions,
        selectedModel: selectedOpt,
        setSelectedModel: (opt) => {
          selectedOpt = opt;
        },
        open: false,
        setIsOpen: () => {},
        orchestratorPick: { model: 0, select: () => {} },
        orchestratorPlanners: [modelOptions[2], modelOptions[3]]
      }
    },
    return: null
  };

  window.ctx = {
    dict: i18nDict,
    modules: {
      i18n: true,
      claudeUxModelMenu: true
    },
    onCleanup: () => {}
  };
  window.eval(customJsSrc);

  try {
    await new Promise((r) => setTimeout(r, 30));

    /* Verify 1: Topbar stays clean with no injected theme toggle pill */
    assert.equal(doc.getElementById('ag-claude-topbar-theme'), null, 'topbar theme toggle is not mounted');

    /* Verify 2: Complete Chinese localization for v2.34.0 Models & Quota strings */
    assert.equal(doc.querySelector('#settings-models-mock h2').textContent, '编排器设置');
    assert.equal(doc.getElementById('orch-lbl').textContent, '编排主模型');
    assert.equal(doc.getElementById('exec-lbl').textContent, '执行模型');
    assert.match(doc.getElementById('exec-desc').textContent, /负责按计划落地执行/);
    assert.equal(
      doc.getElementById('quota-desc').textContent,
      '您已使用部分每周额度，将在 6 天 6 小时后完全恢复。'
    );
    assert.equal(doc.getElementById('quota-zero').textContent, '您尚未消耗 5 小时额度。');
    assert.equal(doc.getElementById('plan-lbl').textContent, '当前方案：Google AI Ultra');
    assert.equal(doc.getElementById('bd-btn').textContent, '展开 57 项明细');

    /* Verify 3: Main composer model menu omits Executor Model row (managed in official Settings -> Models) */
    triggerBtn.dispatchEvent(new window.MouseEvent('pointerdown', { bubbles: true, button: 0 }));
    const mainPop = doc.getElementById('ag-claude-model-popover');
    assert.equal(mainPop.getAttribute('data-open'), 'true');
    assert.equal(
      mainPop.querySelector('[data-ag-cm-subtrigger="executor"]'),
      null,
      'Executor model row is not rendered in main composer model menu'
    );
    assert.doesNotMatch(mainPop.textContent, /执行模型|Executor model/);
    assert.ok(mainPop.querySelector('[data-ag-cm-subtrigger="effort"]'), 'Thinking effort row remains intact');
    assert.ok(mainPop.querySelector('[data-ag-cm-subtrigger="more"]'), 'More models row remains intact');

    window.__agClaudeUxDispose();
  } finally {
    window.close();
  }
});

test('[Scheme C · Orchestrator Level-3 Planner Effort & Official Whitelisted Executor] cascades planner effort and strict Mendel-whitelisted executor row under More Models -> Orchestrators while keeping Level-1 clean', { skip: !JSDOM }, async () => {
  const customJsSrc = fs.readFileSync(path.join(REPO, 'user', 'custom.js'), 'utf8');
  const dom = new JSDOM(
    `<!doctype html><html><body>
      <div id="root">
        <div id="antigravity.agentSidePanelInputBox">
          <button type="button" data-testid="model-selector-trigger">Gemini 4 Neon Extra</button>
        </div>
      </div>
    </body></html>`,
    { runScripts: 'outside-only', url: 'https://127.0.0.1:61999/' }
  );
  const { window } = dom;
  const doc = window.document;

  /* 1. Mount real v2.34.0 shape: direct getMendelFlags on root fiber memoizedProps.value + prefStore on child fiber */
  const prefs = { orchestratorExecutorModel: 0 };
  const prefListeners = new Set();
  const prefStore = {
    getState: () => ({
      getPrefValue: (k) => prefs[k] ?? 0,
      setPrefValue: (k, v) => {
        prefs[k] = v;
        for (const fn of prefListeners) fn();
      }
    }),
    onDidChange: (fn) => {
      prefListeners.add(fn);
      return () => prefListeners.delete(fn);
    }
  };
  let mendelCalls = 0;
  const lsClient = {
    getMendelFlags: async () => {
      mendelCalls++;
      return {
        experimentConfig: {
          experiments: [
            {
              keyString: 'orchestrator-model-roles',
              payload: {
                case: 'string',
                value: JSON.stringify({
                  orchestrators: ['gemini-4-neon', 'gemini-4-carbon'],
                  executors: ['gemini-4-hydrogen', 'claude-sonnet-5-5']
                })
              }
            }
          ]
        }
      };
    }
  };
  const rootEl = doc.getElementById('root');
  rootEl.__reactContainer$test = {
    memoizedProps: { value: lsClient },
    child: {
      memoizedProps: { value: prefStore },
      child: null,
      sibling: null
    },
    sibling: null
  };

  /* 2. Attach model-selector-trigger API with planners, executors, and non-whitelisted models (Flash, Opus) */
  const modelOptions = [
    { label: 'Gemini 4 Carbon (High)', modelId: 'gemini-4-carbon-high', value: 1427, disabled: false },
    { label: 'Gemini 4 Carbon (Low)', modelId: 'gemini-4-carbon-low', value: 1438, disabled: false },
    { label: 'Gemini 4 Neon (High)', modelId: 'gemini-4-neon-high', value: 1532, disabled: false },
    { label: 'Gemini 4 Neon (XHigh)', modelId: 'gemini-4-neon-xhigh', value: 1535, disabled: false },
    { label: 'Gemini 4 Hydrogen (Low)', modelId: 'gemini-4-hydrogen-low', value: 1527, disabled: false },
    { label: 'Gemini 4 Hydrogen (Medium)', modelId: 'gemini-4-hydrogen-medium', value: 1526, disabled: false },
    { label: 'Gemini 4 Hydrogen (XHigh)', modelId: 'gemini-4-hydrogen-xhigh', value: 1528, disabled: false },
    { label: 'Gemini 3.8 Flash (Low)', modelId: 'gemini-3.8-flash-low', value: 1320, disabled: false },
    { label: 'Gemini 3.8 Flash (High)', modelId: 'gemini-3.8-flash-high', value: 1318, disabled: false },
    { label: 'Claude Opus 5.5 (High)', modelId: 'claude-opus-5-5-high', value: 1402, disabled: false },
    { label: 'Claude Sonnet 5.5 (Medium)', modelId: 'claude-sonnet-5-5-medium', value: 1404, disabled: false },
    { label: 'Claude Sonnet 5.5 (High)', modelId: 'claude-sonnet-5-5-high', value: 1405, disabled: false },
    { label: 'Orchestrator (Neon)', modelId: 'gemini-pro-orchestrator-neon', value: 1537, disabled: false }
  ];
  let selectedOpt = modelOptions[3];
  let pickedPlannerVal = 0;
  const triggerBtn = doc.querySelector('button[data-testid="model-selector-trigger"]');
  const apiObj = {
    modelOptions,
    get selectedModel() {
      return selectedOpt;
    },
    setSelectedModel: (opt) => {
      selectedOpt = opt;
    },
    open: false,
    setIsOpen: () => {},
    orchestratorPick: {
      get model() {
        return pickedPlannerVal;
      },
      select: (v) => {
        pickedPlannerVal = v;
      }
    },
    orchestratorPlanners: [modelOptions[2], modelOptions[3], modelOptions[0], modelOptions[1]]
  };
  triggerBtn.__reactFiber$test = { memoizedProps: { value: apiObj }, return: null };

  window.ctx = {
    dict: {},
    modules: { i18n: true, claudeUxModelMenu: true },
    onCleanup: () => {}
  };
  window.eval(customJsSrc);

  try {
    /* Open Level 1 menu and let async getMendelFlags resolve */
    triggerBtn.dispatchEvent(new window.MouseEvent('pointerdown', { bubbles: true, button: 0 }));
    await new Promise((r) => setTimeout(r, 40));

    const mainPop = doc.getElementById('ag-claude-model-popover');
    const subPop = doc.getElementById('ag-claude-model-subpop');
    const triPop = doc.getElementById('ag-claude-model-tripop');
    assert.equal(mendelCalls, 1, 'fetches official orchestrator-model-roles directly from root fiber lsClient');
    assert.equal(mainPop.getAttribute('data-open'), 'true');
    assert.equal(mainPop.querySelector('[data-ag-cm-subtrigger="executor"]'), null, 'Level 1 menu stays free of Executor Model');

    /* Open Level 2: More models */
    mainPop.querySelector('[data-ag-cm-subtrigger="more"]').click();
    assert.equal(subPop.getAttribute('data-open'), 'true');
    assert.equal(triPop.getAttribute('data-open'), 'false');

    const orchNeonRow = subPop.querySelector('[data-ag-cm-more-family="Orchestrator · Gemini 4 Neon"]');
    const execRow = subPop.querySelector('[data-ag-cm-tritrigger="executor"]');
    assert.ok(orchNeonRow, 'Orchestrator · Gemini 4 Neon row present in Level 2');
    assert.ok(execRow, 'Dedicated Executor model row rendered under Orchestrators in Level 2');
    assert.match(execRow.textContent, /执行模型/);
    assert.match(execRow.textContent, /Hydrogen · Extra/, 'defaults to highest-effort first whitelisted executor');

    /* Hover / click Executor row -> Level 3 opens with STRICTLY whitelisted executors (no Flash/Carbon/Neon/Opus) */
    execRow.click();
    assert.equal(triPop.getAttribute('data-open'), 'true');
    assert.equal(triPop.getAttribute('data-tri-kind'), 'executor');
    assert.match(triPop.textContent, /Gemini 4 Hydrogen/);
    assert.match(triPop.textContent, /Claude Sonnet 5\.5/);
    assert.doesNotMatch(triPop.textContent, /Gemini 3\.8 Flash|Gemini 4 Carbon|Gemini 4 Neon|Claude Opus 5\.5/);

    /* Click Hydrogen Medium (1526): writes pref, updates UI live, keeps popover open for further orchestration picking */
    const hydroMedPill = triPop.querySelector('[data-ag-cm-exec-val="1526"]');
    assert.ok(hydroMedPill, 'Hydrogen Medium pill present');
    hydroMedPill.click();
    assert.equal(prefs.orchestratorExecutorModel, 1526, 'writes orchestratorExecutorModel=1526');
    assert.equal(mainPop.getAttribute('data-open'), 'true', 'keeps popover open after selecting executor effort');
    assert.equal(triPop.getAttribute('data-open'), 'true');
    assert.match(subPop.querySelector('[data-ag-cm-tritrigger="executor"]').textContent, /Hydrogen · Medium/);
    assert.ok(subPop.querySelector('[data-ag-cm-tritrigger="executor"] .ag-cm-dot'), 'shows blue dot for custom executor');

    /* Clicking default variant (1528) writes 0 (UNSPECIFIED) matching native Settings KSb */
    triPop.querySelector('[data-ag-cm-exec-val="1528"]').click();
    assert.equal(prefs.orchestratorExecutorModel, 0, 'picking default executor normalizes pref back to 0');

    /* Pick non-default Sonnet 5.5 High (1405), then test Reset to default */
    triPop.querySelector('[data-ag-cm-exec-val="1405"]').click();
    assert.equal(prefs.orchestratorExecutorModel, 1405);
    assert.match(subPop.querySelector('[data-ag-cm-tritrigger="executor"]').textContent, /Sonnet 5\.5 · High/);
    triPop.querySelector('[data-ag-cm-exec-val="0"]').click();
    assert.equal(prefs.orchestratorExecutorModel, 0, 'Reset button restores default executor (0)');

    /* Hovering an "Other models" row closes Level 3 cleanly */
    const otherRow = subPop.querySelector('[data-ag-cm-more-family="Claude Opus 5.5"]');
    assert.ok(otherRow);
    otherRow.dispatchEvent(new window.MouseEvent('mouseover', { bubbles: true }));
    assert.equal(triPop.getAttribute('data-open'), 'false', 'hovering Other models closes Level 3');

    /* Hovering Orchestrator · Gemini 4 Neon opens Level 3 planner effort submenu; picking High applies Orchestrator + planner */
    subPop.querySelector('[data-ag-cm-more-family="Orchestrator · Gemini 4 Neon"]').dispatchEvent(
      new window.MouseEvent('mouseover', { bubbles: true })
    );
    assert.equal(triPop.getAttribute('data-open'), 'true');
    assert.equal(triPop.getAttribute('data-tri-kind'), 'planner');
    assert.match(triPop.textContent, /主模型强度 · Gemini 4 Neon/);
    const highPlannerRow = triPop.querySelector('[data-ag-cm-orch-effort="High"]');
    assert.ok(highPlannerRow, 'planner High effort row exists');
    highPlannerRow.click();
    assert.equal(selectedOpt.value, 1537, 'switches active model to Orchestrator');
    assert.equal(pickedPlannerVal, 1532, 'sets orchestrator planner to Gemini 4 Neon (High)');
    assert.equal(mainPop.getAttribute('data-open'), 'false', 'closes popover after choosing planner effort');
    assert.equal(triPop.getAttribute('data-open'), 'false');

    window.__agClaudeUxDispose();
    assert.equal(doc.getElementById('ag-claude-model-tripop'), null, 'teardown removes Level 3 popover');
    assert.equal(prefListeners.size, 0, 'unsubscribes prefStore listener on dispose');
  } finally {
    window.close();
  }
});

test('[Native Context Menu i18n & Clean Project Cards] localizes macOS native showContextMenu on pinned conversations (with Option pass-through) and omits instruction/file badges on project cards', { skip: !JSDOM }, async () => {
  const customJsSrc = fs.readFileSync(path.join(REPO, 'user', 'custom.js'), 'utf8');
  const i18nDict = JSON.parse(fs.readFileSync(path.join(REPO, 'core', 'i18n.json'), 'utf8'));

  assert.doesNotMatch(customJsSrc, /ag-proj-card-badges|ag-proj-badge/, 'project cards omit bottom-right instruction/file pill badges');

  const dom = new JSDOM(
    `<!doctype html><html><body>
      <div id="root">
        <div data-testid="conversation-row-sidebar" data-pinned="true" data-cascade-id="cid-pinned-1">
          <a href="/c/cid-pinned-1"><span class="truncate">Pinned Conversation</span></a>
        </div>
      </div>
    </body></html>`,
    { runScripts: 'outside-only', url: 'https://127.0.0.1:61999/' }
  );
  const { window } = dom;
  const doc = window.document;

  let clickedAction = null;
  let openStateHistory = [];
  let capturedPayloads = [];
  let nextMenuChoice = 'copy-1';
  window.electronNative = Object.freeze({
    showContextMenu: async (items) => {
      capturedPayloads.push(items);
      return nextMenuChoice;
    }
  });

  const pinnedRow = doc.querySelector('[data-testid="conversation-row-sidebar"]');
  const contextWrapperFiber = {
    memoizedProps: {
      disabled: false,
      onOpenChange: (open) => openStateHistory.push(open),
      items: () => [
        { id: 'rename', label: 'Rename', onClick: () => { clickedAction = 'rename'; } },
        { id: 'pin', label: 'Unpin', accelerator: '⌥⌘P', onClick: () => { clickedAction = 'unpin'; } },
        { id: 'mark-read', label: 'Mark Unread', onClick: () => { clickedAction = 'unread'; } },
        { type: 'separator' },
        {
          id: 'copy',
          type: 'submenu',
          label: 'Copy',
          items: [
            { id: 'copy-0', label: 'Conversation Name', onClick: () => { clickedAction = 'copy-name'; } },
            { id: 'copy-1', label: 'Conversation ID', onClick: () => { clickedAction = 'copy-id'; } },
            { id: 'copy-2', label: 'Workspace Name', onClick: () => { clickedAction = 'copy-ws'; } },
            { id: 'copy-3', label: 'Project Name', onClick: () => { clickedAction = 'copy-proj'; } }
          ]
        },
        {
          id: 'split',
          type: 'submenu',
          label: 'Split',
          items: [
            { id: 'split-0', label: 'Split Right', onClick: () => { clickedAction = 'split-right'; } },
            { id: 'split-1', label: 'Split Down', onClick: () => { clickedAction = 'split-down'; } }
          ]
        },
        { type: 'separator' },
        { id: 'archive', label: 'Archive', accelerator: '⌥⌘A', onClick: () => { clickedAction = 'archive'; } },
        { id: 'delete', label: 'Delete', onClick: () => { clickedAction = 'delete'; } }
      ]
    },
    child: { memoizedProps: { onContextMenu: () => {} } },
    return: null
  };
  const midFiber = { memoizedProps: { onContextMenu: () => {} }, child: null, return: contextWrapperFiber };
  contextWrapperFiber.child = midFiber;
  pinnedRow.__reactFiber$test = { memoizedProps: {}, return: midFiber };

  window.ctx = {
    dict: i18nDict,
    modules: { i18n: true },
    onCleanup: () => {}
  };
  window.eval(customJsSrc);

  try {
    /* 1. Normal right-click intercepts & passes fully localized Chinese items + normalized accelerators */
    const ev = new window.MouseEvent('contextmenu', { bubbles: true, cancelable: true });
    pinnedRow.querySelector('span').dispatchEvent(ev);
    assert.equal(ev.defaultPrevented, true, 'intercepts native English menu when i18n is enabled');
    await new Promise((r) => setTimeout(r, 20));

    assert.equal(capturedPayloads.length, 1);
    const sent = capturedPayloads[0];
    assert.equal(sent.find((x) => x.id === 'rename').label, '重命名');
    assert.equal(sent.find((x) => x.id === 'pin').label, '取消置顶');
    assert.equal(sent.find((x) => x.id === 'pin').accelerator, 'Alt+CmdOrCtrl+P');
    assert.equal(sent.find((x) => x.id === 'mark-read').label, '标为未读');
    const copySub = sent.find((x) => x.id === 'copy');
    assert.equal(copySub.label, '复制');
    assert.deepEqual(
      Array.from(copySub.submenu, (x) => x.label),
      ['对话名称', '对话 ID', '工作区名称', '项目名称']
    );
    const splitSub = sent.find((x) => x.id === 'split');
    assert.equal(splitSub.label, '分屏');
    assert.deepEqual(
      Array.from(splitSub.submenu, (x) => x.label),
      ['向右分屏', '向下分屏']
    );
    assert.equal(sent.find((x) => x.id === 'archive').label, '归档');
    assert.equal(sent.find((x) => x.id === 'archive').accelerator, 'Alt+CmdOrCtrl+A');
    assert.equal(sent.find((x) => x.id === 'delete').label, '删除');
    assert.equal(clickedAction, 'copy-id', 'dispatches original submenu callback for chosen item');
    assert.deepEqual(openStateHistory, [true, false], 'syncs React onOpenChange lifecycle');

    /* 2. Option + Right-click passes through untouched to official English native menu */
    const altEv = new window.MouseEvent('contextmenu', { bubbles: true, cancelable: true, altKey: true });
    pinnedRow.dispatchEvent(altEv);
    assert.equal(altEv.defaultPrevented, false, 'Option + Right-click bypasses custom interception');
    assert.equal(capturedPayloads.length, 1);

    /* 3. After dispose, listener is cleanly removed */
    window.__agClaudeUxDispose();
    const afterEv = new window.MouseEvent('contextmenu', { bubbles: true, cancelable: true });
    pinnedRow.dispatchEvent(afterEv);
    assert.equal(afterEv.defaultPrevented, false, 'dispose detaches contextmenu capture listener');
    assert.equal(capturedPayloads.length, 1);
  } finally {
    window.close();
  }
});

test('[Live Auto Quota Refresh] bypasses stale forceRefresh:false server cache and auto-updates 0.1% quota right after model API calls without manual click', { skip: !JSDOM }, async () => {
  const customJsSrc = fs.readFileSync(path.join(REPO, 'user', 'custom.js'), 'utf8');
  const cid = '11111111-2222-3333-4444-555555555555';
  const future5h = String(Math.floor(Date.now() / 1000) + 2 * 3600);
  const futureWk = String(Math.floor(Date.now() / 1000) + 4 * 86400);

  const dom = new JSDOM(
    `<!doctype html><html><body>
      <div id="root">
        <div id="antigravity.agentSidePanelInputBox">
          <button type="button" data-testid="model-selector-trigger">Gemini 4 Carbon High</button>
        </div>
        <aside data-testid="overview-panel">
          <div>Overview</div>
          <div class="overflow-y-auto">
            <div><button data-testid="overview-panel-row-files">Files</button></div>
          </div>
        </aside>
      </div>
    </body></html>`,
    { runScripts: 'outside-only', url: `https://127.0.0.1:61999/c/${cid}` }
  );
  const { window } = dom;
  const doc = window.document;

  /* Simulate Antigravity LanguageServer: forceRefresh:false returns frozen stale 20%, forceRefresh:true returns live evolving quota */
  let liveRem5h = 0.727; // 27.3% used
  let liveRemWk = 0.888; // 11.2% used
  const callsLog = [];
  doc.getElementById('root').__reactFiber$root = {
    memoizedProps: {
      agentService: {
        userTier: { id: 'ultra', name: 'Google AI Ultra' },
        getUserStatus: () => Promise.resolve({}),
        retrieveUserQuotaSummary: (arg) => {
          const isForce = Boolean(arg && arg.forceRefresh);
          callsLog.push(isForce);
          return Promise.resolve({
            response: {
              groups: [
                {
                  displayName: 'Gemini Models',
                  buckets: [
                    { window: '5h', remaining: { case: 'remainingFraction', value: isForce ? liveRem5h : 0.8 }, resetTime: { seconds: future5h } },
                    { window: 'weekly', remaining: { case: 'remainingFraction', value: isForce ? liveRemWk : 0.9 }, resetTime: { seconds: futureWk } }
                  ]
                }
              ]
            }
          });
        }
      }
    },
    return: null
  };

  window.__ag_render_metrics = (payload) => {
    window.__ag_last_metrics = payload;
  };
  window.__agProjectCall = async () => ({ ok: true, workspace: null, rules: [], skills: { total: 0, items: [] }, agents: { total: 0, items: [] }, connectors: [] });
  window.ctx = {
    modules: { i18n: false, claudeUxContextRing: true, claudeUxOverviewPanel: true },
    onCleanup: () => {}
  };
  window.eval(customJsSrc);

  try {
    await new Promise((r) => setTimeout(r, 60));
    const sec = doc.getElementById('ag-claude-ov-sections');
    assert.ok(callsLog.length >= 1 && callsLog[0] === true, 'initial Overview mount fetches with forceRefresh:true instead of stale false');
    assert.match(sec.textContent || '', /27\.3% used/, 'displays live 27.3% (0.1% precision) instead of frozen 20%');
    assert.match(sec.textContent || '', /11\.2% used/);

    /* Simulate first telemetry snapshot on this conversation */
    const mkStats = (calls) => ({
      ctx: 180000, cached: 175000, uncached: 5000, limit: 512000, limitStr: '512k', remain: 332000, pct: 35,
      lastCacheRate: 97, sessionCacheRate: 92, turns: 10, calls, totalThink: 50000, totalResp: 80000, totalOut: 130000,
      childCount: 0, childCalls: 0, children: []
    });
    window.__ag_render_metrics({ cascadeId: cid, hasData: true, inlineHtml: '<span>90 tok/s</span>', tooltipHtml: '<div></div>', stats: mkStats(10) });

    /* Advance clock cooldown via manual reset simulation: a new model API call finishes and consumes quota */
    liveRem5h = 0.716; // 28.4% used
    liveRemWk = 0.88;  // 12% used
    const beforeCalls = callsLog.length;
    /* Wait briefly then emit incremented stats.calls (10 -> 11) */
    window.__ag_render_metrics({ cascadeId: cid, hasData: true, inlineHtml: '<span>95 tok/s</span>', tooltipHtml: '<div></div>', stats: mkStats(11) });

    /* Wait past the 4.5s anti-burst floor? Wait: in unit test let's verify timer fires within ~4.6s OR let's check minGapMs! */
    await new Promise((r) => setTimeout(r, 4700));
    assert.ok(callsLog.length > beforeCalls, 'incrementing stats.calls automatically triggers background forceRefresh:true');
    assert.equal(callsLog[callsLog.length - 1], true);
    assert.match(sec.textContent || '', /28\.4% used/, 'Overview quota automatically updates to 28.4% without clicking refresh');
    assert.match(sec.textContent || '', /12% used/, 'exact .0 percentage renders cleanly as 12%');

    window.__agClaudeUxDispose();
  } finally {
    window.close();
  }
});

test('Overview Review shortcut tile replaces icon slot with in-flow diff stats instead of overlapping', () => {
  const css = fs.readFileSync(path.join(REPO, 'user', 'custom.css'), 'utf8');
  assert.match(
    css,
    /button\[data-testid="overview-panel-row-review"\]:has\(>\s*\[data-testid="overview-panel-row-review-detail"\]:not\(:empty\)\)\s*>\s*svg\s*\{[\s\S]*?display:\s*none\s*!important;/,
    'Review tile must hide its icon when live diff stats occupy the top slot'
  );
  assert.match(
    css,
    /\[data-testid="overview-panel-row-review-detail"\]:not\(:empty\)\s*\{[\s\S]*?position:\s*static\s*!important;[\s\S]*?order:\s*-1\s*!important;/,
    'Review detail badge must sit in-flow above the label instead of position:absolute overlapping the icon'
  );
  assert.match(
    css,
    /\[data-testid="overview-panel-row-review-diff-stats"\]\s*\{[\s\S]*?font-size:\s*10\.5px\s*!important;/,
    'Review diff stats must override native Tailwind text-sm (14px) to fit inside 68px shortcut tile'
  );
});

