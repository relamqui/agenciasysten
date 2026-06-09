const express = require('express');
const bcrypt = require('bcryptjs');
const pool = require('../config/database');
const auth = require('../middleware/auth');
const { getRandomColor } = require('../utils/helpers');

const router = express.Router();

// Middleware to check admin role or perm_usuarios
const canManageUsers = (req, res, next) => {
  if (req.role !== 'admin' && !req.perm_usuarios) {
    return res.status(403).json({ error: 'Acesso restrito para administradores ou usuários com permissão' });
  }
  next();
};

// GET /api/admin/users
router.get('/users', auth, canManageUsers, async (req, res, next) => {
  try {
    const result = await pool.query(
      'SELECT id, name, email, avatar_color, role, perm_agencia, perm_financeiro, perm_usuarios, created_at FROM users ORDER BY created_at DESC'
    );
    console.log('Sending users:', result.rows);
    res.json(result.rows);
  } catch (err) {
    console.error('Error in GET /users:', err);
    next(err);
  }
});

// POST /api/admin/users - Admin or Colaborador creating user
router.post('/users', auth, canManageUsers, async (req, res, next) => {
  const client = await pool.connect();
  try {
    const { name, email, password, role, boardIds, perm_agencia, perm_financeiro, perm_usuarios } = req.body;

    if (!name || !email || !password) {
      return res.status(400).json({ error: 'Nome, email e senha são obrigatórios' });
    }

    if (password.length < 6) {
      return res.status(400).json({ error: 'Senha deve ter no mínimo 6 caracteres' });
    }

    if (req.role !== 'admin' && role === 'admin') {
      return res.status(403).json({ error: 'Você não tem permissão para criar usuários administradores' });
    }

    const existing = await client.query('SELECT id FROM users WHERE email = $1', [email.toLowerCase()]);
    if (existing.rows.length > 0) {
      return res.status(409).json({ error: 'Email já cadastrado' });
    }

    await client.query('BEGIN');

    const password_hash = await bcrypt.hash(password, 12);
    const avatar_color = getRandomColor();
    const userRole = role === 'admin' ? 'admin' : 'user';

    const result = await client.query(
      'INSERT INTO users (name, email, password_hash, avatar_color, role, perm_agencia, perm_financeiro, perm_usuarios) VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id, name, email, role, avatar_color, perm_agencia, perm_financeiro, perm_usuarios, created_at',
      [name.trim(), email.toLowerCase().trim(), password_hash, avatar_color, userRole, perm_agencia || false, perm_financeiro || false, perm_usuarios || false]
    );

    const newUserId = result.rows[0].id;

    if (boardIds && Array.isArray(boardIds) && boardIds.length > 0) {
      for (const boardId of boardIds) {
        await client.query(
          'INSERT INTO board_members (board_id, user_id, role) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING',
          [boardId, newUserId, 'member']
        );
      }
    }

    await client.query('COMMIT');
    res.status(201).json(result.rows[0]);
  } catch (err) {
    await client.query('ROLLBACK');
    next(err);
  } finally {
    client.release();
  }
});

// PUT /api/admin/users/:id - Admin or Colaborador editing user
router.put('/users/:id', auth, canManageUsers, async (req, res, next) => {
  try {
    const { name, email, password, role, perm_agencia, perm_financeiro, perm_usuarios } = req.body;
    
    if (!name || !email) {
      return res.status(400).json({ error: 'Nome e email são obrigatórios' });
    }

    // Check if target user is admin and if current user is not admin
    if (req.role !== 'admin') {
      const targetUser = await pool.query('SELECT role FROM users WHERE id = $1', [req.params.id]);
      if (targetUser.rows.length > 0 && targetUser.rows[0].role === 'admin') {
        return res.status(403).json({ error: 'Você não tem permissão para editar usuários administradores' });
      }
      if (role === 'admin') {
        return res.status(403).json({ error: 'Você não pode promover usuários a administradores' });
      }
    }

    const existing = await pool.query('SELECT id FROM users WHERE email = $1 AND id != $2', [email.toLowerCase(), req.params.id]);
    if (existing.rows.length > 0) {
      return res.status(409).json({ error: 'Email já cadastrado para outro usuário' });
    }

    let query = 'UPDATE users SET name = $1, email = $2, role = $3, perm_agencia = $4, perm_financeiro = $5, perm_usuarios = $6';
    const params = [name.trim(), email.toLowerCase().trim(), role === 'admin' ? 'admin' : 'user', perm_agencia !== undefined ? perm_agencia : false, perm_financeiro !== undefined ? perm_financeiro : false, perm_usuarios !== undefined ? perm_usuarios : false];
    
    if (password && password.trim() !== '') {
      if (password.length < 6) {
        return res.status(400).json({ error: 'Senha deve ter no mínimo 6 caracteres' });
      }
      const password_hash = await bcrypt.hash(password, 12);
      query += ', password_hash = $7';
      params.push(password_hash);
    }
    
    query += ` WHERE id = $${params.length + 1} RETURNING id, name, email, role, avatar_color, perm_agencia, perm_financeiro, perm_usuarios, created_at`;
    params.push(req.params.id);

    const result = await pool.query(query, params);
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Usuário não encontrado' });
    }

    res.json(result.rows[0]);
  } catch (err) {
    next(err);
  }
});

// DELETE /api/admin/users/:id
router.delete('/users/:id', auth, canManageUsers, async (req, res, next) => {
  try {
    if (parseInt(req.params.id) === req.userId) {
      return res.status(400).json({ error: 'Você não pode excluir a si mesmo' });
    }
    
    if (req.role !== 'admin') {
      const targetUser = await pool.query('SELECT role FROM users WHERE id = $1', [req.params.id]);
      if (targetUser.rows.length > 0 && targetUser.rows[0].role === 'admin') {
        return res.status(403).json({ error: 'Você não tem permissão para excluir usuários administradores' });
      }
    }

    await pool.query('DELETE FROM users WHERE id = $1', [req.params.id]);
    res.json({ message: 'Usuário excluído' });
  } catch (err) {
    next(err);
  }
});

// GET /api/admin/global-boards
router.get('/global-boards', auth, canManageUsers, async (req, res, next) => {
  try {
    const result = await pool.query('SELECT * FROM boards WHERE owner_id IS NULL ORDER BY created_at ASC');
    res.json(result.rows);
  } catch (err) {
    next(err);
  }
});

// GET /api/admin/users/:id/boards
router.get('/users/:id/boards', auth, canManageUsers, async (req, res, next) => {
  try {
    const result = await pool.query(
      'SELECT board_id FROM board_members WHERE user_id = $1',
      [req.params.id]
    );
    res.json(result.rows.map(r => r.board_id));
  } catch (err) {
    next(err);
  }
});

// POST /api/admin/users/:id/boards
router.post('/users/:id/boards', auth, canManageUsers, async (req, res, next) => {
  try {
    if (req.role !== 'admin') {
      const targetUser = await pool.query('SELECT role FROM users WHERE id = $1', [req.params.id]);
      if (targetUser.rows.length > 0 && targetUser.rows[0].role === 'admin') {
        return res.status(403).json({ error: 'Sem permissão para alterar acessos de administradores' });
      }
    }
    const { board_id } = req.body;
    await pool.query(
      'INSERT INTO board_members (board_id, user_id, role) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING',
      [board_id, req.params.id, 'member']
    );
    res.json({ message: 'Acesso concedido' });
  } catch (err) {
    next(err);
  }
});

// DELETE /api/admin/users/:id/boards/:boardId
router.delete('/users/:id/boards/:boardId', auth, canManageUsers, async (req, res, next) => {
  try {
    if (req.role !== 'admin') {
      const targetUser = await pool.query('SELECT role FROM users WHERE id = $1', [req.params.id]);
      if (targetUser.rows.length > 0 && targetUser.rows[0].role === 'admin') {
        return res.status(403).json({ error: 'Sem permissão para alterar acessos de administradores' });
      }
    }
    await pool.query(
      'DELETE FROM board_members WHERE user_id = $1 AND board_id = $2',
      [req.params.id, req.params.boardId]
    );
    res.json({ message: 'Acesso removido' });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
