import { useNavigate, useLocation } from 'react-router-dom'

const tabLabels = ['Account', 'Broker']

export default function ProfileTabs() {
  const navigate = useNavigate()
  const location = useLocation()

  const tabToPath = {
    'Account': '/profile/account',
    'Broker': '/profile/broker'
  }

  const activeTab = tabLabels.find(label => location.pathname === tabToPath[label]) || 'Account'

  return (
    <div className="wrap">
      {tabLabels.map((label) => (
        <button
          key={label}
          type="button"
          className={activeTab === label ? 'btn btn-xs btn-primary' : 'btn btn-xs btn-ghost'}
          onClick={() => navigate(tabToPath[label])}
        >
          {label}
        </button>
      ))}
    </div>
  )
}
