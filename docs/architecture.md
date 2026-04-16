# Architecture

## Overview

MyDashmaster consists of three main parts:

1. Admin Backend
2. Public Device Renderer
3. JSON-based Storage Layer

---

## 1. Admin Backend

Responsible for:
- login
- managing layouts
- managing devices
- approving devices
- assigning layouts

Access restricted via authentication.

Admin entry routing:
- canonical login route: `/admin/login`
- convenience root route: `/`
  - redirects to `/admin/login`

---

## 2. Public Device Renderer

Route:
/d/{deviceCode}

Responsibilities:
- identify device
- check authorization
- render layout or pending page
- run polling for updates

Routing separation:
- `/` is not a public device route
- `/d/{deviceCode}` remains the public device renderer entry
- admin remains namespaced under `/admin`

---

## 3. Storage Layer

File-based storage using JSON files.

Structure:
data/
layouts/
devices/
device-auth/
- stores authentication data per device
- contains hash(deviceSecret)
- may contain candidateSecretHash for pending devices
users/

---

## Layout Model

A layout consists of:
- layoutId
- layoutVersion
- options
- structure
- boxes

The structure is a recursive tree of nodes:
- row
- column
- box

Boxes define iframe content:
- name
- url
- zoom

---

## Device Model

A device:
- has a unique code
- may have a human-readable description for admin use
- has a status (pending, approved, revoked)
  - pending: device not yet approved
  - approved: device allowed with valid secret
  - revoked: device explicitly blocked, requires re-approval
- is assigned exactly one layout

---

## Device Authorization

- authentication is based on a device-specific secret
- each device generates a persistent deviceSecret (client-side)
- server stores only hash(deviceSecret)
- deviceSecret is the primary authentication factor

- a cookie is used as a temporary validated session
- cookie does not replace deviceSecret authentication
- cookie can be revalidated using deviceSecret

- access requires:
  - valid deviceCode (routing only)
  - device status = approved
  - valid deviceSecret (or valid session cookie)

---

## Rendering Flow

1. Device calls `/d/{deviceCode}`
2. Server loads device
3. Server checks device status
4. If not approved → pending page
5. If approved:
   - validate session cookie if present
   - otherwise validate deviceSecret
6. If validation fails → pending / not authorized
7. If validation succeeds → render layout

---

## Update Mechanism

Devices poll:
/api/device/{deviceCode}/status

Status responses should expose the assigned layout identity:
- `layoutId`
- `layoutVersion`

If layout identity changed:
- different `layoutId`
- or same `layoutId` with different `layoutVersion`

then the device updates the visible layout according to the current renderer strategy.

Current target strategy:
- `authorized -> authorized` layout identity change:
  - client-side layout refresh
- lifecycle/access-state change:
  - full page reload / server-rendered transition

Operational liveness:
- a later admin-side `Seen` / `Online` indicator should be based on a dedicated heartbeat timestamp
- this timestamp is the official device heartbeat
- the official device heartbeat is updated by the paired active client only
- heartbeat is separate from authorization and separate from `lastConnectedAt`
- see `docs/device-heartbeat.md`

Client observation:
- status endpoint handling may also record client activity
- client activity is a client-level observation, not device-level truth
- update client activity only for:
  - known `deviceCode`
  - syntactically valid request
  - real device status endpoint request
  - `accessState` in:
    - `authorized`
    - `pending`
    - `auth_mismatch`
    - `revoked`
    - `not_paired`
- do not update client activity for:
  - unknown device
  - malformed request
  - unrelated endpoints
- only the paired active client contributes the official device heartbeat

Client identity:
- `clientId` is generated server-side
- `clientId` is stored in a browser cookie
- `clientId` survives reloads
- `clientId` is browser-profile scoped, not tab-scoped
- `clientId` is used only for client activity tracking, not as an auth factor by itself

Authenticated browser session:
- a valid device session cookie represents an authenticated browser session
- authenticated browser session is separate from `clientId`
- authenticated browser session is separate from explicit admin pairing
- after reset pairing, a browser may authenticate again and receive a valid device session cookie while still remaining `not_paired`

Exclusivity:
- a paired active client is the single official client context for one `deviceCode`
- exactly one client may have `isPairedClient = true` per `deviceCode`
- when a new client becomes the paired active client, the previous one must lose `isPairedClient = true` immediately

Separation rule:
- device-level truth uses the official device heartbeat
- client-level observation may include additional unpaired client activity
- additional unpaired client activity must not change `Seen` or `Online`
- timestamps remain stored as ISO timestamps; display formatting is a UI concern only

Post-reset recovery flow:
1. Admin resets pairing
2. No client remains paired
3. Device status stays `approved`
4. Active `secretHash` is removed
5. Browser authenticates again and establishes a new active `secretHash`
6. Server refreshes the authenticated browser session cookie and records authenticated session evidence for that `clientId`
7. Browser remains `not_paired`
8. Admin explicitly pairs that `clientId`
9. Only then may the client become `authorized` and update the official device heartbeat

Reset invalidation rule:
- reset pairing invalidates previously authenticated browser sessions
- reset pairing clears client-level authenticated session evidence
- a browser that was authenticated before reset must authenticate again before it becomes pairable

State decision rule:
- `not_paired` means no paired active client currently exists
- `auth_mismatch` means another paired active client already exists

---

## Design Principles

- keep it simple
- avoid overengineering
- use server-side rendering
- prefer readability over abstraction
