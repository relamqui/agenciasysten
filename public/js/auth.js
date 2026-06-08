// Auth Page Logic
document.addEventListener('DOMContentLoaded', () => {
  // If already logged in, redirect
  if (localStorage.getItem('token')) {
    window.location.href = '/dashboard.html';
    return;
  }

  // Tab switching
  const loginForm = document.getElementById('login-form');
  const errorBox = document.getElementById('error-box');

  function showError(msg) {
    errorBox.textContent = msg;
    errorBox.classList.add('show');
  }

  // Login
  loginForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = document.getElementById('login-email').value;
    const password = document.getElementById('login-password').value;
    const btn = document.getElementById('login-btn');
    
    btn.textContent = 'Entrando...';
    btn.disabled = true;

    try {
      const data = await API.post('/auth/login', { email, password });
      localStorage.setItem('token', data.token);
      localStorage.setItem('user', JSON.stringify(data.user));
      window.location.href = '/dashboard.html';
    } catch (err) {
      showError(err.message);
      btn.textContent = 'Entrar';
      btn.disabled = false;
    }
  });


});
