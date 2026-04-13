const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs/promises");
const path = require("path");

const app = require("../src/app");
const { hashAdminPassword } = require("../src/auth/admin-auth");
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

  const cookieHeader = response.headers.get("set-cookie");

  assert.match(cookieHeader, /mydashmaster_admin=/);

  return cookieHeader.split(";")[0];
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

test("true pending page keeps bootstrap and status checks active", async () => {
  const deviceCode = "pending01";
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
      const response = await fetch(`${baseUrl}/d/${deviceCode}`);
      const body = await response.text();

      assert.equal(response.status, 200);
      assert.match(body, /Access pending/);
      assert.match(body, /\/api\/device\/pending01\/auth/);
      assert.match(body, /\/api\/device\/pending01\/status/);
      assert.match(body, /const currentAccessState = "pending"/);
      assert.match(body, /setInterval\(checkPendingState, pollIntervalMs\)/);
      assert.doesNotMatch(body, /statusPayload\.status !== "pending"/);
    });
  } finally {
    await removeIfExists(deviceFilePath);
    await removeIfExists(deviceAuthFilePath);
  }
});

test("approved device without secretHash shows not paired state", async () => {
  const deviceCode = "notpair1";
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
      const response = await fetch(`${baseUrl}/d/${deviceCode}`);
      const body = await response.text();

      assert.equal(response.status, 200);
      assert.match(body, /Device not paired/);
      assert.match(body, /\/api\/device\/notpair1\/auth/);
      assert.match(body, /\/api\/device\/notpair1\/status/);
      assert.match(body, /const currentAccessState = "not_paired"/);
    });
  } finally {
    await removeIfExists(deviceFilePath);
    await removeIfExists(deviceAuthFilePath);
  }
});

test("approved device with invalid session shows auth mismatch and records diagnostics", async () => {
  const deviceCode = "mismatch";
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
      secretHash: hashDeviceSecret("secret-alpha"),
      updatedAt: "2026-04-12T00:00:00.000Z"
    });

    await withServer(async (baseUrl) => {
      const response = await fetch(`${baseUrl}/d/${deviceCode}`, {
        headers: {
          "X-Forwarded-For": "203.0.113.44"
        }
      });
      const body = await response.text();

      assert.equal(response.status, 200);
      assert.match(body, /Access not available in this browser/);
      assert.match(body, /already linked to another browser session/);
      assert.match(body, /\/api\/device\/mismatch\/status/);
      assert.match(body, /const currentAccessState = "auth_mismatch"/);
      assert.match(body, /if \(false\)/);
    });

    const deviceAuth = await readDeviceAuth(deviceCode);

    assert.equal(deviceAuth.lastRejectedIp, "203.0.113.44");
    assert.equal(deviceAuth.lastRejectedReason, "auth_mismatch");
    assert.match(deviceAuth.lastRejectedAt, /^\d{4}-\d{2}-\d{2}T/);
  } finally {
    await removeIfExists(deviceFilePath);
    await removeIfExists(deviceAuthFilePath);
  }
});

test("revoked device shows distinct revoked state", async () => {
  const deviceCode = "revoked1";
  const deviceFilePath = path.join(devicesDir, `${deviceCode}.json`);
  const deviceAuthFilePath = path.join(deviceAuthDir, `${deviceCode}.json`);

  await removeIfExists(deviceFilePath);
  await removeIfExists(deviceAuthFilePath);

  try {
    await writeDevice(deviceCode, {
      deviceCode,
      status: "revoked"
    });

    await withServer(async (baseUrl) => {
      const response = await fetch(`${baseUrl}/d/${deviceCode}`);
      const body = await response.text();

      assert.equal(response.status, 200);
      assert.match(body, /Access revoked/);
      assert.match(body, /This device no longer has access/);
      assert.match(body, /const currentAccessState = "revoked"/);
      assert.match(body, /if \(false\)/);
    });
  } finally {
    await removeIfExists(deviceFilePath);
    await removeIfExists(deviceAuthFilePath);
  }
});

test("admin reset pairing clears trusted pairing but keeps device approved", async () => {
  const deviceCode = "resetpair";
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
      candidateSecretHash: "b".repeat(64),
      deviceCode,
      secretHash: hashDeviceSecret("secret-alpha"),
      updatedAt: "2026-04-12T00:00:00.000Z"
    });

    await withAdminEnv(async () => {
      await withServer(async (baseUrl) => {
        const adminCookie = await loginAsAdmin(baseUrl);
        const response = await fetch(
          `${baseUrl}/admin/devices/${deviceCode}/reset-pairing`,
          {
            headers: {
              Cookie: adminCookie
            },
            method: "POST",
            redirect: "manual"
          }
        );

        assert.equal(response.status, 302);
      });
    });

    const device = await readDevice(deviceCode);
    const deviceAuth = await readDeviceAuth(deviceCode);

    assert.equal(device.status, "approved");
    assert.equal(deviceAuth.secretHash, undefined);
    assert.equal(deviceAuth.candidateSecretHash, undefined);
  } finally {
    await removeIfExists(deviceFilePath);
    await removeIfExists(deviceAuthFilePath);
  }
});

test("approved not paired device can re-pair and become authorized again", async () => {
  const deviceCode = "repair01";
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
      const response = await fetch(`${baseUrl}/api/device/${deviceCode}/auth`, {
        body: JSON.stringify({ deviceSecret: "secret-repair" }),
        headers: {
          "Content-Type": "application/json"
        },
        method: "POST"
      });
      const payload = await response.json();
      const cookieHeader = response.headers.get("set-cookie");

      assert.equal(response.status, 200);
      assert.deepEqual(payload, { status: "approved" });
      assert.match(cookieHeader, /mydashmaster_device=/);
    });

    const deviceAuth = await readDeviceAuth(deviceCode);

    assert.equal(deviceAuth.candidateSecretHash, undefined);
    assert.equal(deviceAuth.secretHash, hashDeviceSecret("secret-repair"));
  } finally {
    await removeIfExists(deviceFilePath);
    await removeIfExists(deviceAuthFilePath);
  }
});

test("admin device cards show formatted fields and filtered actions", async () => {
  const deviceCode = "cardview1";
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
      lastConnectedAt: "2026-04-13T00:00:00.000Z",
      lastKnownIp: "203.0.113.99",
      lastRejectedAt: "2026-04-12T12:00:00.000Z",
      lastRejectedIp: "203.0.113.44",
      lastRejectedReason: "auth_mismatch",
      secretHash: hashDeviceSecret("secret-alpha"),
      updatedAt: "2026-04-13T00:00:00.000Z"
    });

    await withAdminEnv(async () => {
      await withServer(async (baseUrl) => {
        const adminCookie = await loginAsAdmin(baseUrl);
        const response = await fetch(`${baseUrl}/admin/devices`, {
          headers: {
            Cookie: adminCookie
          }
        });
        const body = await response.text();

        assert.equal(response.status, 200);
        assert.match(body, /Last access: 13\.04\.2026/);
        assert.match(body, /IP: 203\.0\.113\.99/);
        assert.match(body, /Seen: \d+s/);
        assert.match(body, /Last rejected:\s*12\.04\.2026[\s\S]*IP 203\.0\.113\.44[\s\S]*auth_mismatch/);
        assert.match(body, /Reload/);
        assert.match(body, /Reset pairing/);
        assert.match(body, /Revoke/);
        assert.match(body, /Delete/);
      });
    });
  } finally {
    await removeIfExists(deviceFilePath);
    await removeIfExists(deviceAuthFilePath);
  }
});

test("admin can assign a different layout to an existing device", async () => {
  const deviceCode = "layoutsw1";
  const deviceFilePath = path.join(devicesDir, `${deviceCode}.json`);
  const deviceAuthFilePath = path.join(deviceAuthDir, `${deviceCode}.json`);

  await removeIfExists(deviceFilePath);
  await removeIfExists(deviceAuthFilePath);

  try {
    await writeDevice(deviceCode, {
      deviceCode,
      layoutId: "layout-1",
      status: "approved"
    });

    await withAdminEnv(async () => {
      await withServer(async (baseUrl) => {
        const adminCookie = await loginAsAdmin(baseUrl);
        const pageResponse = await fetch(
          `${baseUrl}/admin/devices/${deviceCode}/layout`,
          {
            headers: {
              Cookie: adminCookie
            }
          }
        );
        const pageBody = await pageResponse.text();

        assert.equal(pageResponse.status, 200);
        assert.match(pageBody, /Assign a layout for device/);
        assert.match(pageBody, /layout-1/);

        const saveResponse = await fetch(
          `${baseUrl}/admin/devices/${deviceCode}/layout`,
          {
            body: new URLSearchParams({
              layoutId: "layout-2"
            }),
            headers: {
              Cookie: adminCookie,
              "Content-Type": "application/x-www-form-urlencoded"
            },
            method: "POST",
            redirect: "manual"
          }
        );

        assert.equal(saveResponse.status, 302);
      });
    });

    const updatedDevice = await readDevice(deviceCode);

    assert.equal(updatedDevice.layoutId, "layout-2");
  } finally {
    await removeIfExists(deviceFilePath);
    await removeIfExists(deviceAuthFilePath);
  }
});

test("admin reload action increments the device reload signal", async () => {
  const deviceCode = "reloadme";
  const deviceFilePath = path.join(devicesDir, `${deviceCode}.json`);
  const deviceAuthFilePath = path.join(deviceAuthDir, `${deviceCode}.json`);

  await removeIfExists(deviceFilePath);
  await removeIfExists(deviceAuthFilePath);

  try {
    await writeDevice(deviceCode, {
      deviceCode,
      status: "approved"
    });

    await withAdminEnv(async () => {
      await withServer(async (baseUrl) => {
        const adminCookie = await loginAsAdmin(baseUrl);
        const response = await fetch(
          `${baseUrl}/admin/devices/${deviceCode}/reload`,
          {
            headers: {
              Cookie: adminCookie
            },
            method: "POST",
            redirect: "manual"
          }
        );

        assert.equal(response.status, 302);

        const statusResponse = await fetch(
          `${baseUrl}/api/device/${deviceCode}/status`
        );

        assert.equal((await statusResponse.json()).reloadVersion, 1);
      });
    });

    const deviceAuth = await readDeviceAuth(deviceCode);

    assert.equal(deviceAuth.reloadVersion, 1);
  } finally {
    await removeIfExists(deviceFilePath);
    await removeIfExists(deviceAuthFilePath);
  }
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
      accessState: "unknown",
      authorized: false,
      deviceCode,
      layoutId: null,
      reloadVersion: 0,
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
        accessState: "pending",
        authorized: false,
        deviceCode: pendingCode,
        layoutId: "layout-1",
        reloadVersion: 0,
        status: "pending"
      });
      assert.deepEqual(await revokedResponse.json(), {
        accessState: "revoked",
        authorized: false,
        deviceCode: revokedCode,
        layoutId: "layout-2",
        reloadVersion: 0,
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
        accessState: "auth_mismatch",
        authorized: false,
        deviceCode,
        layoutId: "layout-2",
        reloadVersion: 0,
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
        accessState: "authorized",
        authorized: true,
        deviceCode,
        layoutId: "layout-2",
        reloadVersion: 0,
        status: "approved"
      });
    });
  } finally {
    await removeIfExists(deviceFilePath);
    await removeIfExists(deviceAuthFilePath);
  }
});

test("unauthorized layout fragment request does not receive layout content", async () => {
  const deviceCode = "fragdeny";
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
      const response = await fetch(
        `${baseUrl}/api/device/${deviceCode}/layout-fragment`
      );

      assert.equal(response.status, 403);
      assert.doesNotMatch(await response.text(), /layout-canvas/);
    });
  } finally {
    await removeIfExists(deviceFilePath);
    await removeIfExists(deviceAuthFilePath);
  }
});

test("authorized layout fragment request returns attributed layout markup", async () => {
  const deviceCode = "fragok01";
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
      const authResponse = await fetch(`${baseUrl}/api/device/${deviceCode}/auth`, {
        body: JSON.stringify({ deviceSecret: "secret-alpha" }),
        headers: {
          "Content-Type": "application/json"
        },
        method: "POST"
      });
      const cookieHeader = authResponse.headers.get("set-cookie");
      const fragmentResponse = await fetch(
        `${baseUrl}/api/device/${deviceCode}/layout-fragment`,
        {
          headers: {
            Cookie: cookieHeader.split(";")[0]
          }
        }
      );
      const fragmentBody = await fragmentResponse.text();

      assert.equal(fragmentResponse.status, 200);
      assert.equal(fragmentResponse.headers.get("x-layout-id"), "layout-2");
      assert.match(fragmentBody, /id="device-layout-root"/);
      assert.match(fragmentBody, /data-layout-id="layout-2"/);
      assert.match(fragmentBody, /layout-canvas/);
    });
  } finally {
    await removeIfExists(deviceFilePath);
    await removeIfExists(deviceAuthFilePath);
  }
});

test("admin routes redirect unauthenticated users to login", async () => {
  await withAdminEnv(async () => {
    await withServer(async (baseUrl) => {
      const response = await fetch(`${baseUrl}/admin/devices`, {
        redirect: "manual"
      });

      assert.equal(response.status, 302);
      assert.equal(response.headers.get("location"), "/admin/login");
    });
  });
});

test("admin login rejects invalid credentials", async () => {
  await withAdminEnv(async () => {
    await withServer(async (baseUrl) => {
      const response = await fetch(`${baseUrl}/admin/login`, {
        body: new URLSearchParams({
          password: "wrong-pass",
          username: "admin"
        }),
        headers: {
          "Content-Type": "application/x-www-form-urlencoded"
        },
        method: "POST"
      });
      const body = await response.text();

      assert.equal(response.status, 200);
      assert.match(body, /Invalid username or password/);
    });
  });
});

test("admin session cookie is marked secure behind forwarded https", async () => {
  await withAdminEnv(async () => {
    await withServer(async (baseUrl) => {
      const response = await fetch(`${baseUrl}/admin/login`, {
        body: new URLSearchParams({
          password: "admin-pass",
          username: "admin"
        }),
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          "X-Forwarded-Proto": "https"
        },
        method: "POST",
        redirect: "manual"
      });
      const cookieHeader = response.headers.get("set-cookie");

      assert.equal(response.status, 302);
      assert.match(cookieHeader, /mydashmaster_admin=/);
      assert.match(cookieHeader, /Secure/);
    });
  });
});

test("admin can create a pending device with an 8 character generated code", async () => {
  const beforeCodes = new Set(await listDeviceCodes());
  let createdDeviceCode = null;

  try {
    await withAdminEnv(async () => {
      await withServer(async (baseUrl) => {
        const adminCookie = await loginAsAdmin(baseUrl);
        const response = await fetch(`${baseUrl}/admin/devices`, {
          body: new URLSearchParams({ layoutId: "" }),
          headers: {
            Cookie: adminCookie,
            "Content-Type": "application/x-www-form-urlencoded"
          },
          method: "POST",
          redirect: "manual"
        });

        assert.equal(response.status, 302);
      });
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

test("device session cookie is marked secure behind forwarded https", async () => {
  const deviceCode = "securedev";
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
      const response = await fetch(`${baseUrl}/api/device/${deviceCode}/auth`, {
        body: JSON.stringify({ deviceSecret: "secret-alpha" }),
        headers: {
          "Content-Type": "application/json",
          "X-Forwarded-Proto": "https"
        },
        method: "POST"
      });
      const cookieHeader = response.headers.get("set-cookie");

      assert.equal(response.status, 200);
      assert.match(cookieHeader, /mydashmaster_device=/);
      assert.match(cookieHeader, /Secure/);
    });
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

      assert.equal(authResponse.status, 200);
      assert.deepEqual(authPayload, { status: "approved" });

      const cookieHeader = authResponse.headers.get("set-cookie");

      assert.match(cookieHeader, /mydashmaster_device=/);

      const beforePageAccess = await readDeviceAuth(deviceCode);

      const pageResponse = await fetch(`${baseUrl}/d/${deviceCode}`, {
        headers: {
          Cookie: cookieHeader.split(";")[0],
          "X-Forwarded-For": "198.51.100.20"
        }
      });
      const pageBody = await pageResponse.text();

      assert.equal(pageResponse.status, 200);
      assert.match(pageBody, /id="device-layout-root"/);
      assert.match(pageBody, /\/layout-fragment/);
      assert.match(pageBody, /if \(isUpdatingLayout\)/);
      assert.match(pageBody, /let isUpdatingLayout = false/);
      assert.match(pageBody, /let latestExpectedLayoutId = currentState\.layoutId/);
      assert.match(pageBody, /await updateLayoutFragment\(payload\.layoutId\)/);
      assert.match(pageBody, /payload\.accessState !== "authorized"/);
      assert.match(pageBody, /payload\.reloadVersion !== currentState\.reloadVersion/);
      assert.match(pageBody, /requestedLayoutId !== latestExpectedLayoutId/);
      assert.match(pageBody, /fragmentLayoutId !== latestExpectedLayoutId/);
      assert.match(pageBody, /currentLayoutRoot\.classList\.add\("device-layout-root--updating"\)/);

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
      assert.match(await response.text(), /Access not available in this browser/);
    });

    const deviceAuth = await readDeviceAuth(deviceCode);

    assert.equal(deviceAuth.lastKnownIp, "198.51.100.30");
    assert.equal(deviceAuth.lastConnectedAt, "2026-04-12T00:00:00.000Z");
    assert.equal(deviceAuth.lastRejectedIp, "198.51.100.40");
    assert.equal(deviceAuth.lastRejectedReason, "auth_mismatch");
    assert.match(deviceAuth.lastRejectedAt, /^\d{4}-\d{2}-\d{2}T/);
  } finally {
    await removeIfExists(deviceFilePath);
    await removeIfExists(deviceAuthFilePath);
  }
});

test("admin logout clears the session cookie", async () => {
  await withAdminEnv(async () => {
    await withServer(async (baseUrl) => {
      const adminCookie = await loginAsAdmin(baseUrl);
      const response = await fetch(`${baseUrl}/admin/logout`, {
        headers: {
          Cookie: adminCookie
        },
        method: "POST",
        redirect: "manual"
      });

      assert.equal(response.status, 302);
      assert.equal(response.headers.get("location"), "/admin/login");
      assert.match(response.headers.get("set-cookie"), /mydashmaster_admin=/);
      assert.match(response.headers.get("set-cookie"), /Max-Age=0/);
    });
  });
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

    await withAdminEnv(async () => {
      await withServer(async (baseUrl) => {
        const adminCookie = await loginAsAdmin(baseUrl);
        const response = await fetch(`${baseUrl}/admin/devices/${deviceCode}/delete`, {
          headers: {
            Cookie: adminCookie
          },
          method: "POST",
          redirect: "manual"
        });

        assert.equal(response.status, 302);
      });
    });

    await assert.rejects(fs.access(deviceFilePath));
    await assert.rejects(fs.access(deviceAuthFilePath));
  } finally {
    await removeIfExists(deviceFilePath);
    await removeIfExists(deviceAuthFilePath);
  }
});
