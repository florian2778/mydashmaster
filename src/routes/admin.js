const express = require("express");

const { deriveClientState, getPairedClient } = require("../device/client-state");
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
  activateDeviceClient,
  createAdminDevice,
  deleteDevice,
  listDevices,
  listLayouts,
  readDevice,
  readDeviceAuth,
  readLayoutRecord,
  requestDeviceReload,
  resetDevicePairing,
  revokeDeviceAuth,
  updateDevice,
  writeLayout
} = require("../storage/json-store");
const { validateLayout } = require("../storage/validators");

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

function formatAbsoluteTimestamp(value) {
  if (!value) {
    return "-";
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "-";
  }

  return date.toISOString();
}

function formatRelativeSeen(value) {
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

  if (diffSeconds < 5) {
    return "just now";
  }

  if (diffSeconds < 60) {
    return `${diffSeconds}s ago`;
  }

  const diffMinutes = Math.floor(diffSeconds / 60);

  if (diffMinutes < 60) {
    return `${diffMinutes}m ago`;
  }

  const diffHours = Math.floor(diffMinutes / 60);

  if (diffHours < 24) {
    return `${diffHours}h ago`;
  }

  const diffDays = Math.floor(diffHours / 24);
  return `${diffDays}d ago`;
}

function shortenClientId(value) {
  if (typeof value !== "string" || value === "") {
    return "-";
  }

  return value.length <= 8 ? value : `${value.slice(0, 8)}...`;
}

function mapDeviceCard(device) {
  const pairingState = getPairedClient({ clients: device.clients })
    ? "active"
    : "pending";

  return {
    ...device,
    canReload: device.status === "approved",
    canResetPairing: device.hasSecret || Array.isArray(device.clients) && device.clients.length > 0,
    canRevoke: device.status === "approved",
    displayLastAccessDate: formatDateOnly(device.lastConnectedAt),
    displayLastSeen: formatRelativeSeen(device.lastStatusAt),
    detailUrl: `/admin/devices/${device.deviceCode}`,
    displayPairingState: pairingState,
    displayLastIp: device.lastKnownIp || "-"
  };
}

function buildClientDisplay(device, deviceAuth, client) {
  const derivedState = deriveClientState({
    clientId: client.clientId,
    device,
    deviceAuth
  });

  return {
    ...client,
    canActivate: derivedState.isActivatable,
    clientState: derivedState.state,
    displayClientId: shortenClientId(client.clientId),
    displayLastAuthenticatedAt: formatAbsoluteTimestamp(client.lastAuthenticatedAt),
    displayLastKnownIp: client.lastKnownIp || "-",
    displayLastSeenAt: formatAbsoluteTimestamp(client.lastSeenAt)
  };
}

function buildDeviceDetailViewModel(device, deviceAuth, layouts, options = {}) {
  const activeClient = getPairedClient(deviceAuth);
  const additionalClients = Array.isArray(device.clients)
    ? device.clients
      .filter((client) => !client.isPairedClient)
      .map((client) => buildClientDisplay(device, deviceAuth, client))
    : [];

  return {
    actionErrorMessage: options.actionErrorMessage || null,
    assignableLayouts: getAssignableLayouts(layouts),
    device: {
      ...mapDeviceCard(device),
      displayLastConnectedAt: formatAbsoluteTimestamp(device.lastConnectedAt),
      displayOfficialSeenAbsolute: formatAbsoluteTimestamp(device.lastStatusAt),
      displayActivationState:
        activeClient ? "active client" : "pending"
    },
    canActivateClients: device.status !== "revoked",
    officialActiveClient: activeClient
      ? {
        ...buildClientDisplay(device, deviceAuth, activeClient),
        displaySeen: formatRelativeSeen(device.lastStatusAt),
        lastConnectedAt: device.lastConnectedAt || null,
        displayLastConnectedAt: formatAbsoluteTimestamp(device.lastConnectedAt),
        activeStateLabel: "active client"
      }
      : null,
    additionalClients,
    pageTitle: device.deviceCode
  };
}

function getAssignableLayouts(layouts) {
  return layouts.filter((layout) => layout.status !== "error");
}

function getLayoutVersionDisplay(layoutRecord) {
  if (layoutRecord.layoutVersionState === "valid") {
    return String(layoutRecord.layoutVersion);
  }

  return "migration required";
}

function getLayoutVersionNote(layoutRecord) {
  if (layoutRecord.layoutVersionState === "missing") {
    return "layoutVersion is missing. This layout needs migration before normal save flow is reliable.";
  }

  if (layoutRecord.layoutVersionState === "invalid") {
    return "layoutVersion is invalid. Use edit mode to correct it before saving.";
  }

  return null;
}

function buildLayoutDraftValidation(layoutId, jsonContent) {
  let parsedLayout = null;
  let parseError = null;
  let validation = {
    errors: [],
    warnings: []
  };

  try {
    parsedLayout = JSON.parse(jsonContent);
    validation = validateLayout(parsedLayout);
  } catch (error) {
    parseError = error.message;
    validation.errors.push(`Invalid JSON: ${error.message}`);
  }

  if (parsedLayout && parsedLayout.layoutId !== layoutId) {
    validation.errors.push(`layoutId must remain "${layoutId}"`);
  }

  const status =
    validation.errors.length > 0
      ? "error"
      : validation.warnings.length > 0
        ? "warning"
        : "valid";

  return {
    jsonContent,
    parsedLayout,
    parseError,
    status,
    validation
  };
}

function buildLayoutUsageDevices(devices, layoutId) {
  return devices
    .filter((device) => device.layoutId === layoutId)
    .map((device) => ({
      description: device.description || null,
      deviceCode: device.deviceCode,
      status: device.status
    }));
}

function getReadableLayoutJson(layoutRecord) {
  if (!layoutRecord) {
    return "";
  }

  if (layoutRecord.layout) {
    return JSON.stringify(layoutRecord.layout, null, 2);
  }

  return layoutRecord.rawContent;
}

async function renderLayoutDetailPage(res, layoutId, options = {}) {
  const {
    editMode = false,
    draftResult = null,
    httpStatus = 200
  } = options;

  const [layoutRecord, devices] = await Promise.all([
    readLayoutRecord(layoutId),
    listDevices()
  ]);

  if (!layoutRecord) {
    return res.status(404).render("pages/admin-layout-not-found", {
      heading: "Unknown layout",
      layoutId,
      pageTitle: "Unknown layout"
    });
  }

  const validationSource = draftResult?.validation || layoutRecord.validation;
  const status = draftResult?.status || layoutRecord.status;

  return res.status(httpStatus).render("pages/admin-layout-detail", {
    draftJsonContent:
      draftResult?.jsonContent || getReadableLayoutJson(layoutRecord),
    editMode,
    heading: "Layout Detail",
    layout: layoutRecord,
    layoutUsageDevices: buildLayoutUsageDevices(devices, layoutRecord.layoutId),
    pageTitle: layoutRecord.layoutId,
    validationErrors: validationSource.errors,
    validationStatus: status,
    validationWarnings: validationSource.warnings,
    versionDisplay: getLayoutVersionDisplay(layoutRecord),
    versionNote: getLayoutVersionNote(layoutRecord)
  });
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

async function renderDeviceDetailPage(res, deviceCode, options = {}) {
  const { actionErrorMessage = null, httpStatus = 200 } = options;
  const [devices, layouts] = await Promise.all([listDevices(), listLayouts()]);
  const device = devices.find((entry) => entry.deviceCode === deviceCode);

  if (!device) {
    return res.status(404).render("pages/device-unknown", {
      pageTitle: "Unknown device",
      deviceCode
    });
  }

  const deviceAuth = (await readDeviceAuth(deviceCode)) || {
    clients: device.clients
  };

  return res.status(httpStatus).render(
    "pages/admin-device-detail",
    buildDeviceDetailViewModel(device, deviceAuth, layouts, { actionErrorMessage })
  );
}

function redirectAfterDeviceAction(req, res, deviceCode) {
  if (req.body?.returnTo === "detail") {
    return res.redirect(`/admin/devices/${deviceCode}`);
  }

  return res.redirect("/admin/devices");
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

router.get("/layouts/:layoutId", async (req, res, next) => {
  try {
    const { layoutId } = req.params;
    const editMode = req.query.mode === "edit";

    await renderLayoutDetailPage(res, layoutId, {
      editMode
    });
  } catch (error) {
    next(error);
  }
});

router.post("/layouts/:layoutId", async (req, res, next) => {
  try {
    const { layoutId } = req.params;
    const intent =
      typeof req.body?.intent === "string" ? req.body.intent : "validate";
    const jsonContent =
      typeof req.body?.jsonContent === "string" ? req.body.jsonContent : "";
    const layoutRecord = await readLayoutRecord(layoutId);

    if (!layoutRecord) {
      return res.status(404).render("pages/admin-layout-not-found", {
        heading: "Unknown layout",
        layoutId,
        pageTitle: "Unknown layout"
      });
    }

    if (intent === "cancel") {
      return res.redirect(`/admin/layouts/${layoutId}`);
    }

    const draftResult = buildLayoutDraftValidation(layoutId, jsonContent);

    if (intent === "save") {
      if (draftResult.validation.errors.length > 0 || !draftResult.parsedLayout) {
        return renderLayoutDetailPage(res, layoutId, {
          draftResult,
          editMode: true,
          httpStatus: 400
        });
      }

      const nextLayoutVersion = Number.isInteger(layoutRecord.layoutVersion)
        ? layoutRecord.layoutVersion + 1
        : draftResult.parsedLayout.layoutVersion;

      await writeLayout(layoutId, {
        ...draftResult.parsedLayout,
        layoutId,
        layoutVersion: nextLayoutVersion
      });

      return res.redirect(`/admin/layouts/${layoutId}`);
    }

    return renderLayoutDetailPage(res, layoutId, {
      draftResult,
      editMode: true
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

router.get("/devices/:deviceCode", async (req, res, next) => {
  try {
    const { deviceCode } = req.params;

    await renderDeviceDetailPage(res, deviceCode);
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

    redirectAfterDeviceAction(req, res, deviceCode);
  } catch (error) {
    next(error);
  }
});

router.post("/devices/:deviceCode/activate-client", async (req, res, next) => {
  try {
    const { deviceCode } = req.params;
    const clientId =
      typeof req.body?.clientId === "string" ? req.body.clientId.trim() : "";

    if (!clientId) {
      return renderDeviceDetailPage(res, deviceCode, {
        actionErrorMessage: "Select a valid client before activation.",
        httpStatus: 400
      });
    }

    try {
      await activateDeviceClient(deviceCode, clientId);
    } catch (error) {
      if (error?.name === "ValidationError") {
        return renderDeviceDetailPage(res, deviceCode, {
          actionErrorMessage: error.message,
          httpStatus: 400
        });
      }

      throw error;
    }

    return res.redirect(`/admin/devices/${deviceCode}`);
  } catch (error) {
    next(error);
  }
});

router.post("/devices/:deviceCode/revoke", async (req, res, next) => {
  try {
    const { deviceCode } = req.params;

    await revokeDeviceAuth(deviceCode);
    await updateDevice(deviceCode, { status: "revoked" });

    redirectAfterDeviceAction(req, res, deviceCode);
  } catch (error) {
    next(error);
  }
});

router.post("/devices/:deviceCode/reset-pairing", async (req, res, next) => {
  try {
    const { deviceCode } = req.params;

    await resetDevicePairing(deviceCode);

    redirectAfterDeviceAction(req, res, deviceCode);
  } catch (error) {
    next(error);
  }
});

router.post("/devices/:deviceCode/reload", async (req, res, next) => {
  try {
    const { deviceCode } = req.params;

    await requestDeviceReload(deviceCode);

    redirectAfterDeviceAction(req, res, deviceCode);
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
