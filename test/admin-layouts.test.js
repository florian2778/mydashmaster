const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs/promises");
const path = require("path");

const app = require("../src/app");
const { hashAdminPassword } = require("../src/auth/admin-auth");
const { writeDevice } = require("../src/storage/json-store");

const layoutsDir = path.join(__dirname, "..", "data", "layouts");
const devicesDir = path.join(__dirname, "..", "data", "devices");
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

  return response.headers.get("set-cookie").split(";")[0];
}

test("layouts overview links to layout detail pages", async () => {
  await withAdminEnv(async () => {
    await withServer(async (baseUrl) => {
      const adminCookie = await loginAsAdmin(baseUrl);
      const response = await fetch(`${baseUrl}/admin/layouts`, {
        headers: {
          cookie: adminCookie
        }
      });
      const body = await response.text();

      assert.equal(response.status, 200);
      assert.match(body, /href="\/admin\/layouts\/layout-1"/);
      assert.match(body, /class="layout-overview-card"/);
    });
  });
});

test("layout detail page shows read-only config and device usage", async () => {
  const layoutId = "layout-usage-test";
  const deviceCode = "layoutuse";
  const layoutFilePath = path.join(layoutsDir, `${layoutId}.json`);
  const deviceFilePath = path.join(devicesDir, `${deviceCode}.json`);

  await removeIfExists(layoutFilePath);
  await removeIfExists(deviceFilePath);

  try {
    await fs.writeFile(
      layoutFilePath,
      JSON.stringify(
        {
          layoutId,
          layoutVersion: 1,
          options: {
            showHeader: false,
            showLayoutTitle: false,
            showStatus: false
          },
          structure: {
            type: "row",
            children: [
              {
                type: "box",
                box: "box1",
                size: "100%"
              }
            ]
          },
          boxes: [
            {
              name: "box1",
              url: "https://example.com",
              zoom: 1
            }
          ]
        },
        null,
        2
      )
    );

    await writeDevice(deviceCode, {
      description: "Lobby screen",
      deviceCode,
      layoutId,
      status: "approved"
    });

    await withAdminEnv(async () => {
      await withServer(async (baseUrl) => {
        const adminCookie = await loginAsAdmin(baseUrl);
        const response = await fetch(`${baseUrl}/admin/layouts/${layoutId}`, {
          headers: {
            cookie: adminCookie
          }
        });
        const body = await response.text();

        assert.equal(response.status, 200);
        assert.match(body, /layoutVersion: <strong>1<\/strong>/);
        assert.match(body, /Lobby screen/);
        assert.match(body, /layoutuse/);
        assert.match(body, /Read-only/);
        assert.match(body, /&#34;layoutId&#34;: &#34;layout-usage-test&#34;/);
      });
    });
  } finally {
    await removeIfExists(layoutFilePath);
    await removeIfExists(deviceFilePath);
  }
});

test("layout detail validate and save workflow increments layoutVersion", async () => {
  const layoutId = "layout-save-test";
  const layoutFilePath = path.join(layoutsDir, `${layoutId}.json`);

  await removeIfExists(layoutFilePath);

  try {
    await fs.writeFile(
      layoutFilePath,
      JSON.stringify(
        {
          layoutId,
          layoutVersion: 2,
          options: {
            showHeader: false,
            showLayoutTitle: false,
            showStatus: false
          },
          structure: {
            type: "row",
            children: [
              {
                type: "box",
                box: "box1",
                size: "100%"
              }
            ]
          },
          boxes: [
            {
              name: "box1",
              url: "https://example.com",
              zoom: 1
            }
          ]
        },
        null,
        2
      )
    );

    await withAdminEnv(async () => {
      await withServer(async (baseUrl) => {
        const adminCookie = await loginAsAdmin(baseUrl);
        const invalidValidateResponse = await fetch(`${baseUrl}/admin/layouts/${layoutId}`, {
          body: new URLSearchParams({
            intent: "validate",
            jsonContent: "{\"layoutId\":\"layout-save-test\""
          }),
          headers: {
            "Content-Type": "application/x-www-form-urlencoded",
            cookie: adminCookie
          },
          method: "POST"
        });
        const invalidValidateBody = await invalidValidateResponse.text();

        assert.equal(invalidValidateResponse.status, 200);
        assert.match(invalidValidateBody, /Invalid JSON/);
        assert.match(invalidValidateBody, /Edit mode/);

        const saveResponse = await fetch(`${baseUrl}/admin/layouts/${layoutId}`, {
          body: new URLSearchParams({
            intent: "save",
            jsonContent: JSON.stringify(
              {
                layoutId,
                layoutVersion: 2,
                options: {
                  showHeader: true,
                  showLayoutTitle: false,
                  showStatus: false
                },
                structure: {
                  type: "row",
                  children: [
                    {
                      type: "box",
                      box: "box1",
                      size: "100%"
                    }
                  ]
                },
                boxes: [
                  {
                    name: "box1",
                    url: "https://example.org",
                    zoom: 1
                  }
                ]
              },
              null,
              2
            )
          }),
          headers: {
            "Content-Type": "application/x-www-form-urlencoded",
            cookie: adminCookie
          },
          method: "POST",
          redirect: "manual"
        });

        assert.equal(saveResponse.status, 302);
        assert.equal(saveResponse.headers.get("location"), `/admin/layouts/${layoutId}`);
      });
    });

    const savedLayout = JSON.parse(await fs.readFile(layoutFilePath, "utf8"));

    assert.equal(savedLayout.layoutVersion, 3);
    assert.equal(savedLayout.options.showHeader, true);
    assert.equal(savedLayout.boxes[0].url, "https://example.org");
  } finally {
    await removeIfExists(layoutFilePath);
  }
});

test("layout detail surfaces layoutVersion migration requirements", async () => {
  const layoutId = "layout-migrate-test";
  const layoutFilePath = path.join(layoutsDir, `${layoutId}.json`);

  await removeIfExists(layoutFilePath);

  try {
    await fs.writeFile(
      layoutFilePath,
      JSON.stringify(
        {
          layoutId,
          options: {
            showHeader: false,
            showLayoutTitle: false,
            showStatus: false
          },
          structure: {
            type: "row",
            children: [
              {
                type: "box",
                box: "box1",
                size: "100%"
              }
            ]
          },
          boxes: [
            {
              name: "box1",
              url: "https://example.com",
              zoom: 1
            }
          ]
        },
        null,
        2
      )
    );

    await withAdminEnv(async () => {
      await withServer(async (baseUrl) => {
        const adminCookie = await loginAsAdmin(baseUrl);
        const response = await fetch(`${baseUrl}/admin/layouts/${layoutId}`, {
          headers: {
            cookie: adminCookie
          }
        });
        const body = await response.text();

        assert.equal(response.status, 200);
        assert.match(body, /migration required/);
        assert.match(body, /layoutVersion is missing/);
      });
    });
  } finally {
    await removeIfExists(layoutFilePath);
  }
});
