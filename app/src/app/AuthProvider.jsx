import { createContext, useContext, useState, useEffect } from 'react'
import {
  getSessionUser,
  loginWithCredentials,
  registerWithCredentials,
  logoutFromServer,
  saveBrokerCredentials,
  getBrokerStatus,
  resetPassword as resetPasswordAPI,
} from '../api/profileClient'

const AuthCtx = createContext()

export function AuthProvider({ children }) {
  const [user,          setUser]          = useState(null)
  const [brokerStatus,  setBrokerStatus]  = useState(null) // { connected, paper, status }
  const [sessionLoading, setSessionLoading] = useState(true)

  // Restore session from httpOnly cookie on mount
  useEffect(() => {
    getSessionUser()
      .then(u => {
        if (u) {
          setUser(u)
          getBrokerStatus().then(setBrokerStatus).catch(() => {})
        }
      })
      .finally(() => setSessionLoading(false))
  }, [])

  const login = async (email, password) => {
    const u = await loginWithCredentials(email, password)
    setUser(u)
    getBrokerStatus().then(setBrokerStatus).catch(() => {})
    return u
  }

  const register = async (email, password, fullName) => {
    const u = await registerWithCredentials(email, password, fullName)
    setUser(u)
    return u
  }

  const logout = async () => {
    await logoutFromServer().catch(() => {})
    setUser(null)
    setBrokerStatus(null)
  }

  const saveAlpacaKeys = async (apiKey, apiSecret, paper = true) => {
    const result = await saveBrokerCredentials(apiKey, apiSecret, paper)
    const status = await getBrokerStatus()
    setBrokerStatus(status)
    return result
  }

  const resetPassword = async (currentPassword, nextPassword) => {
    return resetPasswordAPI(currentPassword, nextPassword)
  }

  // Legacy shim — some pages call login(name) with a single string argument.
  // Those will receive a clear error rather than a silent no-op.
  const loginLegacy = async (nameOrEmail) => {
    if (!nameOrEmail.includes('@')) {
      throw new Error('Please use your email address to log in.')
    }
    return login(nameOrEmail, '')
  }

  return (
    <AuthCtx.Provider
      value={{
        user,
        brokerStatus,
        sessionLoading,
        login,
        register,
        logout,
        saveAlpacaKeys,
        resetPassword,
        // kept for any components that still use the old shape
        alpacaApiKey: brokerStatus?.connected ? '••••••••' : '',
      }}
    >
      {children}
    </AuthCtx.Provider>
  )
}

export const useAuth = () => useContext(AuthCtx)
