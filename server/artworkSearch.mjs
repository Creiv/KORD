const UA = "Kord/1.0 (https://github.com/local)"

function pushUnique(out, seen, item) {
  if (!item.artwork || seen.has(item.artwork)) return
  seen.add(item.artwork)
  out.push(item)
  return out.length
}

export async function aggregateArtworkSearch(terms) {
  const out = []
  const seen = new Set()

  for (const term of terms) {
    if (out.length >= 32) break
    if (!term || term.length < 2) continue
    const it = `https://itunes.apple.com/search?term=${encodeURIComponent(term)}&entity=album&limit=18&country=it`
    try {
      const r = await fetch(it, { headers: { "User-Agent": UA } })
      if (r.ok) {
        const j = await r.json()
        for (const x of j.results || []) {
          const art = String(x.artworkUrl100 || "").replace(
            /100x100bb/g,
            "600x600bb",
          )
          if (!art) continue
          const n = pushUnique(
            out,
            seen,
            {
              name: x.collectionName,
              artist: x.artistName,
              artwork: art,
              url: x.collectionViewUrl || "",
              source: "itunes",
            },
          )
          if (n >= 32) return out
        }
      }
    } catch {
      /* ignore */
    }
  }

  for (const term of terms) {
    if (out.length >= 36) break
    if (!term || term.length < 2) continue
    const du = `https://api.deezer.com/search/album?q=${encodeURIComponent(
      term,
    )}&limit=20`
    try {
      const r = await fetch(du, { headers: { "User-Agent": UA } })
      if (r.ok) {
        const j = await r.json()
        for (const a of j.data || []) {
          const art = String(
            a.cover_xl || a.cover_big || a.cover_medium || "",
          )
          if (!art) continue
          const n = pushUnique(
            out,
            seen,
            {
              name: a.title,
              artist: a.artist?.name || "",
              artwork: art,
              url: a.link || "https://www.deezer.com",
              source: "deezer",
            },
          )
          if (n >= 36) return out
        }
      }
    } catch {
      /* ignore */
    }
  }

  for (const term of terms.slice(0, 2)) {
    if (out.length >= 40) break
    if (!term || term.length < 3) continue
    const mb = `https://musicbrainz.org/ws/2/release/?query=${encodeURIComponent(
      term,
    )}&fmt=json&limit=4`
    try {
      const r = await fetch(mb, { headers: { "User-Agent": UA } })
      if (r.ok) {
        const j = await r.json()
        for (const rel of j.releases || []) {
          if (!rel.id) continue
          const ac0 = rel["artist-credit"]?.[0]
          const aName = ac0?.name || ac0?.artist?.name || "—"
          const front = `https://coverartarchive.org/release/${rel.id}/front-500`
          const n = pushUnique(
            out,
            seen,
            {
              name: rel.title,
              artist: aName,
              artwork: front,
              url: `https://musicbrainz.org/release/${rel.id}`,
              source: "coverart",
            },
          )
          if (n >= 40) return out
        }
      }
    } catch {
      /* ignore */
    }
  }

  return out
}
