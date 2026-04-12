# Security Model

## Device Access

Access requires:
1. valid device code
2. approved device
3. valid token

---

## First Access

- device is unknown
- marked as pending
- no layout is shown

Display:

Device  
{deviceCode}  
Access pending

---

## Approval

Admin must manually approve device.

---

## Token

- generated on approval
- stored as cookie
- stored hashed on server

---

## Revocation

- token becomes invalid
- device returns to pending state

---

## No Trust in URL

Device code alone is NOT sufficient for access.

---

## Minimal Exposure

Pending page shows only:
- device code
- access pending

No additional information.
