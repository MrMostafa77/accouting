import { initializeApp } from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-app.js';
import { getAuth, onAuthStateChanged, signInWithEmailAndPassword, signInWithPopup, GoogleAuthProvider, signOut } from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-auth.js';
import { getFirestore, doc, getDoc, setDoc, onSnapshot } from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js';

// Firebase Web configuration for the Accounting Management System.
// These values identify the web app; they are not a service-account private key.
const firebaseConfig = {
  apiKey: 'AIzaSyByOjJ6FVqNJBvdEhRd2Zv3prYaSchwL_w',
  authDomain: 'mostafa-s-myth.firebaseapp.com',
  projectId: 'mostafa-s-myth',
  storageBucket: 'mostafa-s-myth.firebasestorage.app',
  messagingSenderId: '131950634248',
  appId: '1:131950634248:web:7dcae2a4e72b5caeedb8bd',
  measurementId: 'G-D44B5N4WZW'
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const firestore = getFirestore(app);

window.FB = { app, auth, firestore, doc, getDoc, setDoc, onSnapshot };

function ensureLoginUI(){
  if(document.getElementById('firebaseLogin')) return;
  const box=document.createElement('div');
  box.id='firebaseLogin';
  box.innerHTML=`
    <img id="firebaseLoginBackground" src="assets/login-backgrounds/illuminated-3840x2160-18078.jpg" alt="" aria-hidden="true">
    <div class="firebase-login-card" dir="ltr">
      <div class="firebase-login-mark" aria-hidden="true">
        <svg viewBox="0 0 64 64" role="img">
          <rect x="13" y="7" width="38" height="50" rx="6" fill="none" stroke="currentColor" stroke-width="4"/>
          <rect x="19" y="13" width="26" height="11" rx="2.5" fill="currentColor" opacity=".22"/>
          <path d="M21 33h4m7 0h4m7 0h0M21 42h4m7 0h4m7 0h0M21 51h4m7 0h4m7 0h0" stroke="currentColor" stroke-width="4" stroke-linecap="round"/>
        </svg>
      </div>
      <h2>MOSTAFA'S <span>MYTH</span></h2>
      <form id="firebaseLoginForm" autocomplete="on">
        <label class="firebase-field">
          <span class="field-icon" aria-hidden="true">
            <svg viewBox="0 0 24 24"><path d="M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm-7 8a7 7 0 0 1 14 0"/></svg>
          </span>
          <input id="firebaseEmail" type="email" autocomplete="username" required placeholder="Username">
        </label>
        <label class="firebase-field">
          <span class="field-icon" aria-hidden="true">
            <svg viewBox="0 0 24 24"><rect x="5" y="10" width="14" height="10" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/></svg>
          </span>
          <input id="firebasePassword" type="password" autocomplete="current-password" required placeholder="Password">
          <button type="button" class="firebase-password-toggle" id="firebasePasswordToggle" aria-label="Show password">
            <svg viewBox="0 0 24 24"><path d="M2.5 12s3.5-6 9.5-6 9.5 6 9.5 6-3.5 6-9.5 6-9.5-6-9.5-6Z"/><circle cx="12" cy="12" r="2.5"/></svg>
          </button>
        </label>
        <button class="firebase-login-btn" type="submit">
          <svg viewBox="0 0 64 64" aria-hidden="true">
            <rect x="13" y="7" width="38" height="50" rx="6" fill="none" stroke="currentColor" stroke-width="4"/>
            <rect x="19" y="13" width="26" height="11" rx="2.5" fill="currentColor" opacity=".22"/>
            <path d="M21 33h4m7 0h4m7 0h0M21 42h4m7 0h4m7 0h0M21 51h4m7 0h4m7 0h0" stroke="currentColor" stroke-width="4" stroke-linecap="round"/>
          </svg>
          <span>Sign In</span>
        </button>
        <div class="firebase-or"><span>or</span></div>
        <button type="button" class="firebase-google-btn" id="firebaseGoogleBtn">
          <span class="google-g" aria-hidden="true">G</span><span>Continue with Google</span>
        </button>
        <div id="firebaseLoginError" class="firebase-login-error" role="alert"></div>
      </form>
      <div class="firebase-signup">Don't have an account? <span>Sign Up</span></div>
      <div class="firebase-socials" aria-label="Contact links">
        <a class="firebase-social" href="#" aria-label="Facebook">f</a>
        <a class="firebase-social" href="#" aria-label="WhatsApp">⌕</a>
        <a class="firebase-social" href="#" aria-label="Instagram">◎</a>
      </div>
      <a class="firebase-phone" href="tel:+966537013542" aria-label="Call +966 537013542">☎ <span>+966 537013542</span></a>
    </div>`;

  const passwordToggle=document.getElementById('firebasePasswordToggle');
  const passwordInput=document.getElementById('firebasePassword');
  passwordToggle?.addEventListener('click',()=>{
    const visible=passwordInput.type==='text';
    passwordInput.type=visible?'password':'text';
    passwordToggle.setAttribute('aria-label',visible?'Show password':'Hide password');
  });

  document.getElementById('firebaseGoogleBtn')?.addEventListener('click',async()=>{
    const err=document.getElementById('firebaseLoginError');
    const btn=document.getElementById('firebaseGoogleBtn');
    err.textContent=''; btn.disabled=true;
    try{ await signInWithPopup(auth,new GoogleAuthProvider()); }
    catch(ex){
      const map={
        'auth/popup-closed-by-user':'Google sign-in was cancelled.',
        'auth/popup-blocked':'Your browser blocked the Google sign-in window.',
        'auth/operation-not-allowed':'Google sign-in is not enabled in Firebase Console.',
        'auth/unauthorized-domain':'This domain is not authorized in Firebase Authentication.'
      };
      console.error('Firebase Google sign-in failed:', ex?.code, ex?.message, ex);
      err.textContent=(map[ex?.code]||'Google sign-in could not be completed.')+' ['+(ex?.code||'no-code')+']';
      btn.disabled=false;
    }
  });
  document.body.appendChild(box);

  // Login background slideshow: changes instantly every 10 seconds, with no transition/fade.
  const loginBackground=document.getElementById('firebaseLoginBackground');
  const loginBackgrounds=[
    'assets/login-backgrounds/illuminated-3840x2160-18078.jpg',
    'assets/login-backgrounds/full-moon-forest-night-dark-starry-sky-5k-8k-3840x2160-1684.jpg',
    'assets/login-backgrounds/snowy-mountains-3840x2160-26363.jpg',
    'assets/login-backgrounds/macos-monterey-stock-black-dark-mode-layers-5k-3840x2160-5889.jpg',
    'assets/login-backgrounds/mountain-landscape-3840x2160-24317.jpg',
    'assets/login-backgrounds/windows-xp-3840x2160-17062.jpg',
    'assets/login-backgrounds/microsoft-surface-3840x2160-26627.png'
  ];
  if(loginBackground && !window.__loginBackgroundSlideshowStarted){
    window.__loginBackgroundSlideshowStarted=true;
    let loginBackgroundIndex=0;
    window.setInterval(()=>{
      loginBackgroundIndex=(loginBackgroundIndex+1)%loginBackgrounds.length;
      loginBackground.src=loginBackgrounds[loginBackgroundIndex];
    },10000);
  }

  const form=document.getElementById('firebaseLoginForm');
  form.addEventListener('submit', async e=>{
    e.preventDefault();
    const email=document.getElementById('firebaseEmail').value.trim();
    const password=document.getElementById('firebasePassword').value;
    const err=document.getElementById('firebaseLoginError');
    const btn=form.querySelector('button[type=submit]');
    err.textContent=''; btn.disabled=true; btn.textContent='جارٍ الدخول...';
    try{ await signInWithEmailAndPassword(auth,email,password); }
    catch(ex){
      const map={
        'auth/invalid-credential':'بيانات الدخول غير صحيحة.',
        'auth/invalid-email':'صيغة البريد الإلكتروني غير صحيحة.',
        'auth/too-many-requests':'تمت محاولات كثيرة. حاول مرة أخرى لاحقاً.',
        'auth/network-request-failed':'تعذر الاتصال بالإنترنت.',
        'auth/user-disabled':'هذا الحساب معطّل من Firebase.',
        'auth/user-not-found':'المستخدم غير موجود في Firebase Authentication.',
        'auth/wrong-password':'كلمة المرور غير صحيحة.',
        'auth/operation-not-allowed':'تسجيل الدخول بالبريد وكلمة المرور غير مفعّل في Firebase Console (Sign-in method).',
        'auth/unauthorized-domain':'هذا الدومين غير مضاف في Authentication > Settings > Authorized domains.',
        'auth/api-key-not-valid.-please-pass-a-valid-api-key.':'مفتاح API غير صالح.',
        'auth/invalid-api-key':'مفتاح API غير صالح.'
      };
      console.error('Firebase sign-in failed:', ex?.code, ex?.message, ex);
      err.textContent=(map[ex?.code]||'تعذر تسجيل الدخول.')+' ['+(ex?.code||'no-code')+']';
      btn.disabled=false; btn.textContent='دخول';
    }
  });
}

function showLogin(){
  ensureLoginUI();
  document.body.classList.add('firebase-locked');
  document.getElementById('firebaseLogin').classList.add('show');
}
function showApp(user){
  ensureLoginUI();
  document.body.classList.remove('firebase-locked');
  document.getElementById('firebaseLogin').classList.remove('show');
  const label=document.getElementById('firebaseUserEmail');
  if(label){ label.textContent=user?.email||''; label.title=user?.email||''; }
  const logout=document.getElementById('firebaseLogoutBtn');
  if(logout && !logout.dataset.bound){
    logout.dataset.bound='1';
    logout.addEventListener('click', async (event)=>{
      event.preventDefault();
      event.stopPropagation();
      logout.disabled=true;
      logout.textContent='جارٍ الخروج...';
      try{
        await signOut(auth);
        window.location.reload();
      }catch(err){
        console.error('Firebase sign-out failed:', err);
        logout.disabled=false;
        logout.textContent='خروج';
        alert('تعذر تسجيل الخروج. تأكد من اتصال الإنترنت ثم حاول مرة أخرى.');
      }
    });
  }
}

window.firebaseSignOut=async()=>{
  try{
    await signOut(auth);
    window.location.reload();
  }catch(err){
    console.error('Firebase sign-out failed:', err);
    alert('تعذر تسجيل الخروج. تأكد من اتصال الإنترنت ثم حاول مرة أخرى.');
  }
};

window.firebaseUserReady = new Promise(resolve=>{
  let resolved=false;
  onAuthStateChanged(auth,user=>{
    if(user){
      showApp(user);
      if(!resolved){ resolved=true; resolve(user); }
    }else{
      showLogin();
    }
  });
});

if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',ensureLoginUI,{once:true});
else ensureLoginUI();
