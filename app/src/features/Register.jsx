import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../app/AuthProvider'

export default function Register(){
  const { login } = useAuth()
  const navigate = useNavigate()
  const [name,setName] = useState('')

  return (
    <div className="auth">
      <h1 className="hero">Create account</h1>

      <input 
        placeholder="Choose username"
        value={name}
        onChange={e=>setName(e.target.value)}
      />

      <button className="pressable primary" onClick={()=>login(name)}>
        Register
      </button>

      <button className="btn btn-ghost" onClick={() => login('Google User')}>
        Sign up with Google
      </button>

      <button className="btn btn-ghost" onClick={() => navigate('/auth')}>
        Already registered? Login
      </button>
    </div>
  )
}
