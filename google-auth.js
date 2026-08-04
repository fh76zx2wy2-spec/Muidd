/*
  google-auth.js
  -----------------------------------------------------------------------
  مسؤول فقط عن هوية المستخدم مع جوجل: تسجيل الدخول، تجديد التوكن الصامت،
  تسجيل الخروج، وبيانات الحساب. لا يعرف شيئًا عن Drive أو Calendar أو Tasks.

  حد تقني مهم: هذا تطبيق Frontend بالكامل بدون Client Secret، لذلك لا يوجد
  Refresh Token حقيقي (ذلك يتطلب خادمًا). البديل هنا هو تجديد صامت متكرر
  (Silent Token Refresh) كل ~50 دقيقة طالما التبويب مفتوح، ومحاولة استعادة
  صامتة عند كل فتح للموقع طالما المتصفح لا يزال يحمل جلسة Google نشطة.
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

let tokenClient = null;
let accessToken = null;
let tokenExpiry = 0;      // epoch ms
let account = null;       // { email, name, picture }
let refreshTimer = null;
let readyPromise = null;

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
  localStorage.setItem(LS_CONNECTED, "1");
  scheduleRefresh();
  emit();
}

function scheduleRefresh(){
  clearTimeout(refreshTimer);
  const delay = Math.max(30000, (tokenExpiry - Date.now()) - 2 * 60 * 1000);
  refreshTimer = setTimeout(() => { requestToken(false).catch(() => {}); }, delay);
}

function requestToken(interactive){
  return new Promise((resolve, reject) => {
    if(!tokenClient){ reject(new Error("مكتبة جوجل غير جاهزة بعد")); return; }
    tokenClient.callback = (resp) => {
      if(resp && resp.error){ reject(new Error(resp.error_description || resp.error)); return; }
      applyTokenResponse(resp);
      resolve(accessToken);
    };
    try{
      tokenClient.requestAccessToken({ prompt: interactive ? "consent" : "" });
    }catch(e){ reject(e); }
  });
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
  await requestToken(true);
  await loadAccountInfo();
}

/** Called on every page load. Resolves true/false, never throws, never shows UI. */
export async function silentRestore(){
  await initAuth();
  if(localStorage.getItem(LS_CONNECTED) !== "1") return false;
  try{
    await requestToken(false);
    await loadAccountInfo();
    return true;
  }catch(e){
    return false;
  }
}

/** Returns a valid access token, silently refreshing if needed. Throws if the session can't be renewed. */
export async function getValidToken(){
  if(accessToken && Date.now() < tokenExpiry - 60000) return accessToken;
  try{
    return await requestToken(false);
  }catch(e){
    accessToken = null;
    emit();
    throw e;
  }
}

/** Explicit sign-out: revokes the token and forgets the device, per the user's request. */
export function disconnect(){
  clearTimeout(refreshTimer);
  if(accessToken && window.google && google.accounts && google.accounts.oauth2){
    try{ google.accounts.oauth2.revoke(accessToken, () => {}); }catch(e){}
  }
  accessToken = null;
  tokenExpiry = 0;
  account = null;
  localStorage.removeItem(LS_CONNECTED);
  localStorage.removeItem(LS_ACCOUNT);
  emit();
}
