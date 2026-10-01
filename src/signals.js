import path from 'node:path';

const number = value => Number.isFinite(value) && value >= 0 ? value : null;
const percentage = value => number(value) === null ? null : Math.min(100, value);

export function parseSignals(text, previous = {}) {
  const state = { ...previous };
  state.tools = { ...previous.tools };
  for (const line of text.split(/\r?\n/)) {
    let event;
    try { event = JSON.parse(line); } catch { continue; }
    const p = event.payload;
    if (!p || typeof p !== 'object') continue;
    if (event.type === 'session_meta') {
      state.id = p.id;
      state.cwd = p.cwd;
      state.sessionStartedAt = p.timestamp ?? event.timestamp;
    }
    if (event.type === 'turn_context') {
      state.cwd = p.cwd ?? state.cwd;
      state.model = p.model ?? state.model;
      state.effort = p.effort ?? p.reasoning_effort ?? p.reasoning?.effort ?? state.effort;
      if (p.service_tier === 'fast') state.fastMode = true;
      if (p.service_tier === 'default') state.fastMode = false;
    }
    if (event.type === 'response_item') {
      if (['function_call', 'custom_tool_call'].includes(p.type) && typeof p.arguments === 'string' && /Get-Content|\bcat\s|readFile|skills[._]read/.test(p.arguments)) {
        const normalized = p.arguments.replace(/\\+/g, '/');
        const names = [...normalized.matchAll(/\/([a-z0-9_.:-]+)\/SKILL\.md\b/gi)];
        if (names.length) state.skill = names.at(-1)[1];
      }
      if (['function_call', 'custom_tool_call'].includes(p.type) && p.call_id && p.name) state.tools[p.call_id] = p.name;
      if (['function_call_output', 'custom_tool_call_output'].includes(p.type) && p.call_id) delete state.tools[p.call_id];
      state.activeTool = Object.values(state.tools).at(-1) ?? null;
    }
    if (event.type !== 'event_msg') continue;
    if (p.type === 'task_started') {
      state.status = 'working';
      state.taskStartedAt = event.timestamp;
      state.taskEndedAt = null;
      state.activeTool = null;
      state.tools = {};
    }
    if (['task_complete', 'task_completed', 'turn_aborted'].includes(p.type)) {
      state.status = p.type === 'turn_aborted' ? 'paused' : 'idle';
      state.taskEndedAt = event.timestamp;
      state.activeTool = null;
      state.tools = {};
    }
    if (p.type === 'exec_command_begin') state.activeTool = 'Terminal';
    if (p.type === 'exec_command_end') state.activeTool = null;
    if (p.type === 'token_count') {
      const total = p.info?.total_token_usage;
      const last = p.info?.last_token_usage;
      if (total) {
        state.inputTokens = number(total.input_tokens);
        state.outputTokens = number(total.output_tokens);
      }
      const window = number(p.info?.model_context_window);
      const used = number(last?.total_tokens);
      if (window > 0 && used !== null) state.contextPercent = percentage(used / window * 100);
      const limits = p.rate_limits;
      if (limits) {
        const windows = [limits.primary, limits.secondary].filter(Boolean);
        const weekly = windows.find(item => item.window_minutes >= 10080);
        const short = windows.find(item => item.window_minutes > 0 && item.window_minutes < 10080);
        for (const [key, value] of [['weekly', weekly], ['usage', short]]) {
          if (value) state[key] = { usedPercent: percentage(value.used_percent), resetsAt: number(value.resets_at) };
        }
      }
    }
  }
  return state;
}

export function toSnapshot(state, now = Date.now()) {
  const start = Date.parse(state.taskStartedAt);
  const end = state.taskEndedAt ? Date.parse(state.taskEndedAt) : now;
  return {
    id: state.id ?? null,
    cwd: state.cwd ?? null,
    project: state.cwd ? path.win32.basename(state.cwd.replace(/\/$/, '')) || path.basename(state.cwd) : null,
    model: state.model ?? null,
    effort: state.effort ?? null,
    skill: state.skill ?? null,
    fastMode: state.fastMode ?? null,
    contextPercent: state.contextPercent ?? null,
    inputTokens: state.inputTokens ?? null,
    outputTokens: state.outputTokens ?? null,
    weekly: state.weekly ?? null,
    usage: state.usage ?? null,
    status: state.status ?? 'unknown',
    activeTool: state.activeTool ?? null,
    taskSeconds: Number.isFinite(start) && Number.isFinite(end) ? Math.max(0, Math.floor((end - start) / 1000)) : null,
    sampledAt: new Date(now).toISOString(),
  };
}
