/*
  google-calendar.js
  -----------------------------------------------------------------------
  إنشاء/تحديث/حذف أحداث في التقويم الأساسي، باستخدام التوكن الممنوح مسبقًا.
  لا يطلب تسجيل دخول أو موافقة جديدة أبدًا — فقط يستخدم getValidToken().
*/
import { getValidToken } from "./google-auth.js";

async function calFetch(url, options = {}){
  const token = await getValidToken();
  const headers = Object.assign({}, options.headers, { Authorization: "Bearer " + token });
  const res = await fetch(url, Object.assign({}, options, { headers }));
  if(!res.ok){
    let body = null;
    try{ body = await res.json(); }catch(e){}
    const msg = (body && body.error && body.error.message) || (res.status + " " + res.statusText);
    throw new Error(msg);
  }
  if(res.status === 204) return null;
  return res.json();
}

/** Creates a new event, or updates it in place if existingEventId is given. */
export async function upsertEvent(existingEventId, event){
  const url = existingEventId
    ? `https://www.googleapis.com/calendar/v3/calendars/primary/events/${existingEventId}`
    : `https://www.googleapis.com/calendar/v3/calendars/primary/events`;
  return calFetch(url, {
    method: existingEventId ? "PATCH" : "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(event),
  });
}

export async function deleteEvent(eventId){
  if(!eventId) return;
  try{
    await calFetch(`https://www.googleapis.com/calendar/v3/calendars/primary/events/${eventId}`, { method: "DELETE" });
  }catch(e){ /* already gone is fine */ }
}
