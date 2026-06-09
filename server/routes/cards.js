const express = require('express');
const pool = require('../config/database');
const auth = require('../middleware/auth');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

const router = express.Router();

// Configuração do multer para upload de arquivos
const uploadDir = path.join(__dirname, '../../public/uploads');
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, uploadDir);
  },
  filename: function (req, file, cb) {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, uniqueSuffix + '-' + file.originalname);
  }
});
const upload = multer({ storage: storage });

// POST /api/cards — criar cartão
router.post('/', auth, async (req, res, next) => {
  try {
    const { title, list_id, description, start_date, due_date, assigned_user_ids, priority } = req.body;

    if (!title || !title.trim()) {
      return res.status(400).json({ error: 'Título é obrigatório' });
    }

    const client = await pool.connect();
    let newCard;
    try {
      await client.query('BEGIN');
      
      const maxPos = await client.query(
        'SELECT COALESCE(MAX(position), -1) + 1 as next_pos FROM cards WHERE list_id = $1',
        [list_id]
      );

      const result = await client.query(
        'INSERT INTO cards (title, list_id, position, description, start_date, due_date, priority) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *',
        [title.trim(), list_id, maxPos.rows[0].next_pos, description || '', start_date || null, due_date || null, priority || 'normal']
      );
      
      newCard = result.rows[0];

      if (Array.isArray(assigned_user_ids) && assigned_user_ids.length > 0) {
        for (const uid of assigned_user_ids) {
          await client.query('INSERT INTO card_assignees (card_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [newCard.id, uid]);
        }
      }

      if (Array.isArray(req.body.label_ids) && req.body.label_ids.length > 0) {
        for (const lid of req.body.label_ids) {
          await client.query('INSERT INTO card_labels (card_id, label_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [newCard.id, lid]);
        }
      }

      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }

    res.status(201).json({ ...newCard, labels: [], checklist_total: 0, checklist_done: 0 });
  } catch (err) {
    next(err);
  }
});


// GET /api/cards/:id — detalhes do cartão
router.get('/:id', auth, async (req, res, next) => {
  try {
    const card = await pool.query(`
      SELECT c.*,
        COALESCE(json_agg(DISTINCT jsonb_build_object('id', lb.id, 'name', lb.name, 'color', lb.color))
          FILTER (WHERE lb.id IS NOT NULL), '[]') as labels,
        COALESCE(
          (SELECT json_agg(jsonb_build_object('id', u.id, 'name', u.name, 'avatar_color', u.avatar_color))
           FROM card_assignees ca JOIN users u ON ca.user_id = u.id WHERE ca.card_id = c.id), '[]'
        ) as assignees
      FROM cards c
      LEFT JOIN card_labels cl ON c.id = cl.card_id
      LEFT JOIN labels lb ON cl.label_id = lb.id
      WHERE c.id = $1
      GROUP BY c.id
    `, [req.params.id]);

    if (card.rows.length === 0) {
      return res.status(404).json({ error: 'Cartão não encontrado' });
    }

    // Get checklist
    const checklist = await pool.query(
      'SELECT * FROM checklists WHERE card_id = $1 ORDER BY position ASC',
      [req.params.id]
    );

    res.json({ ...card.rows[0], checklist: checklist.rows });
  } catch (err) {
    next(err);
  }
});


// PUT /api/cards/:id — atualizar cartão
router.put('/:id', auth, async (req, res, next) => {
  try {
    const { title, description, start_date, due_date, is_completed, assigned_user_ids, priority } = req.body;

    const client = await pool.connect();
    let updatedCard;
    try {
      await client.query('BEGIN');
      
      const result = await client.query(
        `UPDATE cards SET 
          title = COALESCE($1, title), 
          description = COALESCE($2, description),
          start_date = $3,
          due_date = $4,
          is_completed = COALESCE($5, is_completed),
          priority = COALESCE($6, priority)
        WHERE id = $7 RETURNING *`,
        [title, description, start_date || null, due_date || null, is_completed, priority || null, req.params.id]
      );

      if (result.rows.length === 0) {
        await client.query('ROLLBACK');
        return res.status(404).json({ error: 'Cartão não encontrado' });
      }
      updatedCard = result.rows[0];

      if (assigned_user_ids !== undefined) {
        await client.query('DELETE FROM card_assignees WHERE card_id = $1', [updatedCard.id]);
        if (Array.isArray(assigned_user_ids) && assigned_user_ids.length > 0) {
          for (const uid of assigned_user_ids) {
            await client.query('INSERT INTO card_assignees (card_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [updatedCard.id, uid]);
          }
        }
      }

      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }

    res.json(updatedCard);
  } catch (err) {
    next(err);
  }
});


// DELETE /api/cards/:id
router.delete('/:id', auth, async (req, res, next) => {
  try {
    const result = await pool.query('DELETE FROM cards WHERE id = $1 RETURNING id', [req.params.id]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Cartão não encontrado' });
    }

    res.json({ message: 'Cartão excluído' });
  } catch (err) {
    next(err);
  }
});

// PUT /api/cards/:id/move — mover cartão entre listas
router.put('/:id/move', auth, async (req, res, next) => {
  try {
    const { list_id, position } = req.body;

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // Get current card
      const card = await client.query('SELECT * FROM cards WHERE id = $1', [req.params.id]);
      if (card.rows.length === 0) {
        await client.query('ROLLBACK');
        return res.status(404).json({ error: 'Cartão não encontrado' });
      }

      const oldListId = card.rows[0].list_id;
      const oldPosition = card.rows[0].position;

      if (oldListId === list_id) {
        // Same list — reorder
        if (oldPosition < position) {
          await client.query(
            'UPDATE cards SET position = position - 1 WHERE list_id = $1 AND position > $2 AND position <= $3',
            [list_id, oldPosition, position]
          );
        } else {
          await client.query(
            'UPDATE cards SET position = position + 1 WHERE list_id = $1 AND position >= $2 AND position < $3',
            [list_id, position, oldPosition]
          );
        }
      } else {
        // Different list
        await client.query(
          'UPDATE cards SET position = position - 1 WHERE list_id = $1 AND position > $2',
          [oldListId, oldPosition]
        );
        await client.query(
          'UPDATE cards SET position = position + 1 WHERE list_id = $1 AND position >= $2',
          [list_id, position]
        );
      }

      await client.query(
        'UPDATE cards SET list_id = $1, position = $2 WHERE id = $3',
        [list_id, position, req.params.id]
      );

      await client.query('COMMIT');
      res.json({ message: 'Cartão movido' });
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  } catch (err) {
    next(err);
  }
});

// GET /api/cards/:id/attachments — listar anexos
router.get('/:id/attachments', auth, async (req, res, next) => {
  try {
    const attachments = await pool.query(
      'SELECT * FROM card_attachments WHERE card_id = $1 ORDER BY created_at DESC',
      [req.params.id]
    );
    res.json(attachments.rows);
  } catch (err) {
    next(err);
  }
});

// POST /api/cards/:id/attachments — upload de anexos
router.post('/:id/attachments', auth, upload.array('files', 10), async (req, res, next) => {
  try {
    if (!req.files || req.files.length === 0) {
      return res.status(400).json({ error: 'Nenhum arquivo enviado' });
    }

    const insertedFiles = [];
    for (const file of req.files) {
      const fileUrl = `/uploads/${file.filename}`;
      const result = await pool.query(
        'INSERT INTO card_attachments (card_id, file_name, file_url, uploader_id) VALUES ($1, $2, $3, $4) RETURNING *',
        [req.params.id, file.originalname, fileUrl, req.userId]
      );
      insertedFiles.push(result.rows[0]);
    }

    res.status(201).json(insertedFiles);
  } catch (err) {
    next(err);
  }
});

// DELETE /api/cards/:cardId/attachments/:attachmentId
router.delete('/:cardId/attachments/:attachmentId', auth, async (req, res, next) => {
  try {
    const attachment = await pool.query('SELECT file_url FROM card_attachments WHERE id = $1 AND card_id = $2', [req.params.attachmentId, req.params.cardId]);
    if (attachment.rows.length === 0) {
      return res.status(404).json({ error: 'Anexo não encontrado' });
    }

    // Tentar apagar o arquivo fisicamente
    const filePath = path.join(__dirname, '../../public', attachment.rows[0].file_url);
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }

    await pool.query('DELETE FROM card_attachments WHERE id = $1', [req.params.attachmentId]);
    res.json({ message: 'Anexo excluído' });
  } catch (err) {
    next(err);
  }
});

// POST /api/cards/:id/labels — toggle label on card
router.post('/:id/labels', auth, async (req, res, next) => {
  try {
    const { label_id } = req.body;

    const existing = await pool.query(
      'SELECT 1 FROM card_labels WHERE card_id = $1 AND label_id = $2',
      [req.params.id, label_id]
    );

    if (existing.rows.length > 0) {
      await pool.query('DELETE FROM card_labels WHERE card_id = $1 AND label_id = $2', [req.params.id, label_id]);
      res.json({ action: 'removed' });
    } else {
      await pool.query('INSERT INTO card_labels (card_id, label_id) VALUES ($1, $2)', [req.params.id, label_id]);
      res.json({ action: 'added' });
    }
  } catch (err) {
    next(err);
  }
});

// GET /api/cards/search?q=xxx&boardId=xxx
router.get('/search/query', auth, async (req, res, next) => {
  try {
    const { q, boardId } = req.query;

    const result = await pool.query(`
      SELECT c.*, l.title as list_title
      FROM cards c
      JOIN lists l ON c.list_id = l.id
      WHERE l.board_id = $1 AND (c.title ILIKE $2 OR c.description ILIKE $2)
      ORDER BY c.created_at DESC
      LIMIT 20
    `, [boardId, `%${q}%`]);

    res.json(result.rows);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
