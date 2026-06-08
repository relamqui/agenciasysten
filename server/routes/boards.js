const express = require('express');
const pool = require('../config/database');
const auth = require('../middleware/auth');
const { DEFAULT_LABELS } = require('../utils/helpers');

const router = express.Router();

// GET /api/boards/my-cards — cartões onde o usuário é responsável
router.get('/my-cards', auth, async (req, res, next) => {
  try {
    const result = await pool.query(`
      SELECT c.id, c.title, c.description, c.start_date, c.due_date, c.is_completed, c.created_at,
        l.title as list_title, l.color as list_color,
        b.id as board_id, b.title as board_title, b.background as board_background,
        COALESCE(
          (SELECT json_agg(jsonb_build_object('id', u.id, 'name', u.name, 'avatar_color', u.avatar_color))
           FROM card_assignees ca2 JOIN users u ON ca2.user_id = u.id WHERE ca2.card_id = c.id), '[]'
        ) as assignees
      FROM cards c
      JOIN lists l ON c.list_id = l.id
      JOIN boards b ON l.board_id = b.id
      JOIN card_assignees ca ON c.id = ca.card_id
      WHERE ca.user_id = $1
      ORDER BY c.due_date ASC NULLS LAST, c.created_at DESC
    `, [req.userId]);
    res.json(result.rows);
  } catch (err) {
    next(err);
  }
});

// GET /api/boards — listar quadros do usuário
router.get('/', auth, async (req, res, next) => {
  try {
    let query, params;
    if (req.role === 'admin') {
      query = `
        SELECT DISTINCT b.*, u.name as owner_name, u.avatar_color as owner_color,
          (SELECT COUNT(*) FROM lists WHERE board_id = b.id) as list_count,
          (SELECT COUNT(*) FROM cards c JOIN lists l ON c.list_id = l.id WHERE l.board_id = b.id) as card_count
        FROM boards b
        LEFT JOIN users u ON b.owner_id = u.id
        ORDER BY b.is_favorite DESC, b.created_at DESC
      `;
      params = [];
    } else {
      query = `
        SELECT DISTINCT b.*, u.name as owner_name, u.avatar_color as owner_color,
          (SELECT COUNT(*) FROM lists WHERE board_id = b.id) as list_count,
          (SELECT COUNT(*) FROM cards c JOIN lists l ON c.list_id = l.id WHERE l.board_id = b.id) as card_count
        FROM boards b
        LEFT JOIN users u ON b.owner_id = u.id
        LEFT JOIN board_members bm ON b.id = bm.board_id
        WHERE b.owner_id = $1 OR bm.user_id = $1
        ORDER BY b.is_favorite DESC, b.created_at DESC
      `;
      params = [req.userId];
    }
    const result = await pool.query(query, params);

    res.json(result.rows);
  } catch (err) {
    next(err);
  }
});

// POST /api/boards — criar quadro
router.post('/', auth, async (req, res, next) => {
  return res.status(403).json({ error: 'A criação de novos quadros está temporariamente bloqueada.' });
  try {
    const { title, background } = req.body;

    if (!title || !title.trim()) {
      return res.status(400).json({ error: 'Título é obrigatório' });
    }

    const result = await pool.query(
      'INSERT INTO boards (title, background, owner_id) VALUES ($1, $2, $3) RETURNING *',
      [title.trim(), background || 'linear-gradient(135deg, #6C5CE7, #a855f7)', req.userId]
    );

    const board = result.rows[0];

    // Add owner as member
    await pool.query(
      'INSERT INTO board_members (board_id, user_id, role) VALUES ($1, $2, $3)',
      [board.id, req.userId, 'owner']
    );

    // Create default labels
    for (const label of DEFAULT_LABELS) {
      await pool.query(
        'INSERT INTO labels (name, color, board_id) VALUES ($1, $2, $3)',
        [label.name, label.color, board.id]
      );
    }

    // Create default lists
    const defaultLists = ['A Fazer', 'Em Progresso', 'Concluído'];
    for (let i = 0; i < defaultLists.length; i++) {
      await pool.query(
        'INSERT INTO lists (title, board_id, position) VALUES ($1, $2, $3)',
        [defaultLists[i], board.id, i]
      );
    }

    res.status(201).json(board);
  } catch (err) {
    next(err);
  }
});

// PUT /api/boards/:id — atualizar quadro
router.put('/:id', auth, async (req, res, next) => {
  try {
    const { title, background, is_favorite } = req.body;
    const { id } = req.params;

    const board = await pool.query(
      'SELECT * FROM boards WHERE id = $1 AND (owner_id = $2 OR id IN (SELECT board_id FROM board_members WHERE user_id = $2) OR owner_id IS NULL)',
      [id, req.userId]
    );

    if (board.rows.length === 0) {
      return res.status(404).json({ error: 'Quadro não encontrado' });
    }
    
    if (board.rows[0].owner_id === null) {
      return res.status(403).json({ error: 'Quadros globais não podem ser alterados.' });
    }

    const result = await pool.query(
      'UPDATE boards SET title = COALESCE($1, title), background = COALESCE($2, background), is_favorite = COALESCE($3, is_favorite) WHERE id = $4 RETURNING *',
      [title, background, is_favorite, id]
    );

    res.json(result.rows[0]);
  } catch (err) {
    next(err);
  }
});

// DELETE /api/boards/:id
router.delete('/:id', auth, async (req, res, next) => {
  try {
    const board = await pool.query('SELECT * FROM boards WHERE id = $1', [req.params.id]);
    if (board.rows.length > 0 && board.rows[0].owner_id === null) {
      return res.status(403).json({ error: 'Quadros globais não podem ser excluídos.' });
    }

    const result = await pool.query(
      'DELETE FROM boards WHERE id = $1 AND owner_id = $2 RETURNING id',
      [req.params.id, req.userId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Quadro não encontrado ou sem permissão' });
    }

    res.json({ message: 'Quadro excluído' });
  } catch (err) {
    next(err);
  }
});

// POST /api/boards/:id/members — adicionar membro
router.post('/:id/members', auth, async (req, res, next) => {
  try {
    const { email } = req.body;
    const { id } = req.params;

    // Check board ownership
    const board = await pool.query('SELECT * FROM boards WHERE id = $1 AND owner_id = $2', [id, req.userId]);
    if (board.rows.length === 0) {
      return res.status(403).json({ error: 'Apenas o dono pode adicionar membros' });
    }

    // Find user
    const user = await pool.query('SELECT id, name, email, avatar_color FROM users WHERE email = $1', [email.toLowerCase()]);
    if (user.rows.length === 0) {
      return res.status(404).json({ error: 'Usuário não encontrado' });
    }

    await pool.query(
      'INSERT INTO board_members (board_id, user_id, role) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING',
      [id, user.rows[0].id, 'member']
    );

    res.json({ message: 'Membro adicionado', user: user.rows[0] });
  } catch (err) {
    next(err);
  }
});

// GET /api/boards/:id/members
router.get('/:id/members', auth, async (req, res, next) => {
  try {
    const result = await pool.query(`
      SELECT u.id, u.name, u.email, u.avatar_color, bm.role
      FROM board_members bm
      JOIN users u ON bm.user_id = u.id
      WHERE bm.board_id = $1
    `, [req.params.id]);

    res.json(result.rows);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
