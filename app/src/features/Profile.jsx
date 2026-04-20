import { useState } from 'react'
import { useAuth } from '../app/AuthProvider'
import ProfileTabs from './profile/ProfileTabs'
import AccountTab from './profile/AccountTab'
import BrokerTab from './profile/BrokerTab'
import ActivityTab from './profile/ActivityTab'
import BotsTab from './profile/BotsTab'

export default function Profile(){
  const { user } = useAuth()
  const [tab,setTab] = useState('Account')

  const views = {
    Account: <AccountTab/>,
    Broker: <BrokerTab/>,
    Activity: <ActivityTab/>,
    Bots: <BotsTab/>
  }

  return (
    <div className="page">
      <div className="container profile">
        <header className="profile-head">
          <h1 className="hero profile-title">{user?.name} Profile</h1>
        </header>

        <div className="profile-nav-shell">
          <ProfileTabs value={tab} onChange={setTab}/>
        </div>

        <div className="profile-content-shell">
          {views[tab]}
        </div>
      </div>
    </div>
  )
}
