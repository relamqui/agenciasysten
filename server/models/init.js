const pool = require('../config/database');

const initDatabase = async () => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    await client.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        name VARCHAR(100) NOT NULL,
        email VARCHAR(255) UNIQUE NOT NULL,
        password_hash VARCHAR(255) NOT NULL,
        role VARCHAR(20) DEFAULT 'user',
        avatar_color VARCHAR(7) DEFAULT '#6C5CE7',
        created_at TIMESTAMP DEFAULT NOW()
      );
    `);

    // Ensure role column exists for existing installations
    await client.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS role VARCHAR(20) DEFAULT 'user';`);
    await client.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS perm_agencia BOOLEAN DEFAULT false;`);
    await client.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS perm_financeiro BOOLEAN DEFAULT false;`);
    await client.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS perm_usuarios BOOLEAN DEFAULT false;`);
    await client.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS is_designer BOOLEAN DEFAULT false;`);

    await client.query(`
      CREATE TABLE IF NOT EXISTS boards (
        id SERIAL PRIMARY KEY,
        title VARCHAR(200) NOT NULL,
        background VARCHAR(100) DEFAULT 'linear-gradient(135deg, #6C5CE7, #a855f7)',
        owner_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        is_favorite BOOLEAN DEFAULT FALSE,
        created_at TIMESTAMP DEFAULT NOW()
      );
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS board_members (
        id SERIAL PRIMARY KEY,
        board_id INTEGER REFERENCES boards(id) ON DELETE CASCADE,
        user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        role VARCHAR(20) DEFAULT 'member',
        UNIQUE(board_id, user_id)
      );
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS lists (
        id SERIAL PRIMARY KEY,
        title VARCHAR(200) NOT NULL,
        board_id INTEGER REFERENCES boards(id) ON DELETE CASCADE,
        position INTEGER DEFAULT 0,
        color VARCHAR(7) DEFAULT '#8F8F99',
        created_at TIMESTAMP DEFAULT NOW()
      );
    `);

    // Migrations para bancos já existentes
    await client.query(`ALTER TABLE lists ADD COLUMN IF NOT EXISTS color VARCHAR(7) DEFAULT '#8F8F99';`);

    await client.query(`
      CREATE TABLE IF NOT EXISTS cards (
        id SERIAL PRIMARY KEY,
        title VARCHAR(500) NOT NULL,
        description TEXT DEFAULT '',
        list_id INTEGER REFERENCES lists(id) ON DELETE CASCADE,
        position INTEGER DEFAULT 0,
        start_date TIMESTAMP WITH TIME ZONE,
        due_date TIMESTAMP WITH TIME ZONE,
        assigned_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
        is_completed BOOLEAN DEFAULT FALSE,
        created_at TIMESTAMP DEFAULT NOW()
      );
    `);

    // Migrations para bancos já existentes
    await client.query(`ALTER TABLE cards ADD COLUMN IF NOT EXISTS start_date TIMESTAMP WITH TIME ZONE;`);
    await client.query(`ALTER TABLE cards ADD COLUMN IF NOT EXISTS priority VARCHAR(20) DEFAULT 'normal';`);
    await client.query(`ALTER TABLE cards ADD COLUMN IF NOT EXISTS assigned_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL;`);
    await client.query(`ALTER TABLE cards ADD COLUMN IF NOT EXISTS is_personal BOOLEAN DEFAULT FALSE;`);
    await client.query(`ALTER TABLE cards ADD COLUMN IF NOT EXISTS owner_id INTEGER REFERENCES users(id) ON DELETE SET NULL;`);
    // Migrar due_date e start_date de DATE para TIMESTAMP se ainda forem DATE
    await client.query(`
      DO $$ BEGIN
        IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='cards' AND column_name='due_date' AND data_type='date') THEN
          ALTER TABLE cards ALTER COLUMN due_date TYPE TIMESTAMP WITH TIME ZONE USING due_date::TIMESTAMP WITH TIME ZONE;
        END IF;
        IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='cards' AND column_name='start_date' AND data_type='date') THEN
          ALTER TABLE cards ALTER COLUMN start_date TYPE TIMESTAMP WITH TIME ZONE USING start_date::TIMESTAMP WITH TIME ZONE;
        END IF;
      END $$;
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS card_assignees (
        card_id INTEGER REFERENCES cards(id) ON DELETE CASCADE,
        user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        PRIMARY KEY (card_id, user_id)
      );
    `);

    // Migration from assigned_user_id to card_assignees
    await client.query(`
      INSERT INTO card_assignees (card_id, user_id)
      SELECT id, assigned_user_id FROM cards WHERE assigned_user_id IS NOT NULL
      ON CONFLICT DO NOTHING;
    `);
    await client.query(`
      CREATE TABLE IF NOT EXISTS labels (
        id SERIAL PRIMARY KEY,
        name VARCHAR(100) DEFAULT '',
        color VARCHAR(7) NOT NULL,
        board_id INTEGER REFERENCES boards(id) ON DELETE CASCADE
      );
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS card_labels (
        card_id INTEGER REFERENCES cards(id) ON DELETE CASCADE,
        label_id INTEGER REFERENCES labels(id) ON DELETE CASCADE,
        PRIMARY KEY (card_id, label_id)
      );
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS card_attachments (
        id SERIAL PRIMARY KEY,
        card_id INTEGER REFERENCES cards(id) ON DELETE CASCADE,
        file_name VARCHAR(500) NOT NULL,
        file_url VARCHAR(1000) NOT NULL,
        file_type VARCHAR(100) DEFAULT 'file',
        uploader_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
        created_at TIMESTAMP DEFAULT NOW()
      );
    `);


    await client.query(`
      CREATE TABLE IF NOT EXISTS checklists (
        id SERIAL PRIMARY KEY,
        text VARCHAR(500) NOT NULL,
        is_checked BOOLEAN DEFAULT FALSE,
        card_id INTEGER REFERENCES cards(id) ON DELETE CASCADE,
        position INTEGER DEFAULT 0
      );
    `);

    // ── FINANCEIRO TABLES ──
    await client.query(`
      CREATE TABLE IF NOT EXISTS financeiro_areas (
        id SERIAL PRIMARY KEY,
        nome VARCHAR(200) NOT NULL,
        descricao TEXT DEFAULT '',
        created_at TIMESTAMP DEFAULT NOW()
      );
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS financeiro_pessoas (
        id SERIAL PRIMARY KEY,
        tipo VARCHAR(50) NOT NULL, -- 'FORNECEDOR', 'CLIENTE', 'AMBOS'
        nome_razao VARCHAR(255) NOT NULL,
        documento VARCHAR(50),
        contato_principal VARCHAR(100),
        created_at TIMESTAMP DEFAULT NOW()
      );
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS financeiro_contas (
        id SERIAL PRIMARY KEY,
        tipo VARCHAR(20) NOT NULL, -- 'PAGAR' ou 'RECEBER'
        descricao VARCHAR(500) NOT NULL,
        valor_total DECIMAL(12,2) NOT NULL,
        projeto VARCHAR(255),
        area_id INTEGER REFERENCES financeiro_areas(id) ON DELETE SET NULL,
        pessoa_id INTEGER REFERENCES financeiro_pessoas(id) ON DELETE SET NULL,
        status_geral VARCHAR(50) DEFAULT 'PENDENTE', -- 'PENDENTE', 'PARCIAL', 'QUITADO'
        created_at TIMESTAMP DEFAULT NOW()
      );
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS financeiro_parcelas (
        id SERIAL PRIMARY KEY,
        conta_id INTEGER REFERENCES financeiro_contas(id) ON DELETE CASCADE,
        numero_parcela INTEGER NOT NULL,
        valor_esperado DECIMAL(12,2) NOT NULL,
        data_vencimento DATE NOT NULL,
        valor_pago DECIMAL(12,2) DEFAULT 0,
        data_pagamento DATE,
        status VARCHAR(50) DEFAULT 'PENDENTE', -- 'PENDENTE', 'PAGO', 'ATRASADO'
        created_at TIMESTAMP DEFAULT NOW()
      );
    `);

    // Indexes
    await client.query(`CREATE INDEX IF NOT EXISTS idx_boards_owner ON boards(owner_id);`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_lists_board ON lists(board_id);`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_cards_list ON cards(list_id);`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_board_members_board ON board_members(board_id);`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_board_members_user ON board_members(user_id);`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_labels_board ON labels(board_id);`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_checklists_card ON checklists(card_id);`);

    // Seed Administrador
    const adminResult = await client.query('SELECT COUNT(*) FROM users WHERE email = $1', ['admin@agencia.com']);
    if (parseInt(adminResult.rows[0].count) === 0) {
      const bcrypt = require('bcryptjs');
      const hash = await bcrypt.hash('admin123', 12);
      await client.query(
        'INSERT INTO users (name, email, password_hash, role, perm_agencia, perm_financeiro) VALUES ($1, $2, $3, $4, $5, $6)',
        ['Administrador', 'admin@agencia.com', hash, 'admin', true, true]
      );
    }

    // Update existing admin with permissions
    await client.query(`UPDATE users SET perm_agencia = true, perm_financeiro = true WHERE role = 'admin' AND (perm_agencia IS NULL OR perm_agencia = false)`);

    // Seed Quadros Globais
    const globalBoardsResult = await client.query('SELECT COUNT(*) FROM boards WHERE owner_id IS NULL');
    if (parseInt(globalBoardsResult.rows[0].count) === 0) {
      const globalBoards = [
        {
          title: 'Marketing',
          background: 'linear-gradient(135deg, #FF6B6B, #EE5253)',
          lists: ['Reuniões', 'Demandas', 'Cards para designers', 'Produção', 'Artes entregues', 'Planejamentos', 'Entregues/programados', 'Roteiros', 'Agendamento de gravações', 'Concluído']
        },
        {
          title: 'Audiovisual',
          background: 'linear-gradient(135deg, #10AC84, #01A3A4)',
          lists: ['Agendamento', 'Vídeos para editar', 'Editor 1', 'Editor 2', 'Aprovação', 'Aprovado', 'Concluído']
        },
        {
          title: 'Designer',
          background: 'linear-gradient(135deg, #5F27CD, #341F97)',
          lists: ['Pendente', 'Em produção', 'Aprovação', 'Drive', 'Concluído']
        },
        {
          title: 'SYNKAI',
          background: 'linear-gradient(135deg, #FF9F43, #EE5253)',
          lists: ['reuniões', 'planejamentos', 'em produção', 'bug', 'finalizados']
        },
        {
          title: 'MRA EVENTOS ESTRUTURAS',
          background: 'linear-gradient(135deg, #0ABDE3, #2E86DE)',
          lists: ['reuniões', 'eventos']
        }
      ];

      for (const b of globalBoards) {
        const res = await client.query(
          'INSERT INTO boards (title, background, owner_id) VALUES ($1, $2, NULL) RETURNING id',
          [b.title, b.background]
        );
        const boardId = res.rows[0].id;
        
        for (let i = 0; i < b.lists.length; i++) {
          await client.query(
            'INSERT INTO lists (title, board_id, position) VALUES ($1, $2, $3)',
            [b.lists[i], boardId, i]
          );
        }
        
        // Sem tags default
      }
    }

    // ── MIGRATION: Adicionar novos quadros globais ──
    const newGlobalBoards = [
      {
        title: 'SYNKAI',
        background: 'linear-gradient(135deg, #FF9F43, #EE5253)',
        lists: ['reuniões', 'planejamentos', 'em produção', 'bug', 'finalizados']
      },
      {
        title: 'MRA EVENTOS ESTRUTURAS',
        background: 'linear-gradient(135deg, #0ABDE3, #2E86DE)',
        lists: ['reuniões', 'eventos']
      }
    ];

    for (const b of newGlobalBoards) {
      const boardRes = await client.query(
        "SELECT id FROM boards WHERE title = $1 AND owner_id IS NULL",
        [b.title]
      );
      if (boardRes.rows.length === 0) {
        const res = await client.query(
          'INSERT INTO boards (title, background, owner_id) VALUES ($1, $2, NULL) RETURNING id',
          [b.title, b.background]
        );
        const boardId = res.rows[0].id;
        
        for (let i = 0; i < b.lists.length; i++) {
          await client.query(
            'INSERT INTO lists (title, board_id, position) VALUES ($1, $2, $3)',
            [b.lists[i], boardId, i]
          );
        }
        console.log(`✅ Quadro "${b.title}" adicionado via migration`);
      }
    }

    // ── MIGRATION: Adicionar "Tabela alteração" nos boards Audiovisual e Designer ──
    const boardInserts = [
      {
        boardTitle: 'Audiovisual',
        afterList:  'Vídeos para editar',
        newList:    'Tabela alteração',
      },
      {
        boardTitle: 'Designer',
        afterList:  'Pendente',
        newList:    'Tabela alteração',
      },
    ];

    for (const item of boardInserts) {
      const boardRes = await client.query(
        "SELECT id FROM boards WHERE title = $1 AND owner_id IS NULL",
        [item.boardTitle]
      );
      if (boardRes.rows.length === 0) continue;
      const bId = boardRes.rows[0].id;

      const exists = await client.query(
        "SELECT id FROM lists WHERE board_id = $1 AND title = $2",
        [bId, item.newList]
      );
      if (exists.rows.length > 0) continue; // já existe

      const afterRes = await client.query(
        "SELECT position FROM lists WHERE board_id = $1 AND title = $2",
        [bId, item.afterList]
      );
      if (afterRes.rows.length === 0) continue;

      const insertPos = afterRes.rows[0].position + 1;
      await client.query(
        "UPDATE lists SET position = position + 1 WHERE board_id = $1 AND position >= $2",
        [bId, insertPos]
      );
      await client.query(
        "INSERT INTO lists (title, board_id, position, color) VALUES ($1, $2, $3, $4)",
        [item.newList, bId, insertPos, '#FDCB6E']
      );
      console.log(`✅ Lista "${item.newList}" adicionada ao board "${item.boardTitle}"`);
    }

    await client.query('COMMIT');

    console.log('✅ Database tables initialized');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('❌ Database initialization error:', err);
    throw err;
  } finally {
    client.release();
  }
};

module.exports = { initDatabase };
