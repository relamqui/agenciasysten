// Sidebar Module Component
// Renders a collapsible sidebar with module navigation

function renderSidebar(activePage) {
  const user = getUser ? getUser() : (API && API.getUser ? API.getUser() : null);
  if (!user) return;

  const isAdmin = user.role === 'admin';
  const collapsed = localStorage.getItem('sidebar-collapsed') === 'true';
  const initials = (user.name || '?').split(' ').filter(Boolean).map(w => w[0]).join('').toUpperCase().slice(0, 2);

  const modules = [];

  if (isAdmin || user.perm_agencia) {
    modules.push({
      id: 'agencia',
      label: 'Agência',
      icon: 'business_center',
      href: '/dashboard',
      active: activePage === 'agencia'
    });
  }

  if (isAdmin || user.perm_financeiro) {
    modules.push({
      id: 'financeiro',
      label: 'Financeiro',
      icon: 'payments',
      href: '/financeiro',
      active: activePage === 'financeiro'
    });
  }

  if (isAdmin || user.perm_usuarios) {
    modules.push({
      id: 'admin',
      label: 'Usuários',
      icon: 'group',
      href: '/admin',
      active: activePage === 'admin'
    });
  }

  const navItems = modules.map(m => `
    <a href="${m.href}" class="mod-nav-item${m.active ? ' active' : ''}" title="${m.label}">
      <span class="material-symbols-outlined mod-nav-icon">${m.icon}</span>
      <span class="mod-nav-label">${m.label}</span>
    </a>
  `).join('');

  const sidebarHTML = `
    <aside class="mod-sidebar${collapsed ? ' collapsed' : ''}" id="mod-sidebar">
      <div class="mod-sidebar-header">
        <div class="mod-sidebar-brand">
          <span class="mod-brand-icon">🏢</span>
          <span class="mod-brand-text">AgenciaSysten</span>
        </div>
        <button class="mod-toggle-btn" id="mod-toggle-btn" title="Recolher menu">
          <span class="material-symbols-outlined">menu</span>
        </button>
      </div>

      <nav class="mod-sidebar-nav">
        <div class="mod-nav-section-title">Módulos</div>
        ${navItems}
      </nav>

      <div class="mod-sidebar-footer">
        <div class="mod-user-info">
          <div class="mod-user-avatar" style="background:${user.avatar_color || '#6C5CE7'};">${initials}</div>
          <div class="mod-user-details">
            <div class="mod-user-name">${user.name || 'Usuário'}</div>
            <div class="mod-user-email">${user.email || ''}</div>
          </div>
        </div>
        <button class="mod-logout-btn" id="mod-logout-btn" title="Sair">
          <span class="material-symbols-outlined">logout</span>
          <span class="mod-nav-label">Sair</span>
        </button>
      </div>
    </aside>
  `;

  // Find or create sidebar container
  let container = document.getElementById('sidebar-container');
  if (!container) {
    container = document.createElement('div');
    container.id = 'sidebar-container';
    document.body.insertBefore(container, document.body.firstChild);
  }
  container.innerHTML = sidebarHTML;

  // Apply body class for layout
  document.body.classList.add('has-mod-sidebar');
  if (collapsed) document.body.classList.add('mod-sidebar-collapsed');

  // Toggle handler
  document.getElementById('mod-toggle-btn').addEventListener('click', () => {
    const sidebar = document.getElementById('mod-sidebar');
    const isNowCollapsed = sidebar.classList.toggle('collapsed');
    document.body.classList.toggle('mod-sidebar-collapsed', isNowCollapsed);
    localStorage.setItem('sidebar-collapsed', isNowCollapsed);
  });

  // Logout handler
  document.getElementById('mod-logout-btn').addEventListener('click', () => {
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    window.location.href = '/';
  });
}

// Auto-render if page specifies data-sidebar-page on body or html
document.addEventListener('DOMContentLoaded', () => {
  const page = document.body.dataset.sidebarPage || document.documentElement.dataset.sidebarPage;
  if (page) {
    renderSidebar(page);
  }
});
