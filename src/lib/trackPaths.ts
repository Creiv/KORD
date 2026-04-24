export function albumFolderFromTrackRelPath(relPath: string): string {
  const parts = relPath.split("/").filter(Boolean)
  if (parts.length < 2) return ""
  parts.pop()
  return parts.join("/")
}
