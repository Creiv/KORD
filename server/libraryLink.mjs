import fs from "fs/promises"
import { existsSync, statSync } from "fs"
import path from "path"
import { isAudioFile, coverCandidates } from "./musicLibrary.mjs"
import { getMusicRootForAccountStrict } from "./musicRootConfig.mjs"

function sanitizeAlbumObjectForSync(src) {
  if (!src || typeof src !== "object") return null
  const o = { ...src }
  const hadEdited = Boolean(o.editedAt)
  const hadFetched = Boolean(o.fetchedAt)
  delete o.editedAt
  if (hadEdited && !hadFetched) {
    delete o.title
    delete o.name
  }
  return o
}

function sanitizeTrackObjectForSync(orig) {
  if (!orig || typeof orig !== "object") return null
  const hadEdited = Boolean(orig.editedAt)
  const hadFetched = Boolean(orig.fetchedAt)
  const o = { ...orig }
  delete o.editedAt
  if (hadEdited && !hadFetched) {
    delete o.title
  }
  return o
}

/**
 * Copia kord-albuminfo / kord-trackinfo dalla sorgente: passa i metadati “da fetch”,
 * esclude modifiche manuali (editedAt) e titoli impostati solo a mano senza fetch.
 */
async function copyLinkedAlbumMetadata({ sourceAlbumDir, destAlbumDir, audioFileNames }) {
  const alK = path.join(sourceAlbumDir, "kord-albuminfo.json")
  const alW = path.join(sourceAlbumDir, "wpp-albuminfo.json")
  const alSrc = existsSync(alK) ? alK : existsSync(alW) ? alW : null
  if (alSrc) {
    try {
      const raw = await fs.readFile(alSrc, "utf8")
      const j = JSON.parse(raw)
      if (j && typeof j === "object") {
        const clean = sanitizeAlbumObjectForSync(j)
        if (clean && Object.keys(clean).length > 0) {
          await fs.writeFile(
            path.join(destAlbumDir, "kord-albuminfo.json"),
            JSON.stringify(clean, null, 2),
            "utf8",
          )
        }
      }
    } catch {
      /* ignore */
    }
  }
  const trK = path.join(sourceAlbumDir, "kord-trackinfo.json")
  const trW = path.join(sourceAlbumDir, "wpp-trackinfo.json")
  const trSrc = existsSync(trK) ? trK : existsSync(trW) ? trW : null
  if (trSrc) {
    try {
      const raw = await fs.readFile(trSrc, "utf8")
      const j = JSON.parse(raw)
      if (j && typeof j === "object") {
        const out = {}
        for (const name of audioFileNames) {
          const e = j[name]
          if (!e || typeof e !== "object") continue
          const t = sanitizeTrackObjectForSync(e)
          if (t && Object.keys(t).length) out[name] = t
        }
        if (Object.keys(out).length > 0) {
          await fs.writeFile(
            path.join(destAlbumDir, "kord-trackinfo.json"),
            JSON.stringify(out, null, 2),
            "utf8",
          )
        }
      }
    } catch {
      /* ignore */
    }
  }
}

function safeAlbumRelPath(value) {
  const normalized = String(value || "")
    .replace(/\\/g, "/")
    .replace(/^\/+/, "")
    .replace(/\/+$/, "")
  for (const seg of normalized.split("/")) {
    if (seg === ".." || seg === "." || !seg) return null
  }
  const parts = normalized.split("/").filter(Boolean)
  if (parts.length < 2) return null
  for (const p of parts) {
    if (p.toLowerCase() === "kord" || p.startsWith(".")) return null
  }
  return parts.join("/")
}

function safeArtistRelPath(value) {
  const s = String(value || "")
    .replace(/\\/g, "/")
    .replace(/^\/+/, "")
    .replace(/\/+$/, "")
  if (s.includes("/") || !s) return null
  if (s === "." || s === "..") return null
  if (s.toLowerCase() === "kord" || s.startsWith(".")) return null
  return s
}

/**
 * Collega tutte le sottocartelle album sotto l’artista sorgente (stesso criterio di `linkSharedAlbumFromDirs` per ciascuna).
 */
export async function linkSharedArtistFromDirs({
  sourceAccountId,
  destAccountId,
  sourceRoot,
  destRoot,
  artistName,
}) {
  if (String(sourceAccountId) === String(destAccountId)) {
    const e = new Error("L’account sorgente e quello attuale devono essere diversi.")
    e.code = "SAME_ACCOUNT"
    throw e
  }
  const r = path.resolve(sourceRoot)
  const d0 = path.resolve(destRoot)
  if (r === d0) {
    const e = new Error("Le cartelle Musica sorgente e destinazione coincidono.")
    e.code = "SAME_ROOT"
    throw e
  }

  const artist = safeArtistRelPath(artistName)
  if (!artist) {
    const e = new Error("Nome artista non valido.")
    e.code = "INVALID_REL"
    throw e
  }

  const sourceArtistDir = path.join(r, artist)
  if (!existsSync(sourceArtistDir)) {
    const e = new Error("Cartella artista sorgente non trovata.")
    e.code = "NOT_FOUND"
    throw e
  }
  if (!statSync(sourceArtistDir).isDirectory()) {
    const e = new Error("La sorgente non è una cartella.")
    e.code = "NOT_DIR"
    throw e
  }

  const subs = await fs.readdir(sourceArtistDir, { withFileTypes: true })
  const relPaths = []
  for (const sub of subs) {
    if (!sub.isDirectory() || sub.name.startsWith(".")) continue
    relPaths.push(`${artist}/${sub.name}`.replaceAll(path.sep, "/"))
  }
  if (!relPaths.length) {
    const e = new Error("Nessun album in questa cartella artista.")
    e.code = "NO_ALBUMS"
    throw e
  }

  const albums = []
  const errors = []
  let totalLinked = 0
  let totalSkipped = 0
  for (const rel of relPaths.sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))) {
    try {
      const one = await linkSharedAlbumFromDirs({
        sourceAccountId,
        destAccountId,
        sourceRoot: r,
        destRoot: d0,
        relPath: rel,
      })
      albums.push({
        destRelPath: one.destRelPath,
        linked: one.linked,
        skipped: one.skipped,
        linkManifestPath: one.linkManifestPath,
      })
      totalLinked += one.linked
      totalSkipped += one.skipped
    } catch (err) {
      const c = err?.code
      if (
        c === "NO_AUDIO" ||
        c === "DEST_EXISTS" ||
        c === "CLASH" ||
        c === "INVALID_REL"
      ) {
        errors.push({ relPath: rel, error: String(err?.message || err), code: c })
        continue
      }
      throw err
    }
  }

  if (!albums.length) {
    const e = new Error("Nessun album è stato collegato (tutte le cartelle hanno dato errore o sono senza audio).")
    e.code = "ARTIST_NOTHING_LINKED"
    e.details = errors
    throw e
  }

  return {
    scope: "artist",
    artist: artist,
    albums,
    errors: errors.length ? errors : undefined,
    totalLinked,
    totalSkipped,
  }
}

/**
 * Crea sotto `destRoot` la cartella album con symlink ai file audio (e copertine) di `sourceAlbumDir`.
 * Copia kord-albuminfo / kord-trackinfo sanificati (niente favoriti/blocchi: restano nello user state).
 * Scrive `.kord/linked-source.json` come rimando.
 */
export async function linkSharedAlbumFromDirs({
  sourceAccountId,
  destAccountId,
  sourceRoot,
  destRoot,
  relPath,
}) {
  const rel = safeAlbumRelPath(relPath)
  if (!rel) {
    const e = new Error("Invalid relPath (serve cartella Artista/Album valida).")
    e.code = "INVALID_REL"
    throw e
  }
  if (String(sourceAccountId) === String(destAccountId)) {
    const e = new Error("L’account sorgente e quello attuale devono essere diversi.")
    e.code = "SAME_ACCOUNT"
    throw e
  }
  const r = path.resolve(sourceRoot)
  const d0 = path.resolve(destRoot)
  if (r === d0) {
    const e = new Error("Le cartelle Musica sorgente e destinazione coincidono.")
    e.code = "SAME_ROOT"
    throw e
  }

  const sourceAlbumDir = path.join(r, rel.replaceAll("/", path.sep))
  if (!existsSync(sourceAlbumDir)) {
    const e = new Error("Cartella album sorgente non trovata.")
    e.code = "NOT_FOUND"
    throw e
  }
  if (!statSync(sourceAlbumDir).isDirectory()) {
    const e = new Error("Il percorso sorgente non è una cartella.")
    e.code = "NOT_DIR"
    throw e
  }

  const destAlbumDir = path.join(d0, rel.replaceAll("/", path.sep))
  const destKord = path.join(destAlbumDir, ".kord")
  const manifest = path.join(destKord, "linked-source.json")

  if (existsSync(destAlbumDir) && !existsSync(manifest)) {
    const e = new Error(
      "La cartella destinazione esiste già. Rinomina o rimuovila, oppure l’album è già collegato altrove."
    )
    e.code = "DEST_EXISTS"
    throw e
  }

  await fs.mkdir(destAlbumDir, { recursive: true })
  const entries = await fs.readdir(sourceAlbumDir, { withFileTypes: true })
  const audioNames = []
  for (const ent of entries) {
    if (!isAudioFile(ent.name)) continue
    const full = path.join(sourceAlbumDir, ent.name)
    let isFile
    if (ent.isFile()) isFile = true
    else if (ent.isSymbolicLink()) {
      try {
        isFile = statSync(full).isFile()
      } catch {
        isFile = false
      }
    } else isFile = false
    if (isFile) audioNames.push(ent.name)
  }
  if (!audioNames.length) {
    const e = new Error("Nessun file audio in questa cartella sorgente.")
    e.code = "NO_AUDIO"
    throw e
  }

  await fs.mkdir(destKord, { recursive: true })

  let linked = 0
  let skipped = 0
  for (const name of audioNames) {
    const targetAbs = path.join(sourceAlbumDir, name)
    const linkPath = path.join(destAlbumDir, name)
    if (existsSync(linkPath)) {
      if (statSync(linkPath).isSymbolicLink()) {
        try {
          const cur = await fs.readlink(linkPath)
          const want = path.isAbsolute(cur) ? cur : path.resolve(path.dirname(linkPath), cur)
          if (path.resolve(want) === path.resolve(targetAbs)) {
            skipped += 1
            continue
          }
        } catch {
          /* fallthrough */
        }
      }
      const e = new Error(`Esiste già un file diverso: ${name}`)
      e.code = "CLASH"
      throw e
    }
    await fs.symlink(targetAbs, linkPath, "file")
    linked += 1
  }

  for (const c of coverCandidates()) {
    const srcC = path.join(sourceAlbumDir, c)
    const dstC = path.join(destAlbumDir, c)
    if (!existsSync(srcC) || existsSync(dstC)) continue
    try {
      if (!statSync(srcC).isFile()) continue
    } catch {
      continue
    }
    await fs.symlink(path.resolve(srcC), dstC, "file")
  }

  await copyLinkedAlbumMetadata({
    sourceAlbumDir,
    destAlbumDir,
    audioFileNames: audioNames,
  })

  const payload = {
    v: 1,
    sourceAccountId: String(sourceAccountId),
    destAccountId: String(destAccountId),
    sourceRelPath: rel.replaceAll(path.sep, "/"),
    sourceMusicRoot: r,
    createdAt: new Date().toISOString(),
  }
  await fs.writeFile(manifest, JSON.stringify(payload, null, 2), "utf8")

  return {
    scope: "album",
    linked,
    skipped,
    destRelPath: rel.replaceAll(path.sep, "/"),
    linkManifestPath: ".kord/linked-source.json",
  }
}

export async function linkSharedAlbumForAccounts(reqBody, destAccountId) {
  const sourceAccountId = String(reqBody?.sourceAccountId || "").trim()
  const relPath = String(reqBody?.relPath || "").trim()
  const scope = String(reqBody?.scope || "album").toLowerCase()
  if (!sourceAccountId) {
    const e = new Error("sourceAccountId mancante.")
    e.code = "BAD_BODY"
    throw e
  }
  if (!relPath) {
    const e = new Error("relPath mancante (Artista/Album o solo nome artista).")
    e.code = "BAD_BODY"
    throw e
  }
  const dRoot = getMusicRootForAccountStrict(destAccountId)
  const sRoot = getMusicRootForAccountStrict(sourceAccountId)
  if (scope === "artist") {
    return linkSharedArtistFromDirs({
      sourceAccountId,
      destAccountId,
      sourceRoot: sRoot,
      destRoot: dRoot,
      artistName: relPath,
    })
  }
  return linkSharedAlbumFromDirs({
    sourceAccountId,
    destAccountId,
    sourceRoot: sRoot,
    destRoot: dRoot,
    relPath,
  })
}
