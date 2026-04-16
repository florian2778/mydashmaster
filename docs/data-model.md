# Data Model

This document defines the JSON structure used by MyDashmaster.

## Overview

A layout consists of:
- layoutId
- layoutVersion
- options (optional)
- structure
- boxes

A device consists of:
- deviceCode
- description
- status
- layoutId

A device auth record consists of:
- deviceCode
- candidateSecretHash (optional)
- secretHash (optional)
- lastStatusAt (optional)
- clients (optional)
- updatedAt (optional)

The layout structure is a recursive tree of nodes:
- row
- column
- box

---

## Device

Path: data/devices/{deviceCode}.json

Example:

{
  "deviceCode": "demo-device",
  "description": "Meeting room display",
  "status": "approved",
  "layoutId": "layout-1"
}

Fields:
- deviceCode (string)
- description (string, optional)
- status (string)
- layoutId (string)

`description` meaning:
- human-readable label for admin use
- used to identify the physical device or installation purpose
- not used for authentication or routing

status can be:
- pending
- approved
- revoked

Status meaning:
- pending: device is registered but not yet approved
- approved: device is allowed to access layout with valid authentication
- revoked: device access is explicitly disabled

---

## Device Authentication

Path: data/device-auth/{deviceCode}.json

This file stores authentication-related data for a device.

Example:

{
  "deviceCode": "demo-device",
  "candidateSecretHash": "hashed-value",
  "secretHash": "hashed-value",
  "lastStatusAt": "2026-04-15T12:00:20Z",
  "clients": [
    {
      "clientId": "client-1",
      "lastSeenAt": "2026-04-15T12:00:20Z",
      "lastAuthenticatedAt": "2026-04-15T12:00:10Z",
      "accessState": "authorized",
      "isPairedClient": true,
      "userAgent": "Mozilla/5.0"
    }
  ],
  "updatedAt": "2026-04-12T12:00:00Z"
}

Fields:
- deviceCode (string)
- candidateSecretHash (string, optional)
  - used while device is in pending state
- secretHash (string, optional)
  - active authentication hash for approved devices
- lastStatusAt (string, optional)
  - official device heartbeat
  - updated only by the paired active client
- clients (array, optional)
  - diagnostic client activity for one `deviceCode`
  - may contain the paired active client and additional unpaired client activity
- updatedAt (string, optional)

Optional `clients[]` fields:
- clientId (string)
  - generated server-side
  - stored in a browser cookie
  - survives reloads
  - browser-profile scoped, not tab-scoped
  - used only for client activity tracking, not as an auth factor by itself
- lastSeenAt (string, ISO timestamp)
  - diagnostic client activity timestamp only
- lastAuthenticatedAt (string, ISO timestamp, optional)
  - timestamp of the last successful device secret authentication for this browser profile
  - indicates that the browser established or refreshed a valid device session cookie
  - used as pairing precondition
  - does not make the client official by itself
  - is cleared on reset pairing because reset invalidates the active authenticated browser sessions
- accessState (string)
  - allowed values:
    - `authorized`
    - `pending`
    - `auth_mismatch`
    - `revoked`
    - `not_paired`
- isPairedClient (boolean)
  - exactly one client may have `isPairedClient = true` per `deviceCode`
  - when a new client becomes the paired active client, the previous one must lose `isPairedClient = true` immediately
- userAgent (string, optional)

Rules:
- The plain deviceSecret is never stored on the server.
- Only a one-way hash is persisted.
- `candidateSecretHash` is used before approval.
- `secretHash` is the active authentication hash after approval.
- `lastStatusAt` = official device heartbeat.
- `clients[].lastSeenAt` = diagnostic only.
- `clients[].lastAuthenticatedAt` = authenticated browser session evidence only.
- additional unpaired client activity must not redefine `Seen` or `Online`.
- `clients[]` stores client activity, not device-level truth.

Session and pairing rules:
- `clientId` identifies the browser profile for client activity tracking only.
- a valid device session cookie represents an authenticated browser session.
- `isPairedClient = true` represents explicit admin pairing only.
- after reset pairing, a browser may authenticate again and receive a valid device session cookie while still remaining `not_paired`.
- reset pairing clears `clients[].lastAuthenticatedAt` for all clients.
- explicit admin pairing requires a client with recorded `lastAuthenticatedAt`.
- only a client that is both:
  - authenticated via valid device session
  - explicitly paired via `isPairedClient = true`
  may use `accessState = authorized`

Client activity update rule:
- update `clients[].lastSeenAt` only for:
  - known `deviceCode`
  - syntactically valid request
  - real device status endpoint request
  - `accessState` in:
    - `authorized`
    - `pending`
    - `auth_mismatch`
    - `revoked`
    - `not_paired`
- do not update it for:
  - unknown device
  - malformed request
  - unrelated endpoints

Retention / cleanup:
- clients older than 48 hours without new activity may be removed
- cleanup is recommended for MVP, not strictly mandatory
- opportunistic cleanup during write/polling is acceptable

---

## Device Authentication Lifecycle

- On first contact:
  - client sends deviceSecret
  - server stores candidateSecretHash

- On approval:
  - candidateSecretHash becomes secretHash
  - candidateSecretHash may be removed

- On authentication:
  - hash(deviceSecret) must match secretHash

- On revocation:
  - secretHash is removed or invalidated
  - device loses access immediately

---

## Layout

Path: data/layouts/{layoutId}.json

Fields:
- layoutId (string)
- layoutVersion (integer)
- options (object, optional)
- structure (object)
- boxes (array)

`layoutVersion` meaning:
- monotonically increasing version number for the layout definition
- used so active devices can detect layout changes even when `layoutId` stays the same
- must increase whenever a layout is changed and saved

Example:

{
  "layoutId": "layout-1",
  "layoutVersion": 3,
  "options": {
    "showHeader": false,
    "showStatus": false,
    "showLayoutTitle": false
  },
  "structure": {},
  "boxes": []
}

---

## Options

Controls rendering behavior.

{
  "showHeader": false,
  "showStatus": false,
  "showLayoutTitle": false
}

Defaults:
- In production/device mode → all false
- In admin/preview mode → typically true

---

## Structure

Nodes:
- row → horizontal layout
- column → vertical layout
- box → leaf node (iframe)

Each node can have:
- size (optional): "60%", "300px", "1fr"
- gap (only for row/column, optional): "0px", "8px", ...

---

## Rules

- structure is recursive
- row/column must have children[]
- box must reference boxes[].name
- box must not have children
- gap is only allowed on row and column
- gap must be a pixel value (e.g. "0px", "8px")

---

## Box

{
  "name": "box1",
  "url": "https://example.com",
  "zoom": 1.0
}

---

## Size

The `size` property defines how much space a node takes within its parent container.

The interpretation depends on the parent node:
- In a row → width
- In a column → height

Allowed formats:
- percentage (e.g. "60%")
- pixels (e.g. "300px")
- fractional units (e.g. "1fr")

### Behavior within the same level

All `size` values are evaluated relative to their siblings.

- % values should typically sum to 100%
- `fr` distributes remaining space
- `px` is fixed

Examples:
- "200px", "1fr", "1fr"
- "30%", "30%", "30%" → 90% used
- "50%", "60%" → overflow

Validator behavior:
- If % != 100 → warning
- If overflow → warning or error depending on severity

---

## Gap

Defines spacing between children in row/column.

- Only valid on row/column
- Must be pixel value (e.g. "0px", "8px")
- Default: "0px"

---

## Layout Resolution Rules

For every `row` or `column` container, sizing is resolved in this order:

1. Determine the container inner size.
2. Subtract the total gap space between all direct children.
3. Apply fixed pixel sizes (`px`) first.
4. Apply percentage sizes (`%`) relative to the container inner size.
5. Divide the remaining space across `fr` children proportionally.
6. Continue recursively for child `row` and `column` nodes.

Interpretation by container type:
- In a `row`, sizes resolve horizontal space.
- In a `column`, sizes resolve vertical space.

Direct child rules:
- `px` sizes are fixed.
- `%` sizes are calculated from the container inner size.
- `fr` sizes divide whatever space remains after gaps, `px`, and `%` have been applied.
- If `size` is omitted, the renderer may treat the child as flexible remaining space.

Example order:
- Container size
- minus gaps
- minus fixed `px`
- minus `%`
- remaining space divided by `fr`

### Overflow Behavior

- The renderer does not auto-normalize sizes.
- If sizes exceed the available space, the renderer keeps the defined values.
- The validator is responsible for reporting warnings or errors for problematic size combinations.

### Preview Rules

- The admin preview uses the same sizing logic as the device renderer.
- The preview scales the resolved layout into a fixed preview area.
- The preview should remain visually representative of the real structure.
- The preview does not need to be physically exact at pixel level.

---

## Zoom Behavior

- Zoom scales iframe content only
- Box size remains unchanged
- Content is scaled using transform with compensation:
  - wrapper size = 1 / zoom
  - transform: scale(zoom)
  - origin: top-left

---

## Testing

Each layout must be tested for:
- valid structure
- valid box references
- valid gap usage
- correct rendering behavior

---

## Admin UI

Each layout should have:
- preview graphic (approx. 240x135 px)
- layoutId display
- validation status (valid / warning / error)

---

## Layout Save Rules

When a layout is edited and saved:

1. the updated JSON must validate successfully
2. `layoutId` remains stable for the same logical layout
3. `layoutVersion` must increase

Purpose:
- active clients can detect layout changes even when the assigned `layoutId` does not change

---

## Layout Version Migration

When `layoutVersion` is introduced into an existing installation:

1. every existing `data/layouts/{layoutId}.json` file must receive a `layoutVersion`
2. the initial migration value should be:
   - `layoutVersion: 1`
3. after migration, every real layout change increments the version:
   - `1 -> 2 -> 3`

Rules after migration:
- missing `layoutVersion` is a model mismatch
- invalid `layoutVersion` is a validation error
- runtime must not silently guess `layoutVersion = 1`

Purpose:
- keep the model explicit
- make outdated layout files visible
- avoid hidden compatibility behavior
