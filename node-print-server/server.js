"use strict";

/**
 * Print Server for Thermal & Label Printers (Windows‑first)
 * - Silent RAW (ESC/POS, TSPL/ZPL/CPCL) via Windows share using `copy /b`
 * - Silent PDF & HTML→PDF via `pdf-to-printer` (no preview)
 * - Optional API key protection & CORS restriction
 *
 * ENV:
 *  PORT=2020
 *  CORS_ORIGIN=*                  // set to http://127.0.0.1:3000, etc.
 *  API_KEY=your-secret            // if set, client must send x-api-key header
 *  THERMAL_WIDTH=80mm             // default width for /print-html
 */

const express = require("express");
const cors = require("cors");
const bodyParser = require("body-parser");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { exec } = require("child_process");
const { getPrinters, print: printPdf } = require("pdf-to-printer");

// ==== Logging (winston with daily rotate) ====
const { createLogger, format, transports } = require("winston");
require("winston-daily-rotate-file");
const { randomUUID } = require("crypto");

const LOG_DIR = process.env.LOG_DIR || path.join(process.cwd(), "logs");
if (!fs.existsSync(LOG_DIR)) fs.mkdirSync(LOG_DIR, { recursive: true });

const rotate = new transports.DailyRotateFile({
  dirname: LOG_DIR,
  filename: "print-server-%DATE%.log",
  datePattern: "YYYY-MM-DD",
  zippedArchive: true,
  maxSize: process.env.LOG_MAX_SIZE || "10m",
  maxFiles: process.env.LOG_MAX_FILES || "14d",
  level: process.env.LOG_LEVEL || "info",
});

const logger = createLogger({
  level: process.env.LOG_LEVEL || "info",
  format: format.combine(
    format.timestamp(),
    format.errors({ stack: true }),
    format.json()
  ),
  transports: [rotate],
});

if (process.env.NODE_ENV !== "production") {
  logger.add(
    new transports.Console({
      format: format.combine(
        format.colorize(),
        format.timestamp(),
        format.printf(({ level, message, timestamp, ...meta }) => {
          const metaStr = Object.keys(meta).length ? " " + JSON.stringify(meta) : "";
          return `${timestamp} ${level}: ${message}${metaStr}`;
        })
      ),
    })
  );
}
// ============================================

const PORT = Number(process.env.PORT) || 2020;
const ORIGIN = process.env.CORS_ORIGIN || "*";
const API_KEY = process.env.API_KEY || null;
const DEFAULT_WIDTH = process.env.THERMAL_WIDTH || "80mm";

const app = express();
app.use(cors({ origin: ORIGIN === "*" ? true : ORIGIN }));
app.use(bodyParser.json({ limit: "50mb" }));

// ==== Request logging middleware ====
function summarizeBody(b) {
  if (!b || typeof b !== "object") return undefined;
  const out = {};
  if (b.printerShare) out.printerShare = b.printerShare;
  if (b.printer) out.printer = b.printer;
  if (typeof b.encoding === "string") out.encoding = b.encoding;
  if (typeof b.width === "string") out.width = b.width;
  if (typeof b.heightPx === "number") out.heightPx = b.heightPx;
  if (typeof b.rawBase64 === "string") out.rawBase64_len = b.rawBase64.length;
  if (typeof b.dataBase64 === "string") out.dataBase64_len = b.dataBase64.length;
  if (typeof b.pdfBase64 === "string") out.pdfBase64_len = b.pdfBase64.length;
  if (typeof b.html === "string") out.html_len = b.html.length;
  if (typeof b.data === "string") out.data_preview = b.data.slice(0, 120);
  return out;
}

app.use((req, res, next) => {
  req.id = randomUUID();
  const start = process.hrtime.bigint();
  logger.info("REQ", {
    id: req.id,
    method: req.method,
    url: req.originalUrl,
    ip: req.ip,
    body: summarizeBody(req.body),
  });
  res.on("finish", () => {
    const durMs = Number(process.hrtime.bigint() - start) / 1e6;
    logger.info("RES", {
      id: req.id,
      status: res.statusCode,
      duration_ms: Math.round(durMs),
    });
  });
  next();
});
// ====================================

// ---- Helpers ----
const now = () => new Date().toISOString();

function writeTempFile(buffer, ext) {
  const tempFilePath = path.join(
    os.tmpdir(),
    `print-${Date.now()}-${Math.random().toString(16).slice(2)}.${ext}`
  );
  fs.writeFileSync(tempFilePath, buffer);
  return tempFilePath;
}

function buildSharePath(name) {
  // If already UNC path (\\host\share), return as-is. Otherwise assume local share name.
  if (name.startsWith("\\\\")) return name;
  return `\\\\127.0.0.1\\${name}`;
}

function copyBinaryToPrinter(tempFilePath, sharePath) {
  // Uses Windows copy binary mode to push data directly to printer share (RAW)
  return new Promise((resolve, reject) => {
    const cmd = `copy /b "${tempFilePath}" "${sharePath}"`;
    exec(cmd, { windowsHide: true }, (err, stdout, stderr) => {
      // Always clean up the temp file
      fs.unlink(tempFilePath, () => {});
      if (err) return reject(new Error(stderr || err.message));
      resolve(stdout);
    });
  });
}

// ---- Security (optional) ----
app.use((req, res, next) => {
  if (!API_KEY) return next();
  const key = req.get("x-api-key");
  if (!key || key !== API_KEY) {
    return res.status(401).json({ success: false, error: "Unauthorized" });
  }
  next();
});

// ---- Health ----
app.get("/", (req, res) => {
  res.json({ ok: true, service: "print-server", time: now() });
});

// ---- Enumerate printers (for PDF path) ----
app.get("/printers", async (req, res) => {
  try {
    const printers = await getPrinters();
    const list = printers.map((p) => (typeof p === "string" ? p : p.name));
    res.json({ success: true, printers: list });
  } catch (e) {
    logger.error(now(), "PRINTERS_ERROR", e);
    res.status(500).json({ success: false, error: e.message });
  }
});

// ---- RAW (ESC/POS) ----
// Body: { rawBase64: string (required), printerShare: "ShareName" | "\\\\HOST\\Share" (required), encoding?: "base64"|"hex" }
app.post("/print-raw", async (req, res) => {
  try {
    const { rawBase64, printerShare, encoding } = req.body || {};
    if (!rawBase64 || !printerShare) {
      return res
        .status(400)
        .json({ success: false, error: "rawBase64 and printerShare are required" });
    }
    const buffer = Buffer.from(rawBase64, encoding === "hex" ? "hex" : "base64");
    const temp = writeTempFile(buffer, "bin");
    const sharePath = buildSharePath(printerShare);
    await copyBinaryToPrinter(temp, sharePath);
    logger.info("RAW_OK", { id: req.id, sharePath });
    res.json({ success: true, message: `Sent RAW to ${sharePath}` });
  } catch (e) {
    logger.error("RAW_ERROR", { id: req.id, error: e.message, stack: e.stack });
    res.status(500).json({ success: false, error: e.message });
  }
});

// ---- LABEL (TSPL/ZPL/CPCL) ----
// Body (choose one):
//  { data: "TSPL/ZPL text", printerShare: "ShareName", newline?: true }
//  { dataBase64: "...", printerShare: "ShareName" }
app.post("/print-label", async (req, res) => {
  try {
    const { data, dataBase64, printerShare, newline = true } = req.body || {};
    if (!printerShare || (!data && !dataBase64)) {
      return res
        .status(400)
        .json({ success: false, error: "printerShare and data or dataBase64 are required" });
    }
    let buffer;
    if (dataBase64) {
      buffer = Buffer.from(dataBase64, "base64");
    } else {
      const str = String(data);
      buffer = Buffer.from(newline ? str.replace(/\r?\n/g, "\r\n") : str, "utf8");
    }
    const temp = writeTempFile(buffer, "lbl");
    const sharePath = buildSharePath(printerShare);
    await copyBinaryToPrinter(temp, sharePath);
    logger.info("LABEL_OK", { id: req.id, sharePath });
    res.json({ success: true, message: `Sent LABEL to ${sharePath}` });
  } catch (e) {
    logger.error("LABEL_ERROR", { id: req.id, error: e.message, stack: e.stack });
    res.status(500).json({ success: false, error: e.message });
  }
});

// ---- PDF (base64) -> silent print via driver ----
// Body: { pdfBase64: string, printer: string }
app.post("/print-pdf", async (req, res) => {
  try {
    const { pdfBase64, printer } = req.body || {};
    if (!pdfBase64 || !printer) {
      return res
        .status(400)
        .json({ success: false, error: "pdfBase64 and printer are required" });
    }
    const buffer = Buffer.from(pdfBase64, "base64");
    const temp = writeTempFile(buffer, "pdf");
    await printPdf(temp, { printer, scale: "noscale" });
    fs.unlink(temp, () => {});
    logger.info("PDF_OK", { id: req.id, printer });
    res.json({ success: true, message: `Sent PDF to ${printer}` });
  } catch (e) {
    logger.error("PDF_ERROR", { id: req.id, error: e.message, stack: e.stack });
    res.status(500).json({ success: false, error: e.message });
  }
});

// ---- HTML -> PDF -> silent print ----
// Body: { html: string, printer: string, width?: "80mm", heightPx?: number }
app.post("/print-html", async (req, res) => {
  const { html, printer, width = DEFAULT_WIDTH, heightPx } = req.body || {};
  if (!html || !printer) {
    return res.status(400).json({ success: false, error: "html and printer are required" });
  }
  let browser;
  try {
    const puppeteer = require("puppeteer");
    browser = await puppeteer.launch({
      headless: true,
      args: ["--no-sandbox", "--disable-setuid-sandbox"],
    });
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: "networkidle0" });

    let finalHeight = heightPx;
    if (!finalHeight) {
      finalHeight = await page.evaluate(() => {
        const el = document.querySelector(".page") || document.body;
        return Math.ceil(el.scrollHeight);
      });
      if (!finalHeight || finalHeight < 100) finalHeight = 800;
    }

    const pdfBuffer = await page.pdf({
      width,
      height: `${finalHeight}px`,
      printBackground: true,
      margin: { top: "0px", right: "0px", bottom: "0px", left: "0px" },
    });

    const temp = writeTempFile(pdfBuffer, "pdf");
    await printPdf(temp, { printer, scale: "noscale" });
    fs.unlink(temp, () => {});
    logger.info("HTML_OK", { id: req.id, printer, width, heightPx: finalHeight });
    res.json({ success: true, message: `Sent HTML as PDF to ${printer}` });
  } catch (e) {
    logger.error("HTML_ERROR", { id: req.id, error: e.message, stack: e.stack });
    res.status(500).json({ success: false, error: e.message });
  } finally {
    if (browser) await browser.close();
  }
});

// ---- Fallback error handler ----
app.use((err, req, res, next) => {
  logger.error("UNCAUGHT", { id: (req && req.id) || null, error: err.message, stack: err.stack });
  res.status(500).json({ success: false, error: "Internal Server Error" });
});

app.listen(PORT, () => {
  logger.info(`🖨️ Print server listening on http://localhost:${PORT}`);
  if (ORIGIN !== "*") logger.info(`CORS origin: ${ORIGIN}`);
  logger.info(`RAW printing needs a Windows printer SHARE name (e.g. \\HOST\\Share or just ShareName).`);
});
