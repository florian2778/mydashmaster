const express = require("express");

const { deriveClientState } = require("../device/client-state");
const {
  clearDeviceSessionCookie,
  ensureDeviceClientId,
  getRequestIp,
  hasValidDeviceSession
} = require("../auth/device-auth");
const { buildDeviceLayoutViewModel } = require("../device/layout-render");
const {
  recordDeviceActivity,
  readDevice,
  readDeviceAuth
} = require("../storage/json-store");

const router = express.Router();

function renderClientState(res, deviceCode, clientState, options = {}) {
  let state = null;

  if (clientState === "blocked") {
    state = {
      message: "This browser is not the active one",
      note:
        "Another browser is currently active for this device. Ask an admin to switch activation if needed.",
      pageTitle: "Access not available",
      shouldBootstrap: false,
      shouldPoll: true
    };
  } else if (clientState === "revoked") {
    state = {
      message: "Access revoked",
      note:
        "This device no longer has access. Please contact an administrator.",
      pageTitle: "Access revoked",
      shouldBootstrap: false,
      shouldPoll: true
    };
  } else if (options.deviceStatus !== "approved") {
    state = {
      message: "Access pending",
      note: "This device is waiting for admin approval. Leave this page open.",
      pageTitle: "Access pending",
      shouldBootstrap: true,
      shouldPoll: true
    };
  } else if (options.isActivatable) {
    state = {
      message: "Waiting for activation",
      note: "This browser is ready. Ask an admin to activate it for this device.",
      pageTitle: "Waiting for activation",
      shouldBootstrap: true,
      shouldPoll: true
    };
  } else if (options.isAuthenticated) {
    state = {
      message: "Waiting for activation",
      note:
        "This browser is authenticated. Keep this page open while an admin activates it.",
      pageTitle: "Waiting for activation",
      shouldBootstrap: true,
      shouldPoll: true
    };
  } else {
    state = {
      message: "Preparing activation",
      note:
        "This browser is establishing access in the background. Leave this page open.",
      pageTitle: "Preparing activation",
      shouldBootstrap: true,
      shouldPoll: true
    };
  }

  return res.render("pages/device-pending", {
    clientState,
    clientId: options.clientId || null,
    deviceStatus: options.deviceStatus || null,
    deviceCode,
    isAuthenticated: Boolean(options.isAuthenticated),
    isActivatable: Boolean(options.isActivatable),
    message: state.message,
    note: state.note,
    pageTitle: state.pageTitle,
    shouldBootstrap: state.shouldBootstrap,
    shouldPoll: state.shouldPoll
  });
}

router.get("/:deviceCode", async (req, res, next) => {
  try {
    const { deviceCode } = req.params;
    const clientId = ensureDeviceClientId(req, res);
    const device = await readDevice(deviceCode);

    if (!device) {
      clearDeviceSessionCookie(req, res, deviceCode);
      return res.status(404).render("pages/device-unknown", {
        pageTitle: "Unknown device",
        deviceCode
      });
    }

    if (device.status === "revoked") {
      clearDeviceSessionCookie(req, res, deviceCode);
      return renderClientState(res, deviceCode, "revoked");
    }

    const deviceAuth = await readDeviceAuth(deviceCode);
    const derivedState = deriveClientState({
      clientId,
      device,
      deviceAuth
    });

    if (
      device.status !== "approved" ||
      derivedState.state !== "active" ||
      !deviceAuth?.secretHash ||
      !hasValidDeviceSession(req, deviceCode, deviceAuth.secretHash)
    ) {
      if (derivedState.state === "blocked") {
        clearDeviceSessionCookie(req, res, deviceCode);
      }

      return renderClientState(res, deviceCode, derivedState.state, {
        clientId,
        deviceStatus: device.status,
        isAuthenticated: derivedState.isAuthenticated,
        isActivatable: derivedState.isActivatable
      });
    }

    await recordDeviceActivity(deviceCode, getRequestIp(req));
    const layoutViewModel = await buildDeviceLayoutViewModel(device);

    res.render("pages/device", {
      deviceCode,
      pageTitle: `Device ${deviceCode}`,
      reloadVersion: deviceAuth.reloadVersion || 0,
      ...layoutViewModel
    });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
