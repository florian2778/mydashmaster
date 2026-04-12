const express = require("express");

const {
  PREVIEW_HEIGHT,
  PREVIEW_WIDTH,
  resolvePreviewLayout,
  summarizePreviewTree
} = require("../admin/layout-preview");
const {
  activateCandidateSecret,
  createAdminDevice,
  deleteDevice,
  listDevices,
  listLayouts,
  revokeDeviceAuth,
  updateDevice
} = require("../storage/json-store");

const router = express.Router();

router.get("/", async (req, res, next) => {
  try {
    const devices = await listDevices();
    const layouts = await listLayouts();

    res.render("pages/admin", {
      pageTitle: "Admin",
      deviceCount: devices.length,
      heading: "Admin",
      layoutCount: layouts.length
    });
  } catch (error) {
    next(error);
  }
});

router.get("/layouts", async (req, res, next) => {
  try {
    const layouts = (await listLayouts()).map((layout) => ({
      ...layout,
      previewTree: resolvePreviewLayout(
        layout.structure,
        new Set((layout.boxes || []).map((box) => box.name)),
        PREVIEW_WIDTH,
        PREVIEW_HEIGHT
      )
    })).map((layout) => ({
      ...layout,
      previewSummary: summarizePreviewTree(layout.previewTree)
    }));

    res.render("pages/admin-layouts", {
      pageTitle: "Layouts",
      heading: "Layouts",
      layouts
    });
  } catch (error) {
    next(error);
  }
});

router.get("/devices", async (req, res, next) => {
  try {
    const [devices, layouts] = await Promise.all([listDevices(), listLayouts()]);
    const assignableLayouts = layouts.filter((layout) => layout.status !== "error");

    res.render("pages/admin-devices", {
      devices,
      heading: "Devices",
      layouts: assignableLayouts,
      pageTitle: "Devices"
    });
  } catch (error) {
    next(error);
  }
});

router.post("/devices", async (req, res, next) => {
  try {
    const layoutId =
      typeof req.body?.layoutId === "string" && req.body.layoutId.trim() !== ""
        ? req.body.layoutId.trim()
        : undefined;

    if (layoutId) {
      const layouts = await listLayouts();
      const assignableLayouts = layouts.filter((layout) => layout.status !== "error");
      const hasLayout = assignableLayouts.some(
        (layout) => layout.layoutId === layoutId
      );

      if (!hasLayout) {
        return res.status(400).render("pages/admin-devices", {
          devices: await listDevices(),
          heading: "Devices",
          layouts: assignableLayouts,
          pageTitle: "Devices"
        });
      }
    }

    await createAdminDevice({ layoutId });

    res.redirect("/admin/devices");
  } catch (error) {
    next(error);
  }
});

router.post("/devices/:deviceCode/approve", async (req, res, next) => {
  try {
    const { deviceCode } = req.params;
    const deviceAuth = await activateCandidateSecret(deviceCode);

    if (deviceAuth?.secretHash) {
      await updateDevice(deviceCode, { status: "approved" });
    }

    res.redirect("/admin/devices");
  } catch (error) {
    next(error);
  }
});

router.post("/devices/:deviceCode/revoke", async (req, res, next) => {
  try {
    const { deviceCode } = req.params;

    await revokeDeviceAuth(deviceCode);
    await updateDevice(deviceCode, { status: "revoked" });

    res.redirect("/admin/devices");
  } catch (error) {
    next(error);
  }
});

router.post("/devices/:deviceCode/delete", async (req, res, next) => {
  try {
    const { deviceCode } = req.params;

    await deleteDevice(deviceCode);

    res.redirect("/admin/devices");
  } catch (error) {
    next(error);
  }
});

module.exports = router;
