import fs from 'node:fs'
import path from 'node:path'
import Database from 'better-sqlite3'
import { app } from 'electron'

let db
let insertStatement
let recentStatement

function tableExists(tableName) {
  const row = db
    .prepare(
      `
        SELECT name
        FROM sqlite_master
        WHERE type = 'table' AND name = ?
      `
    )
    .get(tableName)
  return Boolean(row)
}

function migrateLegacyAadhaarRows() {
  if (!tableExists('aadhaar_cards') || !tableExists('id_cards')) {
    return
  }

  db.exec(`
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
  `)
}

function ensureDbReady() {
  if (db) {
    return
  }

  const dbFolderPath = path.join(app.getPath('userData'), 'db')
  if (!fs.existsSync(dbFolderPath)) {
    fs.mkdirSync(dbFolderPath, { recursive: true })
  }

  const dbFilePath = path.join(dbFolderPath, 'id_cards.sqlite')
  db = new Database(dbFilePath)
  db.pragma('journal_mode = WAL')

  db.exec(`
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
    `)

  migrateLegacyAadhaarRows()

  insertStatement = db.prepare(`
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
    `)

  recentStatement = db.prepare(`
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
    `)
}

export function saveIdentityCard(record) {
  ensureDbReady()

  const result = insertStatement.run({
    card_type: record.cardType || 'aadhaar',
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
  })

  return Number(result.lastInsertRowid)
}

export function getRecentIdentityCards(limit = 20) {
  ensureDbReady()
  return recentStatement.all(limit).map((row) => ({
    ...row,
    details: row.details_json ? JSON.parse(row.details_json) : {}
  }))
}

export function saveAadhaarCard(record) {
  return saveIdentityCard({ ...record, cardType: 'aadhaar', idNumber: record.aadhaarNumber })
}

export function getRecentAadhaarCards(limit = 20) {
  return getRecentIdentityCards(limit)
}
