const express = require('express');
const pool = require('../config/database');
const auth = require('../middleware/auth');

const router = express.Router();

// GET /api/boards/:boardId/lists
router.get('/:boardId/lists', auth, async (req, res, next) => {
  try {
    const { boardId } = req.params;

    // Check access
    if (req.role !== 'admin') {
      const access = await pool.query(
        'SELECT 1 FROM boards b LEFT JOIN board_members bm ON b.id = bm.board_id WHERE b.id = $1 AND (b.owner_id = $2 OR bm.user_id = $2)',
        [boardId, req.userId]
      );
      if (access.rows.length === 0) {
        return res.status(403).json({ error: 'Sem acesso a este quadro' });
      }
    }

    const lists = await pool.query(
      'SELECT * FROM lists WHERE board_id = $1 ORDER BY position ASC',
      [boardId]
    );

    // Get cards for each list
    const listsWithCards = await Promise.all(lists.rows.map(async (list) => {
      const cards = await pool.query(`
        SELECT c.*, 
          COALESCE(json_agg(DISTINCT jsonb_build_object('id', lb.id, 'name', lb.name, 'color', lb.color)) 
            FILTER (WHERE lb.id IS NOT NULL), '[]') as labels,
          (SELECT COUNT(*) FROM checklists WHERE card_id = c.id) as checklist_total,
          (SELECT COUNT(*) FROM checklists WHERE card_id = c.id AND is_checked = true) as checklist_done,
          COALESCE(
            (SELECT json_agg(jsonb_build_object('id', u.id, 'name', u.name, 'avatar_color', u.avatar_color))
             FROM card_assignees ca JOIN users u ON ca.user_id = u.id WHERE ca.card_id = c.id), '[]'
          ) as assignees
        FROM cards c
        LEFT JOIN card_labels cl ON c.id = cl.card_id
        LEFT JOIN labels lb ON cl.label_id = lb.id
        WHERE c.list_id = $1
        GROUP BY c.id
        ORDER BY c.position ASC
      `, [list.id]);

      return { ...list, cards: cards.rows };
    }));

    res.json(listsWithCards);
  } catch (err) {
    next(err);
  }
});

// POST /api/boards/:boardId/lists
router.post('/:boardId/lists', auth, async (req, res, next) => {
  try {
    const { boardId } = req.params;
    const { title, color } = req.body;

    if (!title || !title.trim()) {
      return res.status(400).json({ error: 'Título é obrigatório' });
    }

    const boardCheck = await pool.query('SELECT owner_id FROM boards WHERE id = $1', [boardId]);
    if (boardCheck.rows.length > 0 && boardCheck.rows[0].owner_id === null) {
      return res.status(403).json({ error: 'Não é possível adicionar listas em quadros globais.' });
    }

    // Get max position
    const maxPos = await pool.query(
      'SELECT COALESCE(MAX(position), -1) + 1 as next_pos FROM lists WHERE board_id = $1',
      [boardId]
    );

    const result = await pool.query(
      'INSERT INTO lists (title, board_id, position, color) VALUES ($1, $2, $3, $4) RETURNING *',
      [title.trim(), boardId, maxPos.rows[0].next_pos, color || '#8F8F99']
    );

    res.status(201).json({ ...result.rows[0], cards: [] });
  } catch (err) {
    next(err);
  }
});

// PUT /api/lists/:id
router.put('/:id', auth, async (req, res, next) => {
  try {
    const listCheck = await pool.query('SELECT b.owner_id FROM lists l JOIN boards b ON l.board_id = b.id WHERE l.id = $1', [req.params.id]);
    if (listCheck.rows.length > 0 && listCheck.rows[0].owner_id === null) {
      return res.status(403).json({ error: 'Não é possível editar listas de quadros globais.' });
    }

    const { title, color } = req.body;
    const result = await pool.query(
      'UPDATE lists SET title = COALESCE($1, title), color = COALESCE($2, color) WHERE id = $3 RETURNING *',
      [title ? title.trim() : null, color, req.params.id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Lista não encontrada' });
    }

    res.json(result.rows[0]);
  } catch (err) {
    next(err);
  }
});

// DELETE /api/lists/:id
router.delete('/:id', auth, async (req, res, next) => {
  try {
    const listCheck = await pool.query('SELECT b.owner_id FROM lists l JOIN boards b ON l.board_id = b.id WHERE l.id = $1', [req.params.id]);
    if (listCheck.rows.length > 0 && listCheck.rows[0].owner_id === null) {
      return res.status(403).json({ error: 'Não é possível excluir listas de quadros globais.' });
    }

    const result = await pool.query('DELETE FROM lists WHERE id = $1 RETURNING id', [req.params.id]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Lista não encontrada' });
    }

    res.json({ message: 'Lista excluída' });
  } catch (err) {
    next(err);
  }
});

// PUT /api/lists/reorder — reordenar listas
router.put('/:boardId/lists/reorder', auth, async (req, res, next) => {
  try {
    const { listIds } = req.body; // Array of list IDs in new order

    const boardCheck = await pool.query('SELECT owner_id FROM boards WHERE id = $1', [req.params.boardId]);
    if (boardCheck.rows.length > 0 && boardCheck.rows[0].owner_id === null) {
      return res.status(403).json({ error: 'Não é possível reordenar listas de quadros globais.' });
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      for (let i = 0; i < listIds.length; i++) {
        await client.query('UPDATE lists SET position = $1 WHERE id = $2', [i, listIds[i]]);
      }
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }

    res.json({ message: 'Listas reordenadas' });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
