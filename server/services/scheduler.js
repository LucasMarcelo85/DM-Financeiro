import { config } from '../config.js';
import { runDueSchedules } from './dispatcher.js';

let timer = null;
let running = false;

export function startScheduler() {
  if (!config.scheduler.enabled || timer) return;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      await runDueSchedules();
    } catch (e) {
      console.error('[agenda] falha no ciclo:', e.message);
    } finally {
      running = false;
    }
  };
  timer = setInterval(tick, config.scheduler.intervalMs);
  setTimeout(tick, 2000);
  console.log(`[agenda] envio automático ligado (verifica a cada ${config.scheduler.intervalMs / 1000}s)`);
}

export function stopScheduler() {
  if (timer) clearInterval(timer);
  timer = null;
}
