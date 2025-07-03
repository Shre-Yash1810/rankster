// config/db.js
const mysql = require('mysql2');

const db = mysql.createConnection({
  host: 'localhost',
  user: 'root',         // or your MySQL username
  password: 'yash3106',         // your MySQL password
  database: 'rankster' // your database name
});

db.connect((err) => {
  if (err) {
    console.error('MySQL Connection Failed:', err);
  } else {
    console.log('✅ MySQL Connected!');
  }
});

module.exports = db;
