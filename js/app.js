
(async()=> {
const firebaseUser=await window.firebaseUserReady;
const FB=window.FB;
const INIT=window.INITIAL_DATA||{accounts:[],journal:[]};
const KEY="mostafa-accounting-erp-v1";
// Load the last saved database first. Previously the app always rebuilt `db` from
// INITIAL_DATA on startup, so changes were saved to localStorage but ignored
// when the browser was reopened.
function loadSavedDB(){
  try{
    const raw=localStorage.getItem(KEY);
    if(!raw) return null;
    const saved=JSON.parse(raw);
    if(!saved || !Array.isArray(saved.accounts) || !Array.isArray(saved.journal)) return null;
    return saved;
  }catch(err){
    console.warn("Could not load saved accounting data:",err);
    return null;
  }
}
const SAVED=loadSavedDB();
let db={
  accounts:(SAVED?.accounts||INIT.accounts).map(x=>({...x})),
  journal:(SAVED?.journal||INIT.journal).map(x=>({...x})),
  customers:Array.isArray(SAVED?.customers)?SAVED.customers.map(x=>({...x})):[],
  salesOrders:Array.isArray(SAVED?.salesOrders)?SAVED.salesOrders.map(x=>({...x})):[],
  invoices:Array.isArray(SAVED?.invoices)?SAVED.invoices.map(x=>({...x})):[],
  collections:Array.isArray(SAVED?.collections)?SAVED.collections.map(x=>({...x})):[],
  lang:SAVED?.lang||localStorage.getItem("ma-lang")||"ar",
  theme:SAVED?.theme||localStorage.getItem("ma-theme")||"dark"
};

// Firestore is the authoritative store for accounting data. localStorage is kept only
// as a short-lived cache/fallback while the cloud document is being loaded.
const CLOUD_DOC=FB.doc(FB.firestore,'accountingData','main');
let cloudStamp=null, conflictLocked=false, saveChain=Promise.resolve();
async function hydrateFromFirestore(){
  try{
    const snap=await FB.getDoc(CLOUD_DOC);
    if(snap.exists()){
      const cloud=snap.data();
      db.accounts=Array.isArray(cloud.accounts)?cloud.accounts.map(x=>({...x})):[];
      db.journal=Array.isArray(cloud.journal)?cloud.journal.map(x=>({...x})):[];
      db.customers=Array.isArray(cloud.customers)?cloud.customers.map(x=>({...x})):[];
      db.salesOrders=Array.isArray(cloud.salesOrders)?cloud.salesOrders.map(x=>({...x})):[];
      db.invoices=Array.isArray(cloud.invoices)?cloud.invoices.map(x=>({...x})):[];
      db.collections=Array.isArray(cloud.collections)?cloud.collections.map(x=>({...x})):[];
      cloudStamp=cloud.updatedAt||null;
      window.__adminCloudSeed=cloud.adminAffairs||null;
      return true;
    }
    const seed={accounts:db.accounts,journal:db.journal,customers:db.customers,salesOrders:db.salesOrders,invoices:db.invoices,collections:db.collections,adminAffairs:window.__adminCloudSeed||null,createdBy:firebaseUser.uid,createdAt:new Date().toISOString()};
    seed.updatedAt=seed.createdAt;
    await FB.setDoc(CLOUD_DOC,seed); cloudStamp=seed.updatedAt;
    return true;
  }catch(err){
    console.error('Firestore load failed:',err);
    document.body.classList.add('firebase-data-error');
    const box=document.createElement('div');
    box.className='firebase-data-error-box';
    box.innerHTML='<b>تعذر تحميل قاعدة البيانات السحابية</b><span>لم يتم فتح البيانات المحاسبية المحلية. افتح Firestore وتأكد من إنشاء قاعدة البيانات ونشر قواعد الأمان ثم أعد المحاولة.</span><button class="gold-btn" onclick="location.reload()">إعادة المحاولة</button>';
    document.body.appendChild(box);
    throw err;
  }
}
await hydrateFromFirestore();
// Normalize the establishment-expenses branch to the same 1/2/3/5/7 digit hierarchy.
(function normalizeEstablishmentExpenses(){
 const map=new Map([[5351,53501]]);
 for(let i=1;i<=12;i++) map.set(5351000+i,5350100+i);
 db.accounts.forEach(a=>{const n=Number(a.code); if(map.has(n)) a.code=map.get(n); if(n===53501) a.level="الرابع";});
 db.journal.forEach(x=>{const n=Number(x.code); if(map.has(n)) x.code=map.get(n); if(map.has(Number(x.code))) x.code=map.get(Number(x.code));});
})();
db.customers=db.customers||[];db.salesOrders=db.salesOrders||[];db.invoices=db.invoices||[];db.collections=db.collections||[];
// Real-time Firestore synchronization. The listener is the source of truth for every
// connected browser: add/edit/delete operations saved by one user are applied to all
// other users immediately, without a refresh.
if(!window.__realtimeSyncStarted){
  window.__realtimeSyncStarted=true;
  window.__realtimeUnsubscribe=FB.onSnapshot(CLOUD_DOC,{includeMetadataChanges:false},(snap)=>{
    if(!snap.exists()) return;
    const cloud=snap.data()||{};
    const incomingStamp=cloud.updatedAt||null;
    // Ignore only our own already-applied write. Every different cloud version is
    // applied, including deletes (empty arrays are valid and must propagate).
    if(incomingStamp && incomingStamp===cloudStamp) return;
    db.accounts=Array.isArray(cloud.accounts)?cloud.accounts.map(x=>({...x})):[];
    db.journal=Array.isArray(cloud.journal)?cloud.journal.map(x=>({...x})):[];
    db.customers=Array.isArray(cloud.customers)?cloud.customers.map(x=>({...x})):[];
    db.salesOrders=Array.isArray(cloud.salesOrders)?cloud.salesOrders.map(x=>({...x})):[];
    db.invoices=Array.isArray(cloud.invoices)?cloud.invoices.map(x=>({...x})):[];
    db.collections=Array.isArray(cloud.collections)?cloud.collections.map(x=>({...x})):[];
    cloudStamp=incomingStamp;
    try{localStorage.setItem(KEY,JSON.stringify(db));}catch(e){}
    if(cloud.adminAffairs) window.__adminApplyCloud?.(cloud.adminAffairs);
    if(typeof window.refreshRealtimeUI==='function') window.refreshRealtimeUI();
  },(err)=>{
    console.error('Firestore realtime listener failed:',err);
    window.__realtimeSyncError=err;
  });
}
let currentCustomerTab="customers";
let expanded=new Set(), selected=null, currentView="home", journalEditId=null, currentJournalEntry=null;
const $=s=>document.querySelector(s), $$=s=>[...document.querySelectorAll(s)];
const esc=s=>String(s??"").replace(/[&<>"']/g,m=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[m]));
const fmt=n=>Number(n||0).toLocaleString("en-US",{minimumFractionDigits:2,maximumFractionDigits:2});
const arEn=(ar,en)=>db.lang==="ar"?ar:en;
const r2=n=>Math.round((Number(n||0)+Number.EPSILON)*100)/100;

function installFirebaseUserBar(){
  const bar=document.getElementById('firebaseUserBar');
  const btn=document.getElementById('firebaseLogoutBtn');
  const el=document.getElementById('firebaseUserEmail');
  if(el) el.textContent=firebaseUser.email||'';
  if(!bar){
    const side=document.querySelector('.side-bottom');
    if(!side) return;
    const wrap=document.createElement('div'); wrap.className='firebase-user-bar'; wrap.id='firebaseUserBar';
    wrap.innerHTML='<span id="firebaseUserEmail"></span><button id="firebaseLogoutBtn" class="soft-btn" type="button">خروج</button>';
    side.parentNode.insertBefore(wrap,side);
    wrap.querySelector('#firebaseUserEmail').textContent=firebaseUser.email||'';
  }
}
installFirebaseUserBar();
function showConflict(){
 conflictLocked=true;
 const m=$("#modal"); if(!m) return;
 m.innerHTML=`<h3>${arEn("تم تعديل البيانات من مكان آخر","Data was changed elsewhere")}</h3><p style="line-height:1.9">${arEn("قام مستخدم أو جهاز آخر بحفظ تعديلات بعد فتحك للصفحة. لم يتم حفظ تعديلك الأخير حتى لا تُمسح تعديلات الآخر. أعد تحميل الصفحة ثم كرّر التعديل.","Another user/device saved changes after you opened this page. Your last edit was NOT saved so theirs isn't overwritten. Reload the page, then repeat the edit.")}</p><div class="modal-foot"><button class="gold-btn" onclick="location.reload()">${arEn("إعادة تحميل الصفحة","Reload page")}</button></div>`;
 $("#modalBack").classList.add("show");
}
function save(){
  try{localStorage.setItem(KEY,JSON.stringify(db));}catch(err){console.warn('Local cache unavailable',err);}
  const payload={accounts:db.accounts,journal:db.journal,customers:db.customers||[],salesOrders:db.salesOrders||[],invoices:db.invoices||[],collections:db.collections||[],adminAffairs:(typeof window.__adminGetState==='function'?window.__adminGetState():window.__adminCloudSeed||null),updatedBy:firebaseUser.uid,updatedAt:new Date().toISOString()};
  // A single Firestore document is capped at 1 MiB — warn early, refuse before a silent failure.
  const bytes=new TextEncoder().encode(JSON.stringify(payload)).length;
  if(bytes>1000000){toast(arEn("حجم البيانات وصل حد قاعدة البيانات (1 ميجا). لم يتم الحفظ — خذ نسخة احتياطية وتواصل لتقسيم البيانات.","Data reached the database size limit (1 MB). Not saved — take a backup and split the data."));return false;}
  if(bytes>700000&&!window.__sizeWarned){window.__sizeWarned=true;setTimeout(()=>toast(arEn("تنبيه: حجم البيانات تجاوز 70% من حد قاعدة البيانات. خذ نسخة احتياطية وخطّط لتقسيم البيانات.","Notice: data is over 70% of the database size limit. Take a backup and plan to split the data.")),2500);}
  if(conflictLocked){showConflict();return false;}
  saveChain=saveChain.then(async()=>{
    const snap=await FB.getDoc(CLOUD_DOC);
    if(snap.exists()&&cloudStamp&&snap.data().updatedAt&&snap.data().updatedAt!==cloudStamp){showConflict();return;}
    await FB.setDoc(CLOUD_DOC,payload); cloudStamp=payload.updatedAt;
    toast(arEn('تم حفظ البيانات في قاعدة البيانات السحابية','Data saved to cloud database'));
  }).catch(err=>{console.error('Firestore save failed:',err);toast(arEn('فشل حفظ البيانات سحابياً — لم يتم اعتماد التعديل','Cloud save failed — change was not committed'));});
  return true;
}
window.saveCloud=save;
function toast(m){$("#toast").textContent=m;$("#toast").classList.add("show");clearTimeout(window.__tt);window.__tt=setTimeout(()=>$("#toast").classList.remove("show"),2300)}
function applyLang(){
 document.documentElement.lang=db.lang;document.documentElement.dir=db.lang==="ar"?"rtl":"ltr";
 $$("[data-ar]").forEach(e=>e.textContent=db.lang==="ar"?e.dataset.ar:e.dataset.en);
 $$("[data-ph-ar]").forEach(e=>e.placeholder=db.lang==="ar"?e.dataset.phAr:e.dataset.phEn);
 $("#langBtn").textContent=db.lang==="ar"?"EN":"AR";
}
function openView(v){
 currentView=v;$$(".view").forEach(x=>x.classList.toggle("active",x.id===v));$$(".nav").forEach(x=>x.classList.toggle("active",x.dataset.view===v));
 const financialViews=["tree","journal","ledger","trial","statements","reports"];
 if(financialViews.includes(v)){
   const parent=$("#financialAffairsNav"); if(parent)parent.classList.add("active");
   const sub=$("#financialAffairsSubnav"); if(sub){sub.classList.add("show");sub.setAttribute("aria-hidden","false");}
 } else if(v!=="home") { window.toggleFinancialSub?.(false); }
 $("#title").textContent={home:arEn("لوحة التحكم","Dashboard"),tree:arEn("شجرة الحسابات","Chart of Accounts"),journal:arEn("قيود اليومية","Journal Entries"),ledger:arEn("الأستاذ العام","General Ledger"),trial:arEn("ميزان المراجعة","Trial Balance"),statements:arEn("القوائم المالية","Financial Statements"),reports:arEn("التقارير المالية","Financial Reports"),customers:arEn("العملاء والمبيعات","Customers & Sales"),adminAffairs:arEn("الشئون الإدارية","Administrative Affairs"),adminDocs:arEn("النماذج الإدارية","Administrative Forms"),invoicePage:arEn("فاتورة ضريبية","Tax Invoice")}[v];
 if(v==="home")renderHome(); if(v==="tree")renderTree(); if(v==="journal")renderJournal(); if(v==="ledger")renderLedger(); if(v==="trial")renderTrial(); if(v==="statements")renderStatements(); if(v==="reports")renderReports(); if(v==="customers")renderCustomers(); if(v==="adminAffairs")window.renderAdminAffairs?.();
}
window.openView=openView;window.arEn=arEn;window.applyLang=applyLang;window.showToast=m=>toast(m);
window.refreshRealtimeUI=()=>{
  try{fillAccountSelects();}catch(e){}
  try{if(currentView==='home')renderHome(); else if(currentView==='tree')renderTree(); else if(currentView==='journal')renderJournal(); else if(currentView==='ledger')renderLedger(); else if(currentView==='trial')renderTrial(); else if(currentView==='statements')renderStatements(); else if(currentView==='reports')renderReports(); else if(currentView==='customers')renderCustomers(); else if(currentView==='adminAffairs')window.renderAdminAffairs?.();}catch(e){console.warn('Realtime UI refresh failed',e)}
};
function accountMap(){return new Map(db.accounts.map(a=>[String(a.code),a]))}
function parentCode(code){
 const s=String(code);
 const lengths=[1,2,3,5,7]; let idx=lengths.findIndex(x=>x===s.length);
 if(idx<=0)return null; return s.slice(0,lengths[idx-1]);
}
function childrenOf(code){return db.accounts.filter(a=>String(parentCode(a.code))===String(code)).sort((a,b)=>Number(a.code)-Number(b.code))}
function isLeaf(a){return !db.accounts.some(x=>String(parentCode(x.code))===String(a.code))}
function nextCodeForParent(parent){
 const p=parent==null?"":String(parent.code);
 const targetLengths={0:1,1:2,2:3,3:5,5:7};
 const totalLength=targetLengths[p.length];
 if(!totalLength) return null;
 const suffixLength=totalLength-p.length;
 // parentCode() returns null (not "") for top-level, 1-digit accounts, so compare against
 // that null-safe form — otherwise root-level siblings never match and the code generator
 // always proposes "1", which already exists, permanently blocking new root accounts.
 const siblings=db.accounts.filter(a=>{const c=String(a.code); return c.length===totalLength && (parentCode(c)??"")===p;});
 let n=1; const used=new Set(siblings.map(a=>Number(String(a.code).slice(p.length))));
 while(used.has(n)) n++;
 if(String(n).length>suffixLength) return null; // no free code left at this level
 return p + String(n).padStart(suffixLength,"0");
}
function childLevel(parent){
 const levels={"الأول":"الثاني","الثاني":"الثالث","الثالث":"الرابع","الرابع":"الخامس"};
 return levels[parent?.level]||"الخامس";
}
function renderHome(){
 const totalD=db.journal.reduce((s,x)=>s+Number(x.debit||0),0), totalC=db.journal.reduce((s,x)=>s+Number(x.credit||0),0);
 const entries=new Set(db.journal.map(x=>x.entry)).size;
 $("#stats").innerHTML=[
  [arEn("عدد الحسابات","Accounts"),db.accounts.length,arEn("من الشجرة","From chart")],
  [arEn("عدد القيود","Journal entries"),entries,arEn("قيد مسجل","Recorded entries")],
  [arEn("إجمالي المدين","Total debit"),fmt(totalD),arEn("ريال","SAR")],
  [arEn("إجمالي الدائن","Total credit"),fmt(totalC),arEn("ريال","SAR")],
  [arEn("النقد والبنوك","Cash & banks"),fmt(sumPrefix("121")),arEn("ريال","SAR")],
  [arEn("أرصدة العملاء","Receivables"),fmt(sumPrefix("124")),arEn("ريال","SAR")],
  [arEn("صافي ضريبة القيمة المضافة","Net VAT"),fmt(-sumPrefix("22202")-sumPrefix("12301")),arEn((-sumPrefix("22202")-sumPrefix("12301"))>=0?"مستحقة السداد":"قابلة للاسترداد",(-sumPrefix("22202")-sumPrefix("12301"))>=0?"Payable":"Refundable")],
  [arEn("نتيجة الأعمال حتى الآن","Net result to date"),fmt(-sumPrefix("4")-sumPrefix("5")),arEn((-sumPrefix("4")-sumPrefix("5"))>=0?"ربح":"خسارة",(-sumPrefix("4")-sumPrefix("5"))>=0?"Profit":"Loss"),(-sumPrefix("4")-sumPrefix("5"))<0?"neg":""]
 ].map(x=>`<div class="stat ${x[3]||""}"><span>${x[0]}</span><strong>${x[1]}</strong><em>${x[2]}</em></div>`).join("");
 const recent=[...db.journal].sort((a,b)=>String(b.date).localeCompare(String(a.date))||Number(b.entry)-Number(a.entry)).slice(0,8);
 $("#recent").innerHTML=recent.map(x=>`<div class="entry-row"><b class="num">${x.entry}</b><span class="muted">${esc(x.date)}</span><span>${esc(x.a5||x.search||x.code)}</span><span class="muted">${esc(x.desc)}</span><span>${esc(x.invoice||"—")}</span><span class="debit num">${x.debit?fmt(x.debit):"—"}</span><span class="credit num">${x.credit?fmt(x.credit):"—"}</span><span></span></div>`).join("");
 const roots=db.accounts.filter(a=>!parentCode(a.code)).sort((a,b)=>Number(a.code)-Number(b.code));
 $("#miniTree").innerHTML=roots.slice(0,8).map(a=>`<div class="node-line"><span class="twisty">⌄</span><span class="node-code">${a.code}</span><span class="node-name">${esc(a.name)}</span></div>`).join("");
}
function renderTree(){
 const q=($("#treeSearch")?.value||"").trim().toLowerCase();
 const roots=db.accounts.filter(a=>!parentCode(a.code)).sort((a,b)=>Number(a.code)-Number(b.code));
 $("#treeRoot").innerHTML=roots.map(a=>treeNode(a,q)).join("")||`<div class="empty"><div>⌕</div><b>${arEn("لا توجد نتائج","No results")}</b></div>`;
}
function treeNode(a,q){
 const kids=childrenOf(a.code), matches=!q||String(a.code).includes(q)||a.name.toLowerCase().includes(q)||String(a.statement).toLowerCase().includes(q);
 const descendantMatch=kids.some(k=>String(k.code).includes(q)||k.name.toLowerCase().includes(q)||childrenOf(k.code).length&&hasDesc(k,q));
 if(q&&!matches&&!descendantMatch)return "";
 const open=q||expanded.has(String(a.code));
 return `<div class="tree-node"><div class="node-line" data-code="${a.code}" title="${arEn("كليك يمين لإضافة حساب فرعي","Right-click to add a sub-account")}">
 <span class="twisty">${kids.length?(open?"⌄":"›"):"•"}</span><span class="node-code">${a.code}</span><span class="node-name">${esc(a.name)}</span><span class="node-type">${esc(a.type)}</span>
 </div>${kids.length&&open?`<div class="children">${kids.map(k=>treeNode(k,q)).join("")}</div>`:""}</div>`;
}
function hasDesc(a,q){return childrenOf(a.code).some(x=>String(x.code).includes(q)||x.name.toLowerCase().includes(q)||hasDesc(x,q))}
function showAccount(code){
 selected=db.accounts.find(a=>String(a.code)===String(code)); if(!selected)return;
 const a=selected;const mov=db.journal.filter(x=>Number(x.code)===Number(a.code));
 const d=mov.reduce((s,x)=>s+x.debit,0),c=mov.reduce((s,x)=>s+x.credit,0);
 $("#accountInfo").innerHTML=`<div class="info-code">${a.code}</div><div class="info-title">${esc(a.name)}</div>
 <div class="info-grid">${[
 [arEn("طبيعة الحساب","Nature"),a.nature],[arEn("القائمة","Statement"),a.statement],[arEn("المستوى","Level"),a.level],[arEn("نوع الحساب","Type"),a.type],
 [arEn("الحركة المدينة","Debit movement"),fmt(d)],[arEn("الحركة الدائنة","Credit movement"),fmt(c)]
 ].map(x=>`<div class="info-cell"><small>${x[0]}</small><b>${esc(x[1])}</b></div>`).join("")}</div>
 <div class="info-actions"><button class="gold-btn" onclick="openAccountModal(${a.code})">✎ ${arEn("تعديل","Edit")}</button><button class="soft-btn danger" onclick="deleteAccount(${a.code})">⌫ ${arEn("حذف","Delete")}</button></div>`;
}
// showAccount is invoked from inline onclick="" handlers in generated HTML (journal rows, tree
// context menu, etc.), which run in the global scope — it must be exposed on window or every
// such click throws "showAccount is not defined" and silently does nothing.
window.showAccount=showAccount;
window.deleteAccount=code=>{
 const a=db.accounts.find(x=>String(x.code)===String(code));if(!a)return;
 if(!isLeaf(a)){toast(arEn("لا يمكن حذف حساب رئيسي له حسابات فرعية","Cannot delete a parent account with children"));return}
 if(db.journal.some(x=>Number(x.code)===Number(code))){toast(arEn("لا يمكن حذف حساب مستخدم في قيود","Account is used in journal entries"));return}
 if(!confirm(arEn("حذف الحساب؟","Delete account?")))return;
 db.accounts=db.accounts.filter(x=>String(x.code)!==String(code));selected=null;save();renderTree();toast(arEn("تم حذف الحساب","Account deleted"));
};
function accountOptions(onlyLeaf=true, selectedCode=""){
 return db.accounts.filter(a=>!onlyLeaf||isLeaf(a)).sort((a,b)=>Number(a.code)-Number(b.code)).map(a=>`<option value="${a.code}" ${String(a.code)===String(selectedCode)?"selected":""}>${a.code} — ${esc(a.name)}</option>`).join("");
}
window.openAccountModal=(editCode=null,parentCodeForNew=null)=>{
 const a=editCode?db.accounts.find(x=>String(x.code)===String(editCode)):null;
 const parent=parentCodeForNew!=null?db.accounts.find(x=>String(x.code)===String(parentCodeForNew)):null;
 const autoCode=!a&&parent?nextCodeForParent(parent):(!a?nextCodeForParent(null):null);
 if(!a&&autoCode==null){toast(arEn("لا يوجد كود متاح لإضافة حساب فرعي جديد تحت هذا الحساب","No available code left to add a new sub-account here"));return}
 const level=a?.level||childLevel(parent);
 const type=a?.type||(parent?"فرعي":"رئيسي");
 $("#modal").innerHTML=`<h3>${a?arEn("تعديل حساب","Edit Account"):arEn("إضافة حساب جديد","New Account")}</h3>
 <div class="form-grid">
 <div class="field"><label>${arEn("الحساب الأب","Parent account")}</label><input value="${parent?esc(parent.code+" — "+parent.name):arEn("حساب رئيسي","Root account")}" disabled></div>
 <div class="field"><label>${arEn("الكود التلقائي","Automatic code")}</label><input id="aCode" value="${a?esc(a.code):esc(autoCode||"")}" disabled></div>
 <div class="field"><label>${arEn("اسم الحساب","Account name")}</label><input id="aName" value="${a?esc(a.name):""}"></div>
 <div class="field"><label>${arEn("طبيعة الحساب","Nature")}</label><select id="aNature"><option>مدين</option><option>دائن</option></select></div>
 <div class="field"><label>${arEn("القائمة","Statement")}</label><select id="aStatement"><option>المركز المالي</option><option>قائمة الدخل</option></select></div>
 <div class="field"><label>${arEn("المستوى","Level")}</label><select id="aLevel"><option>الأول</option><option>الثاني</option><option>الثالث</option><option>الرابع</option><option>الخامس</option></select></div>
 <div class="field"><label>${arEn("نوع الحساب","Type")}</label><select id="aType"><option>رئيسي</option><option>فرعي</option></select></div>
 <div class="field"><label>${arEn("التبويب بالقائمة","Statement tab")}</label><input id="aTab" value="${a?esc(a.statementTab):""}"></div>
 <div class="field"><label>${arEn("التبويب الرئيسي","Main tab")}</label><input id="aMain" value="${a?esc(a.mainTab):""}"></div></div>
 <div class="modal-foot"><button class="gold-btn" id="saveAccount">${arEn("حفظ الحساب","Save account")}</button><button class="soft-btn" onclick="closeModal()">${arEn("إلغاء","Cancel")}</button></div>`;
 $("#aNature").value=a?.nature||parent?.nature||"مدين";$("#aStatement").value=a?.statement||parent?.statement||"قائمة الدخل";$("#aLevel").value=level;$("#aType").value=type;
 $("#modalBack").classList.add("show");
 $("#saveAccount").onclick=()=>{
   const code=$("#aCode").value.trim(), name=$("#aName").value.trim();if(!code||!name){toast(arEn("أدخل اسم الحساب","Enter account name"));return}
   if(!a&&db.accounts.some(x=>String(x.code)===code)){toast(arEn("تعذر توليد كود جديد","Could not generate a unique code"));return}
   const obj={code:Number(code)||code,name,nature:$("#aNature").value,statement:$("#aStatement").value,level:$("#aLevel").value,type:$("#aType").value,statementTab:$("#aTab").value,mainTab:$("#aMain").value};
   if(a)Object.assign(a,obj);else { if(parent){ parent.type="رئيسي"; } db.accounts.push(obj); } save();closeModal();renderTree();document.dispatchEvent(new Event('accountsChanged'));window.__journalAccountPickerRefresh?.();window.__journalAccountPickerRefresh=null;toast(arEn("تم حفظ الحساب بالكود "+code,"Account saved with code "+code));
 };
};
function hideContextMenu(){ $("#treeContextMenu")?.classList.remove("show"); }
function openLedgerForAccount(accountCode){
 const a=db.accounts.find(v=>String(v.code)===String(accountCode));
 if(!a){toast(arEn("الحساب غير موجود","Account not found"));return;}
 openView("ledger");
 const select=$("#ledgerAccount"), search=$("#ledgerSearch");
 if(!select)return;
 // Set the selected account directly, then render. Do not depend on the search dropdown state.
 if(search) search.value=`${a.code} — ${a.name}`;
 select.innerHTML=`<option value="">${arEn("اختر الحساب","Select account")}</option>`+ledgerAccountOptions("",String(a.code))+ledgerAccountOptions("","");
 // Rebuild with unique options because the selected account must exist even when filters are active.
 const seen=new Set();
 select.innerHTML=`<option value="">${arEn("اختر الحساب","Select account")}</option>`+db.accounts.slice().sort((x,y)=>Number(x.code)-Number(y.code)).filter(x=>{const k=String(x.code);if(seen.has(k))return false;seen.add(k);return true;}).map(x=>`<option value="${esc(x.code)}">${esc(x.code)} — ${esc(x.name)}</option>`).join("");
 select.value=String(a.code);
 if(select.value!==String(a.code)){toast(arEn("تعذر تحديد الحساب","Could not select account"));return;}
 const results=$("#ledgerAccountResults"); if(results)results.classList.remove("show");
 renderLedger();
}
function showTreeContextMenu(code,x,y){
 const a=db.accounts.find(v=>String(v.code)===String(code)); if(!a)return;
 const menu=$("#treeContextMenu");
 const hasChildren=!isLeaf(a);
 const usedInJournal=db.journal.some(x=>String(x.code)===String(a.code));
 const canDelete=!hasChildren&&!usedInJournal;
 const deleteTitle=hasChildren
   ? arEn("لا يمكن مسح حساب يحتوي على حسابات فرعية","Cannot delete an account that has sub-accounts")
   : usedInJournal
     ? arEn("لا يمكن مسح الحساب لأنه مستخدم في قيود سابقة","Cannot delete this account because it is used in journal entries")
     : arEn("مسح الحساب","Delete account");
 menu.innerHTML=`
   <button id="ctxAdd">＋ ${arEn("إضافة حساب فرعي","Add sub-account")}</button>
   <button id="ctxLedger">▥ ${arEn("فتح كشف حساب","Open account ledger")}</button>
   <button id="ctxOpen">⌁ ${arEn("عرض الحساب","View account")}</button>
   <button id="ctxDelete" class="${canDelete?"":"disabled"}" ${canDelete?"":"disabled title=\""+esc(deleteTitle)+"\""}>⌫ ${deleteTitle}</button>`;
 menu.style.left=Math.min(x,window.innerWidth-280)+"px";
 menu.style.top=Math.min(y,window.innerHeight-160)+"px";
 menu.classList.add("show");
 $("#ctxAdd").onclick=()=>{hideContextMenu();openAccountModal(null,a.code)};
 $("#ctxOpen").onclick=()=>{hideContextMenu();showAccount(a.code)};
 $("#ctxLedger").onclick=()=>{
   hideContextMenu();
   openLedgerForAccount(a.code);
 };
 if(canDelete){
   $("#ctxDelete").onclick=()=>{
     hideContextMenu();
     if(!confirm(arEn(`مسح الحساب ${a.code} — ${a.name}؟`,`Delete account ${a.code} — ${a.name}?`)))return;
     db.accounts=db.accounts.filter(v=>String(v.code)!==String(a.code));
     if(String(selected?.code)===String(a.code))selected=null;
     save(); renderTree(); renderHome(); fillAccountSelects();
     toast(arEn("تم مسح الحساب بنجاح","Account deleted successfully"));
   };
 }
}
function entryGroups(){
 const map=new Map();
 db.journal.forEach((x,i)=>{const k=String(x.entry);if(!map.has(k))map.set(k,[]);map.get(k).push({...x,_i:i})});
 return [...map.entries()].map(([entry,lines])=>({entry,lines,date:lines[0].date,desc:lines[0].desc,invoice:lines[0].invoice,debit:lines.reduce((s,x)=>s+x.debit,0),credit:lines.reduce((s,x)=>s+x.credit,0)})).sort((a,b)=>Number(a.entry)-Number(b.entry));
}
function journalFilteredGroups(){
 return entryGroups();
}
function renderJournal(){
 const groups=journalFilteredGroups();
 if(!groups.length){ currentJournalEntry=null; $('#journalSummary').innerHTML=''; $('#journalPager')&&($('#journalPager').innerHTML=''); $('#journalBody').innerHTML=`<tr><td colspan="7" class="empty">${arEn('لا توجد قيود','No entries')}</td></tr>`; return; }
 if(currentJournalEntry==null || !groups.some(g=>String(g.entry)===String(currentJournalEntry))) currentJournalEntry=groups[groups.length-1].entry;
 const idx=groups.findIndex(g=>String(g.entry)===String(currentJournalEntry));
 const g=groups[idx], tone=idx%8, nav=$('#journalPager');
 if(nav) nav.innerHTML=`<div class="journal-nav"><div class="journal-nav-pagination"><button class="soft-btn" ${idx===0?'disabled':''} onclick="showJournalEntryByIndex(0)">⏮ ${arEn('الأول','First')}</button><button class="soft-btn" ${idx===0?'disabled':''} onclick="showJournalEntryByIndex(${idx-1})">◀ ${arEn('السابق','Previous')}</button><span class="journal-position">${arEn('رقم القيد','Entry No.')} <strong>#${esc(g.entry)}</strong> <span class="muted">(${idx+1} / ${groups.length})</span></span><button class="soft-btn" ${idx===groups.length-1?'disabled':''} onclick="showJournalEntryByIndex(${idx+1})">${arEn('التالي','Next')} ▶</button><button class="soft-btn" ${idx===groups.length-1?'disabled':''} onclick="showJournalEntryByIndex(${groups.length-1})">${arEn('الأخير','Last')} ⏭</button></div><div class="journal-toolbar-actions"><button class="gold-btn journal-add-entry" onclick="openJournalModal()">＋ ${arEn('إدخال قيد','New Entry')}</button><button class="soft-btn" title="${arEn('طباعة القيد','Print Entry')}" onclick="printJournalEntry('${esc(g.entry)}')">🖨</button><button class="soft-btn" title="${arEn('تصدير Excel','Export Excel')}" onclick="exportJournalExcel('${esc(g.entry)}')">📊</button><button class="soft-btn" title="${arEn('تصدير PDF','Export PDF')}" onclick="exportJournalPDF('${esc(g.entry)}')">📄</button><button class="soft-btn" title="${arEn('تعديل القيد','Edit Entry')}" onclick="openJournalModal('${esc(g.entry)}')">✎</button><button class="soft-btn danger" title="${arEn('حذف القيد','Delete Entry')}" onclick="deleteEntry('${esc(g.entry)}')">⌫</button></div></div>`;
 $('#journalSummary').innerHTML=`<div class="journal-current-totals tone-${tone}"><div><span>${arEn('إجمالي مدين القيد','Entry Total Debit')}</span><b class="debit">${fmt(g.debit)}</b></div><div><span>${arEn('إجمالي دائن القيد','Entry Total Credit')}</span><b class="credit">${fmt(g.credit)}</b></div><div class="journal-balance-state"><span>${arEn('حالة القيد','Entry Status')}</span><b class="${Math.abs(g.debit-g.credit)<.005?'balanced-mark':'unbalanced-mark'}">${Math.abs(g.debit-g.credit)<.005?arEn('متوازن','Balanced'):arEn('غير متوازن','Unbalanced')}</b></div></div>`;
 $('#journalBody').innerHTML=g.lines.map((x,i)=>`<tr class="entry-tone tone-${tone}"><td class="num">${i===0?g.entry:''}</td><td>${esc(x.date)}</td><td><button class="link-btn" data-account-code="${esc(x.code)}" onclick="showAccount(${x.code});openView('tree')">${x.code} — ${esc(x.a5||x.search)}</button></td><td>${esc(x.desc)}</td><td>${esc(x.invoice||'—')}</td><td class="debit num">${x.debit?fmt(x.debit):'—'}</td><td class="credit num">${x.credit?fmt(x.credit):'—'}</td></tr>`).join('');
}

function getJournalEntryForExport(entry){
 const g=entryGroups().find(x=>String(x.entry)===String(entry));
 if(!g)return null;
 return g;
}
function journalExportHtml(g){
 const isAr=db.lang==="ar";
 const title=isAr?"قيد اليومية":"Journal Entry";
 const headers=isAr?["رقم القيد","التاريخ","الحساب","البيان","الفاتورة","مدين","دائن"]:["Entry No.","Date","Account","Description","Invoice","Debit","Credit"];
 const rows=g.lines.map((x,i)=>`<tr><td>${i===0?esc(g.entry):""}</td><td>${esc(x.date||"")}</td><td>${esc(x.code)} — ${esc(x.a5||x.search||"")}</td><td>${esc(x.desc||"")}</td><td>${esc(x.invoice||"")}</td><td>${x.debit?fmt(x.debit):""}</td><td>${x.credit?fmt(x.credit):""}</td></tr>`).join("");
 return `<!doctype html><html lang="${isAr?"ar":"en"}" dir="${isAr?"rtl":"ltr"}"><head><meta charset="utf-8"><title>${title} #${esc(g.entry)}</title>
 <style>body{font-family:Arial,"Tahoma",sans-serif;padding:28px;color:#111}h1{text-align:center;margin:0 0 18px;font-size:24px}.meta{display:flex;justify-content:space-between;margin:0 0 16px;font-size:14px}table{width:100%;border-collapse:collapse}th,td{border:1px solid #999;padding:9px;text-align:center}th{background:#eee;font-weight:700}.totals{display:flex;justify-content:flex-end;gap:28px;margin-top:18px;font-weight:700}.debit{color:#8b1e1e}.credit{color:#075f3b}@media print{body{padding:8mm} }</style></head><body>
 <h1>${title} #${esc(g.entry)}</h1><div class="meta"><span>${isAr?"التاريخ":"Date"}: ${esc(g.lines[0]?.date||"")}</span><span>${isAr?"البيان":"Description"}: ${esc(g.lines[0]?.desc||"")}</span></div>
 <table><thead><tr>${headers.map(h=>`<th>${h}</th>`).join("")}</tr></thead><tbody>${rows}</tbody></table>
 <div class="totals"><span class="debit">${isAr?"إجمالي مدين":"Total Debit"}: ${fmt(g.debit)}</span><span class="credit">${isAr?"إجمالي دائن":"Total Credit"}: ${fmt(g.credit)}</span></div>
 </body></html>`;
}
function openJournalPrintWindow(g){
 const w=window.open("","_blank","width=1000,height=750");
 if(!w){toast(arEn("يرجى السماح بالنوافذ المنبثقة للطباعة","Please allow pop-ups for printing"));return;}
 w.document.open();w.document.write(journalExportHtml(g));w.document.close();
 w.focus();setTimeout(()=>w.print(),350);
}
window.printJournalEntry=(entry)=>{const g=getJournalEntryForExport(entry);if(g)openJournalPrintWindow(g);};
window.exportJournalPDF=(entry)=>{const g=getJournalEntryForExport(entry);if(g)openJournalPrintWindow(g);};
window.exportJournalExcel=(entry)=>{
 const g=getJournalEntryForExport(entry); if(!g)return;
 const html=journalExportHtml(g);
 const blob=new Blob(["\ufeff",html],{type:"application/vnd.ms-excel;charset=utf-8"});
 const a=document.createElement("a");a.href=URL.createObjectURL(blob);
 a.download=`Journal_Entry_${g.entry}.xls`;document.body.appendChild(a);a.click();a.remove();
 setTimeout(()=>URL.revokeObjectURL(a.href),1000);
 toast(arEn("تم تصدير القيد إلى Excel","Entry exported to Excel"));
};
window.showJournalEntryByIndex=(index)=>{
 const groups=journalFilteredGroups(); if(!groups.length)return; index=Math.max(0,Math.min(index,groups.length-1)); currentJournalEntry=groups[index].entry; renderJournal();
};
function ledgerAccountOptions(query="", selectedCode=""){
 const q=String(query||"").trim().toLowerCase();
 return db.accounts.filter(a=>{
   if(!q)return true;
   return String(a.code).toLowerCase().includes(q) || String(a.name||"").toLowerCase().includes(q);
 }).sort((a,b)=>Number(a.code)-Number(b.code)).map(a=>`<option value="${a.code}" ${String(a.code)===String(selectedCode)?"selected":""}>${a.code} — ${esc(a.name)}</option>`).join("");
}
function refreshLedgerAccountSearch(keepCode=""){
 const input=$('#ledgerSearch'), select=$('#ledgerAccount'), results=$('#ledgerAccountResults'); if(!select)return;
 const q=String(input?.value||"").trim().toLowerCase();
 const current=keepCode || select.value || "";
 const matches=db.accounts.filter(a=>!q || String(a.code).toLowerCase().includes(q) || String(a.name||"").toLowerCase().includes(q)).sort((a,b)=>Number(a.code)-Number(b.code));
 select.innerHTML=`<option value="">${arEn('اختر الحساب','Select account')}</option>`+matches.map(a=>`<option value="${a.code}">${a.code} — ${esc(a.name)}</option>`).join("");
 if(current && matches.some(a=>String(a.code)===String(current))) select.value=String(current);
 else if(matches.length===1 && q) select.value=String(matches[0].code);
 if(results){
   if(!q){ results.innerHTML=""; results.classList.remove("show"); return; }
   const shown=matches.slice(0,80);
   results.innerHTML=shown.length ? shown.map(a=>`<button type="button" class="ledger-account-result" data-code="${a.code}"><b>${esc(a.code)}</b><span>${esc(a.name)}</span></button>`).join("") : `<div class="ledger-account-no-results">${arEn("لا توجد حسابات مطابقة","No matching accounts")}</div>`;
   results.classList.add("show");
   results.querySelectorAll(".ledger-account-result").forEach(btn=>btn.onclick=()=>{
     const code=btn.dataset.code; const a=db.accounts.find(x=>String(x.code)===String(code));
     if(!a)return; input.value=`${a.code} — ${a.name}`; select.value=String(a.code); results.classList.remove("show"); renderLedger();
   });
 }
}
function fillAccountSelects(){
 const ja=$('#journalAccount'); if(ja) ja.innerHTML=`<option value="">${arEn('كل الحسابات','All accounts')}</option>`+accountOptions(true);
 const la=$('#ledgerAccount'); if(la){const current=la.value;la.innerHTML=`<option value="">${arEn('اختر الحساب','Select account')}</option>`+ledgerAccountOptions($('#ledgerSearch')?.value||"",current);if(current)la.value=current;}
}
window.openJournalModal=(entry=null)=>{
 if(entry&&guardLinkedEntry(entry))return;
 const groups=entryGroups(), old=entry?groups.find(g=>String(g.entry)===String(entry)):null;
 const editor=$('#journalEditor'); if(!editor)return;
 $('#journalTablePanel').style.display='none';
 $('#journalPager').style.display='none';
 editor.style.display='block';
 const lines=old?old.lines.map(x=>({code:x.code,debit:x.debit,credit:x.credit})): [{code:'',debit:0,credit:0},{code:'',debit:0,credit:0}];
 const entryNo=old?old.entry:(Math.max(0,...db.journal.map(x=>Number(x.entry)||0))+1);
 editor.innerHTML=`<div class="inline-entry-card">
   <div class="inline-entry-head">
     <div><span class="kicker">${old?arEn('تعديل القيد','EDIT ENTRY'):arEn('قيد جديد','NEW ENTRY')}</span><h3>${old?arEn('تعديل القيد','Edit Entry'):arEn('قيد جديد','New Journal Entry')}</h3></div>
     <div class="journal-entry-number-top"><span>${arEn('رقم القيد','ENTRY NO.')}</span><strong>#${esc(entryNo)}</strong></div>
     <div class="inline-entry-actions"><button class="soft-btn" id="cancelJournalEdit">✕ ${arEn('إلغاء','Cancel')}</button></div>
   </div>
   <div class="entry-meta-row">
     <div><span>${arEn('التاريخ','Date')}</span><input type="date" id="jDate" value="${old?old.date:new Date().toISOString().slice(0,10)}"></div>
     <div><span>${arEn('نوع القيد','Type')}</span><select id="jType"><option value="يومية">${arEn('يومية','Journal')}</option><option value="افتتاحي">${arEn('افتتاحي','Opening')}</option><option value="تسوية">${arEn('تسوية','Adjustment')}</option><option value="إقفال">${arEn('إقفال','Closing')}</option></select></div>
     <div><span>${arEn('الفاتورة','Invoice')}</span><input id="jInvoice" value="${esc(old?.invoice||'')}" placeholder="${arEn('اختياري','Optional')}"></div>
   </div>
   <div class="entry-description"><label>${arEn('البيان','Description')}</label><textarea id="jDesc" placeholder="${arEn('اكتب بيان القيد هنا...','Enter journal description here...')}">${esc(old?.desc||'')}</textarea></div>
   <div class="entry-lines-table"><table><thead><tr><th>#</th><th>${arEn('الحساب','Account')}</th><th>${arEn('مدين','Debit')}</th><th>${arEn('دائن','Credit')}</th><th>${arEn('إجراء','Action')}</th></tr></thead><tbody id="jLines"></tbody></table></div>
   <div class="inline-entry-bottom"><button class="soft-btn" id="addLine">＋ ${arEn('إضافة سطر','Add line')}</button><div id="balanceBox" class="balance-box"></div></div>
   <div class="inline-save-row"><button class="gold-btn big-save" id="saveJournal">✓ ${arEn('حفظ القيد','Save entry')}</button></div>
 </div>`;
 $('#jType').value=old?.lines?.[0]?.type||'يومية';
 const container=$('#jLines');
 function addLine(line={code:'',debit:0,credit:0}){
  const d=document.createElement('tr'); d.className='journal-input-row';
  const selected=db.accounts.find(a=>String(a.code)===String(line.code));
  d.innerHTML=`<td class="line-no"></td><td><div class="account-picker inline-picker"><input class="lsearch" autocomplete="off" placeholder="${arEn('اكتب الكود أو اسم الحساب الفرعي...','Type sub-account code or name...')}" value="${selected?esc(selected.code):''}"><input type="hidden" class="lcode" value="${line.code||''}"><div class="selected-account-name">${selected?esc(selected.name):''}</div><div class="account-results"></div></div></td><td><input class="ldebit money-input" type="number" step="0.01" min="0" value="${line.debit||0}"></td><td><input class="lcredit money-input" type="number" step="0.01" min="0" value="${line.credit||0}"></td><td><button class="soft-btn danger ldel" title="${arEn('حذف السطر','Delete line')}">⌫</button></td>`;
  container.appendChild(d);
  [...container.querySelectorAll('.line-no')].forEach((n,i)=>n.textContent=i+1);
  const search=d.querySelector('.lsearch'), hidden=d.querySelector('.lcode'), nameBox=d.querySelector('.selected-account-name'), results=d.querySelector('.account-results');
  const leaves=()=>db.accounts.filter(isLeaf).sort((a,b)=>String(a.code).localeCompare(String(b.code),undefined,{numeric:true}));
  let activeIndex=-1;
  function renderResultList(list,q){
   const rows=list.map((a,i)=>`<button type="button" class="account-result" data-code="${a.code}" data-index="${i}"><b>${esc(a.code)}</b><span>${esc(a.name)}</span></button>`).join('');
   const addBtn=`<button type="button" class="account-add-new">＋ ${arEn('إضافة حساب جديد للشجرة','Add new account to chart')}</button>`;
   results.innerHTML=(rows||`<div class="account-no-results">${arEn('لا يوجد حساب فرعي مطابق','No matching sub-account')}</div>`)+addBtn;
   results.classList.add('show');
   activeIndex=-1;
  }
  function showResults(){
   const q=search.value.trim().toLowerCase();
   const list=leaves().filter(a=>!q||String(a.code).toLowerCase().includes(q)||String(a.name||'').toLowerCase().includes(q)).slice(0,80);
   renderResultList(list,q);
  }
  function choose(a){
   if(!a)return;
   hidden.value=a.code;search.value=a.code;nameBox.textContent=a.name;
   results.classList.remove('show');activeIndex=-1;calc();
  }
  function addNewAccountFromJournal(){
   results.classList.remove('show');
   window.__journalAccountPickerRefresh=()=>{ showResults(); };
   openAccountModal();
  }
  search.onfocus=()=>showResults();
  search.oninput=()=>{
   const q=search.value.trim().toLowerCase();
   hidden.value='';nameBox.textContent='';
   const exact=leaves().find(a=>String(a.code).toLowerCase()===q);
   if(exact){choose(exact);return;}
   showResults();calc();
  };
  search.onkeydown=e=>{
   if(e.key==='Escape'){results.classList.remove('show');activeIndex=-1;return}
   const items=[...results.querySelectorAll('.account-result')];
   if(e.key==='ArrowDown'&&items.length){e.preventDefault();activeIndex=Math.min(activeIndex+1,items.length-1);items.forEach((x,i)=>x.classList.toggle('active',i===activeIndex));return}
   if(e.key==='ArrowUp'&&items.length){e.preventDefault();activeIndex=Math.max(activeIndex-1,0);items.forEach((x,i)=>x.classList.toggle('active',i===activeIndex));return}
   if(e.key==='Enter'){
    e.preventDefault();
    if(activeIndex>=0&&items[activeIndex]) choose(db.accounts.find(a=>String(a.code)===String(items[activeIndex].dataset.code)));
    else if(items[0]) choose(db.accounts.find(a=>String(a.code)===String(items[0].dataset.code)));
    else addNewAccountFromJournal();
   }
  };
  results.addEventListener('mousedown',e=>{
   const b=e.target.closest('.account-result');
   if(b)e.preventDefault();
  });
  results.addEventListener('click',e=>{
   const b=e.target.closest('.account-result');
   if(b){ choose(db.accounts.find(a=>String(a.code)===String(b.dataset.code))); return; }
   if(e.target.closest('.account-add-new')) addNewAccountFromJournal();
  });
  document.addEventListener('accountsChanged',()=>{ if(document.body.contains(d)) showResults(); });
  results.addEventListener('click',e=>{const b=e.target.closest('.account-result');if(!b)return;choose(db.accounts.find(a=>String(a.code)===String(b.dataset.code)));});
  d.querySelector('.ldel').onclick=()=>{d.remove();[...container.querySelectorAll('.line-no')].forEach((n,i)=>n.textContent=i+1);calc()};
  d.querySelectorAll('input').forEach(e=>e.addEventListener('input',calc));
  calc();
 }
 lines.forEach(addLine);
 $('#addLine').onclick=()=>addLine();
 function calc(){
  let d=0,c=0,invalid=0,rows=0;
  container.querySelectorAll('.journal-input-row').forEach(r=>{const code=r.querySelector('.lcode').value,dv=Number(r.querySelector('.ldebit').value||0),cv=Number(r.querySelector('.lcredit').value||0);if(code&&(dv>0||cv>0))rows++;if(code&&dv>0&&cv>0)invalid++;if(code&&!dv&&!cv)invalid++;if(!code&&(dv>0||cv>0))invalid++;d+=dv;c+=cv;});
  const diff=d-c,balanced=Math.abs(diff)<.005&&rows>=2&&invalid===0;
  $('#balanceBox').className='balance-box '+(balanced?'ok':'bad');
  $('#balanceBox').innerHTML=`<div class="inline-balance-values"><span>${arEn('إجمالي المدين','Total Debit')} <b class="debit">${fmt(d)}</b></span><span>${arEn('إجمالي الدائن','Total Credit')} <b class="credit">${fmt(c)}</b></span><span>${arEn('الفرق','Difference')} <b>${fmt(Math.abs(diff))}</b></span><strong>${balanced?arEn('✓ القيد متوازن','✓ Balanced'):arEn('⚠ القيد غير متوازن','⚠ Unbalanced')}</strong></div>`;
  return {d,c,balanced,invalid,rows};
 }
 $('#cancelJournalEdit').onclick=()=>closeJournalEditor();
 $('#saveJournal').onclick=()=>{
  const rows=[...container.querySelectorAll('.journal-input-row')].map(r=>({code:Number(r.querySelector('.lcode').value),debit:Number(r.querySelector('.ldebit').value||0),credit:Number(r.querySelector('.lcredit').value||0)})).filter(x=>x.code&&(x.debit||x.credit));
  const {d,c,balanced,invalid}=calc();
  if(rows.length<2||invalid||Math.abs(d-c)>.005){toast(arEn('لا يمكن حفظ القيد: القيد غير متوازن أو يحتوي على بيانات غير صحيحة.','Cannot save: the entry is unbalanced or contains invalid data.'));return}
  const newEntry=old?old.entry:entryNo;
  const map=accountMap(), date=$('#jDate').value, desc=$('#jDesc').value.trim(), invoice=$('#jInvoice').value.trim(), type=$('#jType').value;
  if(!date||!desc){toast(arEn('يرجى إدخال التاريخ والبيان قبل الحفظ.','Please enter date and description before saving.'));return}
  if(old)db.journal=db.journal.filter(x=>String(x.entry)!==String(newEntry));
  rows.forEach(x=>{const a=map.get(String(x.code));db.journal.push({date,month:date.slice(0,7),type,entry:newEntry,search:`${x.code}- ${a?.name||''}`,code:x.code,a1:a?.name||'',a2:'',a3:'',a4:'',a5:a?.name||'',debit:x.debit,credit:x.credit,balance:x.debit-x.credit,desc,invoice})});
  save(); fillAccountSelects(); currentJournalEntry=newEntry; closeJournalEditor(); renderHome(); toast(arEn('تم حفظ القيد بنجاح — يمكنك الآن الانتقال للتالي.','Entry saved — you can now move to the next entry.'));
 };
};
window.closeJournalEditor=()=>{const e=$('#journalEditor');if(e){e.style.display='none';e.innerHTML='';}$('#journalTablePanel').style.display='block';$('#journalPager').style.display='block';renderJournal();};

window.deleteEntry=entry=>{if(guardLinkedEntry(entry))return;if(!confirm(arEn("حذف القيد بالكامل؟","Delete entire entry?")))return;db.journal=db.journal.filter(x=>String(x.entry)!==String(entry));save();renderJournal();renderHome();toast(arEn("تم حذف القيد","Entry deleted"))};
function getLedgerData(){
 const code=$("#ledgerAccount")?.value||"",fd=$("#ledgerFrom")?.value||"",td=$("#ledgerTo")?.value||"";
 if(!code)return null;
 const a=db.accounts.find(x=>String(x.code)===String(code));
 if(!a)return null;
 const selectedCode=String(a.code);
 const rows=db.journal.filter(x=>{
   const xc=String(x.code);
   // Include the selected account and its real descendants only.
   // This avoids false prefix matches and guarantees parent-account movements are aggregated correctly.
   let belongs=xc===selectedCode;
   if(!belongs){
     let p=parentCode(xc);
     while(p!==null){
       if(String(p)===selectedCode){belongs=true;break;}
       p=parentCode(p);
     }
   }
   return belongs&&(!fd||String(x.date||"")>=fd)&&(!td||String(x.date||"")<=td);
 }).sort((x,y)=>String(x.date||"").localeCompare(String(y.date||""))||Number(x.entry)-Number(y.entry)||Number(x._i||0)-Number(y._i||0));
 let run=0;
 const data=rows.map(x=>{run+=Number(x.debit||0)-Number(x.credit||0);return {entry:x.entry,date:x.date,desc:x.desc||"",debit:Number(x.debit||0),credit:Number(x.credit||0),balance:run};});
 return {account:a,from:fd,to:td,rows:data,debit:data.reduce((s,x)=>s+x.debit,0),credit:data.reduce((s,x)=>s+x.credit,0),balance:run,parent:!isLeaf(a)};
}
function ledgerExportHtml(data){
 const title=arEn("كشف حساب","Account Statement");
 const period=(data.from||data.to)?`<div class="meta">${data.from?`${arEn("من","From")}: ${data.from}`:""} ${data.to?`${arEn("إلى","To")}: ${data.to}`:""}</div>`:"";
 const rows=data.rows.length?data.rows.map(x=>`<tr><td>${esc(x.entry)}</td><td>${esc(x.date)}</td><td>${esc(x.desc)}</td><td>${fmt(x.debit)}</td><td>${fmt(x.credit)}</td><td>${fmt(x.balance)}</td></tr>`).join(""):`<tr><td colspan="6">${arEn("لا توجد حركة","No movement")}</td></tr>`;
 return `<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><title>${title}</title><style>body{font-family:Arial,Tahoma,sans-serif;padding:24px;color:#111;background:#fff}h1{text-align:center;margin:0 0 8px;font-size:24px}.account{text-align:center;font-size:18px;font-weight:700;margin-bottom:8px}.meta{text-align:center;margin-bottom:16px;font-size:13px}table{width:100%;border-collapse:collapse}th,td{border:1px solid #888;padding:8px;text-align:center}th{background:#eee;font-weight:700}.print-totals{margin-top:18px;display:grid;grid-template-columns:repeat(3,1fr);gap:12px;direction:rtl}.print-total-card{border:2px solid #b88a25;border-radius:12px;padding:12px 10px;text-align:center;background:#fff;box-sizing:border-box}.print-total-card span{display:block;font-size:13px;font-weight:700;margin-bottom:6px}.print-total-card b{display:block;font-size:20px;line-height:1.2}.print-total-card.debit{border-color:#16845b}.print-total-card.debit b{color:#16845b}.print-total-card.credit{border-color:#c18a20}.print-total-card.credit b{color:#9a6c10}.print-total-card.balance{border-color:#8b6b1f}.print-total-card.balance b{color:#7a5b12}@media print{body{padding:8mm}.print-totals{break-inside:avoid;page-break-inside:avoid}}</style></head><body><h1>${title}</h1><div class="account">${esc(data.account.code)} — ${esc(data.account.name)}</div>${data.parent?`<div class="meta">${arEn("كشف مجمع للحساب والحسابات الفرعية","Consolidated ledger for this account and its sub-accounts")}</div>`:""}${period}<table><thead><tr><th>${arEn("القيد","Entry")}</th><th>${arEn("التاريخ","Date")}</th><th>${arEn("البيان","Description")}</th><th>${arEn("مدين","Debit")}</th><th>${arEn("دائن","Credit")}</th><th>${arEn("الرصيد","Balance")}</th></tr></thead><tbody>${rows}</tbody></table><div class="print-totals"><div class="print-total-card debit"><span>${arEn("إجمالي المدين","Total Debit")}</span><b>${fmt(data.debit)}</b></div><div class="print-total-card credit"><span>${arEn("إجمالي الدائن","Total Credit")}</span><b>${fmt(data.credit)}</b></div><div class="print-total-card balance"><span>${arEn("الرصيد","Balance")}</span><b>${fmt(data.balance)}</b></div></div></body></html>`;
}
function openLedgerPrintWindow(){
 const data=getLedgerData();
 if(!data){toast(arEn("اختر حساباً أولاً","Select an account first"));return;}
 // Print the ledger from the current document. This avoids popup/iframe blockers.
 const root=document.body;
 const previousTitle=document.title;
 const restore=()=>{
   root.classList.remove("ledger-printing");
   document.title=previousTitle;
   window.removeEventListener("afterprint",restore);
 };
 document.title=`${arEn("كشف حساب","Account Statement")} - ${data.account.code} - ${data.account.name}`;
 root.classList.add("ledger-printing");
 window.addEventListener("afterprint",restore,{once:true});
 // Give the browser a rendering tick before invoking its native print dialog.
 requestAnimationFrame(()=>requestAnimationFrame(()=>{
   try{window.print();}catch(e){restore();toast(arEn("تعذر فتح الطباعة. حاول مرة أخرى.","Unable to open printing. Please try again."));}
 }));
 // Some browsers do not fire afterprint when the dialog is cancelled.
 setTimeout(()=>{if(root.classList.contains("ledger-printing"))restore();},15000);
}
window.exportLedgerPDF=openLedgerPrintWindow;
// Also expose under its own name: the ledger panel's print button calls
// onclick="openLedgerPrintWindow()" directly (see renderLedger below), which — like
// showAccount above — runs in the global scope and needs this exact name on window.
window.openLedgerPrintWindow=openLedgerPrintWindow;
window.exportLedgerExcel=()=>{
 const data=getLedgerData(); if(!data){toast(arEn("اختر حساباً أولاً","Select an account first"));return;}
 const html=ledgerExportHtml(data);
 const blob=new Blob(["\ufeff",html],{type:"application/vnd.ms-excel;charset=utf-8"});
 const url=URL.createObjectURL(blob);const link=document.createElement("a");link.href=url;link.download=`Ledger_${data.account.code}_${data.account.name}.xls`;document.body.appendChild(link);link.click();link.remove();URL.revokeObjectURL(url);
 toast(arEn("تم تصدير كشف الحساب إلى Excel","Account statement exported to Excel"));
};
function hideLedgerContextMenu(){ $("#ledgerContextMenu")?.classList.remove("show"); }
function showLedgerContextMenu(entry,x,y,accountCode=""){
 const menu=$("#ledgerContextMenu"); if(!menu)return;
 menu.innerHTML=`
   ${accountCode?`<button id="ctxOpenLedger">▥ ${arEn("فتح كشف حساب","Open account ledger")}</button>`:""}
   ${entry?`<button id="ctxOpenJournal">▤ ${arEn("عرض القيد","View journal entry")}</button>`:""}`;
 menu.style.left=Math.min(x,window.innerWidth-270)+"px";
 menu.style.top=Math.min(y,window.innerHeight-110)+"px";
 menu.classList.add("show");
 if(accountCode) $("#ctxOpenLedger").onclick=()=>{
   hideLedgerContextMenu();
   openLedgerForAccount(accountCode);
 };
 if(entry && $("#ctxOpenJournal")) $("#ctxOpenJournal").onclick=()=>{hideLedgerContextMenu();showJournalEntryReadonly(entry);};
}
function showJournalEntryReadonly(entry){
 const g=getJournalEntryForExport(entry);
 if(!g){toast(arEn("القيد غير موجود","Journal entry not found"));return;}
 const lines=g.lines.map((x,i)=>`
   <tr>
     <td class="num">${i===0?esc(g.entry):""}</td>
     <td>${esc(x.date||"")}</td>
     <td>${esc(x.code)} — ${esc(x.a5||x.search||"")}</td>
     <td>${esc(x.desc||"")}</td>
     <td>${esc(x.invoice||"—")}</td>
     <td class="debit num">${x.debit?fmt(x.debit):"—"}</td>
     <td class="credit num">${x.credit?fmt(x.credit):"—"}</td>
   </tr>`).join("");
 const back=$("#modalBack"), modal=$("#modal");
 if(!back||!modal)return;
 modal.innerHTML=`
   <div class="readonly-entry-view">
     <div class="inline-entry-head">
       <div><span class="kicker">${arEn("عرض القيد","VIEW JOURNAL ENTRY")}</span>
       <h3>${arEn("قيد اليومية","Journal Entry")} #${esc(g.entry)}</h3></div>
       <button class="soft-btn" id="closeReadonlyEntry">✕</button>
     </div>
     <div class="journal-readonly-meta">
       <div><span>${arEn("التاريخ","Date")}</span><b>${esc(g.date||"")}</b></div>
       <div><span>${arEn("البيان","Description")}</span><b>${esc(g.desc||"—")}</b></div>
       <div><span>${arEn("رقم القيد","Entry No.")}</span><b>#${esc(g.entry)}</b></div>
     </div>
     <div class="table-wrap readonly-entry-table">
       <table><thead><tr>
         <th>#</th><th>${arEn("التاريخ","Date")}</th><th>${arEn("الحساب","Account")}</th>
         <th>${arEn("البيان","Description")}</th><th>${arEn("الفاتورة","Invoice")}</th>
         <th>${arEn("مدين","Debit")}</th><th>${arEn("دائن","Credit")}</th>
       </tr></thead><tbody>${lines}</tbody></table>
     </div>
     <div class="readonly-entry-totals">
       <div><span>${arEn("إجمالي المدين","Total Debit")}</span><b class="debit">${fmt(g.debit)}</b></div>
       <div><span>${arEn("إجمالي الدائن","Total Credit")}</span><b class="credit">${fmt(g.credit)}</b></div>
       <div><span>${arEn("الحالة","Status")}</span><b>${Math.abs(g.debit-g.credit)<.005?arEn("متوازن","Balanced"):arEn("غير متوازن","Unbalanced")}</b></div>
     </div>
   </div>`;
 back.classList.add("show");
 $("#closeReadonlyEntry").onclick=()=>back.classList.remove("show");
}
window.showJournalEntryReadonly=showJournalEntryReadonly;

function renderLedger(){
 const code=$("#ledgerAccount").value,area=$("#ledgerArea");
 const data=getLedgerData();
 if(!code){area.innerHTML=`<div class="empty"><div>▥</div><b>${arEn("اختر حساباً","Select an account")}</b></div>`;return}
 if(!data){area.innerHTML=`<div class="empty"><div>▥</div><b>${arEn("الحساب غير موجود","Account not found")}</b></div>`;return}
 const bodyRows=data.rows.map(x=>`<tr class="ledger-row" data-entry="${esc(x.entry)}"><td>${esc(x.entry)}</td><td>${esc(x.date)}</td><td>${esc(x.desc)}</td><td class="debit num">${fmt(x.debit)}</td><td class="credit num">${fmt(x.credit)}</td><td class="num">${fmt(x.balance)}</td></tr>`).join("")||`<tr><td colspan="6" class="empty">${arEn("لا توجد حركة","No movement")}</td></tr>`;
 area.innerHTML=`<div class="panel-head"><div><h3>${data.account.code} — ${esc(data.account.name)}</h3>${data.parent?`<small class="muted">${arEn("كشف مجمع للحساب والحسابات الفرعية","Consolidated ledger for this account and its sub-accounts")}</small>`:""}</div><div class="ledger-export-actions"><button class="soft-btn" onclick="openLedgerPrintWindow()">🖨 <span>${arEn("طباعة","Print")}</span></button><button class="soft-btn" onclick="exportLedgerExcel()">📊 <span>Excel</span></button><button class="soft-btn" onclick="exportLedgerPDF()">📄 <span>PDF</span></button></div></div><div class="ledger-totals"><div class="ledger-total-card debit-total"><span>${arEn("إجمالي المدين","Total Debit")}</span><b class="num">${fmt(data.debit)}</b></div><div class="ledger-total-card credit-total"><span>${arEn("إجمالي الدائن","Total Credit")}</span><b class="num">${fmt(data.credit)}</b></div><div class="ledger-total-card balance-total"><span>${arEn("الرصيد","Balance")}</span><b class="num">${fmt(data.balance)}</b></div></div><div class="table-wrap"><table><thead><tr><th>${arEn("القيد","Entry")}</th><th>${arEn("التاريخ","Date")}</th><th>${arEn("البيان","Description")}</th><th>${arEn("مدين","Debit")}</th><th>${arEn("دائن","Credit")}</th><th>${arEn("الرصيد","Balance")}</th></tr></thead><tbody>${bodyRows}</tbody></table></div>`;
}
const LEVELS={"الأول":1,"الثاني":2,"الثالث":3,"الرابع":4,"الخامس":5};
function levelNo(a){return LEVELS[a?.level]||Number(a?.level)||5}
function prevDay(dateStr){if(!dateStr)return "";const d=new Date(dateStr+"T00:00:00");d.setDate(d.getDate()-1);return d.toISOString().slice(0,10);}
function journalMap(from="",to=""){
 const m=new Map(); db.journal.filter(x=>(!from||x.date>=from)&&(!to||x.date<=to)).forEach(x=>{const k=String(x.code);if(!m.has(k))m.set(k,{d:0,c:0});m.get(k).d+=Number(x.debit||0);m.get(k).c+=Number(x.credit||0)}); return m;
}
function amountFor(a,map){let d=0,c=0; const p=String(a.code); db.accounts.forEach(x=>{const q=String(x.code);if(q===p||q.startsWith(p)) {const z=map.get(q);if(z){d+=z.d;c+=z.c}}});return {d,c,n:d-c}}
function orderedHierarchyAccounts(selectedLevel, statement=null){
 const lim=Number(selectedLevel)||5;
 const byCode=new Map(db.accounts.map(a=>[String(a.code),a]));
 const roots=db.accounts.filter(a=>!parentCode(a.code)).sort((a,b)=>Number(a.code)-Number(b.code));
 const out=[];
 function visit(a){
   // Always walk the real account tree so siblings cannot jump ahead of descendants.
   if(levelNo(a)<=lim && (!statement||a.statement===statement)) out.push(a);
   childrenOf(a.code).forEach(visit);
 }
 roots.forEach(visit);
 // Keep any orphaned accounts visible at the end rather than silently losing data.
 db.accounts.filter(a=>!byCode.has(String(parentCode(a.code))) && parentCode(a.code)!==null)
   .sort((a,b)=>Number(a.code)-Number(b.code)).forEach(a=>{ if(!out.includes(a) && levelNo(a)<=lim && (!statement||a.statement===statement)) out.push(a); });
 return out;
}
function hierarchicalRows(map, selectedLevel, statement=null, hideZero=false){
 const rows=orderedHierarchyAccounts(selectedLevel,statement).map(a=>({...a,...amountFor(a,map)}));
 if(hideZero) return rows.filter(a=>a.d||a.c);
 return rows;
}
// --- Pivot-style report (matches the Excel "الشجرة" design: opening / during period / total / balance, each split debit-credit) ---
function splitMaps(from="",to=""){
 return {openingMap: from?journalMap("",prevDay(from)):new Map(), duringMap: journalMap(from,to)};
}
function pivotAmounts(a,openingMap,duringMap){
 const p=String(a.code); let od=0,oc=0,dd=0,dc=0,bd=0,bc=0;
 const codes=new Set([...openingMap.keys(),...duringMap.keys()]);
 codes.forEach(code=>{
  if(!code.startsWith(p)) return;
  const o=openingMap.get(code)||{d:0,c:0}, du=duringMap.get(code)||{d:0,c:0};
  od+=o.d; oc+=o.c; dd+=du.d; dc+=du.c;
  const net=(o.d+du.d)-(o.c+du.c);
  if(net>=0) bd+=net; else bc+=-net;
 });
 return {od,oc,dd,dc,td:od+dd,tc:oc+dc,bd,bc};
}
// Aggregates all revenue ("4") and expense ("5") accounts into one pivot-style bucket, using
// the exact same debit/credit split convention as pivotAmounts(), so it can be inserted into a
// balance-sheet pivot table as the equity impact of the still-open accounting period.
function periodResultPivot(openingMap,duringMap){
 let od=0,oc=0,dd=0,dc=0;
 const codes=new Set([...openingMap.keys(),...duringMap.keys()]);
 codes.forEach(code=>{
  if(!(code.startsWith('4')||code.startsWith('5'))) return;
  const o=openingMap.get(code)||{d:0,c:0}, du=duringMap.get(code)||{d:0,c:0};
  od+=o.d; oc+=o.c; dd+=du.d; dc+=du.c;
 });
 const net=(od+dd)-(oc+dc); let bd=0,bc=0;
 if(net>=0) bd=net; else bc=-net;
 return {od,oc,dd,dc,td:od+dd,tc:oc+dc,bd,bc};
}
function hierarchicalPivotRows(openingMap,duringMap,selectedLevel,statement=null,hideZero=false){
 const rows=orderedHierarchyAccounts(selectedLevel,statement).map(a=>({...a,...pivotAmounts(a,openingMap,duringMap)}));
 if(hideZero) return rows.filter(a=>a.od||a.oc||a.dd||a.dc||a.bd||a.bc);
 return rows;
}
function reportExportActions(areaId){
 return `<div class="report-export-actions" data-report-area="${areaId}"><button type="button" class="soft-btn report-action-print" title="${arEn("طباعة الكشف","Print report")}">🖨 <span>${arEn("طباعة","Print")}</span></button><button type="button" class="soft-btn report-action-excel" title="${arEn("تصدير Excel","Export Excel")}">📊 <span>Excel</span></button><button type="button" class="soft-btn report-action-pdf" title="${arEn("تصدير PDF","Export PDF")}">📄 <span>PDF</span></button></div>`;
}

function getReportAreaTitle(areaId){
 const area=$(areaId); const h=area?.querySelector('.panel-head h3'); return h?.textContent?.trim()||arEn('التقرير','Report');
}
function reportExportHtml(areaId,title){
 const area=$(areaId.startsWith("#")?areaId:`#${areaId}`); if(!area)return null;
 const clone=area.cloneNode(true); clone.querySelectorAll('.report-export-actions').forEach(x=>x.remove());
 return `<!doctype html><html lang="${db.lang}" dir="${db.lang==='ar'?'rtl':'ltr'}"><head><meta charset="utf-8"><title>${esc(title)}</title><style>body{font-family:Arial,Tahoma,sans-serif;padding:24px;color:#111;background:#fff}h3{font-size:20px;text-align:center;margin:0 0 8px}.panel-head{display:flex;align-items:center;justify-content:center;margin-bottom:12px}.muted{font-size:12px;color:#555}.table-wrap{overflow:visible!important}table{width:100%;border-collapse:collapse}th,td{border:1px solid #888;padding:7px;text-align:center}th{background:#eee;font-weight:700}.report-name{text-align:start}.num{font-variant-numeric:tabular-nums}.journal-summary{display:flex;gap:10px;margin-top:14px}.jsum{flex:1;border:1px solid #aaa;padding:10px;text-align:center}.jsum span,.jsum b{display:block}.jsum span{font-size:12px;margin-bottom:5px}.jsum b{font-size:18px}</style></head><body>${clone.innerHTML}</body></html>`;
}
function printReportArea(areaId){
 const area=$(areaId.startsWith("#")?areaId:`#${areaId}`); if(!area){toast(arEn('لا توجد بيانات للطباعة','No report data to print'));return;}
 const root=document.body, previousTitle=document.title, oldTarget=root.dataset.reportPrintTarget||'';
 const targetId=areaId.replace(/^#/,'');
 root.dataset.reportPrintTarget=targetId;
 root.dataset.reportPrintView=targetId==='trialArea'?'trial':targetId==='statementArea'?'statements':targetId==='reportArea'?'reports':'';
 document.title=getReportAreaTitle(areaId);
 const restore=()=>{root.classList.remove('report-printing');if(oldTarget)root.dataset.reportPrintTarget=oldTarget;else delete root.dataset.reportPrintTarget;delete root.dataset.reportPrintView;document.title=previousTitle;window.removeEventListener('afterprint',restore)};
 root.classList.add('report-printing'); window.addEventListener('afterprint',restore,{once:true});
 requestAnimationFrame(()=>requestAnimationFrame(()=>{try{window.print()}catch(e){restore();toast(arEn('تعذر فتح الطباعة. حاول مرة أخرى.','Unable to open printing. Please try again.'))}}));
 setTimeout(()=>{if(root.classList.contains('report-printing'))restore()},15000);
}
function exportReportPDF(areaId){printReportArea(areaId)}
function exportReportExcel(areaId){
 const title=getReportAreaTitle(areaId), html=reportExportHtml(areaId,title); if(!html){toast(arEn('لا توجد بيانات للتصدير','No report data to export'));return;}
 const blob=new Blob([html],{type:'application/vnd.ms-excel;charset=utf-8'}),a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=`${title.replace(/[\\/:*?"<>|]/g,'_')}.xls`;a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000);toast(arEn('تم تصدير التقرير إلى Excel','Report exported to Excel'));
}

window.printReportArea=printReportArea;
window.exportReportPDF=exportReportPDF;
window.exportReportExcel=exportReportExcel;

document.addEventListener('click',e=>{
 const box=e.target.closest('.report-export-actions'); if(!box)return;
 const areaId=box.dataset.reportArea; if(!areaId)return;
 if(e.target.closest('.report-action-print')){e.preventDefault();printReportArea(areaId);}
 else if(e.target.closest('.report-action-excel')){e.preventDefault();exportReportExcel(areaId);}
 else if(e.target.closest('.report-action-pdf')){e.preventDefault();exportReportPDF(areaId);}
});

function reportTablePivot(title,rows,areaId=""){
 const top=rows.filter(x=>levelNo(x)===1), src=top.length?top:rows;
 const tot=k=>src.reduce((s,x)=>s+x[k],0);
 const body=rows.map(x=>{const lvl=levelNo(x),indent=(lvl-1)*20;
  return `<tr class="report-row lvl${lvl}" data-account-code="${esc(x.code)}"><td class="num">${x.code}</td><td class="report-name" style="padding-inline-start:${indent}px;font-weight:${lvl<=3?700:500}">${esc(x.name)}</td>`+
   `<td class="debit num">${fmt(x.od)}</td><td class="credit num">${fmt(x.oc)}</td>`+
   `<td class="debit num">${fmt(x.dd)}</td><td class="credit num">${fmt(x.dc)}</td>`+
   `<td class="debit num">${fmt(x.td)}</td><td class="credit num">${fmt(x.tc)}</td>`+
   `<td class="debit num">${fmt(x.bd)}</td><td class="credit num">${fmt(x.bc)}</td></tr>`;
 }).join("")||`<tr><td colspan="10" class="empty">${arEn("لا توجد بيانات","No data")}</td></tr>`;
 return `<div class="panel-head"><div><h3>${title}</h3><span class="muted">${rows.length} ${arEn("حساب","accounts")}</span></div>${areaId?reportExportActions(areaId):""}</div>`+
  `<div class="table-wrap"><table class="pivot-table"><thead>`+
  `<tr><th rowspan="2">${arEn("الكود","Code")}</th><th rowspan="2">${arEn("الحساب","Account")}</th>`+
  `<th colspan="2">${arEn("افتتاحي","Opening")}</th><th colspan="2">${arEn("خلال الفترة","During period")}</th>`+
  `<th colspan="2">${arEn("المجموع","Total")}</th><th colspan="2">${arEn("الرصيد","Balance")}</th></tr>`+
  `<tr><th class="debit">${arEn("مدين","Debit")}</th><th class="credit">${arEn("دائن","Credit")}</th>`+
  `<th class="debit">${arEn("مدين","Debit")}</th><th class="credit">${arEn("دائن","Credit")}</th>`+
  `<th class="debit">${arEn("مدين","Debit")}</th><th class="credit">${arEn("دائن","Credit")}</th>`+
  `<th class="debit">${arEn("مدين","Debit")}</th><th class="credit">${arEn("دائن","Credit")}</th></tr>`+
  `</thead><tbody>${body}`+
  `<tr><th colspan="2">${arEn("الإجمالي","Total")}</th>`+
  `<th class="debit num">${fmt(tot('od'))}</th><th class="credit num">${fmt(tot('oc'))}</th>`+
  `<th class="debit num">${fmt(tot('dd'))}</th><th class="credit num">${fmt(tot('dc'))}</th>`+
  `<th class="debit num">${fmt(tot('td'))}</th><th class="credit num">${fmt(tot('tc'))}</th>`+
  `<th class="debit num">${fmt(tot('bd'))}</th><th class="credit num">${fmt(tot('bc'))}</th></tr>`+
  `</tbody></table></div>`;
}
function reportTable(title,rows,areaId=""){
 const td=rows.reduce((s,x)=>s+x.d,0),tc=rows.reduce((s,x)=>s+x.c,0);
 const body=rows.map(x=>{const lvl=levelNo(x),indent=(lvl-1)*20;return `<tr class="report-row lvl${lvl}" data-account-code="${esc(x.code)}"><td class="num">${x.code}</td><td class="report-name" style="padding-inline-start:${indent}px;font-weight:${lvl<=3?700:500}">${esc(x.name)}</td><td class="debit num">${fmt(x.d)}</td><td class="credit num">${fmt(x.c)}</td><td class="num">${fmt(x.n)}</td></tr>`;}).join("")||`<tr><td colspan="5" class="empty">${arEn("لا توجد بيانات","No data")}</td></tr>`;
 return `<div class="panel-head"><div><h3>${title}</h3><span class="muted">${rows.length} ${arEn("حساب","accounts")}</span></div>${areaId?reportExportActions(areaId):""}</div><div class="table-wrap"><table><thead><tr><th>${arEn("الكود","Code")}</th><th>${arEn("الحساب","Account")}</th><th>${arEn("مدين","Debit")}</th><th>${arEn("دائن","Credit")}</th><th>${arEn("صافي","Net")}</th></tr></thead><tbody>${body}<tr><th colspan="2">${arEn("الإجمالي","Total")}</th><th class="debit num">${fmt(td)}</th><th class="credit num">${fmt(tc)}</th><th class="num">${fmt(td-tc)}</th></tr></tbody></table></div>`;
}
function renderTrial(){
 const level=Number($("#trialLevel")?.value||5), hideZero=$("#trialHideZero")?.checked||false;
 const {openingMap,duringMap}=splitMaps($("#trialFrom")?.value||"",$("#trialTo")?.value||"");
 const rows=hierarchicalPivotRows(openingMap,duringMap,level,null,hideZero);
 $("#trialArea").innerHTML=reportTablePivot(arEn(`ميزان المراجعة — حتى المستوى ${level}`,`Trial Balance — up to Level ${level}`),rows,"trialArea");
}
function renderStatements(){
 const level=Number($("#stmtLevel")?.value||5), hideZero=$("#stmtHideZero")?.checked||false, map=journalMap($("#stmtFrom")?.value||"",$("#stmtTo")?.value||""), type=window.__statementType||"balanceSheet", area=$("#statementArea");
 if(type==="cash"){
  // "121" = النقد وما في حكمه (Cash & cash equivalents). Using "12" (Current Assets) would
  // wrongly pull in inventory, receivables, prepayments, VAT and guarantees.
  const cashPrefix="121";
  let rows=db.accounts.filter(a=>String(a.code).startsWith(cashPrefix)&&levelNo(a)<=level).sort((a,b)=>Number(a.code)-Number(b.code)).map(a=>({...a,...amountFor(a,map)}));
  if(hideZero) rows=rows.filter(a=>a.d||a.c);
  const fromVal=$("#stmtFrom")?.value||"";
  let opening=0;
  if(fromVal){const openingMap=journalMap("",prevDay(fromVal));opening=db.accounts.filter(a=>String(a.code).startsWith(cashPrefix)&&isLeaf(a)).reduce((s,a)=>s+amountFor(a,openingMap).n,0);}
  const netChange=db.accounts.filter(a=>String(a.code).startsWith(cashPrefix)&&isLeaf(a)).reduce((s,a)=>s+amountFor(a,map).n,0);
  area.innerHTML=reportTable(arEn(`قائمة التدفقات النقدية — حتى المستوى ${level}`,`Cash Flow Statement — up to Level ${level}`),rows,"statementArea")+
   `<div class="journal-summary" style="margin-top:14px"><div class="jsum"><span>${arEn('الرصيد الافتتاحي','Opening balance')}</span><b class="num">${fmt(opening)}</b></div><div class="jsum"><span>${arEn('صافي التغير خلال الفترة','Net change for period')}</span><b class="num">${fmt(netChange)}</b></div><div class="jsum"><span>${arEn('الرصيد الختامي','Closing balance')}</span><b class="num">${fmt(opening+netChange)}</b></div></div>`;
  return;
 }
 const statement=type==="income"?"قائمة الدخل":"المركز المالي";
 if(type==="equity"){
  // Restrict to balance-sheet accounts so income-statement items that merely contain the
  // word "أرباح" (e.g. "إيرادات أرباح بيع أصول ثابتة") don't leak into the equity statement.
  let rows=db.accounts.filter(a=>levelNo(a)<=level && a.statement==="المركز المالي" && (String(a.name).includes("حقوق")||String(a.name).includes("رأس")||String(a.name).includes("أرباح")||String(a.name).includes("خسائر"))).sort((a,b)=>Number(a.code)-Number(b.code)).map(a=>({...a,...amountFor(a,map)}));
  if(hideZero) rows=rows.filter(a=>a.d||a.c);
  area.innerHTML=reportTable(arEn(`قائمة التغيرات في حقوق الملكية — حتى المستوى ${level}`,`Statement of Changes in Equity — up to Level ${level}`),rows,"statementArea"); return;
 }
 const {openingMap,duringMap}=splitMaps($("#stmtFrom")?.value||"",$("#stmtTo")?.value||"");
 const rows=hierarchicalPivotRows(openingMap,duringMap,level,statement,hideZero);
 if(type==="balanceSheet"){
  // Revenue/expense accounts (statement "قائمة الدخل") are excluded from the balance sheet, so
  // as long as the year hasn't been formally closed into retained earnings, Assets will not
  // equal Liabilities + Equity — the accumulated result of the period is simply missing from
  // equity. Add it as a computed line (same debit/credit convention as the other pivot rows)
  // so the statement always satisfies the accounting equation.
  const p=periodResultPivot(openingMap,duringMap);
  if(!hideZero||p.od||p.oc||p.dd||p.dc||p.bd||p.bc){
   rows.push({code:"—",name:arEn("نتائج الأعمال غير المقفلة للفترة","Undistributed period result (unclosed)"),level:"الأول",...p});
  }
 }
 area.innerHTML=reportTablePivot(arEn(`${type==="income"?"قائمة الدخل":"قائمة المركز المالي"} — حتى المستوى ${level}`,`${type==="income"?"Income Statement":"Statement of Financial Position"} — up to Level ${level}`),rows,"statementArea");
}

function sumPrefix(prefix,from,to){
 const p=String(prefix); return db.journal.filter(x=>String(x.code).startsWith(p)&&(!from||x.date>=from)&&(!to||x.date<=to)).reduce((s,x)=>s+Number(x.debit||0)-Number(x.credit||0),0);
}
function taxCredit(prefix,from,to){return db.journal.filter(x=>String(x.code).startsWith(String(prefix))&&(!from||x.date>=from)&&(!to||x.date<=to)).reduce((s,x)=>s+Number(x.credit||0),0)}
function taxDebit(prefix,from,to){return db.journal.filter(x=>String(x.code).startsWith(String(prefix))&&(!from||x.date>=from)&&(!to||x.date<=to)).reduce((s,x)=>s+Number(x.debit||0),0)}
function taxReportRows(from,to){
 const output=taxCredit('2220201',from,to), input=taxDebit('1230101',from,to);
 const salesBase=output/0.15, purchasesBase=input/0.15;
 const net=output-input;
 return {output,input,salesBase,purchasesBase,net};
}
function renderVATReport(){
 const from=$('#repFrom')?.value||'',to=$('#repTo')?.value||'',v=taxReportRows(from,to),title=arEn('إقرار ضريبة القيمة المضافة — السعودية','Saudi Arabia VAT Return');
 const rows=[
  ['1',arEn('المبيعات الخاضعة للنسبة الأساسية 15%','Standard-rated sales 15%'),v.salesBase,v.output],
  ['2',arEn('المشتريات الخاضعة للنسبة الأساسية 15%','Standard-rated purchases 15%'),v.purchasesBase,v.input],
  ['3',arEn('ضريبة المخرجات','Output VAT'),0,v.output],
  ['4',arEn('ضريبة المدخلات القابلة للخصم','Deductible input VAT'),0,v.input],
  ['5',arEn('صافي ضريبة القيمة المضافة المستحقة / القابلة للاسترداد','Net VAT payable / refundable'),0,v.net]
 ];
 const body=rows.map(r=>`<tr><td>${r[0]}</td><td class="report-name">${r[1]}</td><td class="num">${fmt(r[2])}</td><td class="num">${fmt(r[3])}</td></tr>`).join('');
 $('#reportArea').innerHTML=`<div class="panel-head"><div><h3>${title}</h3><span class="muted">${arEn('الفترة','Period')}: ${esc(from||'—')} → ${esc(to||'—')} · ${arEn('النسبة الأساسية 15%','Standard rate 15%')}</span></div>${reportExportActions('reportArea')}</div><div class="tax-note">${arEn('تم بناء التقرير من حسابات ضريبة المخرجات والمدخلات المسجلة في القيود. يلزم تصنيف المعاملات الخاصة (صفرية/معفاة/عكسية/استيراد) ومراجعتها قبل التقديم النهائي إلى هيئة الزكاة والضريبة والجمارك.','Calculated from posted output/input VAT accounts. Special treatments (zero-rated, exempt, reverse charge, imports) must be classified and reviewed before final submission to ZATCA.')}</div><div class="table-wrap"><table><thead><tr><th>#</th><th>${arEn('البند','Item')}</th><th>${arEn('الوعاء','Taxable amount')}</th><th>${arEn('الضريبة','VAT')}</th></tr></thead><tbody>${body}</tbody></table></div><div class="journal-summary tax-summary"><div class="jsum"><span>${arEn('ضريبة المخرجات','Output VAT')}</span><b>${fmt(v.output)} SAR</b></div><div class="jsum"><span>${arEn('ضريبة المدخلات','Input VAT')}</span><b>${fmt(v.input)} SAR</b></div><div class="jsum"><span>${v.net>=0?arEn('المستحق','Payable'):arEn('القابل للاسترداد','Refundable')}</span><b>${fmt(Math.abs(v.net))} SAR</b></div></div>`;
}
function renderZakatReport(){
 const year=$('#repTo')?.value?.slice(0,4)||new Date().getFullYear(),from=`${year}-01-01`,to=`${year}-12-31`;
 const map=journalMap(from,to), endMap=journalMap('',to), amount=code=>{const a=db.accounts.find(x=>String(x.code)===String(code));return a?amountFor(a,endMap).n:0};
 // amountFor()/amount() return debit-minus-credit. Equity accounts are credit-normal, so that
 // is the *negative* of the true equity value — flip it (credit-minus-debit) or a company with
 // positive equity would show a negative "equity at year end" here.
 const equity=db.accounts.filter(a=>String(a.code).startsWith('3')&&isLeaf(a)).reduce((s,a)=>s-amount(a.code),0);
 // Same inversion for revenue/expense: debit-minus-credit is positive for an expense and
 // negative for revenue, i.e. it is the negative of true profit — a loss would display as a
 // positive "net profit". Flip it so profit is positive and a loss is negative, as labeled.
 const netIncome=db.accounts.filter(a=>String(a.code).startsWith('4')||String(a.code).startsWith('5')).filter(isLeaf).reduce((s,a)=>s-amountFor(a,endMap).n,0);
 // Fixed assets must be netted (cost minus accumulated depreciation/contra-asset accounts),
 // not summed by absolute value — Math.abs() on each leaf was ADDING accumulated depreciation
 // to the deduction instead of subtracting it, overstating the deduction.
 const fixedAssets=db.accounts.filter(a=>String(a.code).startsWith('11')&&isLeaf(a)).reduce((s,a)=>s+amount(a.code),0);
 const zakatBase=Math.max(0,equity+netIncome-fixedAssets), zakat=zakatBase*0.025;
 const title=arEn(`مسودة إقرار الزكاة السنوي — ${year}`,`Annual Zakat Return Worksheet — ${year}`);
 const rows=[
 ['1',arEn('حقوق الملكية في نهاية السنة','Equity at year-end'),equity],
 ['2',arEn('صافي الربح / (الخسارة) — النتيجة المتراكمة غير المقفلة حتى نهاية السنة','Net profit / (loss) — cumulative unclosed result to year-end'),netIncome],
 ['3',arEn('الأصول الثابتة — خصم أولي','Fixed assets — preliminary deduction'),-fixedAssets],
 ['4',arEn('الوعاء الزكوي المبدئي','Preliminary Zakat base'),zakatBase],
 ['5',arEn('الزكاة التقديرية بنسبة 2.5%','Indicative Zakat at 2.5%'),zakat],
 ['—',arEn('للاطلاع فقط: أرصدة الأطراف ذات العلاقة الدائنة (224) — غير مضافة للوعاء، راجعها مع المحاسب القانوني','For review only: related-party credit balances (224) — not added to the base, review with your auditor'),db.accounts.filter(a=>String(a.code).startsWith('224')&&isLeaf(a)).reduce((s,a)=>s-amount(a.code),0)]
 ];
 const body=rows.map(r=>`<tr><td>${r[0]}</td><td class="report-name">${r[1]}</td><td class="num">${fmt(r[2])}</td></tr>`).join('');
 $('#reportArea').innerHTML=`<div class="panel-head"><div><h3>${title}</h3><span class="muted">${arEn('سنة مالية','Fiscal year')}: ${year}</span></div>${reportExportActions('reportArea')}</div><div class="tax-note">${arEn('هذه مسودة عمل مبنية على البيانات المحاسبية وليست إقراراً زكوياً نهائياً. المعالجة الزكوية الفعلية تعتمد على تصنيف كل بند وفق اللائحة التنفيذية وقواعد الهيئة، ويجب مراجعتها قبل التقديم.','This is a working worksheet, not a final ZATCA filing. Actual Zakat treatment depends on item-by-item classification under ZATCA regulations and must be reviewed before submission.')}</div><div class="table-wrap"><table><thead><tr><th>#</th><th>${arEn('البند','Item')}</th><th>${arEn('المبلغ (ريال)','Amount (SAR)')}</th></tr></thead><tbody>${body}</tbody></table></div><div class="journal-summary tax-summary"><div class="jsum"><span>${arEn('الوعاء الزكوي المبدئي','Preliminary Zakat base')}</span><b>${fmt(zakatBase)} SAR</b></div><div class="jsum"><span>${arEn('الزكاة المبدئية','Preliminary Zakat')}</span><b>${fmt(zakat)} SAR</b></div><div class="jsum"><span>${arEn('موعد الإقرار','Filing window')}</span><b>${arEn('خلال 120 يوماً من نهاية السنة الزكوية','Within 120 days from Zakat year-end')}</b></div></div>`;
}
function renderReports(){
 const level=Number($("#repLevel")?.value||5), hideZero=$("#repHideZero")?.checked||false, from=$("#repFrom")?.value||"", to=$("#repTo")?.value||"", type=window.__reportType||"trial";
 if(type==="vat"){renderVATReport();return;}
 if(type==="zakat"){renderZakatReport();return;}
 if(type==="trial"){
  const {openingMap,duringMap}=splitMaps(from,to);
  $("#reportArea").innerHTML=reportTablePivot(arEn(`ميزان المراجعة — حتى المستوى ${level}`,`Trial Balance — up to Level ${level}`),hierarchicalPivotRows(openingMap,duringMap,level,null,hideZero),"reportArea");
  return;
 }
 const map=journalMap(from,to);
 $("#reportArea").innerHTML=reportTable(arEn(`أرصدة الحسابات — حتى المستوى ${level}`,`Account Balances — up to Level ${level}`),hierarchicalRows(map,level,null,hideZero),"reportArea");
}

window.closeModal=()=>$("#modalBack").classList.remove("show");
function backup(){const blob=new Blob([JSON.stringify(db,null,2)],{type:"application/json"});const a=document.createElement("a");a.href=URL.createObjectURL(blob);a.download="Mostafa_Accounting_Backup.json";a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000)}
function exportWholeReport(areaId, mode){
 const target=$(areaId.startsWith("#")?areaId:`#${areaId}`); if(!target){toast(arEn('لا توجد بيانات للتصدير','No data to export'));return;}
 if(mode==='print'||mode==='pdf') return printReportArea(areaId);
 return exportReportExcel(areaId);
}

function nextId(prefix,list){
 // Highest existing number + 1 (not list.length + 1) so ids never repeat after a deletion or gap.
 let max=0; (list||[]).forEach(x=>{const m=String(x?.id||'').match(/(\d+)$/); if(m&&String(x.id).startsWith(prefix)) max=Math.max(max,Number(m[1]));});
 return prefix+String(Math.max(max,0)+1).padStart(5,"0");
}
function linkedDocFor(entry){
 const e=String(entry);
 return db.invoices.find(i=>String(i.journalEntry)===e)||db.collections.find(c=>String(c.journalEntry)===e)||null;
}
function guardLinkedEntry(entry){
 const d=linkedDocFor(entry); if(!d) return false;
 toast(arEn(`هذا القيد مرتبط بـ ${d.id} ولا يُعدَّل أو يُحذف من شاشة القيود حتى لا يختلف رصيد العميل عن الأستاذ. عدّله من شاشة العملاء والمبيعات.`,`This entry belongs to ${d.id} and can't be edited/deleted from Journal, so customer balances stay consistent with the ledger. Use Customers & Sales.`));
 return true;
}
function ensureSalesAccounts(){
  // Do not create accounting accounts automatically. Posting accounts must already exist in the chart.
  return {
    ar:db.accounts.find(a=>Number(a.code)===124),
    sales:db.accounts.find(a=>Number(a.code)===4110101),
    vat:db.accounts.find(a=>Number(a.code)===2220201),
    cash:db.accounts.find(a=>Number(a.code)===1210102)
  };
}
function customerOptions(){return db.customers.map(c=>`<option value="${esc(c.id)}">${esc(c.name)} — ${esc(c.taxNo||"")}</option>`).join("")}
function renderCustomers(){
 const a=$("#customerArea"); if(!a)return;
 if(currentCustomerTab==='customers') a.innerHTML=`<div class="panel-head"><h3>${arEn("قائمة العملاء","Customer List")}</h3></div><div class="table-wrap"><table><thead><tr><th>#</th><th>${arEn("الاسم","Name")}</th><th>${arEn("الرقم الضريبي","VAT No.")}</th><th>${arEn("الهاتف","Phone")}</th><th>${arEn("الرصيد","Balance")}</th><th></th></tr></thead><tbody>${db.customers.map(c=>{const bal=db.invoices.filter(i=>i.customerId===c.id).reduce((s,i)=>s+i.total,0)-db.collections.filter(x=>x.customerId===c.id).reduce((s,x)=>s+x.amount,0);return `<tr><td>${esc(c.id)}</td><td>${esc(c.name)}</td><td>${esc(c.taxNo||'—')}</td><td>${esc(c.phone||'—')}</td><td class="num">${fmt(bal)} SAR</td><td><button class="soft-btn" onclick="openCustomerModal('${esc(c.id)}')">✎</button></td></tr>`}).join('')||`<tr><td colspan="6" class="empty">${arEn('لا يوجد عملاء','No customers')}</td></tr>`}</tbody></table></div>`;
 else if(currentCustomerTab==='orders') a.innerHTML=`<div class="table-wrap"><table><thead><tr><th>${arEn('رقم الأمر','Order No.')}</th><th>${arEn('العميل','Customer')}</th><th>${arEn('التاريخ','Date')}</th><th>${arEn('الإجمالي','Total')}</th><th></th></tr></thead><tbody>${db.salesOrders.map(o=>`<tr><td>${esc(o.id)}</td><td>${esc(db.customers.find(c=>c.id===o.customerId)?.name||'')}</td><td>${esc(o.date)}</td><td>${fmt(o.total)} SAR</td><td><button class="soft-btn" onclick="openSalesOrderModal('${esc(o.id)}')">👁</button></td></tr>`).join('')||`<tr><td colspan="5" class="empty">${arEn('لا توجد أوامر بيع','No sales orders')}</td></tr>`}</tbody></table></div>`;
 else if(currentCustomerTab==='invoices') a.innerHTML=`<div class="table-wrap"><table><thead><tr><th>${arEn('رقم الفاتورة','Invoice No.')}</th><th>${arEn('العميل','Customer')}</th><th>${arEn('التاريخ','Date')}</th><th>${arEn('قبل الضريبة','Subtotal')}</th><th>VAT</th><th>${arEn('الإجمالي','Total')}</th><th>${arEn('المتبقي','Due')}</th><th></th></tr></thead><tbody>${db.invoices.map(i=>{const paid=db.collections.filter(x=>x.invoiceId===i.id).reduce((s,x)=>s+x.amount,0);return `<tr><td>${esc(i.id)}</td><td>${esc(db.customers.find(c=>c.id===i.customerId)?.name||'')}</td><td>${esc(i.date)}</td><td>${fmt(i.subtotal)}</td><td>${fmt(i.vat)}</td><td>${fmt(i.total)}</td><td>${fmt(Math.max(0,i.total-paid))}</td><td><button class="gold-btn" onclick="openCollectionModal('${esc(i.id)}')">${arEn('تحصيل','Pay')}</button></td></tr>`}).join('')||`<tr><td colspan="8" class="empty">${arEn('لا توجد فواتير','No invoices')}</td></tr>`}</tbody></table></div>`;
 else a.innerHTML=`<div class="table-wrap"><table><thead><tr><th>${arEn('رقم التحصيل','Receipt')}</th><th>${arEn('الفاتورة','Invoice')}</th><th>${arEn('العميل','Customer')}</th><th>${arEn('التاريخ','Date')}</th><th>${arEn('المبلغ','Amount')}</th></tr></thead><tbody>${db.collections.map(x=>`<tr><td>${esc(x.id)}</td><td>${esc(x.invoiceId)}</td><td>${esc(db.customers.find(c=>c.id===x.customerId)?.name||'')}</td><td>${esc(x.date)}</td><td>${fmt(x.amount)} SAR</td></tr>`).join('')||`<tr><td colspan="5" class="empty">${arEn('لا توجد تحصيلات','No collections')}</td></tr>`}</tbody></table></div>`;
}
function customerParentOptions(selected){
 const customersRoot=db.accounts.find(a=>Number(a.code)===124);
  const parents=customersRoot?db.accounts.filter(a=>Number(parentCode(a.code))===124 && a.type==='رئيسي').sort((a,b)=>Number(a.code)-Number(b.code)):[];
 return parents.map(a=>`<option value="${esc(a.code)}" ${String(a.code)===String(selected||'')?'selected':''}>${esc(a.code)} — ${esc(a.name)}</option>`).join('');
}
function customerForm(id){
 const c=id&&db.customers.find(x=>x.id===id);
 const customersRoot=db.accounts.find(a=>Number(a.code)===124);
  const parents=customersRoot?db.accounts.filter(a=>Number(parentCode(a.code))===124 && a.type==='رئيسي'):[];
 return `<h3>${c?arEn('تعديل عميل','Edit Customer'):arEn('إضافة عميل','New Customer')}</h3>
 <div class="form-grid">
  <div class="field"><label>${arEn('اسم العميل','Customer name')}</label><input id="cName" value="${esc(c?.name||'')}"></div>
  <div class="field"><label>${arEn('الرقم الضريبي','VAT number')}</label><input id="cTax" value="${esc(c?.taxNo||'')}"></div>
  <div class="field"><label>${arEn('الهاتف','Phone')}</label><input id="cPhone" value="${esc(c?.phone||'')}"></div>
  <div class="field"><label>${arEn('العنوان','Address')}</label><input id="cAddress" value="${esc(c?.address||'')}"></div>
  <div class="field"><label>${arEn('حساب العملاء الرئيسي','Customer parent account')}</label>
   <select id="cParent" ${c?.accountCode?'disabled':''}>${customerParentOptions(c?.parentCode||'')}</select>
   <small class="muted">${arEn('اختر الحساب الرئيسي المفتوح مسبقاً تحت الأصول المتداولة / العملاء. سيتم إنشاء كود العميل داخله فقط.','Choose an existing parent under Current Assets / Customers. The customer code will be generated inside it.')}</small>
  </div>
 </div>
 <div class="modal-foot"><button class="gold-btn" id="saveCustomer">${arEn('حفظ','Save')}</button><button class="soft-btn" onclick="closeModal()">${arEn('إلغاء','Cancel')}</button></div>`;
}
window.openCustomerModal=id=>{const m=$("#modal");m.innerHTML=customerForm(id);$("#modalBack").classList.add('show');$("#saveCustomer").onclick=()=>{
 const name=$("#cName").value.trim(),taxNo=$("#cTax").value.trim(),phone=$("#cPhone").value.trim(),address=$("#cAddress").value.trim();
 if(!name)return toast(arEn('أدخل اسم العميل','Enter customer name'));
 let c=id&&db.customers.find(x=>x.id===id);
 if(!c){const parentCodeVal=Number($("#cParent").value); const parent=db.accounts.find(a=>Number(a.code)===parentCodeVal); if(!parent || Number(parentCode(parent.code))!==124 || parent.type!=='رئيسي')return toast(arEn('يجب اختيار حساب رئيسي موجود مباشرة تحت الأصول المتداولة / العملاء','Select an existing main account directly under Current Assets / Customers')); c={id:nextId('CUS-',db.customers),name,taxNo,phone,address,parentCode:parentCodeVal}; ensureCustomerAccount(c,parent); db.customers.push(c);}
 else Object.assign(c,{name,taxNo,phone,address});
 save();closeModal();renderCustomers();toast(arEn('تم حفظ العميل داخل شجرة العملاء','Customer saved inside the customer chart branch'))
}}
function ensureCustomerAccount(c,parent){
 if(c.accountCode){const old=db.accounts.find(a=>Number(a.code)===Number(c.accountCode));if(old){old.name=c.name;return old}}
 const kids=childrenOf(parent.code).filter(a=>a.type==='فرعي');
 let code=nextCodeForParent(parent); if(!code) throw new Error('Invalid customer parent');
 while(db.accounts.some(a=>Number(a.code)===Number(code))) code++;
 const a={code,name:c.name,nature:'مدين',statement:'المركز المالي',level:'الخامس',type:'فرعي',statementTab:parent.name,mainTab:'العملاء',customerId:c.id,parentCode:Number(parent.code)};
 db.accounts.push(a);c.accountCode=code;c.parentCode=Number(parent.code);return a;
}
function leafAccountOptions(defaultCode, filterFn){
 return db.accounts.filter(a=>isLeaf(a)&&(!filterFn||filterFn(a))).sort((a,b)=>Number(a.code)-Number(b.code)).map(a=>`<option value="${esc(a.code)}" ${Number(a.code)===Number(defaultCode)?'selected':''}>${esc(a.code)} — ${esc(a.name)}</option>`).join('');
}
function guessAccount(...words){return db.accounts.find(a=>isLeaf(a)&&words.some(w=>String(a.name||'').includes(w)))}
const INVOICE_ITEM_OPTIONS=['حارس امن','مشرف امن','حارسة امن','مدير مشروع','سيارة','اخرى'];
function invoiceItemRows(inv){
 const items=Array.isArray(inv?.items)&&inv.items.length?inv.items:[{item:inv?.service||'حارس امن',qty:inv?.guards||1,hours:inv?.hours||8,days:inv?.days||30,unitPrice:inv?.rate||0}];
 return items.map((it,i)=>`<tr class="invoice-item-row" data-row="${i}">
  <td class="invoice-line-no">${i+1}</td>
  <td><select class="iItem">${INVOICE_ITEM_OPTIONS.map(x=>`<option ${String(x)===String(it.item||'')?'selected':''} value="${esc(x)}">${esc(arEn(x,({ 'حارس امن':'Security Guard','مشرف امن':'Security Supervisor','حارسة امن':'Female Security Guard','مدير مشروع':'Project Manager','سيارة':'Vehicle','اخرى':'Other'})[x]||x))}</option>`).join('')}</select></td>
  <td><input class="iQty" type="number" min="0" step="0.01" value="${Number(it.qty??1)}"></td>
  <td><select class="iHours">${[6,8].map(h=>`<option value="${h}" ${((Number(it.hours)===6?6:8)===h)?'selected':''}>${h}</option>`).join('')}</select></td>
  <td><input class="iDays" type="number" min="1" step="1" value="${Number(it.days??30)}"></td>
  <td><input class="iUnitPrice" type="number" min="0" step="0.01" value="${Number(it.unitPrice??it.rate??0)}"></td>
  <td class="invoice-line-total num">0.00</td>
  <td><button type="button" class="icon-btn invoice-remove-row" title="${arEn('حذف الصنف','Remove item')}">✕</button></td>
 </tr>`).join('');
}
function invoiceFormPage(id){
 const inv=id&&db.invoices.find(x=>x.id===id); const c=inv&&db.customers.find(x=>x.id===inv.customerId);
 const sales= db.accounts.find(a=>Number(a.code)===4110101) || guessAccount('إيرادات','مبيعات','Sales');
 const vat= db.accounts.find(a=>Number(a.code)===2220201) || guessAccount('ضريبة القيمة المضافة على المخرجات','VAT');
 const discount=guessAccount('خصم','Discount'), penalty=guessAccount('جزاء','غرام'), extra=guessAccount('إضاف','Additional');
 const invoiceNo=inv?.id||nextId('INV-',db.invoices); const today=inv?.date||new Date().toISOString().slice(0,10);
 const customer=c||db.customers[0];
 return `<div class="tax-invoice-page">
  <div class="tax-invoice-toolbar">
   <div><span class="kicker">TAX INVOICE</span><h2>${arEn('فاتورة ضريبية','Tax Invoice')}</h2><p>${arEn('نموذج فاتورة ضريبية مستقل قابل للتحرير والطباعة.','Standalone editable tax invoice ready for printing.')}</p></div>
   <div class="invoice-toolbar-actions"><button class="soft-btn" onclick="openView('customers')">← ${arEn('العودة','Back')}</button></div>
  </div>
  <div class="tax-paper" id="taxInvoicePaper">
   <div class="tax-header">
    <div class="tax-company"><div class="company-logo">FJ</div><div><h1>${esc(inv?.sellerName||sellerDefaults().name)}</h1><b>${arEn('فاتورة ضريبية','Tax Invoice')}</b><span>Tax Invoice</span></div></div>
    <div class="tax-qr"><div id="taxQrBox" class="tax-qr-box"></div><small>${arEn('رمز الفاتورة الضريبية (ZATCA)','Tax invoice QR (ZATCA)')}</small></div>
    <div class="tax-meta"><label>${arEn('رقم الفاتورة','Invoice No.')}</label><input id="iInvoiceNo" value="${esc(invoiceNo)}" ${inv?'disabled':''}>
      <label>${arEn('تاريخ الإصدار','Issue Date')}</label><input type="date" id="iDate" value="${today}">
      <label>${arEn('وقت الإصدار','Issue Time')}</label><input id="iTime" value="${esc(inv?.time||new Date().toLocaleTimeString('en-US',{hour:'numeric',minute:'2-digit'}))}">
      <label>${arEn('تاريخ التوريد','Supply Date')}</label><input type="date" id="iSupplyDate" value="${inv?.supplyDate||today}">
    </div>
   </div>
   <div class="tax-parties">
    <div class="party-box"><div class="party-title">${arEn('البائع','Seller')}</div>
      <label>${arEn('اسم البائع','Seller Name')}</label><input id="iSellerName" value="${esc(inv?.sellerName||sellerDefaults().name)}">
      <label>${arEn('العنوان','Address')}</label><textarea id="iSellerAddress">${esc(inv?.sellerAddress||sellerDefaults().addr)}</textarea>
      <label>${arEn('الرقم الضريبي','VAT No.')}</label><input id="iSellerVat" value="${esc(inv?.sellerVat??sellerDefaults().vat)}">
      <label>${arEn('الرقم التجاري','CR No.')}</label><input id="iSellerCr" value="${esc(inv?.sellerCr??sellerDefaults().cr)}">
    </div>
    <div class="party-box"><div class="party-title">${arEn('المشتري','Buyer')}</div>
      <label>${arEn('اسم المشتري','Buyer Name')}</label><select id="iCustomer">${customerOptions()}</select>
      <label>${arEn('العنوان','Address')}</label><textarea id="iBuyerAddress">${esc(c?.address||'')}</textarea>
      <label>${arEn('الرقم الضريبي','VAT No.')}</label><input id="iBuyerVat" value="${esc(c?.taxNo||'')}">
      <label>${arEn('رقم العميل','Customer ID')}</label><input id="iBuyerId" value="${esc(c?.id||'')}">
    </div>
   </div>
   <div class="tax-invoice-fields">
    <div class="field"><label>${arEn('أمر البيع / الرقم المرجعي','Sales Order / Reference')}</label><input id="iOrder" value="${esc(inv?.orderId||'')}"></div>
    <div class="field"><label>${arEn('البيان العام','Description')}</label><input id="iDesc" value="${esc(inv?.desc||'خدمات أمنية')}"></div>
   </div>
   <div class="invoice-items-head"><h3>${arEn('تفاصيل الفاتورة','Invoice Items')}</h3><button type="button" class="gold-btn" id="addInvoiceItem">＋ ${arEn('إضافة صنف','Add Item')}</button></div>
   <div class="table-wrap invoice-items-wrap"><table class="tax-items-table"><thead><tr><th>#</th><th>${arEn('الصنف','Item')}</th><th>${arEn('الكمية','Qty')}</th><th>${arEn('الساعات','Hours')}</th><th>${arEn('عدد الأيام','Days')}</th><th>${arEn('سعر الفرد / اليوم','Unit Price / Person / Day')}</th><th>${arEn('المبلغ المستحق','Amount Due')}</th><th></th></tr></thead><tbody id="invoiceItemsBody">${invoiceItemRows(inv)}</tbody></table></div>
   <div class="tax-bottom-grid">
    <div class="tax-account-lines">
      <div class="account-line"><span>${arEn('حساب العميل (مدين)','Customer Account (Debit)')}</span><select id="iCustomerAccount" disabled>${c?`<option value="${esc(c.accountCode)}">${esc(c.accountCode)} — ${esc(c.name)}</option>`:''}</select></div>
      <div class="account-line"><span>${arEn('حساب الإيراد (دائن)','Revenue Account (Credit)')}</span><select id="iSalesAccount">${leafAccountOptions(sales?.code,a=>{const code=Number(a.code),name=String(a.name||'');return code===4110101||((String(code).startsWith('4'))&&/إيراد|مبيع|sales|revenue/i.test(name)&&!/مردود|return/i.test(name));})}</select></div>
      <div class="account-line"><span>${arEn('ضريبة القيمة المضافة (دائن)','Output VAT (Credit)')}</span><select id="iVatAccount">${leafAccountOptions(vat?.code,a=>Number(a.code)===2220201||/ضريبة.*مخرج|output.*vat/i.test(a.name||''))}</select></div>
    </div>
    <div class="invoice-totals-box">
      <div><span>${arEn('إجمالي قبل الخصم','Gross Total')}</span><b id="sumGross">0.00 SAR</b></div>
      <div><span>${arEn('الخصومات','Discount')}</span><input id="iDiscount" type="number" min="0" step="0.01" value="${inv?.discount||0}"></div>
      <div><span>${arEn('الجزاءات','Penalty')}</span><input id="iPenalty" type="number" min="0" step="0.01" value="${inv?.penalty||0}"></div>
      <div><span>${arEn('الإضافي','Additional')}</span><input id="iExtra" type="number" min="0" step="0.01" value="${inv?.extra||0}"></div>
      <div><span>${arEn('المبلغ الخاضع للضريبة','Taxable Amount')}</span><b id="sumBefore">0.00 SAR</b></div>
      <div><span>${arEn('ضريبة القيمة المضافة 15%','VAT 15%')}</span><b id="sumVat">0.00 SAR</b></div>
      <div class="grand"><span>${arEn('الإجمالي بعد الضريبة','Total after VAT')}</span><b id="sumTotal">0.00 SAR</b></div>
    </div>
   </div>
   <div class="invoice-adjustment-accounts">
    <div class="field"><label>${arEn('حساب الخصم','Discount Account')}</label><select id="iDiscountAccount">${leafAccountOptions(discount?.code,a=>/خصم|discount/i.test(a.name||''))}</select></div>
    <div class="field"><label>${arEn('حساب الجزاءات','Penalty Account')}</label><select id="iPenaltyAccount">${leafAccountOptions(penalty?.code,a=>/جزاء|غرام|penalt|fine/i.test(a.name||''))}</select></div>
    <div class="field"><label>${arEn('حساب الإضافي','Additional Account')}</label><select id="iExtraAccount">${leafAccountOptions(extra?.code,a=>/إضاف|additional/i.test(a.name||''))}</select></div>
   </div>
   <div class="tax-invoice-actions"><button class="gold-btn" id="saveInvoicePage">💾 ${arEn('حفظ وإصدار الفاتورة','Save & Issue')}</button><button class="soft-btn" id="printInvoicePage">🖨 ${arEn('طباعة','Print')}</button><button class="soft-btn" id="pdfInvoicePage">PDF</button><button class="soft-btn" id="excelInvoicePage">Excel</button><button class="soft-btn" onclick="openView('customers')">✕ ${arEn('إلغاء','Cancel')}</button></div>
  </div>
 </div>`;
}
function sellerDefaults(){
 // Company details are typed once; later invoices reuse the last issued invoice's seller block.
 const last=[...db.invoices].reverse().find(i=>i.sellerName||i.sellerVat)||{};
 return {name:last.sellerName||'شركة فخر الجزيرة للحراسات الأمنية',addr:last.sellerAddress||'مكة المكرمة، المملكة العربية السعودية',vat:last.sellerVat||'',cr:last.sellerCr||'4031263286'};
}
function updateInvoiceQR(total,vat){
 const box=document.getElementById('taxQrBox'); if(!box||!window.ZatcaQR) return;
 try{
  const date=$('#iDate')?.value||new Date().toISOString().slice(0,10);
  const m=String($('#iTime')?.value||'').match(/(\d{1,2}):(\d{2})\s*([AaPpصم])?/);
  let hh=m?Number(m[1]):0; const mm=m?m[2]:'00';
  if(m&&m[3]){const pm=/[Ppم]/.test(m[3]); if(pm&&hh<12)hh+=12; if(!pm&&hh===12)hh=0;}
  const ts=`${date}T${String(hh).padStart(2,'0')}:${mm}:00Z`;
  const tlv=window.ZatcaQR.zatcaTLV(($('#iSellerName')?.value||'').trim(),($('#iSellerVat')?.value||'').trim(),ts,r2(total).toFixed(2),r2(vat).toFixed(2));
  box.innerHTML=window.ZatcaQR.qrSvg(tlv,112);
 }catch(err){console.warn('QR generation failed',err);box.innerHTML='';}
}
function readInvoiceItems(){
 return [...document.querySelectorAll('.invoice-item-row')].map(row=>({item:row.querySelector('.iItem')?.value||'اخرى',qty:Number(row.querySelector('.iQty')?.value||0),hours:Number(row.querySelector('.iHours')?.value||8),days:Number(row.querySelector('.iDays')?.value||30),unitPrice:Number(row.querySelector('.iUnitPrice')?.value||0)}));
}
function recalcInvoicePage(){
 const items=readInvoiceItems(); let gross=0;
 document.querySelectorAll('.invoice-item-row').forEach((row,i)=>{const x=items[i]||{};const amount=r2((x.qty||0)*(x.days||0)*(x.unitPrice||0));gross=r2(gross+amount);const cell=row.querySelector('.invoice-line-total');if(cell)cell.textContent=fmt(amount)+' SAR';});
 const discount=r2($('#iDiscount')?.value),penalty=r2($('#iPenalty')?.value),extra=r2($('#iExtra')?.value);
 const line=gross, before=r2(Math.max(0,gross-discount+penalty+extra)),vat=r2(before*.15),total=r2(before+vat);
 if($('#sumGross'))$('#sumGross').textContent=fmt(gross)+' SAR'; if($('#sumBefore'))$('#sumBefore').textContent=fmt(before)+' SAR'; if($('#sumVat'))$('#sumVat').textContent=fmt(vat)+' SAR'; if($('#sumTotal'))$('#sumTotal').textContent=fmt(total)+' SAR'; updateInvoiceQR(total,vat); return {items,gross,guards:items.reduce((s,x)=>s+(x.qty||0),0),hours:items.reduce((s,x)=>s+(x.hours||0),0),days:items.reduce((s,x)=>s+(x.days||0),0),rate:items[0]?.unitPrice||0,line,discount,penalty,extra,before,vat,total};
}
function openInvoicePage(id){
 if(!db.customers.length){toast(arEn('أضف عميلاً أولاً','Add a customer first'));return}
 openView('invoicePage'); const area=$('#invoicePageArea'); area.innerHTML=invoiceFormPage(id); const inv=id&&db.invoices.find(x=>x.id===id);
 if(inv)$('#iCustomer').value=inv.customerId||''; else if(db.customers[0])$('#iCustomer').value=db.customers[0].id;
 const syncCustomer=()=>{const c=db.customers.find(x=>x.id===$('#iCustomer')?.value);if(!c)return;$('#iBuyerAddress').value=c.address||'';$('#iBuyerVat').value=c.taxNo||'';$('#iBuyerId').value=c.id||'';const ca=$('#iCustomerAccount');if(ca)ca.innerHTML=`<option value="${esc(c.accountCode||'')}">${esc(c.accountCode||'')} — ${esc(c.name)}</option>`;};
 $('#iCustomer')?.addEventListener('change',syncCustomer);syncCustomer();
 const bind=()=>{document.querySelectorAll('.iQty,.iHours,.iDays,.iUnitPrice,#iDiscount,#iPenalty,#iExtra,#iSellerName,#iSellerVat,#iDate,#iTime').forEach(el=>{el.addEventListener('input',recalcInvoicePage);el.addEventListener('change',recalcInvoicePage);});document.querySelectorAll('.invoice-remove-row').forEach(b=>b.addEventListener('click',()=>{if(document.querySelectorAll('.invoice-item-row').length<=1)return;b.closest('tr').remove();reindexInvoiceRows();recalcInvoicePage();}));};
 const reindex=()=>{document.querySelectorAll('.invoice-item-row').forEach((r,i)=>{const n=r.querySelector('.invoice-line-no');if(n)n.textContent=i+1;});bind();recalcInvoicePage();}; window.reindexInvoiceRows=reindex;
 $('#addInvoiceItem')?.addEventListener('click',()=>{const body=$('#invoiceItemsBody');const n=body.querySelectorAll('.invoice-item-row').length;const tr=document.createElement('tr');tr.className='invoice-item-row';tr.innerHTML=`<td class="invoice-line-no">${n+1}</td><td><select class="iItem">${INVOICE_ITEM_OPTIONS.map(x=>`<option value="${esc(x)}">${esc(arEn(x,({ 'حارس امن':'Security Guard','مشرف امن':'Security Supervisor','حارسة امن':'Female Security Guard','مدير مشروع':'Project Manager','سيارة':'Vehicle','اخرى':'Other'})[x]||x))}</option>`).join('')}</select></td><td><input class="iQty" type="number" min="0" step="0.01" value="1"></td><td><select class="iHours"><option value="6">6</option><option value="8" selected>8</option></select></td><td><input class="iDays" type="number" min="1" step="1" value="30"></td><td><input class="iUnitPrice" type="number" min="0" step="0.01" value="0"></td><td class="invoice-line-total num">0.00</td><td><button type="button" class="icon-btn invoice-remove-row">✕</button></td>`;body.appendChild(tr);bind();recalcInvoicePage();});
 bind();recalcInvoicePage(); $('#saveInvoicePage').onclick=()=>postInvoicePage(id);
 $('#printInvoicePage').onclick=()=>{document.body.classList.add('invoice-printing');window.print();setTimeout(()=>document.body.classList.remove('invoice-printing'),500)};
 $('#pdfInvoicePage').onclick=()=>{document.body.classList.add('invoice-printing');window.print();setTimeout(()=>document.body.classList.remove('invoice-printing'),500)};
 $('#excelInvoicePage').onclick=()=>exportInvoiceExcel(id);
}
window.openInvoiceModal=id=>openInvoicePage(id);
function postInvoicePage(id){
 const cid=$('#iCustomer').value,c=db.customers.find(x=>x.id===cid); const vals=recalcInvoicePage();
 if(!c||vals.before<=0)return toast(arEn('أدخل بيانات الفاتورة بشكل صحيح','Enter valid invoice data'));
 const salesCode=Number($('#iSalesAccount').value),vatCode=Number($('#iVatAccount').value); if(!salesCode||!vatCode)return toast(arEn('اختر حساب الإيراد وضريبة المخرجات من الشجرة','Choose revenue and output VAT accounts from the chart'));
 const custAccount=db.accounts.find(a=>Number(a.code)===Number(c.accountCode)); if(!custAccount)return toast(arEn('حساب العميل غير موجود داخل الشجرة','Customer account is missing from the chart'));
 const salesAccount=db.accounts.find(a=>Number(a.code)===salesCode); if(!salesAccount)return toast(arEn('حساب الإيراد غير موجود داخل الشجرة','Revenue account is missing from the chart'));
 if(/مردود|return/i.test(String(salesAccount.name||'')))return toast(arEn('لا يجوز ترحيل إيراد الفاتورة إلى حساب مردودات المبيعات. يتم ترحيل الفاتورة على حساب العميل نفسه كمدين، وحساب الإيراد كدائن.','Invoice revenue cannot be posted to Sales Returns. The invoice is posted to the customer account as debit and the revenue account as credit.'));
 const sellerVat=($('#iSellerVat')?.value||'').trim();
 if(!/^3\d{13}3$/.test(sellerVat)&&!confirm(arEn('الرقم الضريبي للبائع غير مكتمل أو غير صحيح (15 رقماً يبدأ وينتهي بالرقم 3). الفاتورة الضريبية بدونه لا تُعتمد نظامياً. هل تريد المتابعة على أي حال؟','Seller VAT number is missing/invalid (15 digits, starts and ends with 3). A tax invoice without it is not valid. Continue anyway?')))return;
 const lines=[]; lines.push({code:custAccount.code,debit:vals.total,credit:0}); lines.push({code:salesCode,debit:0,credit:vals.line}); lines.push({code:vatCode,debit:0,credit:vals.vat});
 const addLine=(inputId,acctId,debit,credit)=>{const amount=Number($(inputId)?.value||0),code=Number($(acctId)?.value||0);if(amount>0&&code)lines.push({code,debit,credit});};
 if(vals.discount>0&&!Number($('#iDiscountAccount').value))return toast(arEn('اختر حساب الخصم من الشجرة','Choose a discount account from the chart')); if(vals.penalty>0&&!Number($('#iPenaltyAccount').value))return toast(arEn('اختر حساب الجزاءات من الشجرة','Choose a penalty account from the chart')); if(vals.extra>0&&!Number($('#iExtraAccount').value))return toast(arEn('اختر حساب الإضافي من الشجرة','Choose an additional account from the chart'));
 addLine('#iDiscount','#iDiscountAccount',vals.discount,0); addLine('#iPenalty','#iPenaltyAccount',0,vals.penalty); addLine('#iExtra','#iExtraAccount',0,vals.extra);
 {const D=r2(lines.reduce((s,l)=>s+l.debit,0)),C=r2(lines.reduce((s,l)=>s+l.credit,0)); if(Math.abs(D-C)>0.005)return toast(arEn(`قيد الفاتورة غير متوازن (مدين ${fmt(D)} / دائن ${fmt(C)}). راجع الخصم والجزاءات والإضافي.`,`Invoice entry is unbalanced (Dr ${fmt(D)} / Cr ${fmt(C)}). Check discount/penalty/additional.`));}
 let inv=id&&db.invoices.find(x=>x.id===id); if(inv){db.journal=db.journal.filter(x=>String(x.entry)!==String(inv.journalEntry));} else {inv={id:$('#iInvoiceNo')?.value.trim()||nextId('INV-',db.invoices)};if(db.invoices.some(x=>x.id===inv.id))inv.id=nextId('INV-',db.invoices);db.invoices.push(inv)}
 const entry=Math.max(0,...db.journal.map(x=>Number(x.entry)||0))+1,date=$('#iDate').value||new Date().toISOString().slice(0,10),desc=$('#iDesc').value.trim()||'خدمات';
 Object.assign(inv,{customerId:cid,date,time:$('#iTime').value.trim(),supplyDate:$('#iSupplyDate').value||date,desc,orderId:$('#iOrder').value.trim(),service:vals.items[0]?.item||'اخرى',items:vals.items,guards:vals.guards,hours:vals.hours,days:vals.days,rate:vals.rate,lineAmount:vals.line,discount:vals.discount,penalty:vals.penalty,extra:vals.extra,subtotal:vals.before,vat:vals.vat,total:vals.total,journalEntry:entry,status:'issued',salesAccountCode:salesCode,vatAccountCode:vatCode,sellerName:$('#iSellerName').value.trim(),sellerAddress:$('#iSellerAddress').value.trim(),sellerVat:$('#iSellerVat').value.trim(),sellerCr:$('#iSellerCr').value.trim()});
 lines.forEach(l=>{const a=db.accounts.find(x=>Number(x.code)===Number(l.code));db.journal.push({date,month:date.slice(0,7),type:'فاتورة مبيعات',entry,search:`${l.code}- ${a?.name||''}`,code:l.code,a1:a?.name||'',a2:'',a3:'',a4:'',a5:a?.name||'',debit:l.debit,credit:l.credit,balance:l.debit-l.credit,desc,invoice:inv.id});});
 save();renderCustomers();renderHome();toast(arEn('تم إصدار الفاتورة وترحيلها على حساب العميل نفسه','Invoice issued and posted to the customer account'));openInvoicePage(inv.id);
}
function exportInvoiceExcel(id){
 const inv=(id&&db.invoices.find(x=>x.id===id))||{}; const c=db.customers.find(x=>x.id===$('#iCustomer')?.value)||{}; const vals=recalcInvoicePage();
 const rows=[['Tax Invoice','فاتورة ضريبية'],['Invoice No.',inv.id||$('#iInvoiceNo')?.value||''],['Date',$('#iDate')?.value||''],['Customer',c.name||''],['VAT No.',c.taxNo||''],['Item','Qty','Hours','Days','Unit Price / Person / Day','Amount Due']];
 vals.items.forEach(x=>rows.push([x.item,x.qty,x.hours,x.days,x.unitPrice,(x.qty*x.days*x.unitPrice).toFixed(2)])); rows.push(['Gross',vals.gross],['Discount',vals.discount],['Penalty',vals.penalty],['Additional',vals.extra],['Taxable',vals.before],['VAT 15%',vals.vat],['Total',vals.total]);
 const html='<table>'+rows.map(r=>'<tr>'+r.map(v=>'<td>'+esc(v)+'</td>').join('')+'</tr>').join('')+'</table>';const blob=new Blob(['\ufeff'+html],{type:'application/vnd.ms-excel'});const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=(inv.id||'tax-invoice')+'.xls';a.click();URL.revokeObjectURL(a.href);
}
function orderForm(id){const o=id&&db.salesOrders.find(x=>x.id===id);return `<h3>${arEn('أمر بيع','Sales Order')}</h3><div class="form-grid"><div class="field"><label>${arEn('العميل','Customer')}</label><select id="oCustomer">${customerOptions()}</select></div><div class="field"><label>${arEn('التاريخ','Date')}</label><input type="date" id="oDate" value="${o?.date||new Date().toISOString().slice(0,10)}"></div><div class="field"><label>${arEn('القيمة','Order amount')}</label><input id="oTotal" type="number" step="0.01" value="${o?.total||''}"></div><div class="field"><label>${arEn('البيان','Description')}</label><input id="oDesc" value="${esc(o?.desc||'أمر بيع')}"></div></div><div class="modal-foot"><button class="gold-btn" id="saveOrder">${arEn('حفظ أمر البيع','Save Order')}</button><button class="soft-btn" onclick="closeModal()">${arEn('إلغاء','Cancel')}</button></div>`}
window.openSalesOrderModal=id=>{if(!db.customers.length){toast(arEn('أضف عميلاً أولاً','Add a customer first'));return}const m=$("#modal");m.innerHTML=orderForm(id);$("#modalBack").classList.add('show');if(id)$("#oCustomer").value=db.salesOrders.find(x=>x.id===id)?.customerId||'';$("#saveOrder").onclick=()=>{const cid=$("#oCustomer").value,total=Number($("#oTotal").value||0);if(!cid||total<=0)return toast(arEn('أدخل البيانات المطلوبة','Enter required data'));let o=id&&db.salesOrders.find(x=>x.id===id);if(!o){o={id:nextId('SO-',db.salesOrders)};db.salesOrders.push(o)}Object.assign(o,{customerId:cid,date:$("#oDate").value,total,desc:$("#oDesc").value});save();closeModal();renderCustomers();toast(arEn('تم حفظ أمر البيع','Sales order saved'))}}
window.openCollectionModal=invoiceId=>{const inv=db.invoices.find(x=>x.id===invoiceId),paid=db.collections.filter(x=>x.invoiceId===invoiceId).reduce((s,x)=>s+x.amount,0),due=Math.max(0,r2(inv.total-paid));const m=$("#modal");m.innerHTML=`<h3>${arEn('تسديد من داخل الفاتورة','Payment from Invoice')}</h3><div class="form-grid"><div class="field"><label>${arEn('الفاتورة','Invoice')}</label><input value="${esc(inv.id)} — ${fmt(inv.total)} SAR" disabled></div><div class="field"><label>${arEn('المتبقي','Remaining')}</label><input value="${fmt(due)} SAR" disabled></div><div class="field"><label>${arEn('مبلغ التسديد','Payment amount')}</label><input id="payAmount" type="number" max="${due}" step="0.01"></div><div class="field"><label>${arEn('تاريخ السداد','Payment date')}</label><input id="payDate" type="date" value="${new Date().toISOString().slice(0,10)}"></div><div class="field"><label>${arEn('حساب التحصيل','Collection account')}</label><select id="payAccount">${db.accounts.filter(a=>isLeaf(a)&&String(a.code).startsWith('121')&&/خزين|نقد|بنك|bank|cash/i.test(a.name||'')).map(a=>`<option value="${a.code}">${a.code} — ${esc(a.name)}</option>`).join('')}</select></div></div><div class="modal-foot"><button class="gold-btn" id="savePayment">${arEn('تسجيل السداد','Record Payment')}</button><button class="soft-btn" onclick="closeModal()">${arEn('إلغاء','Cancel')}</button></div>`;$("#modalBack").classList.add('show');$("#savePayment").onclick=()=>{const amount=r2($("#payAmount").value||0),code=Number($("#payAccount").value);if(amount<=0||amount>due+0.005)return toast(arEn('مبلغ غير صحيح','Invalid amount'));const ac=db.accounts.find(a=>Number(a.code)===code);const entry=Math.max(0,...db.journal.map(x=>Number(x.entry)||0))+1,date=($("#payDate")?.value)||new Date().toISOString().slice(0,10);const r={id:nextId('PAY-',db.collections),invoiceId:inv.id,customerId:inv.customerId,date,amount,accountCode:code,journalEntry:entry};db.collections.push(r);const cust=db.customers.find(c=>c.id===inv.customerId);db.journal.push({date,month:date.slice(0,7),type:'تحصيل عميل',entry,search:`${code}- ${ac?.name||''}`,code,a1:ac?.name||'',a2:'',a3:'',a4:'',a5:ac?.name||'',debit:amount,credit:0,balance:amount,desc:`تحصيل ${inv.id}`,invoice:inv.id});db.journal.push({date,month:date.slice(0,7),type:'تحصيل عميل',entry,search:`${cust.accountCode}- ${cust.name}`,code:cust.accountCode,a1:cust.name,a2:'',a3:'',a4:'',a5:cust.name,debit:0,credit:amount,balance:-amount,desc:`تحصيل ${inv.id}`,invoice:inv.id});save();closeModal();renderCustomers();renderHome();toast(arEn('تم تسجيل السداد وربطه بالقيد','Payment recorded and linked to journal'))}}
function toggleFinancialSub(open){
 const s=$("#financialAffairsSubnav"),n=$("#financialAffairsNav");
 if(!s||!n)return;
 s.classList.toggle("show",open??!s.classList.contains("show"));
 s.setAttribute("aria-hidden",String(!s.classList.contains("show")));
 n.classList.toggle("expanded",s.classList.contains("show"));
}
window.toggleFinancialSub=toggleFinancialSub;

function init(){
 document.addEventListener('click',e=>{
  const p=e.target.closest('[data-section-print],[data-section-excel],[data-section-pdf]'); if(!p)return;
  const view=p.dataset.sectionPrint||p.dataset.sectionExcel||p.dataset.sectionPdf;
  const area=view==='statements'?'statementArea':view==='reports'?'reportArea':view==='trial'?'trialArea':null;
  if(!area)return;
  const mode=p.dataset.sectionPrint?'print':p.dataset.sectionExcel?'excel':'pdf';
  exportWholeReport(area,mode);
 });
 $("#modalBack").addEventListener("click",e=>{if(e.target.id==="modalBack")closeModal()});
 $$(".nav").forEach(n=>n.onclick=()=>{
   if(n.dataset.view==="financialAffairs"){
     toggleFinancialSub(true);
     openView("tree");
     return;
   }
   openView(n.dataset.view);
 });
 $$("#financialAffairsSubnav [data-financial-module]").forEach(b=>b.addEventListener("click",e=>{
   e.preventDefault();e.stopPropagation();toggleFinancialSub(true);openView(b.dataset.financialModule);
   $$("#financialAffairsSubnav [data-financial-module]").forEach(x=>x.classList.toggle("active",x===b));
 }));
 $$(".nav:not(#financialAffairsNav)").forEach(b=>b.addEventListener("click",()=>toggleFinancialSub(false)));
 $("#treeRoot").addEventListener("click",e=>{const line=e.target.closest(".node-line");if(!line)return;const code=line.dataset.code;const kids=childrenOf(code);if(kids.length){expanded.has(code)?expanded.delete(code):expanded.add(code);renderTree()}showAccount(code)});
 $("#treeRoot").addEventListener("contextmenu",e=>{const line=e.target.closest(".node-line");if(!line)return;e.preventDefault();showTreeContextMenu(line.dataset.code,e.clientX,e.clientY)});
 document.addEventListener("click",e=>{if(!e.target.closest("#treeContextMenu"))hideContextMenu()});
 window.addEventListener("resize",hideContextMenu);
 $("#treeSearch").oninput=renderTree;$("#expandAll").onclick=()=>{db.accounts.forEach(a=>expanded.add(String(a.code)));renderTree()};$("#collapseAll").onclick=()=>{expanded.clear();renderTree()};
 $("#ledgerAccount").onchange=renderLedger;
 const ledgerSearch=$("#ledgerSearch");
 if(ledgerSearch){
   ledgerSearch.onfocus=()=>refreshLedgerAccountSearch();
   ledgerSearch.oninput=()=>{const before=$("#ledgerAccount")?.value||"";refreshLedgerAccountSearch();const sel=$("#ledgerAccount");if(sel && sel.value!==before)renderLedger();};
   ledgerSearch.onkeydown=e=>{
     const results=$("#ledgerAccountResults"); const items=results?[...results.querySelectorAll(".ledger-account-result")]:[];
     if(e.key==="Escape"){if(results)results.classList.remove("show");return;}
     if(e.key==="Enter" && items.length){e.preventDefault();items[0].click();}
   };
 }
 document.addEventListener("click",e=>{if(!e.target.closest(".ledger-account-search")){const r=$("#ledgerAccountResults");if(r)r.classList.remove("show");}});
 $("#ledgerFrom").oninput=renderLedger;$("#ledgerTo").oninput=renderLedger;
 const journalBody=$("#journalBody");
 if(journalBody){ journalBody.addEventListener("contextmenu",e=>{
   const row=e.target.closest("tr"); if(!row || !row.parentElement)return;
   const entry=row.cells[0]?.textContent?.trim() || currentJournalEntry;
   const accountBtn=e.target.closest("button[data-account-code]");
   const accountCode=accountBtn?.dataset.accountCode || row.querySelector("[data-account-code]")?.dataset.accountCode || "";
   e.preventDefault();
   showLedgerContextMenu(entry,e.clientX,e.clientY,accountCode);
 }); }
 ["#trialArea","#statementArea"].forEach(sel=>{
   const area=$(sel); if(!area)return;
   area.addEventListener("contextmenu",e=>{
     const row=e.target.closest("tr.report-row"); if(!row)return;
     const code=row.dataset.accountCode;
     if(!code || code==="—")return;
     e.preventDefault();
     showLedgerContextMenu("",e.clientX,e.clientY,code);
   });
 });
 const ledgerArea=$("#ledgerArea");
 if(ledgerArea){ ledgerArea.addEventListener("contextmenu",e=>{
   const row=e.target.closest("tr.ledger-row"); if(!row)return;
   e.preventDefault();
   showLedgerContextMenu(row.dataset.entry,e.clientX,e.clientY,$("#ledgerAccount")?.value||"");
 }); }
 document.addEventListener("click",e=>{if(!e.target.closest("#ledgerContextMenu"))hideLedgerContextMenu();});
 document.addEventListener("keydown",e=>{if(e.key==="Escape")hideLedgerContextMenu();});
 $$('#statementTabs .report-tab').forEach(btn=>btn.onclick=()=>{$$('#statementTabs .report-tab').forEach(b=>b.classList.remove('active'));btn.classList.add('active');window.__statementType=btn.dataset.statement;renderStatements()});
 $$('#reportTabs .report-tab').forEach(btn=>btn.onclick=()=>{$$('#reportTabs .report-tab').forEach(b=>b.classList.remove('active'));btn.classList.add('active');window.__reportType=btn.dataset.report;renderReports()});
 ["stmtFrom","stmtTo","stmtLevel"].forEach(id=>{const el=$("#"+id);if(el)el.addEventListener("input",renderStatements)});
 ["repFrom","repTo","repLevel"].forEach(id=>{const el=$("#"+id);if(el)el.addEventListener("input",renderReports)});
 const stmtHideZero=$("#stmtHideZero");if(stmtHideZero)stmtHideZero.addEventListener("change",renderStatements);
 const repHideZero=$("#repHideZero");if(repHideZero)repHideZero.addEventListener("change",renderReports);
 ["trialFrom","trialTo","trialLevel"].forEach(id=>{const el=$("#"+id);if(el)el.addEventListener("input",renderTrial)});
 const trialHideZero=$("#trialHideZero");if(trialHideZero)trialHideZero.addEventListener("change",renderTrial);
 $("#langBtn").onclick=()=>{db.lang=db.lang==="ar"?"en":"ar";localStorage.setItem("ma-lang",db.lang);applyLang();fillAccountSelects();openView(currentView)};
 $("#themeBtn").onclick=()=>{db.theme=db.theme==="dark"?"light":"dark";localStorage.setItem("ma-theme",db.theme);document.body.classList.toggle("light",db.theme==="light")};
 $("#backupBtn").onclick=backup;$("#printBtn").onclick=()=>window.print();$("#menuBtn").onclick=()=>$("#sidebar").classList.toggle("open");
 document.body.classList.toggle("light",db.theme==="light");applyLang();fillAccountSelects();openView("home");
 const updateDateTime=()=>{
 const d=new Date(),locale="en-US";
 const pad=n=>String(n).padStart(2,"0");
 const hours=d.getHours();
 const hour12=hours%12||12;
 const time=`${pad(hour12)}:${pad(d.getMinutes())} ${hours>=12?"PM":"AM"}`;
 const date=d.toLocaleDateString(locale,{year:"numeric",month:"long",day:"numeric"});
 const day=d.toLocaleDateString(locale,{weekday:"long"});
 const t=$("#clockTime"),dt=$("#clockDate"),dy=$("#clockDay");
 if(t)t.textContent=time;
 if(dt)dt.textContent=date;
 if(dy)dy.textContent=day;
};updateDateTime();setInterval(updateDateTime,1000);
}
init();
})();

/* Administrative / HR document templates */
(function initAdminDocs(){
 // These helpers live inside the accounting IIFE; use safe local shims so the HR forms never crash.
 const arEn=(a,e)=>typeof window.arEn==='function'?window.arEn(a,e):a;
 const applyLang=()=>{if(typeof window.applyLang==='function')window.applyLang()};
 const showToast=m=>{if(typeof window.showToast==='function')window.showToast(m)};
 const area=()=>document.querySelector('#adminDocArea');
 const select=()=>document.querySelector('#adminDocSelect');
 const esc=s=>String(s??'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[m]));
 const field=(label,key,placeholder='')=>`<label class="doc-field">${label?`<span>${label}</span>`:''}<input data-doc-key="${key}" placeholder="${esc(placeholder)}"></label>`;
 const inline=(key,placeholder='')=>`<input class="inline-input" data-doc-key="${key}" placeholder="${esc(placeholder)}">`;
 const editable=(key,html)=>`<div class="doc-editable" contenteditable="true" data-doc-key="${key}">${html}</div>`;
 const wrap=(title,sub,body)=>`<article class="admin-doc-sheet" dir="rtl"><div class="doc-company">شركة فخر الجزيرة للحراسات الأمنية</div><h1>${title}</h1>${sub?`<div class="doc-subtitle">${sub}</div>`:''}<div class="doc-content">${body}</div><div class="doc-footer"><span>شركة فخر الجزيرة للحراسات الأمنية</span><span>${new Date().toLocaleDateString('ar-SA')}</span></div></article>`;
 const contract=()=>wrap('عقد عمل','نموذج مستقل قابل للتعديل والطباعة',`${editable('contract_all',`
 <div class="doc-grid two">${field('رقم العقد','contract_no','26-09-0001')}${field('تاريخ العقد','contract_date','14/09/2026م')}</div>
 <p>إنه في يوم <input class="inline-input" data-doc-key="weekday" value="الأربعاء"> بتاريخ ${inline('hijri_date','03/04/1448هـ')} الموافق: ${inline('greg_date','14/09/2026م')} قد تم الاتفاق بين كل من:</p>
 <p>أ- شركة فخر الجزيرة للحراسات الأمنية سجل تجاري رقم (4031263286)، مكة، المملكة العربية السعودية ويمثلها في هذا العقد زهير سفر القثامي بصفته المدير العام جوال رقم (0537030099) والمشار اليها في هذا العقد الطرف الأول.</p>
 <p>ب- السيد / ${inline('employee_name','اسم الموظف')} رقم الهوية ${inline('employee_id','رقم الهوية')} - عنوانه / ${inline('address','مكه المكرمه')} رقم الجوال / ${inline('mobile','رقم الجوال')} والمشار اليه في الطرف الثاني.</p>
 <h3>المادة الأولى : موضوع العقد-:</h3><p>يوافق الطرف الثاني على العمل لدى الطرف الأول وتحت إدارته وأشرافه أو إدارة من ينوب عنه في وفق شروط هذا العقد في وظيفة ( حارس امن ) أو أي وظيفة أخرى يتم تكليفه بها، ما لم تختلف اختلافًا جوهريًا عن مهامه الأصلية حسب حاجة العمل إذا رأى الطرف الأول تكليفه بأدائها ووافق الطرف الثاني على ذلك.</p>
 <h3>المادة الثانية : مدة العقد -:</h3><p>مدة هذا العقد ( سنة) (أو ما يراه الطرفان) تبدأ اعتبارًا وضع الطرف الثاني نفسه تحت يد أمر الطرف الأول أو عند مباشرته لمهام وظيفته أو أي موعد يتفق عليه الطرفان.</p>
 <h3>المادة الثالثة : مكان العمل-:</h3><p>اتفق الطرفان على حق الطرف الأول في تكليف الطرف الثاني بالعمل في المكان الذي يراه الطرف الأول مناسبًا ضمن حدود مقر أداء الطرف الأول لإعماله وللطرف الأول الحق بنقل الطرف الثاني من مقر عمل لآخر وفقًا لما تقتضيه مصلحة العمل طالما أن هذا النقل لا يترتب ضررًا جسيمًا على الطرف الثاني.</p>
 <h3>المادة الرابعة : ساعات العمل-:</h3><p>عدد ساعات العمل اليومية هي ثماني ساعات فقط.</p>
 <h3>المادة الخامسة : العمل الإضافي -:</h3><p>يستحق الطرف الثاني اجر إضافي وذلك عندما يسند اليه اعمال اضافية او يطلب منه ساعات عمل اضافية ويتم الاتفاق بين الطرفين على قيمة ذلك الاجر الإضافي كتابيا ولا يحق للطرف الثاني الامتناع او رفض العمل الإضافي دون أي اعتراض على ذلك ويتم التعامل معه بناء على اللائحة الداخلية للشركة.</p>
 <h3>المادة السادسة : فترة التجربة-:</h3><p>يعتبر الطرف الثاني تحت التجربة طوال الستة الاشهر الأولى لهذا العقد والتي تبدأ من تاريخ مباشرته الفعلية للعمل لدى الطرف الأول فإذا ثبت عدم صلاحية الطرف الثاني خلال هذه الفترة فيحق للطرف الأول انهاء خدمته دون إنذار أو مكافئة أو تعويض حسب بند وزارة العمل والعمال بالمملكة العربية السعودية (53).</p>
 <h3>المادة السابعة : الأجر-:</h3><p>يدفع الطرف الأول للطرف الثاني مقابل عمله حسب كشف الحضور والانصراف المعتمد من قبل الطرف الأول.</p><div class="salary-grid"><div>راتب شهري أساسي قدره ${inline('basic_salary','1500')} المبلغ كتابة ${inline('basic_words','الف و خمسمائة ريال')}</div><div>بدل سكن قدره ${inline('housing','500')} المبلغ كتابة ${inline('housing_words','خمسمائة ريال')}</div><div>بدلات أخرى قدره ${inline('other_allowance','1000')} المبلغ كتابة ${inline('other_words','الف ريال')}</div><div>اجمالي الراتب ${inline('total_salary','3000')} المبلغ كتابة ${inline('total_words','ثلاثة الاف ريال فقط')}</div></div>
 <h3>المادة الثامنة :انهاء العقد-:</h3><p>-1 يحق لأي طرف من الطرفين انهاء هذا العقد بإرادته المنفردة بشرط اخطار الطرف الآخر كتابيًا قبل التاريخ المحدد للإنهاء بثلاثين يومًا، وفي حالة عدم التزام أي من الطرفين بالمدة المشار اليها يدفع الطرف المخل للطرف الآخر تعويضًا معادلًا بقيمة (300) ريال عن كل يوم لمدة الاخطار أو المتبقي منها حسب بند وزارة العمل والعمال بالمملكة العربية السعودية (74).</p><p>-2 ينتهي هذا العقد بانتهاء مدته أو بانتهاء المشروع أو عند طلب العميل من الطرف الأول استبعاد الطرف الثاني من المشروع، ويحق للطرف الأول أيضًا إنهاءه فورًا وبدون إشعار مسبق أو مكافأة أو تعويض في أي من الحالات الواردة حسب بند وزارة العمل والعمال بالمملكة العربية السعودية (80).</p><p>-3 يلتزم الطرف الأول بتعويض الطرف الثاني بأجر شهرين فقط عن هذا العقد في حال قيام الطرف الأول بإنهاء هذا العقد لأي سبب غير مشروع حسب بند وزارة العمل والعمال بالمملكة العربية السعودية (77).</p><p>-4 يلتزم الطرف الثاني في حال طلب الاستقالة ان يتم اشعار الطرف الأول في مدة أقصاه (15) يوم حتى يتم التعامل معه في إجراءات الاستقالة النظامية وفي حال عدم التزام الطرف الثاني والغياب قبل انتهى المدة يدفع الطرف الثاني تعويضًا للطرف الأول (300) ريال عن كل يوم غياب.</p>
 <h3>المادة التاسعة : التزامات الطرف الثاني-:</h3><p>-1 ان يباشر مهام وظيفته في المقر الذي يحدده الطرف الاول بما يعادل 8 ساعات يوميا وفي الاسبوع 48 ساعة وان يتم منحه اجازة من كل اسبوع حسب بند وزارة العمل والعمال بالمملكة العربية السعودية (98).</p><p>-2 ان يلتزم بعدم العمل لدى أي جهة كانت خلال فترة عمله لدى الطرف الأول سواء بأجر أو بدون أجر بما في ذلك الإجازات والعطل وبعد الدوام.</p><p>-3 ان يلتزم التزاما تاما بمواعيد العمل وفي حال الغياب المفاجئ بدون علم فانه يحق لشركة فخر الجزيرة للحراسات الأمنية الخصم بما يعادل يومين من راتبي.</p><p>-4 ان يلتزم التزاما تاما بلبس الزي الرسمي المحدد لي في العمل وان يكون نظيفا ومرتبا وفي حال عدم الالتزام يحق لشركة فخر الجزيرة للحراسات الأمنية الخصم بما يعادل يوم من راتبي.</p><p>-5 ان يلتزم التزاما تاما بعدم الانسحاب من الموقع وفي حال الانسحاب يخصم بما يعادل ثلاثة ايام من راتبي.</p><p>-6 في حال عدم التزامي بأي من لوائح ونظم العمل يطبق علي فورا لائحة الحسومات المعتمدة لدى شركة فخر الجزيرة للحراسات الأمنية.</p><p>-7 إذا لم أكمل مدة شهر بالشركة لا يحق لي المطالبة بأي راتب او مستحقات وأقر بأنها فترة تدريبية حسب بند وزارة العمل والعمال بالمملكة العربية السعودية (53).</p><p>-8 إذا لم أكمل مدة ست أشهر بالشركة لا يحق لي المطالبة بأي مستحقات وأقر بأنها فترة تجريبية حسب بند وزارة العمل والعمال بالمملكة العربية السعودية (53).</p><p>-9 في حالة رفضي من قبل العميل لأسباب منطقية يتم التعامل معي نظاميا مثل الاستقالة الفورية ولا يحق لي بأي مستحقات.</p><p>-10 عندما يرد على الشركة خطاب من أي مشروع بوجود مخالفة خلال فترة استلامي فإنه لا مانع لدي من خصم كامل مبلغ المخالفة من استحقاقي ومرتباتي وليس لي الحق في الاعتراض.</p><p>-11 ان يلتزم بتنفيذ اية مهام او اعمال يكلفه بها الطرف الأول في حالات الضرورة وفقًا لما تقتضيه مصلحة العمل.</p><p>-12 ان يلتزم بالمحافظة على ما في عهدته وأن يستخدمها في الأغراض المعدة لها ولأداء عمله الذي تتطلبه وظيفته.</p><p>-13 ان يبلغ فورًا الطرف الأول عن أي فعل أو تقصير ينتج عنه الحاق ضرر أو خسارة مادية أو معنوية بالعمل.</p><p>-14 ان يحافظ على الأسرار الخاصة بالعمل وعدم افشائها.</p><p>-15 ان يستخدم كل قدراته في تحسين وتطوير العمل.</p>
 <h3>المادة العاشرة : أحكام عامة-:</h3><p>-1 لا يترتب على هذا العقد أي التزامات على الطرف الأول في مواجهة من يعولهم الطرف الثاني.</p><p>-2 يعتبر عنوان الطرف الأول عنوانًا مشتركًا لكلا الطرفين ويحق للطرف الأول أن يسلم فيه جميع الإشعارات والإخطارات إلى الطرف الثاني باليد أو وضعها على لوحة الإعلانات في مقر العمل.</p><p>-3 أي خلاف ينشأ بين طرفي العقد بسبب تنفيذه أو تفسيره يتم حله وديًا فإذا تعذر ذلك فيعرض النزاع على لجان العمل المختصة في مدينة مكة.</p><p>-4 تحتسب المدة في هذا العقد بالتقويم الميلادي.</p><p>-5 يقر الطرف الثاني بأنه لا توجد لديه أي أمراض مزمنة، وأن الوثائق المقدمة منه صحيحة ومكتملة، وفي حالة ظهور خلاف ذلك يحق للطرف الأول إنهاء هذا العقد.</p><p>-6 يلغي هذا العقد أي عقد أو اتفاق سابق بين الطرفين.</p><p>-7 كل ما لم يرد بشأنه نص في هذا العقد يطبق عليه نظام العمل والعمال المعمول به في المملكة العربية السعودية.</p><p>-8 الالتزام التام بأوقات الدوام الرسمي.</p><p>-9 يقر الطرف الثاني بأنه قد سبق له قبل التوقيع على هذا العقد الاطلاع على ما جاء في لائحة تنظيم العمل المعمول بها لدى الطرف الأول وأنه ملتزم بما جاء فيها.</p>
 <h3>المادة الحادي عشر : نسخ العقد:</h3><p>-1 تم تحرير العقد من نسختين.</p><p>على ما ذكر تم تنظيم هذا العقد والله خير الشاهدين ،،،</p>
 <div class="signature-grid"><div><b>الطرف الأول</b><p>شركة فخر الجزيرة للحراسات الأمنية</p><p>الاسم / أ / زهير سفر القثامي</p><p>التوقيع / __________________</p><p>البصمة / __________________</p></div><div><b>الطرف الثاني</b><p>الاسم / ${inline('sig_name','اسم الموظف')}</p><p>التوقيع / __________________</p><p>البصمة / __________________</p></div></div>`)}
 `);
 const penalties=()=>wrap('لائحة الجزاءات الإدارية','تقرير مستقل قابل للتعديل والطباعة',`${editable('penalties_all',`<p><b>ملاحظة:</b> هذه اللائحة تعتبر جزء لا يتجزأ من اتفاقية العمل التي تم توقيعها وسيتم الرجوع اليها والعمل بها.</p><h3>إقرار وتعهد</h3><p>أقر أنا / ${inline('pen_name','اسم الموظف')} رقم : ${inline('pen_id','رقم الهوية')} الموظف في شركة فخر الجزيرة للحراسات الأمنية بأنني قد اطلعت على لائحة النظام الداخلي للشركة وعلى علم تام بها والتي تعتبر جزء لا يتجزأ من عقد العمل وأن ألتزم بمراعاتي كافة الأوامر والتعليمات التي تصدر من إدارة الشركة أو المسؤولين، كما ألتزم بكافة الالتزامات وأن أنفذ بدقة أحكام لوائح الشركة وتعليماتها وأن أحافظ على حسن السير والسلوك والسمعة الطيبة والمحافظة على أموال وممتلكات الشركة .. كما ألتزم بالمحافظة على كرامة الوظيفة وحسن المظهر وأن أظهر بمظهر لائق يتفق وطبيعة الوظيفة التي أشغلها ومكان العمل وعدم الغياب والتأخير والانسحاب وإذا حصل مني خلاف ذلك سوف أكون عرضة للجزاء وليس لي مطالبة على الشركة من حقوق مالية أو ادعاء خاص. وهذا إقرار مني بما جاء فيه.</p><p>المقرر بما فيه</p><p>الاسم : ${inline('pen_sig_name','')} التوقيع : ${inline('pen_sig','')} البصمة : ${inline('pen_finger','')} التاريخ : ${inline('pen_date',' / / 2026م')}</p><p>نحرص على التحفيز وليس العقاب ولسنا حريصين على خصم أي مبلغ من الراتب وسيسبق الخصم إنذار شفهي ثم إنذار خطي أول وثاني ثم الخصم وفي حالة استمرار المخالفة سيكون هناك إنذار بالفصل، ثم إنهاء الخدمات بعد التحقيق وبدون أي تعويض لنهاية الخدمة.</p><table class="doc-table"><thead><tr><th>م</th><th>المخالفات أثناء العمل</th><th>خصم من الراتب</th></tr></thead><tbody><tr><td>1</td><td>التأخير، عدم لبس الكاب، عدم لبس الجزمة أو لبسها بشكل غير كامل، عدم لبس الحزام، عدم حمل لوحة اسم أو بطاقة الأحوال، عدم لبس العصا وحامل العصا، عدم حلق شعر الرأس أو سوء القيافة، التدخين أثناء العمل، المزاح أثناء العمل، وضع اليدين في الجيب، عدم الرد على الجهاز، التستر على ملاحظات الزميل، التعامل غير الجيد مع الآخرين، عدم اتباع تعليمات التحضير التي أبلغ بها.</td><td>حسم نصف يوم، وفي حالة تكرارها يتم خصم يوم.</td></tr><tr><td>2</td><td>الغياب، التجمعات في المواقع، عدم متابعة دخول أو خروج المواد.</td><td>حسم يومين من الموقع.</td><tr><td>3</td><td>الغياب أيام العيد والانسحاب من العمل بدون إذن مسبق.</td><td>حسم أربعة أيام.</td></tr><tr><td>4</td><td>الغياب عن العمل لمدة خمسة أيام أو أكثر متتالية خلال الشهر أو عشرون يوما في السنة.</td><td>فصل بدون مستحقات.</td></tr><tr><td>5</td><td>النوم أثناء العمل، عدم التقيد بالتعليمات، الانشغال بالجوال أو الأجهزة الذكية أو الصحف والمجلات.</td><td>حسم ثلاثة أيام.</td></tr><tr><td>6</td><td>مخالفات أخرى لم يتم ذكرها بعالية:</td><td>${inline('pen_other','يحدد حسب الحالة')}</td></tr></tbody></table>`)}`);
 const directWork=()=>wrap('مباشرة عمل الموظف','تقرير مستقل قابل للتعديل والطباعة',`${editable('direct_all',`<h3>مباشرة عمل</h3><table class="doc-table"><tbody><tr><th>اسم الموظف</th><td>${inline('dw_name','')}</td><th>المسمى الوظيفي</th><td>${inline('dw_job','حارس أمن')}</td><th>الموقع</th><td>${inline('dw_site','')}</td></tr></tbody></table><p>نفيدكم بأن الموظف المذكور بعالية باشر العمل لدينا اعتبارًا من:</p><p>التاريخ: ${inline('dw_hijri',' / / 144هـ')} الموافق: ${inline('dw_greg',' / / 202م')}</p><div class="checks"><label><input type="checkbox" data-doc-key="dw_new"> تعيين جديد</label><label><input type="checkbox" data-doc-key="dw_rehire"> إعادة تعيين</label><label><input type="checkbox" data-doc-key="dw_return"> عودة من الإجازة</label><label><input type="checkbox" data-doc-key="dw_other"> أخرى</label></div><p>أقر أنا الحارس / ${inline('dw_guard','')} هوية وطنية رقم : ${inline('dw_id','')} بأنني أعمل لدى شركة فخر الجزيرة للحراسات الأمنية فترة تجربة لمدة ست أشهر وأرغب بعدم تسجيلي في التأمينات الاجتماعية بإرادتي الشخصية وبعدها يتم تقييمي من قبل الإدارة في حال تم الاجتياز من قبل الإدارة يتم الاستمرار في العمل وفي حال لم يتم الاجتياز لا يحق لي المطالبة الشركة بأية مطالبات أو أي حقوق مالية.</p><p>اسم الحارس : ${inline('dw_guard_name','')}</p><p>التوقيع : ${inline('dw_sig','')} البصمة : ${inline('dw_finger','')}</p><div class="signature-grid"><div>الموارد البشرية والمالية<br><br>________________________</div><div>مشرف الموقع<br><br>________________________</div><div>رئيس العمليات<br><br>________________________</div></div>`)}`);
 const templates={
  iban:()=>wrap('نموذج تفويض آيبان','تفويض إنزال الراتب',`${editable('iban_doc',`<div class="doc-grid two">${field('التاريخ','iban_date','...../...../2026م')}${field('البنك','iban_bank')}</div><div class="doc-grid two">${field('رقم الحساب','iban_account')}${field('رقم الحساب الدولي - آيبان','iban_no','SA................................')}</div><p>أتعهد أنا / ${field('','iban_name','اسم الموظف')} هوية رقم ${field('','iban_id','رقم الهوية')} برغبتي بإنزال راتبي على رقم الحساب والآيبان الموضح أعلاه لمدة شهرين من تاريخ التفويض ولا يحق لي بعد إنزال الراتب مطالبة المؤسسة بأي مبالغ مالية مستقبلًا أو غير مالية.</p><div class="signature-grid"><div>الاسم: ____________________<br><br>التوقيع: ____________________</div><div>البصمة: ____________________</div></div>`)}`),
  contract:contract,
  penalties,
  directWork,
  medical:()=>wrap('استمارة كشف طبي','شركة فخر الجزيرة للحراسات الأمنية',`${editable('medical_header',`<div class="doc-grid two">${field('الاسم','medical_name')}${field('المسمى الوظيفي','medical_job','حارس أمن')}</div><table class="doc-medical"><thead><tr><th>نوع الفحص</th><th>النتيجة / الملاحظات</th><th>اسم الفاحص</th><th>التوقيع</th></tr></thead><tbody>${[['العينان','اليمنى / اليسرى'],['الأذنان','اليمنى / اليسرى'],['الجراحة','سليم / غير سليم'],['المختبر','بول - سكر - زلال / سالب - موجب'],['باطنية','ضغط الدم - الكبد - القلب - الطحال / سليم - غير سليم'],['النفسية','سليم / غير سليم'],['الجلدية','سليم / غير سليم'],['الصدرية','نتيجة الفحص الشعاعي / سالب - موجب'],['أخرى',''],['ملاحظات','']].map((r,i)=>`<tr><td>${r[0]}</td><td><input data-doc-key="med_result_${i}" placeholder="${r[1]}"></td><td><input data-doc-key="med_doctor_${i}"></td><td><input data-doc-key="med_sig_${i}"></td></tr>`).join('')}</tbody></table><h3>نتيجة الكشف الطبي</h3><p>وبناء على نتائج الكشف والفحوصات الطبية الموضحة أعلاه، فقد تبين أن المذكور:</p><div class="checks"><label><input type="checkbox" data-doc-key="fit"> لائق طبياً للعمل</label><label><input type="checkbox" data-doc-key="fit_notes"> لائق طبياً للعمل مع ملاحظات</label><label><input type="checkbox" data-doc-key="unfit"> غير لائق طبياً للعمل</label></div><p>اسم الدكتور: ${inline('med_final_name','')} التوقيع: __________ الختم: __________</p><p>الأصل الملف المذكور.</p>`)}`),
  uniform:()=>wrap('تعهد استلام بدلة','شركة فخر الجزيرة للحراسات الأمنية',`${editable('uniform_doc',`<p>أتعهد أنا: ${inline('uniform_name','')} بأنني قد استلمت بدلة كاملة من مؤسسة ${inline('uniform_company','فخر الجزيرة')} ومحتوياتها ( قميص - بنطلون - حزام - قبوع ) مقاس ( ${inline('uniform_size','')} ).</p><p>بتاريخ: ${inline('uniform_date',' / / 2026م')} المدفوع مقدماً ( ${inline('uniform_paid','00')} ريال ) فقط والمتبقي ( ${inline('uniform_due','')} ريال ) فقط لا غير حيث سأكون في فترة اختبار لمدة ثلاثة أشهر من استلامي للعمل وفي حالة ترك العمل قبل انتهاء فترة التجربة لا يحق لي المطالبة بالراتب أو بقيمة البدلة.</p><table class="doc-table"><thead><tr><th>حارس الأمن</th><th>الجنسية</th><th>هوية رقم</th><th>صادر من</th><th>تاريخ الاستلام</th></tr></thead><tbody><tr><td>${inline('guard_name','')}</td><td>${inline('nationality','سعودي')}</td><td>${inline('guard_id','')}</td><td>${inline('issued_by','')}</td><td>${inline('receipt_date','')}</td></tr></tbody></table><p>ملاحظة: يخصم متبقي القيمة ( ${inline('uniform_note_due','')} ريال ) من راتب</p><div class="signature-grid"><div>الاسم: __________<br><br>التوقيع: __________<br><br>البصمة: __________</div><div>مدير الأمن<br><br>الاسم: __________<br><br>التوقيع: __________</div></div><p>الأصل ملف البدل / صورة للمالية / حارس الأمن</p>`)}`)
 };
 const employeeDefaults={name:'',id:'',mobile:'',address:'مكه المكرمه',job:'حارس أمن',site:'',contractDate:'',startDate:'',basicSalary:'1500',housing:'500',otherAllowance:'1000',totalSalary:'3000',bank:'',account:'',iban:''};
 const empMap={name:['employee_name','sig_name','pen_name','pen_sig_name','dw_name','dw_guard','dw_guard_name','medical_name','uniform_name','guard_name','iban_name'],id:['employee_id','pen_id','dw_id','guard_id','iban_id'],mobile:['mobile'],address:['address'],job:['dw_job','medical_job'],site:['dw_site'],basicSalary:['basic_salary'],housing:['housing'],otherAllowance:['other_allowance'],totalSalary:['total_salary'],bank:['iban_bank'],account:['iban_account'],iban:['iban_no']};
 function tafqeet(n){
 n=Math.floor(Number(n)||0); if(n<=0) return 'صفر';
 const ones=['','واحد','اثنان','ثلاثة','أربعة','خمسة','ستة','سبعة','ثمانية','تسعة','عشرة','أحد عشر','اثنا عشر','ثلاثة عشر','أربعة عشر','خمسة عشر','ستة عشر','سبعة عشر','ثمانية عشر','تسعة عشر'];
 const tens=['','','عشرون','ثلاثون','أربعون','خمسون','ستون','سبعون','ثمانون','تسعون'];
 const hund=['','مائة','مائتان','ثلاثمائة','أربعمائة','خمسمائة','ستمائة','سبعمائة','ثمانمائة','تسعمائة'];
 const b1000=x=>{const p=[],h=Math.floor(x/100),r=x%100; if(h)p.push(hund[h]); if(r){ if(r<20)p.push(ones[r]); else {const o=r%10,t=Math.floor(r/10); p.push(o?ones[o]+' و'+tens[t]:tens[t]);} } return p.join(' و');};
 const th=Math.floor(n/1000),rest=n%1000,out=[];
 if(th){ let t; if(th===1)t='ألف'; else if(th===2)t='ألفان'; else if(th<=10)t=b1000(th)+' آلاف'; else if(th===200)t='مائتا ألف'; else t=b1000(th)+(th%100===0?' ألف':' ألفًا'); out.push(t); }
 if(rest) out.push(b1000(rest));
 return out.join(' و');
}
window.__tafqeet=tafqeet;
function empGet(){const o={...employeeDefaults};Object.keys(o).forEach(k=>{const v=localStorage.getItem('employee-'+k);if(v!==null)o[k]=v});return o}
 function empSave(){document.querySelectorAll('[data-employee-key]').forEach(el=>localStorage.setItem('employee-'+el.dataset.employeeKey,el.value||''));syncEmployeeToCurrentForm();showToast(arEn('تم حفظ بيانات الموظف بنجاح','Employee data saved successfully'),'ok')}
 function loadEmpPanel(){const o=empGet();document.querySelectorAll('[data-employee-key]').forEach(el=>{const v=o[el.dataset.employeeKey];if(v!==undefined)el.value=v})}
 function syncEmployeeToCurrentForm(){const s=select()?.value;if(!s)return;const o=empGet();
   [['basicSalary','basic_words'],['housing','housing_words'],['otherAllowance','other_words'],['totalSalary','total_words']].forEach(([k,wk])=>{const el=area()?.querySelector('[data-doc-key="'+wk+'"]');const n=Number(o[k]);if(el&&o[k]!==''&&n>=0&&n<1000000){const w=tafqeet(n).replace(/(ألفان|مائتان)$/,m=>m==='ألفان'?'ألفا':'مائتا')+' ريال'+(k==='totalSalary'?' فقط':'');el.value=w;localStorage.setItem('admin-doc-'+s+'-'+wk,w);}});Object.entries(empMap).forEach(([k,keys])=>keys.forEach(key=>{const el=area()?.querySelector(`[data-doc-key="${key}"]`);if(el && o[k]!==undefined){el.value=o[k];localStorage.setItem('admin-doc-'+s+'-'+key,o[k])}}));
   const d=area(); if(d){const cd=d.querySelector('[data-doc-key="contract_date"]'); if(cd&&o.contractDate){cd.value=new Date(o.contractDate+'T00:00:00').toLocaleDateString('ar-SA')} const gd=d.querySelector('[data-doc-key="greg_date"]'); if(gd&&o.contractDate){gd.value=new Date(o.contractDate+'T00:00:00').toLocaleDateString('en-GB')} const wdEl=d.querySelector('[data-doc-key="weekday"]'); if(wdEl&&o.contractDate){wdEl.value=new Date(o.contractDate+'T00:00:00').toLocaleDateString('ar-SA',{weekday:'long'});localStorage.setItem('admin-doc-'+s+'-weekday',wdEl.value)} const dwg=d.querySelector('[data-doc-key="dw_greg"]'); if(dwg&&o.startDate){dwg.value=new Date(o.startDate+'T00:00:00').toLocaleDateString('en-GB')}}
 }
 function collectCurrent(){saveDoc();const s=select()?.value;if(!s)return;const d=area();d?.querySelectorAll('[data-doc-key]').forEach(el=>{if(el.matches('input,textarea,select'))localStorage.setItem('admin-doc-'+s+'-'+el.dataset.docKey,el.type==='checkbox'?String(el.checked):el.value)});}
 function renderPrintAll(){const old=select()?.value||'contract';const saved=old;saveDoc();const keys=Object.keys(templates);area().innerHTML=keys.map(k=>`<div class="admin-doc-print-page" data-print-form="${k}">${templates[k]()}</div>`).join('');keys.forEach(k=>restoreDoc(k));applyLang();window.print();setTimeout(()=>{select().value=saved;render()},300)}

 function saveDoc(){const s=select()?.value;if(!s)return;area()?.querySelectorAll('[data-doc-key]').forEach(el=>{const k='admin-doc-'+s+'-'+el.dataset.docKey;const v=el.matches('input,textarea,select')?(el.type==='checkbox'?String(el.checked):el.value):el.innerHTML;try{localStorage.setItem(k,v)}catch(e){}})}
 function restoreDoc(s){area()?.querySelectorAll('[data-doc-key]').forEach(el=>{const v=localStorage.getItem('admin-doc-'+s+'-'+el.dataset.docKey);if(v===null)return;if(el.matches('input,textarea,select')){if(el.type==='checkbox')el.checked=v==='true';else el.value=v}else el.innerHTML=v})}
 function render(){const s=select()?.value||'iban';area().innerHTML=templates[s]();restoreDoc(s);area().querySelectorAll('[data-doc-key]').forEach(el=>el.addEventListener('input',saveDoc));applyLang()}
 window.renderAdminDocs=render;
 document.addEventListener('DOMContentLoaded',()=>{loadEmpPanel();['basicSalary','housing','otherAllowance'].forEach(k=>document.querySelector('[data-employee-key="'+k+'"]')?.addEventListener('input',()=>{const g=x=>Number(document.querySelector('[data-employee-key="'+x+'"]')?.value||0);const t=document.querySelector('[data-employee-key="totalSalary"]');if(t)t.value=g('basicSalary')+g('housing')+g('otherAllowance');}));document.querySelectorAll('[data-employee-key]').forEach(el=>el.addEventListener('input',()=>{syncEmployeeToCurrentForm()}));select()?.addEventListener('change',()=>{saveDoc();render()});document.querySelector('#adminSaveData')?.addEventListener('click',()=>{empSave();syncEmployeeToCurrentForm();render()});document.querySelector('#adminSavePrint')?.addEventListener('click',()=>{empSave();saveDoc();window.print()});document.querySelector('#adminPrintAll')?.addEventListener('click',()=>{empSave();renderPrintAll()});document.querySelector('#adminDocsPrint')?.addEventListener('click',()=>{saveDoc();window.print()});document.querySelector('#adminDocsReset')?.addEventListener('click',()=>{const s=select()?.value;if(!s)return;if(confirm(arEn('سيتم مسح التعديلات المحفوظة لهذا النموذج وإعادته للأصل. هل تريد المتابعة؟','Saved edits for this form will be cleared. Continue?'))){area()?.querySelectorAll('[data-doc-key]').forEach(el=>localStorage.removeItem('admin-doc-'+s+'-'+el.dataset.docKey));render()}});if(select())render()});
 document.addEventListener('click',e=>{if(e.target.closest('.nav[data-view="adminDocs"]'))setTimeout(render,0)});
})();

/* 2026-0024: Administrative Affairs workflow */
(function(){
 const KEY='ma-admin-affairs-v1';
 const seed={
  companies:[], departments:[], positions:[], shifts:[{id:'shift-default',name:'الوردية الأساسية',start:'08:00',end:'17:00',fridayOff:true,saturdayOff:true}],
  leaveTypes:[{id:'leave-annual',name:'إجازة سنوية',days:30,paid:true}], employees:[], contracts:[], attendance:[], leaveRequests:[], payroll:[]
 };
 function load(){try{return {...seed,...JSON.parse(localStorage.getItem(KEY)||'{}'),...(window.__adminCloudSeed||{})}}catch(e){return {...seed,...(window.__adminCloudSeed||{})}}}
 let A=load();
 const save=()=>{localStorage.setItem(KEY,JSON.stringify(A)); if(typeof window.saveCloud==='function') window.saveCloud()};
 window.__adminGetState=()=>JSON.parse(JSON.stringify(A));
 window.__adminApplyCloud=(incoming)=>{ if(!incoming)return; A={...seed,...incoming}; try{localStorage.setItem(KEY,JSON.stringify(A))}catch(e){}; renders[active]?.(); }; 
 const uid=p=>p+'-'+Date.now().toString(36)+'-'+Math.random().toString(36).slice(2,7);
 const q=id=>document.getElementById(id);
 const escA=v=>String(v??'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
 const next=(name)=>({companies:'departments',departments:'shifts',shifts:'leaveTypes',leaveTypes:'employees',employees:'contracts',contracts:'attendance',attendance:'leaveRequests',leaveRequests:'payroll'}[name]);
 const labels={companies:'الشركات',departments:'الأقسام + المسميات',shifts:'الورديات',leaveTypes:'أنواع الإجازات',employees:'الموظفين',contracts:'العقود',attendance:'الحضور',leaveRequests:'طلبات الإجازات',payroll:'الرواتب'};
 function opts(arr,placeholder='اختر'){return `<option value="">${placeholder}</option>`+arr.map(x=>`<option value="${escA(x.id)}">${escA(x.name||x.title||x.id)}</option>`).join('')}
 function employeeOpts(){return opts(A.employees,'اختر الموظف')}
 function companyOpts(){return opts(A.companies,'اختر الشركة')}
 function deptOpts(){return opts(A.departments,'اختر القسم')}
 function positionOpts(){return opts(A.positions,'اختر المسمى')}
 function shiftOpts(){return opts(A.shifts,'اختر الوردية')}
 function leaveOpts(){return opts(A.leaveTypes,'اختر نوع الإجازة')}
 function dateNow(){return new Date().toISOString().slice(0,10)}
 function daysInMonth(v){const d=v?new Date(v+'-01T00:00:00'):new Date();return new Date(d.getFullYear(),d.getMonth()+1,0).getDate()}
 function monthKey(){return new Date().toISOString().slice(0,7)}
 function shell(title,sub,body){return `<div class="section-head admin-module-head"><div><span class="kicker">ADMINISTRATIVE AFFAIRS</span><h2>${title}</h2><p>${sub}</p></div></div><div class="admin-module panel">${body}</div>`}
 function formRow(fields,actions=''){return `<div class="admin-form-grid">${fields.join('')}</div>${actions?`<div class="admin-module-actions">${actions}</div>`:''}`}
 function field(label,html){return `<label class="admin-field"><span>${label}</span>${html}</label>`}
 function input(id,label,type='text',value='',extra=''){return field(label,`<input id="${id}" type="${type}" value="${escA(value)}" ${extra}>`)}
 function select(id,label,html){return field(label,`<select id="${id}">${html}</select>`)}
 function table(headers,rows,empty='لا توجد بيانات'){return `<div class="admin-table-wrap"><table class="admin-table"><thead><tr>${headers.map(h=>`<th>${h}</th>`).join('')}</tr></thead><tbody>${rows||`<tr><td colspan="${headers.length}" class="admin-empty">${empty}</td></tr>`}</tbody></table></div>`}
 function actionBtns(kind,id){return `<button class="soft-btn admin-delete" data-admin-delete="${kind}" data-id="${escA(id)}">حذف</button>`}
 function renderCompanies(){
  const rows=A.companies.map((x,i)=>`<tr><td>${i+1}</td><td>${escA(x.name)}</td><td>${escA(x.cr||'—')}</td><td>${escA(x.phone||'—')}</td><td>${actionBtns('companies',x.id)}</td></tr>`).join('');
  q('adminAffairsArea').innerHTML=shell('الشركات','تعريف الشركات التي سيعمل تحتها الموظفون والعقود.',formRow([input('acName','اسم الشركة'),input('acCr','السجل التجاري'),input('acPhone','الهاتف')],'<button class="gold-btn" id="acSave">＋ إضافة شركة</button>')+table(['#','الشركة','السجل التجاري','الهاتف','الإجراء'],rows));
  q('acSave').onclick=()=>{const name=q('acName').value.trim();if(!name)return toast('أدخل اسم الشركة');A.companies.push({id:uid('co'),name,cr:q('acCr').value.trim(),phone:q('acPhone').value.trim()});save();renderCompanies();toast('تم حفظ الشركة')}
 }
 function renderDepartments(){
  const rows=A.departments.map((x,i)=>`<tr><td>${i+1}</td><td>${escA(x.name)}</td><td>${escA(A.companies.find(c=>c.id===x.companyId)?.name||'—')}</td><td>${escA(A.positions.find(p=>p.id===x.positionId)?.name||'—')}</td><td>${actionBtns('departments',x.id)}</td></tr>`).join('');
  const posRows=A.positions.map((x,i)=>`<tr><td>${i+1}</td><td>${escA(x.name)}</td><td>${escA(A.departments.find(d=>d.id===x.departmentId)?.name||'—')}</td><td>${actionBtns('positions',x.id)}</td></tr>`).join('');
  q('adminAffairsArea').innerHTML=shell('الأقسام + المسميات','الأقسام والمسميات الوظيفية هي المرجع الذي يرتبط به الموظف.',formRow([select('adCompany','الشركة',companyOpts()),input('adDept','اسم القسم')],'<button class="gold-btn" id="adSave">＋ إضافة قسم</button>')+table(['#','القسم','الشركة','المسمى الافتراضي','الإجراء'],rows)+`<div class="admin-subtitle">المسميات الوظيفية</div>`+formRow([select('apDept','القسم',deptOpts()),input('apName','المسمى الوظيفي')],'<button class="gold-btn" id="apSave">＋ إضافة مسمى</button>')+table(['#','المسمى','القسم','الإجراء'],posRows));
  q('adSave').onclick=()=>{const name=q('adDept').value.trim();if(!name)return toast('أدخل اسم القسم');A.departments.push({id:uid('dep'),name,companyId:q('adCompany').value});save();renderDepartments();toast('تم حفظ القسم')};
  q('apSave').onclick=()=>{const name=q('apName').value.trim();if(!name)return toast('أدخل المسمى');A.positions.push({id:uid('pos'),name,departmentId:q('apDept').value});save();renderDepartments();toast('تم حفظ المسمى')};
 }
 function renderShifts(){
  const rows=A.shifts.map((x,i)=>`<tr><td>${i+1}</td><td>${escA(x.name)}</td><td>${escA(x.start)} - ${escA(x.end)}</td><td>${x.fridayOff?'نعم':'لا'}</td><td>${x.saturdayOff?'نعم':'لا'}</td><td>${actionBtns('shifts',x.id)}</td></tr>`).join('');
  q('adminAffairsArea').innerHTML=shell('الورديات','تعريف ساعات العمل وأيام الراحة. تم إنشاء وردية افتراضية 08:00–17:00 مع الجمعة والسبت إجازة.',formRow([input('asName','اسم الوردية'),input('asStart','من','time','08:00'),input('asEnd','إلى','time','17:00'),field('أيام الراحة','<div class="admin-checks"><label><input id="asFri" type="checkbox" checked> الجمعة</label><label><input id="asSat" type="checkbox" checked> السبت</label></div>')],'<button class="gold-btn" id="asSave">＋ إضافة وردية</button>')+table(['#','الوردية','الساعات','الجمعة إجازة','السبت إجازة','الإجراء'],rows));
  q('asSave').onclick=()=>{const name=q('asName').value.trim();if(!name)return toast('أدخل اسم الوردية');A.shifts.push({id:uid('shift'),name,start:q('asStart').value||'08:00',end:q('asEnd').value||'17:00',fridayOff:q('asFri').checked,saturdayOff:q('asSat').checked});save();renderShifts();toast('تم حفظ الوردية')}
 }
 function renderLeaveTypes(){
  const rows=A.leaveTypes.map((x,i)=>`<tr><td>${i+1}</td><td>${escA(x.name)}</td><td>${escA(x.days)}</td><td>${x.paid?'مدفوعة':'غير مدفوعة'}</td><td>${actionBtns('leaveTypes',x.id)}</td></tr>`).join('');
  q('adminAffairsArea').innerHTML=shell('أنواع الإجازات','تعريف أنواع الإجازات ومددها. تم إنشاء الإجازة السنوية الافتراضية بحد 30 يوماً.',formRow([input('altName','اسم الإجازة','text',''),input('altDays','عدد الأيام','number','30','min="0"'),field('النوع','<div class="admin-checks"><label><input id="altPaid" type="checkbox" checked> مدفوعة</label></div>')],'<button class="gold-btn" id="altSave">＋ إضافة نوع إجازة</button>')+table(['#','النوع','الأيام','الحالة','الإجراء'],rows));
  q('altSave').onclick=()=>{const name=q('altName').value.trim();if(!name)return toast('أدخل نوع الإجازة');A.leaveTypes.push({id:uid('leave'),name,days:Number(q('altDays').value||0),paid:q('altPaid').checked});save();renderLeaveTypes();toast('تم حفظ نوع الإجازة')}
 }
 function renderEmployees(){
  const rows=A.employees.map((x,i)=>`<tr><td>${i+1}</td><td>${escA(x.name)}</td><td>${escA(x.idNo||'—')}</td><td>${escA(A.departments.find(d=>d.id===x.departmentId)?.name||'—')}</td><td>${escA(A.positions.find(p=>p.id===x.positionId)?.name||'—')}</td><td>${escA(A.shifts.find(s=>s.id===x.shiftId)?.name||'—')}</td><td>${actionBtns('employees',x.id)}</td></tr>`).join('');
  q('adminAffairsArea').innerHTML=shell('الموظفين','الموظف يرتبط بالشركة والقسم والمسمى والوردية، ويصبح هو المرجع للحضور والإجازات والعقود.',formRow([input('aeName','اسم الموظف'),input('aeId','رقم الهوية'),select('aeCompany','الشركة',companyOpts()),select('aeDept','القسم',deptOpts()),select('aePos','المسمى',positionOpts()),select('aeShift','الوردية',shiftOpts()),input('aeJoin','تاريخ المباشرة','date',dateNow())],'<button class="gold-btn" id="aeSave">＋ إضافة موظف</button>')+table(['#','الموظف','الهوية','القسم','المسمى','الوردية','الإجراء'],rows));
  q('aeSave').onclick=()=>{const name=q('aeName').value.trim();if(!name)return toast('أدخل اسم الموظف');A.employees.push({id:uid('emp'),name,idNo:q('aeId').value.trim(),companyId:q('aeCompany').value,departmentId:q('aeDept').value,positionId:q('aePos').value,shiftId:q('aeShift').value,startDate:q('aeJoin').value});save();renderEmployees();toast('تم حفظ الموظف')}
 }
 function renderContracts(){
  const rows=A.contracts.map((x,i)=>{const e=A.employees.find(z=>z.id===x.employeeId);return `<tr><td>${i+1}</td><td>${escA(e?.name||'—')}</td><td>${escA(x.startDate||'—')}</td><td>${escA(x.basicSalary)}</td><td>${escA(x.probationDays)} يوم</td><td>${escA(x.annualLeaveDays)} يوم</td><td>${escA(x.status||'ساري')}</td><td>${actionBtns('contracts',x.id)}</td></tr>`}).join('');
  q('adminAffairsArea').innerHTML=shell('العقود','العقد مرتبط بالموظف ويحتوي افتراضياً على 90 يوم تجربة و30 يوم إجازة سنوية.',formRow([select('acEmployee','الموظف',employeeOpts()),input('ctStart','بداية العقد','date',dateNow()),input('ctBasic','الراتب الأساسي','number','3000','min="0" step="0.01"'),input('ctProb','فترة التجربة بالأيام','number','90','min="0"'),input('ctLeave','الإجازة السنوية بالأيام','number','30','min="0"'),select('ctStatus','الحالة','<option value="ساري">ساري</option><option value="منتهي">منتهي</option><option value="موقوف">موقوف</option>')],'<button class="gold-btn" id="ctSave">＋ إضافة عقد</button>')+table(['#','الموظف','البداية','الأساسي','التجربة','الإجازة','الحالة','الإجراء'],rows));
  q('ctSave').onclick=()=>{const employeeId=q('acEmployee').value;if(!employeeId)return toast('اختر الموظف');A.contracts.push({id:uid('ct'),employeeId,startDate:q('ctStart').value,basicSalary:Number(q('ctBasic').value||0),probationDays:Number(q('ctProb').value||90),annualLeaveDays:Number(q('ctLeave').value||30),status:q('ctStatus').value});save();renderContracts();toast('تم حفظ العقد')}
 }
 function renderAttendance(){
  const rows=A.attendance.slice().reverse().map((x,i)=>{const e=A.employees.find(z=>z.id===x.employeeId),s=A.shifts.find(z=>z.id===x.shiftId);return `<tr><td>${i+1}</td><td>${escA(x.date)}</td><td>${escA(e?.name||'—')}</td><td>${escA(s?.name||'—')}</td><td>${escA(x.status)}</td><td>${escA(x.overtime||0)}</td><td>${actionBtns('attendance',x.id)}</td></tr>`}).join('');
  q('adminAffairsArea').innerHTML=shell('الحضور','الحضور مرتبط بالموظف والوردية. يمكن تسجيل حاضر، غائب، متأخر، إجازة أو مهمة.',formRow([select('ahEmployee','الموظف',employeeOpts()),input('ahDate','التاريخ','date',dateNow()),select('ahShift','الوردية',shiftOpts()),select('ahStatus','الحالة','<option>حاضر</option><option>غائب</option><option>متأخر</option><option>إجازة</option><option>مهمة</option>'),input('ahOvertime','ساعات إضافية','number','0','min="0" step="0.5"')],'<button class="gold-btn" id="ahSave">＋ تسجيل الحضور</button>')+table(['#','التاريخ','الموظف','الوردية','الحالة','إضافي','الإجراء'],rows));
  q('ahSave').onclick=()=>{const employeeId=q('ahEmployee').value;if(!employeeId)return toast('اختر الموظف');A.attendance.push({id:uid('att'),employeeId,date:q('ahDate').value,shiftId:q('ahShift').value,status:q('ahStatus').value,overtime:Number(q('ahOvertime').value||0)});save();renderAttendance();toast('تم تسجيل الحضور')}
 }
 function renderLeaveRequests(){
  const rows=A.leaveRequests.slice().reverse().map((x,i)=>{const e=A.employees.find(z=>z.id===x.employeeId),l=A.leaveTypes.find(z=>z.id===x.leaveTypeId);return `<tr><td>${i+1}</td><td>${escA(x.from)}</td><td>${escA(x.to)}</td><td>${escA(e?.name||'—')}</td><td>${escA(l?.name||'—')}</td><td>${escA(x.days)}</td><td>${escA(x.status)}</td><td>${actionBtns('leaveRequests',x.id)}</td></tr>`}).join('');
  q('adminAffairsArea').innerHTML=shell('طلبات الإجازات','طلب الإجازة مرتبط بالموظف ونوع الإجازة، مع احتساب عدد الأيام تلقائياً.',formRow([select('alEmployee','الموظف',employeeOpts()),select('alType','نوع الإجازة',leaveOpts()),input('alFrom','من','date',dateNow()),input('alTo','إلى','date',dateNow()),select('alStatus','الحالة','<option>معلق</option><option>مقبول</option><option>مرفوض</option>')],'<button class="gold-btn" id="alSave">＋ إضافة طلب</button>')+table(['#','من','إلى','الموظف','النوع','الأيام','الحالة','الإجراء'],rows));
  q('alSave').onclick=()=>{const employeeId=q('alEmployee').value;if(!employeeId)return toast('اختر الموظف');const from=q('alFrom').value,to=q('alTo').value;const days=from&&to?Math.max(1,Math.floor((new Date(to)-new Date(from))/86400000)+1):0;A.leaveRequests.push({id:uid('lr'),employeeId,leaveTypeId:q('alType').value,from,to,days,status:q('alStatus').value});save();renderLeaveRequests();toast('تم حفظ طلب الإجازة')}
 }
 function calcPayroll(emp,month){
  const contract=A.contracts.slice().reverse().find(c=>c.employeeId===emp.id&&(!c.startDate||c.startDate<=month+'-31'));
  const base=Number(contract?.basicSalary||0), att=A.attendance.filter(a=>a.employeeId===emp.id&&String(a.date).startsWith(month)), leaves=A.leaveRequests.filter(l=>l.employeeId===emp.id&&l.status==='مقبول'&&String(l.from).slice(0,7)<=month&&String(l.to).slice(0,7)>=month);
  const absent=att.filter(a=>a.status==='غائب').length, overtime=att.reduce((s,a)=>s+Number(a.overtime||0),0), leaveDays=leaves.reduce((s,l)=>s+Number(l.days||0),0);
  const workDays=Math.max(1,daysInMonth(month)-((contract?.annualLeaveDays||30)>0?0:0));
  const daily=base/workDays, absenceDeduction=absent*daily, overtimePay=overtime*(base/30/8*1.5), leaveDeduction=0;
  return {base,absent,overtime,leaveDays,absenceDeduction,overtimePay,leaveDeduction,total:Math.max(0,base-absenceDeduction-leaveDeduction+overtimePay)};
 }
 function renderPayroll(){
  const month=q('apMonth')?.value||monthKey();
  const rows=A.employees.map((e,i)=>{const c=calcPayroll(e,month);return `<tr><td>${i+1}</td><td>${escA(e.name)}</td><td>${c.base.toFixed(2)}</td><td>${c.absent}</td><td>${c.leaveDays}</td><td>${c.overtime.toFixed(1)}</td><td class="num">${c.absenceDeduction.toFixed(2)}</td><td class="num">${c.overtimePay.toFixed(2)}</td><td class="num gold-text">${c.total.toFixed(2)}</td><td><button class="soft-btn admin-save-payroll" data-id="${e.id}">حفظ</button></td></tr>`}).join('');
  const total=A.employees.reduce((s,e)=>s+calcPayroll(e,month).total,0);
  q('adminAffairsArea').innerHTML=shell('الرواتب','الراتب يجمع بيانات العقد (6) مع الحضور (7) وطلبات الإجازات المقبولة (8).',formRow([input('apMonth','شهر الرواتب','month',month)],'<button class="gold-btn" id="apGenerate">↻ تحديث الرواتب</button>')+`<div class="payroll-total"><span>إجمالي الرواتب</span><b>${total.toFixed(2)} SAR</b></div>`+table(['#','الموظف','العقد','غياب','إجازات','إضافي','خصم الغياب','بدل إضافي','الصافي','الإجراء'],rows,'أضف موظفين وعقوداً أولاً.'));
  q('apGenerate').onclick=renderPayroll;
  q('apMonth').onchange=renderPayroll;
  q('adminAffairsArea').querySelectorAll('.admin-save-payroll').forEach(btn=>btn.onclick=()=>{const e=A.employees.find(x=>x.id===btn.dataset.id);if(!e)return;const c=calcPayroll(e,month);const idx=A.payroll.findIndex(p=>p.employeeId===e.id&&p.month===month);const item={id:idx>=0?A.payroll[idx].id:uid('pay'),employeeId:e.id,month,base:c.base,absenceDeduction:c.absenceDeduction,overtimePay:c.overtimePay,leaveDays:c.leaveDays,total:c.total};if(idx>=0)A.payroll[idx]=item;else A.payroll.push(item);save();toast('تم حفظ راتب الموظف')});
 }
 const renders={companies:renderCompanies,departments:renderDepartments,shifts:renderShifts,leaveTypes:renderLeaveTypes,employees:renderEmployees,contracts:renderContracts,attendance:renderAttendance,leaveRequests:renderLeaveRequests,payroll:renderPayroll};
 let active='companies';
 function setModule(m){active=m;document.querySelectorAll('[data-admin-module]').forEach(b=>b.classList.toggle('active',b.dataset.adminModule===m));const fn=renders[m];if(fn)fn();}
 function toggleSub(open){const s=q('adminAffairsSubnav'),n=q('adminAffairsNav');if(!s||!n)return;s.classList.toggle('show',open??!s.classList.contains('show'));s.setAttribute('aria-hidden',String(!s.classList.contains('show')));n.classList.toggle('expanded',s.classList.contains('show'))}
 document.addEventListener('DOMContentLoaded',()=>{
   const nav=q('adminAffairsNav');
   if(nav)nav.addEventListener('click',()=>{toggleSub(true);setModule(active);});
   document.querySelectorAll('.nav:not(#adminAffairsNav):not(#financialAffairsNav)').forEach(b=>b.addEventListener('click',()=>toggleSub(false)));
   document.querySelectorAll('#adminAffairsSubnav [data-admin-module], #adminAffairs .admin-flow-step').forEach(b=>b.addEventListener('click',e=>{e.preventDefault();e.stopPropagation();toggleSub(true);setModule(b.dataset.adminModule)}));
   document.addEventListener('click',e=>{const del=e.target.closest('.admin-delete');if(!del)return;const kind=del.dataset.adminDelete,id=del.dataset.id;if(!A[kind])return;if(!confirm('هل تريد حذف هذا السجل؟'))return;A[kind]=A[kind].filter(x=>x.id!==id);if(kind==='departments')A.positions=A.positions.filter(x=>x.departmentId!==id);if(kind==='employees'){A.contracts=A.contracts.filter(x=>x.employeeId!==id);A.attendance=A.attendance.filter(x=>x.employeeId!==id);A.leaveRequests=A.leaveRequests.filter(x=>x.employeeId!==id)}save();renders[active]?.();toast('تم الحذف')});
   if(q('adminAffairs')){setModule('companies')}
 });
 window.renderAdminAffairs=()=>renders[active]?.();
 window.openAdminAffairsModule=m=>{toggleSub(true);setModule(m)};
})();
