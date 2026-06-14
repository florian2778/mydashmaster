const express = require("express");

const { findApiKeyBySecret } = require("../api/api-key-store");
const { listDevices, listLayouts } = require("../storage/json-store");

const router = express.Router();

function sendApiError(res, status, code, message) {
  return res.status(status).json({
    error: {
      code,
      message
    }
  });
}

function getApiKeyHeader(req) {
  const value = req.get("X-API-Key");

  return typeof value === "string" ? value.trim() : "";
}

async function authenticateApiKey(req, res, next) {
  try {
    const secret = getApiKeyHeader(req);

    if (!secret) {
      return sendApiError(res, 401, "api_key_missing", "API key is required.");
    }

    const result = await findApiKeyBySecret(secret);

    if (result.status === "config_invalid") {
      return sendApiError(
        res,
        500,
        "api_key_config_invalid",
        "API key configuration is invalid."
      );
    }

    if (result.status === "conflict") {
      return sendApiError(
        res,
        500,
        "api_key_conflict",
        "API key configuration is ambiguous."
      );
    }

    if (!result.key) {
      return sendApiError(res, 401, "api_key_unknown", "API key is not valid.");
    }

    req.apiKey = result.key;
    return next();
  } catch (error) {
    return next(error);
  }
}

function requireReadonlyAction(req, res, next) {
  if (req.method === "GET") {
    return next();
  }

  if (req.apiKey?.mode === "readonly") {
    return sendApiError(
      res,
      403,
      "mode_forbids_method",
      "API key mode does not allow this method."
    );
  }

  res.set("Allow", "GET");
  return sendApiError(
    res,
    405,
    "method_not_allowed",
    "Method is not allowed for this endpoint."
  );
}

function buildResourceLookup(resources, keyField) {
  return new Map(resources.map((resource) => [resource[keyField], resource]));
}

function getResourceName(resource, keyField) {
  return typeof resource.description === "string" && resource.description.trim() !== ""
    ? resource.description
    : resource[keyField];
}

function mapAllowedResources(allowedKeys, resourceMap, keyField, apiKeyName, type) {
  return allowedKeys.flatMap((key) => {
    const resource = resourceMap.get(key);

    if (!resource) {
      console.warn(
        `[simple-api] Missing ${type} reference for API key ${apiKeyName}: ${key}`
      );
      return [];
    }

    return [
      {
        key,
        name: getResourceName(resource, keyField)
      }
    ];
  });
}

router.all(
  "/v1/list",
  authenticateApiKey,
  requireReadonlyAction,
  async (req, res, next) => {
    try {
      const [devices, layouts] = await Promise.all([listDevices(), listLayouts()]);
      const deviceMap = buildResourceLookup(devices, "deviceCode");
      const layoutMap = buildResourceLookup(layouts, "layoutId");
      const apiKey = req.apiKey;

      return res.json({
        apiKey: apiKey.name,
        mode: apiKey.mode,
        devices: mapAllowedResources(
          apiKey.allowedDevices,
          deviceMap,
          "deviceCode",
          apiKey.name,
          "device"
        ),
        layouts: mapAllowedResources(
          apiKey.allowedLayouts,
          layoutMap,
          "layoutId",
          apiKey.name,
          "layout"
        )
      });
    } catch (error) {
      return next(error);
    }
  }
);

module.exports = router;
