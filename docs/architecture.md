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
- activating a device client explicitly
- assigning layouts

Access restricted via authentication.

Admin entry routing:
- canonical login route: `/admin/login`
- convenience root route: `/`
  - redirects to `/admin/login`

---

## 2. Public Device Renderer

Route:
- `/d/{deviceCode}`

Responsibilities:
- identify device
- derive the current device/browser access state
- render layout or waiting/error page
- run polling for updates and session recovery

Routing separation:
- `/` is not a public device route
- `/d/{deviceCode}` remains the public device renderer entry
- admin remains namespaced under `/admin`

---

## 3. Storage Layer

File-based storage using JSON files.

Structure:
- `data/layouts/`
- `data/devices/`
- `data/device-auth/`
- `users/`

`data/device-auth/` stores:
- `secretHash`
- client activity and activation data per device
- the official heartbeat `lastStatusAt`

---

## Device Model

A device:
- has a unique code
- may have a human-readable description for admin use
- has a status: `pending`, `approved`, `revoked`
- is assigned exactly one layout

The active browser context is tracked separately via `device-auth`.

---

## Device Authorization Layers

Three layers must stay separate:

1. Device approval
- `device.status`

2. Official active client
- `isPairedClient = true`
- exactly one active client per `deviceCode`

3. Browser session
- `mydashmaster_device` cookie
- short-lived, refreshable session token

Additional browser identity tracking:
- `mydashmaster_device_client`
- stable browser-profile `clientId`
- not an auth factor by itself

Additional browser-side secret storage:
- `deviceSecret` is stored browser-side per `deviceCode`
- primary storage key:
  - `mydashmaster-device-secret:{deviceCode}`
- legacy fallback key:
  - `mydashmaster-device-secret`
- legacy values may only be migrated to the scoped key after successful `/auth`

---

## Access State Model

The public device lifecycle uses these access states:
- `pending_activation`
- `active_authorized`
- `reauth_required`
- `auth_mismatch`
- `blocked_by_other_client`
- `revoked`

These states are derived centrally and must be shared by:
- `GET /d/{deviceCode}`
- `GET /api/device/{deviceCode}/status`

### Meaning

- `pending_activation`
  - real admin wait state
  - device not approved or no active client selected yet
- `active_authorized`
  - approved device, active client, valid session
  - layout may be rendered
- `reauth_required`
  - approved device, active/known client context, but session missing or expired
  - browser should auto-run `/auth`
- `auth_mismatch`
  - client secret/auth evidence no longer matches current server-side `secretHash`
- `blocked_by_other_client`
  - another browser is currently the active client
- `revoked`
  - hard stop, no automatic recovery

---

## Rendering Flow

1. Browser calls `/d/{deviceCode}`
2. Server loads device and device-auth data
3. Server validates the current session cookie
4. Server derives the canonical access state
5. If `active_authorized`:
   - render layout
6. Otherwise:
   - render the waiting/error page for the derived access state

Important:
- an expired session cookie must not be treated as missing admin activation
- it must resolve to `reauth_required` if the browser is otherwise the correct active client context
- a browser with an active layout must not immediately reload into a waiting page on a single transient soft-state poll
- `reauth_required` on an already active layout should first try silent `/auth`
- `pending_activation` on an already active layout should require repeated confirmation before leaving the layout

## Active Layout Runtime Behavior

On the already rendered active device page:

- `active_authorized`
  - keep layout visible
  - reset any soft-failure counter
- `reauth_required`
  - do not immediately switch to waiting UI
  - attempt silent `/auth` using the browser-side scoped `deviceSecret`
  - if the silent reauth succeeds, keep the layout visible
  - if reauth fails hard (`401`, `auth_mismatch`), switch away from the layout
- `pending_activation`
  - treat as a soft/transient state first
  - require repeated confirmation before leaving the layout
- `revoked`, `auth_mismatch`, `blocked_by_other_client`
  - treat as hard states
  - leave the layout immediately

---

## Device API Responsibilities

### `GET /api/device/{deviceCode}/status`

Central polling endpoint for:
- official device heartbeat
- client activity
- access checks
- reload / layout-change detection

Status payload should expose:
- `accessState`
- `authorized`
- `hasValidSession`
- `isActiveClient`
- `hasActiveClient`
- `hasCurrentAuthentication`
- `canAttemptBootstrapAuth`
- `canAttemptReauth`
- plus existing compatibility fields while needed

### `POST /api/device/{deviceCode}/auth`

Used to:
- validate the `deviceSecret`
- establish or refresh the session cookie
- update client auth evidence

Must not:
- activate a client implicitly
- write the official heartbeat

### `GET /api/device/{deviceCode}/layout-fragment`

Used only for `active_authorized` clients.

---

## Heartbeat Model

Operational liveness:
- official heartbeat is `lastStatusAt`
- only `active_authorized` may advance it
- heartbeat is separate from approval and separate from `lastConnectedAt`

Client observation:
- status polling may also update client activity
- client activity is diagnostic only
- only the active authorized client contributes the official heartbeat

See:
- `docs/device-heartbeat.md`

---

## Reset Activation

Current reset behavior:
- clears the active assignment
- clears `secretHash`
- stops the official heartbeat
- returns known clients to the activation cycle

That is separate from session-expiry recovery.

Session expiry recovery should use:
- `reauth_required`
- automatic `/auth`
- no admin action

---

## Design Principles

- keep it simple
- avoid overengineering
- use server-side rendering
- prefer explicit lifecycle semantics over inferred UI guesses
