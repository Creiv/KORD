/**
 * Se più chiamate concorrenti chiedono la stessa chiave mentre `create()`
 * produce ancora una Promise in corso, tutte ricevono la stessa Promise.
 * Dopo il completamento la entry viene tolta dalla mappa.
 */
export function reuseKeyedPromise(map, key, create) {
  let p = map.get(key)
  if (p) return p
  p = create()
  map.set(key, p)
  p.finally(() => {
    if (map.get(key) === p) map.delete(key)
  })
  return p
}
