import { useNavigate } from 'react-router-dom'

export default function Home() {
  const navigate = useNavigate()

  return (
    <div className="center">
      <span className="eyebrow">Quiet control</span>
      <h1 className="hero">Control your money</h1>
      <p className="subhero">
        Start from one calm action. Big type. Big buttons. No visual scrambling.
      </p>

      <div className="actions">
        <button
          className="primary pressable"
          onClick={() => navigate('/assets/NVDA')}
        >
          Open NVDA
        </button>
      </div>
    </div>
  )
}
