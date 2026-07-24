# EinsatzplanGenerator – Projektkontext für Claude Code

## Projekt-Übersicht
React PWA für Verkaufsleiter (VL) zur Erstellung wöchentlicher **Personaleinsatzpläne (PEP)** pro Filiale. Phase A + OCR-Import + Bedarfsmodul + Phase B (Auto-Vorschlag) sind gebaut.
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
    OcrScan.jsx         ← OCR-Mitarbeiterimport: Personalbericht scannen
                          (2 Bilder), Review Neu/Geändert/Fehlt, Merge
    WocheStart.jsx      ← KW + Jahr + Filiale wählen → Mo–Sa berechnet
    PlanEditor.jsx      ← KERN: Matrix MA × Mo–Sa, Bottom-Sheet pro Zelle,
                          Tabs Plan/Bedarf/Abwesend/Sondertage/Prüfung,
                          Budget-Leiste, Export (Auto-Save bei jeder Änderung)
    KatalogEdit.jsx     ← Vorgangskatalog-Verwaltung (pro Filiale Overrides,
                          eigene Vorgänge global)
  components/
    Kopf.jsx            ← Seitenkopf mit Zurück-Link
    TageChips.jsx       ← Mo–Sa Mehrfachauswahl
    BedarfTab.jsx       ← Bedarf-Tab: Ampel, Tages-Balken, Lieferungen,
                          Inventuren/Saison, Tagesansicht für den ML
  utils/
    ocr.js              ← Tesseract.js-Pipeline, Y-Matching, Kürzel-Mapping,
                          Stunden-Parsing, Merge-Vergleich (baueVergleich)
    katalog.js          ← Standard-Vorgangskatalog (29 Vorgänge), Labels,
                          effektiverKatalog (Override-Merge), Lieferprofil-Defaults
    bedarf.js           ← Bedarfsrechnung: tagesBedarf/wochenBedarf, Ampel,
                          Lieferungen-Vorbelegung, fällige Inventuren
    zeit.js             ← Minuten-Arithmetik, HH:MM, ISO-KW, Pausen-Automatik
    gfb.js              ← Zuschlagsbänder, GfB-Verdienst, Monats-Aggregation
    pruefung.js         ← Prüf-Layer (alle Warnungen)
    vorschlag.js        ← Phase B: Auto-Vorschlags-Engine (greedy)
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
- `ep_vorgangskatalog` – global (Standard-Katalog beim ersten Zugriff geseedet,
  neue Standard-Vorgänge werden bei App-Updates angehängt); pro Filiale
  überschreibbar via `ep_filialen[].vorgangOverrides` (Key = vorgangId).
  Vorgang: { id, name, kategorie, rhythmus, wochentage[], personen{min,max},
  dauerMin{min,max}, zeitanker, rolle, budgetQuelle filiale|extern, aktiv }
- Wochen-Erweiterung: `lieferungen[{tag,art,paletten}]` (vorbelegt aus
  `filiale.lieferprofil`), `inventurenDiesenMonat[{vorgangId,tag}]`
- Filial-Erweiterung: `lieferprofil`, `palettenFaktoren`, `bestellzeiten`,
  `vorgangOverrides` (Migration lazy in `mitFilialDefaults`)

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

### OCR-Mitarbeiterimport (utils/ocr.js + pages/OcrScan.jsx)
- Portiert aus MehrstundenManager OcrScan.jsx (Vorverarbeitung, Worker-Config,
  Zeilengruppierung, Funktions-Aliases 1:1 übernommen). Tesseract.js, offline.
- Gescannt wird der PERSONALBERICHT (nicht der PEP): Bild 1 = Namensspalte,
  Bild 2 = Tätigkeit + Wo-Std. Beide im gleichen Ausschnitt aufnehmen!
- Zuordnung per **Y-Positions-Matching** (yNorm 0–1, |Δy| < 0.03), NICHT per
  Index – Index bricht bei mehrzeiligen Namen. Umgebrochene Namen werden zu
  einem MA zusammengeführt (Durchschnitts-Y).
- **KRITISCH – ID-Stabilität:** `ep_wochen[*].plan` referenziert maId. Rescan
  merged per matchKey (nachname+vorname, lowercase, ä→a/ß→ss, nur a–z) und
  behält IDs. Nur funktion/vertragsstunden/typ/azubi werden aktualisiert –
  stundenlohn, verdienstgrenze, quali, verfuegbarkeit, berufsschultage NIE
  überschreiben. Fehlende MA werden nie automatisch gelöscht.
- Review-Screen ist Pflicht: erst „Übernehmen" schreibt nach localStorage.
- Stunden-Parsing: "37:30"→37.5, "37,5", OCR-Artefakt "300"→30.0; Ziffern-
  korrektur (B→8, O→0 …) nur für Stunden, nie für Funktions-Kürzel.
- Kürzel-Mapping zentral in `KUERZEL_ZU_FUNKTION` (ML/MLV/MLV2/VK/AZUBI/GfB/RK),
  unbekannte Kürzel → Funktion leer + rot im Review.

### Prüf-Layer (utils/pruefung.js)
- Warnungen sind Hinweise, keine Sperre. schwere: 'rot' | 'gelb'.
- Abdeckungs-Checks laufen über Intervall-Sweep (`unterdeckung`).
- Sondertag-Check ist eine Heuristik (Kopfzahl vs. Maximum anderer Tage).
- Feiertage: Phase-A-Annahme = Filiale geschlossen, kein Feiertagszuschlag.
- Bedarfs-Checks (typ 'bedarf') nur wenn `katalog` übergeben wird: Lieferung-
  Unterdeckung (nur bei geplant > 0, sonst Doppel-Rauschen zum leeren Plan),
  Abend-Vorgänge (Personen nach 19:00), Pflicht-Rollen (erfuelltRolle:
  baecker/kasse/schluesseltraeger-Quali, ml=Funktion enthält
  „Filialverantwortlicher", reinigung=Funktion Reinigungskraft).

### Bedarfsmodul (utils/katalog.js + utils/bedarf.js + BedarfTab)
- KALKULATION, kein Task-Management – nichts wird „abgehakt".
- Personenstunden = personen × dauerMin (Min/Max-Spannen mitführen).
- Lieferung = 30 min Annahme + Paletten × palettenFaktor[art].
- Kassen-Dauerbesetzung = kassenStandard × Öffnungszeit + Peak-Differenzen –
  bewusst Teil des Tagesbedarfs (Gesamtbesetzungs-Baseline lt. Spec).
- `budgetQuelle:'extern'` wird angezeigt, zählt aber NIE gegen das Budget.
- Wöchentliche Vorgänge ohne feste Tage → `flexPosten` (nur Wochensumme,
  keinem Tag zugeordnet).
- Inventur-Fälligkeit (Heuristik): Woche enthält 1. Ziel-Wochentag des Monats;
  alle2monate = gerade Monatsindizes (Jan/Mär/…), alle4monate = Jan/Mai/Sep.
  Nutzer bestätigt im Bedarf-Tab (`inventurenDiesenMonat`), Woche speichert.
- Ampel: Mittelwert der Spanne vs. Budget (rot >100 %, gelb <5 % Luft).
- Balken-Farben validiert (CVD-safe): Bedarf #4272b8, Geplant var(--gruen).

### Phase B – Auto-Vorschlags-Engine (utils/vorschlag.js + PlanEditor)
- Button „⚡ Auto-Vorschlag" im Plan-Tab → Engine rechnet auf einer KOPIE des
  Plans, Vorschau-Sheet (neue Schichten pro Tag + Konfliktliste), erst
  „Übernehmen" schreibt in `woche.plan`. Bestehende Zellen (Arbeit UND
  Status) werden NIE verändert oder überschrieben.
- Greedy: Slots aus Schichtvorlagen (ohne Vorlagen: 2 synthetische Schichten
  mit 15 min Übergabe) × Kopfbedarf-Sweep (max(1, kassenStandard), Peaks als
  Maximum, Sondertag-Zusatzköpfe additiv). Danach Feste bis Vertragsstunden
  auffüllen (dünnste Fenster zuerst).
- Score: Feste mit größtem Vertrags-Defizit zuerst; GfB = Puffer (+5000),
  Zuschlagsminuten ×3 (spät sparsam), über Verdienstgrenze +1.000.000 (nur
  letzte Option, dann roter Konflikt). Fehlende Pflichtrollen geben Bonus
  (V −3000, Bäcker −2500, Kasse −1500).
- Harte Filter: Zelle belegt, Verfügbarkeit, Azubi (Berufsschultag, >8h netto,
  Ende nach 20:00), Ruhezeit 11h zu Vor- UND Folgetag, Budget (hart).
- Reinigungskräfte plant die Engine nicht (zählen aber zum Budget).
- Vertreter-Check pro Fenster über die FENSTER-MITTE (sonst „blendet" der
  Früh-V mit 15-min-Übergabe den V-Check der Spätschicht). Passend dazu
  toleriert pruefung.js bis 30 min V-Überlappung (Übergabe).
- Konflikte (`{schwere, text}`): unbesetzte Schichten, fehlender V/Bäcker,
  Budget < Summe Vertragsstunden, GfB über Grenze, Vertragsstunden nicht
  erreicht (nur wenn der MA überhaupt einen freien offenen Tag hatte).

## Häufige Fehler & Fixes (aus den Schwester-Modulen)

| Fehler | Ursache | Fix |
|--------|---------|-----|
| Leerer/schwarzer Screen | `setState` im Render oder TDZ (`const` nach Nutzung) | Variablen vor erstem return deklarieren, nie setState im Render |
| Build-Fehler "Unterminated string" | Echter Zeilenumbruch in Single-Quote-String | `\n` statt echtem Newline |
| Excel zeigt 0 statt Summe | Formel statt Wert geschrieben | Immer vorberechnete Werte schreiben |
| Reihenfolge springt zurück | useEffect überschreibt State bei jedem Render | Key-String-Vergleich statt Objekt-Dependency |
