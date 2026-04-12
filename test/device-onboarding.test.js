const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs/promises");
const path = require("path");

const app = require("../src/app");
const { hashDeviceSecret } = require("../src/auth/device-auth");
const {
  listDeviceCodes,
  readDevice,
  readDeviceAuth,
  updateDeviceAuth,
  writeDevice
} = require("../src/storage/json-store");

const devicesDir = path.join(__dirname, "..", "data", "devices");
const deviceAuthDir = path.join(__dirname, "..", "data", "device-auth");

async function removeIfExists(filePath) {
  try {
    await fs.unlink(filePath);
  } catch (error) {
    if (error.code !== "ENOENT") {
      throw error;
    }
  }
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

test("unknown device page does not create a device record", async () => {
  const deviceCode = "zzzzzzzx";
  const deviceFilePath = path.join(devicesDir, `${deviceCode}.json`);
  const deviceAuthFilePath = path.join(deviceAuthDir, `${deviceCode}.json`);

  await removeIfExists(deviceFilePath);
  await removeIfExists(deviceAuthFilePath);

  await withServer(async (baseUrl) => {
    const response = await fetch(`${baseUrl}/d/${deviceCode}`);
    const body = await response.text();

    assert.equal(response.status, 404);
    assert.match(body, /Unknown device/);
  });

  await assert.rejects(fs.access(deviceFilePath));
  await assert.rejects(fs.access(deviceAuthFilePath));
});

test("unknown device auth does not create pairing records", async () => {
  const deviceCode = "zzzzzzzy";
  const deviceFilePath = path.join(devicesDir, `${deviceCode}.json`);
  const deviceAuthFilePath = path.join(deviceAuthDir, `${deviceCode}.json`);

  await removeIfExists(deviceFilePath);
  await removeIfExists(deviceAuthFilePath);

  await withServer(async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/device/${deviceCode}/auth`, {
      body: JSON.stringify({ deviceSecret: "secret-alpha" }),
      headers: {
        "Content-Type": "application/json"
      },
      method: "POST"
    });
    const payload = await response.json();

    assert.equal(response.status, 404);
    assert.deepEqual(payload, { status: "unknown_device" });
  });

  await assert.rejects(fs.access(deviceFilePath));
  await assert.rejects(fs.access(deviceAuthFilePath));
});

test("device status endpoint returns unknown for missing devices", async () => {
  const deviceCode = "zzzzzzzw";

  await withServer(async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/device/${deviceCode}/status`);
    const payload = await response.json();

    assert.equal(response.status, 404);
    assert.deepEqual(payload, {
      authorized: false,
      deviceCode,
      layoutId: null,
      status: "unknown"
    });
  });
});

test("device status endpoint returns pending and revoked for non-approved devices", async () => {
  const pendingCode = "statuspd";
  const revokedCode = "statusrv";
  const pendingFilePath = path.join(devicesDir, `${pendingCode}.json`);
  const revokedFilePath = path.join(devicesDir, `${revokedCode}.json`);

  await removeIfExists(pendingFilePath);
  await removeIfExists(revokedFilePath);

  try {
    await writeDevice(pendingCode, {
      deviceCode: pendingCode,
      layoutId: "layout-1",
      status: "pending"
    });
    await writeDevice(revokedCode, {
      deviceCode: revokedCode,
      layoutId: "layout-2",
      status: "revoked"
    });

    await withServer(async (baseUrl) => {
      const pendingResponse = await fetch(
        `${baseUrl}/api/device/${pendingCode}/status`
      );
      const revokedResponse = await fetch(
        `${baseUrl}/api/device/${revokedCode}/status`
      );

      assert.deepEqual(await pendingResponse.json(), {
        authorized: false,
        deviceCode: pendingCode,
        layoutId: "layout-1",
        status: "pending"
      });
      assert.deepEqual(await revokedResponse.json(), {
        authorized: false,
        deviceCode: revokedCode,
        layoutId: "layout-2",
        status: "revoked"
      });
    });
  } finally {
    await removeIfExists(pendingFilePath);
    await removeIfExists(revokedFilePath);
  }
});

test("device status endpoint reports authorization and layout for approved devices", async () => {
  const deviceCode = "statusok1";
  const deviceFilePath = path.join(devicesDir, `${deviceCode}.json`);
  const deviceAuthFilePath = path.join(deviceAuthDir, `${deviceCode}.json`);

  await removeIfExists(deviceFilePath);
  await removeIfExists(deviceAuthFilePath);

  try {
    await writeDevice(deviceCode, {
      deviceCode,
      layoutId: "layout-2",
      status: "approved"
    });
    await updateDeviceAuth(deviceCode, {
      deviceCode,
      secretHash: hashDeviceSecret("secret-alpha"),
      updatedAt: "2026-04-12T00:00:00.000Z"
    });

    await withServer(async (baseUrl) => {
      const unauthorizedResponse = await fetch(
        `${baseUrl}/api/device/${deviceCode}/status`
      );

      assert.deepEqual(await unauthorizedResponse.json(), {
        authorized: false,
        deviceCode,
        layoutId: "layout-2",
        status: "approved"
      });

      const authResponse = await fetch(`${baseUrl}/api/device/${deviceCode}/auth`, {
        body: JSON.stringify({ deviceSecret: "secret-alpha" }),
        headers: {
          "Content-Type": "application/json"
        },
        method: "POST"
      });
      const cookieHeader = authResponse.headers.get("set-cookie");

      assert.equal(authResponse.status, 200);
      assert.match(cookieHeader, /mydashmaster_device=/);

      const authorizedResponse = await fetch(
        `${baseUrl}/api/device/${deviceCode}/status`,
        {
          headers: {
            Cookie: cookieHeader.split(";")[0]
          }
        }
      );

      assert.deepEqual(await authorizedResponse.json(), {
        authorized: true,
        deviceCode,
        layoutId: "layout-2",
        status: "approved"
      });
    });
  } finally {
    await removeIfExists(deviceFilePath);
    await removeIfExists(deviceAuthFilePath);
  }
});

test("admin can create a pending device with an 8 character generated code", async () => {
  const beforeCodes = new Set(await listDeviceCodes());
  let createdDeviceCode = null;

  try {
    await withServer(async (baseUrl) => {
      const response = await fetch(`${baseUrl}/admin/devices`, {
        body: new URLSearchParams({ layoutId: "" }),
        headers: {
          "Content-Type": "application/x-www-form-urlencoded"
        },
        method: "POST",
        redirect: "manual"
      });

      assert.equal(response.status, 302);
    });

    const afterCodes = await listDeviceCodes();
    const newCodes = afterCodes.filter((deviceCode) => !beforeCodes.has(deviceCode));

    assert.equal(newCodes.length, 1);

    createdDeviceCode = newCodes[0];

    assert.match(createdDeviceCode, /^[a-z0-9]{8}$/);

    const device = await readDevice(createdDeviceCode);

    assert.deepEqual(device, {
      deviceCode: createdDeviceCode,
      status: "pending"
    });
  } finally {
    if (createdDeviceCode) {
      await removeIfExists(path.join(devicesDir, `${createdDeviceCode}.json`));
      await removeIfExists(path.join(deviceAuthDir, `${createdDeviceCode}.json`));
    }
  }
});

test("known pending device auth stores last connection metadata", async () => {
  const deviceCode = "knownmet";
  const deviceFilePath = path.join(devicesDir, `${deviceCode}.json`);
  const deviceAuthFilePath = path.join(deviceAuthDir, `${deviceCode}.json`);

  await removeIfExists(deviceFilePath);
  await removeIfExists(deviceAuthFilePath);

  try {
    await writeDevice(deviceCode, {
      deviceCode,
      status: "pending"
    });

    await withServer(async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/device/${deviceCode}/auth`, {
        body: JSON.stringify({ deviceSecret: "secret-alpha" }),
        headers: {
          "Content-Type": "application/json",
          "X-Forwarded-For": "203.0.113.7"
        },
        method: "POST"
      });
      const payload = await response.json();

      assert.equal(response.status, 200);
      assert.deepEqual(payload, { status: "pending" });
    });

    const deviceAuth = await readDeviceAuth(deviceCode);

    assert.equal(deviceAuth.lastKnownIp, "203.0.113.7");
    assert.match(deviceAuth.lastConnectedAt, /^\d{4}-\d{2}-\d{2}T/);
    assert.match(deviceAuth.candidateSecretHash, /^[a-f0-9]{64}$/);
  } finally {
    await removeIfExists(deviceFilePath);
    await removeIfExists(deviceAuthFilePath);
  }
});

test("successful authorized device page access updates activity metadata", async () => {
  const deviceCode = "accessok1";
  const deviceFilePath = path.join(devicesDir, `${deviceCode}.json`);
  const deviceAuthFilePath = path.join(deviceAuthDir, `${deviceCode}.json`);

  await removeIfExists(deviceFilePath);
  await removeIfExists(deviceAuthFilePath);

  try {
    await writeDevice(deviceCode, {
      deviceCode,
      status: "approved"
    });

    await withServer(async (baseUrl) => {
      const authResponse = await fetch(`${baseUrl}/api/device/${deviceCode}/auth`, {
        body: JSON.stringify({ deviceSecret: "secret-alpha" }),
        headers: {
          "Content-Type": "application/json",
          "X-Forwarded-For": "198.51.100.10"
        },
        method: "POST"
      });
      const authPayload = await authResponse.json();

      assert.equal(authResponse.status, 401);
      assert.deepEqual(authPayload, { status: "unauthorized" });

      await updateDeviceAuth(deviceCode, {
        deviceCode,
        lastConnectedAt: "2026-04-12T00:00:00.000Z",
        lastKnownIp: "198.51.100.1",
        secretHash: hashDeviceSecret("secret-alpha"),
        updatedAt: "2026-04-12T00:00:00.000Z"
      });

      const pairingResponse = await fetch(`${baseUrl}/api/device/${deviceCode}/auth`, {
        body: JSON.stringify({ deviceSecret: "secret-alpha" }),
        headers: {
          "Content-Type": "application/json",
          "X-Forwarded-For": "198.51.100.10"
        },
        method: "POST"
      });

      assert.equal(pairingResponse.status, 200);
      assert.deepEqual(await pairingResponse.json(), { status: "approved" });

      const cookieHeader = pairingResponse.headers.get("set-cookie");

      assert.match(cookieHeader, /mydashmaster_device=/);

      const beforePageAccess = await readDeviceAuth(deviceCode);

      const pageResponse = await fetch(`${baseUrl}/d/${deviceCode}`, {
        headers: {
          Cookie: cookieHeader.split(";")[0],
          "X-Forwarded-For": "198.51.100.20"
        }
      });

      assert.equal(pageResponse.status, 200);

      const afterPageAccess = await readDeviceAuth(deviceCode);

      assert.equal(afterPageAccess.lastKnownIp, "198.51.100.20");
      assert.match(afterPageAccess.lastConnectedAt, /^\d{4}-\d{2}-\d{2}T/);
      assert.notEqual(
        afterPageAccess.lastConnectedAt,
        beforePageAccess.lastConnectedAt
      );
    });
  } finally {
    await removeIfExists(deviceFilePath);
    await removeIfExists(deviceAuthFilePath);
  }
});

test("failed device page access does not update activity metadata", async () => {
  const deviceCode = "accessbad";
  const deviceFilePath = path.join(devicesDir, `${deviceCode}.json`);
  const deviceAuthFilePath = path.join(deviceAuthDir, `${deviceCode}.json`);

  await removeIfExists(deviceFilePath);
  await removeIfExists(deviceAuthFilePath);

  try {
    await writeDevice(deviceCode, {
      deviceCode,
      status: "approved"
    });
    await updateDeviceAuth(deviceCode, {
      deviceCode,
      lastConnectedAt: "2026-04-12T00:00:00.000Z",
      lastKnownIp: "198.51.100.30",
      secretHash: hashDeviceSecret("secret-alpha"),
      updatedAt: "2026-04-12T00:00:00.000Z"
    });

    await withServer(async (baseUrl) => {
      const response = await fetch(`${baseUrl}/d/${deviceCode}`, {
        headers: {
          "X-Forwarded-For": "198.51.100.40"
        }
      });

      assert.equal(response.status, 200);
      assert.match(await response.text(), /Access pending/);
    });

    const deviceAuth = await readDeviceAuth(deviceCode);

    assert.equal(deviceAuth.lastKnownIp, "198.51.100.30");
    assert.equal(deviceAuth.lastConnectedAt, "2026-04-12T00:00:00.000Z");
  } finally {
    await removeIfExists(deviceFilePath);
    await removeIfExists(deviceAuthFilePath);
  }
});

test("admin delete removes both device and auth files", async () => {
  const deviceCode = "deltest1";
  const deviceFilePath = path.join(devicesDir, `${deviceCode}.json`);
  const deviceAuthFilePath = path.join(deviceAuthDir, `${deviceCode}.json`);

  await removeIfExists(deviceFilePath);
  await removeIfExists(deviceAuthFilePath);

  try {
    await writeDevice(deviceCode, {
      deviceCode,
      status: "pending"
    });
    await updateDeviceAuth(deviceCode, {
      candidateSecretHash: "a".repeat(64),
      deviceCode,
      lastConnectedAt: "2026-04-12T00:00:00.000Z",
      lastKnownIp: "203.0.113.9",
      updatedAt: "2026-04-12T00:00:00.000Z"
    });

    await withServer(async (baseUrl) => {
      const response = await fetch(`${baseUrl}/admin/devices/${deviceCode}/delete`, {
        method: "POST",
        redirect: "manual"
      });

      assert.equal(response.status, 302);
    });

    await assert.rejects(fs.access(deviceFilePath));
    await assert.rejects(fs.access(deviceAuthFilePath));
  } finally {
    await removeIfExists(deviceFilePath);
    await removeIfExists(deviceAuthFilePath);
  }
});
