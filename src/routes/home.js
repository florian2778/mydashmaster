const express = require("express");

const router = express.Router();

router.get("/", (req, res) => {
  res.render("pages/home", {
    pageTitle: "MyDashmaster",
    heading: "Test Page",
    message: "Express and EJS are configured and running."
  });
});

module.exports = router;
