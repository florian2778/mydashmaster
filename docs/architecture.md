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

---

## 2. Public Device Renderer

Route:
/d/{deviceCode}

Responsibilities:
- identify device
- check authorization
- render layout or pending page
- run polling for updates

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

If layout changed → reload page

---

## Design Principles

- keep it simple
- avoid overengineering
- use server-side rendering
- prefer readability over abstraction
