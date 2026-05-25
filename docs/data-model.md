# Data Model

This document defines the JSON structure used by MyDashmaster.

## Overview

A layout consists of:
- layoutId
- description
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
  - updated only by the active client
- clients (array, optional)
  - diagnostic client activity for one `deviceCode`
  - may contain the active client and additional pending or blocked client activity
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
  - used as an activation precondition
  - does not make the client official by itself
- isPairedClient (boolean)
  - exactly one client may have `isPairedClient = true` per `deviceCode`
  - when a new client becomes the active client, the previous one must lose `isPairedClient = true` immediately
- userAgent (string, optional)
- lastKnownIp (string, optional)

Rules:
- The plain deviceSecret is never stored on the server.
- Only a one-way hash is persisted.
- `candidateSecretHash` is only used for the legacy device-level pending approval flow, if that flow is still present.
- `secretHash` is the active authentication hash for the current activation cycle.
- `lastStatusAt` = official device heartbeat.
- `clients[].lastSeenAt` = diagnostic only.
- `clients[].lastAuthenticatedAt` = authenticated browser session evidence only.
- `clients[]` stores client activity, not device-level truth.
- visible access state is derived, not persisted:
  - `pending_activation`
  - `active_authorized`
  - `reauth_required`
  - `auth_mismatch`
  - `blocked_by_other_client`
  - `revoked`

Session and activation rules:
- `clientId` identifies the browser profile for client activity tracking only.
- a valid device session cookie represents the current browser session only.
- `isPairedClient = true` represents the explicitly activated client only.
- `pending_activation` means true admin/activation wait, not session expiry.
- `reauth_required` means the browser is still the correct active/known client context, but the short-lived session cookie is missing or expired.
- `auth_mismatch` means the browser no longer matches the current server-side `secretHash`.
- `blocked_by_other_client` means another browser is already the active client.
- only a client in `active_authorized` may render the layout and update the official heartbeat.
- additional client activity in `pending_activation`, `reauth_required`, `auth_mismatch`, `blocked_by_other_client`, or `revoked` must not redefine `Seen` or `Online`.

Client activity update rule:
- update `clients[].lastSeenAt` only for:
  - known `deviceCode`
  - syntactically valid request
  - real device status endpoint request
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
  - server may store candidateSecretHash in legacy approval flows

- On authentication:
  - hash(deviceSecret) must match the current `secretHash`
  - successful `/auth` refreshes browser-session evidence and the short-lived session cookie

- On active rendering:
  - the browser must be the explicitly activated client
  - and it must have a valid current session cookie
  - only then the derived state is `active_authorized`

- On session expiry:
  - the browser may fall to `reauth_required`
  - automatic `/auth` should restore the session without a new admin activation

- On revocation:
  - `secretHash` is removed or invalidated
  - the visible access state becomes `revoked`
  - device loses access immediately

---

## Layout

Path: data/layouts/{layoutId}.json

Fields:
- layoutId (string)
- description (string, optional)
- layoutVersion (integer)
- options (object, optional)
- structure (object)
- boxes (array)

`layoutId` meaning:
- immutable technical identifier of the layout
- used for:
  - file path `data/layouts/{layoutId}.json`
  - admin detail route `/admin/layouts/{layoutId}`
  - device assignment references
  - runtime layout identity together with `layoutVersion`
- shown in the admin UI for reference and linking
- not manually edited after creation

`description` meaning:
- human-readable layout label for admin use
- optional
- editable in layout detail edit mode
- preferred display name in the admin UI when present
- does not affect routing, device assignments, or runtime identity

`layoutVersion` meaning:
- monotonically increasing version number for the layout definition
- used so active devices can detect layout changes even when `layoutId` stays the same
- must increase whenever a layout is changed and saved

Example:

{
  "layoutId": "a1b2c3",
  "description": "North lobby split",
  "layoutVersion": 3,
  "options": {
    "showHeader": false,
    "showStatus": false,
    "showLayoutTitle": false
  },
  "structure": {},
  "boxes": []
}

Creation and duplication rules:
- new layouts receive a generated `layoutId`
  - exactly 6 characters
  - characters allowed: `a-z` and `0-9`
  - no prefix
  - generated randomly
  - uniqueness is checked before the id is accepted
  - existing older layout ids may keep their previous format
- duplication creates:
  - a fresh generated `layoutId`
  - a full copy of the layout content
  - `description = "copy of <old description>"` if the source had a description
  - otherwise `description = "copy of <old layoutId>"`

Edit rules:
- `layoutId` remains fixed for the same logical layout
- `description` may be changed independently
- editing JSON must not change the stored `layoutId`

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
