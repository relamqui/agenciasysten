const express = require('express');
const pool = require('../config/database');
const auth = require('../middleware/auth');

const router = express.Router();

async function checkMarketingAccess(req, res, next) {
  if (req.role === 'admin') return next();
  try {
    const check = await pool.query(`
      SELECT 1 FROM boards b
      LEFT JOIN board_members bm ON b.id = bm.board_id
      WHERE b.title ILIKE '%Marketing%' AND (b.owner_id = $1 OR bm.user_id = $1)
    `, [req.userId]);
    
    if (check.rows.length > 0) {
      return next();
    }
    return res.status(403).json({ error: 'Apenas usuários com acesso ao quadro Marketing podem criar ou editar etiquetas.' });
  } catch (err) {
    next(err);
  }
}

router.get('/can-manage', auth, async (req, res, next) => {
  if (req.role === 'admin') return res.json({ canManage: true });
  try {
    const check = await pool.query(`
      SELECT 1 FROM boards b
      LEFT JOIN board_members bm ON b.id = bm.board_id
      WHERE b.title ILIKE '%Marketing%' AND (b.owner_id = $1 OR bm.user_id = $1)
    `, [req.userId]);
    res.json({ canManage: check.rows.length > 0 });
  } catch (err) { next(err); }
});

router.get('/:boardId/labels', auth, async (req, res, next) => {
  try {
    const result = await pool.query('SELECT * FROM labels WHERE board_id = $1 ORDER BY id ASC', [req.params.boardId]);
    res.json(result.rows);
  } catch (err) { next(err); }
});

router.post('/', auth, checkMarketingAccess, async (req, res, next) => {
  try {
    const { name, color, board_id } = req.body;
    const result = await pool.query('INSERT INTO labels (name, color, board_id) VALUES ($1, $2, $3) RETURNING *', [name || '', color, board_id]);
    res.status(201).json(result.rows[0]);
  } catch (err) { next(err); }
});

router.put('/:id', auth, checkMarketingAccess, async (req, res, next) => {
  try {
    const { name, color } = req.body;
    const result = await pool.query('UPDATE labels SET name = COALESCE($1, name), color = COALESCE($2, color) WHERE id = $3 RETURNING *', [name, color, req.params.id]);
    res.json(result.rows[0]);
  } catch (err) { next(err); }
});

router.delete('/:id', auth, checkMarketingAccess, async (req, res, next) => {
  try {
    await pool.query('DELETE FROM labels WHERE id = $1', [req.params.id]);
    res.json({ message: 'Label excluída' });
  } catch (err) { next(err); }
});

module.exports = router;
