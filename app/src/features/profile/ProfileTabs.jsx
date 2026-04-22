const tabLabels = ['Account', 'Broker', 'Activity', 'Bots']

export default function ProfileTabs({ value, onChange }) {
  return (
    <div className="wrap">
      {tabLabels.map((label) => (
        <button
          key={label}
          type="button"
          className={value === label ? 'btn btn-xs btn-primary' : 'btn btn-xs btn-ghost'}
          onClick={() => onChange(label)}
        >
          {label}
        </button>
      ))}
    </div>
  )
}
