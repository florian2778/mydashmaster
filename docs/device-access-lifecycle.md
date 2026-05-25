# Device Access Lifecycle & Admin UX

## Goal

Saubere Definition der Zustände, Übergänge und Admin-Interaktionen für Device-Zugriffe.

---

## Ebenen

Es gibt drei getrennte Ebenen:

- Device-Ebene
  - `device.status`: `pending`, `approved`, `revoked`
- Client-Ebene
  - offizieller aktiver Client über `isPairedClient`
- Session-Ebene
  - gültiges Device-Session-Cookie `mydashmaster_device`

Mehrere Browser-Clients pro `deviceCode` sind möglich.

Wichtige Regel:
- genau EIN aktiver Client existiert
- weitere Browser sind diagnostische Client-Beobachtungen
- ein abgelaufenes Session-Cookie ist kein Admin-Fall

---

## Sichtbare Access States

Die sichtbare Device-/Browser-Seite arbeitet mit diesen Access States:

### `pending_activation`

- echte Admin-/Aktivierungswartephase
- gilt wenn:
  - `device.status !== "approved"`
  - oder noch kein aktiver Client existiert
- das Layout wird nicht angezeigt
- technischer Auth-Aufbau darf im Hintergrund stattfinden

### `active_authorized`

- Device ist `approved`
- dieser Browser ist der aktive Client
- Session-Cookie ist gültig
- das Layout darf angezeigt werden
- nur in diesem Zustand darf `lastStatusAt` fortgeschrieben werden

### `reauth_required`

- Device ist `approved`
- dieser Browser ist weiterhin der relevante aktive/zugehörige Client
- aber das Session-Cookie fehlt oder ist abgelaufen
- der Browser soll automatisch `/api/device/{deviceCode}/auth` mit dem lokalen `deviceSecret` versuchen
- das ist kein Admin-Fall

### `auth_mismatch`

- Browser/Client-Kontext passt nicht mehr zum aktuellen `secretHash`
- automatischer Reauth-Versuch darf hier nicht endlos wiederholt werden
- Recovery erfordert einen bewusst neuen Secret-/Client-Kontext

### `blocked_by_other_client`

- ein anderer Browser ist bereits der aktive Client
- dieser Browser darf das Layout nicht anzeigen
- kein automatischer Reauth-/Bootstrap-Loop

### `revoked`

- harter Stopp
- kein Bootstrap
- kein automatisches Recovery

---

## Entscheidungslogik

`GET /d/{deviceCode}` und `GET /api/device/{deviceCode}/status` müssen dieselbe zentrale Ableitung verwenden.

Fachlich gilt:

1. `device.status = revoked`
   - `revoked`
2. `device.status != approved`
   - `pending_activation`
3. `device.status = approved` und kein aktiver Client existiert
   - `pending_activation`
4. aktiver Client existiert, aktueller Browser ist nicht dieser Client
   - `blocked_by_other_client`
   - oder `auth_mismatch`, wenn gespeicherte Auth-Evidence nicht mehr zum aktuellen `secretHash` passt
5. aktueller Browser ist aktiver Client, aber Session fehlt
   - `reauth_required`
6. aktueller Browser ist aktiver Client und Session ist gültig
   - `active_authorized`

---

## Activation Flow

Aktivierung bleibt explizit.

1. Browser öffnet `/d/{deviceCode}`
2. Browser kann technisch `/api/device/{deviceCode}/auth` verwenden
3. ohne aktiven Client bleibt der sichtbare Zustand `pending_activation`
4. Admin wählt explizit `Activate`
5. der gewählte Client wird aktiv
6. derselbe Browser geht nach gültiger Session in `active_authorized`
7. alle anderen Browser werden `blocked_by_other_client`

---

## Session Recovery

Wichtige Regel:
- das Session-Cookie darf kurzlebig sein
- sein Ablauf darf keinen manuellen Admin-Fall erzeugen

Daher gilt:
- wenn ein Device `approved` ist
- der Browser weiterhin der relevante aktive Client ist
- aber `mydashmaster_device` fehlt oder abgelaufen ist
- dann ist der korrekte Zustand `reauth_required`
- die Browser-Seite soll automatisch `/auth` mit dem lokalen `deviceSecret` versuchen

Kein automatisches Recovery bei:
- `auth_mismatch`
- `blocked_by_other_client`
- `revoked`

---

## Reset Activation

Reset activation bedeutet aktuell:
- aktive Client-Zuordnung entfernen
- `isPairedClient = false` für alle Clients
- `secretHash` entfernen
- `lastStatusAt` stoppen

Danach:
- kein Client ist aktiv
- alle bekannten Clients leiten zu `pending_activation` ab
- das Layout verschwindet überall
- beim nächsten erfolgreichen Aktivieren startet ein neuer aktiver Zyklus

---

## Admin UI Bedeutung

Device Overview zeigt nur Device-Level-Wahrheit:
- `Seen` aus `lastStatusAt`
- keine zusätzlichen Clients

Device Detail trennt:
- offiziellen aktiven Client
- zusätzliche Client-Aktivität
- Aktivierbarkeit
- technische Details

Zusätzliche Clients bleiben diagnostisch und dürfen nie:
- `Seen` verändern
- `Online` verändern
- den offiziellen Device-Zustand redefinieren

---

## Minimale Testfälle

1. `pending_activation` bei nicht freigegebenem Device
2. `pending_activation` bei approved Device ohne aktiven Client
3. `active_authorized` nur mit aktivem Client + gültiger Session
4. `reauth_required` bei aktivem Client ohne Session-Cookie
5. `auth_mismatch` ohne Auto-Reauth-Schleife
6. `blocked_by_other_client` ohne Layoutzugriff
7. nur `active_authorized` schreibt `lastStatusAt`
