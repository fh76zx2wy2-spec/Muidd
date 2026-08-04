/*
  google-drive.js
  -----------------------------------------------------------------------
  مسؤول فقط عن ملف بيانات واحد في Drive: البحث عنه، إنشاؤه مرة واحدة،
  قراءته وتحديثه. لا يعرف شيئًا عن تسجيل الدخول (يستدعي google-auth.js
  فقط للحصول على توكن صالح) ولا عن منطق التعارض (ذلك من مهمة sync-manager.js).
*/
import { getValidToken } from "./google-auth.js";

const DRIVE_FILENAME = "case-tracker-data.json";
const LS_FILE_ID = "ct_drive_file_id";

let fileId = localStorage.getItem(LS_FILE_ID) || null;

export function getFileId(){ return fileId; }

async function driveFetch(url, options = {}){
  const token = await getValidToken();
  const headers = Object.assign({}, options.headers, { Authorization: "Bearer " + token });
  let res;
  try{
    res = await fetch(url, Object.assign({}, options, { headers }));
  }catch(networkErr){
    const err = new Error("تعذّر الاتصال بالشبكة: " + networkErr.message);
    err.network = true;
    throw err;
  }
  if(!res.ok){
    let body = null;
    try{ body = await res.json(); }catch(e){}
    const msg = (body && body.error && (body.error.message || JSON.stringify(body.error))) || (res.status + " " + res.statusText);
    console.error("[Google Drive]", res.status, url, body);
    const err = new Error(msg);
    err.status = res.status;
    throw err;
  }
  const ct = res.headers.get("content-type") || "";
  return ct.includes("application/json") ? res.json() : res.text();
}

function multipartBody(boundary, metadata, payload){
  return `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n` +
         `--${boundary}\r\nContent-Type: application/json\r\n\r\n${JSON.stringify(payload)}\r\n--${boundary}--`;
}

async function findExistingFile(){
  const q = encodeURIComponent(`name='${DRIVE_FILENAME}' and trashed=false`);
  const data = await driveFetch(`https://www.googleapis.com/drive/v3/files?q=${q}&fields=files(id,modifiedTime)&spaces=drive`);
  return (data.files && data.files.length) ? data.files[0] : null;
}

async function createFile(initialPayload){
  const boundary = "case_tracker_boundary";
  const body = multipartBody(boundary, { name: DRIVE_FILENAME, mimeType: "application/json" }, initialPayload);
  return driveFetch(`https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,modifiedTime`, {
    method: "POST",
    headers: { "Content-Type": `multipart/related; boundary=${boundary}` },
    body,
  });
}

/** Finds the app's data file, or creates it exactly once if it doesn't exist yet. */
export async function ensureFile(initialPayloadIfCreating){
  if(fileId){
    try{
      await driveFetch(`https://www.googleapis.com/drive/v3/files/${fileId}?fields=id`);
      return fileId;
    }catch(e){
      if(e.status === 404){ fileId = null; localStorage.removeItem(LS_FILE_ID); }
      else throw e; // network/auth error — don't discard a possibly-valid id
    }
  }
  if(!fileId){
    const found = await findExistingFile();
    if(found){
      fileId = found.id;
      localStorage.setItem(LS_FILE_ID, fileId);
      return fileId;
    }
    const created = await createFile(initialPayloadIfCreating || { updatedAt: new Date().toISOString(), cases: [] });
    fileId = created.id;
    localStorage.setItem(LS_FILE_ID, fileId);
  }
  return fileId;
}

export async function getMeta(){
  if(!fileId) return null;
  return driveFetch(`https://www.googleapis.com/drive/v3/files/${fileId}?fields=modifiedTime,size`);
}

export async function pull(){
  if(!fileId) return null;
  return driveFetch(`https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`);
}

export async function push(payload){
  await ensureFile(payload);
  const boundary = "case_tracker_boundary";
  const body = multipartBody(boundary, { name: DRIVE_FILENAME, mimeType: "application/json" }, payload);
  return driveFetch(`https://www.googleapis.com/upload/drive/v3/files/${fileId}?uploadType=multipart&fields=id,modifiedTime`, {
    method: "PATCH",
    headers: { "Content-Type": `multipart/related; boundary=${boundary}` },
    body,
  });
}
