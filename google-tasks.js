/*
  google-tasks.js
  -----------------------------------------------------------------------
  إنشاء/تحديث/حذف مهام في قائمة المهام الافتراضية، باستخدام التوكن الممنوح مسبقًا.
  ملاحظة: هذه المهام تظهر في تذكيرات آيفون إذا ربط المستخدم حساب Google
  من إعدادات الآيفون (Settings > Calendar/Reminders > Accounts).
*/
import { getValidToken } from "./google-auth.js";

async function taskFetch(url, options = {}){
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

export async function upsertTask(existingTaskId, task){
  const url = existingTaskId
    ? `https://www.googleapis.com/tasks/v1/lists/@default/tasks/${existingTaskId}`
    : `https://www.googleapis.com/tasks/v1/lists/@default/tasks`;
  return taskFetch(url, {
    method: existingTaskId ? "PATCH" : "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(task),
  });
}

export async function deleteTask(taskId){
  if(!taskId) return;
  try{
    await taskFetch(`https://www.googleapis.com/tasks/v1/lists/@default/tasks/${taskId}`, { method: "DELETE" });
  }catch(e){ /* already gone is fine */ }
}
