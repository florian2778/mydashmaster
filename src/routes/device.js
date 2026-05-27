const express = require("express");

const {
  deriveClientState,
  deriveDeviceAccessState,
  getAccessStateMeta,
  isHardAccessState
} = require("../device/client-state");
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
const { logLifecycleEvent } = require("../utils/lifecycle-log");

const router = express.Router();

function renderAccessState(res, deviceCode, accessState, options = {}) {
  const accessStateMeta = getAccessStateMeta(accessState);
  let state = {
    message: accessStateMeta.uiLabel,
    note: accessStateMeta.adminHint,
    pageTitle: accessStateMeta.uiLabel,
    shouldBootstrap: false,
    shouldPoll: true
  };

  if (accessState === "blocked_by_other_client") {
    state = {
      message: "This browser is not the active one",
      note:
        "Another browser is currently active for this device. Ask an admin to switch activation if needed.",
      pageTitle: accessStateMeta.uiLabel,
      shouldBootstrap: false,
      shouldPoll: true
    };
  } else if (accessState === "auth_mismatch") {
    state = {
      message: "Authentication mismatch",
      note:
        "This browser no longer matches the current device secret. Reconnect it from the active browser context or ask an admin for help.",
      pageTitle: accessStateMeta.uiLabel,
      shouldBootstrap: false,
      shouldPoll: true
    };
  } else if (accessState === "revoked") {
    state = {
      message: "Access revoked",
      note:
        "This device no longer has access. Please contact an administrator.",
      pageTitle: accessStateMeta.uiLabel,
      shouldBootstrap: false,
      shouldPoll: true
    };
  } else if (accessState === "reauth_required") {
    state = {
      message: "Reconnecting session",
      note:
        "This browser is known but needs to refresh its device session. Leave this page open.",
      pageTitle: accessStateMeta.uiLabel,
      shouldBootstrap: true,
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
    accessState,
    canAttemptBootstrapAuth: Boolean(options.canAttemptBootstrapAuth),
    canAttemptReauth: Boolean(options.canAttemptReauth),
    clientId: options.clientId || null,
    clientState: options.clientState || "pending",
    deviceStatus: options.deviceStatus || null,
    deviceCode,
    hasCurrentAuthentication: Boolean(options.hasCurrentAuthentication),
    hasValidSession: Boolean(options.hasValidSession),
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

    const deviceAuth = await readDeviceAuth(deviceCode);
    const hasValidSession = Boolean(
      deviceAuth?.secretHash && hasValidDeviceSession(req, deviceCode, deviceAuth.secretHash)
    );
    const derivedAccessState = deriveDeviceAccessState({
      clientId,
      device,
      deviceAuth,
      hasValidSession
    });
    const derivedClientState = deriveClientState({
      clientId,
      device,
      deviceAuth,
      hasValidSession
    });

    if (derivedAccessState.accessState !== "active_authorized") {
      const requestIp = getRequestIp(req);
      const requestUserAgent = typeof req.headers["user-agent"] === "string"
        ? req.headers["user-agent"]
        : undefined;

      if (derivedAccessState.accessState === "reauth_required") {
        logLifecycleEvent("device_access_reauth_required", {
          accessState: derivedAccessState.accessState,
          clientId,
          cooldownMs: 60000,
          dedupeKey: `device_access_reauth_required:${deviceCode}:${clientId}`,
          details: { source: "device_page" },
          deviceCode,
          ip: requestIp,
          level: "info",
          userAgent: requestUserAgent
        });
      } else if (derivedAccessState.accessState === "auth_mismatch") {
        logLifecycleEvent("device_access_auth_mismatch", {
          accessState: derivedAccessState.accessState,
          clientId,
          cooldownMs: 60000,
          dedupeKey: `device_access_auth_mismatch:${deviceCode}:${clientId}`,
          details: { source: "device_page" },
          deviceCode,
          ip: requestIp,
          level: "warn",
          userAgent: requestUserAgent
        });
      } else if (derivedAccessState.accessState === "blocked_by_other_client") {
        logLifecycleEvent("device_access_blocked_by_other_client", {
          accessState: derivedAccessState.accessState,
          clientId,
          cooldownMs: 60000,
          dedupeKey: `device_access_blocked_by_other_client:${deviceCode}:${clientId}`,
          details: { source: "device_page" },
          deviceCode,
          ip: requestIp,
          level: "warn",
          userAgent: requestUserAgent
        });
      }

      if (isHardAccessState(derivedAccessState.accessState)) {
        clearDeviceSessionCookie(req, res, deviceCode);
      }

      return renderAccessState(res, deviceCode, derivedAccessState.accessState, {
        canAttemptBootstrapAuth: derivedAccessState.canAttemptBootstrapAuth,
        canAttemptReauth: derivedAccessState.canAttemptReauth,
        clientId,
        clientState: derivedClientState.state,
        deviceStatus: device.status,
        hasCurrentAuthentication: derivedAccessState.hasCurrentAuthentication,
        hasValidSession: derivedAccessState.hasValidSession,
        isAuthenticated: derivedClientState.isAuthenticated,
        isActivatable: derivedAccessState.isActivatable
      });
    }

    await recordDeviceActivity(deviceCode, getRequestIp(req));
    const layoutViewModel = await buildDeviceLayoutViewModel(device);

    res.render("pages/device", {
      accessState: derivedAccessState.accessState,
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
