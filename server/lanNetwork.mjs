import os from "os";

/** @typedef {{ addr: string; score: number; iface: string }} LanIPv4Candidate */

const VIRTUAL_IFACE_RE =
  /^(lo|loopback|vethernet|vEthernet|wsl|hyper-v|vmware|virtualbox|virtual|docker|npcap|bluetooth|tailscale|zerotier|hamachi|tap-|tun-)/i;

function isIPv4Family(family) {
  return family === "IPv4" || family === 4;
}

export function scoreLanIPv4(addr) {
  const p = String(addr).split(".");
  if (p.length !== 4) return 0;
  const a0 = Number(p[0]);
  const a1 = Number(p[1]);
  if (a0 === 10) return 80;
  if (a0 === 192 && a1 === 168) return 100;
  if (a0 === 172 && a1 >= 16 && a1 <= 31) return 40;
  if (a0 === 169 && a1 === 254) return 5;
  if (a0 === 100 && a1 >= 64 && a1 <= 127) return 20;
  if (a0 === 127) return 0;
  return 15;
}

function ifaceBonus(name) {
  const n = String(name || "");
  if (VIRTUAL_IFACE_RE.test(n)) return -60;
  if (/^(ethernet|eth|en\d|wi-?fi|wlan|wireless)/i.test(n)) return 12;
  return 0;
}

/**
 * IPv4 LAN candidates, best first. Skips loopback and common virtual NICs on Windows.
 * @returns {LanIPv4Candidate[]}
 */
export function listLanIPv4Candidates() {
  const nets = os.networkInterfaces();
  /** @type {LanIPv4Candidate[]} */
  const cands = [];
  for (const iface of Object.keys(nets)) {
    const bonus = ifaceBonus(iface);
    for (const net of nets[iface] || []) {
      if (!isIPv4Family(net.family) || net.internal) continue;
      const addr = String(net.address || "").trim();
      if (!addr || addr === "0.0.0.0") continue;
      const score = scoreLanIPv4(addr) + bonus;
      if (score <= 0) continue;
      cands.push({ addr, score, iface });
    }
  }
  cands.sort((a, b) => b.score - a.score);
  const seen = new Set();
  return cands.filter((c) => {
    if (seen.has(c.addr)) return false;
    seen.add(c.addr);
    return true;
  });
}

/** Best-effort primary IPv4 for LAN access hints. */
export function guessLanIPv4() {
  return listLanIPv4Candidates()[0]?.addr ?? null;
}

export function buildLanAccessUrl(ip, port) {
  if (!ip) return null;
  const p = Number(port);
  if (!Number.isFinite(p) || p < 1 || p > 65535) return null;
  return `http://${ip}:${Math.floor(p)}`;
}

export function buildLanAccessUrls(port) {
  return listLanIPv4Candidates()
    .map((c) => buildLanAccessUrl(c.addr, port))
    .filter(Boolean);
}
