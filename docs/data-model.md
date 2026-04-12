
# Data Model

This document defines the JSON structure used by MyDashmaster.

## Overview

A layout consists of:
- layoutId
- options (optional)
- structure
- boxes

A device consists of:
- deviceCode
- status
- layoutId

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
  "status": "approved",
  "layoutId": "layout-1"
}

---

## Layout

Path: data/layouts/{layoutId}.json

Fields:
- layoutId (string)
- options (object, optional)
- structure (object)
- boxes (array)

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
4. Apply percentage sizes (`%`) relative to the remaining container inner size before `fr` distribution.
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
