require('dotenv').config();
const pool = require('./server/config/database');
async function run() {
  try {
    const res = await pool.query("DELETE FROM labels WHERE name IN ('Urgente', 'Importante', 'Revisão', 'Aprovado', 'Pausado')");
    console.log('Defaults removed. Count:', res.rowCount);
    process.exit(0);
  } catch (e) {
    console.error(e);
    process.exit(1);
  }
}
run();
