const express = require("express");
const path = require("path");

const homeRoutes = require("./routes/home");
const adminRoutes = require("./routes/admin");
const deviceApiRoutes = require("./routes/device-api");
const deviceRoutes = require("./routes/device");

const app = express();

app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "..", "views"));

app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static(path.join(__dirname, "..", "public")));

app.use("/", homeRoutes);
app.use("/admin", adminRoutes);
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
