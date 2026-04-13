const express = require("express");

const {
  clearAdminSessionCookie,
  hasAdminAuthConfig,
  setAdminSessionCookie,
  verifyAdminLogin
} = require("../auth/admin-auth");
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
  readDevice,
  requestDeviceReload,
  resetDevicePairing,
  revokeDeviceAuth,
  updateDevice
} = require("../storage/json-store");

const router = express.Router();

function formatDateOnly(value) {
  if (!value) {
    return "-";
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "-";
  }

  const day = String(date.getUTCDate()).padStart(2, "0");
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const year = String(date.getUTCFullYear());

  return `${day}.${month}.${year}`;
}

function formatSeenSeconds(value) {
  if (!value) {
    return "-";
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "-";
  }

  const diffSeconds = Math.max(
    0,
    Math.floor((Date.now() - date.getTime()) / 1000)
  );

  return `${diffSeconds}s`;
}

function mapDeviceCard(device) {
  const pairingState = device.hasSecret ? "paired" : "not paired";

  return {
    ...device,
    canApprove: device.status === "pending" && device.hasCandidateSecret,
    canReload: device.status === "approved",
    canResetPairing: device.hasSecret,
    canRevoke: device.status === "approved",
    displayLastAccessDate: formatDateOnly(device.lastConnectedAt),
    displayLastRejectedDate: formatDateOnly(device.lastRejectedAt),
    displayLastSeen: formatSeenSeconds(device.lastConnectedAt),
    displayPairingState: pairingState,
    displayLastIp: device.lastKnownIp || "-",
    displayRejectedIp: device.lastRejectedIp || "-"
  };
}

function getAssignableLayouts(layouts) {
  return layouts.filter((layout) => layout.status !== "error");
}

function renderLoginPage(res, options = {}) {
  const { configError = false, errorMessage = null, usernameValue = "" } = options;

  return res.status(configError ? 503 : 200).render("pages/admin-login", {
    configError,
    errorMessage,
    pageTitle: "Admin Login",
    usernameValue
  });
}

router.get("/login", (req, res) => {
  if (res.locals.isAdminAuthenticated) {
    return res.redirect("/admin");
  }

  return renderLoginPage(res, {
    configError: !hasAdminAuthConfig()
  });
});

router.post("/login", (req, res) => {
  const usernameValue =
    typeof req.body?.username === "string" ? req.body.username.trim() : "";
  const password =
    typeof req.body?.password === "string" ? req.body.password : "";
  const result = verifyAdminLogin(usernameValue, password);

  if (!result.ok) {
    return renderLoginPage(res, {
      configError: result.reason === "missing_config",
      errorMessage:
        result.reason === "missing_config"
          ? null
          : "Invalid username or password.",
      usernameValue
    });
  }

  setAdminSessionCookie(req, res, result.username, process.env.ADMIN_SESSION_SECRET);

  return res.redirect("/admin");
});

router.post("/logout", (req, res) => {
  clearAdminSessionCookie(req, res);
  res.redirect("/admin/login");
});

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
    const assignableLayouts = getAssignableLayouts(layouts);

    res.render("pages/admin-devices", {
      devices: devices.map(mapDeviceCard),
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
      const assignableLayouts = getAssignableLayouts(layouts);
      const hasLayout = assignableLayouts.some(
        (layout) => layout.layoutId === layoutId
      );

      if (!hasLayout) {
        return res.status(400).render("pages/admin-devices", {
          devices: (await listDevices()).map(mapDeviceCard),
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

router.get("/devices/:deviceCode/layout", async (req, res, next) => {
  try {
    const { deviceCode } = req.params;
    const [device, layouts] = await Promise.all([
      readDevice(deviceCode),
      listLayouts()
    ]);

    if (!device) {
      return res.status(404).render("pages/device-unknown", {
        pageTitle: "Unknown device",
        deviceCode
      });
    }

    res.render("pages/admin-device-layout", {
      device,
      errorMessage: null,
      heading: "Assign Layout",
      layouts: getAssignableLayouts(layouts),
      pageTitle: `Assign layout for ${deviceCode}`
    });
  } catch (error) {
    next(error);
  }
});

router.post("/devices/:deviceCode/layout", async (req, res, next) => {
  try {
    const { deviceCode } = req.params;
    const nextLayoutId =
      typeof req.body?.layoutId === "string" && req.body.layoutId.trim() !== ""
        ? req.body.layoutId.trim()
        : undefined;
    const [device, layouts] = await Promise.all([
      readDevice(deviceCode),
      listLayouts()
    ]);

    if (!device) {
      return res.status(404).render("pages/device-unknown", {
        pageTitle: "Unknown device",
        deviceCode
      });
    }

    const assignableLayouts = getAssignableLayouts(layouts);

    if (nextLayoutId) {
      const hasLayout = assignableLayouts.some(
        (layout) => layout.layoutId === nextLayoutId
      );

      if (!hasLayout) {
        return res.status(400).render("pages/admin-device-layout", {
          device,
          errorMessage: "Selected layout is not available.",
          heading: "Assign Layout",
          layouts: assignableLayouts,
          pageTitle: `Assign layout for ${deviceCode}`
        });
      }
    }

    await updateDevice(deviceCode, {
      layoutId: nextLayoutId
    });

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

router.post("/devices/:deviceCode/reset-pairing", async (req, res, next) => {
  try {
    const { deviceCode } = req.params;

    await resetDevicePairing(deviceCode);

    res.redirect("/admin/devices");
  } catch (error) {
    next(error);
  }
});

router.post("/devices/:deviceCode/reload", async (req, res, next) => {
  try {
    const { deviceCode } = req.params;

    await requestDeviceReload(deviceCode);

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
