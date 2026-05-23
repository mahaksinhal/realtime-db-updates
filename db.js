import sqlite3 from 'sqlite3';
import { EventEmitter } from 'events';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Support persistent cloud disk volumes (e.g. Render / Fly.io / Railway)
const DB_DIR = process.env.DATA_DIR || __dirname;
if (!fs.existsSync(DB_DIR)) {
  fs.mkdirSync(DB_DIR, { recursive: true });
}

const DB_FILE = path.join(DB_DIR, 'orders.db');

// Enable verbose mode for better debugging logs
const sqlite = sqlite3.verbose();

class DatabaseConnection {
  constructor() {
    this.db = new sqlite.Database(DB_FILE, (err) => {
      if (err) {
        console.error('Failed to connect to the SQLite database:', err.message);
      } else {
        console.log('Connected to SQLite database at:', DB_FILE);
        this.init();
      }
    });
  }

  init() {
    // Enable WAL (Write-Ahead Logging) mode for better concurrent read/write performance
    this.run('PRAGMA journal_mode = WAL;')
      .then((res) => console.log('SQLite WAL mode enabled.'))
      .catch((err) => console.error('Error enabling WAL mode:', err.message));

    // Enable Foreign Key support
    this.run('PRAGMA foreign_keys = ON;')
      .catch((err) => console.error('Error enabling foreign keys:', err.message));

    // Create the 'orders' table
    const createTableQuery = `
      CREATE TABLE IF NOT EXISTS orders (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        customer_name TEXT NOT NULL,
        product_name TEXT NOT NULL,
        status TEXT CHECK(status IN ('pending', 'shipped', 'delivered')) NOT NULL,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `;

    this.run(createTableQuery)
      .then(() => {
        console.log("'orders' table checked/created successfully.");
        this.seedIfEmpty();
      })
      .catch((err) => console.error('Error creating orders table:', err.message));
  }

  async seedIfEmpty() {
    try {
      const row = await this.get('SELECT COUNT(*) AS count FROM orders');
      if (row && row.count === 0) {
        console.log('Seeding initial mock data into empty database...');
        const seedQueries = [
          `INSERT INTO orders (customer_name, product_name, status, updated_at) VALUES ('Liam Neeson', 'MacBook Pro M4', 'shipped', datetime('now', 'localtime', '-15 minutes'))`,
          `INSERT INTO orders (customer_name, product_name, status, updated_at) VALUES ('Olivia Dunham', 'Sony WH-1000XM5', 'pending', datetime('now', 'localtime', '-10 minutes'))`,
          `INSERT INTO orders (customer_name, product_name, status, updated_at) VALUES ('Emma Watson', 'iPad Pro 11"', 'delivered', datetime('now', 'localtime', '-5 minutes'))`,
          `INSERT INTO orders (customer_name, product_name, status, updated_at) VALUES ('Oliver Queen', 'Keychron Q1 Keyboard', 'pending', datetime('now', 'localtime'))`
        ];
        for (const query of seedQueries) {
          await this.run(query);
        }
        console.log('Database seeded successfully with initial orders.');
      }
    } catch (err) {
      console.error('Error seeding database:', err.message);
    }
  }

  // Promise wrapper for db.run
  run(sql, params = []) {
    return new Promise((resolve, reject) => {
      this.db.run(sql, params, function (err) {
        if (err) {
          reject(err);
        } else {
          // Resolve with lastID and changes count
          resolve({ lastID: this.lastID, changes: this.changes });
        }
      });
    });
  }

  // Promise wrapper for db.get (retrieve single row)
  get(sql, params = []) {
    return new Promise((resolve, reject) => {
      this.db.get(sql, params, (err, row) => {
        if (err) {
          reject(err);
        } else {
          resolve(row);
        }
      });
    });
  }

  // Promise wrapper for db.all (retrieve all rows)
  all(sql, params = []) {
    return new Promise((resolve, reject) => {
      this.db.all(sql, params, (err, rows) => {
        if (err) {
          reject(err);
        } else {
          resolve(rows);
        }
      });
    });
  }

  close() {
    return new Promise((resolve, reject) => {
      this.db.close((err) => {
        if (err) reject(err);
        else resolve();
      });
    });
  }
}

export const dbConnection = new DatabaseConnection();

/**
 * OrderRepository wraps database mutations and inherits from EventEmitter.
 * It broadcasts events whenever records are inserted, updated, or deleted.
 */
class OrderRepository extends EventEmitter {
  constructor(connection) {
    super();
    this.db = connection;
  }

  async getAll() {
    return this.db.all('SELECT * FROM orders ORDER BY updated_at DESC');
  }

  async getById(id) {
    return this.db.get('SELECT * FROM orders WHERE id = ?', [id]);
  }

  async create({ customer_name, product_name, status }) {
    const query = `
      INSERT INTO orders (customer_name, product_name, status, updated_at)
      VALUES (?, ?, ?, datetime('now', 'localtime'))
    `;
    const result = await this.db.run(query, [customer_name, product_name, status]);
    const newOrder = await this.getById(result.lastID);

    // Emit the change event to listeners (the WebSocket server)
    this.emit('change', {
      action: 'INSERT',
      data: newOrder
    });

    return newOrder;
  }

  async update(id, { customer_name, product_name, status }) {
    // Check if order exists first
    const existing = await this.getById(id);
    if (!existing) {
      throw new Error(`Order with ID ${id} not found.`);
    }

    const query = `
      UPDATE orders
      SET customer_name = ?, product_name = ?, status = ?, updated_at = datetime('now', 'localtime')
      WHERE id = ?
    `;
    await this.db.run(query, [
      customer_name !== undefined ? customer_name : existing.customer_name,
      product_name !== undefined ? product_name : existing.product_name,
      status !== undefined ? status : existing.status,
      id
    ]);

    const updatedOrder = await this.getById(id);

    // Emit change event
    this.emit('change', {
      action: 'UPDATE',
      data: updatedOrder
    });

    return updatedOrder;
  }

  async delete(id) {
    const existing = await this.getById(id);
    if (!existing) {
      throw new Error(`Order with ID ${id} not found.`);
    }

    const query = 'DELETE FROM orders WHERE id = ?';
    await this.db.run(query, [id]);

    // Emit change event
    this.emit('change', {
      action: 'DELETE',
      data: existing // Emit the deleted order's data so clients know what was removed
    });

    return existing;
  }
}

export const orderRepository = new OrderRepository(dbConnection);
