const profileState = {
  user: { name: 'Demo User', avatar: 'https://picsum.photos/40' },
  alpacaApiKey: ''
}

export function getProfileState() {
  return {
    user: { ...profileState.user },
    alpacaApiKey: profileState.alpacaApiKey
  }
}

export async function loginWithName(name) {
  const nextName = name.trim()
  profileState.user = {
    name: nextName,
    avatar: `https://picsum.photos/seed/${nextName}/40`
  }
  return { ...profileState.user }
}

export async function updateUsername(name) {
  const nextName = name.trim()
  profileState.user = {
    ...profileState.user,
    name: nextName,
    avatar: `https://picsum.photos/seed/${nextName}/40`
  }
  return { ...profileState.user }
}

export async function resetPassword(currentPassword, nextPassword) {
  // Stub implementation - no real password reset
  return true
}

export async function saveAlpacaApiKey(key) {
  profileState.alpacaApiKey = key.trim()
  return profileState.alpacaApiKey
}

export async function testAlpacaApiKey(key) {
  // Stub implementation - always returns valid for demo
  return true
}
