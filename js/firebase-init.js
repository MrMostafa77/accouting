import { initializeApp } from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-app.js';
import { getAuth, onAuthStateChanged, signInWithEmailAndPassword, signOut } from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-auth.js';
import { getFirestore, doc, getDoc, setDoc } from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js';

// Firebase Web configuration for the Accounting Management System.
// These values identify the web app; they are not a service-account private key.
const firebaseConfig = {
  apiKey: 'AIzaSyByOjJ6FVqNJBydEhRd2Zv3prYaSchwL_w',
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

window.FB = { app, auth, firestore, doc, getDoc, setDoc };

function ensureLoginUI(){
  if(document.getElementById('firebaseLogin')) return;
  const box=document.createElement('div');
  box.id='firebaseLogin';
  box.innerHTML=`
    <div class="firebase-login-card">
      <div class="firebase-login-mark">FJ</div>
      <div class="firebase-login-kicker">Fakher Aljazeera Security Guards</div>
      <h2>نظام الإدارة والمحاسبة</h2>
      <p>تسجيل الدخول للوصول إلى النظام</p>
      <form id="firebaseLoginForm" autocomplete="on">
        <label>اسم المستخدم (البريد الإلكتروني)<input id="firebaseEmail" type="email" autocomplete="username" required placeholder="example@email.com"></label>
        <label>كلمة المرور<input id="firebasePassword" type="password" autocomplete="current-password" required placeholder="كلمة المرور"></label>
        <button class="gold-btn firebase-login-btn" type="submit">دخول</button>
        <div id="firebaseLoginError" class="firebase-login-error" role="alert"></div>
      </form>
    </div>`;
  document.body.appendChild(box);
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
