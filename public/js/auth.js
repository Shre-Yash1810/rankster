function toggleForms() {
  const signupForm = document.getElementById('signup-form');
  const loginForm = document.getElementById('login-form');

  signupForm.classList.toggle('active');
  loginForm.classList.toggle('active');
}