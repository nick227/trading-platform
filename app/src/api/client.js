export async function request(path, opts = {}) {
  const response = await fetch(`/api${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...opts
  })
  const json = await response.json()
  return json.data ?? json
}

export async function get(path, params = {}) {
  const url = new URL(`${window.location.origin}/api${path}`)
  Object.keys(params).forEach(key => url.searchParams.append(key, params[key]))
  
  const response = await fetch(url.toString())
  const json = await response.json()
  return json.data ?? json
}

export async function post(path, data = {}) {
  const response = await fetch(`/api${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data)
  })
  const json = await response.json()
  return json.data ?? json
}
