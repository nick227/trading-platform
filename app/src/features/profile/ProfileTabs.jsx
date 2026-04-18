const tabLabels = ['Account', 'Broker', 'Activity', 'Bots']

export default function ProfileTabs({ value, onChange }) {
  return (
    <div className="tabs">
      {tabLabels.map((label) => (
        <button
          key={label}
          className={`btn btn-ghost tab ${value === label ? 'active' : ''}`}
          onClick={() => onChange(label)}
        >
          {label}
        </button>
      ))}
    </div>
  )
}
