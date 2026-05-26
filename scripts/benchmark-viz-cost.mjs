/**
 * Stima relativa del costo CPU per frame dei visualizer (listen ~168px).
 * Confronto DiscoWall prima/dopo quick-win.
 * Esegui: node scripts/benchmark-viz-cost.mjs
 */

const FRAMES = 120;
const LISTEN_W = 168;
const LISTEN_H = 168;
const EXPANDED_W = 1200;
const EXPANDED_H = 800;

const MAX_CELLS_OLD = 4600;
const MAX_CELLS_PANEL = 1800;
const MAX_CELLS_EXPANDED = 4000;
const PLECTR_FIELD = 40 * 30;
const MOTIFS_AVG = 12;

const DPR_OLD_PANEL = 1.15;
const DPR_NEW_PANEL = 1;
const DPR_OLD_EXPANDED = 1.35;
const DPR_NEW_EXPANDED = 1.25;

const FPS_OLD = 60;
const FPS_PANEL = 30;
const FPS_EXPANDED_CALM = 45;
const FPS_EXPANDED_ACTIVE = 60;

function clamp(v, lo = 0, hi = 1) {
  return Math.max(lo, Math.min(hi, v));
}

function gridForSize(width, height, maxCells) {
  let cell = clamp(Math.round(width / 92), 9, 18);
  let cols = Math.max(18, Math.floor(width / cell));
  let rows = Math.max(12, Math.floor(height / cell));
  while (cols * rows > maxCells) {
    cell += 1;
    cols = Math.max(18, Math.floor(width / cell));
    rows = Math.max(12, Math.floor(height / cell));
  }
  return { cols, rows, pixels: cols * rows };
}

function bufferPixels(cssW, cssH, dpr) {
  return Math.round(cssW * dpr) * Math.round(cssH * dpr);
}

/** Simula costo samplePlectrField (loop motif). */
function sampleFieldCost() {
  let field = 0;
  for (let m = 0; m < MOTIFS_AVG; m += 1) {
    field += Math.sin(m * 0.7) * 0.08;
  }
  return clamp(field);
}

function benchDiscowallFrame(cols, rows, hasChart, mode, bufPixels) {
  const fieldG = new Float32Array(PLECTR_FIELD);
  let field = 0;
  const pulse = 0.1;

  if (hasChart && mode === "old") {
    for (let y = 0; y < rows; y += 1) {
      for (let x = 0; x < cols; x += 1) {
        field += sampleFieldCost();
      }
    }
  } else if (hasChart && mode === "new") {
    for (let g = 0; g < PLECTR_FIELD; g += 1) {
      fieldG[g] = sampleFieldCost();
    }
    for (let y = 0; y < rows; y += 1) {
      for (let x = 0; x < cols; x += 1) {
        const gi = (y % 29) * 40 + (x % 39);
        field += fieldG[gi];
      }
    }
  } else {
    for (let y = 0; y < rows; y += 1) {
      for (let x = 0; x < cols; x += 1) {
        field += 0.05 + pulse * 0.14;
      }
    }
  }

  for (let y = 0; y < rows; y += 1) {
    for (let x = 0; x < cols; x += 1) {
      const i = y * cols + x;
      const gateThreshold = hasChart ? 0.4 : 0.5;
      const pixelGate = (i % 7) / 7 > gateThreshold;
      const core = 0.2 - (pixelGate ? 0.1 : 0);
      if (core < 0.14) continue;
      for (let p = 0; p < 24; p += 1) {
        field += 0.01;
      }
    }
  }

  for (let p = 0; p < bufPixels; p += 4) {
    field += bufPixels[p] ? 0 : 0;
  }

  return field;
}

function benchDiscowall(cols, rows, hasChart, mode, dpr, cssW, cssH) {
  const bufPixels = bufferPixels(cssW, cssH, dpr);
  const t0 = performance.now();
  for (let f = 0; f < FRAMES; f += 1) {
    benchDiscowallFrame(cols, rows, hasChart, mode, bufPixels);
  }
  return performance.now() - t0;
}

function benchBars(bars) {
  const t0 = performance.now();
  for (let f = 0; f < FRAMES; f += 1) {
    for (let i = 0; i < bars; i += 1) {
      void (Math.sin(i * 0.2 + f * 0.08) * 0.5 + 0.5);
    }
  }
  return performance.now() - t0;
}

function benchOsc(samples) {
  const t0 = performance.now();
  for (let f = 0; f < FRAMES; f += 1) {
    for (let k = 0; k < samples; k += 1) {
      void Math.sin(k * 0.04 + f * 0.1);
    }
  }
  return performance.now() - t0;
}

function benchHmb(bins) {
  const t0 = performance.now();
  for (let f = 0; f < FRAMES; f += 1) {
    for (let i = 0; i < bins; i += 1) {
      let acc = 0;
      for (let j = 0; j < 8; j += 1) acc += Math.sin(i + j + f * 0.05);
      void acc;
    }
  }
  return performance.now() - t0;
}

function wallCpuPerSec(frameMs, fps) {
  return (frameMs / FRAMES) * fps;
}

const listenOld = gridForSize(LISTEN_W, LISTEN_H, MAX_CELLS_OLD);
const listenNew = gridForSize(LISTEN_W, LISTEN_H, MAX_CELLS_PANEL);
const expandedOld = gridForSize(EXPANDED_W, EXPANDED_H, MAX_CELLS_OLD);
const expandedNew = gridForSize(EXPANDED_W, EXPANDED_H, MAX_CELLS_EXPANDED);

const dwListenOldMs = benchDiscowall(
  listenOld.cols,
  listenOld.rows,
  true,
  "old",
  DPR_OLD_PANEL,
  LISTEN_W,
  LISTEN_H,
);
const dwListenNewMs = benchDiscowall(
  listenNew.cols,
  listenNew.rows,
  true,
  "new",
  DPR_NEW_PANEL,
  LISTEN_W,
  LISTEN_H,
);
const dwExpandedOldMs = benchDiscowall(
  expandedOld.cols,
  expandedOld.rows,
  true,
  "old",
  DPR_OLD_EXPANDED,
  EXPANDED_W,
  EXPANDED_H,
);
const dwExpandedNewMs = benchDiscowall(
  expandedNew.cols,
  expandedNew.rows,
  true,
  "new",
  DPR_NEW_EXPANDED,
  EXPANDED_W,
  EXPANDED_H,
);

const results = [
  { name: "Barre (64)", ms: benchBars(64), cells: 64 },
  { name: "Mirror (48)", ms: benchBars(48), cells: 48 },
  { name: "Oscilloscopio", ms: benchOsc(512), cells: 512 },
  { name: "HMB", ms: benchHmb(112), cells: 112 },
  { name: "Karaoke (DOM)", ms: benchBars(4), cells: 4 },
  {
    name: "DiscoWall listen · chart · PRIMA",
    ms: dwListenOldMs,
    cells: listenOld.pixels,
    fps: FPS_OLD,
    buf: bufferPixels(LISTEN_W, LISTEN_H, DPR_OLD_PANEL),
  },
  {
    name: "DiscoWall listen · chart · DOPO",
    ms: dwListenNewMs,
    cells: listenNew.pixels,
    fps: FPS_PANEL,
    buf: bufferPixels(LISTEN_W, LISTEN_H, DPR_NEW_PANEL),
  },
  {
    name: "DiscoWall fullscreen · chart · PRIMA",
    ms: dwExpandedOldMs,
    cells: expandedOld.pixels,
    fps: FPS_OLD,
    buf: bufferPixels(EXPANDED_W, EXPANDED_H, DPR_OLD_EXPANDED),
  },
  {
    name: "DiscoWall fullscreen · chart · DOPO (45fps)",
    ms: dwExpandedNewMs,
    cells: expandedNew.pixels,
    fps: FPS_EXPANDED_CALM,
    buf: bufferPixels(EXPANDED_W, EXPANDED_H, DPR_NEW_EXPANDED),
  },
  {
    name: "DiscoWall fullscreen · DOPO (60fps attivo)",
    ms: dwExpandedNewMs,
    cells: expandedNew.pixels,
    fps: FPS_EXPANDED_ACTIVE,
    buf: bufferPixels(EXPANDED_W, EXPANDED_H, DPR_NEW_EXPANDED),
  },
];

const baseline = results.find((r) => r.name.startsWith("Barre"))?.ms ?? 1;

console.log(`\nBenchmark visualizer (~${FRAMES} frame sintetici, Node ${process.version})\n`);

console.log("── Costo per batch di frame (solo calcolo, ms) ──\n");
console.log("Modalità".padEnd(44), "ms".padStart(8), "× barre".padStart(8), "celle".padStart(7));
console.log("-".repeat(70));
for (const r of [...results].sort((a, b) => a.ms - b.ms)) {
  if (!r.name.includes("DiscoWall")) {
    console.log(
      r.name.padEnd(44),
      r.ms.toFixed(1).padStart(8),
      (r.ms / baseline).toFixed(2).padStart(8),
      String(r.cells).padStart(7),
    );
  }
}
for (const r of results.filter((r) => r.name.includes("DiscoWall"))) {
  console.log(
    r.name.padEnd(44),
    r.ms.toFixed(1).padStart(8),
    (r.ms / baseline).toFixed(2).padStart(8),
    String(r.cells).padStart(7),
  );
}

console.log("\n── Stima CPU reale (ms/s ≈ costo frame × FPS) ──\n");
console.log(
  "Modalità".padEnd(44),
  "ms/s".padStart(8),
  "Δ vs prima".padStart(10),
  "buf px".padStart(8),
);
console.log("-".repeat(72));

const listenOldCpu = wallCpuPerSec(dwListenOldMs, FPS_OLD);
const listenNewCpu = wallCpuPerSec(dwListenNewMs, FPS_PANEL);
const expOldCpu = wallCpuPerSec(dwExpandedOldMs, FPS_OLD);
const expNewCalmCpu = wallCpuPerSec(dwExpandedNewMs, FPS_EXPANDED_CALM);
const expNewActiveCpu = wallCpuPerSec(dwExpandedNewMs, FPS_EXPANDED_ACTIVE);

const comparisons = [
  {
    label: "Listen + chart",
    before: listenOldCpu,
    after: listenNewCpu,
    bufBefore: bufferPixels(LISTEN_W, LISTEN_H, DPR_OLD_PANEL),
    bufAfter: bufferPixels(LISTEN_W, LISTEN_H, DPR_NEW_PANEL),
  },
  {
    label: "Fullscreen + chart (calmo 45fps)",
    before: expOldCpu,
    after: expNewCalmCpu,
    bufBefore: bufferPixels(EXPANDED_W, EXPANDED_H, DPR_OLD_EXPANDED),
    bufAfter: bufferPixels(EXPANDED_W, EXPANDED_H, DPR_NEW_EXPANDED),
  },
  {
    label: "Fullscreen + chart (attivo 60fps)",
    before: expOldCpu,
    after: expNewActiveCpu,
    bufBefore: bufferPixels(EXPANDED_W, EXPANDED_H, DPR_OLD_EXPANDED),
    bufAfter: bufferPixels(EXPANDED_W, EXPANDED_H, DPR_NEW_EXPANDED),
  },
];

for (const c of comparisons) {
  const delta = ((1 - c.after / c.before) * 100).toFixed(0);
  const sign = c.after < c.before ? "−" : "+";
  console.log(
    c.label.padEnd(44),
    c.after.toFixed(2).padStart(8),
    `${sign}${Math.abs(Number(delta))}%`.padStart(10),
    String(c.bufAfter).padStart(8),
  );
}

const listenSaving = (1 - listenNewCpu / listenOldCpu) * 100;
const expCalmSaving = (1 - expNewCalmCpu / expOldCpu) * 100;

console.log(`
Riepilogo quick-win DiscoWall:
  · Griglia Plectr 40×30/frame invece di samplePlectrField × ogni cella
  · Listen: ${listenOld.pixels} → ${listenNew.pixels} celle, DPR ${DPR_OLD_PANEL} → ${DPR_NEW_PANEL}, ${FPS_OLD} → ${FPS_PANEL} fps
  · Fullscreen: ${expandedOld.pixels} → ${expandedNew.pixels} celle, DPR ${DPR_OLD_EXPANDED} → ${DPR_NEW_EXPANDED}
  · Risparmio CPU stimato listen: ~${listenSaving.toFixed(0)}%
  · Risparmio CPU stimato fullscreen (45fps): ~${expCalmSaving.toFixed(0)}%
  · FFT ogni 2 frame e pausa fuori viewport non inclusi nel micro-bench
`);
