const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs/promises");
const path = require("path");

const app = require("../src/app");
const { hashAdminPassword } = require("../src/auth/admin-auth");
const {
  apiKeysDir,
  clearApiKeyConfigCache
} = require("../src/api/api-key-store");
const {
  readDevice,
  readLayout,
  writeDevice,
  writeLayout
} = require("../src/storage/json-store");

const devicesDir = path.join(__dirname, "..", "data", "devices");
const layoutsDir = path.join(__dirname, "..", "data", "layouts");
const adminEnvDefaults = {
  ADMIN_PASSWORD_HASH: hashAdminPassword("admin-pass"),
  ADMIN_SESSION_SECRET: "test-admin-session-secret",
  ADMIN_USERNAME: "admin"
};

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
    JSON.stringify(value, null, 2) + "\n"
  );
  clearApiKeyConfigCache();
}

async function readApiKeyFile(fileName) {
  return JSON.parse(await fs.readFile(path.join(apiKeysDir, fileName), "utf8"));
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

async function withAdminEnv(run) {
  const previous = {
    ADMIN_PASSWORD_HASH: process.env.ADMIN_PASSWORD_HASH,
    ADMIN_SESSION_SECRET: process.env.ADMIN_SESSION_SECRET,
    ADMIN_USERNAME: process.env.ADMIN_USERNAME
  };

  Object.assign(process.env, adminEnvDefaults);

  try {
    await run();
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }
}

async function loginAsAdmin(baseUrl) {
  const response = await fetch(`${baseUrl}/admin/login`, {
    body: new URLSearchParams({
      password: "admin-pass",
      username: "admin"
    }),
    headers: {
      "Content-Type": "application/x-www-form-urlencoded"
    },
    method: "POST",
    redirect: "manual"
  });

  assert.equal(response.status, 302);

  return response.headers.get("set-cookie").split(";")[0];
}

function formBody(values) {
  return new URLSearchParams(values).toString();
}

async function postAdminForm(baseUrl, adminCookie, url, values) {
  return fetch(baseUrl + url, {
    body: formBody(values),
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      cookie: adminCookie
    },
    method: "POST"
  });
}

function testLayout(layoutId, description = "API Access Layout") {
  return {
    boxes: [
      {
        name: "box1",
        url: "https://example.com",
        zoom: 1
      }
    ],
    description,
    layoutId,
    layoutVersion: 1,
    options: {},
    structure: {
      box: "box1",
      type: "box"
    }
  };
}

test("admin device API access add/remove updates only API key files", async () => {
  const deviceCode = "admin-api-device";
  const apiKeyFileName = "admin-api-device-access-test.json";
  const deviceFilePath = path.join(devicesDir, `${deviceCode}.json`);

  await removeIfExists(deviceFilePath);
  await removeApiKeyFiles([apiKeyFileName]);

  try {
    await writeDevice(deviceCode, {
      description: "Admin API Device",
      deviceCode,
      status: "approved"
    });
    await writeApiKeyFile(apiKeyFileName, {
      allowedDevices: [],
      allowedLayouts: [],
      key: "admin-device-secret-" + "x".repeat(32),
      mode: "control",
      name: "admin-device-key"
    });
    const deviceBefore = await readDevice(deviceCode);

    await withAdminEnv(async () => {
      await withServer(async (baseUrl) => {
        const adminCookie = await loginAsAdmin(baseUrl);
        const addResponse = await postAdminForm(
          baseUrl,
          adminCookie,
          `/admin/devices/${deviceCode}/api-access`,
          { apiKeyName: "admin-device-key", intent: "add" }
        );
        const duplicateAddResponse = await postAdminForm(
          baseUrl,
          adminCookie,
          `/admin/devices/${deviceCode}/api-access`,
          { apiKeyName: "admin-device-key", intent: "add" }
        );
        let apiKey = await readApiKeyFile(apiKeyFileName);

        assert.equal(addResponse.status, 200);
        assert.equal(duplicateAddResponse.status, 200);
        assert.deepEqual(apiKey.allowedDevices, [deviceCode]);
        assert.deepEqual(await readDevice(deviceCode), deviceBefore);

        const removeResponse = await postAdminForm(
          baseUrl,
          adminCookie,
          `/admin/devices/${deviceCode}/api-access`,
          { apiKeyName: "admin-device-key", intent: "remove" }
        );
        apiKey = await readApiKeyFile(apiKeyFileName);

        assert.equal(removeResponse.status, 200);
        assert.deepEqual(apiKey.allowedDevices, []);
        assert.deepEqual(await readDevice(deviceCode), deviceBefore);
      });
    });
  } finally {
    await removeIfExists(deviceFilePath);
    await removeApiKeyFiles([apiKeyFileName]);
  }
});

test("admin layout API access add/remove updates only API key files", async () => {
  const layoutId = "admin-api-layout";
  const apiKeyFileName = "admin-api-layout-access-test.json";
  const layoutFilePath = path.join(layoutsDir, `${layoutId}.json`);

  await removeIfExists(layoutFilePath);
  await removeApiKeyFiles([apiKeyFileName]);

  try {
    await writeLayout(layoutId, testLayout(layoutId));
    await writeApiKeyFile(apiKeyFileName, {
      allowedDevices: [],
      allowedLayouts: [],
      key: "admin-layout-secret-" + "x".repeat(32),
      mode: "readonly",
      name: "admin-layout-key"
    });
    const layoutBefore = await readLayout(layoutId);

    await withAdminEnv(async () => {
      await withServer(async (baseUrl) => {
        const adminCookie = await loginAsAdmin(baseUrl);
        const addResponse = await postAdminForm(
          baseUrl,
          adminCookie,
          `/admin/layouts/${layoutId}/api-access`,
          { apiKeyName: "admin-layout-key", intent: "add" }
        );
        const duplicateAddResponse = await postAdminForm(
          baseUrl,
          adminCookie,
          `/admin/layouts/${layoutId}/api-access`,
          { apiKeyName: "admin-layout-key", intent: "add" }
        );
        let apiKey = await readApiKeyFile(apiKeyFileName);

        assert.equal(addResponse.status, 200);
        assert.equal(duplicateAddResponse.status, 200);
        assert.deepEqual(apiKey.allowedLayouts, [layoutId]);
        assert.deepEqual(await readLayout(layoutId), layoutBefore);

        const removeResponse = await postAdminForm(
          baseUrl,
          adminCookie,
          `/admin/layouts/${layoutId}/api-access`,
          { apiKeyName: "admin-layout-key", intent: "remove" }
        );
        apiKey = await readApiKeyFile(apiKeyFileName);

        assert.equal(removeResponse.status, 200);
        assert.deepEqual(apiKey.allowedLayouts, []);
        assert.deepEqual(await readLayout(layoutId), layoutBefore);
      });
    });
  } finally {
    await removeIfExists(layoutFilePath);
    await removeApiKeyFiles([apiKeyFileName]);
  }
});

test("admin API access reports unknown API key names cleanly", async () => {
  const deviceCode = "admin-api-unknown";
  const apiKeyFileName = "admin-api-unknown-test.json";
  const deviceFilePath = path.join(devicesDir, `${deviceCode}.json`);

  await removeIfExists(deviceFilePath);
  await removeApiKeyFiles([apiKeyFileName]);

  try {
    await writeDevice(deviceCode, {
      description: "Unknown API Device",
      deviceCode,
      status: "approved"
    });
    await writeApiKeyFile(apiKeyFileName, {
      allowedDevices: [],
      allowedLayouts: [],
      key: "admin-unknown-secret-" + "x".repeat(32),
      mode: "readonly",
      name: "known-admin-key"
    });

    await withAdminEnv(async () => {
      await withServer(async (baseUrl) => {
        const adminCookie = await loginAsAdmin(baseUrl);
        const response = await postAdminForm(
          baseUrl,
          adminCookie,
          `/admin/devices/${deviceCode}/api-access`,
          { apiKeyName: "missing-admin-key", intent: "add" }
        );
        const body = await response.text();
        const apiKey = await readApiKeyFile(apiKeyFileName);

        assert.equal(response.status, 400);
        assert.match(body, /Unknown API key name/);
        assert.deepEqual(apiKey.allowedDevices, []);
      });
    });
  } finally {
    await removeIfExists(deviceFilePath);
    await removeApiKeyFiles([apiKeyFileName]);
  }
});

test("admin detail pages render API key names without exposing secret values", async () => {
  const deviceCode = "admin-api-render-device";
  const layoutId = "admin-api-render-layout";
  const apiKeyFileName = "admin-api-render-secret-test.json";
  const deviceFilePath = path.join(devicesDir, `${deviceCode}.json`);
  const layoutFilePath = path.join(layoutsDir, `${layoutId}.json`);
  const secret = "render-secret-value-" + "x".repeat(32);

  await removeIfExists(deviceFilePath);
  await removeIfExists(layoutFilePath);
  await removeApiKeyFiles([apiKeyFileName]);

  try {
    await writeDevice(deviceCode, {
      description: "Render API Device",
      deviceCode,
      layoutId,
      status: "approved"
    });
    await writeLayout(layoutId, testLayout(layoutId, "Render API Layout"));
    await writeApiKeyFile(apiKeyFileName, {
      allowedDevices: [deviceCode],
      allowedLayouts: [layoutId],
      key: secret,
      mode: "control",
      name: "render-admin-key"
    });

    await withAdminEnv(async () => {
      await withServer(async (baseUrl) => {
        const adminCookie = await loginAsAdmin(baseUrl);
        const deviceResponse = await fetch(`${baseUrl}/admin/devices/${deviceCode}`, {
          headers: { cookie: adminCookie }
        });
        const layoutResponse = await fetch(`${baseUrl}/admin/layouts/${layoutId}`, {
          headers: { cookie: adminCookie }
        });
        const deviceBody = await deviceResponse.text();
        const layoutBody = await layoutResponse.text();

        assert.equal(deviceResponse.status, 200);
        assert.equal(layoutResponse.status, 200);
        assert.match(deviceBody, /render-admin-key/);
        assert.match(layoutBody, /render-admin-key/);
        assert.doesNotMatch(deviceBody, new RegExp(secret));
        assert.doesNotMatch(layoutBody, new RegExp(secret));
      });
    });
  } finally {
    await removeIfExists(deviceFilePath);
    await removeIfExists(layoutFilePath);
    await removeApiKeyFiles([apiKeyFileName]);
  }
});
