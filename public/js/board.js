// Board (Kanban) Logic
let boardId = null;
let boardData = null;
let listsData = [];
let labelsData = [];
let currentCardId = null;
let currentAssignees = [];
let currentPriority = 'normal';
let currentCardLabels = [];
let draggedCard = null;
let isCreatingCard = false;
let createTargetListId = null;
let currentViewMode = 'kanban';
let quillEditor = null;
let canManageLabels = false;

let selectedDesignerFilter = 'all';
let allUsers = [];

const PRIORITY_MAP = {
  urgente: { label: 'Urgente', color: '#e74c3c', emoji: '🔴' },
  alta:    { label: 'Alta',    color: '#e67e22', emoji: '🟠' },
  normal:  { label: 'Normal',  color: '#3498db', emoji: '🔵' },
  baixa:   { label: 'Baixa',  color: '#95a5a6', emoji: '⚫' },
};

/**
 * Converte o valor de um input datetime-local (hora local)
 * para uma string ISO 8601 em UTC, para enviar ao servidor.
 * Ex: '2026-05-20T13:00' (UTC-3) → '2026-05-20T16:00:00.000Z'
 */
function toLocalISOString(datetimeLocalValue) {
  if (!datetimeLocalValue) return null;
  const [datePart, timePart] = datetimeLocalValue.split('T');
  const [y, mo, d] = datePart.split('-').map(Number);
  const [h, mi] = (timePart || '00:00').split(':').map(Number);
  // new Date(y, mo-1, d, h, mi) usa hora local do navegador
  return new Date(y, mo - 1, d, h, mi, 0).toISOString();
}

/**
 * Converte uma string ISO (UTC) do servidor para o formato
 * que o input datetime-local espera (hora local do usuário).
 * Ex: '2026-05-20T16:00:00.000Z' (UTC) → '2026-05-20T13:00' (UTC-3)
 */
function toDatetimeLocalValue(isoString) {
  if (!isoString) return '';
  const d = new Date(isoString);
  if (isNaN(d.getTime())) return '';
  const pad = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

document.addEventListener('DOMContentLoaded', async () => {
  if (!requireAuth()) return;

  const params = new URLSearchParams(window.location.search);
  boardId = params.get('id');
  if (!boardId) { window.location.href = '/dashboard'; return; }

  await loadBoard();
  setupModals();
  setupSearch();
  setupTabs();

  // Inicializar Quill
  quillEditor = new Quill('#card-description-editor', {
    theme: 'snow',
    placeholder: 'Adicione uma descrição mais detalhada...',
    modules: {
      toolbar: [
        [{ 'header': [1, 2, 3, false] }],
        ['bold', 'italic', 'underline', 'strike'],
        [{ 'list': 'ordered'}, { 'list': 'bullet' }],
        ['link', 'image', 'clean']
      ]
    }
  });
});

function setupTabs() {
  const tabBtns = document.querySelectorAll('.board-tab-btn');
  tabBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      tabBtns.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      currentViewMode = btn.dataset.view;
      
      const kanbanContainer = document.getElementById('board-canvas');
      const listContainer = document.getElementById('list-view-container');
      
      if (currentViewMode === 'kanban') {
        kanbanContainer.style.display = 'flex';
        listContainer.style.display = 'none';
      } else {
        kanbanContainer.style.display = 'none';
        listContainer.style.display = 'flex';
      }
      
      renderLists();
    });
  });
}

// ===== LOAD DATA =====
async function loadBoard() {
  try {
    const boards = await API.get('/boards');
    boardData = boards.find(b => b.id == boardId);
    if (!boardData) { window.location.href = '/dashboard'; return; }

    document.title = `TaskFlow — ${boardData.title}`;
    document.getElementById('board-title').value = boardData.title;
    document.getElementById('board-header').style.background = boardData.background.replace('135deg', '90deg');

    // Board title edit
    const titleInput = document.getElementById('board-title');
    if (boardData.owner_id === null) {
      titleInput.readOnly = true;
      titleInput.style.pointerEvents = 'none';
    } else {
      titleInput.addEventListener('blur', async () => {
        const val = titleInput.value.trim();
        if (val && val !== boardData.title) {
          await API.put(`/boards/${boardId}`, { title: val });
          boardData.title = val;
        }
      });
    }

    // Load lists + cards + permissions
    listsData = await API.get(`/lists/${boardId}/lists`);
    labelsData = await API.get(`/labels/${boardId}/labels`);
    try {
      const perm = await API.get('/labels/can-manage');
      canManageLabels = perm.canManage;
    } catch(e) { canManageLabels = false; }
    
    await initDesignerBoardFeature();
    renderLists();
  } catch (err) {
    showToast(err.message, 'error');
  }
}

// ===== DESIGNER BOARD FEATURE =====
async function initDesignerBoardFeature() {
  if (boardData && boardData.title === 'Designer') {
    // 1. Change the "Membro" button to "Designers"
    const addMemberBtn = document.getElementById('add-member-btn');
    if (addMemberBtn) {
      addMemberBtn.innerHTML = `
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>
        Designers
      `;
      // Replace click handler by cloning and replacing
      const newBtn = addMemberBtn.cloneNode(true);
      addMemberBtn.parentNode.replaceChild(newBtn, addMemberBtn);
      
      newBtn.addEventListener('click', openDesignerModal);
    }

    // 2. Load all users and populate filter
    try {
      allUsers = await API.get('/auth/users');
    } catch (err) {
      console.error('Erro ao carregar usuários', err);
    }

    const designerFilter = document.getElementById('designer-filter');
    if (designerFilter) {
      designerFilter.style.display = 'block';
      
      // Limpa as opções existentes mantendo apenas a primeira
      designerFilter.innerHTML = '<option value="all">Todos os designers</option>';
      
      const designers = allUsers.filter(u => u.is_designer);
      designers.forEach(d => {
        const option = document.createElement('option');
        option.value = d.id;
        option.textContent = d.name;
        option.style.background = '#1e1e2a';
        option.style.color = '#fff';
        designerFilter.appendChild(option);
      });

      designerFilter.addEventListener('change', (e) => {
        selectedDesignerFilter = e.target.value;
        renderLists();
      });
    }
  }
}

function openDesignerModal() {
  const listEl = document.getElementById('designers-list');
  listEl.innerHTML = '';

  allUsers.forEach(user => {
    const row = document.createElement('div');
    row.style.cssText = 'display:flex; justify-content:space-between; align-items:center; padding:8px; background:var(--bg-card); border-radius:var(--radius-md); border:1px solid var(--border);';
    
    row.innerHTML = `
      <div style="display:flex; align-items:center; gap:8px;">
        <div class="user-avatar" style="background:${user.avatar_color || '#ccc'}; width:24px; height:24px; font-size:10px;">${user.name.charAt(0).toUpperCase()}</div>
        <span style="font-size:14px;">${escapeHtml(user.name)}</span>
      </div>
      <label class="toggle-switch" style="cursor:pointer; display:flex; align-items:center;">
        <input type="checkbox" style="width:16px; height:16px; accent-color:var(--primary);" ${user.is_designer ? 'checked' : ''}>
      </label>
    `;

    const checkbox = row.querySelector('input[type="checkbox"]');
    checkbox.addEventListener('change', async (e) => {
      const isDesigner = e.target.checked;
      try {
        await API.put(`/auth/users/${user.id}/designer`, { is_designer: isDesigner });
        user.is_designer = isDesigner;
        
        // Atualiza o dropdown se estiver aberto
        const designerFilter = document.getElementById('designer-filter');
        if (designerFilter) {
          const currentValue = designerFilter.value;
          designerFilter.innerHTML = '<option value="all" style="background:#1e1e2a; color:#fff;">Todos os designers</option>';
          const designers = allUsers.filter(u => u.is_designer);
          designers.forEach(d => {
            const option = document.createElement('option');
            option.value = d.id;
            option.textContent = d.name;
            option.style.background = '#1e1e2a';
            option.style.color = '#fff';
            designerFilter.appendChild(option);
          });
          // Reseta a seleção ou volta para o que estava
          if (designers.find(d => String(d.id) === String(currentValue))) {
            designerFilter.value = currentValue;
          } else {
            selectedDesignerFilter = 'all';
          }
          renderLists();
        }
      } catch (err) {
        showToast('Erro ao atualizar status', 'error');
        e.target.checked = !isDesigner; // Revert
      }
    });

    listEl.appendChild(row);
  });

  document.getElementById('designer-modal').classList.add('show');
}

// Criar nova etiqueta via Modal
document.getElementById('submit-create-empresa-btn').addEventListener('click', async () => {
  const name = document.getElementById('new-empresa-name').value.trim();
  const color = document.getElementById('new-empresa-color').value;
  if (!boardId) return;

  try {
    const newLabel = await API.post('/labels', { name, color, board_id: boardId });
    labelsData.push(newLabel);
    
    // Reset modal
    document.getElementById('new-empresa-name').value = '';
    document.getElementById('create-empresa-modal').classList.remove('show');
    
    // Recarregar os dados do card
    if (currentCardId) {
      const card = await API.get(`/cards/${currentCardId}`);
      currentCardLabels = card.labels || [];
      // Se não estava selecionada, seleciona a nova automaticamente
      if (!currentCardLabels.some(l => l.id === newLabel.id)) {
        await API.post(`/cards/${currentCardId}/labels`, { label_id: newLabel.id });
        const updatedCard = await API.get(`/cards/${currentCardId}`);
        currentCardLabels = updatedCard.labels || [];
      }
      renderCardLabels();
      renderLists();
    } else if (isCreatingCard) {
      currentCardLabels.push(newLabel);
      renderCardLabels();
    }
    showToast('Empresa criada com sucesso!', 'success');
  } catch (err) {
    showToast(err.message, 'error');
  }
});


// ===== RENDER LISTS ROUTER =====
function renderLists() {
  if (currentViewMode === 'kanban') {
    renderKanbanView();
  } else {
    renderListView();
  }
}

// ===== RENDER KANBAN =====
function renderKanbanView() {
  const canvas = document.getElementById('board-canvas');
  canvas.innerHTML = '';

  listsData.forEach(list => {
    const col = createListColumn(list);
    canvas.appendChild(col);
  });

  // Add list button
  if (boardData.owner_id !== null) {
    const addBtn = document.createElement('button');
    addBtn.className = 'add-list-btn';
    addBtn.innerHTML = '+ Adicionar lista';
    addBtn.addEventListener('click', () => {
      const title = prompt('Nome da lista:');
      if (title && title.trim()) addList(title.trim());
    });
    canvas.appendChild(addBtn);
  }
}

function createListColumn(list) {
  const col = document.createElement('div');
  col.className = 'list-column';
  col.dataset.listId = list.id;
  col.style.borderTop = `4px solid ${list.color || '#8F8F99'}`;

  // Header
  const header = document.createElement('div');
  header.className = 'list-header';
  header.style.display = 'flex';
  header.style.alignItems = 'center';

  const colorIndicator = document.createElement('div');
  colorIndicator.className = 'list-color-indicator';
  colorIndicator.style.cssText = `width: 12px; height: 12px; border-radius: 50%; background: ${list.color || '#8F8F99'}; margin-right: 8px; cursor: pointer; flex-shrink: 0;`;
  if (boardData.owner_id !== null) {
    colorIndicator.addEventListener('click', (e) => {
      e.stopPropagation();
      showColorPicker(list, colorIndicator);
    });
  }

  const titleInput = document.createElement('input');
  titleInput.className = 'list-title';
  titleInput.value = list.title;
  titleInput.spellcheck = false;
  if (boardData.owner_id === null) {
    titleInput.readOnly = true;
    titleInput.style.pointerEvents = 'none';
  } else {
    titleInput.addEventListener('blur', async () => {
      const val = titleInput.value.trim();
      if (val && val !== list.title) {
        await API.put(`/lists/${list.id}`, { title: val });
        list.title = val;
      }
    });
  }

  const menuBtn = document.createElement('button');
  menuBtn.className = 'list-menu-btn';
  menuBtn.textContent = '⋯';
  if (boardData.owner_id === null) {
    menuBtn.style.display = 'none';
  } else {
    menuBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      showListMenu(list, menuBtn);
    });
  }

  header.appendChild(colorIndicator);
  header.appendChild(titleInput);
  header.appendChild(menuBtn);
  col.appendChild(header);

  // Cards container (drop zone)
  const cardsContainer = document.createElement('div');
  cardsContainer.className = 'list-cards';
  cardsContainer.dataset.listId = list.id;

  // Drag & Drop events on container
  cardsContainer.addEventListener('dragover', handleDragOver);
  cardsContainer.addEventListener('dragenter', handleDragEnter);
  cardsContainer.addEventListener('dragleave', handleDragLeave);
  cardsContainer.addEventListener('drop', handleDrop);

  const filteredCards = (list.cards || []).filter(card => {
    if (selectedDesignerFilter === 'all') return true;
    const assignees = Array.isArray(card.assignees) ? card.assignees : [];
    return assignees.some(a => String(a.id) === String(selectedDesignerFilter));
  });

  filteredCards.forEach(card => {
    cardsContainer.appendChild(createCardItem(card, list));
  });

  col.appendChild(cardsContainer);

  // Add card area
  const addArea = document.createElement('div');
  addArea.innerHTML = `
    <button class="add-card-btn" data-list-id="${list.id}">+ Adicionar cartão</button>
  `;

  const addBtn = addArea.querySelector('.add-card-btn');
  addBtn.addEventListener('click', () => {
    openCreateCardModal(list);
  });

  col.appendChild(addArea);
  return col;
}

function formatDateTimeShort(dateString) {
  if (!dateString) return '';
  const d = new Date(dateString);
  const pad = n => String(n).padStart(2, '0');
  const yy = String(d.getFullYear()).slice(-2);
  return `${pad(d.getDate())}/${pad(d.getMonth()+1)}/${yy} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function formatCardDateRange(start, end) {
  if (!start && !end) return '';
  if (start && end) return `${formatDateTimeShort(start)} -> ${formatDateTimeShort(end)}`;
  if (start) return `${formatDateTimeShort(start)} -> ...`;
  return `... -> ${formatDateTimeShort(end)}`;
}

// ===== RENDER LIST VIEW =====
function renderListView() {
  const container = document.getElementById('list-view-container');
  container.innerHTML = '';

  listsData.forEach(list => {
    const group = document.createElement('div');
    group.className = 'lv-group';
    
    // Group Header
    const header = document.createElement('div');
    header.className = 'lv-group-header';
    header.innerHTML = `
      <div class="lv-arrow"><svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><polygon points="7 10 12 15 17 10"/></svg></div>
      <div class="lv-status-badge">
        <div style="width: 12px; height: 12px; border-radius: 50%; background: ${list.color || '#8F8F99'}; margin-right: 8px;"></div>
        ${escapeHtml(list.title).toUpperCase()}
      </div>
      <div class="lv-count">${list.cards ? list.cards.length : 0}</div>
      <div class="lv-actions">
        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/><circle cx="5" cy="12" r="1"/></svg>
        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
      </div>
    `;
    
    // Toggle Collapse
    header.addEventListener('click', () => {
      group.classList.toggle('collapsed');
    });

    const body = document.createElement('div');
    body.className = 'lv-group-body';

    // Table Header
    const tableHeader = document.createElement('div');
    tableHeader.className = 'lv-table-header';
    tableHeader.innerHTML = `
      <div>Nome</div>
      <div>Responsável</div>
      <div>Data de vencimento</div>
      <div>Prioridade</div>
      <div>Status</div>
      <div>Comentários</div>
      <div style="text-align:right;"><svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="16"/><line x1="8" y1="12" x2="16" y2="12"/></svg></div>
    `;
    body.appendChild(tableHeader);

    // Cards
    const filteredCards = (list.cards || []).filter(card => {
      if (selectedDesignerFilter === 'all') return true;
      const assignees = Array.isArray(card.assignees) ? card.assignees : [];
      return assignees.some(a => String(a.id) === String(selectedDesignerFilter));
    });

    // Atualizar a contagem para usar o filteredCards
    header.querySelector('.lv-count').textContent = filteredCards.length;

    filteredCards.forEach(card => {
      const row = document.createElement('div');
      row.className = 'lv-row';
      
      const done = card.is_completed ? 'checked' : '';
      
      row.innerHTML = `
        <div class="lv-name-col">
          <svg class="lv-check-icon" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/></svg>
          <span style="font-weight: 500;">${escapeHtml(card.title)}</span>
        </div>
        <div class="lv-assignee-col">
          ${(card.assignees && card.assignees.length > 0) ? 
            `<div style="display:flex; gap:4px; align-items:center; justify-content:center;">
              ${card.assignees.map(a => `<div class="user-avatar" style="background:${a.avatar_color || '#6C5CE7'}; width: 24px; height: 24px; font-size: 10px; cursor: help;" title="Responsável: ${escapeHtml(a.name)}">${a.name.charAt(0).toUpperCase()}</div>`).join('')}
             </div>` 
            : 
            `<div class="lv-placeholder" title="Sem responsável">
               <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
             </div>`
          }
        </div>
        <div class="lv-date-col">
          ${card.start_date || card.due_date ? 
            `<div style="font-size: 0.75rem; color: var(--text-muted); display:flex; align-items:center; gap: 4px; justify-content: center;">
              <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
              ${formatCardDateRange(card.start_date, card.due_date)}
             </div>`
            :
            `<div class="lv-placeholder">
              <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
             </div>`
          }
        </div>
        <div>
          ${(() => {
            const p = PRIORITY_MAP[card.priority] || PRIORITY_MAP['normal'];
            return `<span class="lv-priority-badge" style="background:${p.color}22; color:${p.color}; border:1px solid ${p.color}44; display:inline-flex; align-items:center; gap:4px; padding:3px 8px; border-radius:12px; font-size:11px; font-weight:600; white-space:nowrap;">${p.emoji} ${p.label}</span>`;
          })()}
        </div>
        <div>
          <span class="lv-status-badge" style="display:inline-flex;">
            <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M12 8v4l3 3"/></svg>
            ${escapeHtml(list.title).toUpperCase()}
          </span>
        </div>
        <div class="lv-placeholder">
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
        </div>
        <div></div>
      `;
      
      row.addEventListener('click', () => openCardModal(card.id, list));
      body.appendChild(row);
    });

    // Add task row
    const addRow = document.createElement('div');
    addRow.className = 'lv-add-row';
    addRow.innerHTML = `
      <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
      Adicionar Tarefa
    `;
    addRow.addEventListener('click', () => {
      openCreateCardModal(list);
    });
    body.appendChild(addRow);

    group.appendChild(header);
    group.appendChild(body);
    container.appendChild(group);
  });
}

function createCardItem(card, list) {
  const el = document.createElement('div');
  el.className = 'card-item';
  el.dataset.cardId = card.id;
  el.draggable = true;

  let html = '';

  // Labels
  const cardLabels = Array.isArray(card.labels) ? card.labels : [];
  if (cardLabels.length > 0) {
    html += '<div class="card-labels">';
    cardLabels.forEach(l => { html += `<div class="card-label" style="background:${l.color}" title="${escapeHtml(l.name || '')}">${escapeHtml(l.name || '')}</div>`; });
    html += '</div>';
  }

  // Title
  html += `<div class="card-title">${escapeHtml(card.title)}</div>`;

  // Badges
  const badges = [];
  if (card.due_date) {
    const overdue = isOverdue(card.due_date);
    const done = card.is_completed;
    badges.push(`<span class="card-badge ${done ? 'done' : overdue ? 'overdue' : ''}">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/></svg>
      ${formatDate(card.due_date)}
    </span>`);
  }
  if (card.description) {
    badges.push(`<span class="card-badge"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="17" y1="10" x2="3" y2="10"/><line x1="21" y1="6" x2="3" y2="6"/><line x1="21" y1="14" x2="3" y2="14"/><line x1="17" y1="18" x2="3" y2="18"/></svg></span>`);
  }
  const total = parseInt(card.checklist_total) || 0;
  const done = parseInt(card.checklist_done) || 0;
  if (total > 0) {
    badges.push(`<span class="card-badge ${done === total ? 'done' : ''}">${done}/${total}</span>`);
  }

  // Badge de prioridade
  if (card.priority && card.priority !== 'normal') {
    const p = PRIORITY_MAP[card.priority];
    if (p) {
      badges.push(`<span class="card-badge priority-badge" style="background:${p.color}22; color:${p.color}; border:1px solid ${p.color}44;">${p.emoji} ${p.label}</span>`);
      el.style.border = `1px solid ${p.color}`;
      el.style.boxShadow = `0 4px 12px ${p.color}40`;
    }
  }

  if (badges.length > 0) html += `<div class="card-badges">${badges.join('')}</div>`;

  const assignees = Array.isArray(card.assignees) ? card.assignees : [];
  if (assignees.length > 0) {
    html += '<div class="card-assignees" style="display:flex; gap:4px; margin-top:8px;">';
    assignees.forEach(a => {
      html += `<div class="user-avatar" style="background:${a.avatar_color || '#6C5CE7'}; width: 20px; height: 20px; font-size: 9px; cursor: help;" title="${escapeHtml(a.name)}">${a.name.charAt(0).toUpperCase()}</div>`;
    });
    html += '</div>';
  }

  el.innerHTML = html;

  // Click to open modal
  el.addEventListener('click', () => openCardModal(card.id, list));

  // Drag events
  el.addEventListener('dragstart', (e) => {
    draggedCard = { cardId: card.id, sourceListId: list.id };
    el.classList.add('dragging');
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', card.id);
  });

  el.addEventListener('dragend', () => {
    el.classList.remove('dragging');
    draggedCard = null;
    document.querySelectorAll('.drop-indicator').forEach(ind => ind.remove());
    document.querySelectorAll('.list-cards').forEach(lc => lc.classList.remove('drag-over'));
  });

  return el;
}

// ===== DRAG & DROP =====
function handleDragOver(e) {
  e.preventDefault();
  e.dataTransfer.dropEffect = 'move';

  const container = e.currentTarget;
  const draggingEl = document.querySelector('.card-item.dragging');
  if (!draggingEl) return;

  // Remove old indicators
  document.querySelectorAll('.drop-indicator').forEach(ind => ind.remove());

  const cards = [...container.querySelectorAll('.card-item:not(.dragging)')];
  const afterEl = getDragAfterElement(container, e.clientY);

  const indicator = document.createElement('div');
  indicator.className = 'drop-indicator';

  if (afterEl) {
    container.insertBefore(indicator, afterEl);
  } else {
    container.appendChild(indicator);
  }
}

function handleDragEnter(e) {
  e.preventDefault();
  e.currentTarget.classList.add('drag-over');
}

function handleDragLeave(e) {
  if (!e.currentTarget.contains(e.relatedTarget)) {
    e.currentTarget.classList.remove('drag-over');
  }
}

async function handleDrop(e) {
  e.preventDefault();
  const container = e.currentTarget;
  container.classList.remove('drag-over');
  document.querySelectorAll('.drop-indicator').forEach(ind => ind.remove());

  if (!draggedCard) return;

  const targetListId = parseInt(container.dataset.listId);
  const cards = [...container.querySelectorAll('.card-item:not(.dragging)')];
  const afterEl = getDragAfterElement(container, e.clientY);
  let newPosition = afterEl
    ? cards.indexOf(afterEl)
    : cards.length;

  try {
    await API.put(`/cards/${draggedCard.cardId}/move`, {
      list_id: targetListId,
      position: newPosition
    });

    // Reload lists
    listsData = await API.get(`/lists/${boardId}/lists`);
    renderLists();
  } catch (err) {
    showToast(err.message, 'error');
  }
}

function getDragAfterElement(container, y) {
  const cards = [...container.querySelectorAll('.card-item:not(.dragging)')];
  return cards.reduce((closest, child) => {
    const box = child.getBoundingClientRect();
    const offset = y - box.top - box.height / 2;
    if (offset < 0 && offset > closest.offset) {
      return { offset, element: child };
    }
    return closest;
  }, { offset: Number.NEGATIVE_INFINITY }).element;
}

// ===== ACTIONS =====
async function addList(title) {
  try {
    const randomColor = LIST_COLORS[Math.floor(Math.random() * LIST_COLORS.length)];
    const newList = await API.post(`/lists/${boardId}/lists`, { title, color: randomColor });
    listsData.push(newList);
    renderLists();
    showToast('Lista criada!', 'success');
  } catch (err) {
    showToast(err.message, 'error');
  }
}

async function addCard(listId, textarea, addBtn, form) {
  const title = textarea.value.trim();
  if (!title) return;

  try {
    const card = await API.post('/cards', { title, list_id: listId });
    const list = listsData.find(l => l.id === listId);
    if (list) list.cards.push(card);
    renderLists();
    showToast('Cartão criado!', 'success');
  } catch (err) {
    showToast(err.message, 'error');
  }
}

function showListMenu(list, btn) {
  closeAllContextMenus();
  const menu = document.createElement('div');
  menu.className = 'context-menu';
  const rect = btn.getBoundingClientRect();
  menu.style.left = rect.left + 'px';
  menu.style.top = rect.bottom + 4 + 'px';
  menu.innerHTML = `
    <button class="context-menu-item" data-action="rename">✏️ Renomear</button>
    <button class="context-menu-item danger" data-action="delete">🗑️ Excluir lista</button>
  `;

  menu.querySelector('[data-action="rename"]').addEventListener('click', () => {
    const title = prompt('Novo nome:', list.title);
    if (title && title.trim()) {
      API.put(`/lists/${list.id}`, { title: title.trim() }).then(() => {
        list.title = title.trim();
        renderLists();
      });
    }
    menu.remove();
  });

  menu.querySelector('[data-action="delete"]').addEventListener('click', async () => {
    if (confirm('Excluir esta lista e todos os cartões?')) {
      try {
        await API.delete(`/lists/${list.id}`);
        listsData = listsData.filter(l => l.id !== list.id);
        renderLists();
        showToast('Lista excluída', 'success');
      } catch (err) { showToast(err.message, 'error'); }
    }
    menu.remove();
  });

  document.body.appendChild(menu);
}

// ===== LIST COLOR PICKER =====
const LIST_COLORS = [
  '#E74C3C', '#E67E22', '#F1C40F', '#2ECC71', '#1ABC9C',
  '#3498DB', '#9B59B6', '#E91E63', '#00BCD4', '#8BC34A',
  '#FF5722', '#607D8B', '#6C5CE7', '#00b894', '#fd79a8',
  '#8F8F99', '#2D3436', '#B2BEC3', '#FDCB6E', '#6C3483'
];

function showColorPicker(list, anchorEl) {
  // Remove any existing color pickers
  document.querySelectorAll('.color-picker-popup').forEach(p => p.remove());

  const popup = document.createElement('div');
  popup.className = 'color-picker-popup';
  const rect = anchorEl.getBoundingClientRect();
  popup.style.cssText = `
    position: fixed;
    left: ${rect.left}px;
    top: ${rect.bottom + 6}px;
    background: var(--bg-card, #1E1E2A);
    border: 1px solid rgba(255,255,255,0.1);
    border-radius: 12px;
    padding: 12px;
    display: grid;
    grid-template-columns: repeat(5, 24px);
    gap: 6px;
    z-index: 9999;
    box-shadow: 0 8px 32px rgba(0,0,0,0.4);
  `;

  LIST_COLORS.forEach(color => {
    const swatch = document.createElement('div');
    const isSelected = (list.color || '#8F8F99') === color;
    swatch.style.cssText = `
      width: 24px; height: 24px; border-radius: 50%;
      background: ${color}; cursor: pointer;
      border: 2px solid ${isSelected ? '#fff' : 'transparent'};
      transition: transform 0.12s, border-color 0.12s;
    `;
    swatch.title = color;
    swatch.addEventListener('mouseenter', () => { swatch.style.transform = 'scale(1.25)'; });
    swatch.addEventListener('mouseleave', () => { swatch.style.transform = 'scale(1)'; });
    swatch.addEventListener('click', async (e) => {
      e.stopPropagation();
      try {
        await API.put(`/lists/${list.id}`, { color });
        list.color = color;
        // Update the indicator dot instantly
        anchorEl.style.background = color;
        popup.remove();
        // Re-render to update calendar/list view colors
        renderLists();
      } catch (err) {
        showToast('Erro ao atualizar cor', 'error');
      }
    });
    popup.appendChild(swatch);
  });

  document.body.appendChild(popup);

  // Close on outside click
  setTimeout(() => {
    const handler = (e) => {
      if (!popup.contains(e.target) && e.target !== anchorEl) {
        popup.remove();
        document.removeEventListener('click', handler);
      }
    };
    document.addEventListener('click', handler);
  }, 0);
}

function openCreateCardModal(list) {
  isCreatingCard = true;
  currentCardId = null;
  createTargetListId = list.id;
  currentAssignees = [];
  currentPriority = 'normal';

  document.getElementById('card-id-display').textContent = 'NOVO';
  document.getElementById('card-title-input').value = '';

  const statusBtn = document.getElementById('cu-status-btn');
  statusBtn.innerHTML = `${escapeHtml(list.title).toUpperCase()} <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 12 15 18 9"/></svg>`;

  if (quillEditor) quillEditor.root.innerHTML = '';
  document.getElementById('card-start-date').value = '';
  document.getElementById('card-due-date').value = '';

  renderAssigneesDropdownBtn();
  renderPriorityBtn('normal');
  renderCardLabels([]);
  loadAttachments(null);

  document.getElementById('card-modal').classList.add('show');
}

async function openCardModal(cardId, list) {
  isCreatingCard = false;
  currentCardId = cardId;
  createTargetListId = null;
  try {
    const card = await API.get(`/cards/${cardId}`);

    document.getElementById('card-id-display').textContent = `TSK-${String(cardId).padStart(3, '0')}`;
    document.getElementById('card-title-input').value = card.title;

    const statusBtn = document.getElementById('cu-status-btn');
    statusBtn.innerHTML = `${escapeHtml(list.title).toUpperCase()} <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 12 15 18 9"/></svg>`;

    if (quillEditor) quillEditor.root.innerHTML = card.description || '';
    document.getElementById('card-start-date').value = toDatetimeLocalValue(card.start_date);
    document.getElementById('card-due-date').value   = toDatetimeLocalValue(card.due_date);

    // Responsável
    currentAssignees = Array.isArray(card.assignees) ? card.assignees : [];
    renderAssigneesDropdownBtn();

    // Prioridade
    currentPriority = card.priority || 'normal';
    renderPriorityBtn(currentPriority);

    renderCardLabels(card.labels || []);
    loadAttachments(cardId);

    document.getElementById('card-modal').classList.add('show');
  } catch (err) {
    showToast(err.message, 'error');
  }
}


function renderCardLabels() {
  const grid = document.getElementById('card-labels-grid');
  grid.innerHTML = '';
  const cardLabelIds = currentCardLabels.map(l => l.id);

  // Render selected labels as chips in the grid
  currentCardLabels.forEach(label => {
    const chipWrapper = document.createElement('div');
    chipWrapper.style.display = 'flex';
    chipWrapper.style.alignItems = 'center';
    chipWrapper.style.gap = '4px';

    const chip = document.createElement('div');
    chip.className = 'label-chip selected';
    chip.style.background = label.color;
    chip.textContent = label.name || ' ';
    
    // Clicking the chip removes it from the card
    chip.addEventListener('click', async (e) => {
      e.stopPropagation();
      if (isCreatingCard) {
        currentCardLabels = currentCardLabels.filter(l => l.id !== label.id);
        renderCardLabels();
        return;
      }
      if (!currentCardId) return;
      try {
        await API.delete(`/cards/${currentCardId}/labels/${label.id}`);
        listsData = await API.get(`/lists/${boardId}/lists`);
        const updatedCard = await API.get(`/cards/${currentCardId}`);
        currentCardLabels = updatedCard.labels || [];
        renderCardLabels();
        renderLists();
      } catch (err) { showToast(err.message, 'error'); }
    });
    
    chipWrapper.appendChild(chip);
    grid.appendChild(chipWrapper);
  });

  // Render all labels in the dropdown
  const dropdownList = document.getElementById('empresa-dropdown-list');
  if (dropdownList) {
    dropdownList.innerHTML = '';
    labelsData.forEach(label => {
      const isSelected = cardLabelIds.includes(label.id);
      
      const item = document.createElement('div');
      item.className = 'cu-dropdown-item';
      item.style.justifyContent = 'space-between';
      
      const leftContent = document.createElement('div');
      leftContent.style.display = 'flex';
      leftContent.style.alignItems = 'center';
      leftContent.style.gap = '8px';
      leftContent.innerHTML = `<span class="priority-dot" style="background:${label.color};"></span> ${escapeHtml(label.name || ' ')}`;
      item.appendChild(leftContent);
      
      if (isSelected) {
        item.innerHTML += `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" style="color:#2ecc71;"><polyline points="20 6 9 17 4 12"/></svg>`;
      }

      item.addEventListener('click', async (e) => {
        e.stopPropagation();
        if (isCreatingCard) {
          if (isSelected) currentCardLabels = currentCardLabels.filter(l => l.id !== label.id);
          else currentCardLabels.push(label);
          renderCardLabels();
          return;
        }
        if (!currentCardId) return;
        try {
          if (isSelected) await API.delete(`/cards/${currentCardId}/labels/${label.id}`);
          else await API.post(`/cards/${currentCardId}/labels`, { label_id: label.id });
          
          listsData = await API.get(`/lists/${boardId}/lists`);
          const updatedCard = await API.get(`/cards/${currentCardId}`);
          currentCardLabels = updatedCard.labels || [];
          renderCardLabels();
          renderLists();
        } catch (err) { showToast(err.message, 'error'); }
      });
      
      dropdownList.appendChild(item);
    });
  }
}

function renderAssigneesDropdownBtn() {
  const assigneeBtn = document.getElementById('cu-assignee-btn');
  if (currentAssignees && currentAssignees.length > 0) {
    assigneeBtn.innerHTML = `<div style="display:flex; gap:4px;">${currentAssignees.map(a => `<div class="user-avatar" style="width:28px;height:28px;font-size:11px;background:${a.avatar_color || '#6C5CE7'}; border:none;" title="${escapeHtml(a.name)}">${getInitials(a.name)}</div>`).join('')}</div>`;
    assigneeBtn.style.border = 'none';
    assigneeBtn.style.padding = '2px';
  } else {
    assigneeBtn.textContent = 'Vazio';
    assigneeBtn.style.border = '';
    assigneeBtn.style.padding = '';
  }
}

function renderPriorityBtn(priority) {
  const p = PRIORITY_MAP[priority] || PRIORITY_MAP['normal'];
  const dot = document.getElementById('cu-priority-dot');
  const label = document.getElementById('cu-priority-label');
  if (dot) dot.style.background = p.color;
  if (label) label.textContent = p.label;
  const btn = document.getElementById('cu-priority-btn');
  if (btn) btn.setAttribute('data-priority', priority);
}

function renderChecklist(items) {
  const container = document.getElementById('checklist-items');
  container.innerHTML = '';
  const total = items.length;
  const done = items.filter(i => i.is_checked).length;
  const bar = document.getElementById('checklist-bar');
  bar.style.width = total > 0 ? `${(done / total) * 100}%` : '0%';

  items.forEach(item => {
    const row = document.createElement('div');
    row.className = 'checklist-item';
    row.innerHTML = `
      <input type="checkbox" ${item.is_checked ? 'checked' : ''}>
      <span class="${item.is_checked ? 'checked' : ''}">${escapeHtml(item.text)}</span>
      <button class="delete-check" title="Excluir">✕</button>
    `;

    row.querySelector('input').addEventListener('change', async (e) => {
      await API.put(`/cards/${currentCardId}/checklist/${item.id}`, { is_checked: e.target.checked });
      const card = await API.get(`/cards/${currentCardId}`);
      renderChecklist(card.checklist || []);
    });

    row.querySelector('.delete-check').addEventListener('click', async () => {
      await API.delete(`/cards/${currentCardId}/checklist/${item.id}`);
      const card = await API.get(`/cards/${currentCardId}`);
      renderChecklist(card.checklist || []);
    });

    container.appendChild(row);
  });
}

function setupModals() {
  // Card modal
  const cardModal = document.getElementById('card-modal');
  document.getElementById('close-card-modal').addEventListener('click', () => {
    cardModal.classList.remove('show');
    currentCardId = null;
  });
  cardModal.addEventListener('click', (e) => {
    if (e.target === cardModal) { cardModal.classList.remove('show'); currentCardId = null; }
  });

  const designerModal = document.getElementById('designer-modal');
  if (designerModal) {
    document.getElementById('close-designer-modal').addEventListener('click', () => {
      designerModal.classList.remove('show');
    });
    designerModal.addEventListener('click', (e) => {
      if (e.target === designerModal) designerModal.classList.remove('show');
    });
  }
  
  document.getElementById('card-title-input').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      document.getElementById('save-card-btn').click();
    }
  });

  // Empresa dropdown toggle
  const empresaBtn = document.getElementById('cu-empresa-btn');
  const empresaDropdown = document.getElementById('cu-empresa-dropdown');
  empresaBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    closeAllContextMenus();
    empresaDropdown.style.display = empresaDropdown.style.display === 'none' ? 'flex' : 'none';
    empresaDropdown.style.flexDirection = 'column';
  });

  // Create Empresa Modal logic
  const createEmpresaModal = document.getElementById('create-empresa-modal');
  document.getElementById('open-create-empresa-modal-btn').addEventListener('click', (e) => {
    e.stopPropagation();
    empresaDropdown.style.display = 'none';
    createEmpresaModal.classList.add('show');
  });
  document.getElementById('close-empresa-modal').addEventListener('click', () => {
    createEmpresaModal.classList.remove('show');
  });
  createEmpresaModal.addEventListener('click', (e) => {
    if (e.target === createEmpresaModal) createEmpresaModal.classList.remove('show');
  });

  // Color swatches for new Empresa modal
  const swatches = document.querySelectorAll('#empresa-color-swatches .lcs');
  const colorInput = document.getElementById('new-empresa-color');
  swatches.forEach(sw => {
    sw.addEventListener('click', () => {
      swatches.forEach(s => s.classList.remove('selected'));
      sw.classList.add('selected');
      colorInput.value = sw.dataset.color;
    });
  });

  // Status dropdown toggle
  const statusBtn = document.getElementById('cu-status-btn');
  const statusDropdown = document.getElementById('cu-status-dropdown');
  statusBtn.addEventListener('click', () => {
    statusDropdown.style.display = statusDropdown.style.display === 'none' ? 'block' : 'none';
    if (statusDropdown.style.display === 'block') {
      statusDropdown.innerHTML = listsData.map(l => `
        <div class="cu-dropdown-item" data-list-id="${l.id}">
          <span style="width:8px;height:8px;border-radius:50%;background:#6366f1;"></span>
          ${escapeHtml(l.title)}
        </div>
      `).join('');
      
      statusDropdown.querySelectorAll('.cu-dropdown-item').forEach(item => {
        item.addEventListener('click', async () => {
          const targetListId = item.dataset.listId;
          try {
            if (isCreatingCard) {
              createTargetListId = targetListId;
              statusBtn.innerHTML = `${escapeHtml(listsData.find(l => l.id == targetListId).title).toUpperCase()} <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 12 15 18 9"/></svg>`;
              statusDropdown.style.display = 'none';
            } else {
              await API.put(`/cards/${currentCardId}/move`, { list_id: targetListId, position: 0 });
              statusBtn.innerHTML = `${escapeHtml(listsData.find(l => l.id == targetListId).title).toUpperCase()} <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 12 15 18 9"/></svg>`;
              statusDropdown.style.display = 'none';
              listsData = await API.get(`/lists/${boardId}/lists`);
              renderLists();
            }
          } catch(err) { showToast(err.message, 'error'); }
        });
      });
    }
  });


  // Assignee dropdown toggle
  const assigneeBtn = document.getElementById('cu-assignee-btn');
  const assigneeDropdown = document.getElementById('cu-assignee-dropdown');
  assigneeBtn.addEventListener('click', async () => {
    assigneeDropdown.style.display = assigneeDropdown.style.display === 'none' ? 'block' : 'none';
    if (assigneeDropdown.style.display === 'block') {
      try {
        const allUsers = await API.get('/auth/users');
        assigneeDropdown.innerHTML = [
          `<div class="cu-dropdown-item" data-member-id="">
            <div style="width:20px;height:20px;border-radius:50%;background:var(--border);display:flex;align-items:center;justify-content:center;font-size:10px;">✕</div>
            Limpar responsáveis
          </div>`
        , ...allUsers.map(m => {
          const isSelected = currentAssignees.some(a => a.id === m.id);
          return `
          <div class="cu-dropdown-item" data-member-id="${m.id}" data-member-name="${escapeHtml(m.name)}" data-member-color="${m.avatar_color}" style="${isSelected ? 'background: rgba(108, 92, 231, 0.1);' : ''}">
            <div class="user-avatar" style="width:20px;height:20px;font-size:10px;background:${m.avatar_color}">${getInitials(m.name)}</div>
            ${escapeHtml(m.name)}
            ${isSelected ? '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="var(--accent)" stroke-width="2" style="margin-left:auto;"><polyline points="20 6 9 17 4 12"/></svg>' : ''}
          </div>
          `;
        })].join('');

        assigneeDropdown.querySelectorAll('.cu-dropdown-item').forEach(item => {
          item.addEventListener('click', (e) => {
            e.stopPropagation();
            const memberId = item.dataset.memberId;
            if (!memberId) {
              currentAssignees = [];
              assigneeDropdown.style.display = 'none';
            } else {
              const idNum = parseInt(memberId);
              const exists = currentAssignees.find(a => a.id === idNum);
              if (exists) {
                currentAssignees = currentAssignees.filter(a => a.id !== idNum);
              } else {
                currentAssignees.push({
                  id: idNum,
                  name: item.dataset.memberName,
                  avatar_color: item.dataset.memberColor
                });
              }
              // Don't close dropdown on selection, let them select multiple.
              // Just re-render it
              assigneeBtn.click(); // close
              assigneeBtn.click(); // re-open
            }
            renderAssigneesDropdownBtn();
          });
        });
      } catch(err) { showToast('Erro ao carregar usuários', 'error'); }
    }
  });

  // Close dropdowns on outside click
  const priorityBtn = document.getElementById('cu-priority-btn');
  const priorityDropdown = document.getElementById('cu-priority-dropdown');

  priorityBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    const isOpen = priorityDropdown.style.display !== 'none';
    priorityDropdown.style.display = isOpen ? 'none' : 'block';
  });

  priorityDropdown.querySelectorAll('.cu-priority-item').forEach(item => {
    item.addEventListener('click', (e) => {
      e.stopPropagation();
      currentPriority = item.dataset.priority;
      renderPriorityBtn(currentPriority);
      priorityDropdown.style.display = 'none';
    });
  });

  document.addEventListener('click', (e) => {
    if (!statusBtn.contains(e.target) && !statusDropdown.contains(e.target)) statusDropdown.style.display = 'none';
    if (!assigneeBtn.contains(e.target) && !assigneeDropdown.contains(e.target)) assigneeDropdown.style.display = 'none';
    if (!priorityBtn.contains(e.target) && !priorityDropdown.contains(e.target)) priorityDropdown.style.display = 'none';
    if (!empresaBtn.contains(e.target) && !document.getElementById('cu-empresa-dropdown').contains(e.target)) {
      document.getElementById('cu-empresa-dropdown').style.display = 'none';
    }
  });

  // Save card
  document.getElementById('save-card-btn').addEventListener('click', async () => {
    const title = document.getElementById('card-title-input').value.trim();

    const startDate = toLocalISOString(document.getElementById('card-start-date').value);
    const dueDate   = toLocalISOString(document.getElementById('card-due-date').value);

    try {
      const assigneesArr = currentAssignees ? currentAssignees.map(a => a.id) : [];
      const labelsArr = currentCardLabels ? currentCardLabels.map(l => l.id) : [];

      if (isCreatingCard) {
        await API.post('/cards', {
          title,
          description: quillEditor ? quillEditor.root.innerHTML : '',
          list_id: createTargetListId,
          start_date: startDate,
          due_date: dueDate,
          assigned_user_ids: assigneesArr,
          priority: currentPriority,
          label_ids: labelsArr
        });
        showToast('Cartão criado!', 'success');
      } else {
        if (!currentCardId) return;
        await API.put(`/cards/${currentCardId}`, {
          title,
          description: quillEditor ? quillEditor.root.innerHTML : '',

          start_date: startDate,
          due_date: dueDate,
          assigned_user_ids: assigneesArr,
          priority: currentPriority,
        });
        showToast('Cartão salvo!', 'success');
      }

      const cardModal = document.getElementById('card-modal');
      cardModal.classList.remove('show');
      listsData = await API.get(`/lists/${boardId}/lists`);
      renderLists();
    } catch (err) { showToast(err.message, 'error'); }
  });


  // Delete card
  document.getElementById('delete-card-btn').addEventListener('click', async () => {
    if (!currentCardId) return;
    if (!confirm('Excluir este cartão?')) return;
    try {
      await API.delete(`/cards/${currentCardId}`);
      showToast('Cartão excluído', 'success');
      cardModal.classList.remove('show');
      listsData = await API.get(`/lists/${boardId}/lists`);
      renderLists();
    } catch (err) { showToast(err.message, 'error'); }
  });

  // Attachments logic
  document.getElementById('card-attachment-upload').addEventListener('change', uploadAttachments);

  // Member modal
  const memberModal = document.getElementById('member-modal');
  const addMemberBtn = document.getElementById('add-member-btn');
  if (addMemberBtn) {
    addMemberBtn.addEventListener('click', async () => {
      if (boardData && boardData.title === 'Designer') return;
      memberModal.classList.add('show');
      await loadMembers();
    });
  }
  document.getElementById('close-member-modal').addEventListener('click', () => memberModal.classList.remove('show'));
  memberModal.addEventListener('click', (e) => { if (e.target === memberModal) memberModal.classList.remove('show'); });

  document.getElementById('invite-member-btn').addEventListener('click', async () => {
    const email = document.getElementById('member-email').value.trim();
    if (!email) return;
    try {
      await API.post(`/boards/${boardId}/members`, { email });
      showToast('Membro adicionado!', 'success');
      document.getElementById('member-email').value = '';
      await loadMembers();
    } catch (err) { showToast(err.message, 'error'); }
  });
}

async function loadAttachments(cardId) {
  const list = document.getElementById('attachments-list');
  list.innerHTML = '';
  if (!cardId) return;

  try {
    const attachments = await API.get(`/cards/${cardId}/attachments`);
    if (attachments.length === 0) {
      list.innerHTML = '<div style="font-size:12px; color:var(--text-muted);">Nenhum anexo.</div>';
      return;
    }
    list.innerHTML = attachments.map(a => {
      const ext = a.file_name.split('.').pop().toLowerCase();
      const isImg = ['png','jpg','jpeg','gif','webp','svg'].includes(ext);
      const isVid = ['mp4','webm','ogg','mov'].includes(ext);
      
      if (isImg) {
        return `
          <div style="position:relative; background:rgba(255,255,255,0.03); border:1px solid rgba(255,255,255,0.05); border-radius:4px; overflow:hidden;">
            <a href="${a.file_url}" target="_blank" style="display:block;">
              <img src="${a.file_url}" style="width:100%; height:120px; object-fit:cover; display:block;" title="${escapeHtml(a.file_name)}" />
            </a>
            <div style="padding:6px 8px; display:flex; align-items:center; justify-content:space-between; background:rgba(0,0,0,0.4);">
              <a href="${a.file_url}" target="_blank" style="color:var(--text); text-decoration:none; font-size:12px; flex:1; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;" title="${escapeHtml(a.file_name)}">${escapeHtml(a.file_name)}</a>
              <button class="btn-icon" style="color:#ff7675; margin-left:4px;" onclick="deleteAttachment(${a.id})" title="Excluir">
                <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
              </button>
            </div>
          </div>
        `;
      } else if (isVid) {
        return `
          <div style="position:relative; background:rgba(255,255,255,0.03); border:1px solid rgba(255,255,255,0.05); border-radius:4px; overflow:hidden;">
            <video src="${a.file_url}" controls style="width:100%; height:120px; background:#000; display:block;" title="${escapeHtml(a.file_name)}"></video>
            <div style="padding:6px 8px; display:flex; align-items:center; justify-content:space-between; background:rgba(0,0,0,0.4);">
              <a href="${a.file_url}" target="_blank" style="color:var(--text); text-decoration:none; font-size:12px; flex:1; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;" title="${escapeHtml(a.file_name)}">${escapeHtml(a.file_name)}</a>
              <button class="btn-icon" style="color:#ff7675; margin-left:4px;" onclick="deleteAttachment(${a.id})" title="Excluir">
                <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
              </button>
            </div>
          </div>
        `;
      } else {
        return `
          <div style="display:flex; align-items:center; justify-content:space-between; background:rgba(255,255,255,0.03); padding:8px 12px; border-radius:4px; border:1px solid rgba(255,255,255,0.05); height: 120px; flex-direction: column;">
            <a href="${a.file_url}" target="_blank" style="color:var(--text); text-decoration:none; display:flex; flex-direction:column; align-items:center; justify-content:center; gap:8px; font-size:13px; flex:1; overflow:hidden; width:100%;" title="${escapeHtml(a.file_name)}">
              <svg viewBox="0 0 24 24" width="32" height="32" fill="none" stroke="var(--text-muted)" stroke-width="2"><path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><polyline points="13 2 13 9 20 9"/></svg>
            </a>
            <div style="padding:6px 0 0 0; display:flex; align-items:center; justify-content:space-between; width: 100%; border-top: 1px solid rgba(255,255,255,0.05);">
              <span style="font-size:12px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; flex:1;" title="${escapeHtml(a.file_name)}">${escapeHtml(a.file_name)}</span>
              <button class="btn-icon" style="color:#ff7675; margin-left:4px;" onclick="deleteAttachment(${a.id})" title="Excluir">
                <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
              </button>
            </div>
          </div>
        `;
      }
    }).join('');
  } catch (err) {
    console.error('Erro ao carregar anexos:', err);
  }
}

async function uploadAttachments(e) {
  if (!currentCardId) {
    const title = document.getElementById('card-title-input').value.trim();
    try {
      const startDate = toLocalISOString(document.getElementById('card-start-date').value);
      const dueDate   = toLocalISOString(document.getElementById('card-due-date').value);
      const assigneesArr = currentAssignees ? currentAssignees.map(a => a.id) : [];
      const labelsArr = currentCardLabels ? currentCardLabels.map(l => l.id) : [];

      const newCard = await API.post('/cards', {
        title,
        description: quillEditor ? quillEditor.root.innerHTML : '',
        list_id: createTargetListId,
        start_date: startDate,
        due_date: dueDate,
        assigned_user_ids: assigneesArr,
        priority: currentPriority,
        label_ids: labelsArr
      });
      currentCardId = newCard.id;
      isCreatingCard = false;
      document.getElementById('card-id-display').textContent = `TSK-${String(newCard.id).padStart(3, '0')}`;
      document.getElementById('delete-card-btn').style.display = 'block';
      
      // Atualizar lista de cartões em background
      API.get(`/lists/${boardId}/lists`).then(data => {
        listsData = data;
        renderLists();
      });
    } catch (err) {
      showToast('Erro ao criar cartão: ' + err.message, 'error');
      e.target.value = '';
      return;
    }
  }
  
  const files = e.target.files;
  if (!files || files.length === 0) return;

  const formData = new FormData();
  for (let i = 0; i < files.length; i++) {
    formData.append('files', files[i]);
  }

  try {
    const token = localStorage.getItem('token');
    const res = await fetch(`/api/cards/${currentCardId}/attachments`, {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + token },
      body: formData
    });

    if (!res.ok) {
      const errorData = await res.json();
      throw new Error(errorData.error || 'Erro no upload');
    }

    showToast('Arquivos anexados com sucesso', 'success');
    e.target.value = '';
    loadAttachments(currentCardId);
  } catch (err) {
    showToast(err.message, 'error');
  }
}

async function deleteAttachment(attachmentId) {
  if (!confirm('Deseja excluir este anexo?')) return;
  try {
    await API.delete(`/cards/${currentCardId}/attachments/${attachmentId}`);
    loadAttachments(currentCardId);
    showToast('Anexo excluído', 'success');
  } catch (err) {
    showToast(err.message, 'error');
  }
}

async function loadMembers() {
  try {
    const members = await API.get(`/boards/${boardId}/members`);
    const container = document.getElementById('members-list');
    container.innerHTML = members.map(m => `
      <div style="display:flex;align-items:center;gap:8px;padding:8px 0;border-bottom:1px solid var(--border);">
        <div class="user-avatar" style="width:28px;height:28px;font-size:11px;background:${m.avatar_color}">${getInitials(m.name)}</div>
        <div>
          <div style="font-size:13px;font-weight:500;">${escapeHtml(m.name)}</div>
          <div style="font-size:11px;color:var(--text-muted);">${m.role}</div>
        </div>
      </div>
    `).join('');
  } catch (err) { showToast(err.message, 'error'); }
}

// ===== SEARCH =====
function setupSearch() {
  const searchModal = document.getElementById('search-modal');
  document.getElementById('search-cards-btn').addEventListener('click', () => searchModal.classList.add('show'));
  document.getElementById('close-search-modal').addEventListener('click', () => searchModal.classList.remove('show'));
  searchModal.addEventListener('click', (e) => { if (e.target === searchModal) searchModal.classList.remove('show'); });

  let searchTimeout;
  document.getElementById('search-input').addEventListener('input', (e) => {
    clearTimeout(searchTimeout);
    searchTimeout = setTimeout(async () => {
      const q = e.target.value.trim();
      if (q.length < 2) { document.getElementById('search-results').innerHTML = ''; return; }
      try {
        const results = await API.get(`/cards/search/query?q=${encodeURIComponent(q)}&boardId=${boardId}`);
        document.getElementById('search-results').innerHTML = results.length === 0
          ? '<p style="color:var(--text-muted);font-size:13px;">Nenhum resultado</p>'
          : results.map(c => `
            <div style="padding:10px;background:var(--bg-glass);border-radius:var(--radius-sm);margin-bottom:6px;cursor:pointer;" class="search-result" data-card-id="${c.id}">
              <div style="font-size:13px;font-weight:500;">${escapeHtml(c.title)}</div>
              <div style="font-size:11px;color:var(--text-muted);">em: ${escapeHtml(c.list_title)}</div>
            </div>
          `).join('');
      } catch (err) { console.error(err); }
    }, 300);
  });
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}
