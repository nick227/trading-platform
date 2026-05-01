export default function ErrorState({ onRetry, message = 'Something went wrong', canRetry = true }) {
  return (
    <main className="stage" role="alert">
      <div className="stage-inner">
        <div style={{ width: '100%', textAlign: 'center' }}>
          <p>{message}</p>
          {canRetry ? (
            <button className="btn btn-sm btn-primary" type="button" onClick={onRetry}>
              Retry
            </button>
          ) : null}
        </div>
      </div>
    </main>
  )
}
