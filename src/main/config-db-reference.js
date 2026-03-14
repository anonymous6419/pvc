import fs from 'fs';
import path from 'path';
import Database from 'better-sqlite3';

let db = null;

const defaultDbPath = path.join(process.cwd(), 'data', 'pdf_extraction.db');

const ensureSchema = () => {
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

        CREATE INDEX IF NOT EXISTS idx_extracted_data_status
        ON extracted_data(status);

        CREATE INDEX IF NOT EXISTS idx_extracted_data_extracted_at
        ON extracted_data(extracted_at DESC);
    `);
};

const connectDB = async () => {
    try {
        const dbFilePath = process.env.SQLITE_DB_PATH || defaultDbPath;
        fs.mkdirSync(path.dirname(dbFilePath), { recursive: true });

        db = new Database(dbFilePath);
        db.pragma('journal_mode = WAL');
        ensureSchema();

        console.log(`Better-SQLite connected: ${dbFilePath}`);
    } catch (error) {
        console.error(`Database connection error: ${error.message}`);
        process.exit(1);
    }
};

export const getDB = () => {
    if (!db) {
        throw new Error('Database not initialized. Call connectDB() before accessing the database.');
    }
    return db;
};

export const closeDB = async () => {
    if (db) {
        db.close();
        db = null;
        console.log('Better-SQLite connection closed');
    }
};

export default connectDB;
