import { Link } from 'react-router-dom'

export default function Kopf({ titel, zurueck, aktion }) {
  return (
    <header className="kopf">
      {zurueck != null && <Link className="zurueck" to={zurueck}>‹</Link>}
      <h1>{titel}</h1>
      {aktion}
    </header>
  )
}
