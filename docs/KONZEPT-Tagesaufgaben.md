# Konzept: Tagesaufgaben als Herzstück der Planung

Status: **umgesetzt (alle 4 Phasen).** Ersetzt das Nebeneinander aus
Vorgangskatalog, Kassen-Feldern und Bäcker-Fenster durch **eine** Bedarfsquelle.
Code: `src/utils/aufgaben.js`, `src/utils/zuteilung.js`,
`src/pages/AufgabenEdit.jsx`.

---

## 1. Leitgedanke

Der Bedarf eines Tages ist eine **Liste von Aufgaben mit Stundenmengen**, nicht
eine Liste von Zeitfenstern mit Kopfzahlen. Wie viele Personen gleichzeitig
nötig sind, wird daraus **abgeleitet** – nicht separat gepflegt.

> Markt 07:00–22:00 = 15 h offen. Kasse = 20 h Aufgabe.
> → 15 h Grundbesetzung (1 Kasse durchgehend) + 5 h zweite Kasse.
> Eine Kasse kann an dem Tag ja nur 15 h leisten.

Das ist die zentrale Formel des ganzen Moduls:

```
oeffnungsDauer   = zu − auf
grundbesetzung   = floor(stunden / oeffnungsDauer)      // durchgehend
restStunden      = stunden − grundbesetzung * oeffnungsDauer
                   → eine weitere Person für restStunden,
                     platziert in den Stoßzeiten
```

Sonderfall `stunden < oeffnungsDauer` → Grundbesetzung 0. Zulässig, aber die
Prüfung meldet: „Kasse 10 h < Öffnungsdauer 15 h – zeitweise unbesetzt."

---

## 2. Datenmodell

### Tagesaufgabe (neu, einziger Bedarfsträger)

```js
{
  id,
  name,            // "Kasse", "Frische packen", "Bake-Off"
  bereich,         // 'kasse' | 'bakeoff' | 'packen' | 'vertretung' | null
                   // → steuert, welche MA-Priorität greift
  modus,           // 'durchgehend' | 'fenster' | 'frei'
  fenster,         // nur bei modus='fenster': { von, bis }
  tage: [],        // Mo–Sa, für die die Aufgabe gilt
  stunden,         // Standard-Personenstunden pro Tag
  stundenJeTag: {},// optionale Abweichung, z.B. { sa: 4 }
  prioritaet,      // 1 = wird zuerst bedient, wenn Stunden knapp sind
  budgetQuelle,    // 'filiale' | 'extern' (extern zählt nicht gegen Budget)
  aktiv,
}
```

**Die drei Modi** – bewusst nur drei:

| Modus | Bedeutung | Beispiel |
|---|---|---|
| `durchgehend` | muss die Öffnungszeit abdecken; Überhang → zweite Kraft in den Stoßzeiten | Kasse |
| `fenster` | Stunden müssen in ein Zeitfenster fallen | Bake-Off bis 10:00 |
| `frei` | irgendwann am Tag | Leergut, Frische packen |

### Stoßzeiten (ersetzt `kassenPeaks`)

```js
stosszeiten: [ { tage: [], von, bis } ]   // ohne anzahl – die ergibt sich
```

Nur noch Zeitfenster: „wann ist viel los". Wie viele Leute dort zusätzlich
stehen, folgt aus den Aufgaben-Stunden.

### Speicherorte

- **Filiale**: `tagesaufgaben[]`, `stosszeiten[]`, `fruehesterBeginn` (Default `06:00`)
- **Woche**: Kopie der Aufgaben beim ersten Öffnen → spätere Änderungen am
  Filial-Standard verändern geplante Wochen nicht rückwirkend
- **Favoriten**: `ep_aufgaben_favoriten` – benannte Sätze („Standardwoche",
  „Aktionswoche"), filialübergreifend anwendbar

### Entfällt

`kassenStandard`, `kassenPeaks.anzahl`, `baeckerFenster` – werden migriert
(siehe §6). Der Vorgangskatalog bleibt als **Startwert-Lieferant** erhalten,
steuert aber nicht mehr.

---

## 3. Rechenweg (fünf Schritte, jeder einzeln prüfbar)

### Schritt 1 – Soll-Kurve + Soll-Stunden
Pro Tag aus den Aufgaben ableiten:
- `durchgehend` → Grundbesetzung über die Öffnungszeit, Rest in die Stoßzeiten
- `fenster` → mindestens `ceil(stunden / fensterdauer)` Personen im Fenster
- `frei` → trägt nichts zur Kurve bei, nur zur Stundensumme

Ergebnis: **benötigte Köpfe je Zeitpunkt** + **Soll-Stunden des Tages**.
Vertretung belegt niemanden und erhöht die Kurve nie.

### Schritt 2 – Schichten besetzen
Schichtvorlagen × Soll-Kurve, wie bisher greedy. Reihenfolge unverändert:
Vertragsstunden → Aushilfen → Überstunden (gerecht verteilt).
Harte Schranke: **kein Arbeitsbeginn vor `fruehesterBeginn` (06:00)**.
Deckt keine Vorlage ein nötiges Fenster ab → Konflikt, die Engine erfindet
keine Schichtzeiten.

### Schritt 3 – Pausen platzieren
Schichtmitte, 15-Minuten-Raster, **Stoßzeiten meidend**, versetzt zueinander,
nie in der ersten/letzten Stunde. Deterministisch: gleiche Eingabe → gleiche
Pausenlage. Länge wie bisher (>6 h → 30, >9 h → 45).

### Schritt 4 – Stunden auf Aufgaben verteilen (abgeleitet, nie gespeichert)
Tag in Abschnitte schneiden (Schichtwechsel, Pausengrenzen, Fenstergrenzen).
Je Abschnitt:
1. **Vertretung** zuerst – beste Prio unter den Anwesenden, belegt nicht
2. **Aufgaben nach ihrer Priorität** abarbeiten (1 zuerst)
3. Je Aufgabe: anwesende, noch freie MA nach ihrer **Bereichs-Priorität**
4. Kann jemand zwei Aufgaben: **seine eigene bessere Prio-Zahl gewinnt**,
   die andere fällt an den Nächsten

> Kassen-Beispiel: Kasse-Prio-2 geht 13:00–13:30 in Pause, zweite Kasse wird
> weiter gebraucht → der Vertretungs-MA mit Kasse Prio 3 ist bester freier
> Kandidat und rückt für 30 Minuten nach.

### Schritt 5 – Meldungen
Bewusst einfach, aber konkret:
- „Montag 14:15–22:15: Schicht unbesetzt"
- „Montag: Leergut 1 h nicht erledigt (Priorität 4)"
- „Montag 13:00–13:30: zweite Kasse unbesetzt (Pause)"

Keine anteilige Kürzung, keine Umverteilung – was nicht reicht, wird gemeldet.

---

## 4. Stundenvergabe bei Konflikten

**Vertragsstunden gewinnen** (Default): Feste werden über den Soll-Bedarf
hinaus aufgefüllt, die Überdeckung wird ausgewiesen („+12 h über Soll").
Im Generierungs-Dialog umschaltbar auf „nur Soll-Bedarf planen".

Drei-Wege-Abgleich vor dem Generieren:
**Soll-Stunden ↔ Wochenbudget ↔ Summe Vertragsstunden.**

---

## 5. Bewusst NICHT gebaut

- keine geteilten Dienste (ein Block pro MA und Tag)
- keine frei erfundenen Schichtzeiten – nur deine Vorlagen
- keine Voll-Optimierung/Solver – greedy, dafür erklärbar und in Sekunden
- keine minutengenaue Rollen-Feinsteuerung – Abschnitte nur an Ereignissen
- keine Speicherung der Rollenverteilung – immer neu berechnet, kann nie
  mit dem Plan auseinanderlaufen

---

## 6. Migration der Bestandsdaten

| Alt | Neu |
|---|---|
| `kassenStandard` + `kassenPeaks.anzahl` | Aufgabe „Kasse", `modus: durchgehend`, Stunden = Standard × Öffnungsdauer + Peak-Zuschläge |
| `kassenPeaks` (Zeitfenster) | `stosszeiten[]` |
| `baeckerFenster.bis` | Aufgabe „Bake-Off", `modus: fenster`, `{ von: fruehesterBeginn, bis }` |
| Vorgangskatalog | einmalig zu Aufgaben verdichtet (nach Bereich/Kategorie), danach frei anpassbar |
| Öffnungszeiten, Schichtvorlagen, Lieferprofil | unverändert |

Bereits geplante Wochen behalten ihren Plan; die Aufgaben wirken auf
Generierung und Prüfung, nicht rückwirkend auf gespeicherte Schichten.

---

## 7. Bau- und Testreihenfolge

| Phase | Inhalt | Abnahme-Test |
|---|---|---|
| 1 | Datenmodell, Migration, Aufgaben-Editor (Tages-Chips + Abweichungen), Favoriten | Alte Kassen-/Bäcker-Einstellungen ergeben dieselbe Soll-Kurve wie heute |
| 2 | Soll-Kurve + Soll-Stunden + Drei-Wege-Abgleich, Regel-Schritt beim Wochenstart | Handrechnung 20 h Kasse / 15 h offen → 1 durchgehend + 5 h zweite |
| 3 | Pausen-Platzierung mit Stoßzeiten-Vermeidung | Keine Pause in der Stoßzeit, versetzt, reproduzierbar |
| 4 | Aufgaben-Zuteilung + Anbindung an Generator und Prüfung, Anzeige in der Schicht-Zelle | Kassen-Beispiel aus §3 muss exakt herauskommen |

Jede Phase ist für sich lauffähig und wird vor der nächsten verifiziert.
