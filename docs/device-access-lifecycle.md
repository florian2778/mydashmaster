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
- Device ist freigegeben, aber kein secretHash vorhanden
- Re-Pairing erlaubt
- Bootstrap aktiv
- Erfolgreiches Re-Pairing schreibt einen neuen `secretHash` direkt als aktive Bindung
- Erfolgreicher Bootstrap/Auth liefert direkt `approved` zurück und setzt die Session für den aktuellen Browser
- Ergebnis danach: `authorized`

### auth_mismatch
- Device ist gepairt, aber falscher Browser
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
- not_paired → authorized (Re-Pairing)

---

## Wichtige Regeln

- approved allein reicht nicht → authorized ist entscheidend
- not_paired muss immer recoverbar sein
- auth_mismatch darf nicht automatisch re-pairen
- revoked ist final (bis Admin eingreift)

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
- Auto-Advance bei Erfolg
- Erfolgreicher Auth-Call führt direkt zu `authorized`
- Kein zusätzlicher Admin-Schritt nötig, solange das Device bereits `approved` ist

### auth_mismatch
- Kein Bootstrap
- Reload nur bei Zustandswechsel
- Typischer Recovery-Pfad: Admin führt `Reset Pairing` aus, danach Wechsel zu `not_paired`

---

## Admin Panel Anforderungen

### Informationsanzeige pro Device

- Status (pending / approved / revoked)
- Pairing Status (paired / not paired)
- Letzter Zugriff:
  - IP-Adresse
  - Datum (TT.MM.JJJ)
- Letzte Status-Aktualisierung:
  - Sekunden seit letztem Kontakt

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
- Device kann neu gekoppelt werden
- Nächster erfolgreicher Bootstrap/Auth setzt einen neuen `secretHash`

---

## Auth Endpoint Regel

- `pending`:
  - speichert `candidateSecretHash`
  - bleibt `pending`

- `not_paired`:
  - akzeptiert Bootstrap/Re-Pairing
  - speichert Hash direkt als neuer `secretHash`
  - setzt Session/Cookie für den aktuellen Browser
  - Ergebnis: `authorized`

- `auth_mismatch`:
  - kein automatisches Re-Pairing
  - nur Zustandswechsel durch Admin-Aktion

---

## Recovery-Regeln

- `pending`:
  - darf automatisch weiter pollen und bootstrapen
  - nach Approval bleibt die Waiting Page aktiv, bis Auth erfolgreich ist

- `not_paired`:
  - darf automatisch re-pairen
  - ein `401` auf dem Auth-Endpoint wäre hier falsch

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
