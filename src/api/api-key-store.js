const fs = require("fs/promises");
const path = require("path");

const dataRoot = path.join(__dirname, "..", "..", "data");
const apiKeysDir = path.join(dataRoot, "apikeys");
const VALID_MODES = new Set(["readonly", "control"]);

let cachedApiKeyConfig = null;

function createConfigError(code, message, details = {}) {
  return {
    code,
    details,
    message
  };
}

function validateStringField(value, fieldName, errors) {
  if (typeof value !== "string" || value.trim() === "") {
    errors.push(`${fieldName} must be a non-empty string`);
    return "";
  }

  return value.trim();
}

function validateStringArrayField(value, fieldName, errors) {
  if (!Array.isArray(value)) {
    errors.push(`${fieldName} must be an array of strings`);
    return [];
  }

  const invalidIndex = value.findIndex(
    (entry) => typeof entry !== "string" || entry.trim() === ""
  );

  if (invalidIndex >= 0) {
    errors.push(`${fieldName} must contain only non-empty strings`);
    return [];
  }

  return value.map((entry) => entry.trim());
}

function validateApiKeyRecord(candidate, fileName) {
  const errors = [];

  if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) {
    return {
      errors: ["API key file must contain a JSON object"],
      record: null
    };
  }

  const name = validateStringField(candidate.name, "name", errors);
  const key = validateStringField(candidate.key, "key", errors);
  const mode = validateStringField(candidate.mode, "mode", errors);
  const allowedDevices = validateStringArrayField(
    candidate.allowedDevices,
    "allowedDevices",
    errors
  );
  const allowedLayouts = validateStringArrayField(
    candidate.allowedLayouts,
    "allowedLayouts",
    errors
  );

  if (mode && !VALID_MODES.has(mode)) {
    errors.push("mode must be readonly or control");
  }

  if (errors.length > 0) {
    return { errors, record: null };
  }

  return {
    errors: [],
    record: {
      allowedDevices,
      allowedLayouts,
      fileName,
      key,
      mode,
      name
    }
  };
}

function logApiKeyConfigError(error) {
  console.warn("[simple-api]", JSON.stringify(error));
}

async function readApiKeyFile(fileName) {
  const filePath = path.join(apiKeysDir, fileName);
  const rawContent = await fs.readFile(filePath, "utf8");

  try {
    return JSON.parse(rawContent);
  } catch (error) {
    throw createConfigError("api_key_config_invalid", "API key JSON is invalid.", {
      fileName,
      reason: error.message
    });
  }
}

async function loadApiKeyConfig() {
  let entries;

  try {
    entries = await fs.readdir(apiKeysDir, { withFileTypes: true });
  } catch (error) {
    if (error.code === "ENOENT") {
      return {
        errors: [],
        keys: []
      };
    }

    const configError = createConfigError(
      "api_key_config_invalid",
      "API key directory cannot be read.",
      { reason: error.message }
    );
    logApiKeyConfigError(configError);
    return {
      errors: [configError],
      keys: []
    };
  }

  const fileNames = entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
    .map((entry) => entry.name)
    .sort((a, b) => a.localeCompare(b));
  const keys = [];
  const errors = [];

  for (const fileName of fileNames) {
    try {
      const parsed = await readApiKeyFile(fileName);
      const validation = validateApiKeyRecord(parsed, fileName);

      if (validation.errors.length > 0) {
        errors.push(
          createConfigError("api_key_config_invalid", "API key file is invalid.", {
            errors: validation.errors,
            fileName
          })
        );
        continue;
      }

      keys.push(validation.record);
    } catch (error) {
      errors.push(
        error && error.code
          ? error
          : createConfigError("api_key_config_invalid", "API key file cannot be read.", {
              fileName,
              reason: error.message
            })
      );
    }
  }

  const names = new Map();
  const secretKeys = new Map();

  for (const apiKey of keys) {
    const nameMatches = names.get(apiKey.name) || [];
    nameMatches.push(apiKey.fileName);
    names.set(apiKey.name, nameMatches);

    const keyMatches = secretKeys.get(apiKey.key) || [];
    keyMatches.push({ fileName: apiKey.fileName, name: apiKey.name });
    secretKeys.set(apiKey.key, keyMatches);
  }

  for (const [name, fileNamesForName] of names.entries()) {
    if (fileNamesForName.length > 1) {
      errors.push(
        createConfigError("api_key_config_invalid", "API key name is duplicated.", {
          fileNames: fileNamesForName,
          name
        })
      );
    }
  }

  for (const matches of secretKeys.values()) {
    if (matches.length > 1) {
      errors.push(
        createConfigError("api_key_conflict", "API key secret is duplicated.", {
          apiKeys: matches.map((match) => ({
            fileName: match.fileName,
            name: match.name
          }))
        })
      );
    }
  }

  for (const error of errors) {
    logApiKeyConfigError(error);
  }

  return {
    errors,
    keys
  };
}

async function getApiKeyConfig() {
  if (!cachedApiKeyConfig) {
    cachedApiKeyConfig = await loadApiKeyConfig();
  }

  return cachedApiKeyConfig;
}

function clearApiKeyConfigCache() {
  cachedApiKeyConfig = null;
}

async function findApiKeyBySecret(secret) {
  const config = await getApiKeyConfig();

  if (config.errors.length > 0) {
    return {
      errors: config.errors,
      key: null,
      status: config.errors.some((error) => error.code === "api_key_conflict")
        ? "conflict"
        : "config_invalid"
    };
  }

  const apiKey = config.keys.find((entry) => entry.key === secret) || null;

  return {
    errors: [],
    key: apiKey,
    status: apiKey ? "ok" : "unknown"
  };
}

module.exports = {
  apiKeysDir,
  clearApiKeyConfigCache,
  findApiKeyBySecret,
  loadApiKeyConfig
};
