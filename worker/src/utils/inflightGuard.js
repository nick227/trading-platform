/**
 * Acquires an inflight lock for `key` before calling `fn`, then releases it
 * based on the outcome:
 *
 *   fn resolves            → lock kept  (the work completed; a downstream clear will release it)
 *   fn rejects, keepLockOn → lock kept  (a real conflicting operation exists; caller handles error)
 *   fn rejects, other      → lock released  (transient failure; caller retries next cycle)
 *   unexpected throw       → lock released via finally  (no stuck locks on process errors)
 *
 * @param {Map}      map         - the shared inflight map (e.g. inflightMap in botEngine)
 * @param {string}   key         - the lock key
 * @param {Function} fn          - async work to perform under the lock
 * @param {Object}   [opts]
 * @param {Function} [opts.keepLockOn] - predicate(err) → true means keep the lock on that error
 */
export async function withInflightLock(map, key, fn, { keepLockOn } = {}) {
  map.set(key, true)
  let release = true
  try {
    await fn()
    release = false
  } catch (err) {
    if (keepLockOn?.(err)) release = false
    throw err
  } finally {
    if (release) map.delete(key)
  }
}
