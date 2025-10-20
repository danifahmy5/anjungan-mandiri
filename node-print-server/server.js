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
  if (typeof b.rawData === "string") out.rawData_len = b.rawData.length;
  if (typeof b.payload === "string") out.payload_len = b.payload.length;
  if (typeof b.rawPayload === "string") out.rawPayload_len = b.rawPayload.length;
  if (typeof b.raw === "string") out.raw_len = b.raw.length;
  if (typeof b.rawHex === "string") out.rawHex_len = b.rawHex.length;
  if (Array.isArray(b.rawBytes)) out.rawBytes_len = b.rawBytes.length;
  if (Array.isArray(b.bytes)) out.bytes_len = b.bytes.length;
  if (Array.isArray(b.commands)) out.commands_len = b.commands.length;
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

const BASE64_REGEX = /^[0-9a-z+/=]+$/i;
const HEX_REGEX = /^[0-9a-f]+$/i;
const STRING_PAYLOAD_FIELDS = [
  "rawBase64",
  "dataBase64",
  "raw",
  "rawData",
  "payload",
  "rawPayload",
  "data",
  "text",
  "command",
  "commands",
  "lines",
  "base64",
  "base64Data",
  "bytesBase64",
  "content",
  "value",
];
const BASE64_HINT_FIELDS = new Set([
  "rawBase64",
  "dataBase64",
  "base64",
  "base64Data",
  "bytesBase64",
]);
const HEX_HINT_FIELDS = new Set(["rawHex", "hex", "hexData", "dataHex", "payloadHex"]);
const BYTE_ARRAY_FIELDS = [
  "rawBytes",
  "bytes",
  "dataBytes",
  "payloadBytes",
  "buffer",
  "rawBuffer",
];

function decodeHexString(input) {
  const normalized = input.replace(/\s+/g, "");
  if (!normalized) return null;
  if (normalized.length % 2 !== 0) {
    throw new Error("Hex payload must have an even length");
  }
  if (!HEX_REGEX.test(normalized)) {
    throw new Error("Hex payload contains invalid characters");
  }
  return Buffer.from(normalized, "hex");
}

function decodeFlexibleBase64(input) {
  const normalized = input.replace(/\s+/g, "").replace(/-/g, "+").replace(/_/g, "/");
  if (!normalized) return null;
  const bare = normalized.replace(/=+$/g, "");
  if (!BASE64_REGEX.test(bare)) return null;
  const pad = normalized.length % 4 === 0 ? 0 : 4 - (normalized.length % 4);
  const padded = normalized + "=".repeat(pad);
  try {
    const buf = Buffer.from(padded, "base64");
    if (!buf.length) return null;
    return buf;
  } catch (e) {
    return null;
  }
}

function isByteArray(value) {
  return (
    Array.isArray(value) &&
    value.length > 0 &&
    value.every(
      (v) =>
        typeof v === "number" &&
        Number.isInteger(v) &&
        v >= 0 &&
        v <= 255
    )
  );
}

function extractBufferFromBufferLike(value) {
  if (!value) return null;
  if (Buffer.isBuffer(value)) return Buffer.from(value);
  if (isByteArray(value)) return Buffer.from(value);
  if (typeof value === "object" && value && value.type === "Buffer" && Array.isArray(value.data)) {
    return Buffer.from(value.data);
  }
  return null;
}

function resolvePrinterShare(body) {
  if (!body || typeof body !== "object") return null;
  const candidates = [
    body.printerShare,
    body.printer,
    body.share,
    body.shareName,
    body.sharePath,
  ];
  for (const value of candidates) {
    if (typeof value === "string" && value.trim().length) {
      return value.trim();
    }
  }
  return null;
}


function resolveRawBuffer(body) {
  if (!body || typeof body !== "object") return null;

  const encoding =
    typeof body.encoding === "string" ? body.encoding.trim().toLowerCase() : null;

  for (const field of BYTE_ARRAY_FIELDS) {
    const candidate = extractBufferFromBufferLike(body[field]);
    if (candidate && candidate.length) return candidate;
  }

  const rawHex =
    typeof body.rawHex === "string" && body.rawHex.length ? body.rawHex : null;

  let hintedHex = null;
  if (!rawHex) {
    for (const key of HEX_HINT_FIELDS) {
      if (typeof body[key] === "string" && body[key].length) {
        hintedHex = body[key];
        break;
      }
    }
  }

  const stringCandidates = [];
  STRING_PAYLOAD_FIELDS.forEach((field) => {
    const value = body[field];
    if (typeof value === "string" && value.length) {
      stringCandidates.push({ value, field });
      return;
    }
    if (Array.isArray(value) && value.length) {
      if (isByteArray(value)) {
        stringCandidates.push({ value: Buffer.from(value), field, buffer: true });
        return;
      }
      if (value.every((v) => typeof v === "string")) {
        stringCandidates.push({ value: value.join(""), field });
      }
    }
  });

  if (!stringCandidates.length) {
    for (const [key, value] of Object.entries(body)) {
      if (typeof value === "string" && value.length) {
        stringCandidates.push({ value, field: key });
        break;
      }
      const bufferCandidate = extractBufferFromBufferLike(value);
      if (bufferCandidate && bufferCandidate.length) {
        return bufferCandidate;
      }
    }
  }

  if (rawHex) {
    const hexBuffer = decodeHexString(rawHex);
    if (hexBuffer) return hexBuffer;
  }
  if (hintedHex) {
    const hexBuffer = decodeHexString(hintedHex);
    if (hexBuffer) return hexBuffer;
  }

  if (!stringCandidates.length) return null;

  const candidate = stringCandidates[0];
  if (candidate.buffer && Buffer.isBuffer(candidate.value)) {
    return candidate.value;
  }

  const primary = candidate.value;
  const sourceField = candidate.field;

  const hintedBase64 =
    encoding === "base64" || BASE64_HINT_FIELDS.has(sourceField);
  const hintedHexField = encoding === "hex" || HEX_HINT_FIELDS.has(sourceField);

  try {
    if (hintedHexField) {
      const hexBuffer = decodeHexString(primary);
      if (!hexBuffer) throw new Error("Invalid hex payload");
      return hexBuffer;
    }
    if (hintedBase64) {
      const base64Buffer = decodeFlexibleBase64(primary);
      if (!base64Buffer) throw new Error("Invalid base64 payload");
      return base64Buffer;
    }
    if (encoding === "utf8" || encoding === "text") {
      return Buffer.from(primary, "utf8");
    }
    if (encoding === "binary" || encoding === "latin1") {
      return Buffer.from(primary, "binary");
    }

    const base64Buffer = decodeFlexibleBase64(primary);
    if (base64Buffer) return base64Buffer;

    const stripped = primary.replace(/\s+/g, "");
    if (stripped.length && stripped.length % 2 === 0 && HEX_REGEX.test(stripped)) {
      const hexBuffer = decodeHexString(primary);
      if (hexBuffer) return hexBuffer;
    }

    return Buffer.from(primary, "utf8");
  } catch (e) {
    throw new Error(`Failed to decode raw payload: ${e.message}`);
  }
}

function runPowerShell(script) {
  const normalized = script.replace(/"/g, '\\"');
  const command = `powershell.exe -NoProfile -Command "${normalized}"`;
  return new Promise((resolve, reject) => {
    exec(
      command,
      { windowsHide: true, maxBuffer: 10 * 1024 * 1024 },
      (error, stdout, stderr) => {
        if (error) return reject(new Error(stderr || error.message));
        resolve(stdout);
      }
    );
  });
}

async function getPrintersFromPowerShell() {
  const script =
    "$ErrorActionPreference='Stop'; Get-CimInstance Win32_Printer -Property DeviceID,Name,PrinterPaperNames | " +
    "Select-Object -Property DeviceID,Name,PrinterPaperNames | ConvertTo-Json -Compress -Depth 4";
  const rawOutput = await runPowerShell(script);
  const trimmed = (rawOutput || "").trim().replace(/^\uFEFF/, "");
  if (!trimmed) return [];
  let parsed;
  try {
    parsed = JSON.parse(trimmed);
  } catch (e) {
    throw new Error(`Failed to parse printer list: ${e.message}`);
  }
  const entries = Array.isArray(parsed) ? parsed : [parsed];
  return entries
    .filter(Boolean)
    .map((p) => ({
      deviceId: p.DeviceID || p.Name || "",
      name: p.Name || p.DeviceID || "",
      paperSizes: Array.isArray(p.PrinterPaperNames) ? p.PrinterPaperNames : [],
    }))
    .filter((p) => p.name || p.deviceId);
}

async function enumeratePrinters() {
  try {
    const printers = await getPrinters();
    if (Array.isArray(printers) && printers.length > 0) {
      return printers;
    }
    logger.warn("PRINTERS_FALLBACK_EMPTY", { reason: "pdf-to-printer returned empty list" });
  } catch (e) {
    logger.warn("PRINTERS_FALLBACK_ERROR", { error: e.message });
  }
  const fallback = await getPrintersFromPowerShell();
  if (!fallback.length) {
    logger.warn("PRINTERS_FALLBACK_EMPTY", { reason: "PowerShell returned empty list" });
  }
  return fallback;
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
    const printers = await enumeratePrinters();
    const list = printers
      .map((p) => {
        if (!p) return null;
        if (typeof p === "string") return p;
        return p.name || p.deviceId || null;
      })
      .filter((name) => typeof name === "string" && name.length > 0);
    res.json({ success: true, printers: list });
  } catch (e) {
    logger.error("PRINTERS_ERROR", { id: req.id || null, error: e.message, stack: e.stack });
    res.status(500).json({ success: false, error: e.message });
  }
});

// ---- RAW (ESC/POS) ----
// Body can include:
//  { rawBase64 | dataBase64 | raw | rawData | rawHex | rawBytes | bytes | commands | payload | text, printerShare | printer }
// Optional: encoding: "base64" | "hex" | "utf8" | "text" | "binary"
app.post("/print-raw", async (req, res) => {
  try {
    const shareCandidate = resolvePrinterShare(req.body);
    if (!shareCandidate) {
      return res.status(400).json({
        success: false,
        error: "printerShare (or printer/share/shareName) is required",
      });
    }
    const buffer = resolveRawBuffer(req.body);
    if (!buffer || !buffer.length) {
      logger.warn("RAW_MISSING_PAYLOAD", {
        id: req.id,
        keys: Array.isArray(req.body) ? [] : Object.keys(req.body || {}),
      });
      return res.status(400).json({
        success: false,
        error:
          "Raw payload is required. Provide rawBase64, dataBase64, raw, rawHex, or rawBytes.",
      });
    }
    const temp = writeTempFile(buffer, "bin");
    const sharePath = buildSharePath(shareCandidate);
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
