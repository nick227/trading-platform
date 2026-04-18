import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../app/AuthProvider'

export default function Login(){
  const { login } = useAuth()
  const navigate = useNavigate()
  const [name,setName] = useState('')

  return (
    <div className="auth">
      <h1 className="hero">Welcome back</h1>

      <input 
        placeholder="Username"
        value={name}
        onChange={e=>setName(e.target.value)}
      />

      <button className="pressable primary" onClick={()=>login(name)}>
        Login
      </button>

      <button className="btn btn-ghost" onClick={() => login('Google User')}>
        Continue with Google
      </button>

      <button className="btn btn-ghost" onClick={() => navigate('/register')}>
        Need an account? Register
      </button>
    </div>
  )
}
