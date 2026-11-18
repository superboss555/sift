export interface DiskInfo {
  index: number;
  model: string;
  size: number | null;
}

export interface DiskCounters {
  index: number;
  name: string;
  active: number;
  read: number;
  write: number;
}

export interface SystemSample {
  at: number;
  windowsAt: number | null;
  cpu: { model: string | null; threads: number | null; load: number | null };
  memory: { total: number; used: number };
  gpu: { names: string[]; load: number | null };
  disks: { drives: DiskInfo[]; counters: DiskCounters[] | null };
}

const POLL_MS = 2_000;
const number = new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 0 });

export function percent(value: number | null) {
  return value === null ? "—" : `${number.format(value)} %`;
}

export function memoryLoad(sample: SystemSample) {
  return sample.memory.total > 0 ? sample.memory.used * 100 / sample.memory.total : null;
}

export function diskActivity(counters: DiskCounters[]) {
  return counters.length ? Math.max(...counters.map(({ active }) => active)) : null;
}

export function watchSystem(onSample: (sample: SystemSample | null) => void, enabled = () => true) {
  let timer: number | undefined;
  let fetching = false;

  function schedule(delay = POLL_MS) {
    window.clearTimeout(timer);
    timer = document.hidden ? undefined : window.setTimeout(poll, delay);
  }

  async function poll() {
    if (document.hidden || fetching) return;
    if (!enabled()) {
      schedule();
      return;
    }
    fetching = true;
    let sample: SystemSample | null = null;
    try {
      const response = await fetch(new URL("../api/system-monitor", window.location.href), {
        cache: "no-store",
        signal: AbortSignal.timeout(4_000),
      });
      if (response.ok && response.headers.get("content-type")?.includes("application/json")) {
        const candidate: SystemSample = await response.json();
        if (typeof candidate.at === "number" && candidate.cpu && candidate.memory && candidate.gpu && candidate.disks) {
          sample = candidate;
        }
      }
    } catch { /* The page can still show browser-visible information. */ }
    fetching = false;
    schedule();
    if (!document.hidden) onSample(sample);
  }

  document.addEventListener("visibilitychange", () => schedule(0));
  schedule(0);
}
