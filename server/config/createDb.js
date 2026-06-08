const { Client } = require('pg');

async function createDatabaseIfNotExists() {
  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) return;

  try {
    const url = new URL(dbUrl);
    const targetDb = url.pathname.replace('/', '');
    
    if (!targetDb || targetDb === 'postgres') return;

    // Connect to the default 'postgres' database to check/create the target database
    url.pathname = '/postgres';
    
    const client = new Client({
      connectionString: url.toString(),
      ssl: process.env.DATABASE_SSL === 'true' ? { rejectUnauthorized: false } : false,
    });

    await client.connect();
    
    const res = await client.query('SELECT 1 FROM pg_database WHERE datname = $1', [targetDb]);
    if (res.rowCount === 0) {
      console.log(`⏳ Banco de dados "${targetDb}" não existe. Criando automaticamente...`);
      // Não é possível usar prepared statements para CREATE DATABASE
      await client.query(`CREATE DATABASE "${targetDb}"`);
      console.log(`✅ Banco de dados "${targetDb}" criado com sucesso.`);
    } else {
      console.log(`✅ Banco de dados "${targetDb}" já existe.`);
    }
    
    await client.end();
  } catch (err) {
    console.error('❌ Erro ao checar/criar banco de dados automaticamente:', err.message);
    // Não encerramos o processo aqui, deixamos o erro propagar ou o pool principal tentar conectar
  }
}

module.exports = { createDatabaseIfNotExists };
