const express = require("express");

const {
  clearDeviceSessionCookie,
  getRequestIp,
  hasValidDeviceSession
} = require("../auth/device-auth");
const {
  recordDeviceActivity,
  readDevice,
  readDeviceAuth,
  readLayout
} = require("../storage/json-store");

const router = express.Router();

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

router.get("/:deviceCode", async (req, res, next) => {
  try {
    const { deviceCode } = req.params;
    const device = await readDevice(deviceCode);

    if (!device) {
      clearDeviceSessionCookie(res, deviceCode);
      return res.status(404).render("pages/device-unknown", {
        pageTitle: "Unknown device",
        deviceCode
      });
    }

    if (device.status === "pending" || device.status === "revoked") {
      clearDeviceSessionCookie(res, deviceCode);
      return res.render("pages/device-pending", {
        pageTitle: "Access pending",
        deviceCode
      });
    }

    const deviceAuth = await readDeviceAuth(deviceCode);

    if (!deviceAuth?.secretHash) {
      clearDeviceSessionCookie(res, deviceCode);
      return res.render("pages/device-pending", {
        pageTitle: "Access pending",
        deviceCode
      });
    }

    if (!hasValidDeviceSession(req, deviceCode, deviceAuth.secretHash)) {
      clearDeviceSessionCookie(res, deviceCode);
      return res.render("pages/device-pending", {
        pageTitle: "Access pending",
        deviceCode
      });
    }

    await recordDeviceActivity(deviceCode, getRequestIp(req));

    if (!device.layoutId) {
      return res.render("pages/device", {
        deviceCode,
        pageTitle: `Device ${deviceCode}`,
        hasBoxes: false,
        layoutId: null,
        options: {
          showHeader: false,
          showStatus: false,
          showLayoutTitle: false
        },
        renderTree: null
      });
    }

    const layout = await readLayout(device.layoutId);
    const hasBoxes = layout && layout.boxes.length > 0;
    const renderTree = layout
      ? buildRenderNode(
          layout.structure,
          new Map(layout.boxes.map((box) => [box.name, box]))
        )
      : null;
    const options = {
      showHeader: false,
      showStatus: false,
      showLayoutTitle: false,
      ...(layout?.options || {})
    };

    res.render("pages/device", {
      deviceCode,
      pageTitle: `Device ${deviceCode}`,
      layoutId: layout ? device.layoutId : null,
      hasBoxes,
      options,
      renderTree
    });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
