import { useNavigate } from 'react-router-dom'

const tabLabels = ['Account', 'Broker', 'Activity', 'Bots']

export default function ProfileTabs({ value }) {
  const navigate = useNavigate()

  const tabToPath = {
    'Account': '/profile/account',
    'Broker': '/profile/broker',
    'Activity': '/profile/activity',
    'Bots': '/profile/bots'
  }

  return (
    <div className="wrap">
      {tabLabels.map((label) => (
        <button
          key={label}
          type="button"
          className={value === label ? 'btn btn-xs btn-primary' : 'btn btn-xs btn-ghost'}
          onClick={() => navigate(tabToPath[label])}
        >
          {label}
        </button>
      ))}
    </div>
  )
}
