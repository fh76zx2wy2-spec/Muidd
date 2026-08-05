/*
  sync-manager.js
  -----------------------------------------------------------------------
  ينسّق بين البيانات المحلية و Google Drive على طريقة Notion/iCloud:
  كل تعديل يُحفظ محليًا فورًا (لا ننتظر الشبكة أبدًا)، ثم يُرفع في الخلفية
  بعد تهدئة قصيرة (debounce). إذا فشل الرفع أو انقطع الإنترنت، يبقى التعديل
  محفوظًا محليًا ويُعاد رفعه تلقائيًا لاحقًا — لا يُفقد شيء أبدًا.

  الحالات: idle | offline | saving | syncing | synced | error | conflict
*/
import * as Auth from "./google-auth.js";
import * as Drive from "./google-drive.js";

const LS_DATA = "ct_data";          // { updatedAt, cases }
const LS_SYNCED_AT = "ct_synced_at"; // Drive's modifiedTime as of the last successful sync

let status = { state: "idle", lastError: null, lastSync: null, lastSave: null };
const listeners = new Set();
function setStatus(partial){
  Object.assign(status, partial);
  listeners.forEach(fn => { try{ fn(status); }catch(e){ console.error(e); } });
}
export function onStatusChange(fn){ listeners.add(fn); fn(status); return () => listeners.delete(fn); }
export function getStatus(){ return status; }

let hooks = { applyRemoteCases: null }; // set via configure()
export function configure({ applyRemoteCases }){ hooks.applyRemoteCases = applyRemoteCases; }

/* ---- local persistence (works on any domain, instant, no network) ---- */
export function loadLocal(){
  try{
    const raw = localStorage.getItem(LS_DATA);
    if(raw) return JSON.parse(raw);
  }catch(e){}
  return { updatedAt: new Date().toISOString(), cases: [] };
}
function saveLocal(wrapper){
  try{
    localStorage.setItem(LS_DATA, JSON.stringify(wrapper));
    return true;
  }catch(e){
    setStatus({ state: "error", lastError: "تعذّر الحفظ محليًا: " + e.message });
    return false;
  }
}

/** Call this any time the case list changes. Saves instantly, syncs in the background. */
export function saveCases(cases){
  const wrapper = { updatedAt: new Date().toISOString(), cases };
  const ok = saveLocal(wrapper);
  if(ok) setStatus({ state: navigator.onLine ? "saving" : "offline", lastSave: wrapper.updatedAt, lastError: status.lastError && navigator.onLine ? null : status.lastError });
  queuePush();
  return ok;
}

/* ---- background push, debounced + serialized + retried ---- */
let pushTimer = null;
let pushInFlight = false;
let pushAgainAfter = false;

/**
 * SECURITY / ISOLATION GUARANTEE
 * The Drive file must only ever contain case data — never tokens, account info,
 * or device/session identifiers. This allowlist is enforced here (not just by
 * convention) so a future change elsewhere in the codebase can't accidentally
 * leak session data into the shared file that every device reads.
 */
function toDrivePayload(wrapper){
  return { updatedAt: wrapper.updatedAt, cases: Array.isArray(wrapper.cases) ? wrapper.cases : [] };
}

function queuePush(delay = 900){
  clearTimeout(pushTimer);
  pushTimer = setTimeout(() => { doPush(); }, delay);
}

async function doPush(){
  if(!navigator.onLine){ setStatus({ state: "offline" }); return; }
  if(!Auth.getAuthState().connected){ setStatus({ state: "idle" }); return; } // local-only mode
  if(pushInFlight){ pushAgainAfter = true; return; }
  pushInFlight = true;
  setStatus({ state: "syncing" });
  try{
    const wrapper = toDrivePayload(loadLocal());
    const result = await Drive.push(wrapper);
    localStorage.setItem(LS_SYNCED_AT, result.modifiedTime || new Date().toISOString());
    setStatus({ state: "synced", lastSync: new Date().toISOString(), lastError: null });
  }catch(e){
    setStatus({ state: "error", lastError: e.message });
  }finally{
    pushInFlight = false;
    if(pushAgainAfter){ pushAgainAfter = false; queuePush(300); }
  }
}

/* ---- pull / conflict detection — call on connect and when returning to the tab ---- */
export async function checkAndSync(){
  if(!Auth.getAuthState().connected) return { conflict: false };
  try{
    const local = loadLocal();
    await Drive.ensureFile(toDrivePayload(local));
    const meta = await Drive.getMeta();
    const syncedAt = localStorage.getItem(LS_SYNCED_AT);

    // FIRST-EVER SYNC ON THIS DEVICE: there is no baseline to compare against, so this is
    // never a real conflict — it's a normal "new device joins" event. Merge instead of
    // overwriting either side: take Drive's cases, and keep any purely-local cases (e.g.
    // demo/seed data created before this device ever connected) that Drive doesn't have yet.
    if(!syncedAt){
      const remote = await Drive.pull();
      const remoteCases = (remote && Array.isArray(remote.cases)) ? remote.cases : [];
      const remoteIds = new Set(remoteCases.map(c => c.id));
      const localOnly = (local.cases || []).filter(c => !remoteIds.has(c.id));
      const mergedCases = [...remoteCases, ...localOnly];
      const wrapper = { updatedAt: new Date().toISOString(), cases: mergedCases };
      saveLocal(wrapper);
      hooks.applyRemoteCases && hooks.applyRemoteCases(wrapper.cases);
      if(localOnly.length){
        await doPush(); // push the merged set back so Drive now has everything too
      } else {
        localStorage.setItem(LS_SYNCED_AT, meta.modifiedTime);
      }
      setStatus({ state: "synced", lastSync: new Date().toISOString(), lastError: null });
      return { conflict: false, merged: true, mergedInLocalOnly: localOnly.length };
    }

    const remoteChanged = new Date(meta.modifiedTime) > new Date(syncedAt);
    const localDirty = new Date(local.updatedAt) > new Date(syncedAt);

    if(remoteChanged && localDirty){
      setStatus({ state: "conflict" });
      return { conflict: true, remoteModifiedTime: meta.modifiedTime };
    }
    if(remoteChanged && !localDirty){
      const remote = await Drive.pull();
      const wrapper = (remote && Array.isArray(remote.cases)) ? remote : { updatedAt: new Date().toISOString(), cases: [] };
      saveLocal(wrapper);
      hooks.applyRemoteCases && hooks.applyRemoteCases(wrapper.cases);
      localStorage.setItem(LS_SYNCED_AT, meta.modifiedTime);
      setStatus({ state: "synced", lastSync: new Date().toISOString(), lastError: null });
      return { conflict: false, pulled: true };
    }
    if(!remoteChanged && localDirty){
      await doPush();
      return { conflict: false, pushed: true };
    }
    setStatus({ state: "synced", lastSync: new Date().toISOString() });
    return { conflict: false };
  }catch(e){
    setStatus({ state: "error", lastError: e.message });
    return { conflict: false, error: e };
  }
}

export async function resolveConflictUseRemote(){
  const remote = await Drive.pull();
  const wrapper = (remote && Array.isArray(remote.cases)) ? remote : { updatedAt: new Date().toISOString(), cases: [] };
  saveLocal(wrapper);
  hooks.applyRemoteCases && hooks.applyRemoteCases(wrapper.cases);
  const meta = await Drive.getMeta();
  localStorage.setItem(LS_SYNCED_AT, meta.modifiedTime);
  setStatus({ state: "synced", lastSync: new Date().toISOString(), lastError: null });
}
export async function resolveConflictUseLocal(){
  await doPush();
}

/* ---- connectivity ---- */
window.addEventListener("online", () => { setStatus({ state: "idle" }); doPush(); checkAndSync(); });
window.addEventListener("offline", () => setStatus({ state: "offline" }));
