const PREVIEW_WIDTH = 320;
const PREVIEW_HEIGHT = 180;

function parseSize(size) {
  if (!size) {
    return { type: "auto", value: 1 };
  }

  if (size.endsWith("%")) {
    return { type: "percent", value: Number.parseFloat(size) };
  }

  if (size.endsWith("px")) {
    return { type: "px", value: Number.parseFloat(size) };
  }

  if (size.endsWith("fr")) {
    return { type: "fr", value: Number.parseFloat(size) };
  }

  return { type: "auto", value: 1 };
}

function parseGap(gap) {
  if (!gap || !gap.endsWith("px")) {
    return 0;
  }

  return Number.parseFloat(gap) || 0;
}

function rectToStyle(rect, parentWidth, parentHeight) {
  const left = parentWidth > 0 ? (rect.x / parentWidth) * 100 : 0;
  const top = parentHeight > 0 ? (rect.y / parentHeight) * 100 : 0;
  const width = parentWidth > 0 ? (rect.width / parentWidth) * 100 : 0;
  const height = parentHeight > 0 ? (rect.height / parentHeight) * 100 : 0;

  return [
    `left: ${left}%;`,
    `top: ${top}%;`,
    `width: ${width}%;`,
    `height: ${height}%;`
  ].join(" ");
}

function resolveMainSizes(children, innerMainSize) {
  const parsedChildren = children.map((child) => ({
    child,
    parsedSize: parseSize(child.size)
  }));

  const pixelTotal = parsedChildren.reduce(
    (total, entry) =>
      entry.parsedSize.type === "px" ? total + entry.parsedSize.value : total,
    0
  );

  const percentSizes = parsedChildren.map((entry) =>
    entry.parsedSize.type === "percent"
      ? (innerMainSize * entry.parsedSize.value) / 100
      : 0
  );

  const percentTotal = percentSizes.reduce((total, value) => total + value, 0);
  const rawRemaining = innerMainSize - pixelTotal - percentTotal;
  const remaining = Math.max(0, rawRemaining);

  const flexibleTotal = parsedChildren.reduce((total, entry) => {
    if (entry.parsedSize.type === "fr" || entry.parsedSize.type === "auto") {
      return total + entry.parsedSize.value;
    }

    return total;
  }, 0);

  return {
    overflow: rawRemaining < 0,
    sizes: parsedChildren.map((entry, index) => {
      if (entry.parsedSize.type === "px") {
        return entry.parsedSize.value;
      }

      if (entry.parsedSize.type === "percent") {
        return percentSizes[index];
      }

      if (flexibleTotal === 0) {
        return 0;
      }

      return (remaining * entry.parsedSize.value) / flexibleTotal;
    })
  };
}

function resolveNode(node, boxNames, width, height, options = {}) {
  const {
    isRoot = false,
    rect = { x: 0, y: 0, width, height },
    parentWidth = width,
    parentHeight = height
  } = options;

  const baseNode = {
    type: node.type,
    isRoot,
    rect,
    style: isRoot ? "" : rectToStyle(rect, parentWidth, parentHeight)
  };

  if (node.type === "box") {
    return {
      ...baseNode,
      box: node.box,
      isInvalidBoxReference: !boxNames.has(node.box)
    };
  }

  const children = node.children || [];
  const gap = parseGap(node.gap);
  const totalGap = Math.max(0, children.length - 1) * gap;
  const isRow = node.type === "row";
  const mainAxisSize = isRow ? width : height;
  const crossAxisSize = isRow ? height : width;
  const innerMainSize = Math.max(0, mainAxisSize - totalGap);
  const resolved = resolveMainSizes(children, innerMainSize);

  let cursor = 0;

  return {
    ...baseNode,
    overflow: resolved.overflow,
    children: children.map((child, index) => {
      const mainSize = resolved.sizes[index];
      const childRect = isRow
        ? { x: cursor, y: 0, width: mainSize, height: crossAxisSize }
        : { x: 0, y: cursor, width: crossAxisSize, height: mainSize };

      cursor += mainSize + gap;

      return resolveNode(
        child,
        boxNames,
        childRect.width,
        childRect.height,
        {
          rect: childRect,
          parentWidth: width,
          parentHeight: height
        }
      );
    })
  };
}

function resolvePreviewLayout(node, boxNames, width = PREVIEW_WIDTH, height = PREVIEW_HEIGHT) {
  if (!node) {
    return null;
  }

  return resolveNode(node, boxNames, width, height, { isRoot: true });
}

function summarizePreviewTree(node) {
  if (!node) {
    return {
      hasOverflow: false,
      invalidBoxCount: 0
    };
  }

  if (node.type === "box") {
    return {
      hasOverflow: false,
      invalidBoxCount: node.isInvalidBoxReference ? 1 : 0
    };
  }

  return (node.children || []).reduce(
    (summary, child) => {
      const childSummary = summarizePreviewTree(child);

      return {
        hasOverflow:
          summary.hasOverflow || Boolean(node.overflow) || childSummary.hasOverflow,
        invalidBoxCount: summary.invalidBoxCount + childSummary.invalidBoxCount
      };
    },
    {
      hasOverflow: Boolean(node.overflow),
      invalidBoxCount: 0
    }
  );
}

module.exports = {
  PREVIEW_HEIGHT,
  PREVIEW_WIDTH,
  resolvePreviewLayout,
  summarizePreviewTree
};
