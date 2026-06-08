// Dashboard Logic
const BACKGROUNDS = [
  'linear-gradient(135deg, #6C5CE7, #a855f7)',
  'linear-gradient(135deg, #00B894, #00CEC9)',
  'linear-gradient(135deg, #E17055, #FDCB6E)',
  'linear-gradient(135deg, #0984E3, #74B9FF)',
  'linear-gradient(135deg, #E84393, #FD79A8)',
  'linear-gradient(135deg, #2d3436, #636e72)',
  'linear-gradient(135deg, #fd79a8, #e84393)',
  'linear-gradient(135deg, #55efc4, #00b894)',
];

let selectedBg = BACKGROUNDS[0];
let boards = [];

document.addEventListener('DOMContentLoaded', async () => {
  if (!requireAuth()) return;

  const user = getUser();
  if (!user) return;

  // Permission check: only users with perm_agencia or admin can access
  if (user.role !== 'admin' && !user.perm_agencia) {
    window.location.href = '/financeiro';
    return;
  }


  // Load boards
  await loadBoards();
  await loadMyCards();

  // Create board modal
  const modal = document.getElementById('create-board-modal');
  document.getElementById('close-create-modal').addEventListener('click', () => modal.classList.remove('show'));
  modal.addEventListener('click', (e) => { if (e.target === modal) modal.classList.remove('show'); });

  // Background options
  const bgContainer = document.getElementById('bg-options');
  BACKGROUNDS.forEach((bg, i) => {
    const opt = document.createElement('div');
    opt.className = `bg-option${i === 0 ? ' selected' : ''}`;
    opt.style.background = bg;
    opt.addEventListener('click', () => {
      bgContainer.querySelectorAll('.bg-option').forEach(o => o.classList.remove('selected'));
      opt.classList.add('selected');
      selectedBg = bg;
    });
    bgContainer.appendChild(opt);
  });

  // Create board
  document.getElementById('create-board-btn').addEventListener('click', async () => {
    const title = document.getElementById('new-board-title').value.trim();
    if (!title) return showToast('Digite um nome para o quadro', 'error');

    try {
      await API.post('/boards', { title, background: selectedBg });
      modal.classList.remove('show');
      document.getElementById('new-board-title').value = '';
      showToast('Quadro criado!', 'success');
      await loadBoards();
    } catch (err) {
      showToast(err.message, 'error');
    }
  });

  // Search
  document.getElementById('search-boards').addEventListener('input', (e) => {
    const q = e.target.value.toLowerCase();
    renderBoards(boards.filter(b => b.title.toLowerCase().includes(q)));
  });
});

async function loadBoards() {
  try {
    boards = await API.get('/boards');
    renderBoards(boards);
    renderFavorites(boards);
  } catch (err) {
    showToast(err.message, 'error');
  }
}

function renderBoards(list) {
  const grid = document.getElementById('boards-grid');
  grid.innerHTML = '';

  // Botão de novo quadro removido temporariamente a pedido
  // const newCard = document.createElement('div');
  // newCard.className = 'board-card board-new';
  // newCard.innerHTML = '<span>+ Criar novo quadro</span>';
  // newCard.addEventListener('click', () => document.getElementById('create-board-modal').classList.add('show'));
  // grid.appendChild(newCard);

  list.forEach(board => {
    const card = document.createElement('div');
    card.className = 'board-card';
    card.style.background = board.background;
    card.innerHTML = `
      <button class="board-card-fav" data-id="${board.id}" title="Favoritar">${board.is_favorite ? '⭐' : '☆'}</button>
      <div class="board-card-title">${escapeHtml(board.title)}</div>
      <div class="board-card-meta">
        <span>📋 ${board.list_count || 0} listas</span>
        <span>🗂️ ${board.card_count || 0} cartões</span>
      </div>
    `;

    card.addEventListener('click', (e) => {
      if (e.target.classList.contains('board-card-fav')) return;
      window.location.href = `/board?id=${board.id}`;
    });

    const favBtn = card.querySelector('.board-card-fav');
    favBtn.addEventListener('click', async (e) => {
      e.stopPropagation();
      try {
        await API.put(`/boards/${board.id}`, { is_favorite: !board.is_favorite });
        await loadBoards();
      } catch (err) {
        showToast(err.message, 'error');
      }
    });

    // Right-click context menu
    if (board.owner_id !== null) {
      card.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        closeAllContextMenus();
        const menu = document.createElement('div');
        menu.className = 'context-menu';
        menu.style.left = e.pageX + 'px';
        menu.style.top = e.pageY + 'px';
        menu.innerHTML = `
          <button class="context-menu-item" data-action="delete">🗑️ Excluir quadro</button>
        `;
        menu.querySelector('[data-action="delete"]').addEventListener('click', async () => {
          if (confirm('Excluir este quadro e todos os seus dados?')) {
            try {
              await API.delete(`/boards/${board.id}`);
              showToast('Quadro excluído', 'success');
              await loadBoards();
            } catch (err) {
              showToast(err.message, 'error');
            }
          }
          menu.remove();
        });
        document.body.appendChild(menu);
      });
    }

    grid.appendChild(card);
  });
}

function renderFavorites(list) {
  const favContainer = document.getElementById('fav-boards-list');
  if (!favContainer) return;
  favContainer.innerHTML = '';
  list.filter(b => b.is_favorite).forEach(board => {
    const item = document.createElement('a');
    item.className = 'nav-item';
    item.href = `/board?id=${board.id}`;
    item.innerHTML = `
      <span style="width:8px;height:8px;border-radius:50%;background:${board.background.includes('#') ? board.background.split(',')[1]?.trim().split(')')[0] || '#6C5CE7' : '#6C5CE7'};flex-shrink:0;"></span>
      ${escapeHtml(board.title)}
    `;
    favContainer.appendChild(item);
  });
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

// ===== MEUS CARTÕES =====

let myCards = [];
let calYear = new Date().getFullYear();
let calMonth = new Date().getMonth();

async function loadMyCards() {
  try {
    myCards = await API.get('/boards/my-cards');
    renderMyCards();
    renderCalendar();
    setupCalendarNav();
  } catch (err) {
    console.error('Erro ao carregar meus cartões:', err);
  }
}

function renderMyCards() {
  const section = document.getElementById('my-cards-section');
  const list = document.getElementById('my-cards-list');
  const count = document.getElementById('my-cards-count');

  section.style.display = 'block';

  if (myCards.length === 0) {
    count.textContent = '0';
    list.innerHTML = `
      <div style="text-align:center; padding:2rem; color:var(--text-muted); font-size:0.875rem;">
        <svg viewBox="0 0 24 24" width="32" height="32" fill="none" stroke="currentColor" stroke-width="1.5" style="margin-bottom:0.75rem; display:block; margin-left:auto; margin-right:auto; opacity:0.4;"><rect x="3" y="3" width="18" height="18" rx="2"/><line x1="9" y1="3" x2="9" y2="21"/><line x1="15" y1="9" x2="21" y2="9"/></svg>
        Nenhum cartão atribuído a você ainda.<br>
        <span style="font-size:0.78rem; opacity:0.7;">Abra um cartão em qualquer quadro e selecione você como responsável.</span>
      </div>
    `;
    return;
  }

  count.textContent = myCards.length;

  list.innerHTML = myCards.map(card => {
    const overdue = card.due_date && new Date(card.due_date) < new Date(new Date().toDateString()) && !card.is_completed;
    const doneClass = card.is_completed ? 'my-card-done' : '';
    const overdueClass = overdue ? 'my-card-overdue' : '';
    const dateStr = formatCardDateRange(card.start_date, card.due_date);

    return `
      <div class="my-card-item ${doneClass} ${overdueClass}" onclick="window.location.href='/board?id=${card.board_id}'">
        <div class="my-card-board-bar" style="background:${card.list_color || card.board_background}"></div>
        <div class="my-card-content">
          <div class="my-card-title">${escapeHtml(card.title)}</div>
          <div class="my-card-meta">
            <span class="my-card-board-tag">${escapeHtml(card.board_title)}</span>
            <span class="my-card-list-tag">${escapeHtml(card.list_title)}</span>
            ${dateStr ? `<span class="my-card-date ${overdueClass}">
              <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
              ${dateStr}
            </span>` : ''}
          </div>
        </div>
        <div class="my-card-status ${card.is_completed ? 'status-done' : 'status-pending'}">
          ${card.is_completed ? '✓ Concluído' : overdue ? '⚠ Atrasado' : 'Em andamento'}
        </div>
      </div>
    `;
  }).join('');
}

// ===== CALENDÁRIO GOOGLE STYLE =====
const MONTHS_PT = ['Janeiro','Fevereiro','Março','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'];

function renderCalendar() {
  const section = document.getElementById('calendar-section');
  const grid = document.getElementById('cal-grid');
  const label = document.getElementById('cal-month-label');

  section.style.display = 'block';
  label.textContent = `${MONTHS_PT[calMonth]} ${calYear}`;
  grid.innerHTML = '';

  const firstDay = new Date(calYear, calMonth, 1).getDay();
  const daysInMonth = new Date(calYear, calMonth + 1, 0).getDate();
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  // Build weeks
  const totalCells = Math.ceil((firstDay + daysInMonth) / 7) * 7;
  const weeks = [];
  let week = [];
  for (let i = 0; i < totalCells; i++) {
    const dayNum = i - firstDay + 1;
    week.push((dayNum >= 1 && dayNum <= daysInMonth) ? dayNum : null);
    if (week.length === 7) { weeks.push([...week]); week = []; }
  }

  weeks.forEach(weekDays => {
    // wrapper: contains both the 7-cell row AND the floating events layer
    const weekEl = document.createElement('div');
    weekEl.className = 'cal-week';

    // Day cells (number only) — always 7 columns, always same height
    const daysRow = document.createElement('div');
    daysRow.className = 'cal-week-days';

    weekDays.forEach(dayNum => {
      const cell = document.createElement('div');
      const isToday = dayNum && today.getTime() === new Date(calYear, calMonth, dayNum).getTime();
      cell.className = `cal-day-cell${!dayNum ? ' cal-empty' : ''}`;
      if (dayNum) {
        cell.innerHTML = `<span class="cal-day-num${isToday ? ' cal-today-num' : ''}">${dayNum}</span>`;
      }
      daysRow.appendChild(cell);
    });
    weekEl.appendChild(daysRow);

    // --- Always render the events layer (even if empty) ---
    const eventsLayer = document.createElement('div');
    eventsLayer.className = 'cal-week-events';

    // Find week boundaries
    const firstReal = weekDays.find(d => d !== null);
    const lastReal  = [...weekDays].reverse().find(d => d !== null);
    if (firstReal != null) {
      const weekStart = new Date(calYear, calMonth, firstReal);
      const weekEnd   = new Date(calYear, calMonth, lastReal, 23, 59, 59);

      // Cards overlapping this week
      const weekCards = myCards.filter(card => {
        const s = card.start_date ? new Date(card.start_date) : (card.due_date ? new Date(card.due_date) : null);
        const e = card.due_date   ? new Date(card.due_date)   : s;
        if (!s) return false;
        const sd = new Date(s); sd.setHours(0,0,0,0);
        const ed = new Date(e); ed.setHours(23,59,59,999);
        return sd <= weekEnd && ed >= weekStart;
      });

      // Sort by start date so earlier events get top lanes
      weekCards.sort((a, b) => new Date(a.start_date || a.due_date) - new Date(b.start_date || b.due_date));

      weekCards.forEach((card, lane) => {
        const s  = card.start_date ? new Date(card.start_date) : (card.due_date ? new Date(card.due_date) : null);
        const e  = card.due_date   ? new Date(card.due_date)   : s;
        const sd = new Date(s); sd.setHours(0,0,0,0);
        const ed = new Date(e); ed.setHours(0,0,0,0);

        let colStart = -1, colEnd = -1;
        weekDays.forEach((dayNum, idx) => {
          if (!dayNum) return;
          const d = new Date(calYear, calMonth, dayNum);
          if (d >= sd && d <= ed) {
            if (colStart === -1) colStart = idx + 1;
            colEnd = idx + 1;
          }
        });
        if (colStart === -1) return;

        const overdue = e < today && !card.is_completed;
        const bar = document.createElement('div');
        bar.className = `cal-event-bar${overdue ? ' overdue' : ''}${card.is_completed ? ' done' : ''}`;
        bar.style.gridColumn = `${colStart} / ${colEnd + 1}`;
        bar.style.gridRow = lane + 1;
        bar.style.background = card.list_color || card.board_background;

        const timeStr = s ? s.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : '';
        bar.title = `${card.title}\n${card.board_title}${timeStr ? '\n⏰ ' + timeStr : ''}`;
        bar.innerHTML = `<span class="cal-bar-text">${timeStr ? `<b>${timeStr}</b> ` : ''}${escapeHtml(card.title)}</span>`;
        bar.onclick = () => window.location.href = `/board?id=${card.board_id}`;
        eventsLayer.appendChild(bar);
      });
    }

    weekEl.appendChild(eventsLayer);
    grid.appendChild(weekEl);
  });
}



function setupCalendarNav() {
  document.getElementById('cal-prev').addEventListener('click', () => {
    calMonth--;
    if (calMonth < 0) { calMonth = 11; calYear--; }
    renderCalendar();
  });
  document.getElementById('cal-next').addEventListener('click', () => {
    calMonth++;
    if (calMonth > 11) { calMonth = 0; calYear++; }
    renderCalendar();
  });
}


function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}
