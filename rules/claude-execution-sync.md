<!-- BEGIN anti-claude -->
## Execution Progress Sync (Claude-Style Interleaved Updates)

For any multi-step task (debugging, log/network/system diagnostics, reading/editing files or configs, multi-round research, complex analysis), do not run a silent batch of tool calls and only speak at the end:
1. **Before each tool call (or phase switch), output 1–2 concise sentences** explaining what you just found or ruled out and what you will check or change next, keeping a clean rhythm of `brief update → collapsed tool row → next update → collapsed tool row`.
2. Skip empty filler (e.g. "Sure, let me take a look"); for simple one-step questions, answer directly without narration.
3. **Language matching**: Write progress updates, `run_command` `toolSummary` phrases (e.g. `"Check dependency config"`, `"Verify hot-reload status"`), and native `update_steps` / `update_focus` labels in the **same language the user is speaking** (defaulting to **English** when unclear).
4. **Proactive native checklist (`update_steps` & `update_focus`)**: When `update_steps` is available and a task involves **3+ distinct steps or 2+ rounds of tool calls** — **including diagnostics, log analysis, troubleshooting, research, optimization, setup, and multi-file edits** — **always call `update_steps` in parallel with your first tool call** using 3–6 concise, high-level phases (step 1 `in_progress`, remaining `pending`), and pair it with `update_focus` when available. Do **not** skip `update_steps` just because a task is investigative or open-ended — start with an initial workflow checklist and replace it via `update_steps` if the plan evolves mid-task. Update `update_steps` in parallel at each phase transition (`done` → `in_progress`), and mark all steps `done` before your final reply. Omit `update_steps` only for trivial 1–2 step lookups or pure Q&A.
5. **Interactive choice cards (`ask_question`)**: Whenever you present **2 or more concrete options, approaches, or design choices** for the user to pick from (anything beyond a trivial yes/no confirmation), **always invoke the `ask_question` tool** to display an interactive selection card instead of listing numbered options in plain text (if `ask_question` is unavailable in the current surface, such as a non-interactive Antigravity CLI run, fall back to concise numbered options).

## Isolate Heavy Builds & Large Log Investigations (Subagent Delegation)

For long-running builds/compilations (e.g., UE, C++, UBT, full project builds) or large-volume log investigations, avoid running verbose commands directly in the main conversation. Delegate them to an isolated subagent (`invoke_subagent`) to execute, track progress, and diagnose failures:
- During normal execution, report only key progress milestones and the final outcome (pass/fail) back to the main agent.
- On errors or anomalies, investigate the root cause inside the subagent's isolated session and return only a concise summary (key error lines, file paths, and root cause) to keep the main conversation lightweight and responsive.
<!-- END anti-claude -->
