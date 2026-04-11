const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

// Database file path
const DB_DIR = path.join(__dirname, 'data');
const DB_PATH = path.join(DB_DIR, 'customsai.db');

// Ensure database directory exists
if (!fs.existsSync(DB_DIR)) {
  fs.mkdirSync(DB_DIR, { recursive: true });
}

// Initialize database
const db = new Database(DB_PATH);

// Enable WAL mode for better concurrency
db.pragma('journal_mode = WAL');

// Create tables if they don't exist
function initializeSchema() {
  // User states table
  db.exec(`
    CREATE TABLE IF NOT EXISTS user_states (
      chat_id TEXT NOT NULL,
      platform TEXT NOT NULL,
      state_data TEXT NOT NULL,
      updated_at INTEGER NOT NULL,
      PRIMARY KEY (chat_id, platform)
    )
  `);

  // Declarations table
  db.exec(`
    CREATE TABLE IF NOT EXISTS declarations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_identifier TEXT NOT NULL,
      platform TEXT NOT NULL,
      declaration_data TEXT NOT NULL,
      pdf_path TEXT,
      created_at INTEGER NOT NULL
    )
  `);

  // Create indexes for better performance
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_user_states_updated 
    ON user_states(updated_at)
  `);

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_declarations_user 
    ON declarations(user_identifier)
  `);

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_declarations_created 
    ON declarations(created_at)
  `);

  console.log('✅ Database schema initialized');
}

// State management functions
function setState(chatId, platform, stateData) {
  const stmt = db.prepare(`
    INSERT OR REPLACE INTO user_states (chat_id, platform, state_data, updated_at)
    VALUES (?, ?, ?, ?)
  `);
  
  stmt.run(chatId, platform, JSON.stringify(stateData), Date.now());
}

function getState(chatId, platform) {
  const stmt = db.prepare(`
    SELECT state_data FROM user_states
    WHERE chat_id = ? AND platform = ?
  `);
  
  const row = stmt.get(chatId, platform);
  if (row) {
    return JSON.parse(row.state_data);
  }
  return null;
}

function deleteState(chatId, platform) {
  const stmt = db.prepare(`
    DELETE FROM user_states
    WHERE chat_id = ? AND platform = ?
  `);
  
  stmt.run(chatId, platform);
}

function getAllStates(platform) {
  const stmt = db.prepare(`
    SELECT chat_id, state_data FROM user_states
    WHERE platform = ?
  `);
  
  const rows = stmt.all(platform);
  const states = {};
  rows.forEach(row => {
    states[row.chat_id] = JSON.parse(row.state_data);
  });
  return states;
}

// Declaration management functions
function saveDeclaration(userIdentifier, platform, declarationData, pdfPath) {
  const stmt = db.prepare(`
    INSERT INTO declarations (user_identifier, platform, declaration_data, pdf_path, created_at)
    VALUES (?, ?, ?, ?, ?)
  `);
  
  const result = stmt.run(
    userIdentifier,
    platform,
    JSON.stringify(declarationData),
    pdfPath,
    Date.now()
  );
  
  return result.lastInsertRowid;
}

function getDeclarations(userIdentifier, platform) {
  const stmt = db.prepare(`
    SELECT id, declaration_data, pdf_path, created_at
    FROM declarations
    WHERE user_identifier = ? AND platform = ?
    ORDER BY created_at DESC
    LIMIT 50
  `);
  
  const rows = stmt.all(userIdentifier, platform);
  return rows.map(row => ({
    id: row.id,
    data: JSON.parse(row.declaration_data),
    pdfPath: row.pdf_path,
    createdAt: row.created_at
  }));
}

function getRecentDeclarations(platform, limit = 100) {
  const stmt = db.prepare(`
    SELECT id, user_identifier, declaration_data, pdf_path, created_at
    FROM declarations
    WHERE platform = ?
    ORDER BY created_at DESC
    LIMIT ?
  `);
  
  const rows = stmt.all(platform, limit);
  return rows.map(row => ({
    id: row.id,
    userIdentifier: row.user_identifier,
    data: JSON.parse(row.declaration_data),
    pdfPath: row.pdf_path,
    createdAt: row.created_at
  }));
}

// Cleanup functions
function cleanupOldStates(maxAgeMs = 24 * 60 * 60 * 1000) { // 24 hours
  const cutoffTime = Date.now() - maxAgeMs;
  const stmt = db.prepare(`
    DELETE FROM user_states
    WHERE updated_at < ?
  `);
  
  const result = stmt.run(cutoffTime);
  if (result.changes > 0) {
    console.log('🧹 Cleaned up ' + result.changes + ' old states');
  }
}

function cleanupOldDeclarations(maxAgeMs = 30 * 24 * 60 * 60 * 1000) { // 30 days
  const cutoffTime = Date.now() - maxAgeMs;
  const stmt = db.prepare(`
    DELETE FROM declarations
    WHERE created_at < ?
  `);
  
  const result = stmt.run(cutoffTime);
  if (result.changes > 0) {
    console.log('🧹 Cleaned up ' + result.changes + ' old declarations');
  }
}

// Database maintenance
function vacuum() {
  db.exec('VACUUM');
  console.log('✅ Database vacuumed');
}

function backup(backupPath) {
  const backup = new Database(backupPath);
  db.backup(backup)
    .then(() => {
      console.log('✅ Database backup created: ' + backupPath);
      backup.close();
    })
    .catch(err => {
      console.error('❌ Database backup failed:', err);
      backup.close();
    });
}

// Initialize schema on module load
initializeSchema();

module.exports = {
  setState,
  getState,
  deleteState,
  getAllStates,
  saveDeclaration,
  getDeclarations,
  getRecentDeclarations,
  cleanupOldStates,
  cleanupOldDeclarations,
  vacuum,
  backup,
  db
};
