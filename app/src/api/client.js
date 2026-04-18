async function handleResponse(response) {
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${response.statusText}`)
  }
  
  const json = await response.json()
  return json.data ?? json
}

export async function request(path, opts = {}) {
  try {
    const response = await fetch(`/api${path}`, {
      headers: { 'Content-Type': 'application/json' },
      ...opts
    })
    return await handleResponse(response)
  } catch (error) {
    console.warn(`API request failed: ${path}`, error)
    throw error
  }
}

export async function get(path, params = {}) {
  try {
    const url = new URL(`${window.location.origin}/api${path}`)
    Object.keys(params).forEach(key => {
      if (params[key] !== undefined && params[key] !== null) {
        url.searchParams.append(key, params[key])
      }
    })
    
    const response = await fetch(url.toString())
    return await handleResponse(response)
  } catch (error) {
    console.warn(`API GET failed: ${path}`, error)
    throw error
  }
}

export async function post(path, data = {}) {
  try {
    const response = await fetch(`/api${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    })
    return await handleResponse(response)
  } catch (error) {
    console.warn(`API POST failed: ${path}`, error)
    throw error
  }
}
