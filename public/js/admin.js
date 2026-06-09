document.addEventListener('DOMContentLoaded', async () => {
  if (!API.isAuthenticated()) {
    window.location.href = '/';
    return;
  }

  const user = API.getUser();
  if (user.role !== 'admin' && !user.perm_usuarios) {
    window.location.href = '/dashboard';
    return;
  }

  await loadData();
});

let users = [];
let globalBoards = [];
let currentAccessUser = null;

// Avatar color palette for users without a stored color
const AVATAR_COLORS = ['#6C5CE7','#00b894','#e17055','#0984e3','#fd79a8','#6c5ce7','#fdcb6e'];
function pickColor(str) {
  let h = 0;
  for (let i = 0; i < str.length; i++) h = str.charCodeAt(i) + ((h << 5) - h);
  return AVATAR_COLORS[Math.abs(h) % AVATAR_COLORS.length];
}

async function loadData() {
  try {
    [users, globalBoards] = await Promise.all([
      API.get('/admin/users'),
      API.get('/admin/global-boards')
    ]);
    renderUsers();
  } catch (err) {
    showToast('Erro ao carregar dados do admin', 'error');
  }
}

function renderUsers() {
  const tbody = document.getElementById('users-tbody');
  const countEl = document.getElementById('table-count');
  if (!tbody) return;

  if (users.length === 0) {
    tbody.innerHTML = `<tr><td colspan="5" style="text-align:center;padding:40px;color:var(--text-sub);">Nenhum usuário encontrado.</td></tr>`;
    if (countEl) countEl.textContent = '0 usuários';
    return;
  }

  tbody.innerHTML = users.map(u => {
    const color    = u.avatar_color || pickColor(u.name || '?');
    const initials = (u.name || '?').split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2);
    const isAdmin  = u.role === 'admin';
    const badge    = isAdmin
      ? `<span class="badge badge-admin">Admin</span>`
      : `<span class="badge badge-user">Colaborador</span>`;

    return `
      <tr>
        <td>
          <div class="user-cell">
            <div class="user-avatar-tbl" style="background:${color};">${initials}</div>
            <span class="user-fullname">${escapeHtml(u.name)}</span>
          </div>
        </td>
        <td style="color:var(--text-sub);font-size:13px;">${escapeHtml(u.email)}</td>
        <td>${badge}</td>
        <td style="font-size:12px;">
          ${u.perm_agencia ? '<span class="badge badge-admin" style="font-size:10px;padding:2px 8px;margin-right:4px;">Agência</span>' : ''}
          ${u.perm_financeiro ? '<span class="badge badge-user" style="font-size:10px;padding:2px 8px;margin-right:4px;">Financeiro</span>' : ''}
          ${u.perm_usuarios ? '<span class="badge badge-admin" style="font-size:10px;padding:2px 8px;background:rgba(255,165,0,0.2);color:orange;border-color:orange;">Usuários</span>' : ''}
          ${!u.perm_agencia && !u.perm_financeiro && !u.perm_usuarios ? '<span style="color:var(--text-sub);">—</span>' : ''}
        </td>
        <td style="color:var(--text);font-size:13px;">
          ${isAdmin && API.getUser().role !== 'admin' ? '<span style="color:var(--text-sub);font-size:11px;">Restrito</span>' : `
          <button class="btn btn-ghost" style="font-size:11px;padding:4px 10px;" onclick="openAccessModal(${u.id})">Ver quadros</button>
          `}
        </td>
        <td>
          <div class="row-actions">
            ${isAdmin && API.getUser().role !== 'admin' ? '' : `
            <button class="action-btn action-btn-edit" title="Editar usuário" onclick="openEditUserModal(${u.id})">
              <span class="material-symbols-outlined" style="font-size:18px;">edit</span>
            </button>
            <button class="action-btn action-btn-del" title="Excluir usuário" onclick="deleteUser(${u.id})">
              <span class="material-symbols-outlined" style="font-size:18px;">delete</span>
            </button>
            `}
          </div>
        </td>
      </tr>
    `;
  }).join('');

  if (countEl) countEl.textContent = `${users.length} usuário${users.length !== 1 ? 's' : ''} cadastrado${users.length !== 1 ? 's' : ''}`;
}

// ── CREATE USER MODAL ──────────────────────────────────
const userModal      = document.getElementById('user-modal');
const createUserForm = document.getElementById('create-user-form');

function openCreateUserModal() {
  userModal.classList.add('active');
  createUserForm.reset();

  const roleSelect = document.getElementById('user-role');
  if (API.getUser().role !== 'admin') {
    roleSelect.value = 'user';
    roleSelect.disabled = true;
  } else {
    roleSelect.disabled = false;
  }

  const listEl = document.getElementById('create-user-boards-list');
  if (!listEl) return;

  if (globalBoards.length === 0) {
    listEl.innerHTML = '<p style="color:var(--text-sub);font-size:13px;padding:8px;">Nenhum quadro global cadastrado.</p>';
  } else {
    listEl.innerHTML = globalBoards.map(b => `
      <label class="toggle-switch">
        <input type="checkbox" name="boardIds" value="${b.id}">
        <div class="toggle-track"><div class="toggle-thumb"></div></div>
        <div style="width:14px;height:14px;background:${b.background};border-radius:3px;flex-shrink:0;"></div>
        ${escapeHtml(b.title)}
      </label>
    `).join('');
  }
}

function closeUserModal() {
  userModal.classList.remove('active');
}

createUserForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const name     = document.getElementById('user-name').value;
  const email    = document.getElementById('user-email').value;
  const password = document.getElementById('user-password').value;
  const role     = document.getElementById('user-role').value;
  const checked  = document.querySelectorAll('#create-user-boards-list input[name="boardIds"]:checked');
  const boardIds = Array.from(checked).map(cb => parseInt(cb.value));
  const perm_agencia = document.getElementById('user-perm-agencia')?.checked || false;
  const perm_financeiro = document.getElementById('user-perm-financeiro')?.checked || false;
  const perm_usuarios = document.getElementById('user-perm-usuarios')?.checked || false;

  try {
    const newUser = await API.post('/admin/users', { name, email, password, role, boardIds, perm_agencia, perm_financeiro, perm_usuarios });
    users.unshift(newUser);
    renderUsers();
    closeUserModal();
    showToast('Usuário criado com sucesso!', 'success');
  } catch (err) {
    showToast(err.message, 'error');
  }
});

// ── EDIT USER MODAL ────────────────────────────────────
const editUserModal = document.getElementById('edit-user-modal');
const editUserForm  = document.getElementById('edit-user-form');

function openEditUserModal(id) {
  const u = users.find(u => u.id === id);
  if (!u) return;

  document.getElementById('edit-user-id').value       = u.id;
  document.getElementById('edit-user-name').value     = u.name;
  document.getElementById('edit-user-email').value    = u.email;
  document.getElementById('edit-user-role').value     = u.role;
  document.getElementById('edit-user-password').value = '';
  
  const roleSelect = document.getElementById('edit-user-role');
  if (API.getUser().role !== 'admin') {
    roleSelect.disabled = true;
  } else {
    roleSelect.disabled = false;
  }

  const permAgEl = document.getElementById('edit-user-perm-agencia');
  const permFinEl = document.getElementById('edit-user-perm-financeiro');
  const permUsrEl = document.getElementById('edit-user-perm-usuarios');
  if (permAgEl) permAgEl.checked = !!u.perm_agencia;
  if (permFinEl) permFinEl.checked = !!u.perm_financeiro;
  if (permUsrEl) permUsrEl.checked = !!u.perm_usuarios;

  editUserModal.classList.add('active');
}

function closeEditUserModal() {
  editUserModal.classList.remove('active');
}

editUserForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const id       = document.getElementById('edit-user-id').value;
  const name     = document.getElementById('edit-user-name').value;
  const email    = document.getElementById('edit-user-email').value;
  const password = document.getElementById('edit-user-password').value;
  const role     = document.getElementById('edit-user-role').value;
  const perm_agencia = document.getElementById('edit-user-perm-agencia')?.checked || false;
  const perm_financeiro = document.getElementById('edit-user-perm-financeiro')?.checked || false;
  const perm_usuarios = document.getElementById('edit-user-perm-usuarios')?.checked || false;

  try {
    const updated = await API.put(`/admin/users/${id}`, { name, email, password, role, perm_agencia, perm_financeiro, perm_usuarios });
    const idx = users.findIndex(u => u.id === parseInt(id));
    if (idx !== -1) users[idx] = { ...users[idx], ...updated };
    renderUsers();
    closeEditUserModal();
    showToast('Usuário atualizado com sucesso!', 'success');
  } catch (err) {
    showToast(err.message, 'error');
  }
});

// ── DELETE USER ────────────────────────────────────────
async function deleteUser(id) {
  if (!confirm('Tem certeza que deseja excluir este usuário permanentemente?')) return;
  try {
    await API.delete(`/admin/users/${id}`);
    users = users.filter(u => u.id !== id);
    renderUsers();
    showToast('Usuário excluído.', 'success');
  } catch (err) {
    showToast(err.message, 'error');
  }
}

// ── ACCESS MODAL ───────────────────────────────────────
const accessModal    = document.getElementById('access-modal');
const accessUserName = document.getElementById('access-user-name');
const boardsAccessList = document.getElementById('boards-access-list');

async function openAccessModal(userId) {
  currentAccessUser = users.find(u => u.id === userId);
  if (!currentAccessUser) return;

  accessUserName.textContent = currentAccessUser.name;
  boardsAccessList.innerHTML = '<p style="color:var(--text-sub);padding:8px;">Carregando...</p>';
  accessModal.classList.add('active');

  try {
    const userBoards = await API.get(`/admin/users/${userId}/boards`);
    if (globalBoards.length === 0) {
      boardsAccessList.innerHTML = '<p style="color:var(--text-sub);">Nenhum quadro global encontrado.</p>';
      return;
    }
    boardsAccessList.innerHTML = globalBoards.map(b => {
      const has = userBoards.includes(b.id);
      return `
        <label class="toggle-switch">
          <input type="checkbox" onchange="toggleAccess(${userId}, ${b.id}, this.checked)" ${has ? 'checked' : ''}>
          <div class="toggle-track"><div class="toggle-thumb"></div></div>
          <div style="width:14px;height:14px;background:${b.background};border-radius:3px;flex-shrink:0;"></div>
          ${escapeHtml(b.title)}
        </label>
      `;
    }).join('');
  } catch (err) {
    boardsAccessList.innerHTML = '<p style="color:var(--danger);">Erro ao carregar permissões.</p>';
  }
}

function closeAccessModal() {
  accessModal.classList.remove('active');
  currentAccessUser = null;
}

async function toggleAccess(userId, boardId, isGranted) {
  try {
    if (isGranted) {
      await API.post(`/admin/users/${userId}/boards`, { board_id: boardId });
    } else {
      await API.delete(`/admin/users/${userId}/boards/${boardId}`);
    }
  } catch (err) {
    showToast('Erro ao atualizar permissão', 'error');
    openAccessModal(userId);
  }
}

function logout() {
  localStorage.removeItem('token');
  localStorage.removeItem('user');
  window.location.href = '/';
}
