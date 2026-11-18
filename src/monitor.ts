import "./monitor.css";
import { formatBytes } from "./lib/memory.js";
import { diskActivity, memoryLoad, percent, watchSystem } from "./lib/system-monitor.js";

const WINDOW_MS = 60_000;
const displayTime = new Intl.DateTimeFormat("ru-RU", {
  hour: "2-digit", minute: "2-digit", second: "2-digit",
});
const colors = { cpu: "#2563eb", memory: "#0f766e", gpu: "#7c3aed", disk: "#a04d0b" };
type Resource = keyof typeof colors;

const el = (id: string) => document.getElementById(id)!;
const values = {
  cpu: el("cpu-value"), memory: el("memory-value"), gpu: el("gpu-value"), disk: el("disk-value"),
};
const workspace = el("page-visualize");
const screenMonitor = el("page-monitor");
const openMonitor = el("system-monitor-link");
const toolbarReadings = {
  cpu: openMonitor.querySelector<HTMLElement>("[data-system-cpu]")!,
  memory: openMonitor.querySelector<HTMLElement>("[data-system-ram]")!,
  gpu: openMonitor.querySelector<HTMLElement>("[data-system-gpu]")!,
  disk: openMonitor.querySelector<HTMLElement>("[data-system-disk]")!,
};
let workspaceScroll = { left: 0, top: 0 };
openMonitor.addEventListener("click", () => {
  workspaceScroll = { left: workspace.scrollLeft, top: workspace.scrollTop };
  workspace.classList.remove("active");
  screenMonitor.classList.add("active");
  window.scrollTo(0, 0);
  el("system-monitor-title").focus({ preventScroll: true });
});
el("system-monitor-back").addEventListener("click", () => {
  screenMonitor.classList.remove("active");
  workspace.classList.add("active");
  workspace.scrollTo(workspaceScroll);
  openMonitor.focus({ preventScroll: true });
});

const charts = [...screenMonitor.querySelectorAll<HTMLCanvasElement>("canvas[data-history]")].map((canvas) => ({
  canvas,
  key: canvas.dataset.history as Resource,
  data: [] as { at: number; value: number | null }[],
}));

function drawHistory(chart: (typeof charts)[number], now: number) {
  const { canvas, key, data } = chart;
  const width = canvas.clientWidth;
  const height = canvas.clientHeight;
  if (!width || !height) return;
  const dpr = window.devicePixelRatio || 1;
  canvas.width = Math.round(width * dpr);
  canvas.height = Math.round(height * dpr);
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  ctx.scale(canvas.width / width, canvas.height / height);
  const x = (at: number) => (at - now + WINDOW_MS) / WINDOW_MS * width;
  const y = (value: number) => height - 2 - value * (height - 4) / 100;

  ctx.strokeStyle = "#dae3ef";
  ctx.beginPath();
  for (const value of [0, 25, 50, 75, 100]) {
    ctx.moveTo(0, y(value));
    ctx.lineTo(width, y(value));
  }
  for (let i = 0; i <= 6; i++) {
    const gridX = i * width / 6;
    ctx.moveTo(gridX, 0);
    ctx.lineTo(gridX, height);
  }
  ctx.stroke();

  ctx.strokeStyle = colors[key];
  ctx.lineWidth = 2;
  ctx.lineJoin = "round";
  ctx.beginPath();
  let previous = 0;
  for (const { at, value } of data) {
    if (value === null) {
      previous = 0;
      continue;
    }
    if (previous && at - previous <= 12_000) ctx.lineTo(x(at), y(value));
    else ctx.moveTo(x(at), y(value));
    previous = at;
  }
  ctx.stroke();
  const last = data.at(-1);
  if (last && last.value !== null) {
    ctx.fillStyle = colors[key];
    ctx.beginPath();
    ctx.arc(Math.max(2, Math.min(width - 2, x(last.at))), y(last.value), 2.5, 0, Math.PI * 2);
    ctx.fill();
  }
}

const browserThreads = navigator.hardwareConcurrency || null;
let lastDraw = Date.now();
const observer = new ResizeObserver(() => {
  for (const chart of charts) drawHistory(chart, lastDraw);
});
for (const { canvas } of charts) observer.observe(canvas);

watchSystem((sample) => {
  const mode = el("system-mode");
  const state = sample ? "Локальные данные" : "Только данные браузера";
  if (mode.textContent !== state) mode.textContent = state;
  mode.classList.toggle("is-live", Boolean(sample));
  const time = el("system-time") as HTMLTimeElement;
  time.textContent = sample ? `Обновлено в ${displayTime.format(sample.at)}` : "";
  time.dateTime = sample ? new Date(sample.at).toISOString() : "";
  const notice = el("system-notice");
  notice.hidden = Boolean(sample);
  notice.textContent = sample ? "" : "Локальный источник недоступен. Браузер показывает только доступное ему число логических процессоров. Для системных датчиков используйте локальный запуск SIFT.";

  const cpuThreads = sample?.cpu.threads ?? browserThreads;
  el("cpu-model").textContent = sample?.cpu.model ?? "Модель недоступна";
  el("cpu-detail").textContent = `Логические процессоры: ${cpuThreads ?? "—"}${!sample && browserThreads ? " (доступно браузеру)" : ""}`;
  el("memory-device").textContent = sample?.memory.total
    ? `${formatBytes(sample.memory.used)} занято из ${formatBytes(sample.memory.total)}` : "Данные памяти недоступны";
  el("memory-detail").textContent = `Доступно: ${sample?.memory.total ? formatBytes(sample.memory.total - sample.memory.used) : "—"}`;
  el("gpu-device").textContent = sample?.gpu.names.join(" · ") || "Модель недоступна";
  el("gpu-detail").textContent = sample?.gpu.load == null
    ? "Счётчик нагрузки GPU недоступен" : "Загрузка самого активного движка GPU";

  const disks = sample?.disks.counters ?? [];
  const drives = sample?.disks.drives ?? [];
  const diskIds = [...new Set([...drives.map(({ index }) => index), ...disks.map(({ index }) => index)])].sort((a, b) => a - b);
  const diskLoad = diskActivity(disks);
  el("disk-device").textContent = diskIds.length ? `Обнаружено дисков: ${diskIds.length}` : "Данные дисков недоступны";
  el("disk-detail").textContent = diskLoad === null ? "Счётчики активности недоступны" : "Активность самого загруженного диска";
  const list = el("system-drives");
  list.hidden = diskIds.length === 0;
  list.replaceChildren(...diskIds.map((id) => {
    const drive = drives.find(({ index }) => index === id);
    const counters = disks.find(({ index }) => index === id);
    const item = document.createElement("li");
    const name = document.createElement("strong");
    const io = document.createElement("span");
    name.textContent = [`Диск ${id}`, drive?.model || counters?.name, drive?.size ? formatBytes(drive.size) : ""].filter(Boolean).join(" · ");
    io.textContent = counters
      ? `Активность ${percent(counters.active)} · Чтение ${formatBytes(counters.read)}/с · Запись ${formatBytes(counters.write)}/с`
      : "Чтение и запись: —";
    item.append(name, io);
    return item;
  }));

  const readings = {
    cpu: sample?.cpu.load ?? null,
    memory: sample ? memoryLoad(sample) : null,
    gpu: sample?.gpu.load ?? null,
    disk: diskLoad,
  };
  lastDraw = sample?.at ?? Date.now();
  for (const chart of charts) {
    const value = readings[chart.key];
    const formatted = percent(value);
    values[chart.key].textContent = formatted;
    toolbarReadings[chart.key].textContent = formatted;
    const at = chart.key === "gpu" || chart.key === "disk" ? sample?.windowsAt ?? lastDraw : lastDraw;
    const previous = chart.data.at(-1);
    if ((!previous && value !== null) || (previous && at > previous.at)) chart.data.push({ at, value });
    while (chart.data.length && chart.data[0].at < lastDraw - WINDOW_MS) chart.data.shift();
    drawHistory(chart, lastDraw);
  }
}, () => workspace.classList.contains("active") || screenMonitor.classList.contains("active"));
