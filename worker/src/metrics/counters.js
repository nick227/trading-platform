const counts = new Map()

export function increment(key) {
  counts.set(key, (counts.get(key) ?? 0) + 1)
}

export function getAll() {
  return Object.fromEntries(counts)
}
