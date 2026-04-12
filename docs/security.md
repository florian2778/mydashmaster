# Security Model (MVP – Device Secret Based)

## Device Access

Access requires:
1. valid device code (routing only)
2. approved device
3. valid device secret (via cookie)

---

## First Access

- device is unknown or has no valid authentication
- device is marked as pending
- no layout is shown

Display:

Device  
{deviceCode}  
Access pending

---

## Device Secret (Client)

- generated once on first access (cryptographically strong random value)
- stored locally on the device (e.g. localStorage)
- never exposed in URL
- sent to server for authentication

---

## Approval

Admin must manually approve device.

On approval:
- device secret is registered
- only the hash of the secret is stored on the server

---

## Token / Cookie

- server issues authentication cookie after successful validation
- cookie represents validated device session
- device secret is never stored in plain text on server
- server stores only hash(deviceSecret)

---

## Authentication Flow

1. Device calls /d/{deviceCode}
2. If no valid cookie:
   - client sends deviceSecret
3. Server:
   - compares hash(deviceSecret)
   - checks device status
4. Access granted only if:
   - device is approved
   - secret matches

---

## Revocation

- device access can be revoked by admin
- stored secret hash is removed or invalidated
- device returns to pending state
- re-approval required

---

## No Trust in URL

Device code alone is NOT sufficient for access.

---

## Minimal Exposure

Pending page shows only:
- device code
- access pending

No additional information.
