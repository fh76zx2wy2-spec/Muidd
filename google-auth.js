/*
  google-auth.js
  -----------------------------------------------------------------------
  مسؤول فقط عن هوية المستخدم مع جوجل: تسجيل الدخول، تجديد التوكن الصامت،
  تسجيل الخروج، وبيانات الحساب. لا يعرف شيئًا عن Drive أو Calendar أو Tasks.

  حد تقني مهم: هذا تطبيق Frontend بالكامل بدون Client Secret، لذلك لا يوجد
  Refresh Token حقيقي (ذلك يتطلب خادمًا). البديل هنا هو تجديد صامت متكرر
  (Silent Token Refresh) كل ~50 دقيقة طالما التبويب مفتوح، ومحاولة استعادة
  صامتة عند كل فتح للموقع طالما المتصفح لا يزال يحمل جلسة Google نشطة.

  ضمان عزل الأجهزة: كل ما في هذا الملف (accessToken, tokenExpiry, account,
  وحتى مفاتيح localStorage أدناه) يعيش فقط داخل متصفح هذا الجهاز تحديدًا.
  لا شيء هنا يُكتب إلى Google Drive أو أي مكان مشترك بين الأجهزة، وبالتالي
  تسجيل الدخول من جهاز آخر لا يمكنه فنيًا التأثير على جلسة هذا الجهاز إطلاقًا.
*/

export const GOOGLE_CLIENT_ID = "148453343314-t3kfbqreqp8hna0uh2n90q9pk66vfu9l.apps.googleusercontent.com";

export const GOOGLE_SCOPES = [
  "https://www.googleapis.com/auth/drive.file",
  "https://www.googleapis.com/auth/calendar.events",
  "https://www.googleapis.com/auth/tasks",
  "https://www.googleapis.com/auth/userinfo.email",
  "https://www.googleapis.com/auth/userinfo.profile",
].join(" ");

const LS_CONNECTED = "ct_google_connected";
const LS_ACCOUNT = "ct_google_account";

// ===== TEMP DEBUG LOG — remove this whole block once multi-device sync is verified =====
// Enable in a real browser by running: localStorage.setItem('ct_debug','1') then reload.
// Inspect anytime via: window.__authDebugLog
const DEBUG = (() => { try{ return localStorage.getItem('ct_debug') === '1'; }catch(e){ return false; } })();
const debugLog = [];
if(typeof window !== "undefined") window.__authDebugLog = debugLog;
function dbg(event, data){
  const entry = { t: new Date().toISOString(), event, ...data };
  debugLog.push(entry);
  if(DEBUG) console.log(`[AUTH ${entry.t}] ${event}`, data || '');
}
// ===== END TEMP DEBUG LOG HEADER =====

let tokenClient = null;
let accessToken = null;
let tokenExpiry = 0;      // epoch ms
let account = null;       // { email, name, picture }
let refreshTimer = null;
let readyPromise = null;
let inFlightRequest = null; // guards against two concurrent requestToken() calls racing each other
let retryCount = 0;
const REFRESH_MARGIN_MS = 2 * 60 * 1000;   // refresh this long before real expiry
const RETRY_DELAYS_MS = [15000, 30000, 60000, 120000, 300000]; // backoff if a silent attempt fails

const listeners = new Set();
function emit(){ const s = getAuthState(); listeners.forEach(fn => { try{ fn(s); }catch(e){ console.error(e); } }); }

export function onAuthChange(fn){ listeners.add(fn); return () => listeners.delete(fn); }

export function isConfigured(){ return !GOOGLE_CLIENT_ID.includes("PUT_YOUR_GOOGLE_CLIENT_ID"); }

export function getAuthState(){
  return {
    connected: !!accessToken && Date.now() < tokenExpiry,
    account,
    hasEverConnected: localStorage.getItem(LS_CONNECTED) === "1",
  };
}

/** Loads the GIS library's token client. Safe to call once at startup. */
export function initAuth(){
  if(readyPromise) return readyPromise;
  readyPromise = new Promise((resolve) => {
    if(!isConfigured()){ resolve(false); return; }
    const cached = localStorage.getItem(LS_ACCOUNT);
    if(cached){ try{ account = JSON.parse(cached); }catch(e){} }
    (function waitForGis(){
      if(window.google && google.accounts && google.accounts.oauth2){
        tokenClient = google.accounts.oauth2.initTokenClient({
          client_id: GOOGLE_CLIENT_ID,
          scope: GOOGLE_SCOPES,
          callback: () => {}, // overridden per-request below
        });
        resolve(true);
      } else {
        setTimeout(waitForGis, 150);
      }
    })();
  });
  return readyPromise;
}

function applyTokenResponse(resp){
  accessToken = resp.access_token;
  tokenExpiry = Date.now() + Number(resp.expires_in || 3300) * 1000;
  retryCount = 0;
  localStorage.setItem(LS_CONNECTED, "1");
  dbg('token_issued', { expiresInSec: Number(resp.expires_in||3300), expiresAt: new Date(tokenExpiry).toISOString() });
  scheduleRefresh(tokenExpiry - Date.now() - REFRESH_MARGIN_MS);
  emit();
}

/**
 * Proactively refreshes the token in the background before it actually expires.
 * On failure this does NOT clear the current token or emit a "disconnected" state —
 * the existing token is still valid for a while yet, so we just retry sooner
 * (with backoff) instead of giving up. This is what closes the real gap: previously
 * a single failed background attempt meant no retry for ~50 minutes, so an idle tab
 * would sit there with a token that quietly expired, only surfacing as "logged out"
 * later when the user returned to it — easy to misread as caused by something else
 * (like signing in on another device) when it was really just this tab's own timer.
 */
function scheduleRefresh(delayMs){
  clearTimeout(refreshTimer);
  const delay = Math.max(10000, delayMs);
  dbg('refresh_scheduled', { inSec: Math.round(delay/1000), attempt: retryCount });
  refreshTimer = setTimeout(async () => {
    dbg('refresh_attempt_start', { attempt: retryCount, wasSilent: true });
    try{
      await requestToken(false);
      dbg('refresh_attempt_success', {});
      // success: applyTokenResponse() already rescheduled the next full-interval refresh
    }catch(e){
      const backoff = RETRY_DELAYS_MS[Math.min(retryCount, RETRY_DELAYS_MS.length - 1)];
      dbg('refresh_attempt_failed', { reason: e.message, nextRetryInSec: Math.round(backoff/1000) });
      retryCount++;
      scheduleRefresh(backoff); // keep retrying quietly; token (if still valid) is untouched
    }
  }, delay);
}

/** Concurrency-safe: if a request is already in flight, every caller shares that same promise
 *  instead of each overwriting tokenClient.callback and racing one another (which could leave
 *  an earlier caller's promise hanging forever). */
function requestToken(interactive){
  if(inFlightRequest) return inFlightRequest;
  inFlightRequest = new Promise((resolve, reject) => {
    if(!tokenClient){ reject(new Error("مكتبة جوجل غير جاهزة بعد")); return; }
    tokenClient.callback = (resp) => {
      if(resp && resp.error){ reject(new Error(resp.error_description || resp.error)); return; }
      applyTokenResponse(resp);
      resolve(accessToken);
    };
    try{
      tokenClient.requestAccessToken({ prompt: interactive ? "consent" : "" });
    }catch(e){ reject(e); }
  }).finally(() => { inFlightRequest = null; });
  return inFlightRequest;
}

async function loadAccountInfo(){
  try{
    const res = await fetch("https://www.googleapis.com/oauth2/v3/userinfo", {
      headers: { Authorization: "Bearer " + accessToken },
    });
    if(!res.ok) return;
    const info = await res.json();
    account = { email: info.email || "", name: info.name || "", picture: info.picture || "" };
    localStorage.setItem(LS_ACCOUNT, JSON.stringify(account));
    emit();
  }catch(e){ /* non-fatal: identity display only */ }
}

/** Explicit, user-initiated sign-in (shows Google's consent screen the first time only). */
export async function connect(){
  await initAuth();
  dbg('connect_start', {});
  await requestToken(true);
  await loadAccountInfo();
  dbg('connect_success', { account: account && account.email });
}

/** Called on every page load. Resolves true/false, never throws, never shows UI. */
export async function silentRestore(){
  await initAuth();
  if(localStorage.getItem(LS_CONNECTED) !== "1"){ dbg('silent_restore_skipped', { reason: 'never_connected_on_this_device' }); return false; }
  dbg('silent_restore_start', {});
  try{
    await requestToken(false);
    await loadAccountInfo();
    dbg('silent_restore_success', {});
    return true;
  }catch(e){
    dbg('silent_restore_failed', { reason: e.message });
    return false;
  }
}

/**
 * Called whenever the tab regains focus/visibility. If we believe we should be
 * connected but the token is stale or close to expiry, refresh it proactively
 * right away — so by the time the user actually does anything, it's already fresh.
 * Failures here are silent and non-destructive (same reasoning as scheduleRefresh).
 */
export async function refreshIfStale(){
  if(localStorage.getItem(LS_CONNECTED) !== "1") return;
  if(accessToken && Date.now() < tokenExpiry - REFRESH_MARGIN_MS) return; // still comfortably fresh
  try{ await requestToken(false); if(!account) await loadAccountInfo(); }
  catch(e){ /* leave state as-is; scheduleRefresh's own backoff loop keeps trying */ }
}

/** Returns a valid access token, silently refreshing if needed. Throws only after a genuine retry fails. */
export async function getValidToken(){
  if(accessToken && Date.now() < tokenExpiry - 60000) return accessToken;
  try{
    return await requestToken(false);
  }catch(firstError){
    dbg('getValidToken_first_attempt_failed', { reason: firstError.message });
    // one immediate retry — covers transient blips (flaky network, momentary iframe hiccup)
    // before we conclude the session genuinely needs the user to reconnect
    try{
      return await requestToken(false);
    }catch(e){
      dbg('session_dropped', { reason: e.message, at: 'getValidToken', tokenExpiryWas: new Date(tokenExpiry).toISOString() });
      accessToken = null;
      emit();
      throw e;
    }
  }
}

/** Explicit sign-out: revokes the token and forgets the device, per the user's request. */
export function disconnect(){
  dbg('disconnect_called', { reason: 'explicit_user_logout' });
  clearTimeout(refreshTimer);
  if(accessToken && window.google && google.accounts && google.accounts.oauth2){
    try{ google.accounts.oauth2.revoke(accessToken, () => {}); }catch(e){}
  }
  accessToken = null;
  tokenExpiry = 0;
  account = null;
  retryCount = 0;
  localStorage.removeItem(LS_CONNECTED);
  localStorage.removeItem(LS_ACCOUNT);
  emit();
}

// Proactively refresh the moment this tab becomes visible/focused again — this is what
// prevents an idle tab from sitting on a silently-expired token until the user acts on it.
if(typeof document !== "undefined"){
  document.addEventListener("visibilitychange", () => { if(document.visibilityState === "visible") refreshIfStale(); });
  window.addEventListener("focus", () => refreshIfStale());
}
