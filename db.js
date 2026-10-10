const sqlite3 = require('sqlite3').verbose();

const db = new sqlite3.Database('./clients.db', (err) => {
    if (err) {
        console.error('Error opening database:', err.message);
    } else {
        console.log('Connected to the SQLite database.');
    }
});

db.run(`CREATE TABLE IF NOT EXISTS clients (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    phone TEXT,
    measurements TEXT,
    notes TEXT,
    transactions TEXT
)`, (err) => {
    if (err) {
        console.error('Error creating table:', err.message);
    } else {
        console.log('Clients table is ready.');
    }
    
    // This now lives INSIDE the callback, so it waits for the table to finish.
    db.close();
});
