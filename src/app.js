const express = require("express");
const path = require("path");

const {
  adminAuthViewModel,
  requireAdminAuth
} = require("./auth/admin-auth");
const homeRoutes = require("./routes/home");
const adminRoutes = require("./routes/admin");
const deviceApiRoutes = require("./routes/device-api");
const deviceRoutes = require("./routes/device");
const simpleApiRoutes = require("./routes/simple-api");
const { appVersion } = require("./version");

const app = express();
const defaultDevicePollIntervalMs = 10000;
const configuredDevicePollIntervalMs = Number.parseInt(
  process.env.DEVICE_POLL_INTERVAL_MS || "",
  10
);

app.locals.devicePollIntervalMs =
  Number.isInteger(configuredDevicePollIntervalMs) &&
  configuredDevicePollIntervalMs > 0
    ? configuredDevicePollIntervalMs
    : defaultDevicePollIntervalMs;
app.locals.versionInfo = appVersion;

// Production deployment assumes one direct reverse proxy hop, e.g. Traefik.
app.set("trust proxy", 1);

app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "..", "views"));

app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static(path.join(__dirname, "..", "public")));
app.use((req, res, next) => {
  Object.assign(res.locals, adminAuthViewModel(req));
  res.locals.appVersion = app.locals.versionInfo;
  res.locals.appRevision = app.locals.versionInfo.revision || null;
  next();
});

app.use("/", homeRoutes);
app.use("/admin", requireAdminAuth, adminRoutes);
app.get("/api/version", (req, res) => {
  res.json(app.locals.versionInfo);
});
app.use("/api", simpleApiRoutes);
app.use("/api/device", deviceApiRoutes);
app.use("/d", deviceRoutes);

app.use((error, req, res, next) => {
  console.error(error);

  if (res.headersSent) {
    return next(error);
  }

  res.status(500).send("Internal Server Error");
});

module.exports = app;
