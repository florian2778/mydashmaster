# Data Model

This document defines the JSON structure used by MyDashmaster.

## Overview

A layout consists of: - layoutId - structure - boxes

A device consists of: - deviceCode - status - layoutId

The layout structure is a recursive tree of nodes: - row - column - box

------------------------------------------------------------------------

## Device

Path: data/devices/{deviceCode}.json

Example:

{ "deviceCode": "demo-device", "status": "approved", "layoutId":
"layout-1" }

------------------------------------------------------------------------

## Layout

Path: data/layouts/{layoutId}.json

Fields: - layoutId (string) - structure (object) - boxes (array)

------------------------------------------------------------------------

## Structure

Nodes: - row → horizontal layout - column → vertical layout - box → leaf
node (iframe)

Each node can have: - size (optional): "60%", "300px", "1fr"

------------------------------------------------------------------------

## Rules

-   structure is recursive
-   row/column must have children\[\]
-   box must reference boxes\[\].name
-   box must not have children

------------------------------------------------------------------------

## Box

{ "name": "box1", "url": "https://example.com", "zoom": 1.0 }

------------------------------------------------------------------------


## Size

The `size` property defines how much space a node takes within its parent container.

The interpretation depends on the parent node:
- In a `row`, sizes control horizontal width
- In a `column`, sizes control vertical height

If `size` is omitted, the renderer distributes remaining space automatically.

Allowed formats:
- percentage, e.g. "60%"
- pixels, e.g. "300px"
- fractional units, e.g. "1fr"

---

### Behavior within the same level

All `size` values are evaluated relative to their sibling nodes.

- Percentage values (`%`) should typically sum up to 100% within the same container
- `fr` values divide the remaining space proportionally
- `px` values are fixed and reduce the available space for other elements

Example:

- "200px", "1fr", "1fr"
  → first element fixed, remaining space split equally

- "30%", "30%", "30%"
  → only 90% used → 10% remaining space

- "50%", "60%"
  → overflow → may cause layout issues

------------------------------------------------------------------------

## Testing

Each layout must be tested against: - valid structure - valid box
references - rendering without errors

------------------------------------------------------------------------

## Admin UI

Each layout should have: - small preview graphic (generated) - layoutId
display - validation status
