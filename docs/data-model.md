# Data Model

This document defines the structure of JSON files used for storage.

---

## Device

Path:
data/devices/{deviceCode}.json

Example:

{
  "deviceCode": "demo-device",
  "status": "approved",
  "layoutId": "layout-1"
}

Fields:

- deviceCode (string)
  Unique identifier of the device

- status (string)
  One of:
  - "pending"
  - "approved"

- layoutId (string | null)
  Assigned layout
  May be null or missing if not assigned

---

## Layout

Path:
data/layouts/{layoutId}.json

Example:

{
  "layoutId": "layout-1",
  "boxes": [
	{
	  "name": "box1",
	  "url": "https://example.com",
	  "zoom": 1.0
	}
  ]
}

Fields:

- layoutId (string)
  Unique identifier of the layout

- boxes (array)
  List of boxes to render

---

## Box

Example:

{
  "name": "box1",
  "url": "https://example.com",
  "zoom": 1.0
}

Fields:

- name (string)
  Identifier inside the layout

- url (string)
  URL to embed via iframe

- zoom (number)
  Zoom factor (e.g. 1.0 = 100%)