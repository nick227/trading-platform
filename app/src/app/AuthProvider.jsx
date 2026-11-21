import { createContext, useContext, useState, useEffect } from 'react'
import {
  getSessionUser,
  loginWithCredentials,
  registerWithCredentials,
  logoutFromServer,
  saveBrokerCredentials,
  disconnectBroker as disconnectBrokerAPI,
  getBrokerStatus,
  resetPassword as resetPasswordAPI,
} from '../api/profileClient'

const AuthCtx = createContext()

export function AuthProvider({ children }) {
  const [user,          setUser]          = useState(null)
  const [brokerStatus,  setBrokerStatus]  = useState(null) // { connected, paper, status }
  const [sessionLoading, setSessionLoading] = useState(true)
  // Distinguishes "not known yet" / "request failed" from "no account connected".
  const [brokerStatusLoading, setBrokerStatusLoading] = useState(true)
  const [brokerStatusError, setBrokerStatusError] = useState(false)

  const loadBrokerStatus = async () => {
    setBrokerStatusLoading(true)
    setBrokerStatusError(false)
    try {
      const status = await getBrokerStatus()
      setBrokerStatus(status)
      return status
    } catch {
      setBrokerStatusError(true)
      return null
    } finally {
      setBrokerStatusLoading(false)
    }
  }

  // Restore session from httpOnly cookie on mount
  useEffect(() => {
    getSessionUser()
      .then(u => {
        if (u) {
          setUser(u)
          loadBrokerStatus()
        } else {
          setBrokerStatusLoading(false)
        }
      })
      .catch(() => setBrokerStatusLoading(false))
      .finally(() => setSessionLoading(false))
  }, [])

  const login = async (email, password) => {
    const u = await loginWithCredentials(email, password)
    setUser(u)
    loadBrokerStatus()
    return u
  }

  const register = async (email, password, fullName) => {
    const u = await registerWithCredentials(email, password, fullName)
    setUser(u)
    loadBrokerStatus()
    return u
  }

  const logout = async () => {
    await logoutFromServer().catch(() => {})
    setUser(null)
    setBrokerStatus(null)
    setBrokerStatusError(false)
    setBrokerStatusLoading(false)
  }

  const saveAlpacaKeys = async (apiKey, apiSecret, paper = true) => {
    const result = await saveBrokerCredentials(apiKey, apiSecret, paper)
    await loadBrokerStatus()
    return result
  }

  const disconnectBroker = async () => {
    const result = await disconnectBrokerAPI()
    await loadBrokerStatus()
    return result
  }

  const refreshBrokerStatus = () => loadBrokerStatus()

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
        brokerStatusLoading,
        brokerStatusError,
        sessionLoading,
        login,
        register,
        logout,
        saveAlpacaKeys,
        disconnectBroker,
        refreshBrokerStatus,
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
