import { launchCodex } from './launch.js';
import { createHudChannel } from './hud-channel.js';
import { prepareConsoleTitleObserver } from './console-title.js';
import { titleSignals } from './terminal-view.js';
import { toSnapshot } from './signals.js';

const titleConfig = 'tui.terminal_title=["session-id","model","reasoning","status","fast-mode"]';

export async function nativePanel(store, options, args, dependencies = {}) {
  const {
    platform = process.platform, env = process.env,
    launch = launchCodex, channelFactory = () => createHudChannel(options.precreatedChannel),
    openPane = async () => { if (!options.precreatedChannel) throw new Error('El panel debe crearse junto a Codex.'); },
    prepareObserver = prepareConsoleTitleObserver, log = text => process.stderr.write(`GAONA-HUB: ${text}\n`)
  } = dependencies;
  const cwd = options.project || process.cwd();
  const launchOptions = { executable: options.executable, cwd, env: options.launchEnv };
  if (platform !== 'win32' || !env.WT_SESSION) {
    log('El panel inferior requiere Windows Terminal. Codex continúa con sus controles nativos.');
    return launch(args, launchOptions);
  }

  let channel;
  try {
    channel = await channelFactory();
    channel.publish?.({ ...toSnapshot({ cwd }), panelNote: 'Esperando a Codex' });
    await openPane(channel.name, options);
    await channel.waitReady();
    dependencies.onReady?.(true);
  } catch {
    await channel?.close();
    log('No se pudo abrir el HUD inferior. Codex continúa con sus controles nativos.');
    dependencies.onReady?.(false);
    return launch(args, launchOptions);
  }

  let announced, selected, signals = {}, stopObserver, timer, refreshing = false, stopped = false;
  let observerFailed = false;
  const refresh = async () => {
    if (refreshing || stopped) return;
    refreshing = true;
    try {
      const prefix = announced;
      if (prefix && !selected) {
        const id = await store.resolveSession(prefix);
        if (prefix === announced) selected = id;
      }
      const id = selected;
      let state = { ...toSnapshot({ cwd }), ...signals, panelNote: observerFailed ? 'No se pudo leer la sesión de Codex' : announced ? 'Esperando métricas de Codex' : 'Esperando identidad de la sesión' };
      if (id) {
        const snapshot = await store.snapshot(id);
        if (id === selected && !snapshot.error) state = { ...snapshot, ...signals, panelNote: '' };
      }
      if (!stopped) channel.publish(state);
    } catch {
      if (!stopped) channel.publish({ ...toSnapshot({ cwd }), panelNote: 'Métricas temporalmente no disponibles' });
    } finally { refreshing = false; }
  };
  try {
    let observer;
    try {
      observer = await prepareObserver(title => {
        const parsed = titleSignals(title, { allowPending: true });
        if (!parsed) return;
        if (announced !== parsed.prefix) { announced = parsed.prefix; selected = null; signals = {}; store.refreshed = 0; }
        signals = { ...signals, ...parsed.signals };
        void refresh();
      }, () => { observerFailed = true; announced = null; selected = null; signals = {}; void refresh(); });
      stopObserver = observer.stop;
    } catch { observerFailed = true; }
    return await launch(['-c', titleConfig, ...args], {
      ...launchOptions,
      onSpawn(child) {
        try { observer?.attach(child.pid); } catch { observerFailed = true; }
        timer = setInterval(() => void refresh(), 1000);
        void refresh();
      }
    });
  } finally {
    stopped = true;
    clearInterval(timer);
    stopObserver?.();
    await channel.close();
  }
}
