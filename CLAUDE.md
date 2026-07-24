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
  verdienstgrenze, prioritaeten{vertreter,bakeoff,kasse,packen},
  dauerhaftAbwesend, abwesenheitsGrund, verfuegbarkeit, azubi,
  berufsschultage[] }
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

### Bereiche & Prioritäten (utils/rollen.js) – ersetzt die Quali-Häkchen
- Pro MA `prioritaeten: { vertreter, bakeoff, kasse, packen }`. Zahl = macht
  den Bereich, **1 = erste Wahl**; null/leer = macht ihn nicht. Dadurch rückt
  bei Urlaub der Prio-1-Kraft automatisch Prio 2 nach (B/O = **Bake-Off**).
- Migration in `store.mitMaDefaults`: altes `quali.schluesseltraeger/baecker/
  kasse` → Prio 1 im jeweiligen Bereich, `packen` leer. Nie zurückschreiben
  nötig – die Migration läuft lazy bei jedem `getAlleMitarbeiter()`.
- `kannBereich(ma, bereich)` ersetzt überall die alten Häkchen-Abfragen
  (pruefung.js, vorschlag.js, PlanEditor V-Checkbox).
- `dauerhaftAbwesend` (+ `abwesenheitsGrund`): MA bleibt gespeichert, wird
  aber via `istPlanbar` aus Raster, Prüfung, Generierung und Export gefiltert
  (Filter sitzt im PlanEditor-Memo, der Export erbt die gefilterte Liste).

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

### Tagesaufgaben – HERZSTÜCK der Planung (utils/aufgaben.js + utils/zuteilung.js)
Volles Konzept: [docs/KONZEPT-Tagesaufgaben.md](docs/KONZEPT-Tagesaufgaben.md)
- **Eine** Bedarfsquelle: Aufgaben mit STUNDEN pro Tag. Gleichzeitigkeit wird
  abgeleitet, nie gepflegt. Kernformel (`tagesBloecke`):
  `grundbesetzung = floor(stunden / oeffnungsDauer)`, Rest → Stoßzeiten.
  20 h Kasse bei 15 h Öffnung = 1 durchgehend + 5 h zweite Kasse.
- Drei Modi: `durchgehend` (Kasse), `fenster` (Bake-Off bis 10:00), `frei`
  (Leergut). Mehr Fälle gibt es bewusst nicht.
- `stosszeiten` (nur Zeitfenster, ohne Anzahl) ersetzt `kassenPeaks`;
  `fruehesterBeginn` (06:00) ist eine harte Schranke – `arbeitsFenster`
  beschneidet jede Öffnungszeit darauf.
- Speicherorte: Filiale = Standard, Woche = Kopie beim ersten Öffnen
  (`woche.tagesaufgaben`), Favoriten global in `ep_aufgaben_favoriten`.
- Migration (`aufgabenAusKatalog`, lazy in `store.getFilialen`, wird EINMALIG
  zurückgeschrieben – sonst bekämen die Aufgaben bei jedem Lesen neue IDs):
  kassenStandard + Peaks → Aufgabe „Kasse", Katalog-Kategorien → je eine
  Aufgabe, baeckerFenster → Fenster der Bake-Off-Aufgabe.
- **Zuteilung (`zuteilung.js`) wird IMMER neu berechnet, nie gespeichert** –
  so kann sie nie mit dem Plan auseinanderlaufen.
  - `platziereePausen`: Schichtmitte, 15-min-Raster, Stoßzeiten meidend,
    versetzt, nie in der ersten/letzten Stunde, deterministisch.
  - `verteileAufgaben`: Tag in Abschnitte (Schicht-/Pausen-/Blockgrenzen),
    je Abschnitt erst Vertretung (belegt NICHT), dann Pflicht-Plätze
    „knappster zuerst", dann freie Aufgaben nach Aufgaben-Priorität.
    Bei Doppelqualifikation gewinnt die eigene bessere Prio-Zahl.
  - Verifiziert: Prio-1-Kasse in Pause → Prio 2 rückt nach; ist auch die weg,
    übernimmt der Vertretungs-MA mit Kasse-Prio 3 genau für die Pausendauer.
- Generator nutzt `tagesKurve`/`kopfBedarfZu` statt der alten Kassen-Rechnung,
  füllt danach in Schritt 4b bis zu den Tages-Soll-Stunden auf; Schritt 5
  (Vertragsstunden) entfällt bei `nurSollBedarf: true`.

### Bedarfsmodul – nur noch Startwert-Lieferant (utils/katalog.js + utils/bedarf.js)
- Steuert die Planung NICHT mehr – liefert nur noch die Startwerte für die
  Tagesaufgaben (`aufgabenAusKatalog`) sowie Lieferungen/Inventuren der Woche.
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
- **Vor dem Rechnen** öffnet der PlanEditor die Abwesenheits-Abfrage
  (`AbwesenheitsSheet`): Tag antippen schaltet frei → U → K → frei, plus
  „U/K Woche". Schreibt über `setzeZelle` in plan + abwesenheiten (keine
  Doppelpflege zum Abwesend-Tab).
- Greedy: Slots aus Schichtvorlagen (ohne Vorlagen: 2 synthetische Schichten
  mit 15 min Übergabe) × Kopfbedarf-Sweep (max(1, kassenStandard), Peaks als
  Maximum, Sondertag-Zusatzköpfe additiv). Danach Feste bis Vertragsstunden
  auffüllen (dünnste Fenster zuerst).
- **Einsatz-Stufen (harte Reihenfolge, `stufe()`):** 0 = Feste mit freien
  Vertragsstunden, 1 = GfB als Puffer, 2 = Feste in Überstunden. Erst wenn
  keine Stufe-0-Kraft kann, wird überhaupt Stufe 1/2 gezogen. Ausnahme: fehlt
  Vertreter oder Bake-Off und der MA kann die Rolle, steigt er eine Stufe auf
  (sonst bliebe eine Schicht ohne Schlüsselträger, nur um Überstunden zu
  sparen). Verifiziert: nie Überstunden, solange jemand Vertragsstunden frei
  hat; Überstunden-Spanne bei 8 gleichen Verträgen nur ~1 h.
- Score innerhalb der Stufe: Feste nach größtem Vertrags-Defizit; in Stufe 2
  nach den WENIGSTEN bisherigen Überstunden (gerechte Verteilung); GfB nach
  Zuschlagsminuten ×3 (spät sparsam), über Verdienstgrenze +1.000.000 (nur
  letzte Option, dann roter Konflikt). Pflichtrollen geben Bonus, nach Prio
  gestaffelt (`prioBonus`: Basis − (prio−1)×200; V 3000, Bake-Off 2500,
  Packen 2000, Kasse 1500).
- **Schritt 6 – V nach Priorität:** Nach dem Füllen bekommt in jedem
  Schicht-Fenster der anwesende MA mit der besten `vertreter`-Prio das V.
  Nur Engine-Zellen werden angefasst; ein manuell gesetztes V im Fenster
  blockiert den Pass komplett.
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
