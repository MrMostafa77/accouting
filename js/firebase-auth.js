// Firebase Authentication gate for the Accounting Management System.
// Uses Firebase's browser-compatible CDN SDK; no npm/build step is required.
const firebaseConfig = {
  apiKey: "AIzaSyBy0jJ6FVqNJBvdEhRd2Zv3prYaSchwI_w",
  authDomain: "mostafa-s-myth.firebaseapp.com",
  projectId: "mostafa-s-myth",
  storageBucket: "mostafa-s-myth.firebasestorage.app",
  messagingSenderId: "131956634248",
  appId: "1:131956634248:web:7dcae2a4e72b5caeedb8bd",
  measurementId: "G-D44B5N4WZW"
};

firebase.initializeApp(firebaseConfig);
const auth = firebase.auth();

const appShell = document.querySelector('.app');
const loginGate = document.getElementById('loginGate');
const loginForm = document.getElementById('loginForm');
const loginEmail = document.getElementById('loginEmail');
const loginPassword = document.getElementById('loginPassword');
const loginError = document.getElementById('loginError');
const loginBtn = document.getElementById('loginBtn');
const logoutBtn = document.getElementById('logoutBtn');
const userBadge = document.getElementById('userBadge');

function setError(message) {
  loginError.textContent = message || '';
  loginError.hidden = !message;
}

function showSystem(user) {
  if (appShell) appShell.style.display = '';
  if (loginGate) loginGate.style.display = 'none';
  if (userBadge) userBadge.textContent = user.email || '';
}

function showLogin() {
  if (appShell) appShell.style.display = 'none';
  if (loginGate) loginGate.style.display = 'flex';
  if (loginEmail) loginEmail.focus();
}

loginForm?.addEventListener('submit', async (event) => {
  event.preventDefault();
  setError('');
  loginBtn.disabled = true;
  loginBtn.textContent = 'جاري الدخول...';
  try {
    await auth.signInWithEmailAndPassword(loginEmail.value.trim(), loginPassword.value);
  } catch (error) {
    const messages = {
      'auth/invalid-credential': 'البريد الإلكتروني أو كلمة المرور غير صحيحة.',
      'auth/invalid-email': 'صيغة البريد الإلكتروني غير صحيحة.',
      'auth/user-disabled': 'هذا الحساب معطّل.',
      'auth/too-many-requests': 'تمت محاولات كثيرة. حاول مرة أخرى لاحقاً.'
    };
    setError(messages[error.code] || 'تعذر تسجيل الدخول. تحقق من بيانات الحساب وإعدادات Firebase.');
  } finally {
    loginBtn.disabled = false;
    loginBtn.textContent = 'دخول';
  }
});

logoutBtn?.addEventListener('click', async () => {
  await auth.signOut();
});

auth.onAuthStateChanged((user) => {
  if (user) showSystem(user);
  else showLogin();
});
