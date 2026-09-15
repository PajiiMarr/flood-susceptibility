// server/static-data.js
import express from "express";
import path from "path";
import os from "os";

const app = express();
const dataRoot = process.env.SOURCE_DATA_PATH.replace(/^~/, os.homedir());

app.use((req, res, next) => {
  res.header("Access-Control-Allow-Origin", "*"); // dev only
  next();
});

app.use("/data", express.static(dataRoot));

app.listen(4001, () => console.log(`Serving ${dataRoot} on :4001`));