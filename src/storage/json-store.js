const fs = require("fs/promises");
const path = require("path");
const crypto = require("crypto");

const {
  assertValid,
  validateDevice,
  validateDeviceAuth,
  validateLayout
} = require("./validators");

const dataRoot = path.join(__dirname, "..", "..", "data");
const devicesDir = path.join(dataRoot, "devices");
const deviceAuthDir = path.join(dataRoot, "device-auth");
const layoutsDir = path.join(dataRoot, "layouts");
const DEVICE_CODE_LENGTH = 8;
const DEVICE_CODE_ALPHABET = "abcdefghijklmnopqrstuvwxyz0123456789";

async function ensureDir(dirPath) {
  await fs.mkdir(dirPath, { recursive: true });
}

async function readJsonFile(filePath) {
  const content = await fs.readFile(filePath, "utf8");
  return JSON.parse(content);
}

function getLayoutStatus(validation) {
  if (validation.errors.length > 0) {
    return "error";
  }

  if (validation.warnings.length > 0) {
    return "warning";
  }

  return "valid";
}

function countStructureBoxes(node) {
  if (!node || typeof node !== "object") {
    return 0;
  }

  if (node.type === "box") {
    return 1;
  }

  if (!Array.isArray(node.children)) {
    return 0;
  }

  return node.children.reduce(
    (total, child) => total + countStructureBoxes(child),
    0
  );
}

function getLayoutVersionState(layout) {
  if (!layout || typeof layout !== "object") {
    return "missing";
  }

  if (layout.layoutVersion === undefined) {
    return "missing";
  }

  if (!Number.isInteger(layout.layoutVersion)) {
    return "invalid";
  }

  return "valid";
}

function assertMatchingId(actualValue, expectedValue, fieldName, subject) {
  if (actualValue === expectedValue) {
    return;
  }

  const error = new Error(
    `Invalid ${subject}: ${fieldName} must match "${expectedValue}"`
  );
  error.name = "ValidationError";
  throw error;
}

async function readDevice(deviceCode) {
  await ensureDir(devicesDir);

  const filePath = path.join(devicesDir, `${deviceCode}.json`);

  try {
    const device = await readJsonFile(filePath);
    const validation = validateDevice(device);

    assertValid(validation, "device");
    assertMatchingId(device.deviceCode, deviceCode, "deviceCode", "device");

    if (validation.warnings.length > 0) {
      console.warn(
        `Device validation warnings for ${deviceCode}: ${validation.warnings.join("; ")}`
      );
    }

    return device;
  } catch (error) {
    if (error.code === "ENOENT") {
      return null;
    }

    throw error;
  }
}

async function readLayout(layoutId) {
  const layoutRecord = await readLayoutRecord(layoutId);

  if (!layoutRecord) {
    return null;
  }

  if (layoutRecord.parseError) {
    const error = new Error(`Invalid layout: ${layoutRecord.parseError}`);
    error.name = "ValidationError";
    throw error;
  }

  const { layout, validation } = layoutRecord;

  assertValid(validation, "layout");
  assertMatchingId(layout.layoutId, layoutId, "layoutId", "layout");

  if (validation.warnings.length > 0) {
    console.warn(
      `Layout validation warnings for ${layoutId}: ${validation.warnings.join("; ")}`
    );
  }

  return layout;
}

async function readDeviceAuth(deviceCode) {
  await ensureDir(deviceAuthDir);

  const filePath = path.join(deviceAuthDir, `${deviceCode}.json`);

  try {
    const deviceAuth = await readJsonFile(filePath);
    const validation = validateDeviceAuth(deviceAuth);

    assertValid(validation, "device auth");
    assertMatchingId(
      deviceAuth.deviceCode,
      deviceCode,
      "deviceCode",
      "device auth"
    );

    return deviceAuth;
  } catch (error) {
    if (error.code === "ENOENT") {
      return null;
    }

    throw error;
  }
}

async function createPendingDevice(deviceCode) {
  await ensureDir(devicesDir);

  const device = {
    deviceCode,
    status: "pending"
  };

  const filePath = path.join(devicesDir, `${deviceCode}.json`);

  await fs.writeFile(filePath, JSON.stringify(device, null, 2));

  return device;
}

function generateDeviceCode() {
  const bytes = crypto.randomBytes(DEVICE_CODE_LENGTH);

  return Array.from(bytes, (byte) =>
    DEVICE_CODE_ALPHABET[byte % DEVICE_CODE_ALPHABET.length]
  ).join("");
}

async function generateUniqueDeviceCode(maxAttempts = 32) {
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const deviceCode = generateDeviceCode();
    const existingDevice = await readDevice(deviceCode);

    if (!existingDevice) {
      return deviceCode;
    }
  }

  throw new Error("Unable to generate a unique device code");
}

async function writeJsonFile(filePath, value) {
  await fs.writeFile(filePath, JSON.stringify(value, null, 2));
}

async function deleteJsonFile(filePath) {
  try {
    await fs.unlink(filePath);
  } catch (error) {
    if (error.code !== "ENOENT") {
      throw error;
    }
  }
}

async function writeDevice(deviceCode, device) {
  await ensureDir(devicesDir);

  const validation = validateDevice(device);
  assertValid(validation, "device");
  assertMatchingId(device.deviceCode, deviceCode, "deviceCode", "device");

  const filePath = path.join(devicesDir, `${deviceCode}.json`);
  await writeJsonFile(filePath, device);

  return device;
}

async function updateDevice(deviceCode, updates) {
  const device = await readDevice(deviceCode);

  if (!device) {
    return null;
  }

  return writeDevice(deviceCode, {
    ...device,
    ...updates,
    deviceCode
  });
}

async function readLayoutRecord(layoutId) {
  await ensureDir(layoutsDir);

  const filePath = path.join(layoutsDir, `${layoutId}.json`);

  try {
    const rawContent = await fs.readFile(filePath, "utf8");
    let layout = null;
    let parseError = null;
    let validation = { errors: [], warnings: [] };

    try {
      layout = JSON.parse(rawContent);
      validation = validateLayout(layout);
    } catch (error) {
      parseError = error.message;
      validation = {
        errors: [`Invalid JSON: ${error.message}`],
        warnings: []
      };
    }

    const resolvedLayoutId =
      typeof layout?.layoutId === "string" ? layout.layoutId : layoutId;
    const boxes = Array.isArray(layout?.boxes) ? layout.boxes : [];
    const structure =
      layout && typeof layout === "object" ? layout.structure || null : null;

    return {
      boxCount: boxes.length,
      boxes,
      errors: validation.errors,
      filePath,
      isNeutralPreview:
        boxes.length === 0 || countStructureBoxes(structure) === 0,
      layout,
      layoutId: resolvedLayoutId,
      layoutVersion:
        layout && typeof layout === "object" ? layout.layoutVersion : undefined,
      layoutVersionState: getLayoutVersionState(layout),
      parseError,
      rawContent,
      status: parseError ? "error" : getLayoutStatus(validation),
      structure,
      validation,
      warnings: validation.warnings
    };
  } catch (error) {
    if (error.code === "ENOENT") {
      return null;
    }

    throw error;
  }
}

async function writeLayout(layoutId, layout) {
  await ensureDir(layoutsDir);

  const validation = validateLayout(layout);
  assertValid(validation, "layout");
  assertMatchingId(layout.layoutId, layoutId, "layoutId", "layout");

  const filePath = path.join(layoutsDir, `${layoutId}.json`);
  await writeJsonFile(filePath, layout);

  return layout;
}

async function createAdminDevice({ layoutId } = {}) {
  const deviceCode = await generateUniqueDeviceCode();

  return writeDevice(deviceCode, {
    deviceCode,
    layoutId: layoutId || undefined,
    status: "pending"
  });
}

async function deleteDevice(deviceCode) {
  await ensureDir(devicesDir);
  await ensureDir(deviceAuthDir);

  await deleteJsonFile(path.join(devicesDir, `${deviceCode}.json`));
  await deleteJsonFile(path.join(deviceAuthDir, `${deviceCode}.json`));
}

async function writeDeviceAuth(deviceCode, deviceAuth) {
  await ensureDir(deviceAuthDir);

  const validation = validateDeviceAuth(deviceAuth);
  assertValid(validation, "device auth");
  assertMatchingId(
    deviceAuth.deviceCode,
    deviceCode,
    "deviceCode",
    "device auth"
  );

  const filePath = path.join(deviceAuthDir, `${deviceCode}.json`);
  await writeJsonFile(filePath, deviceAuth);

  return deviceAuth;
}

async function updateDeviceAuth(deviceCode, updates) {
  const existingDeviceAuth = (await readDeviceAuth(deviceCode)) || { deviceCode };

  return writeDeviceAuth(deviceCode, {
    ...existingDeviceAuth,
    ...updates,
    deviceCode
  });
}

async function recordDeviceActivity(deviceCode, lastKnownIp) {
  const now = new Date().toISOString();

  return updateDeviceAuth(deviceCode, {
    lastConnectedAt: now,
    lastKnownIp,
    updatedAt: now
  });
}

async function recordDeviceRejection(deviceCode, lastRejectedIp, lastRejectedReason) {
  const now = new Date().toISOString();

  return updateDeviceAuth(deviceCode, {
    lastRejectedAt: now,
    lastRejectedIp,
    lastRejectedReason,
    updatedAt: now
  });
}

async function registerCandidateSecret(deviceCode, candidateSecretHash) {
  return updateDeviceAuth(deviceCode, {
    candidateSecretHash,
    updatedAt: new Date().toISOString()
  });
}

async function activateCandidateSecret(deviceCode) {
  const deviceAuth = await readDeviceAuth(deviceCode);

  if (!deviceAuth?.candidateSecretHash) {
    return null;
  }

  return updateDeviceAuth(deviceCode, {
    candidateSecretHash: undefined,
    secretHash: deviceAuth.candidateSecretHash,
    updatedAt: new Date().toISOString()
  });
}

async function revokeDeviceAuth(deviceCode) {
  return updateDeviceAuth(deviceCode, {
    candidateSecretHash: undefined,
    secretHash: undefined,
    updatedAt: new Date().toISOString()
  });
}

async function resetDevicePairing(deviceCode) {
  return updateDeviceAuth(deviceCode, {
    candidateSecretHash: undefined,
    secretHash: undefined,
    updatedAt: new Date().toISOString()
  });
}

async function requestDeviceReload(deviceCode) {
  const deviceAuth = (await readDeviceAuth(deviceCode)) || { deviceCode };

  return updateDeviceAuth(deviceCode, {
    ...deviceAuth,
    reloadVersion: (deviceAuth.reloadVersion || 0) + 1,
    updatedAt: new Date().toISOString()
  });
}

async function listDeviceCodes() {
  await ensureDir(devicesDir);

  const entries = await fs.readdir(devicesDir, { withFileTypes: true });

  return entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
    .map((entry) => entry.name.replace(/\.json$/, ""))
    .sort();
}

async function listDevices() {
  const deviceCodes = await listDeviceCodes();

  return Promise.all(
    deviceCodes.map(async (deviceCode) => {
      const device = await readDevice(deviceCode);
      const deviceAuth = await readDeviceAuth(deviceCode);

      return {
        ...device,
        hasCandidateSecret: Boolean(deviceAuth?.candidateSecretHash),
        hasSecret: Boolean(deviceAuth?.secretHash),
        lastConnectedAt: deviceAuth?.lastConnectedAt || null,
        lastKnownIp: deviceAuth?.lastKnownIp || null,
        lastRejectedAt: deviceAuth?.lastRejectedAt || null,
        lastRejectedIp: deviceAuth?.lastRejectedIp || null,
        lastRejectedReason: deviceAuth?.lastRejectedReason || null,
        reloadVersion: deviceAuth?.reloadVersion || 0
      };
    })
  );
}

async function listLayouts() {
  await ensureDir(layoutsDir);

  const entries = await fs.readdir(layoutsDir, { withFileTypes: true });
  const fileEntries = entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
    .sort((a, b) => a.name.localeCompare(b.name));

  return Promise.all(
    fileEntries.map(async (entry) => {
      const fileName = entry.name;
      const fallbackLayoutId = fileName.replace(/\.json$/, "");

      try {
        const layoutRecord = await readLayoutRecord(fallbackLayoutId);

        return {
          boxCount: layoutRecord.boxCount,
          boxes: layoutRecord.boxes,
          errors: layoutRecord.errors,
          isNeutralPreview: layoutRecord.isNeutralPreview,
          layoutId: layoutRecord.layoutId || fallbackLayoutId,
          layoutVersion: layoutRecord.layoutVersion,
          layoutVersionState: layoutRecord.layoutVersionState,
          status: layoutRecord.status,
          structure: layoutRecord.structure,
          warnings: layoutRecord.warnings
        };
      } catch (error) {
        return {
          layoutId: fallbackLayoutId,
          boxes: [],
          status: "error",
          boxCount: 0,
          errors: [`Invalid layout file: ${error.message}`],
          warnings: [],
          isNeutralPreview: true,
          structure: null
        };
      }
    })
  );
}

module.exports = {
  activateCandidateSecret,
  createAdminDevice,
  createPendingDevice,
  deleteDevice,
  generateDeviceCode,
  generateUniqueDeviceCode,
  listDevices,
  listDeviceCodes,
  listLayouts,
  readDeviceAuth,
  readLayoutRecord,
  readLayout,
  readDevice,
  recordDeviceActivity,
  recordDeviceRejection,
  requestDeviceReload,
  resetDevicePairing,
  registerCandidateSecret,
  revokeDeviceAuth,
  updateDevice,
  updateDeviceAuth,
  writeLayout,
  writeDevice
};
