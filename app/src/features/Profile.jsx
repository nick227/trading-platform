import { Outlet, useParams, Navigate } from 'react-router-dom'
import { useAuth } from '../app/AuthProvider'
import ProfileTabs from './profile/ProfileTabs'

export default function Profile(){
  const { user } = useAuth()
  const { tab = 'account' } = useParams()

  return (
    <div className="l-page">
      <div className="container l-stack-md">
        <header className="l-stack-sm">
          <h1 className="hero m-0">{user?.name} Profile</h1>
        </header>

        <section className="card card-pad-sm">
          <ProfileTabs />
        </section>

        <Outlet />
      </div>
    </div>
  )
}
