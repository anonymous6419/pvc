import { randomUUID } from 'crypto'
import fs from 'fs'
import path from 'path'
import Database from 'better-sqlite3'
import { app } from 'electron'

let db = null

function getDB() {
  if (db) return db

  const dbDir = path.join(app.getPath('userData'), 'db')
  fs.mkdirSync(dbDir, { recursive: true })

  const dbPath = path.join(dbDir, 'extraction.sqlite')
  db = new Database(dbPath)
  db.pragma('journal_mode = WAL')

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
  `)

  return db
}

const DOCUMENT_TYPES = new Set([
  'AADHAAR',
  'PAN',
  'ELECTION_CARD',
  'DRIVING_LICENCE',
  'ABHA',
  'AYUSHMAN',
  'E-SHRAM',
  'UNKNOWN'
])
const STATUS_TYPES = new Set(['pending', 'processing', 'completed', 'failed'])

const normDocType = (v) => (DOCUMENT_TYPES.has(v) ? v : 'UNKNOWN')
const normStatus = (v) => (STATUS_TYPES.has(v) ? v : 'pending')

function safeParseJSON(val, fallback) {
  try {
    return val ? JSON.parse(val) : fallback
  } catch {
    return fallback
  }
}

function rowToDoc(row) {
  if (!row) return null
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
  }
}

class ExtractedData {
  constructor(data = {}) {
    const now = new Date().toISOString()
    this._id = data._id || randomUUID()
    this.originalName = data.originalName || ''
    this.filePath = data.filePath || ''
    this.images = Array.isArray(data.images) ? data.images : []
    this.documentType = normDocType(data.documentType || 'UNKNOWN')
    this.status = normStatus(data.status || 'pending')
    this.error = data.error ?? null
    this.structured =
      data.structured && typeof data.structured === 'object' ? data.structured : {}
    this.extractedAt = data.extractedAt || now
    this.createdAt = data.createdAt || now
    this.updatedAt = data.updatedAt || now
  }

  async save() {
    const d = getDB()
    this.updatedAt = new Date().toISOString()

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
    })

    return this
  }

  static async findById(id) {
    const d = getDB()
    const row = d.prepare('SELECT * FROM extracted_data WHERE id = ?').get(id)
    return rowToDoc(row)
  }

  static async findByIdAndUpdate(id, update) {
    const d = getDB()
    const now = new Date().toISOString()

    const sets = ['updated_at = @updated_at']
    const params = { id, updated_at: now }

    if (update.status !== undefined) {
      sets.push('status = @status')
      params.status = normStatus(update.status)
    }
    if (update.error !== undefined) {
      sets.push('error = @error')
      params.error = update.error
    }
    if (update.structured !== undefined) {
      sets.push('structured_json = @structured_json')
      params.structured_json = JSON.stringify(update.structured)
    }
    if (update.images !== undefined) {
      sets.push('images_json = @images_json')
      params.images_json = JSON.stringify(update.images)
    }

    d.prepare(`UPDATE extracted_data SET ${sets.join(', ')} WHERE id = @id`).run(params)

    return ExtractedData.findById(id)
  }

  static find() {
    return {
      sort(spec = {}) {
        this._sort = spec
        return this
      },
      async exec() {
        const d = getDB()
        const rows = d.prepare('SELECT * FROM extracted_data ORDER BY created_at DESC').all()
        return rows.map(rowToDoc)
      },
      then(resolve, reject) {
        return this.exec().then(resolve, reject)
      }
    }
  }
}

export default ExtractedData
