function createValidationError(message) {
  const error = new Error(message);
  error.name = "ValidationError";
  return error;
}

function createResult() {
  return {
    errors: [],
    warnings: []
  };
}

function mergeResult(target, source) {
  target.errors.push(...source.errors);
  target.warnings.push(...source.warnings);
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

const ALLOWED_CLIENT_ACCESS_STATES = new Set([
  "authorized",
  "pending",
  "auth_mismatch",
  "revoked",
  "not_paired"
]);

function isValidSize(size) {
  return /^\d+(\.\d+)?(%|px|fr)$/.test(size);
}

function isValidGap(gap) {
  return /^\d+(\.\d+)?px$/.test(gap);
}

function validateDevice(device) {
  const result = createResult();

  if (!isPlainObject(device)) {
    result.errors.push("Invalid device: expected an object");
    return result;
  }

  if (typeof device.deviceCode !== "string") {
    result.errors.push("Invalid device: deviceCode must be a string");
  }

  if (
    device.status !== "pending" &&
    device.status !== "approved" &&
    device.status !== "revoked"
  ) {
    result.errors.push(
      'Invalid device: status must be "pending", "approved", or "revoked"'
    );
  }

  if (
    device.description !== undefined &&
    device.description !== null &&
    typeof device.description !== "string"
  ) {
    result.errors.push("Invalid device: description must be a string");
  }

  if (
    device.layoutId !== undefined &&
    device.layoutId !== null &&
    typeof device.layoutId !== "string"
  ) {
    result.errors.push("Invalid device: layoutId must be a string");
  }

  return result;
}

function validateDeviceAuth(deviceAuth) {
  const result = createResult();

  if (!isPlainObject(deviceAuth)) {
    result.errors.push("Invalid device auth: expected an object");
    return result;
  }

  if (typeof deviceAuth.deviceCode !== "string") {
    result.errors.push("Invalid device auth: deviceCode must be a string");
  }

  if (
    deviceAuth.candidateSecretHash !== undefined &&
    typeof deviceAuth.candidateSecretHash !== "string"
  ) {
    result.errors.push(
      "Invalid device auth: candidateSecretHash must be a string"
    );
  }

  if (
    deviceAuth.secretHash !== undefined &&
    typeof deviceAuth.secretHash !== "string"
  ) {
    result.errors.push("Invalid device auth: secretHash must be a string");
  }

  if (
    deviceAuth.lastStatusAt !== undefined &&
    typeof deviceAuth.lastStatusAt !== "string"
  ) {
    result.errors.push("Invalid device auth: lastStatusAt must be a string");
  }

  if (
    deviceAuth.updatedAt !== undefined &&
    typeof deviceAuth.updatedAt !== "string"
  ) {
    result.errors.push("Invalid device auth: updatedAt must be a string");
  }

  if (
    deviceAuth.lastKnownIp !== undefined &&
    typeof deviceAuth.lastKnownIp !== "string"
  ) {
    result.errors.push("Invalid device auth: lastKnownIp must be a string");
  }

  if (
    deviceAuth.lastConnectedAt !== undefined &&
    typeof deviceAuth.lastConnectedAt !== "string"
  ) {
    result.errors.push("Invalid device auth: lastConnectedAt must be a string");
  }

  if (
    deviceAuth.lastRejectedAt !== undefined &&
    typeof deviceAuth.lastRejectedAt !== "string"
  ) {
    result.errors.push("Invalid device auth: lastRejectedAt must be a string");
  }

  if (
    deviceAuth.lastRejectedIp !== undefined &&
    typeof deviceAuth.lastRejectedIp !== "string"
  ) {
    result.errors.push("Invalid device auth: lastRejectedIp must be a string");
  }

  if (
    deviceAuth.lastRejectedReason !== undefined &&
    typeof deviceAuth.lastRejectedReason !== "string"
  ) {
    result.errors.push(
      "Invalid device auth: lastRejectedReason must be a string"
    );
  }

  if (
    deviceAuth.reloadVersion !== undefined &&
    !Number.isInteger(deviceAuth.reloadVersion)
  ) {
    result.errors.push("Invalid device auth: reloadVersion must be an integer");
  }

  if (deviceAuth.clients !== undefined) {
    if (!Array.isArray(deviceAuth.clients)) {
      result.errors.push("Invalid device auth: clients must be an array");
    } else {
      let pairedClientCount = 0;
      let authorizedClientCount = 0;

      deviceAuth.clients.forEach((client, index) => {
        const clientPath = `device auth.clients[${index}]`;

        if (!isPlainObject(client)) {
          result.errors.push(`Invalid ${clientPath}: expected an object`);
          return;
        }

        if (typeof client.clientId !== "string") {
          result.errors.push(`Invalid ${clientPath}.clientId: must be a string`);
        }

        if (
          client.lastSeenAt !== undefined &&
          typeof client.lastSeenAt !== "string"
        ) {
          result.errors.push(`Invalid ${clientPath}.lastSeenAt: must be a string`);
        }

        if (
          client.lastAuthenticatedAt !== undefined &&
          typeof client.lastAuthenticatedAt !== "string"
        ) {
          result.errors.push(
            `Invalid ${clientPath}.lastAuthenticatedAt: must be a string`
          );
        }

        if (!ALLOWED_CLIENT_ACCESS_STATES.has(client.accessState)) {
          result.errors.push(
            `Invalid ${clientPath}.accessState: must be authorized, pending, auth_mismatch, revoked, or not_paired`
          );
        }

        if (client.accessState === "authorized") {
          authorizedClientCount += 1;
        }

        if (typeof client.isPairedClient !== "boolean") {
          result.errors.push(
            `Invalid ${clientPath}.isPairedClient: must be a boolean`
          );
        } else if (client.isPairedClient) {
          pairedClientCount += 1;

          if (client.accessState !== "authorized") {
            result.errors.push(
              `Invalid ${clientPath}: paired client must use accessState "authorized"`
            );
          }
        }

        if (
          client.userAgent !== undefined &&
          typeof client.userAgent !== "string"
        ) {
          result.errors.push(`Invalid ${clientPath}.userAgent: must be a string`);
        }

        if (
          client.lastKnownIp !== undefined &&
          typeof client.lastKnownIp !== "string"
        ) {
          result.errors.push(`Invalid ${clientPath}.lastKnownIp: must be a string`);
        }
      });

      if (pairedClientCount > 1) {
        result.errors.push(
          "Invalid device auth: only one client may have isPairedClient=true"
        );
      }

      if (pairedClientCount === 0 && authorizedClientCount > 0) {
        result.errors.push(
          'Invalid device auth: authorized client requires one isPairedClient=true entry'
        );
      }
    }
  }

  return result;
}

function validateBox(box) {
  const result = createResult();

  if (!isPlainObject(box)) {
    result.errors.push("Invalid box: expected an object");
    return result;
  }

  if (typeof box.name !== "string") {
    result.errors.push("Invalid box: name must be a string");
  }

  if (typeof box.url !== "string") {
    result.errors.push("Invalid box: url must be a string");
  }

  if (typeof box.zoom !== "number") {
    result.errors.push("Invalid box: zoom must be a number");
  }

  return result;
}

function validateLayoutOptions(options) {
  const result = createResult();

  if (!isPlainObject(options)) {
    result.errors.push("Invalid layout: options must be an object");
    return result;
  }

  ["showHeader", "showStatus", "showLayoutTitle"].forEach((key) => {
    if (options[key] !== undefined && typeof options[key] !== "boolean") {
      result.errors.push(`Invalid layout.options.${key}: must be a boolean`);
    }
  });

  return result;
}

function validateStructureNode(node, boxNames, path = "structure") {
  const result = createResult();

  if (!isPlainObject(node)) {
    result.errors.push(`Invalid ${path}: expected an object`);
    return result;
  }

  if (!["row", "column", "box"].includes(node.type)) {
    result.errors.push(`Invalid ${path}.type: must be row, column, or box`);
    return result;
  }

  if (node.size !== undefined && typeof node.size !== "string") {
    result.errors.push(`Invalid ${path}.size: must be a string`);
  } else if (typeof node.size === "string" && !isValidSize(node.size)) {
    result.errors.push(
      `Invalid ${path}.size: must use %, px, or fr units`
    );
  }

  if (node.type === "box") {
    if (node.gap !== undefined) {
      result.errors.push(`Invalid ${path}.gap: box nodes must not define gap`);
    }

    if (typeof node.box !== "string") {
      result.errors.push(`Invalid ${path}.box: must be a string`);
    } else if (!boxNames.has(node.box)) {
      result.errors.push(
        `Invalid ${path}.box: references unknown box "${node.box}"`
      );
    }

    if (node.children !== undefined) {
      result.errors.push(`Invalid ${path}: box nodes must not have children`);
    }

    return result;
  }

  if (node.gap !== undefined && typeof node.gap !== "string") {
    result.errors.push(`Invalid ${path}.gap: must be a string`);
  } else if (typeof node.gap === "string" && !isValidGap(node.gap)) {
    result.errors.push(`Invalid ${path}.gap: must be a pixel value`);
  }

  if (!Array.isArray(node.children) || node.children.length === 0) {
    result.errors.push(`Invalid ${path}: ${node.type} nodes must have children`);
    return result;
  }

  if (node.box !== undefined) {
    result.errors.push(`Invalid ${path}: ${node.type} nodes must not define box`);
  }

  let percentageTotal = 0;
  let percentageCount = 0;

  node.children.forEach((child, index) => {
    const childPath = `${path}.children[${index}]`;
    const childResult = validateStructureNode(child, boxNames, childPath);
    mergeResult(result, childResult);

    if (typeof child.size === "string" && child.size.endsWith("%")) {
      percentageCount += 1;
      percentageTotal += Number.parseFloat(child.size.slice(0, -1));
    }
  });

  if (percentageCount > 0 && Math.abs(percentageTotal - 100) > 0.01) {
    result.warnings.push(
      `Warning ${path}: percentage sizes sum to ${percentageTotal}% instead of 100%`
    );
  }

  return result;
}

function validateLayout(layout) {
  const result = createResult();

  if (!isPlainObject(layout)) {
    result.errors.push("Invalid layout: expected an object");
    return result;
  }

  if (typeof layout.layoutId !== "string") {
    result.errors.push("Invalid layout: layoutId must be a string");
  }

  if (layout.layoutVersion === undefined) {
    result.errors.push("Invalid layout: layoutVersion is required");
  } else if (!Number.isInteger(layout.layoutVersion)) {
    result.errors.push("Invalid layout: layoutVersion must be an integer");
  }

  if (layout.options !== undefined) {
    mergeResult(result, validateLayoutOptions(layout.options));
  }

  if (!isPlainObject(layout.structure)) {
    result.errors.push("Invalid layout: structure must be an object");
  }

  if (!Array.isArray(layout.boxes)) {
    result.errors.push("Invalid layout: boxes must be an array");
    return result;
  }

  const boxNames = new Set();

  layout.boxes.forEach((box, index) => {
    const boxResult = validateBox(box);

    boxResult.errors = boxResult.errors.map(
      (message) => `${message} at boxes[${index}]`
    );

    mergeResult(result, boxResult);

    if (typeof box?.name === "string") {
      boxNames.add(box.name);
    }
  });

  if (isPlainObject(layout.structure)) {
    const structureResult = validateStructureNode(layout.structure, boxNames);
    mergeResult(result, structureResult);
  }

  if (result.errors.length > 0) {
    return result;
  }

  const usedBoxes = new Set();

  collectUsedBoxes(layout.structure, usedBoxes);

  layout.boxes.forEach((box) => {
    if (!usedBoxes.has(box.name)) {
      result.warnings.push(`Warning boxes: "${box.name}" is unused`);
    }
  });

  return result;
}

function collectUsedBoxes(node, usedBoxes) {
  if (!isPlainObject(node)) {
    return;
  }

  if (node.type === "box" && typeof node.box === "string") {
    usedBoxes.add(node.box);
    return;
  }

  if (!Array.isArray(node.children)) {
    return;
  }

  node.children.forEach((child) => collectUsedBoxes(child, usedBoxes));
}

function assertValid(result, subject) {
  if (result.errors.length === 0) {
    return;
  }

  throw createValidationError(
    `Invalid ${subject}: ${result.errors.join("; ")}`
  );
}

module.exports = {
  assertValid,
  validateBox,
  validateDevice,
  validateDeviceAuth,
  validateLayout
};
