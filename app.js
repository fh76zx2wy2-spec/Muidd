import * as Auth from "./google-auth.js";
import * as Calendar from "./google-calendar.js";
import * as Tasks from "./google-tasks.js";
import * as Sync from "./sync-manager.js";

/* =================== Hijri <-> Gregorian conversion (tabular Islamic calendar) =================== */
function gregorianToJDN(y,m,d){
  const a = Math.floor((14-m)/12);
  const y2 = y + 4800 - a;
  const m2 = m + 12*a - 3;
  return d + Math.floor((153*m2+2)/5) + 365*y2 + Math.floor(y2/4) - Math.floor(y2/100) + Math.floor(y2/400) - 32045;
}
function jdnToGregorian(jdn){
  const a = jdn + 32044;
  const b = Math.floor((4*a+3)/146097);
  const c = a - Math.floor((146097*b)/4);
  const d2 = Math.floor((4*c+3)/1461);
  const e = c - Math.floor((1461*d2)/4);
  const m2 = Math.floor((5*e+2)/153);
  const day = e - Math.floor((153*m2+2)/5) + 1;
  const month = m2 + 3 - 12*Math.floor(m2/10);
  const year = 100*b + d2 - 4800 + Math.floor(m2/10);
  return {y:year, m:month, d:day};
}
function islamicToJDN(y,m,d){
  return d + Math.ceil(29.5*(m-1)) + (y-1)*354 + Math.floor((3+11*y)/30) + 1948440 - 1;
}
function jdnToIslamic(jdnIn){
  let jdn = jdnIn - 1948440 + 10632;
  const n = Math.floor((jdn-1)/10631);
  jdn = jdn - 10631*n + 354;
  const j = (Math.floor((10985-jdn)/5316))*(Math.floor((50*jdn)/17719)) + (Math.floor(jdn/5670))*(Math.floor((43*jdn)/15238));
  jdn = jdn - (Math.floor((30-j)/15))*(Math.floor((17719*j)/50)) - (Math.floor(j/16))*(Math.floor((15238*j)/43)) + 29;
  const iMonth = Math.floor((24*jdn)/709);
  const iDay = jdn - Math.floor((709*iMonth)/24);
  const iYear = 30*n + j - 30;
  return {y:iYear, m:iMonth, d:iDay};
}
function hijriToGregorian(y,m,d){ return jdnToGregorian(islamicToJDN(y,m,d)); }
function gregorianToHijri(y,m,d){ return jdnToIslamic(gregorianToJDN(y,m,d)); }
function hijriToJSDate(y,m,d){ const g = hijriToGregorian(y,m,d); return new Date(g.y, g.m-1, g.d); }

const HIJRI_MONTHS = ["محرم","صفر","ربيع الأول","ربيع الآخر","جمادى الأولى","جمادى الآخرة","رجب","شعبان","رمضان","شوال","ذو القعدة","ذو الحجة"];
const WEEKDAYS = ["الأحد","الاثنين","الثلاثاء","الأربعاء","الخميس","الجمعة","السبت"];

function todayHijri(){
  const t = new Date();
  return gregorianToHijri(t.getFullYear(), t.getMonth()+1, t.getDate());
}
function fmtHijri(h){ return `${h.d} ${HIJRI_MONTHS[h.m-1]} ${h.y}هـ`; }

/* =================== Constants =================== */
const REASONS = [
  {k:'study_lawsuit', l:'دراسة الدعوى'},
  {k:'study_response', l:'دراسة الجواب'},
  {k:'review_memos', l:'مراجعة المذكرات'},
  {k:'review_evidence', l:'مراجعة البينات'},
  {k:'review_acknowledgements', l:'مراجعة الإقرارات'},
  {k:'review_docs', l:'مراجعة المستندات'},
  {k:'review_expert', l:'مراجعة تقرير الخبير'},
  {k:'review_prior_rulings', l:'مراجعة الأحكام السابقة'},
  {k:'review_regulations', l:'مراجعة الأنظمة'},
  {k:'review_bylaws', l:'مراجعة اللائحة التنفيذية'},
  {k:'review_precedents', l:'مراجعة السوابق القضائية'},
  {k:'prep_questions', l:'تجهيز أسئلة الجلسة'},
  {k:'draft_ruling', l:'كتابة مسودة الحكم'},
  {k:'ready_for_ruling', l:'القضية جاهزة للحكم'},
  {k:'needs_extra_session', l:'تحتاج جلسة إضافية'},
  {k:'waiting_doc', l:'انتظار مستند'},
  {k:'waiting_response', l:'انتظار جواب'},
  {k:'waiting_expert', l:'انتظار خبير'},
  {k:'waiting_witness', l:'انتظار شاهد'},
  {k:'needs_fiqh_research', l:'تحتاج بحثًا فقهيًا'},
  {k:'needs_legal_research', l:'تحتاج بحثًا نظاميًا'},
  {k:'needs_final_review', l:'تحتاج مراجعة أخيرة'},
  {k:'other', l:'أخرى'},
];
const STATUSES = [
  {k:'not_started', l:'لم أبدأ'},
  {k:'in_progress', l:'بدأت الدراسة'},
  {k:'needs_review', l:'تحتاج مراجعة'},
  {k:'completed', l:'مكتملة'},
  {k:'ready', l:'جاهزة للحكم'},
];
const DETAIL_CARDS = [
  {k:'lawsuit', l:'ملخص الدعوى', icon:'📄'},
  {k:'response', l:'ملخص الجواب', icon:'📝'},
  {k:'evidence', l:'البينات', icon:'📂'},
  {k:'acknowledgements', l:'الإقرارات', icon:'📌'},
  {k:'legalIssues', l:'المسائل النظامية', icon:'⚖️'},
  {k:'pointsToStudy', l:'نقاط تحتاج دراسة', icon:'💡'},
  {k:'notes', l:'ملاحظاتي', icon:'✍️'},
];
const TYPES = ['مرورية','مالية','عقارية','أحوال شخصية','أخرى'];
const REMINDER_PRESETS = [
  {k:'week',   l:'قبل أسبوع',        icon:'📆'},
  {k:'3days',  l:'قبل 3 أيام',       icon:'🗓️'},
  {k:'1day',   l:'قبل يوم',          icon:'⏰'},
  {k:'morning',l:'صباح يوم الجلسة',  icon:'🌅'},
  {k:'2hours', l:'قبل ساعتين',       icon:'⏱️'},
];
function reminderPresetLabel(k){ return (REMINDER_PRESETS.find(p=>p.k===k)||{}).l || ''; }

/* =================== Reminder date math + Google Calendar/Tasks sync ==================== */
function sessionDateTime(c){
  const g = hijriToGregorian(c.session.y, c.session.m, c.session.d);
  const [hh, mm] = (c.sessionTime || '09:00').split(':').map(Number);
  return new Date(g.y, g.m-1, g.d, hh, mm, 0);
}
function reminderDateFor(c){
  const dt = sessionDateTime(c);
  switch(c.reminder.preset){
    case 'week':   return new Date(dt.getTime() - 7*24*60*60*1000);
    case '3days':  return new Date(dt.getTime() - 3*24*60*60*1000);
    case '1day':   return new Date(dt.getTime() - 1*24*60*60*1000);
    case 'morning':{ const d = new Date(dt); d.setHours(7,0,0,0); return d; }
    case '2hours': return new Date(dt.getTime() - 2*60*60*1000);
    default:       return new Date(dt.getTime() - 24*60*60*1000);
  }
}
const USER_TZ = Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Riyadh';
function toLocalISO(d){
  const pad = n=>String(n).padStart(2,'0');
  return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:00`;
}
async function syncReminderToGoogle(c){
  if(!Auth.getAuthState().connected) return;
  const start = reminderDateFor(c);
  const end = new Date(start.getTime() + 30*60*1000);
  const event = {
    summary: `⚖️ دراسة قضية ${c.number} — ${reminderPresetLabel(c.reminder.preset)}`,
    description: `${c.plaintiff} ضد ${c.defendant}\nجلسة يوم: ${fmtHijri(c.session)} (${weekdayOf(c)})`,
    start:{ dateTime: toLocalISO(start), timeZone: USER_TZ },
    end:{ dateTime: toLocalISO(end), timeZone: USER_TZ },
    reminders:{ useDefault:false, overrides:[{method:'popup', minutes:0}] }
  };
  const task = {
    title: `دراسة قضية ${c.number} — ${c.plaintiff} ضد ${c.defendant}`,
    notes: `${reminderPresetLabel(c.reminder.preset)} — جلسة يوم ${fmtHijri(c.session)} (${weekdayOf(c)})`,
    due: start.toISOString()
  };
  try{
    const [evData, taskData] = await Promise.all([
      Calendar.upsertEvent(c.reminder.calendarEventId, event),
      Tasks.upsertTask(c.reminder.taskId, task),
    ]);
    if(evData && evData.id) c.reminder.calendarEventId = evData.id;
    if(taskData && taskData.id) c.reminder.taskId = taskData.id;
  }catch(e){ showToast('تعذّر إنشاء التذكير في Google: ' + e.message); }
}
async function removeReminderFromGoogle(c){
  if(!Auth.getAuthState().connected) return;
  try{
    await Promise.all([ Calendar.deleteEvent(c.reminder.calendarEventId), Tasks.deleteTask(c.reminder.taskId) ]);
  }catch(e){ /* best-effort */ }
  c.reminder.calendarEventId = null;
  c.reminder.taskId = null;
}

/* =================== State =================== */
let cases = [];
let activeFilters = new Set();
let searchQuery = '';
let currentCaseId = null;
let editMode = false;
let currentTab = 'study';

function loadCases(){ cases = Sync.loadLocal().cases || []; }
function persistCases(){ Sync.saveCases(cases); }
function uid(){ return 'c_' + Date.now().toString(36) + Math.random().toString(36).slice(2,7); }

/* =================== Derived helpers =================== */
function daysRemaining(c){
  const g = hijriToGregorian(c.session.y, c.session.m, c.session.d);
  const sessionDate = new Date(g.y, g.m-1, g.d);
  const today = new Date(); today.setHours(0,0,0,0);
  sessionDate.setHours(0,0,0,0);
  return Math.round((sessionDate - today) / 86400000);
}
function weekdayOf(c){
  const g = hijriToGregorian(c.session.y, c.session.m, c.session.d);
  return WEEKDAYS[new Date(g.y, g.m-1, g.d).getDay()];
}
function urgencyLevel(days){
  if(days<=1) return 'red';
  if(days<=3) return 'orange';
  if(days<=7) return 'yellow';
  return 'green';
}
function urgencyLabel(days){
  if(days<0) return 'فاتت الجلسة';
  if(days===0) return 'اليوم';
  if(days===1) return 'غدًا';
  return `بعد ${days} ${days===2?'يومين':'أيام'}`;
}
function progressPct(c){
  const total = REASONS.length;
  const checked = REASONS.filter(r=>c.reasons[r.k]).length;
  return Math.round((checked/total)*100);
}
function statusLabel(k){ return (STATUSES.find(s=>s.k===k)||{}).l || k; }

function priorityScore(c){
  if(c.status==='completed' || c.status==='ready') return -1;
  const days = daysRemaining(c);
  if(days < -30) return -1;
  let urgency;
  if(days<=1) urgency=100; else if(days<=3) urgency=82; else if(days<=7) urgency=58; else urgency=Math.max(8, 40-days);
  const gap = 100 - progressPct(c);
  const lastOpened = c.log.lastOpened ? new Date(c.log.lastOpened) : new Date(c.log.createdAt);
  const staleDays = Math.min(14, (Date.now()-lastOpened.getTime())/86400000);
  return urgency*1.4 + gap*0.55 + staleDays*2.2;
}

/* =================== Rendering =================== */
function el(html){ const t = document.createElement('template'); t.innerHTML = html.trim(); return t.content.firstChild; }
function esc(s){ return (s||'').replace(/[&<>"']/g, m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m])); }

function renderAll(){
  renderPriority();
  renderFilterChips();
  renderGrid();
  document.getElementById('todayHijri').textContent = fmtHijri(todayHijri());
}

function renderPriority(){
  const scroller = document.getElementById('priorityScroller');
  const ranked = cases.map(c=>({c, score:priorityScore(c)})).filter(x=>x.score>=0).sort((a,b)=>b.score-a.score).slice(0,5);
  document.getElementById('prioritySection').style.display = ranked.length ? '' : 'none';
  scroller.innerHTML = '';
  ranked.forEach((item, i)=>{
    const c = item.c;
    const days = daysRemaining(c);
    const lvl = urgencyLevel(days);
    const pct = progressPct(c);
    const circumference = 2*Math.PI*17;
    const offset = circumference * (1 - pct/100);
    const card = el(`
      <div class="pcard" data-id="${c.id}">
        <span class="rank">${i+1}</span>
        <div class="pcard-top">
          <div></div>
          <div class="ring-wrap">
            <svg width="46" height="46" viewBox="0 0 46 46">
              <circle cx="23" cy="23" r="17" fill="none" stroke="var(--surface-3)" stroke-width="4"/>
              <circle cx="23" cy="23" r="17" fill="none" stroke="var(--${lvl})" stroke-width="4" stroke-linecap="round"
                stroke-dasharray="${circumference}" stroke-dashoffset="${offset}"/>
            </svg>
            <div class="ring-label">${pct}%</div>
          </div>
        </div>
        <div class="pnum">${esc(c.number)}</div>
        <div class="pparties">${esc(c.plaintiff)} ضد ${esc(c.defendant)}</div>
        <div class="pmeta">
          <span class="days-badge" style="background:var(--${lvl}-soft); color:var(--${lvl});">${urgencyLabel(days)}</span>
          <span style="color:var(--text-2);">· ${statusLabel(c.status)}</span>
        </div>
      </div>
    `);
    card.addEventListener('click', ()=>openDetail(c.id));
    scroller.appendChild(card);
  });
}

const FILTER_DEFS = [
  {k:'tomorrow', l:'غدًا', group:'time'},
  {k:'within3', l:'خلال ٣ أيام', group:'time'},
  {k:'withinWeek', l:'خلال أسبوع', group:'time'},
  {k:'ready', l:'جاهزة للحكم', group:'status'},
  {k:'not_started', l:'لم تبدأ', group:'status'},
  {k:'in_progress', l:'قيد الدراسة', group:'status'},
  {k:'completed', l:'مكتملة', group:'status'},
  {k:'مرورية', l:'مرورية', group:'type'},
  {k:'مالية', l:'مالية', group:'type'},
  {k:'عقارية', l:'عقارية', group:'type'},
  {k:'أحوال شخصية', l:'أحوال شخصية', group:'type'},
];
function renderFilterChips(){
  const wrap = document.getElementById('filterChips');
  wrap.innerHTML='';
  FILTER_DEFS.forEach(f=>{
    const chip = el(`<div class="chip ${activeFilters.has(f.k)?'active':''}" data-k="${f.k}">${f.l}</div>`);
    chip.addEventListener('click', ()=>{
      if(activeFilters.has(f.k)) activeFilters.delete(f.k); else activeFilters.add(f.k);
      renderFilterChips(); renderGrid();
    });
    wrap.appendChild(chip);
  });
}
function matchesFilters(c){
  const groups = {time:[], status:[], type:[]};
  FILTER_DEFS.forEach(f=>{ if(activeFilters.has(f.k)) groups[f.group].push(f.k); });
  const days = daysRemaining(c);
  if(groups.time.length){
    const ok = groups.time.some(k=>{
      if(k==='tomorrow') return days===1;
      if(k==='within3') return days>=0 && days<=3;
      if(k==='withinWeek') return days>=0 && days<=7;
      return false;
    });
    if(!ok) return false;
  }
  if(groups.status.length){
    const ok = groups.status.some(k=>{
      if(k==='ready') return c.status==='ready';
      if(k==='not_started') return c.status==='not_started';
      if(k==='in_progress') return c.status==='in_progress' || c.status==='needs_review';
      if(k==='completed') return c.status==='completed';
      return false;
    });
    if(!ok) return false;
  }
  if(groups.type.length){
    if(!groups.type.includes(c.type)) return false;
  }
  return true;
}
function matchesSearch(c){
  if(!searchQuery) return true;
  const q = searchQuery.trim().toLowerCase();
  const hay = [c.number, c.plaintiff, c.defendant, c.type, ...DETAIL_CARDS.map(d=>c.details[d.k]||'')].join(' ').toLowerCase();
  return hay.includes(q);
}

function renderGrid(){
  const grid = document.getElementById('casesGrid');
  const list = cases.filter(c=>matchesFilters(c) && matchesSearch(c))
    .sort((a,b)=> daysRemaining(a) - daysRemaining(b));
  document.getElementById('resultCount').textContent = `${list.length} من ${cases.length} قضية`;
  grid.innerHTML='';
  if(!list.length){
    grid.appendChild(el(`
      <div class="empty-state" style="grid-column:1/-1;">
        <div class="em-icon">🗂️</div>
        <div class="em-title">${cases.length? 'لا توجد قضايا مطابقة':'لا توجد قضايا بعد'}</div>
        <div>${cases.length? 'جرّب تعديل الفلاتر أو البحث':'ابدأ بإضافة أول قضية من الزر أدناه'}</div>
      </div>
    `));
    return;
  }
  list.forEach(c=>{
    const days = daysRemaining(c);
    const lvl = urgencyLevel(days);
    const pct = progressPct(c);
    const card = el(`
      <div class="case-card" data-id="${c.id}">
        <div class="urgency-dot ${lvl==='red'?'pulse':''}" style="background:var(--${lvl}); color:var(--${lvl});"></div>
        <div class="cnum">${esc(c.number)}</div>
        <div class="cparties">${esc(c.plaintiff)} ضد ${esc(c.defendant)}</div>
        <span class="ctype-tag">${esc(c.type)}</span>
        <div class="cdate-row">
          <span>${weekdayOf(c)} · ${fmtHijri(c.session)}</span>
          <span class="days-badge" style="background:var(--${lvl}-soft); color:var(--${lvl});">${urgencyLabel(days)}</span>
        </div>
        <div class="progress-bar"><div style="width:${pct}%;"></div></div>
        <div class="status-row">
          <span class="section-sub">${pct}% مكتملة</span>
          <span class="status-pill" style="background:var(--accent-soft); color:var(--accent-text);">${statusLabel(c.status)}</span>
        </div>
      </div>
    `);
    card.addEventListener('click', ()=>openDetail(c.id));
    grid.appendChild(card);
  });
}

/* =================== Toast =================== */
let toastTimer;
function showToast(msg){
  const t = document.getElementById('toast');
  t.textContent = msg; t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(()=>t.classList.remove('show'), 2200);
}

/* =================== Case form (add/edit) =================== */
function populateHijriSelectors(){
  const daySel = document.getElementById('f_day');
  const monthSel = document.getElementById('f_month');
  const yearSel = document.getElementById('f_year');
  daySel.innerHTML = Array.from({length:30},(_,i)=>`<option value="${i+1}">${i+1}</option>`).join('');
  monthSel.innerHTML = HIJRI_MONTHS.map((m,i)=>`<option value="${i+1}">${m}</option>`).join('');
  const ty = todayHijri();
  yearSel.innerHTML = Array.from({length:6},(_,i)=>ty.y-1+i).map(y=>`<option value="${y}">${y}هـ</option>`).join('');
}
function openCaseForm(existing){
  editMode = !!existing;
  document.getElementById('caseFormTitle').textContent = editMode ? 'تعديل بيانات القضية' : 'قضية جديدة';
  document.getElementById('f_number').value = existing? existing.number : '';
  document.getElementById('f_type').value = existing? existing.type : 'مرورية';
  document.getElementById('f_plaintiff').value = existing? existing.plaintiff : '';
  document.getElementById('f_defendant').value = existing? existing.defendant : '';
  const h = existing? existing.session : todayHijri();
  document.getElementById('f_day').value = h.d;
  document.getElementById('f_month').value = h.m;
  document.getElementById('f_year').value = h.y;
  document.getElementById('f_time').value = existing? (existing.sessionTime || '09:00') : '09:00';
  document.getElementById('caseFormOverlay').classList.add('open');
}
async function saveCaseForm(){
  const number = document.getElementById('f_number').value.trim();
  const plaintiff = document.getElementById('f_plaintiff').value.trim();
  const defendant = document.getElementById('f_defendant').value.trim();
  const type = document.getElementById('f_type').value;
  const sessionTime = document.getElementById('f_time').value || '09:00';
  const session = {
    d: parseInt(document.getElementById('f_day').value),
    m: parseInt(document.getElementById('f_month').value),
    y: parseInt(document.getElementById('f_year').value),
  };
  if(!number || !plaintiff || !defendant){ showToast('يرجى تعبئة الحقول الأساسية'); return; }

  if(editMode && currentCaseId){
    const c = cases.find(x=>x.id===currentCaseId);
    Object.assign(c, {number, plaintiff, defendant, type, session, sessionTime});
    c.log.lastModified = new Date().toISOString();
    if(Auth.getAuthState().connected && c.reminder.enabled) await syncReminderToGoogle(c);
  } else {
    const now = new Date().toISOString();
    cases.push({
      id: uid(), number, plaintiff, defendant, type, session, sessionTime,
      reasons: Object.fromEntries(REASONS.map(r=>[r.k,false])),
      status: 'not_started',
      details: Object.fromEntries(DETAIL_CARDS.map(d=>[d.k,''])),
      reminder: {enabled:false, preset:null, calendarEventId:null, taskId:null},
      log: {createdAt: now, lastOpened: now, lastModified: now}
    });
  }
  persistCases();
  closeOverlay('caseFormOverlay');
  renderAll();
  showToast('تم حفظ القضية');
}

/* =================== Detail view =================== */
function openDetail(id){
  currentCaseId = id;
  const c = cases.find(x=>x.id===id);
  if(!c) return;
  c.log.lastOpened = new Date().toISOString();
  persistCases();

  document.getElementById('d_number').textContent = c.number;
  document.getElementById('d_parties').textContent = `${c.plaintiff} ضد ${c.defendant}`;
  const days = daysRemaining(c);
  const lvl = urgencyLevel(days);
  const badge = document.getElementById('d_daysBadge');
  badge.textContent = urgencyLabel(days);
  badge.style.background = `var(--${lvl}-soft)`; badge.style.color = `var(--${lvl})`;
  document.getElementById('d_dateStr').textContent = `${weekdayOf(c)} · ${fmtHijri(c.session)}`;
  document.getElementById('d_typeTag').textContent = c.type;

  const pct = progressPct(c);
  document.getElementById('d_progressFill').style.width = pct+'%';
  document.getElementById('d_progressLabel').textContent = `${pct}% من مهام الدراسة مكتملة`;

  renderChecklist(c);
  renderDetailCards(c);
  renderStatusOptions(c);
  renderLog(c);
  switchTab('study');

  document.getElementById('detailOverlay').classList.add('open');
}
function renderChecklist(c){
  const wrap = document.getElementById('d_checklist');
  wrap.innerHTML='';
  REASONS.forEach(r=>{
    const checked = !!c.reasons[r.k];
    const item = el(`
      <div class="check-item ${checked?'checked':''}" data-k="${r.k}">
        <span class="box"><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="3"><path d="M20 6 9 17l-5-5"/></svg></span>
        <span>${r.l}</span>
      </div>
    `);
    item.addEventListener('click', ()=>{
      c.reasons[r.k] = !c.reasons[r.k];
      c.log.lastModified = new Date().toISOString();
      persistCases();
      renderChecklist(c);
      const p = progressPct(c);
      document.getElementById('d_progressFill').style.width = p+'%';
      document.getElementById('d_progressLabel').textContent = `${p}% من مهام الدراسة مكتملة`;
      renderGrid(); renderPriority();
    });
    wrap.appendChild(item);
  });
}
function renderDetailCards(c){
  const wrap = document.getElementById('d_detailCards');
  wrap.innerHTML='';
  DETAIL_CARDS.forEach(d=>{
    const card = el(`
      <div class="detail-card">
        <h4>${d.icon} ${d.l}</h4>
        <textarea placeholder="اكتب هنا…"></textarea>
      </div>
    `);
    const ta = card.querySelector('textarea');
    ta.value = c.details[d.k] || '';
    let debounce;
    ta.addEventListener('input', ()=>{
      clearTimeout(debounce);
      debounce = setTimeout(()=>{
        c.details[d.k] = ta.value;
        c.log.lastModified = new Date().toISOString();
        persistCases();
      }, 400);
    });
    wrap.appendChild(card);
  });
}
function renderStatusOptions(c){
  const wrap = document.getElementById('d_statusOptions');
  wrap.innerHTML='';
  STATUSES.forEach(s=>{
    const opt = el(`<div class="toggle-opt ${c.status===s.k?'selected':''}" data-k="${s.k}"><span class="radio-dot"></span>${s.l}</div>`);
    opt.addEventListener('click', ()=>{
      c.status = s.k;
      c.log.lastModified = new Date().toISOString();
      persistCases();
      renderStatusOptions(c);
      renderGrid(); renderPriority();
    });
    wrap.appendChild(opt);
  });
  const info = document.getElementById('d_reminderInfo');
  const connected = Auth.getAuthState().connected;
  info.textContent = c.reminder.enabled ? `🔔 تذكير مفعّل — ${reminderPresetLabel(c.reminder.preset)}${connected? ' (متزامن مع Google)':''}` : '';
}
function renderLog(c){
  const wrap = document.getElementById('d_log');
  const fmt = (iso)=> new Date(iso).toLocaleDateString('ar-SA', {day:'numeric', month:'short', year:'numeric'});
  wrap.innerHTML = `
    <span>تاريخ الإنشاء: <b>${fmt(c.log.createdAt)}</b></span>
    <span>آخر فتح: <b>${fmt(c.log.lastOpened)}</b></span>
    <span>آخر تعديل: <b>${fmt(c.log.lastModified)}</b></span>
    <span>الحالة: <b>${statusLabel(c.status)}</b></span>
  `;
}
function switchTab(name){
  currentTab = name;
  document.querySelectorAll('.tab').forEach(t=>t.classList.toggle('active', t.dataset.tab===name));
  document.getElementById('tab_study').style.display = name==='study'?'':'none';
  document.getElementById('tab_notes').style.display = name==='notes'?'':'none';
  document.getElementById('tab_status').style.display = name==='status'?'':'none';
}

/* =================== Overlays =================== */
function closeOverlay(id){ document.getElementById(id).classList.remove('open'); }
document.querySelectorAll('[data-close]').forEach(b=>{
  b.addEventListener('click', ()=>closeOverlay(b.dataset.close));
});
document.querySelectorAll('.overlay').forEach(o=>{
  if(o.id === 'conflictOverlay') return; // force explicit choice, no backdrop dismiss
  o.addEventListener('click', (e)=>{ if(e.target===o) closeOverlay(o.id); });
});

/* =================== Wire up static controls =================== */
document.getElementById('newCaseBtn').addEventListener('click', ()=>{ currentCaseId=null; openCaseForm(null); });
document.getElementById('fabAdd').addEventListener('click', ()=>{ currentCaseId=null; openCaseForm(null); });
document.getElementById('saveCaseBtn').addEventListener('click', saveCaseForm);
document.getElementById('editCaseBtn').addEventListener('click', ()=>{
  const c = cases.find(x=>x.id===currentCaseId);
  closeOverlay('detailOverlay');
  openCaseForm(c);
});
document.getElementById('deleteCaseBtn').addEventListener('click', ()=>{
  if(!confirm('هل تريد حذف هذه القضية نهائيًا؟')) return;
  cases = cases.filter(x=>x.id!==currentCaseId);
  persistCases();
  closeOverlay('detailOverlay');
  renderAll();
  showToast('تم حذف القضية');
});
document.querySelectorAll('.tab').forEach(t=>t.addEventListener('click', ()=>switchTab(t.dataset.tab)));

function renderReminderOptions(c){
  const wrap = document.getElementById('reminderOptions');
  wrap.innerHTML = '';
  REMINDER_PRESETS.forEach(p=>{
    const opt = el(`
      <div class="toggle-opt ${c.reminder.preset===p.k?'selected':''}" data-k="${p.k}" style="justify-content:flex-start;">
        <span class="radio-dot"></span>${p.icon} ${p.l}
      </div>
    `);
    opt.addEventListener('click', async ()=>{
      c.reminder.enabled = true;
      c.reminder.preset = p.k;
      c.log.lastModified = new Date().toISOString();
      renderReminderOptions(c);
      const connected = Auth.getAuthState().connected;
      if(connected) showToast('جاري إنشاء الحدث في تقويم Google…');
      await syncReminderToGoogle(c);
      persistCases();
      renderStatusOptions(c);
      closeOverlay('reminderOverlay');
      showToast(connected ? `تم إنشاء تذكير "${p.l}" في تقويم ومهام Google ✓` : `تم تحديد التذكير: ${p.l} (اربط جوجل لتفعيل المزامنة التلقائية)`);
    });
    wrap.appendChild(opt);
  });
  document.getElementById('reminderRemoveFoot').style.display = c.reminder.enabled ? 'flex' : 'none';
}
document.getElementById('openReminderBtn').addEventListener('click', ()=>{
  const c = cases.find(x=>x.id===currentCaseId);
  const connected = Auth.getAuthState().connected;
  document.getElementById('reminderGoogleHint').textContent = connected
    ? '🔗 سيُضاف تلقائيًا كحدث في تقويم Google ومهمة في Google Tasks (تظهر في تذكيرات الآيفون إذا ربطت حساب جوجل من إعدادات الآيفون).'
    : 'ℹ️ اضغط "ربط جوجل" أعلى الصفحة أولًا ليُضاف هذا التذكير تلقائيًا لتقويمك ومهامك.';
  renderReminderOptions(c);
  document.getElementById('reminderOverlay').classList.add('open');
});
document.getElementById('removeReminderBtn').addEventListener('click', async ()=>{
  const c = cases.find(x=>x.id===currentCaseId);
  await removeReminderFromGoogle(c);
  c.reminder.enabled = false;
  c.reminder.preset = null;
  c.log.lastModified = new Date().toISOString();
  persistCases();
  renderStatusOptions(c);
  closeOverlay('reminderOverlay');
  showToast('تم إلغاء التذكير');
});

document.getElementById('searchInput').addEventListener('input', (e)=>{ searchQuery = e.target.value; renderGrid(); });

const themeToggle = document.getElementById('themeToggle');
themeToggle.addEventListener('click', ()=>{
  const root = document.documentElement;
  const next = root.getAttribute('data-theme')==='dark' ? 'light' : 'dark';
  root.setAttribute('data-theme', next);
  try{ localStorage.setItem('ct_theme', next); }catch(e){}
});
window.addEventListener('scroll', ()=>{
  document.getElementById('topbar').classList.toggle('scrolled', window.scrollY>4);
});

/* =================== Google account UI: connect / status dot / account menu / conflicts =================== */
function updateGoogleBtn(){
  const authState = Auth.getAuthState();
  const label = document.getElementById('googleBtnLabel');
  const btn = document.getElementById('googleConnectBtn');
  const menu = document.getElementById('accountMenu');
  if(authState.connected){
    label.textContent = authState.account && authState.account.email ? authState.account.email.split('@')[0] : 'متصل ✓';
    btn.classList.add('btn-soft');
    document.getElementById('accountMenuEmail').textContent = (authState.account && authState.account.email) || '';
  } else {
    label.textContent = 'ربط جوجل';
    btn.classList.remove('btn-soft');
    menu.classList.remove('open');
  }
  // keep any open reminder/status panels in sync with the latest connection state
  if(currentCaseId && document.getElementById('detailOverlay').classList.contains('open')){
    const c = cases.find(x=>x.id===currentCaseId);
    if(c) renderStatusOptions(c);
  }
}
document.getElementById('googleConnectBtn').addEventListener('click', async ()=>{
  const authState = Auth.getAuthState();
  if(authState.connected){
    document.getElementById('accountMenu').classList.toggle('open');
    return;
  }
  if(!Auth.isConfigured()){ showToast('أضف Client ID الخاص بك أولاً داخل google-auth.js'); return; }
  try{
    await Auth.connect();
    showToast('تم الاتصال بحساب جوجل ✓');
    await Sync.checkAndSync();
  }catch(e){
    showToast('تعذّر الاتصال بحساب جوجل: ' + e.message);
  }
});
document.getElementById('logoutBtn').addEventListener('click', ()=>{
  Auth.disconnect();
  document.getElementById('accountMenu').classList.remove('open');
  showToast('تم تسجيل الخروج من هذا الجهاز');
});
document.addEventListener('click', (e)=>{
  const menu = document.getElementById('accountMenu');
  if(!menu.classList.contains('open')) return;
  if(!e.target.closest('.google-area')) menu.classList.remove('open');
});

/* ---- status dot: 🟢 synced  🟡 saving/syncing  🔴 error  ⚪ offline/idle ---- */
function renderStatusDot(){
  const dot = document.getElementById('statusDot');
  const s = Sync.getStatus();
  dot.className = 'status-dot';
  const map = { synced:'st-green', saving:'st-yellow', syncing:'st-yellow', error:'st-red', conflict:'st-red', offline:'st-gray', idle:'st-gray' };
  dot.classList.add(map[s.state] || 'st-gray');
}
function renderSyncPanel(){
  const panel = document.getElementById('syncPanelBody');
  if(!document.getElementById('syncOverlay').classList.contains('open')) return;
  const s = Sync.getStatus();
  const a = Auth.getAuthState();
  const fmt = (iso)=> iso ? new Date(iso).toLocaleString('ar-SA') : '—';
  const stateLabel = { synced:'✅ تمت المزامنة', saving:'💾 جاري الحفظ محليًا', syncing:'🔄 جاري الرفع إلى Drive',
    error:'⚠️ فشلت المزامنة', conflict:'⚠️ تعارض بين جهازين', offline:'📡 غير متصل بالإنترنت (يعمل محليًا)', idle:'⏸️ لا يوجد اتصال بجوجل (يعمل محليًا فقط)' };
  panel.innerHTML = `
    <div class="log-strip" style="flex-direction:column; align-items:stretch; gap:10px;">
      <div>الحالة: <b>${stateLabel[s.state] || s.state}</b></div>
      <div>حساب جوجل: <b>${esc((a.account && a.account.email) || 'غير متصل')}</b></div>
      <div>آخر مزامنة ناجحة مع Drive: <b>${fmt(s.lastSync)}</b></div>
      <div>آخر حفظ محلي: <b>${fmt(s.lastSave)}</b></div>
      ${s.lastError ? `<div>آخر خطأ: <b style="color:var(--red);">${esc(s.lastError)}</b></div>` : ''}
    </div>
    <button class="btn btn-ghost" id="forceSyncBtn" style="margin-top:14px; width:100%; justify-content:center;">🔄 إعادة المزامنة الآن</button>
  `;
  const btn = document.getElementById('forceSyncBtn');
  if(btn) btn.addEventListener('click', async ()=>{ showToast('جاري المزامنة…'); await Sync.checkAndSync(); showToast('تمت المحاولة'); });
}
document.getElementById('statusDotBtn').addEventListener('click', ()=>{
  document.getElementById('syncOverlay').classList.add('open');
  renderSyncPanel();
});
document.getElementById('useRemoteBtn').addEventListener('click', async ()=>{
  try{ await Sync.resolveConflictUseRemote(); showToast('تم استخدام نسخة Drive'); }
  catch(e){ showToast('فشل حل التعارض: ' + e.message); }
  closeOverlay('conflictOverlay');
});
document.getElementById('useLocalBtn').addEventListener('click', async ()=>{
  try{ await Sync.resolveConflictUseLocal(); showToast('تم رفع نسختك المحلية'); }
  catch(e){ showToast('فشل حل التعارض: ' + e.message); }
  closeOverlay('conflictOverlay');
});

Auth.onAuthChange(()=>{ updateGoogleBtn(); });Sync.onStatusChange((s)=>{
  renderStatusDot();
  renderSyncPanel();
  if(s.state === 'conflict') document.getElementById('conflictOverlay').classList.add('open');
});
Sync.configure({
  applyRemoteCases: (remoteCases)=>{ cases = remoteCases || []; renderAll(); }
});

/* =================== Seed sample data (first run only) =================== */
function seedIfEmpty(){
  if(cases.length) return;
  const ty = todayHijri();
  const mk = (offsetDays, num, pl, def, type, statusIdx, reasonsOn)=>{
    const base = hijriToJSDate(ty.y, ty.m, ty.d);
    base.setDate(base.getDate()+offsetDays);
    const h = gregorianToHijri(base.getFullYear(), base.getMonth()+1, base.getDate());
    const now = new Date().toISOString();
    const reasons = Object.fromEntries(REASONS.map(r=>[r.k,false]));
    reasonsOn.forEach(k=>reasons[k]=true);
    return {
      id:uid(), number:num, plaintiff:pl, defendant:def, type, session:h, sessionTime:'09:00',
      reasons, status: STATUSES[statusIdx].k,
      details: Object.fromEntries(DETAIL_CARDS.map(d=>[d.k,''])),
      reminder:{enabled:false, preset:null, calendarEventId:null, taskId:null},
      log:{createdAt:now, lastOpened:now, lastModified:now}
    };
  };
  cases = [
    mk(1, '٤٤٦٧٨٩', 'شركة الوفاء التجارية', 'مؤسسة النخبة للمقاولات', 'مالية', 1, ['study_lawsuit','review_docs']),
    mk(3, '٤٤٥٥١٢', 'عبدالله المطيري', 'تركي العتيبي', 'مرورية', 0, []),
    mk(6, '٤٤٧٠٠١', 'نورة الشهري', 'شركة الإسكان الحديث', 'عقارية', 2, ['review_evidence','review_expert','waiting_expert']),
    mk(14, 'أحوال ١٢٣', 'سارة القحطاني', '—', 'أحوال شخصية', 0, []),
  ];
  persistCases();
}

/* =================== Init ====================
   الواجهة تُعرض فورًا من النسخة المحلية دون انتظار جوجل إطلاقًا،
   ثم تجري استعادة الجلسة والمزامنة في الخلفية. */
function init(){
  populateHijriSelectors();
  const savedTheme = (()=>{ try{ return localStorage.getItem('ct_theme'); }catch(e){ return null; } })() || 'light';
  document.documentElement.setAttribute('data-theme', savedTheme);

  loadCases();
  seedIfEmpty();
  renderAll();
  updateGoogleBtn();
  renderStatusDot();
  if(!Auth.isConfigured()){
    document.getElementById('googleConnectBtn').title = 'أضف Client ID الخاص بك داخل google-auth.js لتفعيل هذه الميزة';
  }

  // خلفية: تهيئة مكتبة جوجل + استعادة صامتة + مزامنة، لا شيء منها يحجب عرض الواجهة
  (async ()=>{
    await Auth.initAuth();
    const restored = await Auth.silentRestore();
    updateGoogleBtn();
    if(restored){
      await Sync.checkAndSync();
    }
  })();
}
/* =================== TEMP DEBUG PANEL — remove after multi-device verification ===================
   Enable in a real browser: localStorage.setItem('ct_debug','1') then reload the page. */
function initDebugPanel(){
  let debugOn = false;
  try{ debugOn = localStorage.getItem('ct_debug') === '1'; }catch(e){}
  if(!debugOn) return;
  const panel = document.getElementById('debugPanel');
  panel.style.display = 'block';
  function render(){
    const log = window.__authDebugLog || [];
    const authState = Auth.getAuthState();
    const syncState = Sync.getStatus();
    const lines = log.slice(-25).map(e => {
      const t = e.t.split('T')[1].split('.')[0];
      const rest = Object.keys(e).filter(k=>k!=='t'&&k!=='event').map(k=>`${k}=${e[k]}`).join(' ');
      return `${t}  ${e.event}  ${rest}`;
    }).join('\n');
    panel.textContent =
      `[هذا الجهاز] connected=${authState.connected}  account=${(authState.account&&authState.account.email)||'-'}\n` +
      `[المزامنة]   state=${syncState.state}  lastSync=${syncState.lastSync||'-'}  lastError=${syncState.lastError||'-'}\n` +
      `----------------------------------------------------------------\n` + lines;
  }
  render();
  setInterval(render, 2000);
}
initDebugPanel();
/* =================== END TEMP DEBUG PANEL =================== */

window.addEventListener('focus', ()=>{
  Auth.refreshIfStale().finally(()=>{ if(Auth.getAuthState().connected) Sync.checkAndSync(); });
});
init();
