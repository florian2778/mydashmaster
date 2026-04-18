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
6. If validation fails → pending page or blocked page
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
- `active -> active` layout identity change:
  - client-side layout refresh
- lifecycle/access-state change:
  - full page reload / server-rendered transition

Operational liveness:
- a later admin-side `Seen` / `Online` indicator should be based on a dedicated heartbeat timestamp
- this timestamp is the official device heartbeat
- the official device heartbeat is updated by the active client only
- heartbeat is separate from authorization and separate from `lastConnectedAt`
- see `docs/device-heartbeat.md`

Client observation:
- status endpoint handling may also record client activity
- client activity is a client-level observation, not device-level truth
- update client activity only for:
  - known `deviceCode`
  - syntactically valid request
  - real device status endpoint request
- do not update client activity for:
  - unknown device
  - malformed request
  - unrelated endpoints
- only the active client contributes the official device heartbeat

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
- after reset activation, a browser may stay technically authenticated and still remain `pending`

Exclusivity:
- an active client is the single official client context for one `deviceCode`
- exactly one client may have `isPairedClient = true` per `deviceCode`
- when a new client becomes the active client, the previous one must lose `isPairedClient = true` immediately

Separation rule:
- device-level truth uses the official device heartbeat
- client-level observation may include additional pending or blocked client activity
- additional pending or blocked client activity must not change `Seen` or `Online`
- timestamps remain stored as ISO timestamps; display formatting is a UI concern only

Post-reset recovery flow:
1. Admin resets activation
2. No client remains active
3. Device status stays `approved`
4. Current `secretHash` is cleared
5. Known clients derive to `pending`
6. Recently active and technically authenticated clients may be activated again immediately
7. The next activated client defines the new `secretHash`
8. Only an explicitly activated client may render the layout and update the official device heartbeat

State decision rule:
- `pending` means no active client currently exists
- `blocked` means another active client already exists

---

## Design Principles

- keep it simple
- avoid overengineering
- use server-side rendering
- prefer readability over abstraction
