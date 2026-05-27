import fs from "fs"
import path from "path"

const TRACKINFO_CANDIDATES = [
  "kord-trackinfo.json",
  "wpp-trackinfo.json",
  "rekord-trackinfo.json",
]

/** Percorso file trackinfo da leggere (kord, wpp o rename errato), o null. */
export function existingAlbumTrackInfoPath(albumDir) {
  for (const name of TRACKINFO_CANDIDATES) {
    const p = path.join(albumDir, name)
    if (fs.existsSync(p)) return p
  }
  return null
}

/** Percorso per scrittura trackinfo (nome storico). */
export function preferredAlbumTrackInfoPath(albumDir) {
  return path.join(albumDir, "kord-trackinfo.json")
}
