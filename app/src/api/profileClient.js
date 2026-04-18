const mockProfileState = {
  user: { name: 'Demo User', avatar: 'https://picsum.photos/40' },
  alpacaApiKey: ''
}

export function getProfileState() {
  return {
    user: { ...mockProfileState.user },
    alpacaApiKey: mockProfileState.alpacaApiKey
  }
}

export async function loginWithName(name) {
  const nextName = name.trim()
  mockProfileState.user = {
    name: nextName,
    avatar: `https://picsum.photos/seed/${nextName}/40`
  }
  return { ...mockProfileState.user }
}

export async function updateUsername(name) {
  const nextName = name.trim()
  mockProfileState.user = {
    ...mockProfileState.user,
    name: nextName,
    avatar: `https://picsum.photos/seed/${nextName}/40`
  }
  return { ...mockProfileState.user }
}

export async function resetPassword(currentPassword, nextPassword) {
  await Promise.resolve({ currentPassword, nextPassword })
  return true
}

export async function saveAlpacaApiKey(key) {
  mockProfileState.alpacaApiKey = key.trim()
  return mockProfileState.alpacaApiKey
}

export async function testAlpacaApiKey(key) {
  const normalizedKey = key.trim()
  await Promise.resolve(normalizedKey)
  return normalizedKey.length >= 8
}
