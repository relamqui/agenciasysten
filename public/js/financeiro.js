let contas = [];
let parcelas = [];
let areas = [];
let pessoas = [];

// Calendar state
let currentDate = new Date();
let diaSelecionado = '';
let parcelasDoDia = [];

// Expanded accordion
let expandedContaId = null;

// Form state
let formParcelas = [];

// Format currency
const formatCurrency = (val) => Number(val).toFixed(2).replace('.', ',');
const parseCurrency = (val) => parseFloat(String(val).replace(',', '.')) || 0;

// Escape HTML
function escapeHtml(str) {
  if (!str) return '';
  return String(str).replace(/[&<>"']/g, function(m) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m];
  });
}

document.addEventListener('DOMContentLoaded', () => {
  fetchData();
  setupListeners();
});

async function fetchData() {
  document.getElementById('loader').style.display = 'block';
  document.getElementById('tab-content').style.display = 'none';
  try {
    const [resContas, resParcelas, resAreas, resPessoas] = await Promise.all([
      API.get('/financeiro/contas'),
      API.get('/financeiro/parcelas'),
      API.get('/financeiro/areas'),
      API.get('/financeiro/pessoas')
    ]);
    
    contas = resContas || [];
    parcelas = resParcelas || [];
    areas = resAreas || [];
    pessoas = resPessoas || [];

    // Populate selects
    const selectArea = document.getElementById('conta-area');
    selectArea.innerHTML = '<option value="">Nenhuma</option>' + areas.map(a => `<option value="${a.id}">${escapeHtml(a.nome)}</option>`).join('');

    const selectPessoa = document.getElementById('conta-pessoa');
    selectPessoa.innerHTML = '<option value="">Selecione...</option>' + pessoas.map(p => `<option value="${p.id}">${escapeHtml(p.nomeRazao)} (${p.tipo})</option>`).join('');

    renderCurrentTab();
  } catch (err) {
    showToast('Erro ao carregar dados financeiros', 'error');
  } finally {
    document.getElementById('loader').style.display = 'none';
    document.getElementById('tab-content').style.display = 'block';
  }
}

function setTab(tab) {
  document.querySelectorAll('.fin-tab').forEach(t => t.classList.remove('active'));
  document.querySelector(`.fin-tab[data-tab="${tab}"]`).classList.add('active');
  renderTab(tab);
}

function renderCurrentTab() {
  const active = document.querySelector('.fin-tab.active').getAttribute('data-tab');
  renderTab(active);
}

function renderTab(tab) {
  const content = document.getElementById('tab-content');
  if (tab === 'dashboard') content.innerHTML = renderDashboard();
  else if (tab === 'calendario') content.innerHTML = renderCalendario();
  else if (tab === 'lancamentos') content.innerHTML = renderLancamentos();
  else if (tab === 'pessoas') content.innerHTML = renderPessoas();
  else if (tab === 'areas') content.innerHTML = renderAreas();
}

/* ── DASHBOARD ── */
function renderDashboard() {
  let aReceberMes = 0;
  let aPagarMes = 0;
  let saldoProjetado = 0;

  const hoje = new Date();
  const curMonth = hoje.getMonth();
  const curYear = hoje.getFullYear();

  parcelas.forEach(p => {
    if (p.status === 'PENDENTE') {
      const [py, pm] = p.dataVencimento.split('-');
      const isThisMonth = parseInt(py) === curYear && (parseInt(pm) - 1) === curMonth;

      if (p.conta.tipo === 'RECEBER') {
        saldoProjetado += parseCurrency(p.valorEsperado);
        if (isThisMonth) aReceberMes += parseCurrency(p.valorEsperado);
      } else {
        saldoProjetado -= parseCurrency(p.valorEsperado);
        if (isThisMonth) aPagarMes += parseCurrency(p.valorEsperado);
      }
    }
  });

  // Relatório por Projeto
  const relatorioProjetos = {};
  parcelas.forEach(p => {
    if (p.status === 'PAGO' && p.conta.projeto) {
      const proj = p.conta.projeto;
      if (!relatorioProjetos[proj]) relatorioProjetos[proj] = { nome: proj, recebido: 0, pago: 0, lucro: 0 };
      
      const valorReal = parseCurrency(p.valorPago || p.valorEsperado);
      if (p.conta.tipo === 'RECEBER') relatorioProjetos[proj].recebido += valorReal;
      else relatorioProjetos[proj].pago += valorReal;
    }
  });

  const projetosArray = Object.values(relatorioProjetos)
    .map(p => ({ ...p, lucro: p.recebido - p.pago }))
    .sort((a, b) => b.lucro - a.lucro);

  let html = `
    <div class="fin-dash-grid">
      <div class="fin-card">
        <div class="fin-card-header">
          <span>A Receber (Neste Mês)</span>
          <span class="material-symbols-outlined" style="color:var(--success);">trending_up</span>
        </div>
        <div class="fin-card-value" style="color:var(--success);">R$ ${formatCurrency(aReceberMes)}</div>
      </div>
      <div class="fin-card">
        <div class="fin-card-header">
          <span>A Pagar (Neste Mês)</span>
          <span class="material-symbols-outlined" style="color:var(--danger);">trending_down</span>
        </div>
        <div class="fin-card-value" style="color:var(--danger);">R$ ${formatCurrency(aPagarMes)}</div>
      </div>
      <div class="fin-card">
        <div class="fin-card-header">
          <span>Saldo Pendente Projetado</span>
          <span class="material-symbols-outlined" style="color:var(--success);">account_balance_wallet</span>
        </div>
        <div class="fin-card-value" style="color:var(--success);">R$ ${formatCurrency(saldoProjetado)}</div>
      </div>
    </div>

    <div class="fin-table-container">
      <div class="fin-table-header">
        <h2 style="font-size:1.2rem;font-weight:700;">Relatório por Projeto (Realizado)</h2>
        <p style="font-size:0.85rem;color:var(--text-sub);">Calculado com base nas parcelas pagas/recebidas.</p>
      </div>
      ${projetosArray.length === 0 ? '<p style="padding:40px;text-align:center;color:var(--text-sub);">Nenhum fluxo de caixa realizado ainda.</p>' : `
      <table class="fin-table">
        <thead>
          <tr>
            <th>Projeto</th>
            <th>Total Recebido</th>
            <th>Total Pago</th>
            <th style="text-align:right;">Lucro / A Pagar</th>
          </tr>
        </thead>
        <tbody>
          ${projetosArray.map(p => `
            <tr>
              <td><strong>${escapeHtml(p.nome)}</strong></td>
              <td style="color:var(--success);">R$ ${formatCurrency(p.recebido)}</td>
              <td style="color:var(--danger);">R$ ${formatCurrency(p.pago)}</td>
              <td style="text-align:right;font-weight:bold;color:${p.lucro >= 0 ? 'var(--success)' : 'var(--danger)'};">R$ ${formatCurrency(p.lucro)}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
      `}
    </div>

    <h2 style="font-size:1.2rem;font-weight:700;margin:24px 0 16px;">Visão Geral de Lançamentos</h2>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:24px;">
      <div>
        <h3 style="font-size:1rem;color:var(--danger);margin-bottom:16px;display:flex;align-items:center;gap:8px;">
          <span class="material-symbols-outlined">trending_down</span> Lançamentos a Pagar
        </h3>
        ${renderContasLista(contas.filter(c => c.tipo === 'PAGAR'))}
      </div>
      <div>
        <h3 style="font-size:1rem;color:var(--success);margin-bottom:16px;display:flex;align-items:center;gap:8px;">
          <span class="material-symbols-outlined">trending_up</span> Lançamentos a Receber
        </h3>
        ${renderContasLista(contas.filter(c => c.tipo === 'RECEBER'))}
      </div>
    </div>
  `;
  return html;
}

/* ── LANÇAMENTOS ── */
function renderLancamentos() {
  return `
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:24px;">
      <div>
        <h3 style="font-size:1.2rem;color:var(--danger);margin-bottom:16px;display:flex;align-items:center;gap:8px;">
          <span class="material-symbols-outlined">trending_down</span> Lançamentos a Pagar
        </h3>
        ${renderContasLista(contas.filter(c => c.tipo === 'PAGAR'))}
      </div>
      <div>
        <h3 style="font-size:1.2rem;color:var(--success);margin-bottom:16px;display:flex;align-items:center;gap:8px;">
          <span class="material-symbols-outlined">trending_up</span> Lançamentos a Receber
        </h3>
        ${renderContasLista(contas.filter(c => c.tipo === 'RECEBER'))}
      </div>
    </div>
  `;
}

function renderContasLista(list) {
  if (list.length === 0) return '<p style="color:var(--text-sub);">Nenhum lançamento.</p>';
  return list.map(conta => {
    const isPagar = conta.tipo === 'PAGAR';
    const color = isPagar ? 'var(--danger)' : 'var(--success)';
    const badgeClass = isPagar ? 'pagar' : 'receber';
    const isExpanded = expandedContaId === conta.id;
    
    return `
      <div class="fin-acc ${isExpanded ? 'expanded' : ''}" data-id="${conta.id}">
        <div class="fin-acc-header" onclick="toggleAccordion(${conta.id})">
          <div>
            <div style="display:flex;align-items:center;gap:8px;margin-bottom:4px;">
              <span class="fin-badge ${badgeClass}">${isPagar ? 'A PAGAR' : 'A RECEBER'}</span>
              <strong style="font-size:1.1rem;color:var(--text);">${escapeHtml(conta.descricao)}</strong>
            </div>
            <div style="font-size:0.85rem;color:var(--text-sub);display:flex;gap:12px;">
              <span><strong>Entidade:</strong> ${escapeHtml(conta.pessoa?.nomeRazao || '-')}</span>
              <span><strong>Projeto:</strong> ${escapeHtml(conta.projeto || '-')}</span>
            </div>
            <div style="font-size:0.8rem;color:var(--text-muted);margin-top:8px;">
              ${conta.parcelas.length} parcela(s) vinculadas
            </div>
          </div>
          <div style="display:flex;align-items:center;gap:16px;text-align:right;">
            <div>
              <div style="font-size:1.3rem;font-weight:800;color:${color};">R$ ${formatCurrency(conta.valorTotal)}</div>
              <div style="font-size:0.8rem;color:var(--text-sub);">${conta.statusGeral}</div>
            </div>
            <button onclick="event.stopPropagation(); excluirConta(${conta.id})" style="background:none;border:none;color:var(--danger);cursor:pointer;padding:4px;" title="Excluir Lançamento">
              <span class="material-symbols-outlined">delete</span>
            </button>
            <span class="material-symbols-outlined" style="color:var(--text-sub);">${isExpanded ? 'expand_less' : 'expand_more'}</span>
          </div>
        </div>
        <div class="fin-acc-body">
          <h4 style="font-size:0.9rem;font-weight:700;margin-bottom:12px;color:var(--text-sub);">Detalhamento das Parcelas</h4>
          <div style="display:flex;flex-direction:column;gap:8px;">
            ${conta.parcelas.map(p => renderParcela(p, isPagar)).join('')}
          </div>
        </div>
      </div>
    `;
  }).join('');
}

function renderParcela(p, isPagar) {
  const isPago = p.status === 'PAGO';
  const color = isPago ? 'var(--success)' : (isPagar ? 'var(--danger)' : '#3b82f6');
  
  return `
    <div style="display:flex;justify-content:space-between;align-items:center;padding:12px;background:var(--surface-mid);border:1px solid var(--border);border-radius:6px;">
      <div style="display:flex;align-items:center;gap:16px;">
        <span style="font-size:0.9rem;font-weight:700;width:80px;color:${color};">Parc. ${p.numeroParcela}</span>
        <div style="display:flex;gap:16px;font-size:0.9rem;color:var(--text);">
          <span>Vencimento: <strong>${p.dataVencimento.split('-').reverse().join('/')}</strong></span>
          <span>Valor: <strong>R$ ${formatCurrency(p.valorEsperado)}</strong></span>
        </div>
      </div>
      <div style="display:flex;align-items:center;gap:12px;">
        ${isPago 
          ? `<span style="display:flex;align-items:center;gap:4px;color:var(--success);font-size:0.8rem;font-weight:700;"><span class="material-symbols-outlined" style="font-size:16px;">check_circle</span> CONCLUÍDO</span>`
          : `<span style="display:flex;align-items:center;gap:4px;color:${color};font-size:0.8rem;font-weight:700;"><span class="material-symbols-outlined" style="font-size:16px;">schedule</span> PENDENTE</span>`
        }
        <button onclick="darBaixaParcela(${p.id}, '${p.status}', ${p.valorEsperado})" style="background:${isPago ? 'transparent' : 'var(--success)'};color:${isPago ? 'var(--text-sub)' : '#000'};border:${isPago ? '1px solid var(--border)' : 'none'};padding:6px 12px;border-radius:4px;font-size:0.8rem;font-weight:700;cursor:pointer;">
          ${isPago ? 'Desfazer Baixa' : 'Dar Baixa'}
        </button>
      </div>
    </div>
  `;
}

window.toggleAccordion = function(id) {
  if (expandedContaId === id) expandedContaId = null;
  else expandedContaId = id;
  renderCurrentTab();
}

async function excluirConta(id) {
  if (!confirm('Deseja realmente excluir este lançamento completo e todas as suas parcelas?')) return;
  try {
    await API.delete(`/financeiro/contas?id=${id}`);
    showToast('Lançamento excluído', 'success');
    fetchData();
  } catch (err) {
    showToast(err.message, 'error');
  }
}

window.darBaixaParcela = async function(id, currentStatus, valorEsperado) {
  const isPaying = currentStatus === 'PENDENTE';
  const novoStatus = isPaying ? 'PAGO' : 'PENDENTE';
  const dataPgto = isPaying ? new Date().toISOString().split('T')[0] : null;
  const valorPago = isPaying ? valorEsperado : 0;

  try {
    await API.patch('/financeiro/parcelas', {
      id, status: novoStatus, dataPagamento: dataPgto, valorPago
    });
    showToast('Parcela atualizada', 'success');
    fetchData();
  } catch (err) {
    showToast(err.message, 'error');
  }
}

/* ── CALENDÁRIO ── */
function renderCalendario() {
  const year = currentDate.getFullYear();
  const month = currentDate.getMonth();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const firstDay = new Date(year, month, 1).getDay();
  const monthNames = ["Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho", "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro"];

  const getParcelasDoDia = (day) => {
    const d = String(day).padStart(2, '0');
    const m = String(month + 1).padStart(2, '0');
    const dateStr = `${year}-${m}-${d}`;
    return parcelas.filter(p => p.dataVencimento === dateStr);
  };

  let cellsHTML = '';
  for (let i = 0; i < firstDay; i++) {
    cellsHTML += `<div style="min-height:100px;"></div>`;
  }

  for (let day = 1; day <= daysInMonth; day++) {
    const pDia = getParcelasDoDia(day);
    const aReceberPendentes = pDia.filter(p => p.conta.tipo === 'RECEBER' && p.status === 'PENDENTE');
    const aPagarPendentes = pDia.filter(p => p.conta.tipo === 'PAGAR' && p.status === 'PENDENTE');
    const concluidos = pDia.filter(p => p.status === 'PAGO');

    cellsHTML += `
      <div class="cal-cell ${pDia.length > 0 ? 'has-content' : ''}" onclick="${pDia.length > 0 ? `abrirDiaCalendario(${day})` : ''}">
        <div class="cal-cell-num">${day}</div>
        ${aReceberPendentes.length > 0 ? `<div style="font-size:0.7rem;background:rgba(0,214,143,0.1);color:var(--success);padding:4px;border-radius:4px;text-align:center;font-weight:800;">${aReceberPendentes.length} a Receber</div>` : ''}
        ${aPagarPendentes.length > 0 ? `<div style="font-size:0.7rem;background:var(--danger-bg);color:var(--danger);padding:4px;border-radius:4px;text-align:center;font-weight:800;">${aPagarPendentes.length} a Pagar</div>` : ''}
        ${concluidos.length > 0 ? `<div style="font-size:0.7rem;background:rgba(255,255,255,0.05);color:var(--text-sub);padding:4px;border-radius:4px;text-align:center;font-weight:800;">${concluidos.length} Concluídos</div>` : ''}
      </div>
    `;
  }

  return `
    <div style="background:var(--surface-low);border-radius:12px;border:1px solid var(--border);padding:20px;">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:20px;">
        <h2 style="font-size:1.5rem;font-weight:800;">${monthNames[month]} ${year}</h2>
        <div style="display:flex;gap:8px;">
          <button onclick="mudarMes(-1)" class="btn btn-ghost"><span class="material-symbols-outlined">chevron_left</span></button>
          <button onclick="mudarMes(0)" class="btn btn-ghost">Hoje</button>
          <button onclick="mudarMes(1)" class="btn btn-ghost"><span class="material-symbols-outlined">chevron_right</span></button>
        </div>
      </div>
      <div class="cal-grid" style="margin-bottom:8px;">
        ${['Dom','Seg','Ter','Qua','Qui','Sex','Sáb'].map(d => `<div class="cal-day-header">${d}</div>`).join('')}
      </div>
      <div class="cal-grid">${cellsHTML}</div>
    </div>
  `;
}

window.mudarMes = function(offset) {
  if (offset === 0) currentDate = new Date();
  else currentDate.setMonth(currentDate.getMonth() + offset);
  renderCurrentTab();
}

window.abrirDiaCalendario = function(day) {
  const d = String(day).padStart(2, '0');
  const m = String(currentDate.getMonth() + 1).padStart(2, '0');
  const dateStr = `${currentDate.getFullYear()}-${m}-${d}`;
  
  parcelasDoDia = parcelas.filter(p => p.dataVencimento === dateStr);
  document.getElementById('dia-selecionado').textContent = `${d}/${m}/${currentDate.getFullYear()}`;
  
  const list = document.getElementById('dia-parcelas-list');
  list.innerHTML = parcelasDoDia.map(p => {
    const isPagar = p.conta.tipo === 'PAGAR';
    const isPago = p.status === 'PAGO';
    const color = isPago ? 'var(--success)' : (isPagar ? 'var(--danger)' : '#3b82f6');
    
    return `
      <div style="background:var(--surface);border:1px solid ${color}40;border-radius:8px;padding:16px;display:flex;justify-content:space-between;align-items:center;">
        <div>
          <div style="font-size:1.1rem;font-weight:800;color:${color};margin-bottom:4px;">
            ${isPagar ? 'A Pagar' : 'A Receber'}: R$ ${formatCurrency(p.valorEsperado)}
          </div>
          <div style="font-size:0.9rem;color:var(--text);">${escapeHtml(p.conta.descricao)}</div>
          <div style="font-size:0.8rem;color:var(--text-sub);">Pessoa: ${escapeHtml(p.conta.pessoa?.nomeRazao || '-')} | Parcela ${p.numeroParcela}</div>
        </div>
        <div style="text-align:right;">
          ${isPago 
            ? `<span style="display:flex;align-items:center;gap:4px;color:var(--success);font-size:0.85rem;font-weight:800;justify-content:flex-end;"><span class="material-symbols-outlined" style="font-size:16px;">check_circle</span> Concluído</span>`
            : `<span style="display:flex;align-items:center;gap:4px;color:${color};font-size:0.85rem;font-weight:800;justify-content:flex-end;"><span class="material-symbols-outlined" style="font-size:16px;">schedule</span> Pendente</span>`
          }
        </div>
      </div>
    `;
  }).join('');
  
  openModal('modal-dia');
}

/* ── PESSOAS ── */
function renderPessoas() {
  return `
    <button onclick="abrirModalPessoa()" class="btn btn-ghost" style="margin-bottom:16px;">
      <span class="material-symbols-outlined">add</span> Nova Entidade
    </button>
    <div style="background:var(--surface-low);border-radius:12px;border:1px solid var(--border);">
      ${pessoas.map(p => `
        <div style="padding:16px;border-bottom:1px solid var(--border);display:flex;gap:16px;align-items:center;">
          <span class="fin-badge" style="background:var(--surface-high);color:var(--text-sub);width:90px;text-align:center;">${p.tipo}</span>
          <strong style="flex:1;color:var(--text);">${escapeHtml(p.nomeRazao)}</strong>
          <span style="color:var(--text-sub);">${escapeHtml(p.documento || '-')}</span>
          <button onclick="abrirModalPessoa(${p.id})" style="background:none;border:none;color:var(--accent-text);cursor:pointer;"><span class="material-symbols-outlined">edit</span></button>
        </div>
      `).join('')}
    </div>
  `;
}

window.abrirModalPessoa = function(id = null) {
  const form = document.getElementById('form-pessoa');
  form.reset();
  if (id) {
    const p = pessoas.find(x => x.id === id);
    document.getElementById('pessoa-id').value = p.id;
    document.getElementById('pessoa-tipo').value = p.tipo;
    document.getElementById('pessoa-nome').value = p.nomeRazao;
    document.getElementById('pessoa-doc').value = p.documento;
    document.getElementById('pessoa-contato').value = p.contatoPrincipal;
    document.getElementById('pessoa-modal-title').textContent = 'Editar Entidade';
  } else {
    document.getElementById('pessoa-id').value = '';
    document.getElementById('pessoa-modal-title').textContent = 'Nova Entidade';
  }
  openModal('modal-pessoa');
}

document.getElementById('form-pessoa').addEventListener('submit', async (e) => {
  e.preventDefault();
  const id = document.getElementById('pessoa-id').value;
  const body = {
    tipo: document.getElementById('pessoa-tipo').value,
    nomeRazao: document.getElementById('pessoa-nome').value,
    documento: document.getElementById('pessoa-doc').value,
    contatoPrincipal: document.getElementById('pessoa-contato').value
  };
  try {
    if (id) {
      body.id = id;
      await API.patch('/financeiro/pessoas', body);
    } else {
      await API.post('/financeiro/pessoas', body);
    }
    closeModal('modal-pessoa');
    showToast('Salvo com sucesso!', 'success');
    fetchData();
  } catch (err) {
    showToast(err.message, 'error');
  }
});

/* ── AREAS ── */
function renderAreas() {
  return `
    <button onclick="abrirModalArea()" class="btn btn-ghost" style="margin-bottom:16px;">
      <span class="material-symbols-outlined">add</span> Nova Área
    </button>
    <div style="background:var(--surface-low);border-radius:12px;border:1px solid var(--border);">
      ${areas.map(a => `
        <div style="padding:16px;border-bottom:1px solid var(--border);display:flex;align-items:center;">
          <strong style="flex:1;color:var(--text);">${escapeHtml(a.nome)} <span style="font-weight:400;color:var(--text-sub);margin-left:12px;">${escapeHtml(a.descricao || '')}</span></strong>
          <button onclick="abrirModalArea(${a.id})" style="background:none;border:none;color:var(--accent-text);cursor:pointer;"><span class="material-symbols-outlined">edit</span></button>
        </div>
      `).join('')}
    </div>
  `;
}

window.abrirModalArea = function(id = null) {
  const form = document.getElementById('form-area');
  form.reset();
  if (id) {
    const a = areas.find(x => x.id === id);
    document.getElementById('area-id').value = a.id;
    document.getElementById('area-nome').value = a.nome;
    document.getElementById('area-descricao').value = a.descricao;
    document.getElementById('area-modal-title').textContent = 'Editar Área';
  } else {
    document.getElementById('area-id').value = '';
    document.getElementById('area-modal-title').textContent = 'Nova Área de Custo';
  }
  openModal('modal-area');
}

document.getElementById('form-area').addEventListener('submit', async (e) => {
  e.preventDefault();
  const id = document.getElementById('area-id').value;
  const body = {
    nome: document.getElementById('area-nome').value,
    descricao: document.getElementById('area-descricao').value
  };
  try {
    if (id) {
      body.id = id;
      await API.patch('/financeiro/areas', body);
    } else {
      await API.post('/financeiro/areas', body);
    }
    closeModal('modal-area');
    showToast('Salvo com sucesso!', 'success');
    fetchData();
  } catch (err) {
    showToast(err.message, 'error');
  }
});

/* ── MODAL CONTA (LANÇAMENTO) ── */
function setupListeners() {
  document.getElementById('conta-valor').addEventListener('input', updateParcelasPreview);
  document.getElementById('conta-num-parcelas').addEventListener('input', updateParcelasPreview);
  document.getElementById('conta-primeiro-venc').addEventListener('input', updateParcelasPreview);

  document.getElementById('form-conta').addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = document.getElementById('btn-salvar-conta');
    btn.disabled = true;
    
    const body = {
      tipo: document.getElementById('conta-tipo').value,
      descricao: document.getElementById('conta-descricao').value,
      valorTotal: parseCurrency(document.getElementById('conta-valor').value),
      projeto: document.getElementById('conta-projeto').value,
      areaId: document.getElementById('conta-area').value || null,
      pessoaId: document.getElementById('conta-pessoa').value || null,
      parcelas: formParcelas
    };

    try {
      await API.post('/financeiro/contas', body);
      closeModal('modal-conta');
      document.getElementById('form-conta').reset();
      formParcelas = [];
      updateParcelasPreview();
      showToast('Lançamento criado com sucesso!', 'success');
      fetchData();
    } catch (err) {
      showToast(err.message, 'error');
    } finally {
      btn.disabled = false;
    }
  });

  // Modals backdrop close
  document.querySelectorAll('.modal-backdrop').forEach(el => {
    el.addEventListener('click', e => { if (e.target === el) el.classList.remove('active'); });
  });
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') document.querySelectorAll('.modal-backdrop.active').forEach(m => m.classList.remove('active'));
  });
}

function updateParcelasPreview() {
  const valorInput = document.getElementById('conta-valor').value;
  const numParc = parseInt(document.getElementById('conta-num-parcelas').value) || 1;
  const primVenc = document.getElementById('conta-primeiro-venc').value;

  const valor = parseCurrency(valorInput);
  if (valor <= 0 || !primVenc) {
    formParcelas = [];
    document.getElementById('parcelas-preview').innerHTML = '';
    return;
  }

  const parcelasGeradas = [];
  const valorParcela = (valor / numParc).toFixed(2);
  let soma = 0;

  for (let i = 0; i < numParc; i++) {
    const v = i === numParc - 1 ? (valor - soma).toFixed(2) : valorParcela;
    soma += parseFloat(v);

    const vencimento = new Date(primVenc + 'T12:00:00Z');
    vencimento.setMonth(vencimento.getMonth() + i);

    parcelasGeradas.push({
      numeroParcela: i + 1,
      valorEsperado: v,
      dataVencimento: vencimento.toISOString().split('T')[0],
      status: 'PENDENTE'
    });
  }

  formParcelas = parcelasGeradas;
  renderParcelasPreview();
}

function renderParcelasPreview() {
  const container = document.getElementById('parcelas-preview');
  container.innerHTML = formParcelas.map((p, index) => `
    <div class="parc-gen-row">
      <strong style="width:60px;color:var(--text-sub);">Parc. ${p.numeroParcela}</strong>
      <input type="date" value="${p.dataVencimento}" onchange="updateFormParcela(${index}, 'dataVencimento', this.value)" style="padding:6px;background:var(--bg);border:1px solid var(--border);border-radius:4px;color:var(--text);">
      <input type="number" step="0.01" value="${p.valorEsperado}" onchange="updateFormParcela(${index}, 'valorEsperado', this.value)" style="padding:6px;background:var(--bg);border:1px solid var(--border);border-radius:4px;color:var(--text);width:100px;">
    </div>
  `).join('');
}

window.updateFormParcela = function(index, field, value) {
  formParcelas[index][field] = value;
  
  if (field === 'valorEsperado') {
    // Optional logic to balance other installments if one is manually edited
    // For simplicity, we just save the value in this translation.
  }
}

window.openModal = function(id) { document.getElementById(id).classList.add('active'); }
window.closeModal = function(id) { document.getElementById(id).classList.remove('active'); }
