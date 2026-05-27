/**
 * RSS da Google News (nessuna API key). Query basata sugli artisti della libreria filtrata per account.
 */

function decodeBasicEntities(s) {
  return String(s || "")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&");
}

function stripTags(html) {
  return decodeBasicEntities(String(html || "").replace(/<[^>]+>/g, " "))
    .replace(/\s+/g, " ")
    .trim();
}

function extractTitle(block) {
  const cd = /<title[^>]*>\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*<\/title>/i.exec(block);
  if (cd?.[1] != null) return stripTags(cd[1]);
  const plain = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(block);
  if (plain?.[1] != null) return stripTags(plain[1]);
  return "";
}

function extractLink(block) {
  const m = /<link[^>]*>([\s\S]*?)<\/link>/i.exec(block);
  const inner = m?.[1]?.trim();
  if (inner) return decodeBasicEntities(inner);
  const attr = /<link\b[^>]*\bhref\s*=\s*"([^"]+)"/i.exec(block);
  return attr?.[1] ? decodeBasicEntities(attr[1].trim()) : "";
}

function extractPubDate(block) {
  const m = /<pubDate[^>]*>([\s\S]*?)<\/pubDate>/i.exec(block);
  return m?.[1]?.trim() || null;
}

function extractSource(block) {
  const m = /<source[^>]*>([\s\S]*?)<\/source>/i.exec(block);
  return m?.[1] ? stripTags(m[1]) : null;
}

function isLikelyImageUrl(u) {
  const s = String(u || "").trim();
  if (!/^https?:\/\//i.test(s)) return false;
  if (/\.(svg)(\?|$)/i.test(s)) return false;
  return true;
}

/**
 * Copertina da Google News RSS: thumbnail in description, media:content, enclosure.
 */
function extractImageUrl(block) {
  let bestUrl = null;
  let bestW = -1;
  const contentTagRe = /<(?:media:)?content\b([^>]*)\/?>/gi;
  let cm;
  while ((cm = contentTagRe.exec(block))) {
    const attrs = cm[1] || "";
    const urlM = /\burl=["']([^"']+)["']/i.exec(attrs);
    const mediumM = /\bmedium=["']([^"']+)["']/i.exec(attrs);
    const typeM = /\btype=["']([^"']+)["']/i.exec(attrs);
    const looksLikeImage =
      (mediumM && /^image$/i.test(mediumM[1])) ||
      (typeM && /^image\//i.test(typeM[1])) ||
      (!mediumM && !typeM);
    if (!urlM || !looksLikeImage) continue;
    const u = decodeBasicEntities(urlM[1].trim());
    if (!isLikelyImageUrl(u)) continue;
    const wM = /\bwidth=["']?(\d+)/i.exec(attrs);
    const w = wM ? Number.parseInt(wM[1], 10) : 0;
    if (w >= bestW) {
      bestW = w;
      bestUrl = u;
    }
  }
  if (bestUrl) return bestUrl;

  const enc = /<enclosure\b([^>]+)\/?>/i.exec(block);
  if (enc?.[1]) {
    const attrs = enc[1];
    const urlM = /\burl=["']([^"']+)["']/i.exec(attrs);
    const typeM = /\btype=["']([^"']+)["']/i.exec(attrs);
    if (
      urlM?.[1] &&
      typeM?.[1] &&
      /^image\//i.test(typeM[1]) &&
      isLikelyImageUrl(urlM[1])
    ) {
      return decodeBasicEntities(urlM[1].trim());
    }
  }

  const imgM =
    /<img\b[^>]*\bsrc=["']([^"']+)["']/i.exec(block) ||
    /<img\b[^>]*\bsrc=([^\s>]+)/i.exec(block);
  if (imgM?.[1]) {
    const u = decodeBasicEntities(String(imgM[1]).replace(/^["']|["']$/g, ""));
    if (isLikelyImageUrl(u)) return u;
  }

  return null;
}

async function mapPool(arr, concurrency, fn) {
  let next = 0;
  async function worker() {
    while (true) {
      const idx = next++;
      if (idx >= arr.length) break;
      await fn(arr[idx], idx);
    }
  }
  const n = Math.min(concurrency, Math.max(1, arr.length));
  await Promise.all(Array.from({ length: n }, () => worker()));
}

/**
 * La pagina HTML degli articoli Google News espone og:image (thumbnail); il feed RSS spesso no.
 */
async function fetchOgImageFromGoogleNewsPage(pageUrl, timeoutMs = 5200) {
  const u = String(pageUrl || "").trim();
  if (!/^https:\/\/news\.google\.com\//i.test(u)) return null;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const r = await fetch(u, {
      redirect: "follow",
      headers: {
        "User-Agent":
          "Mozilla/5.0 (compatible; RE-KORDDiscoverThumb/1.0; +https://local)",
        Accept: "text/html,application/xhtml+xml",
      },
      signal: ctrl.signal,
    });
    if (!r.ok) return null;
    const html = await r.text();
    const m =
      html.match(/property=["']og:image["']\s+content=["']([^"']+)["']/i) ||
      html.match(
        /property=["']og:image:url["']\s+content=["']([^"']+)["']/i,
      ) ||
      html.match(/content=["']([^"']+)["']\s+property=["']og:image["']/i) ||
      html.match(/name=["']twitter:image["']\s+content=["']([^"']+)["']/i);
    const raw = m?.[1]?.trim();
    if (!raw) return null;
    const decoded = decodeBasicEntities(raw);
    return isLikelyImageUrl(decoded) ? decoded : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export async function enrichDiscoverNewsThumbnails(items, opts = {}) {
  const maxItems = opts.maxItems ?? 16;
  const concurrency = opts.concurrency ?? 4;
  const timeoutMs = opts.timeoutMs ?? 5200;
  const slice = items.slice(0, maxItems).filter((it) => it.url && !it.imageUrl);
  await mapPool(slice, concurrency, async (it) => {
    const img = await fetchOgImageFromGoogleNewsPage(it.url, timeoutMs);
    if (img) it.imageUrl = img;
  });
  return items;
}

export function parseGoogleNewsRss(xml, maxItems = 20) {
  const items = [];
  const re = /<item\b[^>]*>([\s\S]*?)<\/item>/gi;
  let m;
  while ((m = re.exec(xml)) && items.length < maxItems) {
    const block = m[1];
    const title = extractTitle(block);
    const url = extractLink(block);
    if (!title || !url) continue;
    items.push({
      title,
      url,
      publishedAt: extractPubDate(block),
      source: extractSource(block),
      imageUrl: extractImageUrl(block),
    });
  }
  return items;
}

export function buildDiscoverNewsQuery(index, locale = "en") {
  const it = locale === "it";
  const fallback = it
    ? "musica nuovo album tour concerto"
    : "music new album tour concert";
  if (!index?.artists?.length) return fallback;
  const sorted = [...index.artists].sort((a, b) => b.trackCount - a.trackCount);
  const picks = sorted
    .slice(0, 6)
    .map((a) => String(a.name || "").trim())
    .filter(Boolean);
  if (!picks.length) return fallback;
  const q = picks.map((n) => `"${n.replace(/"/g, "")}"`).join(" OR ");
  const scope = it
    ? "(album OR tour OR concerto OR musica OR singolo)"
    : "(album OR tour OR release OR concert OR single)";
  return `${q} ${scope}`;
}

export async function fetchDiscoverNewsPayload(index, locale = "en") {
  const hl = locale === "it" ? "it" : "en";
  const gl = locale === "it" ? "IT" : "US";
  const ceid = locale === "it" ? "IT:it" : "US:en";
  const queryUsed = buildDiscoverNewsQuery(index, locale);
  const feedUrl = `https://news.google.com/rss/search?q=${encodeURIComponent(queryUsed)}&hl=${hl}&gl=${gl}&ceid=${encodeURIComponent(ceid)}`;

  const r = await fetch(feedUrl, {
    headers: { "User-Agent": "RE-KORDDiscoverNews/1.0" },
    redirect: "follow",
  });
  if (!r.ok) throw new Error(`News feed HTTP ${r.status}`);
  const xml = await r.text();
  const items = parseGoogleNewsRss(xml);
  await enrichDiscoverNewsThumbnails(items);
  return {
    items,
    queryUsed,
    feedLocale: locale === "it" ? "it" : "en",
  };
}
