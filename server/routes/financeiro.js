const express = require('express');
const router = express.Router();
const pool = require('../config/database');

// Require authentication for all financeiro routes
const auth = require('../middleware/auth');
router.use(auth);

// Helper function to check if user has access to financeiro
async function checkFinanceiroAccess(req, res, next) {
  try {
    if (req.role === 'admin') return next();
    
    // Check DB for perm_financeiro
    const { rows } = await pool.query('SELECT perm_financeiro FROM users WHERE id = $1', [req.userId]);
    if (rows.length === 0 || !rows[0].perm_financeiro) {
      return res.status(403).json({ error: 'Acesso negado ao módulo Financeiro' });
    }
    next();
  } catch (err) {
    return res.status(500).json({ error: 'Erro de permissão' });
  }
}
router.use(checkFinanceiroAccess);

// ── AREAS ──
router.get('/areas', async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM financeiro_areas ORDER BY nome ASC');
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/areas', async (req, res) => {
  const { nome, descricao } = req.body;
  if (!nome) return res.status(400).json({ error: 'Nome é obrigatório' });
  try {
    const { rows } = await pool.query(
      'INSERT INTO financeiro_areas (nome, descricao) VALUES ($1, $2) RETURNING *',
      [nome, descricao]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.patch('/areas', async (req, res) => {
  const { id, nome, descricao } = req.body;
  if (!id || !nome) return res.status(400).json({ error: 'ID e Nome são obrigatórios' });
  try {
    const { rows } = await pool.query(
      'UPDATE financeiro_areas SET nome = $1, descricao = $2 WHERE id = $3 RETURNING *',
      [nome, descricao, id]
    );
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── PESSOAS ──
router.get('/pessoas', async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT id, tipo, nome_razao as "nomeRazao", documento, contato_principal as "contatoPrincipal" FROM financeiro_pessoas ORDER BY nome_razao ASC');
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/pessoas', async (req, res) => {
  const { tipo, nomeRazao, documento, contatoPrincipal } = req.body;
  if (!tipo || !nomeRazao) return res.status(400).json({ error: 'Tipo e Nome/Razão são obrigatórios' });
  try {
    const { rows } = await pool.query(
      'INSERT INTO financeiro_pessoas (tipo, nome_razao, documento, contato_principal) VALUES ($1, $2, $3, $4) RETURNING id, tipo, nome_razao as "nomeRazao", documento, contato_principal as "contatoPrincipal"',
      [tipo, nomeRazao, documento, contatoPrincipal]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.patch('/pessoas', async (req, res) => {
  const { id, tipo, nomeRazao, documento, contatoPrincipal } = req.body;
  if (!id || !tipo || !nomeRazao) return res.status(400).json({ error: 'ID, Tipo e Nome/Razão são obrigatórios' });
  try {
    const { rows } = await pool.query(
      'UPDATE financeiro_pessoas SET tipo = $1, nome_razao = $2, documento = $3, contato_principal = $4 WHERE id = $5 RETURNING id, tipo, nome_razao as "nomeRazao", documento, contato_principal as "contatoPrincipal"',
      [tipo, nomeRazao, documento, contatoPrincipal, id]
    );
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── CONTAS ──
router.get('/contas', async (req, res) => {
  try {
    // Busca contas e junta os dados formatados
    const contasRes = await pool.query(`
      SELECT c.id, c.tipo, c.descricao, c.valor_total as "valorTotal", c.projeto, c.area_id as "areaId", c.pessoa_id as "pessoaId", c.status_geral as "statusGeral",
             p.nome_razao as "pessoaNome",
             a.nome as "areaNome"
      FROM financeiro_contas c
      LEFT JOIN financeiro_pessoas p ON c.pessoa_id = p.id
      LEFT JOIN financeiro_areas a ON c.area_id = a.id
      ORDER BY c.created_at DESC
    `);
    
    // Busca parcelas
    const parcelasRes = await pool.query(`
      SELECT id, conta_id as "contaId", numero_parcela as "numeroParcela", valor_esperado as "valorEsperado", TO_CHAR(data_vencimento, 'YYYY-MM-DD') as "dataVencimento", valor_pago as "valorPago", TO_CHAR(data_pagamento, 'YYYY-MM-DD') as "dataPagamento", status
      FROM financeiro_parcelas
      ORDER BY numero_parcela ASC
    `);

    // Organizar as parcelas dentro das contas
    const parcelasMap = {};
    parcelasRes.rows.forEach(p => {
      if (!parcelasMap[p.contaId]) parcelasMap[p.contaId] = [];
      parcelasMap[p.contaId].push(p);
    });

    const contas = contasRes.rows.map(c => ({
      ...c,
      pessoa: c.pessoaNome ? { nomeRazao: c.pessoaNome } : null,
      area: c.areaNome ? { nome: c.areaNome } : null,
      parcelas: parcelasMap[c.id] || []
    }));

    res.json(contas);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/contas', async (req, res) => {
  const { tipo, descricao, valorTotal, projeto, areaId, pessoaId, parcelas } = req.body;
  if (!tipo || !descricao || valorTotal === undefined) return res.status(400).json({ error: 'Dados insuficientes para criar lançamento' });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Inserir Conta
    const contaRes = await client.query(
      'INSERT INTO financeiro_contas (tipo, descricao, valor_total, projeto, area_id, pessoa_id) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id',
      [tipo, descricao, valorTotal, projeto || null, areaId || null, pessoaId || null]
    );
    const contaId = contaRes.rows[0].id;

    // Inserir Parcelas
    if (parcelas && parcelas.length > 0) {
      for (const p of parcelas) {
        await client.query(
          'INSERT INTO financeiro_parcelas (conta_id, numero_parcela, valor_esperado, data_vencimento, status) VALUES ($1, $2, $3, $4, $5)',
          [contaId, p.numeroParcela, p.valorEsperado, p.dataVencimento, p.status || 'PENDENTE']
        );
      }
    }

    await client.query('COMMIT');
    res.status(201).json({ id: contaId, message: 'Lançamento e parcelas criados com sucesso' });
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

router.delete('/contas', async (req, res) => {
  const { id } = req.query;
  if (!id) return res.status(400).json({ error: 'ID é obrigatório' });
  try {
    // Parcela constraints are ON DELETE CASCADE
    await pool.query('DELETE FROM financeiro_contas WHERE id = $1', [id]);
    res.json({ message: 'Conta e parcelas excluídas com sucesso' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── PARCELAS ──
router.get('/parcelas', async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT p.id, p.conta_id as "contaId", p.numero_parcela as "numeroParcela", p.valor_esperado as "valorEsperado", TO_CHAR(p.data_vencimento, 'YYYY-MM-DD') as "dataVencimento", p.valor_pago as "valorPago", TO_CHAR(p.data_pagamento, 'YYYY-MM-DD') as "dataPagamento", p.status,
             c.tipo as "contaTipo", c.descricao as "contaDescricao", c.projeto,
             pes.nome_razao as "pessoaNome"
      FROM financeiro_parcelas p
      JOIN financeiro_contas c ON p.conta_id = c.id
      LEFT JOIN financeiro_pessoas pes ON c.pessoa_id = pes.id
      ORDER BY p.data_vencimento ASC
    `);

    // Formatar como esperado pelo frontend
    const parcelas = rows.map(p => ({
      id: p.id,
      contaId: p.contaId,
      numeroParcela: p.numeroParcela,
      valorEsperado: p.valorEsperado,
      dataVencimento: p.dataVencimento,
      valorPago: p.valorPago,
      dataPagamento: p.dataPagamento,
      status: p.status,
      conta: {
        id: p.contaId,
        tipo: p.contaTipo,
        descricao: p.contaDescricao,
        projeto: p.projeto,
        pessoa: p.pessoaNome ? { nomeRazao: p.pessoaNome } : null
      }
    }));

    res.json(parcelas);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.patch('/parcelas', async (req, res) => {
  const { id, status, dataPagamento, valorPago, dataVencimento, valorEsperado } = req.body;
  if (!id) return res.status(400).json({ error: 'ID é obrigatório' });

  try {
    const fields = [];
    const values = [];
    let query = 'UPDATE financeiro_parcelas SET ';

    if (status !== undefined) {
      values.push(status);
      fields.push(`status = $${values.length}`);
    }
    if (dataPagamento !== undefined) {
      values.push(dataPagamento);
      fields.push(`data_pagamento = $${values.length}`);
    }
    if (valorPago !== undefined) {
      values.push(valorPago);
      fields.push(`valor_pago = $${values.length}`);
    }
    if (dataVencimento !== undefined) {
      values.push(dataVencimento);
      fields.push(`data_vencimento = $${values.length}`);
    }
    if (valorEsperado !== undefined) {
      values.push(valorEsperado);
      fields.push(`valor_esperado = $${values.length}`);
    }

    if (fields.length === 0) return res.status(400).json({ error: 'Nenhum campo para atualizar' });

    query += fields.join(', ');
    values.push(id);
    query += ` WHERE id = $${values.length} RETURNING *`;

    const { rows } = await pool.query(query, values);
    
    // Opcional: Atualizar o status geral da Conta se todas as parcelas foram pagas
    if (rows[0]) {
      const contaId = rows[0].conta_id;
      const parceRes = await pool.query('SELECT status FROM financeiro_parcelas WHERE conta_id = $1', [contaId]);
      const allPaid = parceRes.rows.every(p => p.status === 'PAGO');
      const anyPaid = parceRes.rows.some(p => p.status === 'PAGO');
      
      let novoStatus = 'PENDENTE';
      if (allPaid) novoStatus = 'QUITADO';
      else if (anyPaid) novoStatus = 'PARCIAL';
      
      await pool.query('UPDATE financeiro_contas SET status_geral = $1 WHERE id = $2', [novoStatus, contaId]);
    }

    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
