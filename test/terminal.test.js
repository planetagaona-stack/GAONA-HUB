import test from 'node:test';
import assert from 'node:assert/strict';
import xterm from '@xterm/headless';
import { layoutScreen, bufferRows, drawFrame, footerSession, sessionFromTitle, titleSignals } from '../src/terminal-view.js';
import * as terminalView from '../src/terminal-view.js';
import { demoSnapshot, visibleLength } from '../src/render.js';
import { renderHud } from '../src/render.js';
import { CommandTracker } from '../src/command-tracker.js';
import { parseSignals, toSnapshot } from '../src/signals.js';
import { projectWindowTitle, applyCompactionView } from '../src/terminal.js';

test('window titles identify the actual project at startup and after session binding', () => {
  assert.equal(projectWindowTitle({}, 'C:\\Projects\\Tienda'), 'Tienda');
  assert.equal(projectWindowTitle({ cwd: 'C:\\Projects\\Otro' }, 'C:\\Projects\\Tienda'), 'Otro');
  assert.equal(projectWindowTitle({ project: 'Mi Proyecto' }, '/work/fallback'), 'Mi Proyecto');
  assert.equal(projectWindowTitle({}, '/work/website/'), 'website');
  assert.equal(projectWindowTitle({ project: 'bad\x1b\x07\u009cname' }, '/work'), 'badname');
});

test('window titles prefer the task name, follow renames, and hide the home username', () => {
  const home = 'C:\\Users\\ExampleUser';
  assert.equal(projectWindowTitle({}, home, { home }), 'Nueva tarea');
  assert.equal(projectWindowTitle({ threadName: 'Actualizar drivers' }, home, { home }), 'Actualizar drivers');
  assert.equal(projectWindowTitle({ threadName: 'Chat renombrado' }, home, { title: 'Mi tarea', home }), 'Mi tarea');
  assert.equal(projectWindowTitle({ threadName: '  Chat\x1b\x07\u009c   seguro  ' }, home, { home }), 'Chat seguro');
  assert.equal(projectWindowTitle({ threadName: '   ' }, home, { home }), 'Nueva tarea');
  assert.equal(Array.from(projectWindowTitle({ threadName: '🙂'.repeat(120) }, home)).length, 90);
});

test('CTX has a proportionate bar immediately beside the weekly bar', () => {
  const rendered = renderHud(demoSnapshot, { width: 180, footer: true, color: false });
  const rows = rendered.split('\n');
  assert.match(rows[0], /CTX.*SEMANAL.*REINICIO.*MODEL/);
  assert.match(rows[1], /━━━───────.*━━────────/);
  assert.match(renderHud({ contextPercent: 100 }, { footer: true, color: false }), /━━━━━━━━━━/);
});

test('command indicators retain command and skill names without saving prompts or arguments', () => {
  const tracker = new CommandTracker();
  assert.equal(tracker.accept('private prompt and token=SECRET\r'), null);
  assert.equal(tracker.candidate, '');
  assert.equal(tracker.accept('/fa'), null);
  assert.deepEqual(tracker.accept('st\r'), {kind:'command',name:'/fast'});
  assert.deepEqual(tracker.accept('/model SECRET\r'), {kind:'command',name:'/model'});
  assert.deepEqual(tracker.accept('$openai-docs\r'), {kind:'skill',name:'$openai-docs'});
  const id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
  assert.equal(titleSignals(`${id} | gpt-6.1-sol | high | Ready | Fast on`).signals.fastMode, true);
});

test('skill-file reads keep only the skill name and ignore private tool arguments', () => {
  const event = JSON.stringify({type:'response_item',payload:{type:'function_call',name:'exec',call_id:'a',arguments:'Get-Content C:\\Users\\me\\.codex\\skills\\openai-docs\\SKILL.md SECRET'}});
  const state = toSnapshot(parseSignals(event));
  assert.equal(state.skill, 'openai-docs');
  assert.ok(!JSON.stringify(state).includes('SECRET'));
});

const write = (terminal, text) => new Promise(resolve => terminal.write(text, resolve));
test('native OSC session title binds without inspecting or confusing chat text', async t => {
  const terminal = emulator(t);
  const id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
  const seen = [];
  terminal.onTitleChange(title => seen.push(sessionFromTitle(title)));
  await write(terminal, `Chat contains ${id}\x1b]0;project\x07\x1b]0;${id}\x07`);
  assert.deepEqual(seen, [null, id]);
  assert.equal(sessionFromTitle(`project ${id}`), null);
  assert.equal(sessionFromTitle('bbbbbbbb-bbbb-bbbb-bbbb-bbbbb...'), 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbb');
  assert.deepEqual(titleSignals(`${id} | gpt-6.1-sol | high | Ready`), { prefix: id, signals: { model: 'gpt-6.1-sol', effort: 'high', status: 'idle' } });
});
function emulator(t, cols = 80, rows = 24) {
  const terminal = new xterm.Terminal({ cols, rows, allowProposedApi: true });
  t.after(() => terminal.dispose());
  return terminal;
}

test('footer reserves bottom rows while keeping at least eight rows for Codex', () => {
  for (const columns of [20, 40, 80, 120, 240]) for (const rows of [10, 24, 40]) {
    const layout = layoutScreen(columns, rows, demoSnapshot);
    assert.equal(layout.chatRows + layout.footer.length, rows);
    assert.ok(layout.chatRows >= 8);
    assert.ok(layout.footer.every(line => visibleLength(line) <= columns));
  }
});

test('Codex compaction is detected only while its live two-line status is visible', async t => {
  const terminal = emulator(t, 80, 16);
  await write(terminal, '› user mentions Compacting context\r\ntext only\r\n');
  assert.equal(typeof terminalView.isCompacting, 'function');
  assert.equal(terminalView.isCompacting(terminal), false);
  await write(terminal, '\x1b[2J\x1b[10;1H• Compacting context (0:02 • esc to interrupt)\r\n  └ Making room to continue.\r\n\r\n\r\n› Ask Codex to do anything');
  assert.equal(terminalView.isCompacting(terminal), true);
  await write(terminal, '\x1b[2J\x1b[H› Ask Codex to do anything\r\nContext compacted\r\n');
  assert.equal(terminalView.isCompacting(terminal), false);
});

test('compaction detection finds the live status across the viewport and rejects composer text', async t => {
  const terminal = emulator(t, 80, 24);
  await write(terminal, '\x1b[2J\x1b[3;1H• Compacting context (0:02 • esc to interrupt)\r\n  └ Making room to continue.\r\n\r\n\r\n› Ask Codex to do anything');
  assert.equal(terminalView.isCompacting(terminal), true);

  await write(terminal, '\x1b[2J\x1b[18;1H› Analiza este registro:\r\n  • Compacting context (0:02 • esc to interrupt)\r\n  └ Making room to continue.');
  assert.equal(terminalView.isCompacting(terminal), false);
});

test('compaction detection ignores historical status while the viewport is scrolled up', async t => {
  const terminal = emulator(t, 80, 12);
  await write(terminal, '• Compacting context (0:02 • esc to interrupt)\r\n  └ Making room to continue.\r\n\r\n\r\n› Ask Codex to do anything\r\n');
  for (let row = 0; row < 20; row++) await write(terminal, `línea normal ${row}\r\n`);
  assert.ok(terminal.buffer.active.baseY > 0);
  assert.equal(terminalView.isCompacting(terminal), false);

  terminal.scrollToTop();
  assert.ok(terminal.buffer.active.viewportY < terminal.buffer.active.baseY);
  assert.equal(terminalView.isCompacting(terminal), false);
});

test('compaction refreshes the footer on every frame and clears its state when Codex finishes', t => {
  const terminal = emulator(t, 120, 30);
  const child = { resize() {} };
  const state = { ...demoSnapshot, compacting: false };
  const initial = layoutScreen(120, 30, state, { color: true });
  const started = applyCompactionView(terminal, child, [], initial, state, {}, true, 0, { color: true });
  assert.match(started.layout.footer.join('\n'), /COMPACTANDO/);

  const animated = applyCompactionView(terminal, child, started.frame, started.layout, started.state, started.runtimeSignals, true, 1, { color: true });
  assert.notDeepEqual(animated.layout.footer, started.layout.footer);

  const finished = applyCompactionView(terminal, child, animated.frame, animated.layout, animated.state, animated.runtimeSignals, false, 0, { color: true });
  assert.equal(finished.state.compacting, false);
  assert.equal(finished.state.compactionFrame, undefined);
  assert.doesNotMatch(finished.layout.footer.join('\n'), /COMPACTANDO/);
  assert.doesNotMatch(layoutScreen(120, 30, { ...demoSnapshot, ...finished.runtimeSignals }, { color: true }).footer.join('\n'), /COMPACTANDO/);
});

test('compaction resizes the PTY and resets the frame when the HUD grows', t => {
  const terminal = emulator(t, 48, 30);
  const sizes = [];
  const child = { resize: (columns, rows) => sizes.push([columns, rows]) };
  const state = { ...demoSnapshot, compacting: false };
  const initial = layoutScreen(49, 30, state, { color: true });
  const started = applyCompactionView(terminal, child, ['old frame'], initial, state, {}, true, 0, { color: true });
  assert.equal(terminal.rows, started.layout.chatRows);
  assert.deepEqual(sizes.at(-1), [started.layout.chatColumns, started.layout.chatRows]);
  assert.deepEqual(started.frame, []);
  assert.equal(drawFrame(terminal, started.layout).lines.length, 30);

  const finished = applyCompactionView(terminal, child, started.frame, started.layout, started.state, started.runtimeSignals, false, 0, { color: true });
  assert.equal(terminal.rows, finished.layout.chatRows);
  assert.deepEqual(sizes.at(-1), [finished.layout.chatColumns, finished.layout.chatRows]);
  assert.deepEqual(finished.frame, []);
  assert.doesNotMatch(finished.layout.footer.join('\n'), /COMPACTANDO/);
  assert.equal(drawFrame(terminal, finished.layout).lines.length, 30);
});

test('HUD heading omits the decorative filler rail', () => {
  const layout = layoutScreen(120, 24, demoSnapshot, { color: false });
  assert.ok(!layout.footer.join('\n').includes('////'));
  assert.ok(!layout.footer[0].includes('─'));
});

test('Codex clear-screen and alternate-buffer output cannot overwrite the reserved HUD', async t => {
  const layout = layoutScreen(80, 24, demoSnapshot, { color: true });
  const inner = emulator(t, layout.chatColumns, layout.chatRows), outer = emulator(t);
  await write(inner, '\x1b[?1049h\x1b[2J\x1b[HCHAT\x1b[38;2;73;208;255m cyan\x1b[0m');
  const first = drawFrame(inner, layout);
  await write(outer, first.text);
  assert.match(outer.buffer.active.getLine(layout.chatRows).translateToString(true), /GAONA-HUB/);
  await write(inner, '\x1b[2J\x1b[HREPAINTED');
  await write(outer, drawFrame(inner, layout, first.lines).text);
  assert.match(outer.buffer.active.getLine(0).translateToString(true), /REPAINTED/);
  assert.match(outer.buffer.active.getLine(layout.chatRows).translateToString(true), /GAONA-HUB/);
  assert.match(outer.buffer.active.getLine(23).translateToString(true), /38m/);
  assert.ok(outer.buffer.active.cursorY < layout.chatRows);
});

test('VT rendering retains RGB, background colors, styles and wide Unicode cells', async t => {
  const terminal = emulator(t);
  await write(terminal, '\x1b[1;38;2;73;208;255;48;5;17m漢🙂e\u0301\x1b[0m');
  const rendered = bufferRows(terminal)[0];
  assert.match(rendered, /38;2;73;208;255/);
  assert.match(rendered, /48;5;17/);
  assert.match(rendered, /漢🙂e\u0301/);
  const outer = emulator(t);
  await write(outer, rendered);
  assert.equal(outer.buffer.active.getLine(0).getCell(0).getFgColor(), 0x49d0ff);
  assert.equal(outer.buffer.active.getLine(0).getCell(0).getWidth(), 2);
  assert.equal(outer.buffer.active.getLine(0).getCell(2).getChars(), '🙂');
});

test('session binding only reads the native footer after the current composer', async t => {
  const terminal = emulator(t);
  const transcriptId = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
  const actualId = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
  await write(terminal, `  ${transcriptId}\r\n› old message\r\nanswer\r\n\r\n› Ask Codex to do anything\r\n\r\n  ${actualId}    ⚠ 1 warning · f2 to view`);
  assert.equal(footerSession(terminal), actualId);
  await write(terminal, '\x1b[2J\x1b[H  ' + transcriptId + '\r\n› Current prompt');
  assert.equal(footerSession(terminal), null);
});

test('terminal queries use the Codex viewport, and the cursor stays above the HUD', async t => {
  const terminal = emulator(t, 80, 17);
  const replies = [];
  terminal.onData(data => replies.push(data));
  await write(terminal, '\x1b[17;80H\x1b[6n');
  assert.deepEqual(replies, ['\x1b[17;80R']);
  const layout = layoutScreen(80, 24, demoSnapshot);
  const outer = emulator(t);
  await write(outer, drawFrame(terminal, layout).text);
  assert.ok(outer.buffer.active.cursorY < layout.chatRows);
});
