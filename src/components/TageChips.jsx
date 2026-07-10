import { TAGE, TAG_KURZ } from '../utils/zeit'

// Mehrfach-Auswahl von Wochentagen als Tap-Chips
export default function TageChips({ auswahl, onChange }) {
  function toggle(tag) {
    if (auswahl.includes(tag)) onChange(auswahl.filter(t => t !== tag))
    else onChange([...auswahl, tag])
  }
  return (
    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
      {TAGE.map(tag => (
        <button
          key={tag}
          type="button"
          className="btn klein"
          style={auswahl.includes(tag)
            ? {}
            : { background: '#e8eef0', color: 'var(--text-schwach)' }}
          onClick={() => toggle(tag)}
        >
          {TAG_KURZ[tag]}
        </button>
      ))}
    </div>
  )
}
