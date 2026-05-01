import { useNavigate } from 'react-router-dom'
import Calendar from '../../components/Calendar'

export default function TradingCalendarSection({ predictions }) {
  const navigate = useNavigate()

  return (
    <>
      <div style={{ textAlign: 'center', marginBottom: '2rem' }}>
        <div className="eyebrow">Trading Calendar</div>
      </div>
      <Calendar predictions={predictions} />
      <div style={{ textAlign: 'center', marginTop: '2rem', paddingTop: '2rem', borderTop: '1px solid #e9ecef' }}>
        <div style={{ display: 'flex', gap: '1rem', justifyContent: 'center', flexWrap: 'wrap' }}>
          <button className="ghost pressable" onClick={() => navigate('/assets')}>Assets</button>
          <button className="primary pressable" onClick={() => navigate('/portfolio')}>Portfolio</button>
          <button className="ghost pressable" onClick={() => navigate('/bots')}>Bots</button>
        </div>
      </div>
    </>
  )
}
