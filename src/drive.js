import { GoogleAuthProvider, signInWithPopup } from 'firebase/auth';
import { auth } from './firebase';

const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.file';
const BACKUP_NAME = 'el-pachax-backup.json';
const OWNER_EMAIL = 'huthelias39@gmail.com';
let cachedToken = null;
let cachedTokenAt = 0;

async function getDriveAccessToken() {
  // Reuse the OAuth token during the current session to avoid a Google popup on every auto-backup.
  if (cachedToken && Date.now() - cachedTokenAt < 45 * 60 * 1000) return cachedToken;
  const provider = new GoogleAuthProvider();
  provider.addScope(DRIVE_SCOPE);
  const result = await signInWithPopup(auth, provider);
  if (result.user.email?.toLowerCase() !== OWNER_EMAIL) throw new Error('غير مسموح بهذا الحساب');
  const credential = GoogleAuthProvider.credentialFromResult(result);
  const token = credential?.accessToken;
  if (!token) throw new Error('لم يتم الحصول على صلاحية Google Drive');
  cachedToken = token;
  cachedTokenAt = Date.now();
  return token;
}

export async function uploadBackupToDrive(people) {
  const token = await getDriveAccessToken();
  const q = encodeURIComponent(`name='${BACKUP_NAME}' and trashed=false`);
  const list = await fetch(`https://www.googleapis.com/drive/v3/files?q=${q}&spaces=drive&fields=files(id,name)`, { headers: { Authorization: `Bearer ${token}` } });
  if (!list.ok) throw new Error('تعذر الوصول إلى Google Drive');
  const existing = (await list.json()).files?.[0];
  const body = JSON.stringify({ app: 'El Pachax', version: 1, exportedAt: new Date().toISOString(), people }, null, 2);
  if (existing?.id) {
    const response = await fetch(`https://www.googleapis.com/upload/drive/v3/files/${existing.id}?uploadType=media`, { method: 'PATCH', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body });
    if (!response.ok) throw new Error('فشل تحديث النسخة الاحتياطية');
    return response.json();
  }
  const metadata = { name: BACKUP_NAME, mimeType: 'application/json' };
  const form = new FormData();
  form.append('metadata', new Blob([JSON.stringify(metadata)], { type: 'application/json' }));
  form.append('file', new Blob([body], { type: 'application/json' }));
  const response = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name', { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: form });
  if (!response.ok) throw new Error('فشل إنشاء النسخة الاحتياطية');
  return response.json();
}
