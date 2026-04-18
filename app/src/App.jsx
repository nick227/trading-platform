import { AppProvider } from './app/AppProvider'
import { AuthProvider } from './app/AuthProvider'
import { AppShell } from './app/AppShell'

export default function App() {
  return (
    <AuthProvider>
      <AppProvider>
        <AppShell />
      </AppProvider>
    </AuthProvider>
  )
}
