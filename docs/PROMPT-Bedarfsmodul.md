# Claude Code Prompt – Vorgangskatalog & Bedarfsrechnung (EinsatzplanGenerator, Erweiterung)

## Ziel

Der EinsatzplanGenerator erhält ein **Bedarfsmodul**: einen Katalog wiederkehrender Vorgänge mit Personen × Dauer und Rhythmus. Daraus berechnet die App pro Tag und Woche den **Stundenbedarf** einer Filiale und stellt ihn dem **Wochenbudget** gegenüber. Der Marktleiter sieht: „Heute brauchst du ca. X Personenstunden für diese Vorgänge" – und muss nur noch Personen zuordnen.

**Wichtig:** Kein Task-Management bauen. Vorgänge werden nicht einzeln MA-genau „abgehakt" – sie dienen der **Stunden-Kalkulation** und als Tagesübersicht.

---

## Neues Datenmodell

### `ep_vorgangskatalog` – global (Standard-Katalog), pro Filiale überschreibbar via `ep_filialen[].vorgangOverrides`

```
{
  id, name, kategorie,        // Kategorien: bakeoff | oug | fleischmopro | trockenaktion | logistik | oeffnungschluss | inventur | bestellung | kontrolle | saison
  rhythmus,                   // "taeglich" | "woechentlich" | "monatlich" | "alle2monate" | "alle4monate" | "jeLiefertag" | "saison"
  wochentage: [],             // bei woechentlich/monatlich: feste Tage (z.B. ["sa"]); leer = frei wählbar
  personen: { min, max },     // gleichzeitig
  dauerMin: { min, max },     // Minuten GESAMT-Personenzeit? NEIN: Dauer je Durchgang; Personenstunden = personen * dauer
  zeitanker,                  // optional: "frueh" | "vormittag" | "nachmittag" | "abend" | konkrete Zeit ("06:00")
  rolle,                      // optional: Pflicht-Rolle ("baecker" | "ml" | "kassierer")
  budgetQuelle: "filiale",    // "filiale" | "extern" (extern = zählt NICHT gegen Wochenbudget, z.B. TS-Inventur-Team)
  aktiv: true
}
```

### Wochendaten-Erweiterung (`ep_wochen`)
```
lieferungen: [                // pro Woche konkretisiert (Vorbelegung aus Filial-Stammdaten)
  { tag: "mo", art: "frische", paletten: 4 },
  { tag: "di", art: "trocken", paletten: 12 },
  { tag: "do", art: "tk", paletten: 3 }
],
inventurenDiesenMonat: [],    // welche Inventuren in diese Woche fallen (App schlägt nach Rhythmus vor)
```

### Filial-Stammdaten-Erweiterung (`ep_filialen`)
```
lieferprofil: {
  frische: { tage: ["mo","di","mi","do","fr","sa"], zeitpunkt: "frueh" },  // oder "vorabend"/"nachts"
  trocken: { tage: ["di","do"], typischePaletten: 10 },                    // 2-3x/Woche, Aktion kommt mit
  tk:      { tage: ["mi","fr"], typischePaletten: 3 },
  fleischAusnahmen: ["di"]     // Fleisch täglich AUSSER diesen Tagen
},
palettenFaktoren: {            // Minuten Verräumzeit pro Palette, je Art (editierbar)
  frische: 45, trocken: 40, tk: 60, mopro: 45
},
bestellzeiten: { ... }         // Deadlines je Warengruppe (Anzeige im Tagesplan)
```

---

## Standard-Katalog (Default-Daten, beim ersten Start laden)

### Täglich
| Vorgang | Personen | Dauer | Anker | Rolle |
|---|---|---|---|---|
| Backen früh (Erstbestückung + Reinigung Vorbereitungsraum) | 1 | 150–180 min | 06:00, Shop voll bis 07:30, fertig 08–09 | baecker |
| O&G-Aufbau (Mitteltisch, Seitenregal, Bananenwelle, Beeren, Blumen) | 1–2 | 150 min | 06:00, verkaufsbereit 07:00 | – |
| O&G-Aufbau: Mo/Do/Fr = 2 Personen (Volumentage) | 2 | 150 min | 06:00 | – |
| Nachbacken (alle ~2h prüfen) | 1 | 15 min je Durchgang, ~4–6 Durchgänge | tagsüber | baecker-quali |
| Frische-Qualitätskontrolle (alle Bereiche, alle 2h) | 1–2 | 30–60 min gesamt | tagsüber | – |
| MHD O&G + Reduzierungen | 1 | 15 min | frueh | – |
| MHD Fleisch | 1 | 10 min | frueh | – |
| MHD Mopro (Di–Sa) | 1 | 15–30 min | frueh | – |
| MHD Mopro Komplettaufnahme (Mo) | 1 | 120 min | mo, frueh | – |
| Bestellungen ML (Obst 15 + Mopro 20 + Fleisch 15) | 1 | 50 min | vor Deadline | ml |
| Bestellung B/O | 1 | 15 min | frueh | baecker |
| Leergut-Sortierung (verteilt) | 1 | 60–120 min | tagsüber | – |
| Zeitschriften/Presse | 1 | 10 min | vor 07:00 | kassierer |
| Kassen/Tresor Öffnung | 1 | 10 min | vor Öffnung | schluesseltraeger |
| Kassenabrechnung + Safebag + Tresor | 1 | 15 min | Schluss | schluesseltraeger |
| Reinigungskraft (fegen, Wischplan) | 1 | 120 min | 06:00–08:00 | (Reinigungskraft) |

### Wöchentlich
| Vorgang | Personen | Dauer | Fester Tag |
|---|---|---|---|
| Wochenwerbung aufbauen (ab Mo) | 2–3 | 180 min | sa abend |
| Do-Werbung aufbauen | 1–2 | 60–120 min | mi abend |
| Freitagskracher aufbauen | 1 | 15–30 min | do abend |
| Werbemittel (Plakate/Wippen/Aufsteller) | 1 | 60 min | sa abend / mo früh |
| MHD-Kontrollplan (rotierende Warengruppe) | 1 | 15–120 min | frei |
| Warensicherungs-Kontrolle | 1 | 60 min | frei |

### Je Liefertag (aus `lieferungen` der Woche berechnet)
| Vorgang | Formel |
|---|---|
| Warenannahme (Zigaretten-, Palettenkontrolle, SSCC/TMBS) | 30 min je Lieferung |
| Verräumung | paletten × palettenFaktor[art] Minuten (parallelisierbar auf mehrere MA) |
| Fleisch/Mopro-Verräumung: Reste nachpacken (Fleisch 15 + Mopro/Wurst 30) + Neuware FIFO + 15 min siegeln/aufräumen | in frische-Faktor enthalten; Fleisch nicht an fleischAusnahmen-Tagen |
| TK-Verräumung | 60–180 min an TK-Tagen |
| Aktion einlagern (Trocken-Liefertag) | Teil der Trocken-Verräumung |

### Inventuren (App schlägt fällige automatisch vor)
| Inventur | Rhythmus | Tag | Dauer | Budget |
|---|---|---|---|---|
| SB Fleisch/Wurst | monatlich | di | 120 min | filiale |
| O&G | monatlich | mo | 60 min | filiale |
| Bake-Off | alle 2 Monate | mo | 60 min | filiale |
| Mopro | alle 2 Monate | mo | 90 min | filiale |
| Trocken inkl. Zigaretten | alle 4 Monate | – | externes Team | **extern** |
| TS-Inventur-Vorbereitung | alle 4 Monate | Vortag | 600–960 min | **extern (Zusatzbudget)** |

### Saison
| Vorgang | Rhythmus | Dauer |
|---|---|---|
| Saisonaufbau Ostern / Weihnachten | 2×/Jahr | 240–360 min |

Preisänderungen: **entfällt** (elektronische Preisauszeichnung); Etikett-Verknüpfung neuer Ware ist Teil der Verräumung.

---

## Bedarfsrechnung (Kern-Feature)

Pro Tag der gewählten Woche:

```
tagesbedarfMin =
    Σ (täglich aktive Vorgänge: personen_mittel × dauer_mittel)
  + Σ (wöchentliche/monatliche Vorgänge, die auf diesen Tag fallen)
  + Σ (Lieferungen des Tages: 30 + paletten × faktor)
  + Dauerbesetzung: Kassenbedarf (kassenStandard + Peaks) über Öffnungszeit
```

- Min/Max-Spannen mitführen → Anzeige „ca. 38–45 Std".
- Vorgänge mit `budgetQuelle: "extern"` in der Anzeige zeigen, aber **nicht** vom Wochenbudget abziehen.
- **Wochen-Summe vs. Budget:** Ampel (grün = passt, gelb = knapp <5% Luft, rot = Bedarf > Budget).
- **Tagesansicht für den ML:** Liste der heutigen Vorgänge mit Zeitanker + benötigten Rollen (z.B. „06:00 Backen (Bäcker), 06:00 O&G-Aufbau ×2, Lieferung Trocken 12 Pal ≈ 8h, Sa: Wochenwerbung 3P×3h abends").

### Abgleich Plan ↔ Bedarf (Prüf-Layer-Erweiterung)
- Tag mit Lieferung, aber geplante Personenstunden < Tagesbedarf → Warnung „Unterdeckung ~X h".
- Sa-Abend-Schichten decken Wochenwerbung nicht (zu wenige Leute nach 18 Uhr am Sa) → Warnung.
- Vorgang mit Pflicht-Rolle, aber kein MA mit passender Quali an dem Tag → Warnung.
- Alles bleibt **Warnung, keine Sperre**.

### UI
- Neuer Tab/Bereich **„Bedarf"** in der Wochenansicht: Balken pro Tag (Bedarf vs. geplant vs. Budget-Anteil).
- Katalog-Verwaltung unter Einstellungen: Vorgänge aktivieren/deaktivieren, Zeiten anpassen (pro Filiale Override).
- Wochen-Dialog: Lieferungen der Woche bestätigen/anpassen (Vorbelegung aus lieferprofil), Paletten-Schätzung je Lieferung eingebbar.

---

## Phase B-Anschluss (nicht bauen, nur berücksichtigen)
Die Auto-Engine nutzt später denselben Bedarf: Slots aus Dauerbesetzung + Zeitanker-Vorgängen erzeugen, Rollen matchen, Volumentage stärker besetzen. Datenmodell muss dafür nichts Neues können.

---

## Prinzipien
- Alles in JS vorberechnet, keine Excel-Formeln.
- localStorage only, Prefix `ep_`.
- Mobile-first, Kalkulation statt Task-Management.
- Defaults = dieser Katalog; jede Filiale kann überschreiben.
