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
    <div className="l-page">
      <div className="container l-stack-md">
        <header className="l-stack-sm">
          <h1 className="hero m-0">{user?.name} Profile</h1>
        </header>

        <section className="card card-pad-sm">
          <ProfileTabs value={tab} onChange={setTab}/>
        </section>

        {views[tab]}
      </div>
    </div>
  )
}
