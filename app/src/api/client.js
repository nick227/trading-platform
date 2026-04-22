function buildUrl(path, params = {}) {
  // Point to backend server on port 3001
  const baseUrl = process.env.NODE_ENV === 'production' 
    ? `${window.location.origin}/api`
    : 'http://localhost:3001/api'
  
  const url = new URL(`${baseUrl}${path}`)
  for (const [key, val] of Object.entries(params)) {
    if (val !== undefined && val !== null) url.searchParams.append(key, val)
  }
  return url.toString()
}

async function handleResponse(response) {
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${response.statusText}`)
  }
  const json = await response.json()
  return json.data ?? json
}

// GET — unwraps { data } envelope, discards pagination.
export async function get(path, params = {}) {
  try {
    const response = await fetch(buildUrl(path, params), {
      credentials: 'include'
    })
    return await handleResponse(response)
  } catch (error) {
    console.warn(`API GET failed: ${path}`, error)
    throw error
  }
}

// GET — returns full response including { data, pagination }.
// Use when you need to paginate or inspect the pagination wrapper.
export async function getPage(path, params = {}) {
  try {
    const response = await fetch(buildUrl(path, params), {
      credentials: 'include'
    })
    if (!response.ok) throw new Error(`HTTP ${response.status}: ${response.statusText}`)
    return response.json()
  } catch (error) {
    console.warn(`API getPage failed: ${path}`, error)
    throw error
  }
}

export async function post(path, data = {}) {
  try {
    const response = await fetch(buildUrl(path), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify(data)
    })
    return await handleResponse(response)
  } catch (error) {
    console.warn(`API POST failed: ${path}`, error)
    throw error
  }
}

export async function put(path, data = {}) {
  try {
    const response = await fetch(buildUrl(path), {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify(data)
    })
    return await handleResponse(response)
  } catch (error) {
    console.warn(`API PUT failed: ${path}`, error)
    throw error
  }
}

export async function del(path) {
  try {
    const response = await fetch(buildUrl(path), { 
      method: 'DELETE',
      credentials: 'include'
    })
    if (!response.ok) throw new Error(`HTTP ${response.status}: ${response.statusText}`)
    return response.status === 204 ? null : response.json()
  } catch (error) {
    console.warn(`API DELETE failed: ${path}`, error)
    throw error
  }
}
