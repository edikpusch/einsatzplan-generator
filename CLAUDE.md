# EinsatzplanGenerator – Projektkontext für Claude Code

## Projekt-Übersicht
React PWA für Verkaufsleiter (VL) zur Erstellung wöchentlicher **Personaleinsatzpläne (PEP)** pro Filiale.
Modul 4 der VL-Tool-Suite (nach MehrstundenManager, InventurManager, FlopMelder).
- **Repo:** edikpusch/einsatzplan-generator (privat)
- **Stack:** React + Vite + ExcelJS + localStorage (kein Backend!)
- **Deploy:** Vercel, Auto-Deploy bei Push auf `main` (via GitHub Desktop)
- **Router:** HashRouter (kein Vercel-Rewrite nötig)
- **Original-Spezifikation:** [docs/PROMPT-PhaseA.md](docs/PROMPT-PhaseA.md)

## HARTE PROJEKTREGEL
Docs@Work auf dem iPad rechnet **keine Excel-Formeln**. ALLE Zahlen (Std pro
Zelle, Wochensummen, Filial-Gesamtsumme, Budget-Abgleich) werden in JS
**vorberechnet** und als Werte/Text geschrieben. **Niemals Formeln in die xlsx.**

## Workflow
1. Änderungen in Claude Code machen
2. GitHub Desktop → Commit & Push
3. Vercel deployed automatisch

## Projektstruktur
```
src/
  pages/
    Home.jsx            ← Startseite: Wochen-Liste, Einstieg
    ProfilEdit.jsx      ← VL-Profil, Mindestlohn, Minijob-Grenze, Zuschläge
    FilialeList.jsx     ← Liste aller Filialen
    FilialeEdit.jsx     ← Filiale: Öffnungszeiten, Budget, Bäcker-Fenster,
                          Kassen-Peaks, Schichtvorlagen, MA-Liste (Auto-Save)
    MitarbeiterEdit.jsx ← MA: Funktion, fest/GfB, Quali-Häkchen, Verfügbarkeit,
                          Azubi + Berufsschultage (Speichern-Button)
    WocheStart.jsx      ← KW + Jahr + Filiale wählen → Mo–Sa berechnet
    PlanEditor.jsx      ← KERN: Matrix MA × Mo–Sa, Bottom-Sheet pro Zelle,
                          Tabs Plan/Abwesend/Sondertage/Prüfung, Budget-Leiste,
                          Export (Auto-Save bei jeder Änderung)
  components/
    Kopf.jsx            ← Seitenkopf mit Zurück-Link
    TageChips.jsx       ← Mo–Sa Mehrfachauswahl
  utils/
    zeit.js             ← Minuten-Arithmetik, HH:MM, ISO-KW, Pausen-Automatik
    gfb.js              ← Zuschlagsbänder, GfB-Verdienst, Monats-Aggregation
    pruefung.js         ← Prüf-Layer (alle Warnungen)
    exportXlsx.js       ← PEP-Export (ExcelJS) + Web-Share/Download
  store.js              ← localStorage-Zugriff (Prefix ep_)
  App.jsx               ← Router (HashRouter)
  main.jsx              ← Entry Point
```

## Datenmodell (localStorage, Prefix `ep_`)
- `ep_profile` – { vlName, niederlassung, mindestlohn, minijobGrenze, zuschlaege[] }
- `ep_filialen` – Array: { id, nummer, adresse, bereich, oeffnungszeiten{mo..so},
  wochenstundenBudget, baeckerFenster{bis}, kassenStandard, kassenPeaks[],
  schichtvorlagen[] }
- `ep_mitarbeiter` – Array (MA an Filiale gebunden): { id, filialeId, name,
  vorname, funktion, typ fest|gfb, vertragsstunden, stundenlohn,
  verdienstgrenze, quali{schluesseltraeger,baecker,kasse}, verfuegbarkeit,
  azubi, berufsschultage[] }
- `ep_wochen` – Objekt, Key `${filialeId}_${jahr}_KW${kw}`: { filialeId, jahr,
  kw, datumVon, datumBis, abwesenheiten{maId→tag→code}, sondertage[],
  plan{maId→tag→Zelle} }
- Zelle: `{ art:'arbeit', von, bis, pauseMin, stdMin, vertreter }` oder
  `{ art:'status', code }` (U/F/K/FT/BV/Kur/SCH)

Volle Spezifikation inkl. Phase B: [docs/PROMPT-PhaseA.md](docs/PROMPT-PhaseA.md)

## Bekannte Eigenheiten & wichtige Regeln

### Zeit-Arithmetik (utils/zeit.js)
- Intern IMMER Integer-Minuten, nie Floats. Anzeige über `dauerHHMM` (Dauer,
  "37:30") vs. `toHHMM` (Uhrzeit, "06:30").
- Pausen-Automatik: ≤6h→0, >6h→30, >9h→45 min. Vorlagen-`pauseMin` ist nur
  Startwert, die Automatik hat Vorrang; manueller Override pro Zelle möglich
  (leeres Pause-Feld im Sheet = Automatik).
- `stdMin` wird beim Schreiben der Zelle vorberechnet (`baueArbeitsZelle`).

### Plan-Editor (PlanEditor.jsx)
- **Ein Schichtblock pro MA und Tag** – keine geteilten Dienste.
- Status setzen schreibt in `plan` UND `abwesenheiten` (synchron halten!).
- `vertreter:true` nur für Schlüsselträger wählbar; Export zeigt blaues **V**.
- Auto-Save via useEffect auf `woche` – die Woche entsteht beim ersten Öffnen.
- `alleWochen` für GfB-Monatswarnung enthält die aktuelle (ungespeicherte)
  Woche explizit gemerged – sonst hinkt die Warnung einen Render hinterher.

### GfB-Logik (utils/gfb.js)
- Zuschläge zählen NUR für die Verdienstgrenze (€), das Filialbudget bleibt
  in Stunden. Export zeigt bei Aushilfen Monats-STUNDEN, kein €.
- Eine KW kann 2 Monate berühren → jeder Tag wird seinem Kalendermonat
  zugeordnet, Laufsumme über alle gespeicherten Wochen des Monats.
- Pause wird zuerst von zuschlagsfreier Zeit abgezogen, dann vom Band mit dem
  niedrigsten Prozentsatz.

### Export (utils/exportXlsx.js)
- KEINE Formeln (Docs@Work!). Zeiten als Text "HH:MM", Dezimal-Komma.
- Querformat A4, fitToWidth. 3 Zeilen pro MA-Block (Name+Funktion / A-Zeile+P /
  Summen). Aushilfen (GfB + Reinigungskraft, s. `istAushilfe`) im eigenen
  Block "- Aushilfe".
- Dateiname: `Personaleinsatzplanung {nummer} KW {kw}-{jahr} {vlName}.xlsx`
- Teilen: Web Share API (WhatsApp), Fallback Download.
- **Auf iPad beim ersten Export prüfen:** Spaltenbreiten/Merges, HH:MM,
  Dezimal-Komma, Aushilfe-Block.

### Prüf-Layer (utils/pruefung.js)
- Warnungen sind Hinweise, keine Sperre. schwere: 'rot' | 'gelb'.
- Abdeckungs-Checks laufen über Intervall-Sweep (`unterdeckung`).
- Sondertag-Check ist eine Heuristik (Kopfzahl vs. Maximum anderer Tage).
- Feiertage: Phase-A-Annahme = Filiale geschlossen, kein Feiertagszuschlag.

### Phase B (NICHT gebaut, Datenmodell ist vorbereitet)
Auto-Vorschlags-Engine (greedy + Prüf-Layer), schreibt in denselben `plan`.
Spezifikation in docs/PROMPT-PhaseA.md, Abschnitt "Phase B".

## Häufige Fehler & Fixes (aus den Schwester-Modulen)

| Fehler | Ursache | Fix |
|--------|---------|-----|
| Leerer/schwarzer Screen | `setState` im Render oder TDZ (`const` nach Nutzung) | Variablen vor erstem return deklarieren, nie setState im Render |
| Build-Fehler "Unterminated string" | Echter Zeilenumbruch in Single-Quote-String | `\n` statt echtem Newline |
| Excel zeigt 0 statt Summe | Formel statt Wert geschrieben | Immer vorberechnete Werte schreiben |
| Reihenfolge springt zurück | useEffect überschreibt State bei jedem Render | Key-String-Vergleich statt Objekt-Dependency |
