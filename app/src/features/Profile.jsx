import { Outlet, useParams, Navigate } from 'react-router-dom'
import { useAuth } from '../app/AuthProvider'
import ProfileTabs from './profile/ProfileTabs'
import AccountTab from './profile/AccountTab'
import BrokerTab from './profile/BrokerTab'
import ActivityTab from './profile/ActivityTab'
import BotsTab from './profile/BotsTab'

export default function Profile(){
  const { user } = useAuth()
  const { tab = 'account' } = useParams()

  const tabMap = {
    account: 'Account',
    broker: 'Broker',
    activity: 'Activity',
    bots: 'Bots'
  }

  const currentTab = tabMap[tab] || 'Account'

  return (
    <div className="l-page">
      <div className="container l-stack-md">
        <header className="l-stack-sm">
          <h1 className="hero m-0">{user?.name} Profile</h1>
        </header>

        <section className="card card-pad-sm">
          <ProfileTabs value={currentTab} />
        </section>

        <Outlet />
      </div>
    </div>
  )
}
