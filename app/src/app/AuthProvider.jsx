import { createContext, useContext, useState } from 'react'
import {
  getProfileState,
  loginWithName,
  resetPassword as resetPasswordMock,
  saveAlpacaApiKey as saveAlpacaApiKeyMock,
  testAlpacaApiKey as testAlpacaApiKeyMock,
  updateUsername as updateUsernameMock
} from '../api/profileClient'

const AuthCtx = createContext()

export function AuthProvider({ children }) {
  const initialProfile = getProfileState()
  const [user, setUser] = useState(initialProfile.user)
  const [alpacaApiKey, setAlpacaApiKey] = useState(initialProfile.alpacaApiKey)

  const login = async (name) => {
    const nextUser = await loginWithName(name)
    setUser(nextUser)
  }

  const updateUsername = async (name) => {
    const nextUser = await updateUsernameMock(name)
    setUser(nextUser)
  }

  const resetPassword = async (currentPassword, nextPassword) => {
    return resetPasswordMock(currentPassword, nextPassword)
  }

  const saveAlpacaApiKey = async (key) => {
    const savedKey = await saveAlpacaApiKeyMock(key)
    setAlpacaApiKey(savedKey)
  }

  const testAlpacaApiKey = async (key) => {
    return testAlpacaApiKeyMock(key)
  }

  const logout = () => setUser(null)

  return (
    <AuthCtx.Provider
      value={{
        user,
        alpacaApiKey,
        login,
        logout,
        updateUsername,
        resetPassword,
        saveAlpacaApiKey,
        testAlpacaApiKey
      }}
    >
      {children}
    </AuthCtx.Provider>
  )
}

export const useAuth = () => useContext(AuthCtx)
