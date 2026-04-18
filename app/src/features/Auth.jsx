import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../app/AuthProvider'

export default function Auth() {
  const { login } = useAuth()
  const navigate = useNavigate()
  const [isLogin, setIsLogin] = useState(true)
  const [formData, setFormData] = useState({
    email: '',
    password: '',
    fullName: ''
  })

  const handleInputChange = (e) => {
    setFormData({
      ...formData,
      [e.target.name]: e.target.value
    })
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    // For demo purposes, we'll just login with the email
    await login(formData.email || formData.fullName || 'Demo User')
    navigate('/')
  }

  const handleGoogleAuth = async () => {
    await login('Google User')
    navigate('/')
  }

  const toggleMode = () => {
    setIsLogin(!isLogin)
    setFormData({ email: '', password: '', fullName: '' })
  }

  return (
    <div style={{ 
      minHeight: '100vh', 
      display: 'flex', 
      alignItems: 'center', 
      justifyContent: 'center',
      background: 'linear-gradient(135deg, #f8f9fa 0%, #e9ecef 100%)',
      padding: '1rem'
    }}>
      <div style={{ 
        width: '100%', 
        maxWidth: '400px',
        background: 'white',
        borderRadius: '16px',
        boxShadow: '0 8px 32px rgba(0,0,0,0.08)',
        overflow: 'hidden'
      }}>
        {/* Mode Toggle */}
        <div style={{ 
          display: 'flex', 
          background: '#f8f9fa',
          borderBottom: '1px solid #e9ecef'
        }}>
          <button
            style={{
              flex: 1,
              padding: '1rem',
              border: 'none',
              background: isLogin ? 'white' : 'transparent',
              color: isLogin ? '#111' : '#7a7a7a',
              fontWeight: isLogin ? 600 : 400,
              cursor: 'pointer',
              transition: 'all 0.2s ease'
            }}
            onClick={() => setIsLogin(true)}
          >
            Login
          </button>
          <button
            style={{
              flex: 1,
              padding: '1rem',
              border: 'none',
              background: !isLogin ? 'white' : 'transparent',
              color: !isLogin ? '#111' : '#7a7a7a',
              fontWeight: !isLogin ? 600 : 400,
              cursor: 'pointer',
              transition: 'all 0.2s ease'
            }}
            onClick={() => setIsLogin(false)}
          >
            Register
          </button>
        </div>

        {/* Form Content */}
        <div style={{ padding: '2rem' }}>
          <div style={{ textAlign: 'center', marginBottom: '2rem' }}>
            <h1 style={{ 
              margin: 0, 
              fontSize: '28px', 
              fontWeight: 700, 
              color: '#111',
              marginBottom: '0.5rem'
            }}>
              {isLogin ? 'Welcome back' : 'Create account'}
            </h1>
            <p style={{ 
              margin: 0, 
              fontSize: '14px', 
              color: '#7a7a7a',
              lineHeight: 1.4
            }}>
              {isLogin 
                ? 'Sign in to access your portfolio and trading bots'
                : 'Get started with algorithmic trading and portfolio management'
              }
            </p>
          </div>

          <form onSubmit={handleSubmit} style={{ marginBottom: '1.5rem' }}>
            {/* Full Name Field (Register Only) */}
            {!isLogin && (
              <div style={{ marginBottom: '1rem' }}>
                <label style={{ 
                  display: 'block', 
                  fontSize: '12px', 
                  fontWeight: 600, 
                  color: '#111', 
                  marginBottom: '0.5rem' 
                }}>
                  Full Name
                </label>
                <input
                  type="text"
                  name="fullName"
                  value={formData.fullName}
                  onChange={handleInputChange}
                  placeholder="Enter your full name"
                  required={!isLogin}
                  style={{
                    width: '100%',
                    padding: '0.75rem',
                    border: '1px solid #e9ecef',
                    borderRadius: '8px',
                    fontSize: '14px',
                    outline: 'none',
                    transition: 'border-color 0.2s ease',
                    boxSizing: 'border-box'
                  }}
                  onFocus={(e) => e.target.style.borderColor = '#1f8a4c'}
                  onBlur={(e) => e.target.style.borderColor = '#e9ecef'}
                />
              </div>
            )}

            {/* Email Field */}
            <div style={{ marginBottom: '1rem' }}>
              <label style={{ 
                display: 'block', 
                fontSize: '12px', 
                fontWeight: 600, 
                color: '#111', 
                marginBottom: '0.5rem' 
              }}>
                Email Address
              </label>
              <input
                type="email"
                name="email"
                value={formData.email}
                onChange={handleInputChange}
                placeholder="Enter your email"
                required
                style={{
                  width: '100%',
                  padding: '0.75rem',
                  border: '1px solid #e9ecef',
                  borderRadius: '8px',
                  fontSize: '14px',
                  outline: 'none',
                  transition: 'border-color 0.2s ease',
                  boxSizing: 'border-box'
                }}
                onFocus={(e) => e.target.style.borderColor = '#1f8a4c'}
                onBlur={(e) => e.target.style.borderColor = '#e9ecef'}
              />
            </div>

            {/* Password Field */}
            <div style={{ marginBottom: '1.5rem' }}>
              <label style={{ 
                display: 'block', 
                fontSize: '12px', 
                fontWeight: 600, 
                color: '#111', 
                marginBottom: '0.5rem' 
              }}>
                Password
              </label>
              <input
                type="password"
                name="password"
                value={formData.password}
                onChange={handleInputChange}
                placeholder="Enter your password"
                required
                style={{
                  width: '100%',
                  padding: '0.75rem',
                  border: '1px solid #e9ecef',
                  borderRadius: '8px',
                  fontSize: '14px',
                  outline: 'none',
                  transition: 'border-color 0.2s ease',
                  boxSizing: 'border-box'
                }}
                onFocus={(e) => e.target.style.borderColor = '#1f8a4c'}
                onBlur={(e) => e.target.style.borderColor = '#e9ecef'}
              />
            </div>

            {/* Submit Button */}
            <button
              type="submit"
              className="primary pressable"
              style={{
                width: '100%',
                padding: '0.875rem',
                border: 'none',
                borderRadius: '8px',
                fontSize: '14px',
                fontWeight: 600,
                cursor: 'pointer',
                marginBottom: '1rem'
              }}
            >
              {isLogin ? 'Sign In' : 'Create Account'}
            </button>
          </form>

          {/* Divider */}
          <div style={{ 
            display: 'flex', 
            alignItems: 'center', 
            margin: '1.5rem 0',
            gap: '1rem'
          }}>
            <div style={{ 
              flex: 1, 
              height: '1px', 
              background: '#e9ecef' 
            }}></div>
            <span style={{ 
              fontSize: '12px', 
              color: '#7a7a7a',
              fontWeight: 500
            }}>
              OR
            </span>
            <div style={{ 
              flex: 1, 
              height: '1px', 
              background: '#e9ecef' 
            }}></div>
          </div>

          {/* Google Auth Button */}
          <button
            onClick={handleGoogleAuth}
            className="ghost pressable"
            style={{
              width: '100%',
              padding: '0.875rem',
              border: '1px solid #e9ecef',
              borderRadius: '8px',
              fontSize: '14px',
              fontWeight: 600,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '0.5rem',
              marginBottom: '1.5rem'
            }}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
              <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
              <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
              <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>
              <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
            </svg>
            {isLogin ? 'Sign in with Google' : 'Sign up with Google'}
          </button>

          {/* Footer Links */}
          <div style={{ textAlign: 'center' }}>
            <button
              onClick={toggleMode}
              className="ghost pressable"
              style={{
                padding: '0.5rem 1rem',
                border: 'none',
                borderRadius: '6px',
                fontSize: '12px',
                fontWeight: 500,
                cursor: 'pointer',
                color: '#1f8a4c'
              }}
            >
              {isLogin 
                ? "Don't have an account? Sign up"
                : 'Already have an account? Sign in'
              }
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
