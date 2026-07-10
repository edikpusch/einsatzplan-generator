# EinsatzplanGenerator

Mobile-first React-PWA zur Erstellung wöchentlicher Personaleinsatzpläne (PEP)
pro Filiale. Modul 4 der VL-Tool-Suite.

- **Stack:** React + Vite + ExcelJS, localStorage only (kein Backend)
- **Export:** xlsx im PEP-Layout, alle Werte in JS vorberechnet (keine Formeln –
  Docs@Work-kompatibel), Teilen via Web Share API
- **Deploy:** Vercel, Auto-Deploy bei Push auf `main`

## Entwicklung

```
npm install
npm run dev
```

Projektkontext und Datenmodell: siehe [CLAUDE.md](CLAUDE.md).
