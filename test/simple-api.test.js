const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs/promises");
const path = require("path");

const app = require("../src/app");
const {
  apiKeysDir,
  clearApiKeyConfigCache
} = require("../src/api/api-key-store");
const { writeDevice, writeLayout } = require("../src/storage/json-store");

const devicesDir = path.join(__dirname, "..", "data", "devices");
const layoutsDir = path.join(__dirname, "..", "data", "layouts");
const apiSecret = "test-api-key-" + "x".repeat(32);

async function removeIfExists(filePath) {
  try {
    await fs.unlink(filePath);
  } catch (error) {
    if (error.code !== "ENOENT") {
      throw error;
    }
  }
}

async function writeApiKeyFile(fileName, value) {
  await fs.mkdir(apiKeysDir, { recursive: true });
  await fs.writeFile(
    path.join(apiKeysDir, fileName),
    typeof value === "string" ? value : JSON.stringify(value, null, 2)
  );
  clearApiKeyConfigCache();
}

async function removeApiKeyFiles(fileNames) {
  await Promise.all(
    fileNames.map((fileName) => removeIfExists(path.join(apiKeysDir, fileName)))
  );
  clearApiKeyConfigCache();
}

async function withServer(run) {
  const server = await new Promise((resolve) => {
    const instance = app.listen(0, () => resolve(instance));
  });

  const address = server.address();
  const baseUrl = `http://127.0.0.1:${address.port}`;

  try {
    await run(baseUrl);
  } finally {
    await new Promise((resolve, reject) => {
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }

        resolve();
      });
    });
  }
}

test("GET /api/v1/list returns allowed devices and layouts without exposing the secret", async () => {
  const deviceCode = "apitest1";
  const layoutId = "api-layout-one";
  const apiKeyFileName = "api-list-success-test.json";
  const deviceFilePath = path.join(devicesDir, `${deviceCode}.json`);
  const layoutFilePath = path.join(layoutsDir, `${layoutId}.json`);

  await removeIfExists(deviceFilePath);
  await removeIfExists(layoutFilePath);
  await removeApiKeyFiles([apiKeyFileName]);

  try {
    await writeDevice(deviceCode, {
      description: "Main Dashboard",
      deviceCode,
      layoutId,
      status: "approved"
    });
    await writeLayout(layoutId, {
      description: "Office",
      layoutId,
      layoutVersion: 1,
      options: {},
      structure: {
        box: "box1",
        type: "box"
      },
      boxes: [
        {
          name: "box1",
          url: "https://example.com",
          zoom: 1
        }
      ]
    });
    await writeApiKeyFile(apiKeyFileName, {
      allowedDevices: [deviceCode, "missing-device-for-api"],
      allowedLayouts: [layoutId, "missing-layout-for-api"],
      key: apiSecret,
      mode: "readonly",
      name: "streamdeck-office-test"
    });

    await withServer(async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/v1/list`, {
        headers: {
          "X-API-Key": apiSecret
        }
      });
      const body = await response.json();

      assert.equal(response.status, 200);
      assert.deepEqual(body, {
        apiKey: "streamdeck-office-test",
        mode: "readonly",
        devices: [
          {
            key: deviceCode,
            name: "Main Dashboard"
          }
        ],
        layouts: [
          {
            key: layoutId,
            name: "Office"
          }
        ]
      });
      assert.doesNotMatch(JSON.stringify(body), new RegExp(apiSecret));
    });
  } finally {
    await removeIfExists(deviceFilePath);
    await removeIfExists(layoutFilePath);
    await removeApiKeyFiles([apiKeyFileName]);
  }
});

test("GET /api/v1/list rejects missing and unknown API keys", async () => {
  const apiKeyFileName = "api-auth-test.json";

  await removeApiKeyFiles([apiKeyFileName]);

  try {
    await writeApiKeyFile(apiKeyFileName, {
      allowedDevices: [],
      allowedLayouts: [],
      key: apiSecret,
      mode: "control",
      name: "auth-test"
    });

    await withServer(async (baseUrl) => {
      const missingResponse = await fetch(`${baseUrl}/api/v1/list`);
      const unknownResponse = await fetch(`${baseUrl}/api/v1/list`, {
        headers: {
          "X-API-Key": "unknown-" + apiSecret
        }
      });

      assert.equal(missingResponse.status, 401);
      assert.equal((await missingResponse.json()).error.code, "api_key_missing");
      assert.equal(unknownResponse.status, 401);
      assert.equal((await unknownResponse.json()).error.code, "api_key_unknown");
    });
  } finally {
    await removeApiKeyFiles([apiKeyFileName]);
  }
});

test("readonly API keys cannot use non-GET methods on /api/v1/list", async () => {
  const apiKeyFileName = "api-readonly-method-test.json";

  await removeApiKeyFiles([apiKeyFileName]);

  try {
    await writeApiKeyFile(apiKeyFileName, {
      allowedDevices: [],
      allowedLayouts: [],
      key: apiSecret,
      mode: "readonly",
      name: "readonly-method-test"
    });

    await withServer(async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/v1/list`, {
        headers: {
          "X-API-Key": apiSecret
        },
        method: "POST"
      });
      const body = await response.json();

      assert.equal(response.status, 403);
      assert.equal(body.error.code, "mode_forbids_method");
    });
  } finally {
    await removeApiKeyFiles([apiKeyFileName]);
  }
});

test("duplicate API key secrets return api_key_conflict", async () => {
  const fileNames = ["api-duplicate-a.json", "api-duplicate-b.json"];

  await removeApiKeyFiles(fileNames);

  try {
    await writeApiKeyFile(fileNames[0], {
      allowedDevices: [],
      allowedLayouts: [],
      key: apiSecret,
      mode: "readonly",
      name: "duplicate-a"
    });
    await writeApiKeyFile(fileNames[1], {
      allowedDevices: [],
      allowedLayouts: [],
      key: apiSecret,
      mode: "control",
      name: "duplicate-b"
    });

    await withServer(async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/v1/list`, {
        headers: {
          "X-API-Key": apiSecret
        }
      });
      const body = await response.json();

      assert.equal(response.status, 500);
      assert.equal(body.error.code, "api_key_conflict");
      assert.doesNotMatch(JSON.stringify(body), new RegExp(apiSecret));
    });
  } finally {
    await removeApiKeyFiles(fileNames);
  }
});

test("duplicate API key names return api_key_config_invalid", async () => {
  const fileNames = ["api-duplicate-name-a.json", "api-duplicate-name-b.json"];

  await removeApiKeyFiles(fileNames);

  try {
    await writeApiKeyFile(fileNames[0], {
      allowedDevices: [],
      allowedLayouts: [],
      key: apiSecret + "-a",
      mode: "readonly",
      name: "duplicate-name"
    });
    await writeApiKeyFile(fileNames[1], {
      allowedDevices: [],
      allowedLayouts: [],
      key: apiSecret + "-b",
      mode: "control",
      name: "duplicate-name"
    });

    await withServer(async (baseUrl) => {
      const response = await fetch(baseUrl + "/api/v1/list", {
        headers: {
          "X-API-Key": apiSecret + "-a"
        }
      });
      const body = await response.json();

      assert.equal(response.status, 500);
      assert.equal(body.error.code, "api_key_config_invalid");
    });
  } finally {
    await removeApiKeyFiles(fileNames);
  }
});

test("unknown API key mode returns api_key_config_invalid", async () => {
  const apiKeyFileName = "api-unknown-mode-test.json";

  await removeApiKeyFiles([apiKeyFileName]);

  try {
    await writeApiKeyFile(apiKeyFileName, {
      allowedDevices: [],
      allowedLayouts: [],
      key: apiSecret,
      mode: "superuser",
      name: "unknown-mode-test"
    });

    await withServer(async (baseUrl) => {
      const response = await fetch(baseUrl + "/api/v1/list", {
        headers: {
          "X-API-Key": apiSecret
        }
      });
      const body = await response.json();

      assert.equal(response.status, 500);
      assert.equal(body.error.code, "api_key_config_invalid");
    });
  } finally {
    await removeApiKeyFiles([apiKeyFileName]);
  }
});

test("invalid API key files return api_key_config_invalid without blocking app startup", async () => {
  const apiKeyFileName = "api-invalid-config-test.json";

  await removeApiKeyFiles([apiKeyFileName]);

  try {
    await writeApiKeyFile(apiKeyFileName, "{not-json");

    await withServer(async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/v1/list`, {
        headers: {
          "X-API-Key": apiSecret
        }
      });
      const homeResponse = await fetch(baseUrl);
      const body = await response.json();

      assert.equal(response.status, 500);
      assert.equal(body.error.code, "api_key_config_invalid");
      assert.notEqual(homeResponse.status, 500);
    });
  } finally {
    await removeApiKeyFiles([apiKeyFileName]);
  }
});
