import { Link } from 'react-router-dom'

/** Logged-out home. No market data or recommendations. */
export default function Welcome() {
  return (
    <main className="page container home home-welcome">
      <h1 className="home-title">Trading bots you can watch and control</h1>
      <p className="muted text-md">
        Choose a bot, give it simulated capital, and see every decision it makes. Pause or stop it anytime.
      </p>
      <p className="text-sm">
        <strong>Paper trading only.</strong> TradeLoom does not hold deposits, and live trading is disabled.
      </p>
      <Link to="/auth" className="btn btn-primary">Sign in or create an account</Link>
    </main>
  )
}
