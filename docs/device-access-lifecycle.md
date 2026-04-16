# Device Access Lifecycle & Admin UX

## Ziel
Saubere Definition der Zustände, Übergänge und Admin-Interaktionen für Device-Zugriffe.

---

## Zustände

- unknown
- pending
- not_paired
- auth_mismatch
- authorized
- revoked

---

## Zustandsbeschreibung

### pending
- Device existiert, aber nicht freigegeben
- Bootstrap aktiv
- Polling aktiv
- Bei Approval darf die Waiting Page nicht allein wegen `status = approved` ins Layout wechseln
- Finaler Wechsel erst bei `accessState = authorized`

### not_paired
- Device ist freigegeben, aber aktuell kein paired active client existiert
- nach `Reset Pairing` wird der aktive `secretHash` entfernt
- danach entsteht der nächste aktive `secretHash` erst wieder durch erfolgreichen Bootstrap/Auth
- Re-Pairing / Recovery erlaubt
- Bootstrap aktiv
- Erfolgreicher Bootstrap/Auth validiert den Secret-Flow und setzt oder erneuert die Session für den aktuellen Browser
- Ergebnis danach zunächst weiter: `not_paired`
- offizieller Zugriff entsteht erst nach expliziter Admin-Pairing-Aktion für diesen `clientId`

### auth_mismatch
- Device hat bereits einen paired active client, aber dieser Browser ist nicht der offizielle Client
- Kein Bootstrap
- Nur Polling

### authorized
- Zugriff vollständig erlaubt
- Layout sichtbar

### revoked
- Zugriff entzogen
- Kein Bootstrap
- Kein Zugriff

---

## Übergänge

- pending → authorized (nach erfolgreichem Pairing + Approval)
- authorized → not_paired (Reset pairing)
- authorized → revoked (Revoke)
- auth_mismatch → not_paired (Reset pairing)
- not_paired → authorized (Auth/Session erfolgreich + explizites Admin-Pairing)

---

## Wichtige Regeln

- approved allein reicht nicht → authorized ist entscheidend
- not_paired muss immer recoverbar sein
- auth_mismatch darf nicht automatisch re-pairen
- revoked ist final (bis Admin eingreift)

### Mehrere Browser-Clients pro deviceCode

Mehrere Browser-Clients pro `deviceCode` sind möglich.

Dabei gilt:
- genau EIN paired active client existiert
- weitere Browser-Clients sind client-level observations

Diese client-level observations sind:
- pending
- auth_mismatch
- revoked
- not_paired

Wichtige Präzisierung:
- diese Zustände sind keine konkurrierenden Device-Zustände
- sie sind client-level observations
- nur der paired active client repräsentiert den offiziellen Device-Zugriff
- zusätzliche Browser gelten als additional unpaired client activity
- genau ein Client darf `isPairedClient = true` haben
- wenn ein neuer Client paired active client wird, verliert der bisherige Client `isPairedClient = true` sofort

Definition des paired active client:
- der paired active client ist der einzelne offizielle Client-Kontext für ein `deviceCode`
- er liefert den official device heartbeat
- er ist nicht nur „ein weiterer gültiger Browser“, sondern die exklusive offizielle Client-Zuordnung

---

## Race Condition Regel

Ein Device darf erst ins Layout wechseln, wenn:
- authorized = true

Nicht bei:
- status = approved
- status = approved und authorized = false

---

## Waiting Page Verhalten

### pending
- Bootstrap aktiv
- Auto-Advance bei Erfolg
- Status-Polling darf einen Reload nur auslösen, wenn `accessState` sich wirklich ändert
- `status = approved` allein reicht nicht für den Reload

### not_paired
- Bootstrap aktiv
- kein Auto-Advance allein wegen erfolgreichem Auth-Call
- Erfolgreicher Auth-Call setzt oder erneuert nur die Session für den aktuellen Browser
- Device bleibt `not_paired`, bis Admin diesen `clientId` explizit pairt

### auth_mismatch
- Kein Bootstrap
- Reload nur bei Zustandswechsel
- Typischer Recovery-Pfad: Admin führt `Reset Pairing` aus, danach Wechsel zu `not_paired`

---

## Admin Panel Anforderungen

Referenz für Heartbeat/Liveness:
- `docs/device-heartbeat.md`

### Informationsanzeige pro Device

- Status (pending / approved / revoked)
- Pairing Status (paired / not paired)
- Letzter Zugriff:
  - IP-Adresse
  - Datum (TT.MM.JJJ)
- Letzte Status-Aktualisierung:
  - Sekunden seit letztem Kontakt

Wichtige Präzisierung:
- „letzter Zugriff“ und „letzte Status-Aktualisierung“ sind nicht dasselbe
- Zugriff basiert auf erfolgreicher autorisierter Device-Nutzung
- Status-Aktualisierung basiert auf dem official device heartbeat
- ein späteres `online`-Badge darf nur aus dem Heartbeat-Modell abgeleitet werden
- additional unpaired client activity darf `Seen` und `Online` nicht beeinflussen

---

## Button UX (Wichtig!)

Aktuell: 4 Buttons nebeneinander → unübersichtlich

### Ziel:

Klare Hierarchie + bessere Lesbarkeit

Empfohlene Struktur:

1. Primary Actions:
   - Approve (wenn pending)
   - Reset Pairing (wenn paired)

2. Secondary Actions:
   - Revoke

3. Destructive:
   - Delete (rot, eigener Bereich)

### Umsetzungsideen:

- Buttons gruppieren (z. B. Dropdown oder 2 Zeilen)
- Icons verwenden
- Delete klar visuell abheben (rot + Abstand)

---

## Reset Pairing (Definition)

- löscht:
  - secretHash
  - candidateSecretHash
- Status bleibt: approved
- Ergebnis: not_paired
- alle Clients verlieren `isPairedClient = true`
- alle Clients werden `accessState = not_paired`
- alle Clients verlieren ihr bisheriges Auth-/Session-Evidence (`lastAuthenticatedAt`)
- Device kann neu gekoppelt werden
- nächster erfolgreicher Bootstrap/Auth setzt einen neuen aktiven `secretHash` und die Session für den Browser
- ein später explizit gepairter Client wird der neue paired active client
- ein zuvor markierter paired active client verliert dabei sofort `isPairedClient = true`

---

## Auth Endpoint Regel

- `pending`:
  - speichert `candidateSecretHash`
  - bleibt `pending`

- `not_paired`:
  - akzeptiert Bootstrap/Auth
  - validiert `secretHash`
  - setzt oder erneuert Session/Cookie für den aktuellen Browser
  - Ergebnis bleibt zunächst: `not_paired`
  - offizieller Zugriff entsteht erst nach explizitem Admin-Pairing

- `auth_mismatch`:
  - kein automatisches Re-Pairing
  - nur Zustandswechsel durch Admin-Aktion

---

## Recovery-Regeln

- `pending`:
  - darf automatisch weiter pollen und bootstrapen
  - nach Approval bleibt die Waiting Page aktiv, bis Auth erfolgreich ist

- `not_paired`:
  - darf automatisch bootstrapen / authentifizieren
  - ein `401` auf dem Auth-Endpoint wäre hier falsch, solange der Secret korrekt ist
  - bleibt bis zum expliziten Admin-Pairing `not_paired`

- `auth_mismatch`:
  - darf nicht automatisch re-pairen
  - Recovery nur über Admin-Aktion und anschließenden Zustandswechsel

---

## Testfälle (Minimal Set)

1. Pending → Approval → Authorized
2. Authorized → Reset Pairing → Not Paired
3. Not Paired → Re-Pair → Authorized
4. Authorized → anderer Browser → auth_mismatch
5. auth_mismatch → Reset Pairing → Recovery
6. Authorized → Revoke → Zugriff weg

---

## Fazit

- Zustände sind korrekt
- Übergänge müssen strikt eingehalten werden
- Admin UX braucht Vereinfachung
- Monitoring (letzter Zugriff + Status) erhöht Transparenz massiv
