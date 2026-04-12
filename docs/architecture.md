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
- is assigned exactly one layout

---

## Device Authorization

- token-based authentication
- token stored in cookie
- token stored hashed on server
- no access without valid token

---

## Rendering Flow

1. Device calls `/d/{deviceCode}`
2. Server loads device
3. Server validates token
4. If not valid → pending page
5. If valid → render layout

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
