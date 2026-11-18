import { execFile } from "node:child_process";
import os from "node:os";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { Plugin } from "vite";
import type { DiskCounters, DiskInfo, SystemSample } from "../src/lib/system-monitor.js";

const CPU_INTERVAL = 1_800;
const WINDOWS_INTERVAL = 5_000;
const WINDOWS_MAX_AGE = 15_000;

interface WindowsSample {
  gpuLoad: number | null;
  gpuNames: string[] | null;
  drives: DiskInfo[] | null;
  disks: DiskCounters[] | null;
}

const windowsQuery = String.raw`
[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
$ErrorActionPreference = 'Stop'
$gpuLoad = $null
$disks = $null
$gpuNames = $null
$drives = $null

if ($includeInventory) {
  try { $gpuNames = @(Get-CimInstance Win32_VideoController | ForEach-Object { $_.Name }) } catch {}
  try {
    $drives = @(Get-CimInstance Win32_DiskDrive | ForEach-Object {
      @{ index = [int]$_.Index; model = [string]$_.Model; size = $(if ($null -ne $_.Size) { [double]$_.Size }) }
    })
  } catch {}
}

try {
  $engines = @(Get-CimInstance Win32_PerfFormattedData_GPUPerformanceCounters_GPUEngine)
  if ($engines.Count -gt 0) {
    $loadByEngine = @{}
    foreach ($engine in $engines) {
      if ($engine.Name -match '^pid_\d+_(.+)$') {
        $key = $Matches[1]
        $loadByEngine[$key] = $loadByEngine[$key] + [double]$engine.UtilizationPercentage
      }
    }
    if ($loadByEngine.Count -gt 0) {
      $gpuLoad = [Math]::Min(100, ($loadByEngine.Values | Measure-Object -Maximum).Maximum)
    }
  }
} catch {}

try {
  $disks = @(Get-CimInstance Win32_PerfFormattedData_PerfDisk_PhysicalDisk | ForEach-Object {
    if ($_.Name -match '^(\d+)(?:\s|$)') {
      @{
        index = [int]$Matches[1]; name = [string]$_.Name
        active = [Math]::Max(0, [Math]::Min(100, 100 - [double]$_.PercentIdleTime))
        read = [double]$_.DiskReadBytesPersec; write = [double]$_.DiskWriteBytesPersec
      }
    }
  })
} catch {}

@{ gpuLoad = $gpuLoad; disks = $disks; gpuNames = $gpuNames; drives = $drives } | ConvertTo-Json -Depth 4 -Compress
`;

function cpuClock(cores: ReturnType<typeof os.cpus>) {
  let idle = 0;
  let total = 0;
  for (const { times } of cores) {
    idle += times.idle;
    total += times.user + times.nice + times.sys + times.irq + times.idle;
  }
  return { idle, total };
}

function windowsCounters(includeInventory: boolean): Promise<WindowsSample | null> {
  const command = `$includeInventory = $${includeInventory ? "true" : "false"}\n${windowsQuery}`;
  const encoded = Buffer.from(command, "utf16le").toString("base64");
  return new Promise((resolve) => {
    execFile("powershell.exe", ["-NoProfile", "-NonInteractive", "-EncodedCommand", encoded], {
      windowsHide: true, timeout: 8_000, maxBuffer: 128 * 1_024,
    }, (error, stdout) => {
      if (!error) {
        try {
          resolve(JSON.parse(stdout.trim()) as WindowsSample);
          return;
        } catch { /* The next request can retry unavailable counters. */ }
      }
      resolve(null);
    });
  });
}

function isLoopback(request: IncomingMessage) {
  const remote = request.socket.remoteAddress ?? "";
  const host = request.headers.host ?? "";
  if (!/^(?:127\.\d+\.\d+\.\d+|::ffff:127\.\d+\.\d+\.\d+|::1)$/.test(remote)) return false;
  if (!/^(?:localhost|127\.\d+\.\d+\.\d+|\[::1\])(?::\d+)?$/i.test(host)) return false;
  const origin = request.headers.origin;
  return !origin || origin === `http://${host}` || origin === `https://${host}`;
}

export function systemMonitor(): Plugin {
  let previousCpu = cpuClock(os.cpus());
  let cpuAt = 0;
  let cpuLoad: number | null = null;
  let nextWindowsCheck = 0;
  let nextInventory = 0;
  let sampling = false;
  let gpuNames: string[] = [];
  let drives: DiskInfo[] = [];
  let windows: { at: number; value: WindowsSample } | undefined;

  function refreshWindows(now: number) {
    if (process.platform !== "win32" || sampling || now < nextWindowsCheck) return;
    sampling = true;
    nextWindowsCheck = now + WINDOWS_INTERVAL;
    const inventory = now >= nextInventory;
    void windowsCounters(inventory).then((value) => {
      if (!value) return;
      windows = { at: Date.now(), value };
      if (value.gpuNames) gpuNames = value.gpuNames;
      if (value.drives) drives = value.drives;
      if (value.gpuNames && value.drives) nextInventory = now + 60_000;
    }).finally(() => { sampling = false; });
  }

  function snapshot(): SystemSample {
    const now = Date.now();
    const cores = os.cpus();
    if (now - cpuAt >= CPU_INTERVAL) {
      const current = cpuClock(cores);
      const elapsed = current.total - previousCpu.total;
      const idle = current.idle - previousCpu.idle;
      cpuLoad = cpuAt && elapsed > 0 && idle >= 0 && idle <= elapsed ? (1 - idle / elapsed) * 100 : null;
      previousCpu = current;
      cpuAt = now;
    }
    refreshWindows(now);
    const recent = windows && now - windows.at <= WINDOWS_MAX_AGE ? windows : undefined;
    const total = os.totalmem();
    return {
      at: now,
      windowsAt: recent?.at ?? null,
      cpu: { model: cores[0]?.model.trim() || null, threads: cores.length || null, load: cpuLoad },
      memory: { total, used: Math.max(0, total - os.freemem()) },
      gpu: { names: gpuNames, load: recent?.value.gpuLoad ?? null },
      disks: { drives, counters: recent?.value.disks ?? null },
    };
  }

  function serve(request: IncomingMessage, response: ServerResponse) {
    response.setHeader("Cache-Control", "no-store");
    if (!isLoopback(request)) {
      response.writeHead(403).end();
      return;
    }
    if (request.method !== "GET") {
      response.setHeader("Allow", "GET");
      response.writeHead(405).end();
      return;
    }
    response.setHeader("Content-Type", "application/json; charset=utf-8");
    response.end(JSON.stringify(snapshot()));
  }

  return {
    name: "sift-system-monitor",
    configureServer(server) {
      server.middlewares.use("/api/system-monitor", serve);
    },
    configurePreviewServer(server) {
      server.middlewares.use("/api/system-monitor", serve);
    },
  };
}
