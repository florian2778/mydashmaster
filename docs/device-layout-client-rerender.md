# Device Layout Client Re-Render Specification

## Purpose

Define the desired behavior for updating the public device page when the assigned layout changes, without performing a full page reload.

This document describes the target behavior only.
It does not require immediate implementation changes.

---

## Goal

Replace the current full-page reload behavior on layout changes with a client-side layout re-render.

The device page should:

- keep the outer page shell stable
- detect layout changes through the existing device polling mechanism
- fetch the new layout representation
- replace only the layout area
- avoid a full browser page reload where possible
- remain consistent with the existing access-state lifecycle

---

## Scope

In scope:

- layout changes while device remains on the active authorized page
- client-side replacement of the layout container
- continued use of polling
- server-rendered layout source data

Out of scope:

- auth model changes
- websocket-based live updates
- incremental iframe diffing
- preserving iframe state across layout changes
- redesign of waiting pages

---

## Current Behavior

Current runtime behavior:

- device polls `/api/device/:deviceCode/status`
- if returned `layoutId` differs from the currently rendered layout
- client executes `window.location.reload()`

Impact:

- the full page reloads
- all iframes reload
- the change is visible to the user

---

## Target Behavior

When the device is already on the active layout page and polling detects a changed layout identity:

1. The page must remain loaded
2. The client must request the updated layout render payload from the server
3. The current layout container must be replaced in place
4. Existing layout DOM inside that container may be removed completely
5. The new layout DOM is inserted
6. The device continues polling afterward

Important:

- this is a layout-area refresh, not a full-page hot patch
- all replaced iframes may reload
- unchanged page chrome must remain stable
- no access-state transition may be completed through fragment replacement alone

Core rule:

- no access-state transition may be completed through fragment replacement alone
- fragment replacement may update layout content only
- lifecycle transitions must remain under normal server-rendered access-state handling

---

## UX Expectations

### What the user should notice

- the dashboard content updates
- the browser page itself does not visibly reload
- no full white flash or navigation reload

### What the user may still notice

- iframe content may reload
- remote pages inside iframes may show their own loading behavior

### UX benefit vs full reload

- smoother transition
- less visual disruption
- more stable device-shell behavior

---

## Trigger Rules

Client-side layout re-render is allowed only when all of the following are true:

- current page is in visible state `active`
- status endpoint still returns `authorized = true`
- returned `clientState = active`
- the current layout identity changed:
  - returned `layoutId` differs from the currently rendered `layoutId`
  - or returned `layoutVersion` differs from the currently rendered `layoutVersion`

If any of these are not true, the device must fall back to the existing lifecycle behavior:

- `pending` -> waiting page
- `blocked` -> waiting page
- `revoked` -> revoked page
- `unknown` -> unknown page

In those cases, a full page reload or redirect remains acceptable and preferred.

This aligns with the existing lifecycle model:

- waiting-state transitions remain server-rendered
- only `active -> active` layout changes may stay on the current page

---

## Data Flow

### Existing polling

Polling remains based on:

- `GET /api/device/:deviceCode/status`

The status payload continues to provide:

- `deviceCode`
- `status`
- `layoutId`
- `layoutVersion`
- `authorized`
- `clientState`

### Migration Safety

The client re-render logic may only rely on `layoutVersion` after layout files have been migrated.

Required rollout expectation:
- existing layout files receive `layoutVersion: 1`
- after that, the device status and fragment flow may treat `layoutId + layoutVersion` as the layout identity

Mismatch handling:
- missing `layoutVersion` must not be silently guessed by runtime logic
- invalid `layoutVersion` must be treated as an invalid layout state
- if the server cannot provide a valid layout identity, it should fail closed rather than inventing one

### Additional render source

For client-side layout re-render, the client needs a server-provided representation of the current device layout.

Recommended options:

1. HTML fragment endpoint
- server returns rendered HTML for the layout container only

2. structured render payload endpoint
- server returns layout render data as JSON
- client rebuilds DOM in JavaScript

Preferred MVP direction:

- HTML fragment endpoint

Reason:

- consistent with the current server-rendered architecture
- less client-side rendering logic
- lower risk than building a browser-side layout renderer

---

## Fragment Update Safety Rules

### Race condition protection

The client must only apply a fetched layout fragment if it still matches the latest known layout change state.

Example:

- polling detects change from layout A to layout B
- client starts fetching fragment for layout B
- before that fetch completes, polling detects a newer change to layout C
- fragment for layout B must no longer be applied

Recommended MVP rule:

- keep the latest polled render identity in client memory:
  - `layoutId`
  - `layoutVersion`
- require the fragment response to be attributable to the layout identity it represents
- before applying a fetched fragment, compare it against the latest known expected identity
- if the fetched fragment is stale, discard it

The fragment response must be associated with the requested layout identity.

This association may be provided through a lightweight mechanism such as:

- a wrapper attribute
- a response header
- equivalent minimal metadata

The transport is not fixed by this specification.
The requirement is that the client can verify that the received fragment still belongs to the latest expected:
- `layoutId`
- `layoutVersion`

before applying it.

### Prevent concurrent fragment updates

The client must not run multiple overlapping layout-fragment updates at the same time.

Recommended MVP rule:

- only one layout update fetch may be in flight
- a simple `isUpdatingLayout` guard is acceptable
- newer poll results may supersede older pending updates

### Exact replacement semantics

This is not DOM diffing.

Requirements:

- the client replaces the full contents of one dedicated layout-root element
- no incremental DOM patching is required
- no client-side layout engine is required
- old layout DOM inside that root may be discarded completely before the new fragment is inserted

---

## Recommended Endpoint Shape

Recommended new endpoint:

- `GET /api/device/:deviceCode/layout-fragment`

Behavior:

- requires the same device authorization rules as the main device page
- must verify matching `deviceCode`
- must verify a valid current device session
- must verify `clientState = active`
- returns only the rendered layout container markup
- must not expose secret material
- must return non-success if device is no longer authorized

Response use:

- client fetches fragment
- replaces current layout DOM subtree

Unauthorized or mismatched requests must not receive layout fragment content.

The fragment response must allow the client to verify which `layoutId` it represents before applying it.

---

## Rendering Boundaries

The following parts should remain untouched during a client-side layout update:

- `<html>`
- `<body>`
- page-level scripts
- polling loop itself
- outer device page container

The following part should be replaced:

- layout canvas content only

Recommended replacement boundary:

- one dedicated container element for rendered layout content

This keeps implementation clear and reduces DOM coordination risk.

If layout content requires any client-side initialization after DOM replacement, that initialization must be triggered again explicitly.

MVP note:

- do not assume that scripts embedded in replaced HTML will automatically provide the required behavior
- any needed post-replacement setup should be called intentionally by the page script

---

## Error Handling

If client-side layout refresh fails:

- do not leave the page in a half-rendered state
- keep the current layout visible if possible
- retry on the next poll cycle

If the fragment endpoint reports that the device is no longer authorized:

- perform full reload
- let the server render the correct lifecycle state page

If the fragment endpoint fails repeatedly:

- fallback to full page reload after a small number of failed attempts

Recommended MVP fallback:

- one failed fragment fetch: keep current layout
- next poll retries
- after 2-3 consecutive failures: full reload

If the fragment or status flow encounters an invalid layout identity because of missing or malformed `layoutVersion`:
- do not apply fragment replacement
- keep the current layout visible if possible
- let admin-facing validation surface the migration problem clearly

Optional UX feedback during replacement:

- a subtle loading indicator, fade, or lightweight overlay is allowed
- this must remain visually small and operational
- no major redesign is required
- if used, it should affect only the layout area, not the whole page

---

## Security Requirements

Client-side layout re-render must not weaken the current security model.

Requirements:

- no `deviceSecret` exposed in the layout refresh flow
- no `secretHash` or `candidateSecretHash` exposed
- fragment endpoint must use current session/cookie validation
- unauthorized requests must not receive layout content
- the status endpoint remains the control plane, not a source of secret material

---

## Lifecycle Interaction

### Allowed partial update

Only this case should use client-side re-render:

- `active` -> `active` with changed layout identity:
  - different `layoutId`
  - or same `layoutId` with different `layoutVersion`

This is the normal case for layout assignment changes while the device remains valid and authorized.

Recommended behavior:

- keep the current page loaded
- fetch the new layout fragment
- replace only the layout-root contents

### Cases that should still use full reload

- `active` -> `pending`
- `active` -> `blocked`
- `active` -> `revoked`
- `active` -> `unknown`

Reason:

- these cases change the device access state, not only the layout content
- server-side lifecycle rendering remains the safer and clearer source of truth

These cases should continue to use full page reload so the server can render:

- waiting page
- revoked page
- unknown device page

---

## Polling Interaction

The distinction between update types must remain explicit.

### Normal case

- device is currently `active`
- status polling returns `clientState = active`
- `layoutId` changes
- client performs layout fragment replacement only

### Fallback case

- admin explicitly requests a device reload
- device sees this through the existing status polling response
- client performs a full page reload

### Lifecycle case

- visible client state changes away from `active`
- client performs a full page reload
- server renders the correct lifecycle state page

The polling mechanism remains shared.
The device should not introduce a second update transport for this feature.

---

## Admin-Triggered Reload

### Purpose

An admin-triggered reload is an operational fallback for recovery and diagnostics.

It is useful when:

- a device appears stuck
- layout replacement may have failed
- a manual refresh is needed without waiting for normal recovery behavior

This is not the normal layout update path.
Normal authorized layout changes should still prefer fragment replacement.

### Recommended model

Use a minimal reload signal exposed through the existing status endpoint.

Possible shapes:

- `reloadRequested: true`
- `reloadNonce`
- `reloadVersion`

Preferred MVP direction:

- a minimal explicit reload signal such as `reloadNonce` or `reloadVersion`

Why:

- easier to consume safely than a boolean that may linger ambiguously
- easy for the device to compare against its last seen value

### Device behavior

When status polling shows a new reload signal value:

1. device performs a full page reload
2. server re-renders the full current page state
3. signal is then cleared or considered consumed by version comparison

### Security constraints

- admin-triggered reload must not bypass authorization
- it must not expose secret material
- it must use the existing polling/status channel
- it must not require websockets or a push transport
- it is an operational signal only, not an independent trust mechanism
- a device must only act on reload instructions as part of a valid status response flow
- it must remain subordinate to normal authorization and lifecycle rules

### Operational role

Admin-triggered reload is:

- a recovery/debugging tool
- a fallback when the normal fragment path is insufficient

It is not:

- a replacement for polling
- a replacement for lifecycle transitions
- a replacement for normal authorized layout replacement
- a way to wake or trust arbitrary browsers only by `deviceCode`

---

## Iframe Behavior

This specification does not require preserving existing iframe sessions or DOM nodes.

For MVP:

- when layout content is replaced, affected iframe elements may be recreated
- recreated iframes will reload naturally

This is acceptable because the goal is to avoid full browser page reload, not to preserve every iframe instance.

---

## Implementation Guidance

Preferred implementation path:

1. Add a fragment endpoint for authorized device layout content
2. Mark one layout-root element on the device page
3. Extend the existing polling script on the authorized page
4. On layout identity change:
   - fetch fragment
   - replace layout-root contents
   - update current:
     - `layoutId`
     - `layoutVersion`
     in client memory
5. Guard against stale/in-flight updates before applying the fragment
6. Keep full reload fallback for failures, admin-triggered reloads, or access-state changes

Important:

- do not build a full client-side layout engine
- reuse server-rendered markup as much as possible

---

## MVP Acceptance Criteria

The client-side layout re-render is considered successful when:

- changing a device layout in admin no longer triggers a full browser page reload
- the visible layout area updates automatically on the device
- access-state changes still transition via normal lifecycle rendering
- unauthorized users cannot fetch layout fragments
- implementation remains compatible with the current polling architecture
- stale fragment responses are ignored safely
- overlapping fragment updates are prevented

---

## Future Note

`layoutVersion` is now part of the model.

Future optional extension:
- more detailed revision metadata beyond a single integer `layoutVersion`

---

## Summary

Desired model:

- keep polling
- keep server-rendered layout generation
- replace only layout content on `authorized -> authorized` layout identity changes
- keep full reload for lifecycle/access-state transitions
- allow an admin-triggered reload fallback through the existing status channel

This gives a smoother device experience without redesigning the current authentication and lifecycle architecture.
