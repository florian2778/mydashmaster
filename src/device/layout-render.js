const { readLayout } = require("../storage/json-store");

function getNodeStyle(size, parentType) {
  if (!parentType) {
    return [];
  }

  if (!size) {
    return ["flex: 1 1 0;"];
  }

  if (size.endsWith("fr")) {
    const value = Number.parseFloat(size);
    return [`flex: ${value} ${value} 0;`];
  }

  return [`flex: 0 0 ${size};`];
}

function buildRenderNode(node, boxMap, parentType = null) {
  const styleParts = getNodeStyle(node.size, parentType);

  if ((node.type === "row" || node.type === "column") && node.gap) {
    styleParts.push(`gap: ${node.gap};`);
  }

  const renderNode = {
    type: node.type,
    style: styleParts.join(" ")
  };

  if (node.type === "box") {
    const box = boxMap.get(node.box);

    return {
      ...renderNode,
      name: box.name,
      url: box.url,
      zoom: box.zoom
    };
  }

  return {
    ...renderNode,
    children: node.children.map((child) =>
      buildRenderNode(child, boxMap, node.type)
    )
  };
}

async function buildDeviceLayoutViewModel(device) {
  const assignedLayoutId = device.layoutId || null;
  const defaultOptions = {
    showHeader: false,
    showLayoutTitle: false,
    showStatus: false
  };

  if (!assignedLayoutId) {
    return {
      hasBoxes: false,
      layoutExists: false,
      layoutId: null,
      layoutLabel: null,
      options: defaultOptions,
      renderTree: null
    };
  }

  const layout = await readLayout(assignedLayoutId);

  if (!layout) {
    return {
      hasBoxes: false,
      layoutExists: false,
      layoutId: assignedLayoutId,
      layoutLabel: assignedLayoutId,
      options: defaultOptions,
      renderTree: null
    };
  }

  return {
    hasBoxes: layout.boxes.length > 0,
    layoutExists: true,
    layoutId: assignedLayoutId,
    layoutLabel: layout.description || assignedLayoutId,
    options: {
      ...defaultOptions,
      ...(layout.options || {})
    },
    renderTree: buildRenderNode(
      layout.structure,
      new Map(layout.boxes.map((box) => [box.name, box]))
    )
  };
}

module.exports = {
  buildDeviceLayoutViewModel
};
