"use strict";
const electron = require("electron");
const path = require("path");
const fs$1 = require("fs");
const utils = require("@electron-toolkit/utils");
const fs = require("node:fs");
const path$1 = require("node:path");
const Database = require("better-sqlite3");
const crypto = require("crypto");
const url = require("url");
const canvas = require("@napi-rs/canvas");
const Tesseract = require("tesseract.js");
const jimp = require("jimp");
const module$1 = require("module");
const pdfjsLib = require("pdfjs-dist/legacy/build/pdf.mjs");
const jsQR = require("jsqr");
function _interopNamespaceDefault(e) {
  const n = Object.create(null, { [Symbol.toStringTag]: { value: "Module" } });
  if (e) {
    for (const k in e) {
      if (k !== "default") {
        const d = Object.getOwnPropertyDescriptor(e, k);
        Object.defineProperty(n, k, d.get ? d : {
          enumerable: true,
          get: () => e[k]
        });
      }
    }
  }
  n.default = e;
  return Object.freeze(n);
}
const pdfjsLib__namespace = /* @__PURE__ */ _interopNamespaceDefault(pdfjsLib);
const icon = path.join(__dirname, "../../resources/icon.png");
let db$1;
let insertStatement;
let recentStatement;
function tableExists(tableName) {
  const row = db$1.prepare(
    `
        SELECT name
        FROM sqlite_master
        WHERE type = 'table' AND name = ?
      `
  ).get(tableName);
  return Boolean(row);
}
function migrateLegacyAadhaarRows() {
  if (!tableExists("aadhaar_cards") || !tableExists("id_cards")) {
    return;
  }
  db$1.exec(`
    INSERT INTO id_cards (
      card_type,
      full_name,
      id_number,
      date_of_birth,
      gender,
      address,
      qr_text,
      details_json,
      photo_base64,
      qr_image_base64,
      source_file_name,
      created_at
    )
    SELECT
      'aadhaar',
      full_name,
      aadhaar_number,
      date_of_birth,
      gender,
      address,
      qr_text,
      details_json,
      photo_base64,
      qr_image_base64,
      source_file_name,
      created_at
    FROM aadhaar_cards old
    WHERE NOT EXISTS (
      SELECT 1
      FROM id_cards ic
      WHERE ic.card_type = 'aadhaar'
        AND IFNULL(ic.full_name, '') = IFNULL(old.full_name, '')
        AND IFNULL(ic.id_number, '') = IFNULL(old.aadhaar_number, '')
        AND IFNULL(ic.source_file_name, '') = IFNULL(old.source_file_name, '')
        AND IFNULL(ic.created_at, '') = IFNULL(old.created_at, '')
    )
  `);
}
function ensureDbReady() {
  if (db$1) {
    return;
  }
  const dbFolderPath = path$1.join(electron.app.getPath("userData"), "db");
  if (!fs.existsSync(dbFolderPath)) {
    fs.mkdirSync(dbFolderPath, { recursive: true });
  }
  const dbFilePath = path$1.join(dbFolderPath, "id_cards.sqlite");
  db$1 = new Database(dbFilePath);
  db$1.pragma("journal_mode = WAL");
  db$1.exec(`
        CREATE TABLE IF NOT EXISTS id_cards (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            card_type TEXT NOT NULL,
            full_name TEXT,
            id_number TEXT,
            date_of_birth TEXT,
            gender TEXT,
            address TEXT,
            qr_text TEXT,
            details_json TEXT NOT NULL,
            photo_base64 TEXT,
            qr_image_base64 TEXT,
            source_file_name TEXT,
            created_at TEXT NOT NULL DEFAULT (datetime('now'))
        )
    `);
  migrateLegacyAadhaarRows();
  insertStatement = db$1.prepare(`
        INSERT INTO id_cards (
            card_type,
            full_name,
            id_number,
            date_of_birth,
            gender,
            address,
            qr_text,
            details_json,
            photo_base64,
            qr_image_base64,
            source_file_name
        ) VALUES (
            @card_type,
            @full_name,
            @id_number,
            @date_of_birth,
            @gender,
            @address,
            @qr_text,
            @details_json,
            @photo_base64,
            @qr_image_base64,
            @source_file_name
        )
    `);
  recentStatement = db$1.prepare(`
        SELECT
            id,
        card_type,
            full_name,
        id_number,
            date_of_birth,
            gender,
            address,
            qr_text,
            details_json,
            photo_base64,
            qr_image_base64,
            source_file_name,
            created_at
        FROM id_cards
        ORDER BY id DESC
        LIMIT ?
    `);
}
function saveIdentityCard(record) {
  ensureDbReady();
  const result = insertStatement.run({
    card_type: record.cardType || "aadhaar",
    full_name: record.fullName ?? null,
    id_number: record.idNumber ?? null,
    date_of_birth: record.dateOfBirth ?? null,
    gender: record.gender ?? null,
    address: record.address ?? null,
    qr_text: record.qrText ?? null,
    details_json: JSON.stringify(record.details ?? {}),
    photo_base64: record.photoBase64 ?? null,
    qr_image_base64: record.qrImageBase64 ?? null,
    source_file_name: record.sourceFileName ?? null
  });
  return Number(result.lastInsertRowid);
}
function getRecentIdentityCards(limit = 20) {
  ensureDbReady();
  return recentStatement.all(limit).map((row) => ({
    ...row,
    details: row.details_json ? JSON.parse(row.details_json) : {}
  }));
}
let db = null;
function getDB() {
  if (db) return db;
  const dbDir = path.join(electron.app.getPath("userData"), "db");
  fs$1.mkdirSync(dbDir, { recursive: true });
  const dbPath = path.join(dbDir, "extraction.sqlite");
  db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  db.exec(`
    CREATE TABLE IF NOT EXISTS extracted_data (
      id TEXT PRIMARY KEY,
      original_name TEXT NOT NULL,
      file_path TEXT NOT NULL,
      images_json TEXT NOT NULL DEFAULT '[]',
      document_type TEXT NOT NULL DEFAULT 'UNKNOWN',
      status TEXT NOT NULL DEFAULT 'pending',
      error TEXT,
      structured_json TEXT NOT NULL DEFAULT '{}',
      extracted_at TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_ed_status ON extracted_data(status);
    CREATE INDEX IF NOT EXISTS idx_ed_created ON extracted_data(created_at DESC);
  `);
  return db;
}
const DOCUMENT_TYPES = /* @__PURE__ */ new Set([
  "AADHAAR",
  "PAN",
  "ELECTION_CARD",
  "DRIVING_LICENCE",
  "ABHA",
  "AYUSHMAN",
  "E-SHRAM",
  "UNKNOWN"
]);
const STATUS_TYPES = /* @__PURE__ */ new Set(["pending", "processing", "completed", "failed"]);
const normDocType = (v) => DOCUMENT_TYPES.has(v) ? v : "UNKNOWN";
const normStatus = (v) => STATUS_TYPES.has(v) ? v : "pending";
function safeParseJSON(val, fallback) {
  try {
    return val ? JSON.parse(val) : fallback;
  } catch {
    return fallback;
  }
}
function rowToDoc(row) {
  if (!row) return null;
  return {
    _id: row.id,
    originalName: row.original_name,
    filePath: row.file_path,
    images: safeParseJSON(row.images_json, []),
    documentType: row.document_type,
    status: row.status,
    error: row.error,
    structured: safeParseJSON(row.structured_json, {}),
    extractedAt: row.extracted_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}
class ExtractedData {
  constructor(data = {}) {
    const now = (/* @__PURE__ */ new Date()).toISOString();
    this._id = data._id || crypto.randomUUID();
    this.originalName = data.originalName || "";
    this.filePath = data.filePath || "";
    this.images = Array.isArray(data.images) ? data.images : [];
    this.documentType = normDocType(data.documentType || "UNKNOWN");
    this.status = normStatus(data.status || "pending");
    this.error = data.error ?? null;
    this.structured = data.structured && typeof data.structured === "object" ? data.structured : {};
    this.extractedAt = data.extractedAt || now;
    this.createdAt = data.createdAt || now;
    this.updatedAt = data.updatedAt || now;
  }
  async save() {
    const d = getDB();
    this.updatedAt = (/* @__PURE__ */ new Date()).toISOString();
    d.prepare(
      `
      INSERT INTO extracted_data
        (id, original_name, file_path, images_json, document_type, status, error,
         structured_json, extracted_at, created_at, updated_at)
      VALUES
        (@id, @original_name, @file_path, @images_json, @document_type, @status, @error,
         @structured_json, @extracted_at, @created_at, @updated_at)
    `
    ).run({
      id: this._id,
      original_name: this.originalName,
      file_path: this.filePath,
      images_json: JSON.stringify(this.images),
      document_type: this.documentType,
      status: this.status,
      error: this.error,
      structured_json: JSON.stringify(this.structured),
      extracted_at: this.extractedAt,
      created_at: this.createdAt,
      updated_at: this.updatedAt
    });
    return this;
  }
  static async findById(id) {
    const d = getDB();
    const row = d.prepare("SELECT * FROM extracted_data WHERE id = ?").get(id);
    return rowToDoc(row);
  }
  static async findByIdAndUpdate(id, update) {
    const d = getDB();
    const now = (/* @__PURE__ */ new Date()).toISOString();
    const sets = ["updated_at = @updated_at"];
    const params = { id, updated_at: now };
    if (update.status !== void 0) {
      sets.push("status = @status");
      params.status = normStatus(update.status);
    }
    if (update.error !== void 0) {
      sets.push("error = @error");
      params.error = update.error;
    }
    if (update.structured !== void 0) {
      sets.push("structured_json = @structured_json");
      params.structured_json = JSON.stringify(update.structured);
    }
    if (update.images !== void 0) {
      sets.push("images_json = @images_json");
      params.images_json = JSON.stringify(update.images);
    }
    d.prepare(`UPDATE extracted_data SET ${sets.join(", ")} WHERE id = @id`).run(params);
    return ExtractedData.findById(id);
  }
  static find() {
    return {
      sort(spec = {}) {
        this._sort = spec;
        return this;
      },
      async exec() {
        const d = getDB();
        const rows = d.prepare("SELECT * FROM extracted_data ORDER BY created_at DESC").all();
        return rows.map(rowToDoc);
      },
      then(resolve, reject) {
        return this.exec().then(resolve, reject);
      }
    };
  }
}
global.Canvas = canvas.Canvas;
global.Image = canvas.Image;
global.ImageData = canvas.ImageData;
global.HTMLCanvasElement = canvas.Canvas;
global.HTMLImageElement = canvas.Image;
global.HTMLElement = class HTMLElement {
};
global.HTMLVideoElement = class HTMLVideoElement {
};
if (!global.window) global.window = global;
if (!global.navigator) global.navigator = { userAgent: "node" };
if (!global.location) global.location = { href: url.pathToFileURL(process.cwd() + "/").href };
if (!global.document) {
  global.document = {
    createElement: (tag) => {
      if (tag === "canvas") {
        const canvas$1 = canvas.createCanvas(1, 1);
        canvas$1.style = {};
        canvas$1.tagName = "CANVAS";
        canvas$1.nodeName = "CANVAS";
        canvas$1.nodeType = 1;
        canvas$1.contains = () => false;
        canvas$1.ownerDocument = global.document;
        canvas$1.addEventListener = () => {
        };
        canvas$1.removeEventListener = () => {
        };
        return canvas$1;
      }
      if (tag === "img") {
        const img = new canvas.Image();
        img.style = {};
        img.tagName = "IMG";
        img.nodeName = "IMG";
        img.nodeType = 1;
        img.ownerDocument = global.document;
        img.addEventListener = () => {
        };
        img.removeEventListener = () => {
        };
        return img;
      }
      return {
        style: {},
        tagName: tag.toUpperCase(),
        nodeName: tag.toUpperCase(),
        nodeType: 1,
        onpageshow: null,
        contains: () => false,
        ownerDocument: global.document,
        getElementsByTagName: () => [],
        addEventListener: () => {
        },
        removeEventListener: () => {
        }
      };
    },
    createElementNS: (_, tag) => global.document.createElement(tag),
    documentElement: { style: {} },
    body: { style: {} },
    // Added to support some internal pdf.js checks
    nodeType: 9
  };
}
delete global.Path2D;
delete global.OffscreenCanvas;
if (!global.btoa) global.btoa = (str) => Buffer.from(str, "binary").toString("base64");
if (!global.atob) global.atob = (str) => Buffer.from(str, "base64").toString("binary");
if (!global.requestAnimationFrame) {
  global.requestAnimationFrame = (callback) => setTimeout(callback, 0);
}
if (!global.Blob) {
  global.Blob = class Blob {
    constructor(parts, options) {
      this.parts = parts || [];
      this.options = options || {};
      this.size = this.parts.reduce((acc, part) => acc + (part.length || 0), 0);
    }
  };
}
if (!global.URL) global.URL = {};
global.URL.createObjectURL = (obj) => {
  if (obj instanceof global.Blob) {
    try {
      const buffers = obj.parts.map((p) => {
        if (typeof p === "string") return Buffer.from(p);
        if (ArrayBuffer.isView(p)) return Buffer.from(p.buffer, p.byteOffset, p.byteLength);
        if (p instanceof ArrayBuffer) return Buffer.from(p);
        return Buffer.from([]);
      });
      const concatenated = Buffer.concat(buffers);
      const type = obj.options.type || "application/octet-stream";
      return `data:${type};base64,${concatenated.toString("base64")}`;
    } catch (err) {
      console.warn("Polyfill createObjectURL failed:", err);
      return "";
    }
  }
  return "";
};
global.URL.revokeObjectURL = () => {
};
function preprocessImageForOCR(image, strategy = "default") {
  const processed = image.clone();
  switch (strategy) {
    case "default":
      return processed.greyscale().contrast(0.3).normalize();
    case "high-contrast":
      return processed.greyscale().contrast(0.6).brightness(0.1).normalize();
    case "sharpen":
      return processed.greyscale().convolute([
        [0, -1, 0],
        [-1, 5, -1],
        [0, -1, 0]
      ]).contrast(0.4).normalize();
    case "threshold":
      return processed.greyscale().contrast(0.5).normalize().threshold({ max: 128 });
    case "aggressive":
      return processed.greyscale().contrast(0.8).brightness(0.2).convolute([
        [-1, -1, -1],
        [-1, 9, -1],
        [-1, -1, -1]
      ]).normalize().threshold({ max: 140 });
    default:
      return processed.greyscale().normalize();
  }
}
async function performEnhancedOCR(imagePath, languages, outputDir, prefix = "preprocessed", options = {}) {
  console.log(`   🔬 Enhanced OCR with multiple preprocessing strategies...`);
  const strategies = ["default", "high-contrast", "sharpen", "threshold", "aggressive"];
  const results = [];
  try {
    const originalImage = typeof imagePath === "string" ? await jimp.Jimp.read(imagePath) : imagePath;
    for (const strategy of strategies) {
      try {
        console.log(`      Testing ${strategy} preprocessing...`);
        const preprocessed = preprocessImageForOCR(originalImage, strategy);
        const tempPath = path.join(outputDir, `${prefix}-${strategy}.png`);
        await preprocessed.write(tempPath);
        const ocrOptions = {
          logger: () => {
          }
          // Suppress verbose logs
        };
        if (options.charWhitelist) {
          ocrOptions.tessedit_char_whitelist = options.charWhitelist;
        }
        const ocrResult = await Promise.race([
          Tesseract.recognize(tempPath, languages, ocrOptions),
          new Promise(
            (_, reject) => setTimeout(() => reject(new Error(`OCR timeout for ${strategy}`)), 3e4)
          )
        ]);
        const text = ocrResult.data.text;
        const confidence = ocrResult.data.confidence || 0;
        results.push({
          strategy,
          text,
          confidence,
          length: text.length
        });
        console.log(`      ✓ ${strategy}: ${text.length} chars, ${confidence.toFixed(1)}% confidence`);
        if (fs$1.existsSync(tempPath)) {
          fs$1.unlinkSync(tempPath);
        }
      } catch (err) {
        console.warn(`      ⚠️ ${strategy} failed:`, err.message);
      }
    }
    if (results.length === 0) {
      throw new Error("All preprocessing strategies failed");
    }
    results.sort((a, b) => {
      if (Math.abs(a.confidence - b.confidence) > 10) {
        return b.confidence - a.confidence;
      }
      return b.length - a.length;
    });
    const best = results[0];
    console.log(`   ✅ Best result: ${best.strategy} (${best.length} chars, ${best.confidence.toFixed(1)}% confidence)`);
    return best;
  } catch (err) {
    console.error(`   ❌ Enhanced OCR failed:`, err.message);
    console.log(`   🔄 Falling back to basic OCR...`);
    const fallbackResult = await Tesseract.recognize(
      typeof imagePath === "string" ? imagePath : imagePath,
      languages,
      options.charWhitelist ? { tessedit_char_whitelist: options.charWhitelist } : {}
    );
    return {
      text: fallbackResult.data.text,
      confidence: fallbackResult.data.confidence || 0,
      strategy: "fallback"
    };
  }
}
const _require = module$1.createRequire(require("url").pathToFileURL(__filename).href);
pdfjsLib__namespace.GlobalWorkerOptions.workerSrc = url.pathToFileURL(
  _require.resolve("pdfjs-dist/legacy/build/pdf.worker.mjs")
).href;
const standardFontDataUrl = url.pathToFileURL(
  path.join(path.dirname(_require.resolve("pdfjs-dist/package.json")), "standard_fonts")
).href + "/";
const cMapUrl = url.pathToFileURL(
  path.join(path.dirname(_require.resolve("pdfjs-dist/package.json")), "cmaps")
).href + "/";
class NodeCanvasFactory {
  create(width, height) {
    const w = Math.max(width, 1);
    const h = Math.max(height, 1);
    const canvas$1 = canvas.createCanvas(w, h);
    canvas$1.style = {};
    canvas$1.tagName = "CANVAS";
    canvas$1.nodeName = "CANVAS";
    canvas$1.nodeType = 1;
    canvas$1.ownerDocument = global.document;
    canvas$1.contains = () => false;
    canvas$1.addEventListener = () => {
    };
    canvas$1.removeEventListener = () => {
    };
    return { canvas: canvas$1, context: canvas$1.getContext("2d") };
  }
  reset(ref, width, height) {
    if (ref?.canvas) {
      ref.canvas.width = Math.max(width, 1);
      ref.canvas.height = Math.max(height, 1);
    }
  }
  destroy(ref) {
    if (ref?.canvas) {
      ref.canvas.width = 0;
      ref.canvas.height = 0;
      ref.canvas = null;
      ref.context = null;
    }
  }
}
async function renderPDFPagesToImages(pdfPath, outputDir, password = null) {
  const data = new Uint8Array(fs$1.readFileSync(pdfPath));
  const pdf = await pdfjsLib__namespace.getDocument({
    data,
    password: password || "",
    useSystemFonts: true,
    standardFontDataUrl,
    cMapUrl,
    cMapPacked: true
  }).promise;
  fs$1.mkdirSync(outputDir, { recursive: true });
  for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
    const page = await pdf.getPage(pageNum);
    const viewport = page.getViewport({ scale: 3 });
    const w = Math.floor(viewport.width);
    const h = Math.floor(viewport.height);
    const canvas$1 = canvas.createCanvas(w, h);
    const ctx = canvas$1.getContext("2d");
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, w, h);
    const factory = new NodeCanvasFactory();
    try {
      await page.render({ canvasContext: ctx, viewport, canvasFactory: factory }).promise;
    } catch (renderErr) {
      console.warn(`renderPDFPagesToImages page ${pageNum} error:`, renderErr.message);
    }
    const pagePath = path.join(outputDir, `page-${pageNum}.png`);
    fs$1.writeFileSync(pagePath, canvas$1.toBuffer("image/png"));
    console.log(`  ✅ Rendered page ${pageNum} → ${pagePath}`);
  }
  await pdf.cleanup();
}
const extractText = async (filePath, options = {}) => {
  console.log(`extractText → Starting: ${filePath}`);
  try {
    const data = new Uint8Array(fs$1.readFileSync(filePath));
    const pdf = await pdfjsLib__namespace.getDocument({
      data,
      password: options.password,
      useSystemFonts: true,
      standardFontDataUrl,
      cMapUrl,
      cMapPacked: true
    }).promise;
    let text = "";
    for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
      const page = await pdf.getPage(pageNum);
      const content = await page.getTextContent();
      const items = content.items.sort(
        (a, b) => Math.abs(a.transform[5] - b.transform[5]) < 5 ? a.transform[4] - b.transform[4] : b.transform[5] - a.transform[5]
      );
      let lastY = null;
      for (const item of items) {
        if (lastY !== null) {
          text += Math.abs(item.transform[5] - lastY) > 5 ? "\n" : " ";
        }
        text += item.str;
        lastY = item.transform[5];
      }
      text += "\n";
    }
    console.log(`extractText → Extracted from ${pdf.numPages} pages`);
    return { text, pageCount: pdf.numPages };
  } catch (err) {
    console.error("extractText ❌", err);
    throw err;
  }
};
const extractImages = async (filePath, outputDir, password = null, options = {}) => {
  console.log(`extractImages → Scanning PDF for embedded images`);
  const { scale = 2, minSize = 100 } = options;
  const data = new Uint8Array(fs$1.readFileSync(filePath));
  const pdf = await pdfjsLib__namespace.getDocument({
    data,
    password,
    useSystemFonts: true,
    standardFontDataUrl,
    cMapUrl,
    cMapPacked: true
  }).promise;
  const imageDir = path.resolve(outputDir);
  fs$1.mkdirSync(imageDir, { recursive: true });
  const imagePaths = [];
  for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
    const page = await pdf.getPage(pageNum);
    const pageImage = await renderPageAsImage(page, pageNum, outputDir, scale);
    if (pageImage) imagePaths.push(pageImage);
    const operators = await page.getOperatorList();
    for (let i = 0; i < operators.fnArray.length; i++) {
      const fn = operators.fnArray[i];
      if (fn === pdfjsLib__namespace.OPS.paintImageXObject || fn === pdfjsLib__namespace.OPS.paintInlineImageXObject || fn === pdfjsLib__namespace.OPS.paintImageMaskXObject) {
        try {
          const args = operators.argsArray[i];
          const imgKey = args[0];
          let img = await new Promise((r) => page.objs.get(imgKey, r));
          if (!img) img = await new Promise((r) => page.commonObjs.get(imgKey, r));
          if (img?.data)
            await saveEmbeddedImage(img, pageNum, i, imageDir, minSize, imagePaths);
        } catch (err) {
          console.warn(`extractImages ⚠️ Skipped image on page ${pageNum}`, err.message);
        }
      }
    }
  }
  console.log(`extractImages → Total: ${imagePaths.length}`);
  return imagePaths;
};
async function saveEmbeddedImage(img, pageNum, index, imageDir, minSize, imagePaths) {
  const { width, height, data } = img;
  if (width < minSize || height < minSize) return;
  if (!data || data.length === 0) return;
  try {
    const canvas$1 = canvas.createCanvas(width, height);
    const ctx = canvas$1.getContext("2d");
    const imageData = ctx.createImageData(width, height);
    const totalPixels = width * height;
    const expectedRGBA = totalPixels * 4;
    if (data.length === expectedRGBA) {
      imageData.data.set(data);
    } else if (data.length === totalPixels * 3) {
      for (let i = 0, j = 0; i < data.length; i += 3, j += 4) {
        imageData.data[j] = data[i];
        imageData.data[j + 1] = data[i + 1];
        imageData.data[j + 2] = data[i + 2];
        imageData.data[j + 3] = 255;
      }
    } else if (data.length === totalPixels) {
      for (let i = 0, j = 0; i < data.length; i++, j += 4) {
        const v = data[i];
        imageData.data[j] = v;
        imageData.data[j + 1] = v;
        imageData.data[j + 2] = v;
        imageData.data[j + 3] = 255;
      }
    } else {
      imageData.data.fill(255);
      imageData.data.set(data.slice(0, Math.min(data.length, imageData.data.length)));
    }
    ctx.putImageData(imageData, 0, 0);
    const name = `img-p${pageNum}-${Date.now()}-${index}.png`;
    const savePath = path.join(imageDir, name);
    const buffer = canvas$1.toBuffer("image/png", { compressionLevel: 6 });
    if (!buffer || buffer.length < 100) return;
    fs$1.writeFileSync(savePath, buffer);
    if (fs$1.existsSync(savePath) && fs$1.statSync(savePath).size > 100) {
      imagePaths.push(`/images/${path.basename(imageDir)}/${name}`);
    }
  } catch (err) {
    console.error(`saveEmbeddedImage`, err.message);
  }
}
async function renderPageAsImage(page, pageNum, outputDir, scale = 2) {
  try {
    const viewport = page.getViewport({ scale });
    const w = Math.floor(viewport.width);
    const h = Math.floor(viewport.height);
    if (!w || !h) return null;
    const canvas$1 = canvas.createCanvas(w, h);
    const ctx = canvas$1.getContext("2d");
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, w, h);
    const factory = new NodeCanvasFactory();
    try {
      await page.render({ canvasContext: ctx, viewport, canvasFactory: factory }).promise;
    } catch (renderErr) {
      console.warn(`renderPageAsImage page ${pageNum}:`, renderErr.message);
      return null;
    }
    const name = `page-${pageNum}-${Date.now()}.png`;
    const savePath = path.join(outputDir, name);
    fs$1.mkdirSync(outputDir, { recursive: true });
    fs$1.writeFileSync(savePath, canvas$1.toBuffer("image/png"));
    return `/images/${path.basename(outputDir)}/${name}`;
  } catch (err) {
    console.error(`renderPageAsImage page ${pageNum}:`, err.message);
    return null;
  }
}
const performOCR = async (imagePaths) => {
  let result = "";
  const worker = await Tesseract.createWorker("hin+eng");
  try {
    for (const imgPath of imagePaths) {
      const local = path.resolve(imgPath.replace(/^\//, ""));
      if (fs$1.existsSync(local)) {
        const {
          data: { text }
        } = await worker.recognize(local);
        result += text + "\n";
      }
    }
  } finally {
    await worker.terminate();
  }
  return result;
};
async function isImageBasedPDF(filePath, password = null) {
  let pdf = null;
  try {
    const data = new Uint8Array(fs$1.readFileSync(filePath));
    pdf = await pdfjsLib__namespace.getDocument({
      data,
      password,
      useSystemFonts: true,
      standardFontDataUrl,
      cMapUrl,
      cMapPacked: true
    }).promise;
    const page = await pdf.getPage(1);
    const content = await page.getTextContent();
    const textLength = content.items.reduce((acc, item) => acc + (item.str || "").length, 0);
    console.log(`isImageBasedPDF → Text length: ${textLength}`);
    return textLength < 50;
  } catch (err) {
    console.error("isImageBasedPDF error:", err.message);
    return false;
  } finally {
    if (pdf) await pdf.cleanup();
  }
}
async function processImagePDF(pdfPath, jobId, config = {}) {
  const {
    documentType = "GENERIC",
    enableSplitting = false,
    ocrLanguages = "eng",
    parser = null,
    extractRegions = [],
    password = null
  } = config;
  console.log(`processImagePDF started for ${documentType}`);
  if (!pdfPath || typeof pdfPath !== "string") throw new Error("pdfPath is invalid");
  if (!jobId || typeof jobId !== "string") throw new Error("jobId is invalid");
  const baseDir = global.__imagesBaseDir || process.cwd();
  const outputDir = path.join(baseDir, "images", jobId);
  fs$1.mkdirSync(outputDir, { recursive: true });
  const processingPromise = (async () => {
    console.log("Converting PDF to PNG pages...");
    await renderPDFPagesToImages(pdfPath, outputDir, password);
    const pageImage = path.join(outputDir, "page-1.png");
    if (!fs$1.existsSync(pageImage)) throw new Error("page-1.png not generated");
    const page2Image = path.join(outputDir, "page-2.png");
    const hasMultiplePages = fs$1.existsSync(page2Image);
    console.log("Autocropping...");
    let image;
    try {
      image = await jimp.Jimp.read(pageImage);
      image = image.autocrop();
      await image.write(pageImage);
    } catch (autocropErr) {
      console.warn("Autocrop failed, using original:", autocropErr.message);
      image = await jimp.Jimp.read(pageImage);
    }
    let frontPath = pageImage;
    let backPath = null;
    let frontText = "";
    let backText = "";
    if (enableSplitting) {
      if (hasMultiplePages) {
        console.log("Two pages → separate front/back cards");
        frontPath = path.join(outputDir, "front.png");
        await image.write(frontPath);
        backPath = path.join(outputDir, "back.png");
        try {
          let bi = await jimp.Jimp.read(page2Image);
          bi = bi.autocrop();
          await bi.write(backPath);
        } catch {
          const bi = await jimp.Jimp.read(page2Image);
          await bi.write(backPath);
        }
        try {
          const fr = await performEnhancedOCR(frontPath, ocrLanguages, outputDir, "front");
          frontText = fr.text;
        } catch (e) {
          console.error("Front OCR failed:", e.message);
        }
        try {
          const br = await performEnhancedOCR(backPath, ocrLanguages, outputDir, "back");
          backText = br.text;
        } catch (e) {
          console.error("Back OCR failed:", e.message);
        }
      } else {
        console.log("Single page → vertical split");
        const { width, height } = image.bitmap;
        frontPath = path.join(outputDir, "front.png");
        backPath = path.join(outputDir, "back.png");
        await image.clone().crop({ x: 0, y: 0, w: width, h: Math.floor(height / 2) }).write(frontPath);
        await image.clone().crop({ x: 0, y: Math.floor(height / 2), w: width, h: Math.floor(height / 2) }).write(backPath);
        try {
          const fr = await performEnhancedOCR(frontPath, ocrLanguages, outputDir, "front-half");
          frontText = fr.text;
        } catch {
        }
        try {
          const br = await performEnhancedOCR(backPath, ocrLanguages, outputDir, "back-half");
          backText = br.text;
        } catch {
        }
      }
    } else {
      try {
        const r = await performEnhancedOCR(pageImage, ocrLanguages, outputDir, "fullpage");
        frontText = r.text;
      } catch (e) {
        console.error("Full OCR failed:", e.message);
      }
    }
    const combinedText = enableSplitting ? `${frontText}

===== BACK CARD =====

${backText}` : frontText;
    const extractedRegions = {};
    if (extractRegions.length > 0) {
      for (const region of extractRegions) {
        if (region.source === "back" && !backPath) continue;
        const sourceImg = await jimp.Jimp.read(region.source === "back" ? backPath : frontPath);
        const regionPath = path.join(outputDir, `${region.name}.png`);
        const box = {
          x: Math.floor(sourceImg.bitmap.width * region.x),
          y: Math.floor(sourceImg.bitmap.height * region.y),
          w: Math.floor(sourceImg.bitmap.width * region.w),
          h: Math.floor(sourceImg.bitmap.height * region.h)
        };
        await sourceImg.crop(box).autocrop().write(regionPath);
        extractedRegions[region.name] = `/images/${jobId}/${region.name}.png`;
      }
    }
    let parsedData = {};
    if (parser && typeof parser === "function") {
      parsedData = await parser(combinedText, {
        frontPath,
        backPath,
        outputDir,
        frontText,
        backText
      });
    }
    for (const extra of [page2Image, path.join(outputDir, "page-3.png")]) {
      if (fs$1.existsSync(extra)) fs$1.unlinkSync(extra);
    }
    return {
      jobId,
      status: "completed",
      structured: {
        ...parsedData,
        cardImagePath: `/images/${jobId}/page-1.png`,
        ...enableSplitting && {
          frontCardPath: `/images/${jobId}/front.png`,
          backCardPath: `/images/${jobId}/back.png`
        },
        ...extractedRegions,
        rawText: combinedText
      }
    };
  })();
  return Promise.race([
    processingPromise,
    new Promise(
      (_, reject) => setTimeout(() => reject(new Error("processImagePDF timeout after 3 minutes")), 18e4)
    )
  ]);
}
function parseAadhaarText(text) {
  const fields = {
    aadhaarNumber: null,
    name: null,
    dob: null,
    gender: null,
    address: null,
    enrolmentNo: null
  };
  const aadhaarMatch = text.match(/\d{4}\s\d{4}\s\d{4}/);
  if (aadhaarMatch) fields.aadhaarNumber = aadhaarMatch[0];
  const enrolmentMatch = text.match(
    /(?:Enrolment|Enrollment|[\u0A80-\u0AFF\u0900-\u097F]+)[^0-9\n]*([\d/\s-]{14,})/i
  );
  if (enrolmentMatch) {
    fields.enrolmentNo = enrolmentMatch[1].replace(/\s+/g, " ").trim();
  }
  const nameToMatch = text.match(/To\s+(?:[^\n]+\n){1,2}\s*([A-Z][A-Za-z\s]{2,})\n\s*(?:C\/O|Address|S\/O)/i);
  if (nameToMatch) {
    fields.name = nameToMatch[1].trim();
  }
  if (!fields.name) {
    const lines = text.split("\n");
    const dobIndex = lines.findIndex((l) => /DOB|Year of Birth|YOB|जन्म|જન્મ/i.test(l));
    if (dobIndex > 0) {
      const potentialName = lines[dobIndex - 1].split("  ")[0].trim();
      if (potentialName && potentialName.length > 3 && !/Address|To|Aadhaar|Details/i.test(potentialName)) {
        fields.name = potentialName;
      }
    }
  }
  if (!fields.name) {
    const nameMatch = text.match(/([A-Z][a-z]+\s[A-Z][a-z]+(?:\s[A-Z][a-z]+)?)/);
    if (nameMatch) {
      fields.name = nameMatch[1].trim();
    }
  }
  const dobMatch = text.match(
    /(?:DOB|Year of Birth|YOB|जन्म|જન્મ)[:\s/]*(\d{2}\/\d{2}\/\d{4}|\d{4})/i
  );
  if (dobMatch) fields.dob = dobMatch[1];
  const genderMatch = text.match(
    /(MALE|FEMALE|TRANSGENDER|पुरुष|महिला|પુરૂષ|સ્ત્રી)/i
  );
  if (genderMatch) {
    const g = genderMatch[0].toUpperCase();
    fields.gender = g === "पुरुष" || g === "પુરૂષ" ? "MALE" : g === "महिला" || g === "સ્ત્રી" ? "FEMALE" : g;
  }
  let addressMatch = text.match(
    /(?:Addr?\s*[e]?\s*ss?|Address|सरनामुું|पता)[:\s]*([\s\S]*?)(?=\n\s*(?:Issue Date|Download Date|VID|Enrolment|\d{4}\s\d{4}\s\d{4})|$)/i
  );
  if (addressMatch && addressMatch[1].trim().length > 10) {
    fields.address = addressMatch[1].replace(/\s+/g, " ").replace(/\n/g, " ").trim().replace(/,\s*,/g, ",").replace(/\s*,\s*/g, ", ");
  }
  if (!fields.address) {
    const soMatch = text.match(
      /(?:S\/O|C\/O|D\/O|W\/O)[:\s]*([^,\n]+,?\s*(?:\d+\s+)?[^,\n]+[\s\S]*?)(?=\n\s*(?:DOB|MALE|FEMALE|Issue Date|Download Date|\d{4}\s\d{4}\s\d{4})|$)/i
    );
    if (soMatch && soMatch[1].trim().length > 10) {
      fields.address = soMatch[1].replace(/\s+/g, " ").replace(/\n/g, " ").trim().replace(/,\s*,/g, ",").replace(/\s*,\s*/g, ", ");
    }
  }
  if (!fields.address && fields.name) {
    const lines = text.split("\n");
    const nameIndex = lines.findIndex((l) => l.includes(fields.name));
    if (nameIndex >= 0 && nameIndex < lines.length - 3) {
      const addressLines = [];
      for (let i = nameIndex + 1; i < Math.min(nameIndex + 10, lines.length); i++) {
        const line = lines[i].trim();
        if (/^(?:DOB|MALE|FEMALE|Issue Date|Download Date|\d{4}\s\d{4}\s\d{4}|VID)/i.test(line)) {
          break;
        }
        if (line.length > 2 && !/^To$|^Enrolment/i.test(line)) {
          addressLines.push(line);
        }
        if (addressLines.join("").length > 50) {
          break;
        }
      }
      if (addressLines.length > 0) {
        fields.address = addressLines.join(", ").replace(/\s+/g, " ").replace(/,\s*,/g, ",").replace(/\s*,\s*/g, ", ").trim();
      }
    }
  }
  if (fields.address) {
    fields.address = fields.address.replace(/^(?:Addr?\s*[e]?\s*ss?|Address|सरनामुું|पता)[:\s]*/i, "");
    fields.address = fields.address.replace(/\b(S\/O|C\/O|D\/O|W\/O)\s*:\s*/g, "$1, ");
    fields.address = fields.address.replace(/,\s*,/g, ", ").replace(/\s*,\s*/g, ", ").replace(/\s+/g, " ").trim();
    if (fields.address.length < 10 || /^[,\s.-]+$/.test(fields.address)) {
      fields.address = null;
    }
  }
  return { fields };
}
function parsePanText(text) {
  console.log("[PAN PARSER] Parsing text started");
  const fields = {
    panNumber: null,
    name: null,
    fatherName: null,
    dob: null
  };
  const panMatch = text.match(/[A-Z]{5}[0-9]{4}[A-Z]/);
  if (panMatch) {
    fields.panNumber = panMatch[0];
    console.log("[PAN PARSER] PAN number found:", fields.panNumber);
  }
  const dobMatch = text.match(/\d{2}\/\d{2}\/\d{4}/);
  if (dobMatch) {
    fields.dob = dobMatch[0];
    console.log("[PAN PARSER] DOB found:", fields.dob);
  }
  const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
  console.log("[PAN PARSER] Total text lines:", lines.length);
  const incomeTaxIdx = lines.findIndex(
    (l) => /INCOME TAX DEPARTMENT/i.test(l)
  );
  const startIdx = incomeTaxIdx !== -1 ? incomeTaxIdx + 1 : 0;
  const potentialNames = lines.slice(startIdx, startIdx + 10).filter(
    (l) => /^[A-Z\s]+$/.test(l) && l.length > 3 && !/INCOME TAX|DEPARTMENT|INDIA|GOVT|PERMANENT/i.test(l)
  );
  if (potentialNames[0]) {
    fields.name = potentialNames[0];
    console.log("[PAN PARSER] Name detected:", fields.name);
  }
  if (potentialNames[1]) {
    fields.fatherName = potentialNames[1];
    console.log("[PAN PARSER] Father name detected:", fields.fatherName);
  }
  console.log("[PAN PARSER] Parsing completed");
  return { fields };
}
function parseAyushmanText(text) {
  const fields = {
    name: null,
    ayushmanNumber: null,
    pmjayId: null,
    yob: null,
    village: null,
    block: null,
    district: null
  };
  if (!text || !text.trim()) return { fields };
  const lines = text.split("\n").map((l) => l.trim()).filter((l) => l.length > 0);
  const ayushmanMatch = text.match(/\b91-\d{4}-\d{4}-\d{4}\b/);
  if (ayushmanMatch) fields.ayushmanNumber = ayushmanMatch[0];
  const pmjayLine = lines.find((l) => /^[A-Z0-9]{8,10}$/.test(l));
  if (pmjayLine) fields.pmjayId = pmjayLine;
  const yobLine = lines.find((l) => /^\d{4}$/.test(l));
  if (yobLine) fields.yob = yobLine;
  const nameLine = lines.slice().reverse().find(
    (l) => /^[A-Za-z\s]+$/.test(l) && !/CARD|M|F|Ayushman|PMJAY|Income Tax|Generated/i.test(l)
  );
  if (nameLine) fields.name = nameLine;
  const nameIndex = lines.indexOf(nameLine);
  for (let i = nameIndex - 1; i >= 0; i--) {
    const line = lines[i];
    if (/^[A-Za-z\s]+$/.test(line) && line.trim().split(" ").length >= 3) {
      const parts = line.trim().split(" ");
      fields.village = parts[0];
      fields.block = parts[1];
      fields.district = parts.slice(2).join(" ");
      break;
    }
  }
  return { fields };
}
function parseElectionText(text) {
  console.log("[Parser] Starting election card parsing");
  const fields = {
    epicNumber: null,
    name: null,
    relation: null,
    gender: null,
    dob: null,
    address: null,
    city: null,
    state: null,
    pincode: null,
    assemblyConstituency: null,
    partNumber: null,
    pollingStationNumber: null,
    ero: null,
    downloadDate: null,
    rawText: text || ""
  };
  if (!text || typeof text !== "string") {
    console.log("[Parser] No valid text received");
    return { fields };
  }
  const normalized = text.replace(/\r/g, "");
  const lines = normalized.split("\n").map((line) => line.replace(/\s+/g, " ").trim()).filter(Boolean);
  console.log("[Parser] Total lines after normalization:", lines.length);
  const epicMatch = normalized.match(/[A-Z]{3}[0-9]{7}/);
  if (epicMatch) {
    fields.epicNumber = epicMatch[0];
    console.log("[Parser] EPIC Number found:", fields.epicNumber);
  }
  fields.name = extractLabeledValue(lines, {
    labelRegex: /^Name\s*:/i,
    disqualifyRegex: /(Father|Husband|Mother|Relation)/i,
    maxEnglishWords: 5
  }) || fallbackNameFromRegionalLabel(lines);
  if (fields.name) {
    fields.name = filterEnglishOnly(fields.name);
  }
  console.log("[Parser] Name:", fields.name);
  const relation = extractRelation(lines);
  if (relation) {
    fields.relation = {
      type: relation.type.toUpperCase(),
      name: filterEnglishOnly(relation.name)
      // Filter to English only
    };
    console.log("[Parser] Relation:", fields.relation);
  }
  fields.gender = extractGender$1(lines);
  console.log("[Parser] Gender:", fields.gender);
  const dobRaw = extractDob(lines);
  if (dobRaw) {
    fields.dob = convertToISODate(dobRaw);
  }
  console.log("[Parser] DOB:", fields.dob);
  const addressData = extractAddressWithLocation(lines, normalized, fields.epicNumber);
  fields.address = addressData.address;
  fields.city = addressData.city;
  fields.state = addressData.state;
  fields.pincode = addressData.pincode;
  console.log("[Parser] Address extracted:", fields.address);
  fields.ero = extractERO(lines);
  console.log("[Parser] ERO:", fields.ero);
  if (fields.name) {
    const nameCleanup = cleanNameFromLocation(fields.name, lines);
    if (nameCleanup.locationPart) {
      if (fields.address) {
        fields.address = fields.address + ", " + nameCleanup.locationPart;
      }
      const locationData = extractLocationFromText(fields.address);
      if (locationData.city) fields.city = locationData.city;
      if (locationData.state) fields.state = locationData.state;
      if (locationData.pincode) fields.pincode = locationData.pincode;
    }
    fields.name = nameCleanup.cleanName;
  }
  fields.assemblyConstituency = extractAssembly(lines);
  console.log("[Parser] Assembly:", fields.assemblyConstituency);
  const partDetails = extractPartDetails(lines);
  if (partDetails) {
    const partMatch = partDetails.match(/^\s*(\d+)/);
    if (partMatch) {
      fields.partNumber = partMatch[1];
    }
  }
  const pollingStation = extractPollingStation(lines);
  if (pollingStation) {
    const stationMatch = pollingStation.match(/^\s*(\d+)/);
    if (stationMatch) {
      fields.pollingStationNumber = stationMatch[1];
    }
  }
  const downloadDateRaw = extractDownloadDate(lines);
  if (downloadDateRaw) {
    fields.downloadDate = convertToISODate(downloadDateRaw);
  }
  console.log("[Parser] Parsing completed");
  return { fields };
}
function extractLabeledValue(lines, options) {
  const { labelRegex, disqualifyRegex, maxEnglishWords = 5 } = options;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!labelRegex.test(line)) continue;
    if (disqualifyRegex && disqualifyRegex.test(line)) continue;
    const value = getValuePortion(line) || lines[i + 1];
    const english = takeEnglishSegment(value, maxEnglishWords);
    if (english) return english;
  }
  return null;
}
function getValuePortion(line) {
  if (!line || !line.includes(":")) return "";
  return line.split(":").slice(1).join(":").trim();
}
function takeEnglishSegment(value, maxWords = 5) {
  if (!value) return null;
  const match = value.match(/[A-Za-z][A-Za-z'.-]*(?:\s+[A-Za-z][A-Za-z'.-]*)*/);
  if (!match) return null;
  const words = match[0].split(" ");
  if (words.length > maxWords) return null;
  return words.join(" ");
}
function fallbackNameFromRegionalLabel(lines) {
  const index = lines.findIndex((line) => /নাম/i.test(line));
  if (index !== -1 && lines[index + 1]) {
    return takeEnglishSegment(lines[index + 1], 4);
  }
  return null;
}
function extractRelation(lines) {
  for (const line of lines) {
    const match = line.match(/(Father|Husband|Mother|Wife|Guardian)'?s?\s*Name\s*:\s*(.+)/i);
    if (match) {
      const name = takeEnglishSegment(match[2], 6);
      if (name) {
        return {
          type: match[1],
          name
        };
      }
    }
  }
  for (let i = 0; i < lines.length - 1; i++) {
    if (/Father|Husband|Mother/i.test(lines[i]) && /Name/i.test(lines[i])) {
      const name = takeEnglishSegment(lines[i + 1], 6);
      if (name) {
        const typeMatch = lines[i].match(/(Father|Husband|Mother|Wife|Guardian)/i);
        if (typeMatch) {
          return {
            type: typeMatch[1],
            name
          };
        }
      }
    }
  }
  return null;
}
function extractGender$1(lines) {
  for (const line of lines) {
    if (/Female/i.test(line)) return "Female";
    if (/Male/i.test(line) && !/Female/i.test(line)) return "Male";
  }
  return null;
}
function extractDob(lines) {
  for (const line of lines) {
    const match = line.match(/(\d{2}[/-]\d{2}[/-]\d{4})/);
    if (match) return match[1];
  }
  return null;
}
function isAddressTerminator(line) {
  return /^(Name|Father|Gender|Age|Serial|Assembly|Polling|Download|Poll)/i.test(line);
}
function extractAssembly(lines) {
  for (const line of lines) {
    const match = line.match(/Assembly\s+Constituency(?:\s+No\.?\s+and\s+Name)?\s*:\s*(.+)/i);
    if (match) {
      let value = filterEnglishOnly(match[1].trim());
      value = value.replace(/(\d+)\s*-\s*/, "$1 - ");
      return value;
    }
    const directMatch = line.match(/(\d+)\s*-\s*([A-Za-z\s()]+)/);
    if (directMatch && /Assembly|Constituency/i.test(lines[Math.max(0, lines.indexOf(line) - 1)])) {
      return `${directMatch[1]} - ${filterEnglishOnly(directMatch[2].trim())}`;
    }
  }
  return null;
}
function extractPartDetails(lines) {
  for (const line of lines) {
    const match = line.match(/Part\s+No.*:\s*(.+)/i);
    if (match) return match[1];
  }
  return null;
}
function extractPollingStation(lines) {
  for (const line of lines) {
    const match = line.match(/Polling\s+Station(?:\s+Address)?\s*:\s*(\d+)/i);
    if (match) return match[1];
    const fullMatch = line.match(/Polling\s+Station.*:\s*(.+)/i);
    if (fullMatch && fullMatch[1] !== "N.A" && fullMatch[1] !== "N.A.") {
      const numMatch = fullMatch[1].match(/^\s*(\d+)/);
      if (numMatch) return numMatch[1];
      return filterEnglishOnly(fullMatch[1]);
    }
  }
  return null;
}
function extractDownloadDate(lines) {
  for (const line of lines) {
    const match = line.match(/Download\s+Date\s*-?\s*:\s*(\d{2}[/-]\d{2}[/-]\d{4})/i);
    if (match) return match[1];
  }
  return null;
}
function convertToISODate(dateStr) {
  if (!dateStr) return null;
  const match = dateStr.match(/(\d{2})[/-](\d{2})[/-](\d{4})/);
  if (match) {
    const [, day, month, year] = match;
    return `${year}-${month}-${day}`;
  }
  return dateStr;
}
function extractAddressWithLocation(lines, fullText, epicNumber) {
  const result = {
    address: null,
    city: null,
    state: null,
    pincode: null
  };
  const addressIndex = lines.findIndex((line) => /Address\s*:/i.test(line));
  if (addressIndex === -1) return result;
  const addressParts = [];
  for (let i = addressIndex; i < lines.length; i++) {
    if (i !== addressIndex && isAddressTerminator(lines[i])) break;
    let value = lines[i].replace(/Address\s*:/i, "").trim();
    if (epicNumber) {
      value = value.replace(epicNumber, "").trim();
    }
    if (/ERO\s*[-:]|Electoral\s+Registration\s+Officer/i.test(value)) {
      continue;
    }
    if (/(Father|Husband|Mother|Wife)'?s?\s*Name\s*:/i.test(value)) {
      continue;
    }
    if (value) addressParts.push(value);
  }
  let fullAddress = addressParts.join(", ").replace(/\s+/g, " ").trim();
  fullAddress = filterEnglishOnly(fullAddress);
  const pincodeMatch = fullAddress.match(/(\d{6})/);
  if (pincodeMatch) {
    result.pincode = pincodeMatch[1];
  }
  const stateMatch = fullAddress.match(/(Maharashtra|Karnataka|Tamil Nadu|Kerala|Gujarat|Rajasthan|Punjab|Haryana|Uttar Pradesh|Madhya Pradesh|Bihar|West Bengal|Andhra Pradesh|Telangana|Odisha|Assam|Jharkhand|Chhattisgarh|Uttarakhand|Himachal Pradesh|Tripura|Meghalaya|Manipur|Nagaland|Goa|Arunachal Pradesh|Mizoram|Sikkim|Delhi|Puducherry|Chandigarh|Jammu and Kashmir|Ladakh)/i);
  if (stateMatch) {
    result.state = stateMatch[1];
  }
  const cityCorpMatch = fullAddress.match(/([A-Z][A-Z\s]+?)\s+(?:MUNICIPAL[,\s]+CORPORATION|City\s+Corporation)/i);
  if (cityCorpMatch) {
    result.city = cityCorpMatch[1].trim();
  }
  if (!result.city && result.state) {
    const beforeState = fullAddress.split(result.state)[0];
    const cityMatch = beforeState.match(/,\s*([A-Z][A-Z\s]+?|[A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)(?:\s+SADAR)?\s*,?\s*$/i);
    if (cityMatch) {
      result.city = cityMatch[1].trim();
    }
  }
  if (!result.city && result.pincode) {
    const beforePincode = fullAddress.split(result.pincode)[0];
    const cityMatch = beforePincode.match(/,\s*([A-Z][A-Z\s]+?|[A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)(?:\s+SADAR)?\s*,?\s*$/i);
    if (cityMatch) {
      result.city = cityMatch[1].trim();
    }
  }
  fullAddress = fullAddress.replace(/,\s*,/g, ", ").replace(/\s*,\s*/g, ", ").replace(/\s+/g, " ").replace(/^,\s*/, "").replace(/,\s*$/, "").trim();
  result.address = fullAddress;
  return result;
}
function filterEnglishOnly(text) {
  if (!text) return "";
  return text.replace(/[^\x00-\x7F]+/g, " ").replace(/\s+/g, " ").replace(/,\s*,/g, ", ").replace(/\s*,\s*/g, ", ").trim();
}
function extractERO(lines) {
  for (const line of lines) {
    const eroMatch = line.match(/(?:ERO\s*[-:]\s*|Electoral\s+Registration\s+Officer[,:]\s*)(.+)/i);
    if (eroMatch) {
      return filterEnglishOnly(eroMatch[1].trim());
    }
  }
  return null;
}
function cleanNameFromLocation(name, lines) {
  const nameLine = lines.find((line) => /^Name\s*:/i.test(line) && line.includes(name));
  if (!nameLine) {
    return { cleanName: name, locationPart: null };
  }
  const fullValue = getValuePortion(nameLine);
  if (!fullValue) {
    return { cleanName: name, locationPart: null };
  }
  const hasLocation = /,\s*[A-Z][a-z]+,\s*[A-Z][a-z\s]+[-]\d{6}|,\s*\d{6}/.test(fullValue);
  if (!hasLocation) {
    return { cleanName: name, locationPart: null };
  }
  const locationMatch = fullValue.match(/^(.+?)\s+(Mysore|Bangalore|Mumbai|Delhi|Chennai|Kolkata|Hyderabad|Pune|Ahmedabad|Surat|Lucknow|Jaipur|[A-Z][a-z]+,\s*[A-Z][a-z\s]+[-]\d{6})/);
  if (locationMatch) {
    const cleanName2 = filterEnglishOnly(locationMatch[1].trim());
    const locationPart = filterEnglishOnly(locationMatch[2].trim() + (fullValue.substring(locationMatch[0].length) || ""));
    return { cleanName: cleanName2, locationPart };
  }
  return { cleanName: name, locationPart: null };
}
function extractLocationFromText(text) {
  const result = { city: null, state: null, pincode: null };
  if (!text) return result;
  const pincodeMatch = text.match(/(\d{6})/);
  if (pincodeMatch) {
    result.pincode = pincodeMatch[1];
  }
  const stateMatch = text.match(/(Maharashtra|Karnataka|Tamil Nadu|Kerala|Gujarat|Rajasthan|Punjab|Haryana|Uttar Pradesh|Madhya Pradesh|Bihar|West Bengal|Andhra Pradesh|Telangana|Odisha|Assam|Jharkhand|Chhattisgarh|Uttarakhand|Himachal Pradesh|Tripura|Meghalaya|Manipur|Nagaland|Goa|Arunachal Pradesh|Mizoram|Sikkim|Delhi|Puducherry|Chandigarh|Jammu and Kashmir|Ladakh)/i);
  if (stateMatch) {
    result.state = stateMatch[1];
  }
  if (result.state) {
    const beforeState = text.split(result.state)[0];
    const cityMatch = beforeState.match(/,?\s*([A-Z][A-Za-z\s]+?)(?:\s+SADAR)?\s*,?\s*$/i);
    if (cityMatch) {
      result.city = cityMatch[1].trim();
    }
  } else if (result.pincode) {
    const beforePincode = text.split(result.pincode)[0];
    const cityMatch = beforePincode.match(/,?\s*([A-Z][A-Za-z\s]+?)(?:\s+SADAR)?\s*,?\s*$/i);
    if (cityMatch) {
      result.city = cityMatch[1].trim();
    }
  }
  return result;
}
function parseEShramText(text) {
  const result = {
    name: null,
    fatherName: null,
    dob: null,
    gender: null,
    uan: null,
    bloodGroup: null,
    occupation: null,
    address: null,
    contactNumber: null
  };
  if (!text || text.trim().length === 0) {
    console.log("⚠️ No text provided for E-Shram parsing");
    return result;
  }
  console.log("\n========== E-SHRAM PARSER DEBUG ==========");
  console.log("📝 RAW TEXT LENGTH:", text.length);
  console.log("📝 RAW TEXT PREVIEW:");
  console.log(text);
  console.log("==========================================\n");
  const parts = text.split("===== BACK CARD =====");
  const frontText = parts[0] || "";
  const backText = parts[1] || "";
  if (parts.length > 1) {
    console.log("🔍 Detected FRONT + BACK cards");
    console.log(`   Front: ${frontText.length} chars`);
    console.log(`   Back:  ${backText.length} chars
`);
  }
  const toEnglishDigits = (str) => {
    const devanagariMap = {
      "०": "0",
      "१": "1",
      "२": "2",
      "३": "3",
      "४": "4",
      "५": "5",
      "६": "6",
      "७": "7",
      "८": "8",
      "९": "9"
    };
    return str.replace(/[०-९]/g, (match) => devanagariMap[match] || match);
  };
  let cleanText = text.replace(/\s+/g, " ").trim();
  let normalizedText = toEnglishDigits(cleanText);
  const lines = text.split("\n").map((l) => l.trim()).filter((l) => l.length > 0);
  console.log("📊 Line-by-line analysis:");
  lines.forEach((line, i) => console.log(`  ${i}: "${line}"`));
  console.log();
  const frontLines = frontText.split("\n").map((l) => l.trim()).filter((l) => l.length > 0);
  console.log("🔍 Searching for name in FRONT card lines:", frontLines.length, "lines");
  let nameFound = false;
  for (const line of frontLines) {
    if (/नाम|Name/i.test(line) && !/Father|पिता|INDIA|GOVT/i.test(line)) {
      console.log("   Found name line:", line.substring(0, 80));
      const nameMatch = line.match(/(?:नाम|Name)[^A-Z]*([A-Z][a-z]+(?:\s+[A-Z]?[a-z]+)*)\s*\.?/i);
      if (nameMatch) {
        const candidate = nameMatch[1].trim().replace(/\.$/, "");
        if (candidate.length >= 3 && !/^[A-Z]$/.test(candidate)) {
          result.name = candidate;
          console.log("✅ Name (from नाम/Name line):", result.name);
          nameFound = true;
          break;
        }
      }
    }
  }
  if (!nameFound) {
    console.log("   Name not found in labeled line, trying clean line strategy...");
    for (const line of frontLines) {
      const skipKeywords = /ई-श्रम|eShram|Card|MINISTRY|Universal|Account|Number|पिता|Father|मंत्रालय|GOVT|INDIA|भारत|सरकार|Pes|Crs|Blood|Group|Primary|Occupation|DOB|Date|Gender/i;
      const tooShort = line.length < 3;
      const hasSpecialChars = /[©@#$%^&*()_+=\[\]{};:'",.<>?\/\\|`~]/.test(line);
      const onlyConsonants = /^[BCDFGHJKLMNPQRSTVWXYZ\s]+$/i.test(line) && line.length < 5;
      if (line.match(/^[A-Z][a-z]+(\s+[A-Z][a-z]+)*$/) && !skipKeywords.test(line) && !tooShort && !hasSpecialChars && !onlyConsonants) {
        result.name = line;
        console.log("✅ Name (from clean line):", result.name);
        nameFound = true;
        break;
      }
    }
  }
  if (!nameFound) {
    console.log("❌ Name not found");
  }
  for (const line of frontLines) {
    if (/पिता|Father/i.test(line)) {
      const fatherMatch = line.match(/(?:पिता|Father)[^A-Za-z]*(?:[A-Z]\s+)?([A-Z][a-z]+(?:\s+[a-z]+)+)/i);
      if (fatherMatch) {
        result.fatherName = fatherMatch[1].trim();
        console.log("✅ Father Name:", result.fatherName);
        break;
      }
    }
  }
  if (!result.fatherName) {
    console.log("❌ Father Name not found");
  }
  const uanPatterns = [
    /Universal\s*Account\s*Number[^\d]*([\d\s]{10,})/i,
    /UAN[^\d]*([\d\s]{10,})/i,
    /eShram\s*Card[^\d]*([\d\s]{10,})/i,
    /Account\s*No[^\d]*([\d\s]{10,})/i,
    // Fallback: Look for 12-digit number sequences (with optional spaces)
    /(\d[\s]*\d[\s]*\d[\s]*\d[\s]*\d[\s]*\d[\s]*\d[\s]*\d[\s]*\d[\s]*\d[\s]*\d[\s]*\d)/
  ];
  for (const pattern of uanPatterns) {
    const match = normalizedText.match(pattern);
    if (match) {
      const digits = match[1].replace(/\s/g, "").replace(/\D/g, "");
      if (digits.length >= 10 && digits.length <= 12) {
        result.uan = digits.slice(0, 12);
        console.log("✅ UAN:", result.uan, "(extracted from:", match[1].substring(0, 30) + "...)");
        break;
      }
    }
  }
  if (!result.uan) {
    console.log("❌ UAN not found");
  }
  const dobPatterns = [
    /(?:DOB|Date\s*of\s*Birth|जन्म\s*तिथि)[:\s\/\.]*(\d{1,2})[\s\/\-\.](\d{1,2})[\s\/\-\.](\d{4})/i,
    /(?:008|DOB|0OB|D0B)[:\s\/\.]*(\d{2})[\s\/\-](\d{2})[\s\/\-](\d{4})/i,
    // "008", "0OB", "D0B" are common OCR errors
    /(?:Birth|जन्म)[:\s\/\.]*(\d{1,2})[\s\/\-\.](\d{1,2})[\s\/\-\.](\d{4})/i,
    /(\d{2})[\s\/\-](\d{2})[\s\/\-](\d{4})/
    // Fallback for any DD/MM/YYYY pattern
  ];
  for (const pattern of dobPatterns) {
    const match = frontText.match(pattern);
    if (match) {
      const day = match[1].padStart(2, "0");
      const month = match[2].padStart(2, "0");
      const year = match[3];
      if (parseInt(day) <= 31 && parseInt(month) <= 12 && parseInt(year) >= 1950 && parseInt(year) <= 2010) {
        result.dob = `${day}/${month}/${year}`;
        console.log("✅ DOB:", result.dob);
        break;
      }
    }
  }
  if (!result.dob) {
    console.log("❌ DOB not found");
  }
  const genderMatch = normalizedText.match(/(?:Gender|लिंग|Sex|Bm)[:\s\/©+]*[\s]*(M|F|Male|Female|पुरुष|महिला)/i);
  if (genderMatch) {
    const g = genderMatch[1].toLowerCase();
    if (g === "m" || g === "male" || g === "पुरुष") result.gender = "Male";
    else if (g === "f" || g === "female" || g === "महिला") result.gender = "Female";
    else result.gender = genderMatch[1];
    console.log("✅ Gender:", result.gender);
  } else {
    console.log("❌ Gender not found");
  }
  const bloodMatch = backText.match(/Blood\s*Gro[uwp]*[:\s]*([ABO]+[+-]?)/i);
  if (bloodMatch) {
    const bg = bloodMatch[1].toUpperCase().replace(/[^ABO+-]/g, "");
    if (bg && /^[ABO]+[+-]?$/.test(bg)) {
      result.bloodGroup = bg;
      console.log("✅ Blood Group:", result.bloodGroup);
    }
  }
  if (!result.bloodGroup) {
    console.log("❌ Blood Group not found");
  }
  const backLines = backText.split("\n").map((l) => l.trim()).filter((l) => l.length > 0);
  console.log("🔍 Searching for occupation in BACK card lines:", backLines.length, "lines");
  console.log("📄 BACK CARD TEXT:", backText.substring(0, 200));
  const occupationKeywords = [
    "Laborer",
    "Labourer",
    "Worker",
    "Driver",
    "Carpenter",
    "Electrician",
    "Plumber",
    "Mason",
    "Painter",
    "Welder",
    "Mechanic",
    "Tailor",
    "Farm",
    "Agriculture",
    "Construction",
    "Helper",
    "Cleaner",
    "Guard",
    "Vendor",
    "Seller",
    "मजदूर",
    "कारीगर",
    "ड्राइवर"
  ];
  for (const line of backLines) {
    for (const keyword of occupationKeywords) {
      if (new RegExp(keyword, "i").test(line)) {
        const regex = new RegExp(`(${keyword}[a-z\\s]*(?:worker|labour|labourer)?)`, "gi");
        const match = line.match(regex);
        if (match) {
          const occ = match[0].trim();
          if (!/Father|Fates|पिता|Name|नाम|Hame/i.test(occ)) {
            result.occupation = occ;
            console.log("✅ Occupation (keyword match):", result.occupation);
            break;
          }
        }
      }
    }
    if (result.occupation) break;
  }
  if (!result.occupation) {
    for (const line of backLines) {
      if (/पिता|Father|Fates|Fathe|Fater|Fathers|Name|Hame|ame|नाम|का\s*नाम/i.test(line)) {
        console.log("⏭️  Skipping father/name line:", line.substring(0, 80));
        continue;
      }
      if (/Primary|Occupation|व्यवसाय/i.test(line)) {
        console.log("🔍 Found occupation line:", line);
        const occMatch = line.match(/(?:Primary|Occupation|व्यवसाय)[:\s©]*([-A-Za-z\s,&']+?)(?=Current|Address|Contact|$)/i);
        if (occMatch) {
          let occ = occMatch[1].replace(/Occupation|व्यवसाय|Pry|Primary|Compe|CE|Coes|Ci|Sty\)/gi, "").replace(/\s+/g, " ").trim();
          if (occ && occ.length > 2 && !/Father|Fates|पिता|Name|नाम|Hame|ame|का|दी/i.test(occ)) {
            result.occupation = occ;
            console.log("✅ Occupation (label-based):", result.occupation);
            break;
          } else {
            console.log("   ⚠️ Rejected occupation (contains father/name keywords):", occ);
          }
        }
      }
    }
  }
  if (!result.occupation) {
    console.log("❌ Occupation not found or invalid");
  }
  const addressMatch = backText.match(/(?:Current\s*Address|Address)[:\s]*([^]+?)(?=Contact|Mobile|Phone|©|$)/i);
  if (addressMatch) {
    result.address = addressMatch[1].replace(/REIS|Silo|Bed/g, "").replace(/\s+/g, " ").trim();
    if (result.address && result.address.length > 5) {
      console.log("✅ Address:", result.address.substring(0, 60) + "...");
    } else {
      result.address = null;
      console.log("❌ Address too short after cleanup");
    }
  } else {
    console.log("❌ Address not found");
  }
  for (const line of backLines) {
    if (/Contact|Mobile|Phone|amber|संपर्क/i.test(line)) {
      console.log("   Found contact line:", line.substring(0, 60));
      const digitMatch = line.match(/(\d[\s\.\-]*\d[\s\.\-]*\d[\s\.\-]*\d[\s\.\-]*\d[\s\.\-]*\d[\s\.\-]*\d[\s\.\-]*\d[\s\.\-]*\d[\s\.\-]*\d)/);
      if (digitMatch) {
        const digits = digitMatch[1].replace(/[\s\.\-]/g, "");
        if (digits.length === 10 && /^[6-9]/.test(digits)) {
          result.contactNumber = digits;
          console.log("✅ Contact:", result.contactNumber);
          break;
        } else if (digits.length === 10) {
          result.contactNumber = digits;
          console.log("✅ Contact (non-standard):", result.contactNumber);
          break;
        }
      }
    }
  }
  if (!result.contactNumber) {
    console.log("❌ Contact not found");
  }
  console.log("\n📋 ===== FINAL PARSED RESULT =====");
  console.log(JSON.stringify(result, null, 2));
  console.log("=====================================\n");
  return result;
}
async function parseEShramEnhanced(text, { frontPath, outputDir } = {}) {
  console.log("\n" + "=".repeat(60));
  console.log("🎯 E-SHRAM ENHANCED PARSER");
  console.log("=".repeat(60));
  let parsedData = parseEShramText(text);
  const qualityFields = [
    "name",
    "fatherName",
    "dob",
    "gender",
    "uan",
    "occupation",
    "address",
    "contactNumber"
  ];
  const hasSufficientData = () => {
    const filled = qualityFields.filter((field) => {
      const value = parsedData[field];
      return typeof value === "string" ? value.trim().length > 0 : Boolean(value);
    }).length;
    return filled >= 5;
  };
  if (hasSufficientData()) {
    console.log("✅ Base extraction quality is already sufficient, skipping extra enhancement passes.");
    console.log("=".repeat(60) + "\n");
    return parsedData;
  }
  const nameIsIncomplete = !parsedData.name || parsedData.name.length < 3 || parsedData.name === "N/A";
  if (nameIsIncomplete && frontPath && outputDir) {
    try {
      console.log("\n🔍 Additional: Re-scanning name area with enhanced OCR...");
      console.log(`   Current name: "${parsedData.name || "N/A"}" - attempting to improve...`);
      const fImg = await jimp.Jimp.read(frontPath);
      const nameBox = {
        x: Math.floor(fImg.bitmap.width * 0),
        y: Math.floor(fImg.bitmap.height * 0.15),
        w: Math.floor(fImg.bitmap.width * 1),
        h: Math.floor(fImg.bitmap.height * 0.25)
      };
      const namePath = path.join(outputDir, "name-region.png");
      const nameImage = fImg.crop(nameBox).contrast(0.6).greyscale();
      await nameImage.write(namePath);
      console.log("📸 Scanning name region from image...");
      const nameResult = await performEnhancedOCR(namePath, "eng+hin", outputDir, "name-enh", {
        charWhitelist: "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz "
      });
      const nameText = nameResult.text;
      console.log("📄 Name region OCR result:", nameText);
      const nameLines = nameText.split("\n").map((l) => l.trim()).filter((l) => l.length > 0);
      for (const line of nameLines) {
        const skipKeywords = /eShram|Card|MINISTRY|GOVT|INDIA|भारत|पिता|Father|Fates/i;
        if (line.match(/^[A-Z][a-z]+(\s+[A-Z][a-z]+)+$/) && !skipKeywords.test(line)) {
          parsedData.name = line;
          console.log("✅ Enhanced name extraction (multi-word):", line);
          break;
        }
      }
      if (!parsedData.name) {
        for (const line of nameLines) {
          const skipKeywords = /eShram|Card|MINISTRY|GOVT|INDIA|भारत|पिता|Father|Fates|Name|नाम/i;
          if (line.match(/^[A-Z][a-z]{3,}$/) && !skipKeywords.test(line)) {
            parsedData.name = line;
            console.log("✅ Enhanced name extraction (single-word):", line);
            break;
          }
        }
      }
    } catch (err) {
      console.warn("⚠️ Name region OCR failed:", err.message);
    }
    if (hasSufficientData()) {
      console.log("✅ Extraction reached quality threshold after name enhancement.");
      console.log("=".repeat(60) + "\n");
      return parsedData;
    }
  }
  if (!parsedData.occupation && frontPath && outputDir) {
    try {
      console.log("\n🔍 Additional: Re-scanning occupation area with enhanced OCR...");
      const backCardPath = frontPath.replace("front.png", "back.png");
      const occCardPath = fs$1.existsSync(backCardPath) ? backCardPath : frontPath;
      console.log(`   Using card: ${occCardPath.includes("back") ? "BACK" : "FRONT"}`);
      const fImgForOcc = await jimp.Jimp.read(occCardPath);
      const occupationBox = {
        x: Math.floor(fImgForOcc.bitmap.width * 0.05),
        y: Math.floor(fImgForOcc.bitmap.height * 0.15),
        w: Math.floor(fImgForOcc.bitmap.width * 0.9),
        h: Math.floor(fImgForOcc.bitmap.height * 0.4)
      };
      const occPath = path.join(outputDir, "occupation-region.png");
      const occImage = fImgForOcc.crop(occupationBox).contrast(0.5).greyscale();
      await occImage.write(occPath);
      console.log("📸 Scanning occupation region from image...");
      const occResult = await performEnhancedOCR(occPath, "eng+hin", outputDir, "occ-enh", {
        charWhitelist: "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz, ()-/।"
      });
      const occText = occResult.text;
      console.log("📄 Occupation region OCR result:", occText);
      if (occText && occText.length > 3) {
        const occupationKeywords = [
          "Laborer",
          "Labourer",
          "Worker",
          "Driver",
          "Carpenter",
          "Electrician",
          "Plumber",
          "Mason",
          "Painter",
          "Welder",
          "Mechanic",
          "Tailor",
          "Farmer",
          "Agriculture",
          "Construction",
          "Helper",
          "Cleaner",
          "Guard",
          "Vendor",
          "Seller",
          "Cook",
          "Waiter",
          "Shop",
          "Factory"
        ];
        let found = false;
        for (const keyword of occupationKeywords) {
          if (new RegExp(keyword, "i").test(occText)) {
            const regex = new RegExp(`(${keyword}[a-z\\s]*(?:worker|labour|labourer|work)?)`, "gi");
            const match = occText.match(regex);
            if (match && !/Father|Fates|पिता|Name|नाम/i.test(match[0])) {
              parsedData.occupation = match[0].trim();
              console.log("✅ Enhanced occupation extracted (keyword):", parsedData.occupation);
              found = true;
              break;
            }
          }
        }
        if (!found) {
          let occupation = occText.replace(/Occupation|Occ\.|Primary|पाय|व्यवसाय|व्यवसाये|दि\s*\|/gi, "").trim();
          const lines = occupation.split("\n");
          occupation = lines[0].trim();
          if (occupation && occupation.length > 2 && !/Father|Fates|पिता|Name|नाम|Hame|का|दी/i.test(occupation)) {
            parsedData.occupation = occupation;
            console.log("✅ Enhanced occupation extracted (generic):", parsedData.occupation);
          } else {
            console.log("⚠️ Rejected enhanced occupation (contains father/name keywords):", occupation);
          }
        }
      }
    } catch (err) {
      console.warn("⚠️ Enhanced occupation OCR failed:", err.message);
    }
    if (hasSufficientData()) {
      console.log("✅ Extraction reached quality threshold after occupation enhancement.");
      console.log("=".repeat(60) + "\n");
      return parsedData;
    }
  }
  if (!parsedData.fatherName && frontPath && outputDir) {
    try {
      console.log("\n🔍 Additional: Re-scanning father name area with enhanced OCR...");
      const fImgForFather = await jimp.Jimp.read(frontPath);
      const fatherBox = {
        x: Math.floor(fImgForFather.bitmap.width * 0),
        y: Math.floor(fImgForFather.bitmap.height * 0.2),
        w: Math.floor(fImgForFather.bitmap.width * 1),
        h: Math.floor(fImgForFather.bitmap.height * 0.25)
      };
      const fatherPath = path.join(outputDir, "father-region.png");
      const fatherImage = fImgForFather.crop(fatherBox).contrast(0.6).greyscale();
      await fatherImage.write(fatherPath);
      console.log("📸 Scanning father name region...");
      const fatherResult = await performEnhancedOCR(fatherPath, "eng+hin", outputDir, "father-enh");
      const fatherText = fatherResult.text;
      console.log("📄 Father name region OCR result:", fatherText);
      const fatherLines = fatherText.split("\n").map((l) => l.trim()).filter((l) => l.length > 0);
      for (const line of fatherLines) {
        if (/पिता|Father/i.test(line)) {
          const match = line.match(/(?:पिता|Father)[^A-Za-z]*([A-Z][a-z]+(?:\s+[a-z]+)+)/i);
          if (match) {
            parsedData.fatherName = match[1].trim();
            console.log("✅ Enhanced father name extraction:", parsedData.fatherName);
            break;
          }
        }
      }
    } catch (err) {
      console.warn("⚠️ Father name region OCR failed:", err.message);
    }
    if (hasSufficientData()) {
      console.log("✅ Extraction reached quality threshold after father-name enhancement.");
      console.log("=".repeat(60) + "\n");
      return parsedData;
    }
  }
  if (!parsedData.dob && frontPath && outputDir) {
    try {
      console.log("\n🔍 Additional: Re-scanning DOB area with enhanced OCR...");
      const fImgForDob = await jimp.Jimp.read(frontPath);
      const dobBox = {
        x: Math.floor(fImgForDob.bitmap.width * 0),
        y: Math.floor(fImgForDob.bitmap.height * 0.35),
        w: Math.floor(fImgForDob.bitmap.width * 1),
        h: Math.floor(fImgForDob.bitmap.height * 0.25)
      };
      const dobPath = path.join(outputDir, "dob-region.png");
      const dobImage = fImgForDob.crop(dobBox).contrast(0.6).greyscale();
      await dobImage.write(dobPath);
      console.log("📸 Scanning DOB region...");
      const dobResult = await performEnhancedOCR(dobPath, "eng", outputDir, "dob-enh", {
        charWhitelist: "0123456789/-. DOBDateofBirth"
      });
      const dobText = dobResult.text;
      console.log("📄 DOB region OCR result:", dobText);
      const dobMatch = dobText.match(/(\d{1,2})[\s\/\-](\d{1,2})[\s\/\-](\d{4})/);
      if (dobMatch) {
        const day = dobMatch[1].padStart(2, "0");
        const month = dobMatch[2].padStart(2, "0");
        const year = dobMatch[3];
        if (parseInt(day) <= 31 && parseInt(month) <= 12 && parseInt(year) >= 1950 && parseInt(year) <= 2010) {
          parsedData.dob = `${day}/${month}/${year}`;
          console.log("✅ Enhanced DOB extraction:", parsedData.dob);
        }
      }
    } catch (err) {
      console.warn("⚠️ DOB region OCR failed:", err.message);
    }
    if (hasSufficientData()) {
      console.log("✅ Extraction reached quality threshold after DOB enhancement.");
      console.log("=".repeat(60) + "\n");
      return parsedData;
    }
  }
  if (!parsedData.gender && frontPath && outputDir) {
    try {
      console.log("\n🔍 Additional: Re-scanning gender area with enhanced OCR...");
      const fImgForGender = await jimp.Jimp.read(frontPath);
      const genderBox = {
        x: Math.floor(fImgForGender.bitmap.width * 0),
        y: Math.floor(fImgForGender.bitmap.height * 0.45),
        w: Math.floor(fImgForGender.bitmap.width * 1),
        h: Math.floor(fImgForGender.bitmap.height * 0.2)
      };
      const genderPath = path.join(outputDir, "gender-region.png");
      const genderImage = fImgForGender.crop(genderBox).contrast(0.6).greyscale();
      await genderImage.write(genderPath);
      console.log("📸 Scanning gender region...");
      const genderResult = await performEnhancedOCR(genderPath, "eng+hin", outputDir, "gender-enh");
      const genderText = genderResult.text;
      console.log("📄 Gender region OCR result:", genderText);
      const genderMatch = genderText.match(/(?:Gender|लिंग|Sex)[:\s\/]*(M|F|Male|Female|पुरुष|महिला)/i);
      if (genderMatch) {
        const g = genderMatch[1].toLowerCase();
        if (g === "m" || g === "male" || g === "पुरुष") parsedData.gender = "Male";
        else if (g === "f" || g === "female" || g === "महिला") parsedData.gender = "Female";
        console.log("✅ Enhanced gender extraction:", parsedData.gender);
      }
    } catch (err) {
      console.warn("⚠️ Gender region OCR failed:", err.message);
    }
    if (hasSufficientData()) {
      console.log("✅ Extraction reached quality threshold after gender enhancement.");
      console.log("=".repeat(60) + "\n");
      return parsedData;
    }
  }
  if (!parsedData.bloodGroup && frontPath && outputDir) {
    try {
      console.log("\n🔍 Additional: Re-scanning blood group area with enhanced OCR...");
      const backCardPath = frontPath.replace("front.png", "back.png");
      const bloodCardPath = fs$1.existsSync(backCardPath) ? backCardPath : frontPath;
      const fImgForBlood = await jimp.Jimp.read(bloodCardPath);
      const bloodBox = {
        x: Math.floor(fImgForBlood.bitmap.width * 0),
        y: Math.floor(fImgForBlood.bitmap.height * 0.1),
        w: Math.floor(fImgForBlood.bitmap.width * 1),
        h: Math.floor(fImgForBlood.bitmap.height * 0.3)
      };
      const bloodPath = path.join(outputDir, "blood-region.png");
      const bloodImage = fImgForBlood.crop(bloodBox).contrast(0.7).greyscale();
      await bloodImage.write(bloodPath);
      console.log("📸 Scanning blood group region...");
      const bloodResult = await performEnhancedOCR(bloodPath, "eng+hin", outputDir, "blood-enh", {
        charWhitelist: "ABOab+-BloodGrupoव्रक्त"
      });
      const bloodText = bloodResult.text;
      console.log("📄 Blood group region OCR result:", bloodText);
      const bloodMatch = bloodText.match(/Blood\s*Gro[uwp]*[:\s]*([ABO]+[+-]?)/i);
      if (bloodMatch) {
        const bg = bloodMatch[1].toUpperCase().replace(/[^ABO+-]/g, "");
        if (bg && /^[ABO]+[+-]?$/.test(bg)) {
          parsedData.bloodGroup = bg;
          console.log("✅ Enhanced blood group extraction:", parsedData.bloodGroup);
        }
      }
    } catch (err) {
      console.warn("⚠️ Blood group region OCR failed:", err.message);
    }
    if (hasSufficientData()) {
      console.log("✅ Extraction reached quality threshold after blood-group enhancement.");
      console.log("=".repeat(60) + "\n");
      return parsedData;
    }
  }
  if (!parsedData.contactNumber && frontPath && outputDir) {
    try {
      console.log("\n🔍 Additional: Re-scanning contact number area with enhanced OCR...");
      const backCardPath = frontPath.replace("front.png", "back.png");
      const contactCardPath = fs$1.existsSync(backCardPath) ? backCardPath : frontPath;
      const fImgForContact = await jimp.Jimp.read(contactCardPath);
      const contactBox = {
        x: Math.floor(fImgForContact.bitmap.width * 0),
        y: Math.floor(fImgForContact.bitmap.height * 0.6),
        w: Math.floor(fImgForContact.bitmap.width * 1),
        h: Math.floor(fImgForContact.bitmap.height * 0.35)
      };
      const contactPath = path.join(outputDir, "contact-region.png");
      const contactImage = fImgForContact.crop(contactBox).contrast(0.7).greyscale();
      await contactImage.write(contactPath);
      console.log("📸 Scanning contact number region...");
      const contactResult = await performEnhancedOCR(contactPath, "eng", outputDir, "contact-enh", {
        charWhitelist: "0123456789 .-ContactMobilePhoneNumber"
      });
      const contactText = contactResult.text;
      console.log("📄 Contact region OCR result:", contactText);
      const digitMatch = contactText.match(/(\d[\s\.\-]*\d[\s\.\-]*\d[\s\.\-]*\d[\s\.\-]*\d[\s\.\-]*\d[\s\.\-]*\d[\s\.\-]*\d[\s\.\-]*\d[\s\.\-]*\d)/);
      if (digitMatch) {
        const digits = digitMatch[1].replace(/[\s\.\-]/g, "");
        if (digits.length === 10) {
          parsedData.contactNumber = digits;
          console.log("✅ Enhanced contact extraction:", parsedData.contactNumber);
        }
      }
    } catch (err) {
      console.warn("⚠️ Contact number region OCR failed:", err.message);
    }
  }
  if (!parsedData.address && frontPath && outputDir) {
    try {
      console.log("\n🔍 Additional: Re-scanning address area with enhanced OCR...");
      const backCardPath = frontPath.replace("front.png", "back.png");
      const addressCardPath = fs$1.existsSync(backCardPath) ? backCardPath : frontPath;
      const fImgForAddress = await jimp.Jimp.read(addressCardPath);
      const addressBox = {
        x: Math.floor(fImgForAddress.bitmap.width * 0),
        y: Math.floor(fImgForAddress.bitmap.height * 0.4),
        w: Math.floor(fImgForAddress.bitmap.width * 1),
        h: Math.floor(fImgForAddress.bitmap.height * 0.4)
      };
      const addressPath = path.join(outputDir, "address-region.png");
      const addressImage = fImgForAddress.crop(addressBox).contrast(0.6).greyscale();
      await addressImage.write(addressPath);
      console.log("📸 Scanning address region...");
      const addressResult = await performEnhancedOCR(addressPath, "eng+hin", outputDir, "address-enh");
      const addressText = addressResult.text;
      console.log("📄 Address region OCR result:", addressText);
      const addressMatch = addressText.match(/(?:Current\s*Address|Address)[:\s]*([^]+?)(?=Contact|Mobile|Phone|Emergency|$)/i);
      if (addressMatch) {
        let addr = addressMatch[1].replace(/REIS|Silo|Bed/g, "").replace(/\s+/g, " ").trim();
        if (addr && addr.length > 5) {
          parsedData.address = addr;
          console.log("✅ Enhanced address extraction:", parsedData.address.substring(0, 60) + "...");
        }
      } else {
        const lines = addressText.split("\n").map((l) => l.trim()).filter((l) => l.length > 5);
        if (lines.length >= 2) {
          const addr = lines.slice(0, 3).join(", ");
          if (addr.length > 10 && !/Contact|Mobile|Blood|Occupation/i.test(addr)) {
            parsedData.address = addr;
            console.log("✅ Enhanced address extraction (generic):", parsedData.address.substring(0, 60) + "...");
          }
        }
      }
    } catch (err) {
      console.warn("⚠️ Address region OCR failed:", err.message);
    }
  }
  console.log("=".repeat(60) + "\n");
  return parsedData;
}
function parseABHAText(text) {
  const result = {
    name: null,
    abhaNumber: null,
    abhaAddress: null,
    gender: null,
    dob: null,
    mobile: null
  };
  if (!text) return result;
  const devanagariDigitMap = {
    "०": "0",
    "१": "1",
    "२": "2",
    "३": "3",
    "४": "4",
    "५": "5",
    "६": "6",
    "७": "7",
    "८": "8",
    "९": "9"
  };
  const normalizeDigits = (value) => value.replace(/[०-९]/g, (digit) => devanagariDigitMap[digit] || digit);
  const normalizeOcrNumber = (value) => normalizeDigits(value).replace(/[Oo]/g, "0").replace(/[Il|]/g, "1").replace(/S/g, "5").replace(/B/g, "8");
  const collectNumericCandidates = (value) => {
    const candidates = [];
    const matches = value.match(/[0-9OIlSBo०-९][0-9OIlSBo०-९\s:-]{12,30}/g) || [];
    for (const raw of matches) {
      const normalized = normalizeOcrNumber(raw).replace(/\D/g, "");
      if (normalized.length >= 14) {
        candidates.push(normalized.slice(0, 14));
      }
    }
    return candidates;
  };
  const cleanText = text.replace(/[\r\n]+/g, "\n").replace(/\s+/g, " ").trim();
  const cleanTextNormalizedDigits = normalizeDigits(cleanText);
  const originalLines = text.split(/[\r\n]+/).map((l) => l.trim()).filter(Boolean);
  let nameMatch = cleanText.match(/(?:Name|नाम|NAME)\s*[:：]?\s*([A-Za-z][A-Za-z\s]{2,50})(?=\s*(?:नाम|ABHA|आभा|Gender|लिंग|Mobile|$))/i);
  if (!nameMatch) {
    for (const line of originalLines) {
      if (/(?:Name|नाम|NAME)/i.test(line)) {
        const match = line.match(/(?:Name|नाम|NAME)\s*[:：]?\s*([A-Za-z\u0900-\u097F][A-Za-z\u0900-\u097F\s]+)/i);
        if (match) {
          nameMatch = match;
          break;
        }
      }
    }
  }
  if (!nameMatch) {
    for (let i = 0; i < originalLines.length; i++) {
      const line = originalLines[i];
      if (/Ayushman|आयुष्मान|ABHA|आभा|Health|Account|खाता/i.test(line)) continue;
      if (/(?:Abha\s*Number|Abha\s*Address|Gender|Date|Birth|Mobile|[0-9]{10}|@abdm|@sbx)/i.test(line)) continue;
      const namePattern = line.match(/^([A-Z][a-z]+(?:\s+[A-Z][a-z]+){1,3})(?:\s+[A-Z][a-z]{0,2})?/);
      if (namePattern && namePattern[1].length > 5) {
        nameMatch = namePattern;
        break;
      }
      const hindiNamePattern = line.match(/^([\u0900-\u097F]{2,}(?:\s+[\u0900-\u097F]{2,}){1,3})/);
      if (hindiNamePattern && hindiNamePattern[1].length > 3) {
        nameMatch = hindiNamePattern;
        break;
      }
    }
  }
  if (nameMatch) {
    let name = nameMatch[1].trim().replace(/\s+/g, " ");
    name = name.replace(/\s+[A-Z][a-z]{0,2}$/, "");
    result.name = name;
  }
  let abhaNumberMatch = cleanTextNormalizedDigits.match(/(?:ABHA\s*(?:Number|No\.?|Card\s*Number)|आभा\s*(?:नंबर|संख्या))\s*[:：]?\s*([0-9OIlSBo\s-]{12,24})/i);
  if (!abhaNumberMatch) {
    abhaNumberMatch = cleanTextNormalizedDigits.match(/(?:^|\s)([0-9OIlSBo]{2}[\s-:]?[0-9OIlSBo]{4}[\s-:]?[0-9OIlSBo]{4}[\s-:]?[0-9OIlSBo]{4})(?:\s|$)/);
  }
  if (!abhaNumberMatch) {
    for (const line of originalLines) {
      if (/(?:ABHA|आभा|Health\s*ID)/i.test(line) && /\d{10,}/.test(line)) {
        const match = line.match(/([0-9OIlSBo०-९\s:-]{12,30})/);
        if (match) {
          const cleaned = normalizeOcrNumber(match[1]).replace(/\D/g, "");
          if (cleaned.length === 14) {
            abhaNumberMatch = match;
            break;
          }
        }
      }
    }
  }
  if (abhaNumberMatch) {
    const cleaned = normalizeOcrNumber(abhaNumberMatch[1]).replace(/\D/g, "");
    if (cleaned.length >= 14) {
      result.abhaNumber = cleaned.slice(0, 14);
    }
  }
  if (!result.abhaNumber) {
    const candidates = collectNumericCandidates(cleanTextNormalizedDigits);
    if (candidates.length > 0) {
      result.abhaNumber = candidates[0];
    }
  }
  const abhaAddressMatch = cleanText.match(/(?:ABHA\s*Address|आभा\s*पता|Address)\s*[:：]?\s*([a-zA-Z0-9._-]+@[a-zA-Z0-9.-]+)/i);
  if (abhaAddressMatch) {
    result.abhaAddress = abhaAddressMatch[1].trim().toLowerCase();
  } else {
    const addressFallback = cleanText.match(/([a-zA-Z0-9._-]+@(?:abdm|sbx))/i);
    if (addressFallback) {
      result.abhaAddress = addressFallback[1].toLowerCase();
    }
  }
  let genderMatch = cleanText.match(/(?:Gender|लिंग|SEX)\s*[:：\/]?\s*[^\n]{0,30}?\s*(Female|महिला|Male|पुरुष)/i);
  if (!genderMatch) {
    genderMatch = cleanText.match(/\b(Female|महिला|Male|पुरुष)\b/i);
  }
  if (!genderMatch) {
    for (const line of originalLines) {
      if (/(?:Gender|लिंग|SEX)/i.test(line)) {
        const match = line.match(/(Female|महिला|Male|पुरुष)/i);
        if (match) {
          genderMatch = match;
          break;
        }
      }
    }
  }
  if (!genderMatch) {
    for (const line of originalLines) {
      if (/(?:\d{2}[\/-]\d{2}[\/-]\d{4}|\d{10})/.test(line)) {
        const match = line.match(/(Female|महिला|Male|पुरुष)/i);
        if (match) {
          genderMatch = match;
          break;
        }
      }
    }
  }
  if (genderMatch) {
    const gender = genderMatch[1].toUpperCase();
    if (gender === "पुरुष" || gender === "M" || gender === "MALE") result.gender = "Male";
    else if (gender === "महिला" || gender === "F" || gender === "FEMALE") result.gender = "Female";
    else if (gender === "अन्य" || gender === "OTHER") result.gender = "Other";
    else result.gender = genderMatch[1];
  }
  let dobMatch = cleanText.match(/(?:Date\s*of\s*Birth|DOB|Birth\s*Date|जन्म\s*(?:तिथि|दिनांक))\s*[:：]?\s*(\d{1,2}[\/-]\d{1,2}[\/-]\d{2,4})/i);
  if (!dobMatch) {
    for (const line of originalLines) {
      if (/(?:Date\s*of\s*Birth|DOB|Birth|जन्म)/i.test(line)) {
        const match = line.match(/(\d{1,2}[\/-]\d{1,2}[\/-]\d{2,4})/);
        if (match) {
          dobMatch = match;
          break;
        }
      }
    }
  }
  if (!dobMatch) {
    dobMatch = cleanText.match(/(?:^|\s)(\d{1,2}[\/-]\d{1,2}[\/-]\d{4})(?:\s|$)/);
  }
  if (dobMatch) {
    result.dob = dobMatch[1].replace(/[.-]/g, "/");
  }
  let mobileMatch = cleanText.match(/(?:Mobile|Phone|Contact|मोबाइल|संपर्क)\s*[:：]?\s*(?:[+]?91[\s-]?)?(\d{10})/i);
  if (!mobileMatch) {
    mobileMatch = cleanText.match(/[+]91[\s-]?(\d{10})/);
  }
  if (!mobileMatch) {
    for (const line of originalLines) {
      if (/(?:Mobile|Phone|Contact|मोबाइल|Tel|Mob)/i.test(line)) {
        const match = line.match(/(?:[+]?91[\s-]?)?(\d{10})/);
        if (match) {
          mobileMatch = match;
          break;
        }
      }
    }
  }
  if (!mobileMatch) {
    const matches = cleanText.match(/(?<!\d)(\d{10})(?!\d)/g);
    if (matches && matches.length > 0) {
      for (const match of matches) {
        if (result.abhaNumber && result.abhaNumber.includes(match)) {
          continue;
        }
        mobileMatch = [match, match];
        break;
      }
    }
  }
  if (mobileMatch) {
    result.mobile = mobileMatch[1];
  }
  return result;
}
function parseABHAFromQR(qrData) {
  const result = {
    name: null,
    abhaNumber: null,
    abhaAddress: null,
    gender: null,
    dob: null,
    mobile: null
  };
  if (!qrData || typeof qrData !== "string" || !qrData.trim()) return result;
  const raw = qrData.trim();
  const tryJSON = (str) => {
    try {
      return JSON.parse(str);
    } catch {
      return null;
    }
  };
  let parsed = null;
  if (raw.startsWith("{") || raw.startsWith("[")) {
    parsed = tryJSON(raw);
  } else {
    const jsonMatch = raw.match(/(\{[\s\S]*\})/);
    if (jsonMatch) parsed = tryJSON(jsonMatch[1]);
  }
  if (parsed && typeof parsed === "object") {
    const pick = (...keys) => {
      for (const k of keys) {
        const v = parsed[k] ?? parsed[k.toLowerCase()] ?? parsed[k.toUpperCase()];
        if (v && String(v).trim()) return String(v).trim();
      }
      return null;
    };
    const rawAbha = pick("hidn", "healthId", "abhaNumber", "ABHA_Number", "healthIdNumber", "phr");
    if (rawAbha) {
      const digits = rawAbha.replace(/\D/g, "");
      if (digits.length >= 14) result.abhaNumber = digits.slice(0, 14);
    }
    result.abhaAddress = pick("hid", "abhaAddress", "phrAddress", "address") || null;
    if (result.abhaAddress && !result.abhaAddress.includes("@")) result.abhaAddress = null;
    result.name = pick("name", "Name", "fullName") || null;
    const g = pick("gender", "Gender", "sex");
    if (g) {
      const upper = g.toUpperCase();
      if (upper === "M" || upper === "MALE") result.gender = "Male";
      else if (upper === "F" || upper === "FEMALE") result.gender = "Female";
      else if (upper === "O" || upper === "OTHER") result.gender = "Other";
      else result.gender = g;
    }
    const dob = pick("dob", "dateOfBirth", "DOB", "birthDate");
    if (dob) {
      const dateMatch = dob.match(/(\d{1,4})[-\/\.](\d{1,2})[-\/\.](\d{1,4})/);
      if (dateMatch) {
        const [, p1, p2, p3] = dateMatch;
        if (p1.length === 4) {
          result.dob = `${p2.padStart(2, "0")}/${p3.padStart(2, "0")}/${p1}`;
        } else {
          const year = p3.length === 2 ? `19${p3}` : p3;
          result.dob = `${p1.padStart(2, "0")}/${p2.padStart(2, "0")}/${year}`;
        }
      }
    }
    const mob = pick("mobile", "mobileNumber", "phone", "phoneNumber");
    if (mob) {
      const digits = mob.replace(/\D/g, "");
      result.mobile = digits.slice(-10) || null;
    }
    return result;
  }
  const urlAbhaMatch = raw.match(/(?:healthid\.ndhm\.gov\.in|abha\.abdm\.gov\.in)\/([0-9-]{14,17})/i);
  if (urlAbhaMatch) {
    const digits = urlAbhaMatch[1].replace(/\D/g, "");
    if (digits.length >= 14) result.abhaNumber = digits.slice(0, 14);
  }
  const hidnMatch = raw.match(/hidn[=:\s]+([0-9-]{14,17})/i);
  if (hidnMatch) {
    result.abhaNumber = hidnMatch[1].replace(/\D/g, "").slice(0, 14);
  }
  const hidMatch = raw.match(/hid[=:\s]+([a-zA-Z0-9._-]+@(?:abdm|sbx))/i);
  if (hidMatch) result.abhaAddress = hidMatch[1].toLowerCase();
  if (!result.abhaAddress) {
    const addrFallback = raw.match(/([a-zA-Z0-9._-]+@(?:abdm|sbx))/i);
    if (addrFallback) result.abhaAddress = addrFallback[1].toLowerCase();
  }
  return result;
}
function parseDrivingLicenceText(text) {
  console.log("[DL-PARSER] Parsing started");
  if (!text || typeof text !== "string") {
    console.log("[DL-PARSER] Empty or invalid text");
    return { fields: getEmptyDLStructure(), confidence: 0, missingFields: [] };
  }
  text = cleanupOCRText(text);
  const lines = text.replace(/\r/g, "").split("\n").map(normalizeLine).filter(Boolean);
  const joinedText = lines.join("\n");
  console.log("[DL-PARSER] Total lines:", lines.length);
  const licenseNumber = extractLicenseNumber(joinedText);
  const name = extractName(lines);
  const dob = extractDOB(lines, joinedText);
  const fatherName = extractFatherName(lines, joinedText);
  const bloodGroup = extractBloodGroup(lines, joinedText);
  const organDonor = extractOrganDonor(lines);
  const gender = extractGender(lines, joinedText);
  const rtoCode = extractRTOCode(licenseNumber);
  const state = extractState(licenseNumber, lines);
  const issuedBy = extractIssuedBy(lines);
  const issueDate = extractIssueDate(lines, joinedText);
  const firstIssueDate = extractFirstIssueDate(lines, joinedText);
  const validityNT = extractValidityNT(lines, joinedText);
  const validityTR = extractValidityTR(lines, joinedText);
  const address = extractAddressStructured(lines, joinedText);
  const vehicleClasses = extractVehicleClassesDetailed(lines, joinedText);
  const licensingOffice = extractLicensingOffice(lines, joinedText);
  const emergencyContact = extractEmergencyContact(lines);
  const fields = {
    documentType: "DRIVING_LICENSE",
    licenseNumber,
    state,
    country: "IN",
    issuedBy: issuedBy || deriveIssuedBy(state),
    rtoCode,
    issueDate: formatDate(issueDate),
    firstIssueDate: formatDate(firstIssueDate),
    validityNT: formatDate(validityNT),
    validityTR: formatDate(validityTR),
    name: cleanName(name),
    dob: formatDate(dob),
    gender,
    bloodGroup,
    organDonor,
    fatherName: cleanName(fatherName),
    address,
    vehicleClasses,
    licensingOffice,
    emergencyContact
  };
  const { confidence, missingFields } = calculateConfidence(fields);
  console.log("[DL-PARSER] Parsing completed");
  console.log(`[DL-PARSER] Confidence: ${confidence}%`);
  if (missingFields.length > 0) {
    console.log(`[DL-PARSER] Missing fields: ${missingFields.join(", ")}`);
  }
  return { fields, confidence, missingFields };
}
function cleanupOCRText(text) {
  if (!text) return "";
  return text.replace(/\r/g, "").replace(/[ \t]+/g, " ").replace(/([A-Z]{2})([Oo0])(\d[A-Z])/g, (match, p1, p2, p3) => {
    return p1 + "0" + p3;
  }).replace(/\n{3,}/g, "\n\n").replace(/(\d{2})[\.\/](\d{2})[\.\/](\d{4})/g, "$1-$2-$3").split("\n").map((line) => line.trim()).join("\n").trim();
}
function getEmptyDLStructure() {
  return {
    documentType: "DRIVING_LICENSE",
    licenseNumber: null,
    state: null,
    country: "IN",
    issuedBy: null,
    rtoCode: null,
    issueDate: null,
    firstIssueDate: null,
    validityNT: null,
    validityTR: null,
    name: null,
    dob: null,
    gender: null,
    bloodGroup: null,
    organDonor: null,
    fatherName: null,
    address: {},
    vehicleClasses: [],
    licensingOffice: null,
    emergencyContact: null
  };
}
function deriveIssuedBy(state) {
  if (!state) return null;
  return `GOVERNMENT OF ${state}`;
}
function calculateConfidence(fields) {
  const criticalFields = [
    "licenseNumber",
    "name",
    "dob",
    "issueDate",
    "state",
    "rtoCode"
  ];
  const importantFields = [
    "fatherName",
    "bloodGroup",
    "validityNT",
    "validityTR",
    "address",
    "vehicleClasses",
    "licensingOffice"
  ];
  const missingFields = [];
  let criticalCount = 0;
  let importantCount = 0;
  for (const field of criticalFields) {
    if (fields[field]) {
      criticalCount++;
    } else {
      missingFields.push(field);
    }
  }
  for (const field of importantFields) {
    const value = fields[field];
    if (value && (Array.isArray(value) ? value.length > 0 : typeof value === "object" ? Object.keys(value).some((k) => value[k]) : true)) {
      importantCount++;
    } else {
      missingFields.push(field);
    }
  }
  const criticalScore = criticalCount / criticalFields.length * 70;
  const importantScore = importantCount / importantFields.length * 30;
  const confidence = Math.round(criticalScore + importantScore);
  return { confidence, missingFields };
}
function normalizeLine(line) {
  return line ? line.replace(/\s+/g, " ").trim() : "";
}
function cleanValue(value) {
  if (!value) return null;
  const cleaned = value.replace(/\s+/g, " ").trim();
  return cleaned || null;
}
function cleanName(name) {
  if (!name) return null;
  return name.replace(/^[:\-\s]+/, "").replace(/\s+/g, " ").trim() || null;
}
function extractLicenseNumber(text) {
  let match = text.match(/\b([A-Z]{2}[0-9]{2}[A-Z0-9]{1}[0-9]{11})\b/);
  if (match) return match[1];
  match = text.match(/\b([A-Z]{2}[\s\-]?[0-9]{2}[\s\-]?[A-Z0-9]{1}[\s\-]?[0-9]{11})\b/);
  if (match) return match[1].replace(/[\s\-]/g, "");
  match = text.match(/\b([A-Z]{2}[0-9]{2}[A-Z]{1}[0-9]{7,11})\b/);
  if (match) return match[1];
  match = text.match(/(?:DL\s+No|License\s+No|Licence\s+No)[:\-\s]*([A-Z0-9\s\-]{12,20})/i);
  if (match) return match[1].replace(/[\s\-]/g, "");
  return null;
}
function extractRTOCode(licenseNumber) {
  if (!licenseNumber) return null;
  if (licenseNumber.length >= 5) {
    const code = licenseNumber.substring(0, 5);
    if (/^[A-Z]{2}[0-9]{2}[A-Z0-9]$/.test(code)) {
      return code;
    }
  }
  if (licenseNumber.length >= 4) {
    const code = licenseNumber.substring(0, 4);
    if (/^[A-Z]{2}[0-9]{2}$/.test(code)) {
      return code;
    }
  }
  return null;
}
function extractState(licenseNumber, lines) {
  let state = null;
  if (licenseNumber) {
    const stateCode = licenseNumber.substring(0, 2);
    state = getStateFromCode(stateCode);
  }
  if (!state) {
    for (const line of lines) {
      const match = line.match(/GOVERNMENT\s+OF\s+([A-Z]+)/i);
      if (match) {
        state = match[1].toUpperCase();
        break;
      }
    }
  }
  if (!state) {
    for (const line of lines) {
      if (/Address/i.test(line)) {
        const stateMatch = line.match(/,\s*([A-Z]{2})\s*,/);
        if (stateMatch) {
          state = getStateFromCode(stateMatch[1]);
          break;
        }
      }
    }
  }
  return state;
}
function getStateFromCode(stateCode) {
  if (!stateCode) return null;
  const stateMap = {
    "RJ": "RAJASTHAN",
    "MH": "MAHARASHTRA",
    "UP": "UTTAR PRADESH",
    "DL": "DELHI",
    "KA": "KARNATAKA",
    "TN": "TAMIL NADU",
    "GJ": "GUJARAT",
    "WB": "WEST BENGAL",
    "MP": "MADHYA PRADESH",
    "PB": "PUNJAB",
    "HR": "HARYANA",
    "KL": "KERALA",
    "TG": "TELANGANA",
    "JK": "JAMMU & KASHMIR",
    "HP": "HIMACHAL PRADESH",
    "UK": "UTTARAKHAND",
    "AP": "ANDHRA PRADESH",
    "BR": "BIHAR",
    "OD": "ODISHA",
    "OR": "ODISHA",
    "CT": "CHHATTISGARH",
    "CG": "CHHATTISGARH",
    "AS": "ASSAM",
    "GA": "GOA",
    "JH": "JHARKHAND",
    "MN": "MANIPUR",
    "ML": "MEGHALAYA",
    "MZ": "MIZORAM",
    "NL": "NAGALAND",
    "SK": "SIKKIM",
    "TR": "TRIPURA",
    "AR": "ARUNACHAL PRADESH"
  };
  return stateMap[stateCode.toUpperCase()] || null;
}
function extractName(lines, joinedText) {
  for (let i = 0; i < lines.length; i++) {
    if (/^Name\s*[:\-]/i.test(lines[i])) {
      const match = lines[i].match(/^Name\s*[:\-]\s*(.+)/i);
      if (match) return match[1];
    }
    if (/Name\s+Date\s+Of\s+Birth/i.test(lines[i])) {
      for (let j = i - 1; j >= 0; j--) {
        if (!/\d{2}[\/-]\d{2}[\/-]\d{4}/.test(lines[j]) && lines[j].length > 2) {
          return lines[j];
        }
      }
    }
  }
  return null;
}
function extractDOB(lines, joinedText) {
  for (let i = 0; i < lines.length; i++) {
    if (/Date\s+Of\s+Birth|DOB/i.test(lines[i])) {
      const match2 = lines[i].match(/\d{2}[\/-]\d{2}[\/-]\d{4}/);
      if (match2) {
        const year = parseInt(match2[0].split(/[\/-]/)[2]);
        if (year >= 1930 && year <= 2010) {
          return match2[0];
        }
      }
      for (let j = i + 1; j < Math.min(i + 3, lines.length); j++) {
        const nextMatch = lines[j].match(/\d{2}[\/-]\d{2}[\/-]\d{4}/);
        if (nextMatch) {
          const year = parseInt(nextMatch[0].split(/[\/-]/)[2]);
          if (year >= 1930 && year <= 2010) {
            return nextMatch[0];
          }
        }
      }
    }
  }
  let match = joinedText.match(/Date\s+Of\s+Birth[:\-\s]*(\d{2}[\/-]\d{2}[\/-]\d{4})/i);
  if (match) {
    const year = parseInt(match[1].split(/[\/-]/)[2]);
    if (year >= 1930 && year <= 2010) {
      return match[1];
    }
  }
  match = joinedText.match(/:\s*(\d{2}[\/-]\d{2}[\/-]\d{4})\n:\s+[A-Z]/m);
  if (match) {
    const year = parseInt(match[1].split(/[\/-]/)[2]);
    if (year >= 1930 && year <= 2010) {
      return match[1];
    }
  }
  return null;
}
function extractFatherName(lines, joinedText) {
  let match = joinedText.match(/:\s*([A-Z][A-Z\s]+)\n[^]*?Indian\s+Union\s+Driving\s+Licence/i);
  if (match) {
    const name = cleanValue(match[1]);
    if (name && name.length > 3 && !/Address|WN|Validity|issued|Form/.test(name)) {
      return name;
    }
  }
  match = joinedText.match(/:\s*([A-Z][A-Z\s]+)\n[^]*?:\s*\d{2}[\/-]\d{2}[\/-]\d{4}\n[^]*?:\s*([A-Z][A-Z\s]+)\nName\s+Date/i);
  if (match && match[1]) {
    const name = cleanValue(match[1]);
    if (name && name.length > 3 && !/Address|WN|Validity|issued|Form|RJ\d+/.test(name)) {
      return name;
    }
  }
  for (let i = 0; i < lines.length; i++) {
    if (/^:\s+[A-Z]/.test(lines[i])) {
      const candidate = cleanValue(lines[i].replace(/^:\s*/, ""));
      let hasIdentityBelow = false;
      for (let j = i + 1; j < Math.min(i + 10, lines.length); j++) {
        if (/Name\s+Date\s+Of\s+Birth/i.test(lines[j])) {
          hasIdentityBelow = true;
          break;
        }
      }
      if (hasIdentityBelow && candidate.length > 3 && !/Address|WN|RJ\d+|Validity|issued|Form|blood|Organ/.test(candidate)) {
        return candidate;
      }
    }
  }
  return null;
}
function extractIssueDate(lines, joinedText) {
  for (let i = 0; i < lines.length; i++) {
    if (/(?:Date\s+Of\s+Issue|Issue\s+Date|DOI)(?!\s*First)/i.test(lines[i])) {
      const match2 = lines[i].match(/\d{2}[\/-]\d{2}[\/-]\d{4}/);
      if (match2) return match2[0];
      for (let j = i + 1; j < Math.min(i + 3, lines.length); j++) {
        const nextMatch = lines[j].match(/\d{2}[\/-]\d{2}[\/-]\d{4}/);
        if (nextMatch) return nextMatch[0];
      }
    }
  }
  const match = joinedText.match(/(?:Issue\s+Date|Date\s+Of\s+Issue)[:\-\s]+(\d{2}[\/-]\d{2}[\/-]\d{4})/i);
  return match ? match[1] : null;
}
function extractFirstIssueDate(lines, joinedText) {
  for (let i = 0; i < lines.length; i++) {
    if (/Date\s+Of\s+First\s+Issue/i.test(lines[i])) {
      const match2 = lines[i].match(/\d{2}[\/-]\d{2}[\/-]\d{4}/);
      if (match2) return match2[0];
      if (i > 0) {
        const prevMatch = lines[i - 1].match(/\d{2}[\/-]\d{2}[\/-]\d{4}/);
        if (prevMatch) return prevMatch[0];
      }
      if (i + 1 < lines.length) {
        const nextMatch = lines[i + 1].match(/\d{2}[\/-]\d{2}[\/-]\d{4}/);
        if (nextMatch) return nextMatch[0];
      }
    }
  }
  const match = joinedText.match(/(\d{2}[\/-]\d{2}[\/-]\d{4})[\s\n]+Date\s+Of\s+First\s+Issue/i);
  return match ? match[1] : null;
}
function extractValidityNT(lines, joinedText) {
  for (let i = 0; i < lines.length; i++) {
    if (/Validity\s*\(\s*NT\s*\)/i.test(lines[i])) {
      if (i > 0) {
        const prevMatch = lines[i - 1].match(/\d{2}[\/-]\d{2}[\/-]\d{4}/);
        if (prevMatch) {
          const year = parseInt(prevMatch[0].split(/[\/-]/)[2]);
          if (year >= 2025 && year <= 2070) {
            return prevMatch[0];
          }
        }
      }
      let match2 = lines[i].match(/\d{2}[\/-]\d{2}[\/-]\d{4}/);
      if (match2) {
        const year = parseInt(match2[0].split(/[\/-]/)[2]);
        if (year >= 2025 && year <= 2070) {
          return match2[0];
        }
      }
      if (i + 1 < lines.length) {
        match2 = lines[i + 1].match(/\d{2}[\/-]\d{2}[\/-]\d{4}/);
        if (match2) {
          const year = parseInt(match2[0].split(/[\/-]/)[2]);
          if (year >= 2025 && year <= 2070) {
            return match2[0];
          }
        }
      }
    }
  }
  let match = joinedText.match(/(\d{2}[\/\-]\d{2}[\/\-]\d{4})\s*.*?Validity\s*\(\s*NT\s*\)/i);
  if (match) {
    const year = parseInt(match[1].split(/[\/-]/)[2]);
    if (year >= 2025 && year <= 2070) {
      return match[1];
    }
  }
  match = joinedText.match(/Validity\s*\(\s*NT\s*\)\s*(\d{2}[\/\-]\d{2}[\/\-]\d{4})/i);
  if (match) {
    const year = parseInt(match[1].split(/[\/-]/)[2]);
    if (year >= 2025 && year <= 2070) {
      return match[1];
    }
  }
  return null;
}
function extractValidityTR(lines, joinedText) {
  for (let i = 0; i < lines.length; i++) {
    if (/Validity\s*\(\s*TR\s*\)/i.test(lines[i])) {
      let match2 = lines[i].match(/\d{2}[\/-]\d{2}[\/-]\d{4}/);
      if (match2) {
        const year = parseInt(match2[0].split(/[\/-]/)[2]);
        if (year >= 2020 && year <= 2050) {
          return match2[0];
        }
      }
      if (i > 0) {
        const prevMatch = lines[i - 1].match(/\d{2}[\/-]\d{2}[\/-]\d{4}/);
        if (prevMatch) {
          const year = parseInt(prevMatch[0].split(/[\/-]/)[2]);
          if (year >= 2020 && year <= 2050) {
            return prevMatch[0];
          }
        }
      }
      if (i + 1 < lines.length) {
        match2 = lines[i + 1].match(/\d{2}[\/-]\d{2}[\/-]\d{4}/);
        if (match2) {
          const year = parseInt(match2[0].split(/[\/-]/)[2]);
          if (year >= 2020 && year <= 2050) {
            return match2[0];
          }
        }
      }
    }
  }
  const match = joinedText.match(/Validity\s*\(\s*TR\s*\)\s*(\d{2}[\/-]\d{2}[\/-]\d{4})/i);
  if (match) {
    const year = parseInt(match[1].split(/[\/-]/)[2]);
    if (year >= 2020 && year <= 2050) {
      return match[1];
    }
  }
  return null;
}
function extractBloodGroup(lines, joinedText) {
  for (const line of lines) {
    if (/Blood\s+Group|Gr[ou]?p/i.test(line)) {
      const match2 = line.match(/(A|B|AB|O)[+-]/);
      if (match2) return match2[0];
    }
  }
  const match = joinedText.match(/[:\s](A|B|AB|O)[+-]/);
  if (match) {
    return match[1] + match[0].slice(-1);
  }
  return null;
}
function extractOrganDonor(lines, joinedText) {
  for (const line of lines) {
    if (/Organ\s+Donor/i.test(line)) {
      if (/Yes/i.test(line)) return true;
      if (/No/i.test(line)) return false;
      const match = line.match(/Organ\s+Donor\s*[:\-]?\s*(Yes|No)/i);
      if (match) return match[1].toLowerCase() === "yes";
    }
  }
  return null;
}
function extractGender(lines, joinedText) {
  for (const line of lines) {
    let match2 = line.match(/(?:Gender|Sex)\s*[:\-]?\s*([MF])/i);
    if (match2) {
      return match2[1].toUpperCase();
    }
  }
  let match = joinedText.match(/(?:Gender|Sex)\s*[:\-]?\s*([MF])/i);
  if (match) return match[1].toUpperCase();
  if (/\bMale\b/i.test(joinedText)) return "M";
  if (/\bFemale\b/i.test(joinedText)) return "F";
  return null;
}
function extractIssuedBy(lines, joinedText) {
  for (const line of lines) {
    if (/GOVERNMENT\s+OF|Issued\s+By/i.test(line)) {
      const match = line.match(/GOVERNMENT\s+OF\s+(\w+)/i);
      if (match) return `GOVERNMENT OF ${match[1].toUpperCase()}`;
      return cleanValue(line);
    }
  }
  return null;
}
function extractAddressStructured(lines, joinedText) {
  const address = {
    wardNo: null,
    locality: null,
    city: null,
    district: null,
    state: null,
    pincode: null
  };
  let addressText = "";
  for (let i = 0; i < lines.length; i++) {
    if (/Address/i.test(lines[i])) {
      let match = lines[i].match(/Address[:\-]\s*(.+)/i);
      if (match && match[1].length > 3) {
        addressText = match[1];
      } else {
        const addressLines = [];
        for (let j = i + 1; j < Math.min(i + 4, lines.length); j++) {
          const line = lines[j];
          if (/Form\s+\d+|Rule\s+\d+|Badge|Licencing|Vehicle|Code/i.test(line)) break;
          if (line.length > 2) {
            addressLines.push(line);
          }
        }
        addressText = addressLines.join(", ");
      }
      break;
    }
  }
  if (!addressText) {
    const match = joinedText.match(/Address[:\-\s]+([^]*?)(?:Form|Rule|Badge|$)/i);
    if (match) {
      addressText = match[1].replace(/\n/g, " ").trim();
    }
  }
  if (addressText) {
    const parsed = parseIndianAddress(addressText);
    return { ...address, ...parsed };
  }
  return address;
}
function parseIndianAddress(addressStr) {
  if (!addressStr) return {};
  const address = {
    wardNo: null,
    locality: null,
    city: null,
    district: null,
    state: null,
    pincode: null
  };
  addressStr = addressStr.replace(/Form\s+\d+|Rule\s+\d.*/gi, "").trim();
  let pincodeMatch = addressStr.match(/(\d{6})/);
  if (pincodeMatch) address.pincode = pincodeMatch[1];
  let stateMatch = addressStr.match(/,\s*([A-Z]{2})\s*,/);
  if (stateMatch) {
    address.state = stateMatch[1];
  }
  let wardMatch = addressStr.match(/\bWN\s+(\d+)/i);
  if (wardMatch) address.wardNo = `WN ${wardMatch[1]}`;
  let cleanedAddr = addressStr.replace(/\bWN\s+\d+\s*/i, "").replace(/,\s*[A-Z]{2}\s*,\s*\d{6}.*/, "").trim();
  let localityMatch = cleanedAddr.match(/\b(?:SD|RD|BO|PO)\s+([A-Z]+)/i);
  if (localityMatch) {
    address.locality = localityMatch[1];
    cleanedAddr = cleanedAddr.replace(/\b(?:SD|RD|BO|PO)\s+[A-Z]+/i, "").trim();
  }
  const parts = cleanedAddr.split(/,/).map((p) => p.replace(/\d+\s*/g, "").trim()).filter((p) => p.length > 1);
  if (parts.length >= 2) {
    address.city = parts[0];
    address.district = parts[1];
  } else if (parts.length === 1) {
    address.city = parts[0];
  }
  return address;
}
function extractVehicleClassesDetailed(lines, joinedText) {
  const vehicleClasses = [];
  const vehicleTypes = /* @__PURE__ */ new Set();
  const vehicleInfo = {};
  const classPatterns = /\b(LMV|HMV|MCWG|MCWOG|MCW|TRAC|TRANS|HPMV|GVWR)\b/gi;
  let match;
  while ((match = classPatterns.exec(joinedText)) !== null) {
    vehicleTypes.add(match[1].toUpperCase());
  }
  for (const type of vehicleTypes) {
    const info = extractVehicleClassInfo(lines, joinedText, type);
    vehicleInfo[type] = info;
  }
  for (const type of vehicleTypes) {
    const info = vehicleInfo[type];
    const vehicleClass = {
      type,
      category: info.category || null,
      issueDate: formatDate(info.issueDate) || null
    };
    if (info.badgeNumber) {
      vehicleClass.badgeNumber = info.badgeNumber;
    }
    vehicleClasses.push(vehicleClass);
  }
  return vehicleClasses;
}
function extractVehicleClassInfo(lines, joinedText, vehicleType) {
  const info = {
    category: null,
    issueDate: null,
    badgeNumber: null
  };
  let codeLineIndex = -1;
  let vehicleOrder = [];
  for (let i = 0; i < lines.length; i++) {
    if (/Code\s+/i.test(lines[i]) && /MCWG|LMV|TRANS|HMV/i.test(lines[i])) {
      codeLineIndex = i;
      const matches = lines[i].match(/\b(LMV|HMV|MCWG|MCWOG|MCW|TRAC|TRANS|HPMV|GVWR)\b/gi);
      if (matches) {
        vehicleOrder = matches.map((m) => m.toUpperCase());
      }
      break;
    }
  }
  if (codeLineIndex !== -1 && vehicleOrder.length > 0) {
    const vehicleIndex = vehicleOrder.indexOf(vehicleType.toUpperCase());
    if (vehicleIndex !== -1) {
      for (let i = codeLineIndex - 1; i >= Math.max(0, codeLineIndex - 10); i--) {
        const line = lines[i];
        if (/\bNT\b.*\bTR\b|\bTR\b.*\bNT\b|Hill\s+Validity|Vehicle\s+Category/i.test(line)) {
          const categories = line.match(/\b(NT|TR)\b/gi);
          if (categories && categories.length > vehicleIndex) {
            info.category = categories[vehicleIndex].toUpperCase();
            break;
          }
        }
      }
      for (let i = codeLineIndex - 1; i >= Math.max(0, codeLineIndex - 10); i--) {
        const line = lines[i];
        const dates = [];
        let match;
        const dateRegex = /\d{2}[\/-]\d{2}[\/-]\d{4}/g;
        while ((match = dateRegex.exec(line)) !== null) {
          dates.push(match[0]);
        }
        if (dates.length > vehicleIndex && !info.issueDate) {
          info.issueDate = dates[vehicleIndex];
        }
      }
    }
  }
  if (/TRANS/i.test(vehicleType)) {
    const badgeMatch = joinedText.match(/Badge\s+(?:Number|No\.?)\s*[:\-]?\s*(\S+)/i);
    if (badgeMatch) info.badgeNumber = badgeMatch[1];
    const badgeDateMatch = joinedText.match(/Badge\s+issued\s+date\s+(\d{2}[/-]\d{2}[/-]\d{4})/i);
    if (badgeDateMatch) info.issueDate = badgeDateMatch[1];
  }
  return info;
}
function extractLicensingOffice(lines, joinedText) {
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    let match2 = line.match(/SUB\s+OFFICE[,:]\s*([A-Z\s,]+?)(?:\s+Hill|\s+Badge|\s+Vehicle|\s+Category|$)/i);
    if (match2) {
      const location = cleanValue(match2[1]);
      if (location && location.length > 2) return location;
    }
    if (/Licencing\s+Authority/i.test(line) && i + 1 < lines.length) {
      const nextLine = lines[i + 1];
      if (!/Badge|Issued|Code|Hill|Validity|Vehicle|Category/i.test(nextLine)) {
        const location = cleanValue(nextLine);
        if (location && location.length > 2) return location;
      }
    }
  }
  let match = joinedText.match(/SUB\s+OFFICE[,:\s]+([A-Z\s,]+?)(?:\s+Hill|\s+Badge|\s+Vehicle|$)/i);
  if (match) {
    const location = cleanValue(match[1]);
    if (location && location.length > 2) return location;
  }
  return null;
}
function extractEmergencyContact(lines, joinedText) {
  for (const line of lines) {
    if (/Emergency\s+Contact/i.test(line)) {
      const match = line.match(/Emergency\s+Contact\s+(?:Number|No\.?)[:\-\s]*(.+)/i);
      if (match) return cleanValue(match[1]);
    }
  }
  return null;
}
function formatDate(dateStr) {
  if (!dateStr) return null;
  const match = dateStr.match(/(\d{2})[/-](\d{2})[/-](\d{4})/);
  if (!match) return null;
  const day = match[1];
  const month = match[2];
  const year = match[3];
  return `${year}-${month}-${day}`;
}
function makeBinary(img, threshold) {
  img.scan(0, 0, img.bitmap.width, img.bitmap.height, function(x, y, idx) {
    const val = this.bitmap.data[idx] > threshold ? 255 : 0;
    this.bitmap.data[idx] = this.bitmap.data[idx + 1] = this.bitmap.data[idx + 2] = val;
  });
  return img;
}
const SHARPEN_KERNEL = [
  [0, -1, 0],
  [-1, 5, -1],
  [0, -1, 0]
];
async function decodeQRImage(imagePath) {
  try {
    console.log("🔍 Decoding QR from cropped image:", imagePath);
    if (!fs$1.existsSync(imagePath)) {
      console.log("⚠️ QR image file not found");
      return null;
    }
    let image = await jimp.Jimp.read(imagePath);
    const cropMinSide = Math.min(image.bitmap.width, image.bitmap.height);
    const cropScale = cropMinSide > 0 ? Math.min(4, Math.max(1, Math.round(600 / cropMinSide))) : 2;
    const cropHiScale = Math.min(cropScale + 1, 4);
    const strategies = [
      { name: "original", process: (img) => img },
      { name: "grey-contrast", process: (img) => img.greyscale().contrast(0.5).normalize() },
      { name: "sx-upscale", process: (img) => img.scale(cropScale) },
      { name: "sx-grey-contrast", process: (img) => img.scale(cropScale).greyscale().contrast(0.7) },
      { name: "sx-sharpen-grey", process: (img) => img.scale(cropScale).greyscale().convolute(SHARPEN_KERNEL).normalize() },
      { name: "sx-sharpen-binary-128", process: (img) => makeBinary(img.scale(cropScale).greyscale().convolute(SHARPEN_KERNEL).normalize(), 128) },
      { name: "hx-grey-hi-contrast", process: (img) => img.scale(cropHiScale).greyscale().contrast(1).normalize() },
      { name: "hx-sharpen-binary-128", process: (img) => makeBinary(img.scale(cropHiScale).greyscale().convolute(SHARPEN_KERNEL).normalize(), 128) },
      { name: "hx-sharpen-binary-100", process: (img) => makeBinary(img.scale(cropHiScale).greyscale().convolute(SHARPEN_KERNEL).normalize(), 100) }
    ];
    for (const strategy of strategies) {
      console.log(`  Trying decode strategy: ${strategy.name}...`);
      const processedImage = image.clone();
      strategy.process(processedImage);
      const { width, height, data } = processedImage.bitmap;
      const rgbaData = new Uint8ClampedArray(data);
      const qrCode = jsQR(rgbaData, width, height, {
        inversionAttempts: "attemptBoth"
      });
      if (qrCode && qrCode.data) {
        console.log(`✅ QR decoded with strategy: ${strategy.name}`);
        console.log(`📱 Data: ${qrCode.data.substring(0, 100)}...`);
        return qrCode.data;
      }
    }
    console.log("⚠️ Could not decode QR with any strategy");
    return null;
  } catch (err) {
    console.error("❌ QR decode error:", err.message);
    return null;
  }
}
async function detectFace(imagePath) {
  try {
    console.log("🔍 Analyzing image for face region:", imagePath);
    const image = await jimp.Jimp.read(imagePath);
    const { width, height } = image.bitmap;
    const candidateRegions = [
      // Top-left (common in Indian IDs)
      { name: "top-left", x: 0.05, y: 0.15, w: 0.25, h: 0.35 },
      { name: "top-left-wide", x: 0.05, y: 0.18, w: 0.3, h: 0.4 },
      // Top-right (common in ABHA, some cards)
      { name: "top-right", x: 0.7, y: 0.15, w: 0.25, h: 0.35 },
      { name: "top-right-wide", x: 0.65, y: 0.18, w: 0.3, h: 0.4 },
      // Left-center (some licenses)
      { name: "left-center", x: 0.05, y: 0.25, w: 0.25, h: 0.4 },
      // Right-center
      { name: "right-center", x: 0.7, y: 0.25, w: 0.25, h: 0.4 }
    ];
    let bestRegion = null;
    let highestScore = 0;
    for (const region of candidateRegions) {
      const cropX = Math.floor(width * region.x);
      const cropY = Math.floor(height * region.y);
      const cropW = Math.floor(width * region.w);
      const cropH = Math.floor(height * region.h);
      const sample = image.clone().crop({ x: cropX, y: cropY, w: cropW, h: cropH });
      const variance = calculateVariance(sample);
      const edgeScore = calculateEdgeDensity(sample);
      const skinToneScore = calculateSkinTonePresence(sample);
      const score = variance * 0.4 + edgeScore * 0.3 + skinToneScore * 0.3;
      console.log(`  ${region.name}: score=${score.toFixed(0)} (var=${variance.toFixed(0)}, edge=${edgeScore.toFixed(0)}, skin=${skinToneScore.toFixed(0)})`);
      if (score > highestScore) {
        highestScore = score;
        bestRegion = {
          x: cropX,
          y: cropY,
          width: cropW,
          height: cropH,
          name: region.name,
          score
        };
      }
    }
    if (bestRegion && bestRegion.score > 1e3) {
      console.log(`✅ Best face region: ${bestRegion.name} (score: ${bestRegion.score.toFixed(0)})`);
      return bestRegion;
    }
    console.log("⚠️ Could not determine best face region (low confidence)");
    return null;
  } catch (err) {
    console.error("❌ Face region detection error:", err.message);
    return null;
  }
}
function calculateVariance(jimpImage) {
  const { data, width, height } = jimpImage.bitmap;
  let sum = 0;
  let sumSq = 0;
  const totalPixels = width * height;
  for (let i = 0; i < data.length; i += 4) {
    const gray = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
    sum += gray;
    sumSq += gray * gray;
  }
  const mean = sum / totalPixels;
  const variance = sumSq / totalPixels - mean * mean;
  return variance;
}
function calculateEdgeDensity(jimpImage) {
  const { data, width, height } = jimpImage.bitmap;
  let edgeCount = 0;
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const i = (y * width + x) * 4;
      const center = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
      const iRight = i + 4;
      const iBottom = i + width * 4;
      const right = 0.299 * data[iRight] + 0.587 * data[iRight + 1] + 0.114 * data[iRight + 2];
      const bottom = 0.299 * data[iBottom] + 0.587 * data[iBottom + 1] + 0.114 * data[iBottom + 2];
      const gradX = Math.abs(center - right);
      const gradY = Math.abs(center - bottom);
      if (gradX > 30 || gradY > 30) {
        edgeCount++;
      }
    }
  }
  return edgeCount;
}
function calculateSkinTonePresence(jimpImage) {
  const { data } = jimpImage.bitmap;
  let skinPixels = 0;
  for (let i = 0; i < data.length; i += 4) {
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    if (r > 95 && g > 40 && b > 20 && r > g && r > b && Math.abs(r - g) > 15 && r - b > 15) {
      skinPixels++;
    }
  }
  return skinPixels;
}
async function detectQRCode(imagePath) {
  try {
    console.log("🔍 Detecting QR code in:", imagePath);
    let image = await jimp.Jimp.read(imagePath);
    const originalWidth = image.bitmap.width;
    const originalHeight = image.bitmap.height;
    const minSide = Math.min(originalWidth, originalHeight);
    const smartScale = minSide > 0 ? Math.min(5, Math.max(1, Math.round(1200 / minSide))) : 2;
    const hiScale = Math.min(smartScale + 1, 5);
    const strategies = [
      { name: "original", process: (img) => img },
      { name: "grey-contrast-norm", process: (img) => img.greyscale().contrast(0.7).normalize() },
      { name: "sx-grey-hi-contrast", process: (img) => img.scale(smartScale).greyscale().contrast(1).normalize() },
      { name: "sx-binary-100", process: (img) => makeBinary(img.scale(smartScale).greyscale(), 100) },
      { name: "sx-binary-128", process: (img) => makeBinary(img.scale(smartScale).greyscale(), 128) },
      { name: "sx-binary-150", process: (img) => makeBinary(img.scale(smartScale).greyscale(), 150) },
      { name: "sx-sharpen-grey", process: (img) => img.scale(smartScale).greyscale().convolute(SHARPEN_KERNEL).normalize() },
      { name: "sx-sharpen-binary-128", process: (img) => makeBinary(img.scale(smartScale).greyscale().convolute(SHARPEN_KERNEL).normalize(), 128) },
      { name: "sx-blur-binary", process: (img) => makeBinary(img.scale(smartScale).greyscale().blur(1), 128) },
      { name: "sx-inverted", process: (img) => img.scale(smartScale).greyscale().invert().contrast(0.9) },
      { name: "hx-grey-hi-contrast", process: (img) => img.scale(hiScale).greyscale().contrast(1).normalize() },
      { name: "hx-binary-128", process: (img) => makeBinary(img.scale(hiScale).greyscale(), 128) },
      { name: "hx-sharpen-binary-128", process: (img) => makeBinary(img.scale(hiScale).greyscale().convolute(SHARPEN_KERNEL).normalize(), 128) },
      { name: "hx-sharpen-binary-100", process: (img) => makeBinary(img.scale(hiScale).greyscale().convolute(SHARPEN_KERNEL).normalize(), 100) }
    ];
    for (const strategy of strategies) {
      console.log(`  Trying strategy: ${strategy.name}...`);
      const processedImage = image.clone();
      strategy.process(processedImage);
      const { width, height, data } = processedImage.bitmap;
      const rgbaData = new Uint8ClampedArray(data);
      const qrCode = jsQR(rgbaData, width, height, {
        inversionAttempts: "attemptBoth"
        // Try both normal and inverted
      });
      if (qrCode) {
        console.log(`✅ QR detected with strategy: ${strategy.name}`);
        const scale = width / originalWidth;
        const { topLeftCorner, topRightCorner, bottomLeftCorner, bottomRightCorner } = qrCode.location;
        const minX = Math.min(topLeftCorner.x, bottomLeftCorner.x) / scale;
        const maxX = Math.max(topRightCorner.x, bottomRightCorner.x) / scale;
        const minY = Math.min(topLeftCorner.y, topRightCorner.y) / scale;
        const maxY = Math.max(bottomLeftCorner.y, bottomRightCorner.y) / scale;
        const padding = 0.25;
        const qrWidth = maxX - minX;
        const qrHeight = maxY - minY;
        const paddedBox = {
          x: Math.max(0, Math.floor(minX - qrWidth * padding)),
          y: Math.max(0, Math.floor(minY - qrHeight * padding)),
          width: Math.floor(qrWidth * (1 + 2 * padding)),
          height: Math.floor(qrHeight * (1 + 2 * padding)),
          data: qrCode.data
          // Decoded QR data
        };
        paddedBox.width = Math.min(paddedBox.width, originalWidth - paddedBox.x);
        paddedBox.height = Math.min(paddedBox.height, originalHeight - paddedBox.y);
        console.log("✅ QR code detected at:", paddedBox);
        console.log("📱 QR data length:", qrCode.data.length, "chars");
        console.log("📝 QR data preview:", qrCode.data.substring(0, 100));
        return paddedBox;
      }
    }
    console.log("⚠️ No QR code detected with any strategy");
    return null;
  } catch (err) {
    console.error("❌ QR detection error:", err.message);
    return null;
  }
}
async function extractFaceRegion(imagePath, outputPath) {
  try {
    const faceBox = await detectFace(imagePath);
    if (!faceBox) return null;
    const image = await jimp.Jimp.read(imagePath);
    const face = image.clone().crop({
      x: faceBox.x,
      y: faceBox.y,
      w: faceBox.width,
      h: faceBox.height
    });
    await face.write(outputPath);
    console.log("✅ Face saved to:", outputPath);
    return outputPath;
  } catch (err) {
    console.error("❌ Face extraction error:", err.message);
    return null;
  }
}
async function detectSignatureRegion(imagePath) {
  try {
    console.log("🔍 Analyzing image for signature region:", imagePath);
    const image = await jimp.Jimp.read(imagePath);
    const { width, height } = image.bitmap;
    const candidateRegions = [
      // Wide center-bottom (most common signature placement)
      { name: "wide-center-bottom", x: 0.25, y: 0.7, w: 0.5, h: 0.13 },
      { name: "wide-center-bottom2", x: 0.25, y: 0.75, w: 0.5, h: 0.13 },
      { name: "wide-center-bottom3", x: 0.2, y: 0.68, w: 0.55, h: 0.15 },
      // Slightly narrower
      { name: "mid-center-bottom", x: 0.3, y: 0.7, w: 0.4, h: 0.12 },
      { name: "mid-center-bottom2", x: 0.3, y: 0.75, w: 0.4, h: 0.13 },
      // Lower strip
      { name: "lower-left", x: 0.05, y: 0.78, w: 0.45, h: 0.13 },
      { name: "lower-center", x: 0.2, y: 0.78, w: 0.55, h: 0.13 },
      { name: "lower-right", x: 0.5, y: 0.78, w: 0.45, h: 0.13 },
      // Near-bottom strip
      { name: "bottom-left", x: 0.05, y: 0.82, w: 0.45, h: 0.12 },
      { name: "bottom-center", x: 0.2, y: 0.82, w: 0.55, h: 0.12 },
      { name: "bottom-right", x: 0.5, y: 0.82, w: 0.45, h: 0.12 }
    ];
    let bestRegion = null;
    let highestScore = 0;
    for (const region of candidateRegions) {
      const cropX = Math.floor(width * region.x);
      const cropY = Math.floor(height * region.y);
      const cropW = Math.floor(width * region.w);
      const cropH = Math.floor(height * region.h);
      if (cropW < 20 || cropH < 8) continue;
      const sample = image.clone().crop({ x: cropX, y: cropY, w: cropW, h: cropH });
      const strokeDensity = calculateStrokeDensity(sample);
      if (strokeDensity < 0.02 || strokeDensity > 0.45) {
        console.log(`  ${region.name}: skipped (strokeDensity=${strokeDensity.toFixed(3)})`);
        continue;
      }
      const aspectRatio = cropW / cropH;
      if (aspectRatio < 1.5) {
        console.log(`  ${region.name}: skipped (aspectRatio=${aspectRatio.toFixed(2)})`);
        continue;
      }
      const edgeScore = calculateEdgeDensity(sample);
      const skinScore = calculateSkinTonePresence(sample);
      if (skinScore > 500) {
        console.log(`  ${region.name}: skipped (high skin score=${skinScore})`);
        continue;
      }
      const { data: bmpData, width: bmpW, height: bmpH } = sample.bitmap;
      const rgba = new Uint8ClampedArray(bmpData);
      if (jsQR(rgba, bmpW, bmpH, { inversionAttempts: "dontInvert" })) {
        console.log(`  ${region.name}: skipped (QR code detected)`);
        continue;
      }
      const densityScore = 1 - Math.abs(strokeDensity - 0.12) / 0.12;
      const score = densityScore * 100 + aspectRatio * 10 + edgeScore * 0.05;
      console.log(`  ${region.name}: score=${score.toFixed(1)} (stroke=${strokeDensity.toFixed(3)}, ar=${aspectRatio.toFixed(2)}, edge=${edgeScore.toFixed(0)})`);
      if (score > highestScore) {
        highestScore = score;
        bestRegion = { x: cropX, y: cropY, width: cropW, height: cropH, name: region.name, score };
      }
    }
    if (bestRegion && bestRegion.score > 10) {
      console.log(`✅ Best signature region: ${bestRegion.name} (score: ${bestRegion.score.toFixed(1)})`);
      return bestRegion;
    }
    console.log("⚠️ Could not determine signature region (low confidence)");
    return null;
  } catch (err) {
    console.error("❌ Signature detection error:", err.message);
    return null;
  }
}
function calculateStrokeDensity(jimpImage) {
  const { data, width, height } = jimpImage.bitmap;
  let darkPixels = 0;
  const totalPixels = width * height;
  for (let i = 0; i < data.length; i += 4) {
    const brightness = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
    if (brightness < 100) darkPixels++;
  }
  return darkPixels / totalPixels;
}
function removeSignatureBackground(image, whiteThreshold = 220) {
  jimp.Jimp.ALPHA_CHANNEL;
  image.scan(0, 0, image.bitmap.width, image.bitmap.height, function(x, y, idx) {
    const r = this.bitmap.data[idx];
    const g = this.bitmap.data[idx + 1];
    const b = this.bitmap.data[idx + 2];
    const brightness = (r + g + b) / 3;
    if (brightness > whiteThreshold) {
      this.bitmap.data[idx + 3] = 0;
    }
  });
  return image;
}
async function extractSignatureRegion(imagePath, outputPath) {
  try {
    const sigBox = await detectSignatureRegion(imagePath);
    if (!sigBox) return null;
    const image = await jimp.Jimp.read(imagePath);
    const sig = image.clone().crop({
      x: sigBox.x,
      y: sigBox.y,
      w: sigBox.width,
      h: sigBox.height
    });
    removeSignatureBackground(sig);
    await sig.write(outputPath);
    console.log("✅ Signature saved to:", outputPath);
    return outputPath;
  } catch (err) {
    console.error("❌ Signature extraction error:", err.message);
    return null;
  }
}
async function extractQRRegion(imagePath, outputPath) {
  try {
    const qrBox = await detectQRCode(imagePath);
    if (!qrBox) return null;
    const image = await jimp.Jimp.read(imagePath);
    const qr = image.clone().crop({
      x: qrBox.x,
      y: qrBox.y,
      w: qrBox.width,
      h: qrBox.height
    });
    const minQrSide = 600;
    const currentMinSide = Math.min(qr.bitmap.width, qr.bitmap.height);
    if (currentMinSide > 0 && currentMinSide < minQrSide) {
      qr.scale(minQrSide / currentMinSide);
    }
    qr.greyscale().convolute(SHARPEN_KERNEL).contrast(0.5).normalize();
    await qr.write(outputPath);
    console.log("✅ QR code saved to:", outputPath);
    return {
      path: outputPath,
      data: qrBox.data
    };
  } catch (err) {
    console.error("❌ QR extraction error:", err.message);
    return null;
  }
}
function getBaseDir() {
  return global.__imagesBaseDir || process.cwd();
}
function buildDetectedImagePath(outputDir, documentId) {
  const fileName = `asset-${documentId}-${Date.now()}.png`;
  return {
    absolutePath: path.join(outputDir, fileName),
    relativePath: `/images/${documentId}/${fileName}`
  };
}
function applyFixedAadhaarImageSelection(imagePaths, result, imageObject) {
  if (!Array.isArray(imagePaths) || imagePaths.length === 0) return;
  const qrImagePath = imagePaths[0] || null;
  const faceImagePath = imagePaths[7] || null;
  imageObject.qrImage = qrImagePath;
  imageObject.faceImage = faceImagePath;
  result.structured.aadhaarFixedImageSelection = {
    qrSourceIndex: 1,
    qrImagePath,
    faceSourceIndex: 8,
    faceImagePath,
    availableImageCount: imagePaths.length
  };
  if (qrImagePath) {
    result.structured.qrDetected = qrImagePath;
    console.log("   ✓ Aadhaar fixed QR image mapped from image 1");
  }
  if (faceImagePath) {
    result.structured.faceDetected = faceImagePath;
    console.log("   ✓ Aadhaar fixed face image mapped from image 8");
  }
}
function applyFixedPanImageSelection(imagePaths, result, imageObject) {
  if (!Array.isArray(imagePaths) || imagePaths.length === 0) return;
  const cardImagePath = imagePaths[6] || null;
  const qrImagePath = imagePaths[7] || null;
  const faceImagePath = imagePaths[8] || null;
  const signatureImagePath = imagePaths[9] || imagePaths[2] || null;
  if (cardImagePath) {
    result.structured.cardImagePath = cardImagePath;
    imageObject.cardImage = cardImagePath;
  }
  if (qrImagePath) {
    imageObject.qrImage = qrImagePath;
    result.structured.qrDetected = qrImagePath;
  }
  if (faceImagePath) {
    imageObject.faceImage = faceImagePath;
    result.structured.faceDetected = faceImagePath;
  }
  if (signatureImagePath) {
    imageObject.signatureImage = signatureImagePath;
    result.structured.signatureDetected = signatureImagePath;
  }
  result.structured.panFixedImageSelection = {
    cardSourceIndex: cardImagePath ? 7 : null,
    cardImagePath,
    qrSourceIndex: qrImagePath ? 8 : null,
    qrImagePath,
    faceSourceIndex: faceImagePath ? 9 : null,
    faceImagePath,
    signatureSourceIndex: signatureImagePath === imagePaths[9] ? 10 : signatureImagePath ? 3 : null,
    signatureImagePath,
    availableImageCount: imagePaths.length
  };
  if (cardImagePath) {
    console.log("   ✓ PAN fixed card image mapped from image 7");
  }
  if (qrImagePath) {
    console.log("   ✓ PAN fixed QR image mapped from image 8");
  }
  if (faceImagePath) {
    console.log("   ✓ PAN fixed face image mapped from image 9");
  }
  if (signatureImagePath === imagePaths[9]) {
    console.log("   ✓ PAN fixed signature image mapped from image 10");
  } else if (signatureImagePath === imagePaths[2]) {
    console.log("   ✓ PAN fixed signature image mapped from image 3");
  }
}
const DOCUMENT_CONFIG = {
  AADHAAR: {
    ocrLanguages: "eng+hin",
    enableSplitting: true,
    minImageSize: 20,
    // Capture address blocks and small elements
    parser: async (text) => {
      const result = parseAadhaarText(text);
      return result.fields || result;
    },
    hasPhoto: true,
    hasQR: true,
    hasSignature: false
  },
  PAN: {
    ocrLanguages: "eng",
    enableSplitting: false,
    parser: async (text) => {
      const result = parsePanText(text);
      return result.fields || result;
    },
    hasPhoto: true,
    hasQR: true,
    hasSignature: true
  },
  AYUSHMAN: {
    ocrLanguages: "eng+hin",
    enableSplitting: false,
    minImageSize: 20,
    // Capture QR codes and all text blocks
    parser: async (text) => {
      const result = parseAyushmanText(text);
      return result.fields || result;
    },
    hasPhoto: false,
    hasQR: true,
    hasSignature: false
  },
  DRIVING_LICENCE: {
    ocrLanguages: "eng+hin",
    enableSplitting: false,
    minImageSize: 10,
    // Capture signatures and small text sections
    parser: async (text) => {
      const result = parseDrivingLicenceText(text);
      return result.fields || result;
    },
    hasPhoto: true,
    hasQR: true,
    hasSignature: true
  },
  ELECTION_CARD: {
    ocrLanguages: "eng+hin",
    enableSplitting: false,
    minImageSize: 10,
    // Very low threshold to capture signatures (typically 20-50px)
    parser: async (text) => {
      const result = parseElectionText(text);
      return result.fields || result;
    },
    hasPhoto: true,
    hasQR: false,
    hasSignature: true
  },
  ABHA: {
    ocrLanguages: "eng+hin",
    enableSplitting: false,
    forceImagePipeline: true,
    minImageSize: 10,
    // Capture signatures, QR code, and all details
    parser: async (text) => parseABHAText(text),
    hasPhoto: true,
    hasQR: true,
    hasSignature: false
  },
  "E-SHRAM": {
    ocrLanguages: "eng+hin",
    enableSplitting: true,
    forceImagePipeline: true,
    minImageSize: 15,
    // Capture signatures and all text blocks
    parser: parseEShramEnhanced,
    hasPhoto: true,
    hasQR: true,
    hasSignature: false,
    extractRegions: [
      {
        name: "name-region",
        source: "front",
        x: 0,
        // Start from left edge
        y: 0.15,
        // Below header
        w: 1,
        // Full width
        h: 0.25
        // Name area (15-40% height)
      }
    ]
  }
};
const processPDF = async ({ documentId, filePath, password, useOCR, documentType }) => {
  console.log("\n" + "=".repeat(60));
  console.log(`🚀 STARTING PROCESSING: ${documentId}`);
  console.log(`📄 Document Type: ${documentType}`);
  console.log(`📁 File Path: ${filePath}`);
  const forceOCR = documentType === "E-SHRAM";
  const actualUseOCR = forceOCR || useOCR;
  console.log(`🔤 OCR Enabled: ${actualUseOCR} ${forceOCR ? "(forced for E-SHRAM)" : ""}`);
  console.log("=".repeat(60) + "\n");
  if (!fs$1.existsSync(filePath)) {
    throw new Error(`File not found: ${filePath}`);
  }
  try {
    await ExtractedData.findByIdAndUpdate(documentId, { status: "processing" });
    const config = DOCUMENT_CONFIG[documentType];
    if (!config) {
      throw new Error(`Unsupported document type: ${documentType}`);
    }
    const isImagePDF = config?.forceImagePipeline || await isImageBasedPDF(filePath, password);
    if (isImagePDF) {
      console.log(`✅ ${documentType} is IMAGE-BASED → Using specialized pipeline
`);
      await handleImageBasedPDF({ documentId, filePath, password, useOCR: actualUseOCR, documentType }, config);
    } else {
      console.log(`✅ ${documentType} is TEXT-BASED → Direct extraction
`);
      await handleTextBasedPDF({ documentId, filePath, password, useOCR: actualUseOCR, documentType }, config);
    }
    console.log("\n" + "=".repeat(60));
    console.log(`✅ ${documentType} PROCESSING COMPLETED: ${documentId}`);
    console.log("=".repeat(60) + "\n");
  } catch (error) {
    console.error("\n" + "!".repeat(60));
    console.error(`❌ PROCESSING FAILED: ${documentId}`);
    console.error(`💥 Error: ${error.message}`);
    console.error("!".repeat(60) + "\n");
    await ExtractedData.findByIdAndUpdate(documentId, {
      status: "failed",
      error: error.message
    });
    throw error;
  }
};
async function handleImageBasedPDF(jobData, config) {
  const { documentId, filePath, password, documentType } = jobData;
  const docId = documentId.toString();
  console.log(`⚙️  Config: ${documentType} → ${config.enableSplitting ? "Front/Back split + " : ""}${config.ocrLanguages} OCR`);
  const result = await processImagePDF(filePath, docId, {
    documentType,
    ocrLanguages: config.ocrLanguages,
    enableSplitting: config.enableSplitting,
    extractRegions: config.extractRegions || [],
    parser: config.parser,
    password
  });
  console.log("\n" + "-".repeat(60));
  console.log("🎯 SMART DETECTION: Photo + QR Code");
  console.log("-".repeat(60));
  const outputDir = path.join(getBaseDir(), "images", docId);
  await performSmartDetection(result, config, outputDir, docId, documentType);
  if (documentType === "ABHA" && result.structured.qrData) {
    console.log("\n🔗 ABHA: merging QR data into extracted fields...");
    const qrFields = parseABHAFromQR(result.structured.qrData);
    let merged = 0;
    for (const [key, value] of Object.entries(qrFields)) {
      if (value && !result.structured[key]) {
        result.structured[key] = value;
        merged++;
        console.log(`   ✅ QR filled missing field "${key}": ${String(value).substring(0, 60)}`);
      }
    }
    if (merged === 0) console.log("   ℹ️  All ABHA fields already populated from OCR.");
  }
  console.log("\n📦 Building Response Structure...");
  const imageObject = buildImageObject(result);
  console.log("\n💾 Saving to Database...");
  console.log("   Images:", Object.keys(imageObject).join(", "));
  console.log("   QR Data Available:", !!result.structured.qrData);
  console.log("   Parsed Fields:", Object.keys(result.structured).length);
  await ExtractedData.findByIdAndUpdate(documentId, {
    status: "completed",
    structured: result.structured,
    images: [imageObject]
  });
}
async function handleTextBasedPDF(jobData, config) {
  const { documentId, filePath, password, useOCR, documentType } = jobData;
  const docId = documentId.toString();
  const docOutputDir = path.join(getBaseDir(), "images", docId);
  console.log("-".repeat(60));
  console.log("📖 TEXT EXTRACTION");
  console.log("-".repeat(60));
  console.log("\n📝 Step 1: Extracting text from PDF...");
  const textData = await extractText(filePath, { password });
  let finalText = textData.text || "";
  console.log(`   ✓ Extracted ${finalText.length} characters`);
  console.log("\n🖼️  Step 2: Extracting embedded images...");
  const imageOptions = { minSize: config?.minImageSize || 100 };
  const imagePaths = await extractImages(filePath, docOutputDir, password, imageOptions);
  console.log(`   ✓ Found ${imagePaths.length} image(s)`);
  if ((useOCR || !finalText.trim()) && imagePaths.length > 0) {
    console.log("\n🔤 Step 3: Running OCR on images...");
    const ocrText = await performOCR(imagePaths);
    finalText = finalText.trim() ? `${finalText}

--- OCR ---
${ocrText}` : ocrText;
    console.log(`   ✓ OCR added ${ocrText.length} characters`);
  } else {
    console.log("\n🔤 Step 3: OCR → Skipped (not needed)");
  }
  console.log("\n" + "-".repeat(60));
  console.log("📋 PARSING STRUCTURED FIELDS");
  console.log("-".repeat(60) + "\n");
  console.log(`⚙️  Parser: ${documentType}`);
  let parserOptions = {};
  if (documentType === "E-SHRAM" && imagePaths.length > 0) {
    parserOptions = {
      frontPath: imagePaths[0],
      // First image is front card
      outputDir: docOutputDir
    };
  }
  const structuredFields = config?.parser ? await config.parser(finalText, parserOptions) : {};
  console.log(`   ✓ Parsed ${Object.keys(structuredFields).length} field(s)`);
  if (Object.keys(structuredFields).length > 0) {
    console.log("   Fields:", Object.keys(structuredFields).join(", "));
  }
  const imageObject = imagePaths.reduce((acc, p, i) => {
    acc[`image${i + 1}`] = p;
    return acc;
  }, {});
  const result = {
    structured: {
      ...structuredFields,
      rawText: finalText,
      // Use the first extracted image as primary card image for smart detection
      ...imagePaths[0] ? { cardImagePath: imagePaths[0] } : {}
    }
  };
  if (imagePaths.length > 0) {
    console.log("\n" + "-".repeat(60));
    console.log("🎯 SMART DETECTION: Photo + QR Code + Signature");
    console.log("-".repeat(60));
    await performSmartDetection(result, config, docOutputDir, docId, documentType);
  }
  Object.assign(imageObject, buildImageObject(result));
  if (documentType === "AADHAAR") {
    applyFixedAadhaarImageSelection(imagePaths, result, imageObject);
  }
  if (documentType === "PAN") {
    applyFixedPanImageSelection(imagePaths, result, imageObject);
  }
  console.log("\n💾 Saving to Database...");
  console.log("   Images:", imagePaths.length);
  console.log("   Text Length:", finalText.length);
  console.log("   Structured Fields:", Object.keys(structuredFields).length);
  await ExtractedData.findByIdAndUpdate(documentId, {
    status: "completed",
    images: [imageObject],
    structured: result.structured
  });
}
async function performSmartDetection(result, config, outputDir, documentId, documentType) {
  if (config.hasPhoto) {
    console.log("\n👤 Step 1: Photo Detection (JS)");
    const imagePath = documentType === "E-SHRAM" && result.structured.frontCardPath ? path.join(getBaseDir(), result.structured.frontCardPath.replace(/^\//, "")) : path.join(getBaseDir(), result.structured.cardImagePath.replace(/^\//, ""));
    const faceAsset = buildDetectedImagePath(outputDir, documentId);
    const faceOutputPath = faceAsset.absolutePath;
    try {
      const faceSuccess = await extractFaceRegion(imagePath, faceOutputPath);
      if (faceSuccess && fs$1.existsSync(faceOutputPath)) {
        result.structured.faceDetected = faceAsset.relativePath;
        console.log("   ✅ Face region extracted");
      } else {
        console.log("   ⚠️  Face region not found, coordinate-based fallback will be used");
      }
    } catch (err) {
      console.warn("   ⚠️  Face detection failed:", err.message);
    }
  } else {
    console.log("\n👤 Step 1: Photo Detection → Skipped (not applicable)");
  }
  if (config.hasQR) {
    console.log("\n📱 Step 2: QR Code Detection (JS / jsQR)");
    if (result.structured.qrData && result.structured.qrData.toString().trim()) {
      console.log("   ✅ QR data already available from parser, skipping redundant QR detection");
    } else {
      const scanImagePath = documentType === "E-SHRAM" && result.structured.backCardPath ? path.join(getBaseDir(), result.structured.backCardPath.replace(/^\//, "")) : path.join(getBaseDir(), result.structured.cardImagePath.replace(/^\//, ""));
      const qrAsset = buildDetectedImagePath(outputDir, documentId);
      const qrOutputPath = qrAsset.absolutePath;
      let decoded = null;
      let qrFoundByJs = false;
      try {
        const qrSuccess = await extractQRRegion(scanImagePath, qrOutputPath);
        if (qrSuccess && fs$1.existsSync(qrOutputPath)) {
          qrFoundByJs = true;
          result.structured.qrDetected = qrAsset.relativePath;
          console.log("   ✅ QR region extracted");
          decoded = qrSuccess.data && qrSuccess.data.trim() ? qrSuccess.data : await decodeQRImage(qrOutputPath);
          if (decoded) {
            result.structured.qrData = decoded;
            console.log(`   📊 QR decoded: ${decoded.length} characters`);
          } else {
            console.log("   ⚠️  QR region found but could not decode data");
          }
        } else {
          console.log("   ⚠️  QR region not found");
        }
      } catch (err) {
        console.warn("   ⚠️  QR detection failed:", err.message);
      }
    }
  } else {
    console.log("\n📱 Step 2: QR Code Detection → Skipped (not applicable)");
  }
  if (config.hasSignature) {
    console.log("\n✍️  Step 3: Signature Detection (JS)");
    const sigSourcePath = documentType === "E-SHRAM" && result.structured.frontCardPath ? path.join(getBaseDir(), result.structured.frontCardPath.replace(/^\//, "")) : path.join(getBaseDir(), result.structured.cardImagePath.replace(/^\//, ""));
    const signatureAsset = buildDetectedImagePath(outputDir, documentId);
    const sigOutputPath = signatureAsset.absolutePath;
    try {
      const sigSuccess = await extractSignatureRegion(sigSourcePath, sigOutputPath);
      if (sigSuccess && fs$1.existsSync(sigOutputPath)) {
        result.structured.signatureDetected = signatureAsset.relativePath;
        console.log("   ✅ Signature region extracted");
      } else {
        console.log("   ⚠️  Signature region not found, coordinate-based fallback will be used");
      }
    } catch (err) {
      console.warn("   ⚠️  Signature detection failed:", err.message);
    }
  } else {
    console.log("\n✍️  Step 3: Signature Detection → Skipped (not applicable)");
  }
}
function buildImageObject(result, config) {
  const imageObject = {
    cardImage: result.structured.cardImagePath
  };
  if (result.structured.frontCardPath) {
    imageObject.frontCard = result.structured.frontCardPath;
    imageObject.backCard = result.structured.backCardPath;
    console.log("   ✓ Front/back split images available");
  }
  if (result.structured.faceDetected) {
    imageObject.faceImage = result.structured.faceDetected;
    console.log("   ✓ Using smart-detected face image");
  } else if (result.structured.face) {
    imageObject.faceImage = result.structured.face;
    console.log("   ✓ Using coordinate-based face image");
  } else if (result.structured.photoDetected) {
    imageObject.photoImage = result.structured.photoDetected;
    console.log("   ✓ Using smart-detected photo image");
  } else if (result.structured.photo) {
    imageObject.photoImage = result.structured.photo;
    console.log("   ✓ Using coordinate-based photo image");
  }
  if (result.structured.qrDetected) {
    imageObject.qrImage = result.structured.qrDetected;
    console.log("   ✓ Using decoded QR image");
  } else if (result.structured.qr) {
    imageObject.qrImage = result.structured.qr;
    console.log("   ✓ Using coordinate-based QR image");
  }
  if (result.structured.signatureDetected) {
    imageObject.signatureImage = result.structured.signatureDetected;
    console.log("   ✓ Using smart-detected signature image");
  } else if (result.structured.signature) {
    imageObject.signatureImage = result.structured.signature;
    console.log("   ✓ Using coordinate-based signature image");
  }
  return imageObject;
}
electron.protocol.registerSchemesAsPrivileged([
  { scheme: "app", privileges: { standard: true, secure: true, supportFetchAPI: true } }
]);
function createWindow() {
  const mainWindow = new electron.BrowserWindow({
    width: 1200,
    height: 800,
    show: false,
    autoHideMenuBar: true,
    ...process.platform === "linux" ? { icon } : {},
    webPreferences: {
      preload: path.join(__dirname, "../preload/index.js"),
      sandbox: false
    }
  });
  mainWindow.on("ready-to-show", () => {
    mainWindow.show();
  });
  mainWindow.webContents.setWindowOpenHandler((details) => {
    electron.shell.openExternal(details.url);
    return { action: "deny" };
  });
  if (utils.is.dev && process.env["ELECTRON_RENDERER_URL"]) {
    mainWindow.loadURL(process.env["ELECTRON_RENDERER_URL"]);
  } else {
    mainWindow.loadFile(path.join(__dirname, "../renderer/index.html"));
  }
}
electron.app.whenReady().then(() => {
  const userData = electron.app.getPath("userData");
  global.__imagesBaseDir = userData;
  const imagesDir = path.join(userData, "images");
  fs$1.mkdirSync(imagesDir, { recursive: true });
  electron.protocol.handle("app", (request) => {
    const url2 = request.url.slice("app://".length);
    const filePath = path.join(userData, url2);
    return electron.net.fetch("file://" + filePath);
  });
  utils.electronApp.setAppUserModelId("com.electron");
  electron.app.on("browser-window-created", (_, window) => {
    utils.optimizer.watchWindowShortcuts(window);
  });
  electron.ipcMain.on("ping", () => console.log("pong"));
  electron.ipcMain.handle("identity:save", (_event, payload) => {
    const recordId = saveIdentityCard(payload);
    return { ok: true, id: recordId };
  });
  electron.ipcMain.handle("identity:list", (_event, limit = 20) => {
    const safeLimit = Math.max(1, Math.min(Number(limit) || 20, 100));
    return getRecentIdentityCards(safeLimit);
  });
  electron.ipcMain.handle("aadhaar:save", (_event, payload) => {
    const recordId = saveIdentityCard({ ...payload, cardType: "aadhaar" });
    return { ok: true, id: recordId };
  });
  electron.ipcMain.handle("aadhaar:list", (_event, limit = 20) => {
    const safeLimit = Math.max(1, Math.min(Number(limit) || 20, 100));
    return getRecentIdentityCards(safeLimit);
  });
  electron.ipcMain.handle("dialog:openPdf", async () => {
    const result = await electron.dialog.showOpenDialog({
      title: "Select PDF Document",
      filters: [{ name: "PDF Files", extensions: ["pdf"] }],
      properties: ["openFile"]
    });
    if (result.canceled || !result.filePaths.length) return null;
    return { filePath: result.filePaths[0], fileName: path.basename(result.filePaths[0]) };
  });
  electron.ipcMain.handle("pdf:process", async (_event, { filePath, documentType, password, useOCR }) => {
    if (!filePath || !fs$1.existsSync(filePath)) {
      throw new Error("File not found: " + filePath);
    }
    const normalizedType = (documentType || "UNKNOWN").toUpperCase();
    const fileName = path.basename(filePath);
    const doc = new ExtractedData({
      originalName: fileName,
      filePath,
      documentType: normalizedType,
      status: "pending",
      structured: {}
    });
    await doc.save();
    await processPDF({
      documentId: doc._id,
      filePath,
      password: password || null,
      useOCR: Boolean(useOCR),
      documentType: normalizedType
    });
    const completed = await ExtractedData.findById(doc._id);
    return completed;
  });
  electron.ipcMain.handle("image:toDataUrl", (_event, imagePath) => {
    const absPath = path.join(userData, imagePath.replace(/^\//, ""));
    if (!fs$1.existsSync(absPath)) return null;
    const ext = absPath.endsWith(".png") ? "png" : "jpeg";
    const data = fs$1.readFileSync(absPath);
    return `data:image/${ext};base64,${data.toString("base64")}`;
  });
  createWindow();
  electron.app.on("activate", function() {
    if (electron.BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});
electron.app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    electron.app.quit();
  }
});
