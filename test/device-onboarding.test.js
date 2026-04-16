const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs/promises");
const path = require("path");

const app = require("../src/app");
const { hashAdminPassword } = require("../src/auth/admin-auth");
const { hashDeviceSecret } = require("../src/auth/device-auth");
const {
  listDeviceCodes,
  pairDeviceToClient,
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

function getSetCookieValues(response) {
  if (typeof response.headers.getSetCookie === "function") {
    return response.headers.getSetCookie();
  }

  const headerValue = response.headers.get("set-cookie");

  if (!headerValue) {
    return [];
  }

  return headerValue.split(/,(?=[^;,\s]+=[^;]+)/);
}

function getCookiePair(response, cookieName) {
  for (const cookieHeader of getSetCookieValues(response)) {
    const match = cookieHeader.match(
      new RegExp(`${cookieName}=([^;]+)`)
    );

    if (match) {
      return `${cookieName}=${match[1]}`;
    }
  }

  return null;
}

function getCookieHeader(response, cookieNames) {
  return cookieNames
    .map((cookieName) => getCookiePair(response, cookieName))
    .filter(Boolean)
    .join("; ");
}

function getCookieValue(cookiePair) {
  return cookiePair.split("=")[1];
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

  const cookieHeader = getCookiePair(response, "mydashmaster_admin");

  assert.match(cookieHeader, /mydashmaster_admin=/);

  return cookieHeader;
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
      const clientId = getCookieValue(
        getCookiePair(response, "mydashmaster_device_client")
      );

      assert.equal(response.status, 200);
      assert.match(body, /Device not paired/);
      assert.match(body, /Client ID/);
      assert.match(body, new RegExp(clientId));
      assert.match(body, /\/api\/device\/notpair1\/auth/);
      assert.match(body, /\/api\/device\/notpair1\/status/);
      assert.match(body, /const currentAccessState = "not_paired"/);
      assert.match(body, /if \(true\)/);
    });
  } finally {
    await removeIfExists(deviceFilePath);
    await removeIfExists(deviceAuthFilePath);
  }
});

test("approved device without paired client stays not_paired even without a valid session", async () => {
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
      const clientId = getCookieValue(
        getCookiePair(response, "mydashmaster_device_client")
      );

      assert.equal(response.status, 200);
      assert.match(body, /Device not paired/);
      assert.match(body, /Client ID/);
      assert.match(body, new RegExp(clientId));
      assert.match(body, /\/api\/device\/mismatch\/status/);
      assert.match(body, /const currentAccessState = "not_paired"/);
      assert.match(body, /if \(true\)/);
    });

    const deviceAuth = await readDeviceAuth(deviceCode);

    assert.equal(deviceAuth.lastRejectedIp, undefined);
    assert.equal(deviceAuth.lastRejectedReason, undefined);
    assert.equal(deviceAuth.lastRejectedAt, undefined);
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

test("admin reset pairing clears official client assignment and active secret while keeping device approved", async () => {
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
      clients: [
        {
          accessState: "authorized",
          clientId: "paired-client",
          isPairedClient: true,
          lastSeenAt: "2026-04-12T00:00:00.000Z",
          userAgent: "Client/1.0"
        },
        {
          accessState: "auth_mismatch",
          clientId: "other-client",
          isPairedClient: false,
          lastSeenAt: "2026-04-12T00:00:00.000Z",
          userAgent: "Other/1.0"
        }
      ],
      deviceCode,
      lastStatusAt: "2026-04-12T00:00:00.000Z",
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
    assert.equal(
      deviceAuth.clients.every((client) => client.isPairedClient === false),
      true
    );
    assert.equal(
      deviceAuth.clients.every((client) => client.accessState === "not_paired"),
      true
    );
  } finally {
    await removeIfExists(deviceFilePath);
    await removeIfExists(deviceAuthFilePath);
  }
});

test("approved not paired device can authenticate without auto-pairing", async () => {
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
      const cookieHeader = getCookieHeader(response, [
        "mydashmaster_device",
        "mydashmaster_device_client"
      ]);
      const clientId = getCookieValue(
        getCookiePair(response, "mydashmaster_device_client")
      );

      assert.equal(response.status, 200);
      assert.deepEqual(payload, { status: "approved" });
      assert.match(cookieHeader, /mydashmaster_device=/);

      const statusResponse = await fetch(`${baseUrl}/api/device/${deviceCode}/status`, {
        headers: {
          Cookie: cookieHeader
        }
      });

      assert.deepEqual(await statusResponse.json(), {
        accessState: "not_paired",
        authorized: false,
        deviceCode,
        layoutId: null,
        reloadVersion: 0,
        status: "approved"
      });

      const deviceAuth = await readDeviceAuth(deviceCode);
      const client = deviceAuth.clients.find((entry) => entry.clientId === clientId);

      assert.equal(client.isPairedClient, false);
      assert.equal(client.accessState, "not_paired");
      assert.match(client.lastAuthenticatedAt, /^\d{4}-\d{2}-\d{2}T/);
    });
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
      lastStatusAt: new Date().toISOString(),
      secretHash: hashDeviceSecret("secret-alpha"),
      updatedAt: new Date().toISOString()
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
        assert.match(body, /Seen: (just now|\d+s ago|\d+m ago|\d+h ago|\d+d ago)/);
        assert.match(body, /Last rejected:\s*12\.04\.2026[\s\S]*IP 203\.0\.113\.44[\s\S]*auth_mismatch/);
        assert.match(body, new RegExp(`href="/admin/devices/${deviceCode}"`));
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

test("admin device detail page shows summary, official paired client, and additional client activity", async () => {
  const deviceCode = "detail01";
  const deviceFilePath = path.join(devicesDir, `${deviceCode}.json`);
  const deviceAuthFilePath = path.join(deviceAuthDir, `${deviceCode}.json`);
  const now = new Date();
  const lastConnectedAt = new Date(now.getTime() - 20 * 60 * 1000).toISOString();
  const pairedSeenAt = new Date(now.getTime() - 10 * 60 * 1000).toISOString();
  const additionalSeenAt = new Date(now.getTime() - 5 * 60 * 1000).toISOString();
  const lastStatusAt = new Date(now.getTime() - 2 * 60 * 1000).toISOString();

  await removeIfExists(deviceFilePath);
  await removeIfExists(deviceAuthFilePath);

  try {
    await writeDevice(deviceCode, {
      description: "North lobby panel",
      deviceCode,
      layoutId: "layout-2",
      status: "approved"
    });
    await updateDeviceAuth(deviceCode, {
      clients: [
        {
          accessState: "authorized",
          clientId: "client-alpha-1234",
          isPairedClient: true,
          lastAuthenticatedAt: pairedSeenAt,
          lastKnownIp: "203.0.113.7",
          lastSeenAt: pairedSeenAt,
          userAgent: "PairedClient/1.0"
        },
        {
          accessState: "auth_mismatch",
          clientId: "client-bravo-5678",
          isPairedClient: false,
          lastAuthenticatedAt: additionalSeenAt,
          lastKnownIp: "203.0.113.8",
          lastSeenAt: additionalSeenAt,
          userAgent: "SpareBrowser/2.0"
        }
      ],
      deviceCode,
      lastConnectedAt,
      lastKnownIp: "203.0.113.7",
      lastStatusAt,
      secretHash: hashDeviceSecret("secret-alpha"),
      updatedAt: lastStatusAt
    });

    await withAdminEnv(async () => {
      await withServer(async (baseUrl) => {
        const adminCookie = await loginAsAdmin(baseUrl);
        const response = await fetch(`${baseUrl}/admin/devices/${deviceCode}`, {
          headers: {
            Cookie: adminCookie
          }
        });
        const body = await response.text();

        assert.equal(response.status, 200);
        assert.match(body, /North lobby panel/);
        assert.match(body, /Summary/);
        assert.match(body, /Layout: <strong>layout-2<\/strong>/);
        assert.match(body, /Official Paired Client/);
        assert.match(body, /paired active client/);
        assert.match(body, /Access: <strong>authorized<\/strong>/);
        assert.match(body, /Seen: <strong>Seen (just now|\d+s ago|\d+m ago|\d+h ago|\d+d ago)<\/strong>/);
        assert.match(body, new RegExp(`Seen at: <strong>${lastStatusAt.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}<\\/strong>`));
        assert.match(body, new RegExp(`Last access: ${lastConnectedAt.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`));
        assert.match(body, /PairedClient\/1\.0/);
        assert.match(body, /203\.0\.113\.7/);
        assert.match(body, /Additional Unpaired Client Activity/);
        assert.match(body, /client-b\.\.\./);
        assert.match(body, /auth_mismatch/);
        assert.match(body, new RegExp(additionalSeenAt.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
        assert.match(body, /SpareBrowser\/2\.0/);
        assert.match(body, new RegExp(`Authenticated: ${additionalSeenAt.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`));
        assert.match(body, /name="clientId" value="client-bravo-5678"/);
        assert.doesNotMatch(body, /name="clientId" value="client-alpha-1234"/);
      });
    });
  } finally {
    await removeIfExists(deviceFilePath);
    await removeIfExists(deviceAuthFilePath);
  }
});

test("admin device detail page shows no paired client empty state after reset", async () => {
  const deviceCode = "detail02";
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
    await updateDeviceAuth(deviceCode, {
      clients: [
        {
          accessState: "authorized",
          clientId: "client-a",
          isPairedClient: true,
          lastSeenAt: "2026-04-13T10:00:00.000Z",
          userAgent: "BrowserA/1.0"
        },
        {
          accessState: "auth_mismatch",
          clientId: "client-b",
          isPairedClient: false,
          lastSeenAt: "2026-04-13T10:05:00.000Z",
          userAgent: "BrowserB/1.0"
        }
      ],
      deviceCode,
      lastStatusAt: "2026-04-13T10:10:00.000Z",
      secretHash: hashDeviceSecret("secret-alpha"),
      updatedAt: "2026-04-13T10:10:00.000Z"
    });

    await withAdminEnv(async () => {
      await withServer(async (baseUrl) => {
        const adminCookie = await loginAsAdmin(baseUrl);
        const resetResponse = await fetch(
          `${baseUrl}/admin/devices/${deviceCode}/reset-pairing`,
          {
            body: new URLSearchParams({
              returnTo: "detail"
            }),
            headers: {
              Cookie: adminCookie,
              "Content-Type": "application/x-www-form-urlencoded"
            },
            method: "POST",
            redirect: "manual"
          }
        );

        assert.equal(resetResponse.status, 302);
        assert.equal(
          resetResponse.headers.get("location"),
          `/admin/devices/${deviceCode}`
        );

        const detailResponse = await fetch(`${baseUrl}/admin/devices/${deviceCode}`, {
          headers: {
            Cookie: adminCookie
          }
        });
        const detailBody = await detailResponse.text();

        assert.equal(detailResponse.status, 200);
        assert.match(detailBody, /No paired client\. Device is currently not paired\./);
        assert.doesNotMatch(detailBody, /Access: <strong>authorized<\/strong>/);
      });
    });
  } finally {
    await removeIfExists(deviceFilePath);
    await removeIfExists(deviceAuthFilePath);
  }
});

test("admin device detail pair action selects the requested client and updates the detail view", async () => {
  const deviceCode = "detail03";
  const deviceFilePath = path.join(devicesDir, `${deviceCode}.json`);
  const deviceAuthFilePath = path.join(deviceAuthDir, `${deviceCode}.json`);
  const now = new Date().toISOString();

  await removeIfExists(deviceFilePath);
  await removeIfExists(deviceAuthFilePath);

  try {
    await writeDevice(deviceCode, {
      deviceCode,
      status: "approved"
    });
    await updateDeviceAuth(deviceCode, {
      clients: [
        {
          accessState: "authorized",
          clientId: "client-a",
          isPairedClient: true,
          lastSeenAt: now,
          userAgent: "BrowserA/1.0"
        },
        {
          accessState: "not_paired",
          clientId: "client-b",
          isPairedClient: false,
          lastAuthenticatedAt: now,
          lastSeenAt: now,
          userAgent: "BrowserB/1.0"
        }
      ],
      deviceCode,
      lastStatusAt: now,
      secretHash: hashDeviceSecret("secret-alpha"),
      updatedAt: now
    });

    await withAdminEnv(async () => {
      await withServer(async (baseUrl) => {
        const adminCookie = await loginAsAdmin(baseUrl);
        const pairResponse = await fetch(
          `${baseUrl}/admin/devices/${deviceCode}/pair-client`,
          {
            body: new URLSearchParams({
              clientId: "client-b"
            }),
            headers: {
              Cookie: adminCookie,
              "Content-Type": "application/x-www-form-urlencoded"
            },
            method: "POST",
            redirect: "manual"
          }
        );

        assert.equal(pairResponse.status, 302);
        assert.equal(pairResponse.headers.get("location"), `/admin/devices/${deviceCode}`);

        const detailResponse = await fetch(`${baseUrl}/admin/devices/${deviceCode}`, {
          headers: {
            Cookie: adminCookie
          }
        });
        const body = await detailResponse.text();

        assert.equal(detailResponse.status, 200);
        assert.match(body, /Official Paired Client/);
        assert.match(body, /BrowserB\/1\.0/);
        assert.match(body, /Access: <strong>authorized<\/strong>/);
        assert.match(body, /Authenticate this browser first before pairing it\./);
        assert.doesNotMatch(body, /name="clientId" value="client-b"/);
      });
    });

    const deviceAuth = await readDeviceAuth(deviceCode);
    const pairedClients = deviceAuth.clients.filter((client) => client.isPairedClient);
    const clientA = deviceAuth.clients.find((client) => client.clientId === "client-a");
    const clientB = deviceAuth.clients.find((client) => client.clientId === "client-b");

    assert.equal(pairedClients.length, 1);
    assert.equal(clientB.isPairedClient, true);
    assert.equal(clientB.accessState, "authorized");
    assert.equal(clientA.isPairedClient, false);
    assert.equal(clientA.accessState, "not_paired");
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
        accessState: "not_paired",
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
      const cookieHeader = getCookieHeader(authResponse, [
        "mydashmaster_device",
        "mydashmaster_device_client"
      ]);

      assert.equal(authResponse.status, 200);
      assert.match(cookieHeader, /mydashmaster_device=/);

      const authorizedResponse = await fetch(
        `${baseUrl}/api/device/${deviceCode}/status`,
        {
          headers: {
            Cookie: cookieHeader
          }
        }
      );

      assert.deepEqual(await authorizedResponse.json(), {
        accessState: "not_paired",
        authorized: false,
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

test("paired active client status polling updates official heartbeat and client activity", async () => {
  const deviceCode = "heartbt1";
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
        body: JSON.stringify({ deviceSecret: "secret-heartbeat" }),
        headers: {
          "Content-Type": "application/json",
          "User-Agent": "HeartbeatClient/1.0"
        },
        method: "POST"
      });
      const authCookieHeader = getCookieHeader(authResponse, [
        "mydashmaster_device",
        "mydashmaster_device_client"
      ]);
      const clientId = getCookieValue(
        getCookiePair(authResponse, "mydashmaster_device_client")
      );

      assert.equal(authResponse.status, 200);

      await pairDeviceToClient(deviceCode, clientId);

      const statusResponse = await fetch(
        `${baseUrl}/api/device/${deviceCode}/status`,
        {
          headers: {
            Cookie: authCookieHeader,
            "User-Agent": "HeartbeatClient/1.0"
          }
        }
      );

      assert.equal(statusResponse.status, 200);
      assert.equal((await statusResponse.json()).accessState, "authorized");
    });

    const deviceAuth = await readDeviceAuth(deviceCode);
    const pairedClients = deviceAuth.clients.filter((client) => client.isPairedClient);

    assert.equal(pairedClients.length, 1);
    assert.equal(pairedClients[0].accessState, "authorized");
    assert.equal(pairedClients[0].userAgent, "HeartbeatClient/1.0");
    assert.match(pairedClients[0].lastSeenAt, /^\d{4}-\d{2}-\d{2}T/);
    assert.match(deviceAuth.lastStatusAt, /^\d{4}-\d{2}-\d{2}T/);
  } finally {
    await removeIfExists(deviceFilePath);
    await removeIfExists(deviceAuthFilePath);
  }
});

test("additional unpaired client activity updates only its own client lastSeenAt", async () => {
  const deviceCode = "heartbt2";
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
        body: JSON.stringify({ deviceSecret: "secret-heartbeat" }),
        headers: {
          "Content-Type": "application/json",
          "User-Agent": "PairedClient/1.0"
        },
        method: "POST"
      });
      const pairedCookieHeader = getCookieHeader(authResponse, [
        "mydashmaster_device",
        "mydashmaster_device_client"
      ]);
      const pairedClientId = getCookieValue(
        getCookiePair(authResponse, "mydashmaster_device_client")
      );

      await pairDeviceToClient(deviceCode, pairedClientId);

      await fetch(`${baseUrl}/api/device/${deviceCode}/status`, {
        headers: {
          Cookie: pairedCookieHeader,
          "User-Agent": "PairedClient/1.0"
        }
      });

      const beforeMismatch = await readDeviceAuth(deviceCode);
      const officialHeartbeat = beforeMismatch.lastStatusAt;

      const mismatchResponse = await fetch(
        `${baseUrl}/api/device/${deviceCode}/status`,
        {
          headers: {
            "User-Agent": "OtherClient/1.0"
          }
        }
      );
      const mismatchPayload = await mismatchResponse.json();

      assert.equal(mismatchPayload.accessState, "auth_mismatch");

      const afterMismatch = await readDeviceAuth(deviceCode);
      const pairedClients = afterMismatch.clients.filter((client) => client.isPairedClient);
      const mismatchClient = afterMismatch.clients.find(
        (client) => client.userAgent === "OtherClient/1.0"
      );

      assert.equal(afterMismatch.lastStatusAt, officialHeartbeat);
      assert.equal(pairedClients.length, 1);
      assert.equal(pairedClients[0].userAgent, "PairedClient/1.0");
      assert.equal(mismatchClient.accessState, "auth_mismatch");
      assert.equal(mismatchClient.isPairedClient, false);
      assert.match(mismatchClient.lastSeenAt, /^\d{4}-\d{2}-\d{2}T/);
    });
  } finally {
    await removeIfExists(deviceFilePath);
    await removeIfExists(deviceAuthFilePath);
  }
});

test("client activity stores lastKnownIp per client on status polling", async () => {
  const deviceCode = "heartbt7";
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
      const response = await fetch(`${baseUrl}/api/device/${deviceCode}/status`, {
        headers: {
          "X-Forwarded-For": "203.0.113.77"
        }
      });

      assert.equal(response.status, 200);
    });

    const deviceAuth = await readDeviceAuth(deviceCode);

    assert.equal(deviceAuth.clients.length, 1);
    assert.equal(deviceAuth.clients[0].accessState, "pending");
    assert.equal(deviceAuth.clients[0].lastKnownIp, "203.0.113.77");
  } finally {
    await removeIfExists(deviceFilePath);
    await removeIfExists(deviceAuthFilePath);
  }
});

test("subsequent auth does not replace the paired client without explicit selection", async () => {
  const deviceCode = "heartbt3";
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
      const firstAuthResponse = await fetch(`${baseUrl}/api/device/${deviceCode}/auth`, {
        body: JSON.stringify({ deviceSecret: "secret-exclusive" }),
        headers: {
          "Content-Type": "application/json",
          "User-Agent": "ClientOne/1.0"
        },
        method: "POST"
      });

      assert.equal(firstAuthResponse.status, 200);
      await pairDeviceToClient(
        deviceCode,
        getCookieValue(getCookiePair(firstAuthResponse, "mydashmaster_device_client"))
      );

      const secondAuthResponse = await fetch(`${baseUrl}/api/device/${deviceCode}/auth`, {
        body: JSON.stringify({ deviceSecret: "secret-exclusive" }),
        headers: {
          "Content-Type": "application/json",
          "User-Agent": "ClientTwo/1.0"
        },
        method: "POST"
      });

      assert.equal(secondAuthResponse.status, 200);

      const secondCookieHeader = getCookieHeader(secondAuthResponse, [
        "mydashmaster_device",
        "mydashmaster_device_client"
      ]);
      const secondStatusResponse = await fetch(
        `${baseUrl}/api/device/${deviceCode}/status`,
        {
          headers: {
            Cookie: secondCookieHeader,
            "User-Agent": "ClientTwo/1.0"
          }
        }
      );

      assert.equal((await secondStatusResponse.json()).accessState, "auth_mismatch");
    });

    const deviceAuth = await readDeviceAuth(deviceCode);
    const pairedClients = deviceAuth.clients.filter((client) => client.isPairedClient);
    const firstClient = deviceAuth.clients.find((client) => client.userAgent === "ClientOne/1.0");
    const secondClient = deviceAuth.clients.find((client) => client.userAgent === "ClientTwo/1.0");

    assert.equal(pairedClients.length, 1);
    assert.equal(firstClient.isPairedClient, true);
    assert.equal(secondClient.isPairedClient, false);
    assert.equal(secondClient.accessState, "auth_mismatch");
  } finally {
    await removeIfExists(deviceFilePath);
    await removeIfExists(deviceAuthFilePath);
  }
});

test("device clientId cookie is created when missing and reused when present", async () => {
  const deviceCode = "heartbt4";
  const deviceFilePath = path.join(devicesDir, `${deviceCode}.json`);
  const deviceAuthFilePath = path.join(deviceAuthDir, `${deviceCode}.json`);
  const now = new Date().toISOString();

  await removeIfExists(deviceFilePath);
  await removeIfExists(deviceAuthFilePath);

  try {
    await writeDevice(deviceCode, {
      deviceCode,
      status: "pending"
    });

    await withServer(async (baseUrl) => {
      const firstResponse = await fetch(`${baseUrl}/api/device/${deviceCode}/status`);
      const clientCookiePair = getCookiePair(firstResponse, "mydashmaster_device_client");

      assert.equal(firstResponse.status, 200);
      assert.match(clientCookiePair, /mydashmaster_device_client=/);

      const secondResponse = await fetch(`${baseUrl}/api/device/${deviceCode}/status`, {
        headers: {
          Cookie: clientCookiePair
        }
      });

      assert.equal(secondResponse.status, 200);
      assert.equal(
        getCookiePair(secondResponse, "mydashmaster_device_client"),
        null
      );
    });
  } finally {
    await removeIfExists(deviceFilePath);
    await removeIfExists(deviceAuthFilePath);
  }
});

test("status polling after reset updates client activity but not official heartbeat", async () => {
  const deviceCode = "afterrst";
  const deviceFilePath = path.join(devicesDir, `${deviceCode}.json`);
  const deviceAuthFilePath = path.join(deviceAuthDir, `${deviceCode}.json`);
  const oldHeartbeat = "2026-04-12T00:00:00.000Z";

  await removeIfExists(deviceFilePath);
  await removeIfExists(deviceAuthFilePath);

  try {
    await writeDevice(deviceCode, {
      deviceCode,
      status: "approved"
    });
    await updateDeviceAuth(deviceCode, {
      clients: [
        {
          accessState: "not_paired",
          clientId: "reset-client",
          isPairedClient: false,
          lastSeenAt: oldHeartbeat,
          userAgent: "ResetClient/1.0"
        }
      ],
      deviceCode,
      lastStatusAt: oldHeartbeat,
      secretHash: hashDeviceSecret("secret-alpha"),
      updatedAt: oldHeartbeat
    });

    await withServer(async (baseUrl) => {
      const authResponse = await fetch(`${baseUrl}/api/device/${deviceCode}/auth`, {
        body: JSON.stringify({ deviceSecret: "secret-alpha" }),
        headers: {
          "Content-Type": "application/json",
          "User-Agent": "ResetClient/1.0"
        },
        method: "POST"
      });
      const cookieHeader = getCookieHeader(authResponse, [
        "mydashmaster_device",
        "mydashmaster_device_client"
      ]);

      const statusResponse = await fetch(`${baseUrl}/api/device/${deviceCode}/status`, {
        headers: {
          Cookie: cookieHeader,
          "User-Agent": "ResetClient/1.0"
        }
      });
      const payload = await statusResponse.json();

      assert.equal(payload.accessState, "not_paired");
      assert.equal(payload.authorized, false);
    });

    const deviceAuth = await readDeviceAuth(deviceCode);

    assert.equal(deviceAuth.lastStatusAt, oldHeartbeat);
    assert.equal(deviceAuth.clients[0].accessState, "not_paired");
    assert.match(deviceAuth.clients[0].lastSeenAt, /^\d{4}-\d{2}-\d{2}T/);
  } finally {
    await removeIfExists(deviceFilePath);
    await removeIfExists(deviceAuthFilePath);
  }
});

test("fresh browser after reset can authenticate, stays not paired, and becomes official only after admin pairing", async () => {
  const deviceCode = "resetflow";
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
      const browserOneAuth = await fetch(`${baseUrl}/api/device/${deviceCode}/auth`, {
        body: JSON.stringify({ deviceSecret: "secret-alpha" }),
        headers: {
          "Content-Type": "application/json",
          "User-Agent": "OriginalBrowser/1.0"
        },
        method: "POST"
      });
      const browserOneCookies = getCookieHeader(browserOneAuth, [
        "mydashmaster_device",
        "mydashmaster_device_client"
      ]);

      await withAdminEnv(async () => {
        const adminCookie = await loginAsAdmin(baseUrl);
        const resetResponse = await fetch(
          `${baseUrl}/admin/devices/${deviceCode}/reset-pairing`,
          {
            headers: {
              Cookie: adminCookie
            },
            method: "POST",
            redirect: "manual"
          }
        );

        assert.equal(resetResponse.status, 302);
      });

      const browserTwoPage = await fetch(`${baseUrl}/d/${deviceCode}`, {
        headers: {
          "User-Agent": "FreshBrowser/2.0"
        }
      });
      const browserTwoPageBody = await browserTwoPage.text();
      const browserTwoClientCookie = getCookiePair(
        browserTwoPage,
        "mydashmaster_device_client"
      );
      const browserTwoClientId = getCookieValue(browserTwoClientCookie);

      assert.equal(browserTwoPage.status, 200);
      assert.match(browserTwoPageBody, /Device not paired/);
      assert.match(browserTwoPageBody, /Client ID/);
      assert.match(browserTwoPageBody, new RegExp(browserTwoClientId));
      assert.match(browserTwoPageBody, /if \(true\)/);
      assert.match(browserTwoClientCookie, /mydashmaster_device_client=/);

      const browserTwoAuth = await fetch(`${baseUrl}/api/device/${deviceCode}/auth`, {
        body: JSON.stringify({ deviceSecret: "secret-alpha" }),
        headers: {
          Cookie: browserTwoClientCookie,
          "Content-Type": "application/json",
          "User-Agent": "FreshBrowser/2.0"
        },
        method: "POST"
      });
      const browserTwoAuthPayload = await browserTwoAuth.json();
      const browserTwoDeviceCookie = getCookiePair(browserTwoAuth, "mydashmaster_device");
      const browserTwoCookies = [browserTwoClientCookie, browserTwoDeviceCookie]
        .filter(Boolean)
        .join("; ");

      assert.equal(browserTwoAuth.status, 200);
      assert.deepEqual(browserTwoAuthPayload, { status: "approved" });
      assert.match(browserTwoCookies, /mydashmaster_device=/);

      const deviceAuthAfterAuth = await readDeviceAuth(deviceCode);
      const browserTwoClientAfterAuth = deviceAuthAfterAuth.clients.find(
        (client) => client.clientId === browserTwoClientId
      );

      assert.equal(browserTwoClientAfterAuth.isPairedClient, false);
      assert.equal(browserTwoClientAfterAuth.accessState, "not_paired");
      assert.match(browserTwoClientAfterAuth.lastAuthenticatedAt, /^\d{4}-\d{2}-\d{2}T/);

      const browserTwoStatusBeforePair = await fetch(
        `${baseUrl}/api/device/${deviceCode}/status`,
        {
          headers: {
            Cookie: browserTwoCookies,
            "User-Agent": "FreshBrowser/2.0"
          }
        }
      );
      const browserTwoStatusBeforePairPayload = await browserTwoStatusBeforePair.json();

      assert.equal(browserTwoStatusBeforePairPayload.accessState, "not_paired");
      assert.equal(browserTwoStatusBeforePairPayload.authorized, false);

      const heartbeatBeforePair = (await readDeviceAuth(deviceCode)).lastStatusAt || null;

      await withAdminEnv(async () => {
        const adminCookie = await loginAsAdmin(baseUrl);
        const pairResponse = await fetch(
          `${baseUrl}/admin/devices/${deviceCode}/pair-client`,
          {
            body: new URLSearchParams({
              clientId: browserTwoClientId
            }),
            headers: {
              Cookie: adminCookie,
              "Content-Type": "application/x-www-form-urlencoded"
            },
            method: "POST",
            redirect: "manual"
          }
        );

        assert.equal(pairResponse.status, 302);
      });

      const browserTwoStatusAfterPair = await fetch(
        `${baseUrl}/api/device/${deviceCode}/status`,
        {
          headers: {
            Cookie: browserTwoCookies,
            "User-Agent": "FreshBrowser/2.0"
          }
        }
      );
      const browserTwoStatusAfterPairPayload = await browserTwoStatusAfterPair.json();

      assert.equal(browserTwoStatusAfterPairPayload.accessState, "authorized");
      assert.equal(browserTwoStatusAfterPairPayload.authorized, true);

      const browserOneStatusAfterPair = await fetch(
        `${baseUrl}/api/device/${deviceCode}/status`,
        {
          headers: {
            Cookie: browserOneCookies,
            "User-Agent": "OriginalBrowser/1.0"
          }
        }
      );
      const browserOneStatusAfterPairPayload = await browserOneStatusAfterPair.json();

      assert.equal(browserOneStatusAfterPairPayload.accessState, "auth_mismatch");
      assert.equal(browserOneStatusAfterPairPayload.authorized, false);

      const deviceAuthAfterPair = await readDeviceAuth(deviceCode);
      const pairedClient = deviceAuthAfterPair.clients.find((client) => client.isPairedClient);

      assert.equal(pairedClient.clientId, browserTwoClientId);
      assert.notEqual(deviceAuthAfterPair.lastStatusAt, heartbeatBeforePair);
    });
  } finally {
    await removeIfExists(deviceFilePath);
    await removeIfExists(deviceAuthFilePath);
  }
});

test("reset clears stale authenticated session evidence so an old browser cannot be paired without reauth", async () => {
  const deviceCode = "stalepair";
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
      const browserOneAuth = await fetch(`${baseUrl}/api/device/${deviceCode}/auth`, {
        body: JSON.stringify({ deviceSecret: "secret-alpha" }),
        headers: {
          "Content-Type": "application/json",
          "User-Agent": "OriginalBrowser/1.0"
        },
        method: "POST"
      });
      const browserOneClientId = getCookieValue(
        getCookiePair(browserOneAuth, "mydashmaster_device_client")
      );

      await withAdminEnv(async () => {
        const adminCookie = await loginAsAdmin(baseUrl);
        const resetResponse = await fetch(
          `${baseUrl}/admin/devices/${deviceCode}/reset-pairing`,
          {
            headers: {
              Cookie: adminCookie
            },
            method: "POST",
            redirect: "manual"
          }
        );

        assert.equal(resetResponse.status, 302);
      });

      const afterReset = await readDeviceAuth(deviceCode);
      const browserOneAfterReset = afterReset.clients.find(
        (client) => client.clientId === browserOneClientId
      );

      assert.equal(browserOneAfterReset.lastAuthenticatedAt, undefined);

      const browserTwoPage = await fetch(`${baseUrl}/d/${deviceCode}`, {
        headers: {
          "User-Agent": "SecondBrowser/2.0"
        }
      });
      const browserTwoClientCookie = getCookiePair(
        browserTwoPage,
        "mydashmaster_device_client"
      );

      const browserTwoAuth = await fetch(`${baseUrl}/api/device/${deviceCode}/auth`, {
        body: JSON.stringify({ deviceSecret: "secret-beta" }),
        headers: {
          Cookie: browserTwoClientCookie,
          "Content-Type": "application/json",
          "User-Agent": "SecondBrowser/2.0"
        },
        method: "POST"
      });

      assert.equal(browserTwoAuth.status, 200);

      await withAdminEnv(async () => {
        const adminCookie = await loginAsAdmin(baseUrl);
        const pairResponse = await fetch(
          `${baseUrl}/admin/devices/${deviceCode}/pair-client`,
          {
            body: new URLSearchParams({
              clientId: browserOneClientId
            }),
            headers: {
              Cookie: adminCookie,
              "Content-Type": "application/x-www-form-urlencoded"
            },
            method: "POST"
          }
        );
        const pairBody = await pairResponse.text();

        assert.equal(pairResponse.status, 400);
        assert.match(pairBody, /has not established an authenticated browser session/);
      });
    });
  } finally {
    await removeIfExists(deviceFilePath);
    await removeIfExists(deviceAuthFilePath);
  }
});

test("former paired client polling after reset clears stale paired flag without advancing heartbeat", async () => {
  const deviceCode = "resetstl";
  const deviceFilePath = path.join(devicesDir, `${deviceCode}.json`);
  const deviceAuthFilePath = path.join(deviceAuthDir, `${deviceCode}.json`);
  const oldHeartbeat = new Date(Date.now() - 60 * 1000).toISOString();

  await removeIfExists(deviceFilePath);
  await removeIfExists(deviceAuthFilePath);

  try {
    await writeDevice(deviceCode, {
      deviceCode,
      status: "approved"
    });

    await withServer(async (baseUrl) => {
      const firstAuthResponse = await fetch(`${baseUrl}/api/device/${deviceCode}/auth`, {
        body: JSON.stringify({ deviceSecret: "secret-alpha" }),
        headers: {
          "Content-Type": "application/json",
          "User-Agent": "OriginalBrowser/1.0"
        },
        method: "POST"
      });

      const firstCookieHeader = getCookieHeader(firstAuthResponse, [
        "mydashmaster_device",
        "mydashmaster_device_client"
      ]);
      const firstClientId = getCookieValue(
        getCookiePair(firstAuthResponse, "mydashmaster_device_client")
      );

      await updateDeviceAuth(deviceCode, {
        ...(await readDeviceAuth(deviceCode)),
        lastStatusAt: oldHeartbeat,
        updatedAt: oldHeartbeat
      });

      await withAdminEnv(async () => {
        const adminCookie = await loginAsAdmin(baseUrl);
        const resetResponse = await fetch(
          `${baseUrl}/admin/devices/${deviceCode}/reset-pairing`,
          {
            headers: {
              Cookie: adminCookie
            },
            method: "POST",
            redirect: "manual"
          }
        );

        assert.equal(resetResponse.status, 302);
      });

      const statusResponse = await fetch(`${baseUrl}/api/device/${deviceCode}/status`, {
        headers: {
          Cookie: firstCookieHeader,
          "User-Agent": "OriginalBrowser/1.0"
        }
      });
      const statusPayload = await statusResponse.json();

      assert.equal(statusPayload.accessState, "not_paired");
      assert.equal(statusPayload.authorized, false);

      const deviceAuth = await readDeviceAuth(deviceCode);
      const originalClient = deviceAuth.clients.find((client) => client.clientId === firstClientId);

      assert.equal(deviceAuth.lastStatusAt, oldHeartbeat);
      assert.equal(originalClient.isPairedClient, false);
      assert.equal(originalClient.accessState, "not_paired");
    });
  } finally {
    await removeIfExists(deviceFilePath);
    await removeIfExists(deviceAuthFilePath);
  }
});

test("pairDeviceToClient selects exactly one official client", async () => {
  const deviceCode = "pairclnt";
  const deviceFilePath = path.join(devicesDir, `${deviceCode}.json`);
  const deviceAuthFilePath = path.join(deviceAuthDir, `${deviceCode}.json`);
  const now = new Date().toISOString();

  await removeIfExists(deviceFilePath);
  await removeIfExists(deviceAuthFilePath);

  try {
    await writeDevice(deviceCode, {
      deviceCode,
      status: "approved"
    });
    await updateDeviceAuth(deviceCode, {
      clients: [
        {
          accessState: "not_paired",
          clientId: "client-a",
          isPairedClient: false,
          lastAuthenticatedAt: now,
          lastSeenAt: now,
          userAgent: "ClientA/1.0"
        },
        {
          accessState: "not_paired",
          clientId: "client-b",
          isPairedClient: false,
          lastAuthenticatedAt: now,
          lastSeenAt: now,
          userAgent: "ClientB/1.0"
        }
      ],
      deviceCode,
      secretHash: hashDeviceSecret("secret-alpha"),
      updatedAt: now
    });

    await pairDeviceToClient(deviceCode, "client-b");

    const deviceAuth = await readDeviceAuth(deviceCode);
    const pairedClients = deviceAuth.clients.filter((client) => client.isPairedClient);
    const clientA = deviceAuth.clients.find((client) => client.clientId === "client-a");
    const clientB = deviceAuth.clients.find((client) => client.clientId === "client-b");

    assert.equal(pairedClients.length, 1);
    assert.equal(clientB.isPairedClient, true);
    assert.equal(clientB.accessState, "authorized");
    assert.equal(clientA.isPairedClient, false);
    assert.equal(clientA.accessState, "not_paired");
  } finally {
    await removeIfExists(deviceFilePath);
    await removeIfExists(deviceAuthFilePath);
  }
});

test("device auth validation rejects authorized clients without a paired client", async () => {
  const deviceCode = "badpair1";
  const deviceFilePath = path.join(devicesDir, `${deviceCode}.json`);
  const deviceAuthFilePath = path.join(deviceAuthDir, `${deviceCode}.json`);

  await removeIfExists(deviceFilePath);
  await removeIfExists(deviceAuthFilePath);

  try {
    await assert.rejects(
      updateDeviceAuth(deviceCode, {
        clients: [
          {
            accessState: "authorized",
            clientId: "client-a",
            isPairedClient: false
          }
        ],
        deviceCode,
        secretHash: hashDeviceSecret("secret-alpha")
      }),
      /authorized client requires one isPairedClient=true entry/
    );
  } finally {
    await removeIfExists(deviceFilePath);
    await removeIfExists(deviceAuthFilePath);
  }
});

test("device auth validation rejects multiple paired clients", async () => {
  const deviceCode = "badpair2";
  const deviceAuthFilePath = path.join(deviceAuthDir, `${deviceCode}.json`);

  await removeIfExists(deviceAuthFilePath);

  try {
    await assert.rejects(
      updateDeviceAuth(deviceCode, {
        clients: [
          {
            accessState: "authorized",
            clientId: "client-a",
            isPairedClient: true
          },
          {
            accessState: "authorized",
            clientId: "client-b",
            isPairedClient: true
          }
        ],
        deviceCode,
        secretHash: hashDeviceSecret("secret-alpha")
      }),
      /only one client may have isPairedClient=true/
    );
  } finally {
    await removeIfExists(deviceAuthFilePath);
  }
});

test("stale client activity older than 48 hours is cleaned up during status polling", async () => {
  const deviceCode = "heartbt5";
  const deviceFilePath = path.join(devicesDir, `${deviceCode}.json`);
  const deviceAuthFilePath = path.join(deviceAuthDir, `${deviceCode}.json`);
  const staleSeenAt = new Date(Date.now() - (49 * 60 * 60 * 1000)).toISOString();

  await removeIfExists(deviceFilePath);
  await removeIfExists(deviceAuthFilePath);

  try {
    await writeDevice(deviceCode, {
      deviceCode,
      status: "pending"
    });
    await updateDeviceAuth(deviceCode, {
      clients: [
        {
          accessState: "pending",
          clientId: "stale-client",
          isPairedClient: false,
          lastSeenAt: staleSeenAt,
          userAgent: "StaleClient/1.0"
        }
      ],
      deviceCode,
      updatedAt: staleSeenAt
    });

    await withServer(async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/device/${deviceCode}/status`);

      assert.equal(response.status, 200);
    });

    const deviceAuth = await readDeviceAuth(deviceCode);

    assert.equal(
      deviceAuth.clients.some((client) => client.clientId === "stale-client"),
      false
    );
  } finally {
    await removeIfExists(deviceFilePath);
    await removeIfExists(deviceAuthFilePath);
  }
});

test("admin overview Seen uses official heartbeat instead of unpaired client activity", async () => {
  const deviceCode = "heartbt6";
  const deviceFilePath = path.join(devicesDir, `${deviceCode}.json`);
  const deviceAuthFilePath = path.join(deviceAuthDir, `${deviceCode}.json`);
  const threeMinutesAgo = new Date(Date.now() - (3 * 60 * 1000)).toISOString();
  const now = new Date().toISOString();

  await removeIfExists(deviceFilePath);
  await removeIfExists(deviceAuthFilePath);

  try {
    await writeDevice(deviceCode, {
      deviceCode,
      status: "approved"
    });
    await updateDeviceAuth(deviceCode, {
      clients: [
        {
          accessState: "authorized",
          clientId: "paired-client",
          isPairedClient: true,
          lastSeenAt: threeMinutesAgo,
          userAgent: "PairedClient/1.0"
        },
        {
          accessState: "auth_mismatch",
          clientId: "other-client",
          isPairedClient: false,
          lastSeenAt: now,
          userAgent: "OtherClient/1.0"
        }
      ],
      deviceCode,
      lastStatusAt: threeMinutesAgo,
      secretHash: hashDeviceSecret("secret-alpha"),
      updatedAt: now
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
        assert.match(body, /Seen: 3m ago/);
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
      const cookieHeader = getCookieHeader(authResponse, [
        "mydashmaster_device",
        "mydashmaster_device_client"
      ]);
      await pairDeviceToClient(
        deviceCode,
        getCookieValue(getCookiePair(authResponse, "mydashmaster_device_client"))
      );
      const fragmentResponse = await fetch(
        `${baseUrl}/api/device/${deviceCode}/layout-fragment`,
        {
          headers: {
            Cookie: cookieHeader
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

test("root route redirects to the canonical admin login route", async () => {
  await withServer(async (baseUrl) => {
    const response = await fetch(baseUrl, {
      redirect: "manual"
    });

    assert.equal(response.status, 302);
    assert.equal(response.headers.get("location"), "/admin/login");
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
      const cookieHeader = getSetCookieValues(response).join("\n");

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
      const cookieHeader = getSetCookieValues(response).join("\n");

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

      const cookieHeader = getCookieHeader(authResponse, [
        "mydashmaster_device",
        "mydashmaster_device_client"
      ]);
      await pairDeviceToClient(
        deviceCode,
        getCookieValue(getCookiePair(authResponse, "mydashmaster_device_client"))
      );

      assert.match(cookieHeader, /mydashmaster_device=/);

      const beforePageAccess = await readDeviceAuth(deviceCode);

      const pageResponse = await fetch(`${baseUrl}/d/${deviceCode}`, {
        headers: {
          Cookie: cookieHeader,
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
      clients: [
        {
          accessState: "authorized",
          clientId: "paired-client",
          isPairedClient: true,
          lastAuthenticatedAt: "2026-04-12T00:00:00.000Z",
          lastSeenAt: "2026-04-12T00:00:00.000Z",
          userAgent: "PairedClient/1.0"
        }
      ],
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
