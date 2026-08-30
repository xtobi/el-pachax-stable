import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { onAuthStateChanged, signInWithPopup, signOut } from 'firebase/auth';
import {
  Plus,
  Search,
  UserRound,
  WalletCards,
  ArrowDownLeft,
  ArrowUpRight,
  FileText,
  Download,
  Upload,
  AlertTriangle,
  CheckCircle2,
  Cloud,
  HardDrive,
  Settings,
  LogIn,
  LogOut,
  X,
  Phone,
  Menu,
  Bell,
  MoreVertical,
  BookOpen,
  ArrowLeft,
  Trash2,
  Camera,
  ContactRound,
  Building2,
  Pencil,
  BellRing,
  FileSignature,
  Database
} from 'lucide-react';
import { auth, googleProvider } from './firebase';
import { saveLedger, subscribeToLedger, executeMigrationToFirestore, MIGRATION_VERSION } from './cloudSync';
import { uploadBackupToDrive, downloadBackupFromDrive } from './drive';
import { IMPORTED_DATABASE, IMPORTED_PEOPLE } from './importedData';
import { validateAndNormalizeBackup, createSafetyBackup } from './backupUtils';
import {
  validateImageFile,
  processProfileImage,
  uploadProfilePhotoToStorage,
  deleteProfilePhotoFromStorage
} from './photoUtils';
import './styles.css';
import './accountEdit.css';
import './reference-ui.css';

const ALLOWED_EMAILS = ['huthelias39@gmail.com', 'ow3nez@gmail.com'];
const today = () => new Date().toISOString().slice(0, 10);

const MONTHS_FR = [
  'janvier',
  'février',
  'mars',
  'avril',
  'mai',
  'juin',
  'juillet',
  'août',
  'septembre',
  'octobre',
  'نovembre',
  'décembre'
];
const DAYS_FR = ['dim.', 'lun.', 'mar.', 'mer.', 'jeu.', 'ven.', 'sam.'];

function parseDate(v) {
  if (!v) return null;
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v;
  if (typeof v === 'object' && v !== null && typeof v.toDate === 'function') {
    try {
      const d = v.toDate();
      return Number.isNaN(d.getTime()) ? null : d;
    } catch {
      return null;
    }
  }
  if (typeof v === 'object' && v !== null && Number.isFinite(Number(v.seconds))) {
    const d = new Date(Number(v.seconds) * 1000 + Math.floor(Number(v.nanoseconds || 0) / 1e6));
    return Number.isNaN(d.getTime()) ? null : d;
  }
  if (typeof v === 'number') {
    const d = new Date(v < 1e12 ? v * 1000 : v);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  const s = String(v).trim();
  let m = s.match(/^(\d{4})[-\/]([01]?\d)[-\/]([0-3]?\d)(?:[T\s](\d{1,2}):(\d{2})(?::(\d{2}))?)?/);
  if (m) {
    const d = new Date(+m[1], +m[2] - 1, +m[3], +(m[4] || 0), +(m[5] || 0), +(m[6] || 0));
    if (!Number.isNaN(d.getTime())) return d;
  }
  m = s.match(/^([0-3]?\d)[-\/]([01]?\d)[-\/](\d{4})(?:[T\s](\d{1,2}):(\d{2})(?::(\d{2}))?)?/);
  if (m) {
    const d = new Date(+m[3], +m[2] - 1, +m[1], +(m[4] || 0), +(m[5] || 0), +(m[6] || 0));
    if (!Number.isNaN(d.getTime())) return d;
  }
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
}

function hasTime(v) {
  if (typeof v === 'number') return true;
  if (v && typeof v === 'object' && Number.isFinite(Number(v.seconds))) return true;
  return /[T\s]\d{1,2}:\d{2}/.test(String(v || ''));
}

function formatHomeDate(v) {
  const d = parseDate(v);
  if (!d) return { top: '', year: '' };
  return {
    top: `${d.getDate()} ${MONTHS_FR[d.getMonth()] || ''}`,
    year: String(d.getFullYear())
  };
}

function formatTxDateText(v) {
  const d = parseDate(v);
  if (!d) return String(v || '');
  const top = `${DAYS_FR[d.getDay()]}, ${d.getDate()} ${MONTHS_FR[d.getMonth()] || ''}`;
  const year = String(d.getFullYear());
  if (!hasTime(v)) return `${top} ${year}`;
  let h = d.getHours();
  const ap = h >= 12 ? 'PM' : 'AM';
  h = h % 12 || 12;
  const min = String(d.getMinutes()).padStart(2, '0');
  return `${top} ${year} ${String(h).padStart(2, '0')}:${min} ${ap}`;
}

function formatAmountFr(n) {
  return Math.round(Number(n) || 0).toLocaleString('fr-FR').replace(/\u00a0/g, ' ');
}

function normalizeSearchText(text) {
  if (!text) return '';
  return String(text)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[\u064B-\u065F\u0670]/g, '')
    .replace(/[إأآ]/g, 'ا')
    .replace(/ى/g, 'ي')
    .replace(/ة/g, 'ه')
    .toLowerCase()
    .trim();
}

function balance(p) {
  return (p?.transactions || []).reduce(
    (s, t) => s + (t.type === 'credit' ? Number(t.amount) || 0 : -(Number(t.amount) || 0)),
    0
  );
}

function getLatestTransaction(person) {
  const tx = Array.isArray(person?.transactions) ? person.transactions : [];
  if (tx.length === 0) return null;
  return tx.reduce((latest, t) => {
    const da = parseDate(t?.date)?.getTime() || 0;
    const db = parseDate(latest?.date)?.getTime() || 0;
    if (!latest || da > db || (da === db && Number(t?.id || 0) > Number(latest?.id || 0))) {
      return t;
    }
    return latest;
  }, null);
}

function loadInitialPeople() {
  try {
    const s = localStorage.getItem('el-pachax-people');
    if (s) {
      const parsed = JSON.parse(s);
      if (Array.isArray(parsed)) return parsed;
    }
  } catch {}
  return IMPORTED_PEOPLE;
}

function saveLocal(people) {
  try {
    localStorage.setItem('el-pachax-people', JSON.stringify(people));
  } catch {}
}

function exportLocal(people) {
  const backup = {
    app: 'El Pachax',
    version: 1,
    exportedAt: new Date().toISOString(),
    people
  };
  const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `el-pachax-backup-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

function formatLastBackup(isoString) {
  if (!isoString) return 'Dernière sauvegarde : Jamais';
  const d = parseDate(isoString);
  if (!d) return 'Dernière sauvegarde : Jamais';
  const pad = n => String(n).padStart(2, '0');
  const day = pad(d.getDate());
  const month = pad(d.getMonth() + 1);
  const year = d.getFullYear();
  const hours = pad(d.getHours());
  const minutes = pad(d.getMinutes());
  return `Dernière sauvegarde : ${day}/${month}/${year} à ${hours}:${minutes}`;
}

function ConfirmDeleteModal({ person, onConfirm, onCancel }) {
  if (!person) return null;
  return (
    <div className="overlay" style={{ zIndex: 99999 }} onClick={onCancel}>
      <div
        className="modal"
        style={{ maxWidth: '400px', direction: 'rtl', textAlign: 'right' }}
        onClick={e => e.stopPropagation()}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '10px',
            color: '#d32f2f',
            marginBottom: '12px'
          }}
        >
          <div
            style={{
              width: '38px',
              height: '38px',
              borderRadius: '50%',
              background: '#fee2e2',
              display: 'grid',
              placeItems: 'center',
              flexShrink: 0
            }}
          >
            <Trash2 size={20} color="#dc2626" />
          </div>
          <h3 style={{ margin: 0, fontSize: '18px', color: '#1e293b' }}>
            Supprimer ce compte ?
          </h3>
        </div>
        <p style={{ margin: '0 0 16px', color: '#475569', fontSize: '14px', lineHeight: '1.5' }}>
          Cette action supprimera définitivement le compte <strong>{person.name}</strong> et ses données.
        </p>
        <div className="actions" style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
          <button
            type="button"
            onClick={onCancel}
            style={{
              minHeight: '40px',
              padding: '8px 16px',
              background: '#f1f5f9',
              border: '1px solid #cbd5e1',
              borderRadius: '6px',
              fontWeight: '600',
              color: '#334155',
              cursor: 'pointer'
            }}
          >
            Annuler
          </button>
          <button
            type="button"
            onClick={onConfirm}
            style={{
              minHeight: '40px',
              padding: '8px 18px',
              background: '#dc2626',
              border: '0',
              borderRadius: '6px',
              fontWeight: '700',
              color: '#fff',
              cursor: 'pointer',
              boxShadow: '0 2px 4px rgba(220, 38, 38, 0.25)'
            }}
          >
            Supprimer
          </button>
        </div>
      </div>
    </div>
  );
}

function MigrationPromptModal({ onConfirm, onCancel, loading, error }) {
  return (
    <div className="overlay" style={{ zIndex: 999999 }}>
      <div
        className="modal"
        style={{ maxWidth: '440px', direction: 'rtl', textAlign: 'right' }}
        onClick={e => e.stopPropagation()}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '12px',
            marginBottom: '14px'
          }}
        >
          <div
            style={{
              width: '42px',
              height: '42px',
              borderRadius: '50%',
              background: '#e0f2fe',
              display: 'grid',
              placeItems: 'center',
              flexShrink: 0
            }}
          >
            <Database size={22} color="#0284c7" />
          </div>
          <div>
            <h3 style={{ margin: 0, fontSize: '17px', color: '#0f172a', lineHeight: '1.3' }}>
              Replace current data with the imported database?
            </h3>
            <p style={{ margin: '3px 0 0', fontSize: '13px', color: '#64748b' }}>
              carnetdedettes 29-août-2026.db (SQLite)
            </p>
          </div>
        </div>

        <div
          style={{
            background: '#f8fafc',
            border: '1px solid #e2e8f0',
            borderRadius: '8px',
            padding: '12px 14px',
            marginBottom: '16px'
          }}
        >
          <p style={{ margin: '0 0 8px', fontSize: '14px', fontWeight: 'bold', color: '#1e293b' }}>
            15 accounts and 66 transactions will replace your current data.
          </p>
          <ul style={{ margin: 0, paddingRight: '18px', fontSize: '13px', color: '#475569', lineHeight: '1.6' }}>
            <li><strong>15 comptes vérifiés</strong> (avec soldes conformes à la base originale)</li>
            <li><strong>66 transactions actives</strong> (2 transactions supprimées ont été exclues)</li>
            <li>Une sauvegarde de sécurité de vos données actuelles sera conservée.</li>
          </ul>
        </div>

        {error && (
          <div
            style={{
              background: '#fef2f2',
              border: '1px solid #fecaca',
              borderRadius: '6px',
              padding: '10px 12px',
              color: '#991b1b',
              fontSize: '13px',
              marginBottom: '14px',
              display: 'flex',
              alignItems: 'center',
              gap: '8px'
            }}
          >
            <AlertTriangle size={18} />
            <span>{error}</span>
          </div>
        )}

        <div className="actions" style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end' }}>
          <button
            type="button"
            onClick={onCancel}
            disabled={loading}
            style={{
              minHeight: '40px',
              padding: '8px 18px',
              background: '#f1f5f9',
              border: '1px solid #cbd5e1',
              borderRadius: '6px',
              fontWeight: '600',
              color: '#334155',
              cursor: loading ? 'not-allowed' : 'pointer'
            }}
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={loading}
            style={{
              minHeight: '40px',
              padding: '8px 20px',
              background: '#0284c7',
              border: '0',
              borderRadius: '6px',
              fontWeight: '700',
              color: '#fff',
              cursor: loading ? 'not-allowed' : 'pointer',
              boxShadow: '0 2px 4px rgba(2, 132, 199, 0.25)'
            }}
          >
            {loading ? 'Remplacement en cours...' : 'Replace'}
          </button>
        </div>
      </div>
    </div>
  );
}

function LoginScreen() {
  const [error, setError] = useState('');
  const [unauthorizedDomain, setUnauthorizedDomain] = useState(null);

  async function login() {
    setError('');
    setUnauthorizedDomain(null);
    try {
      await signInWithPopup(auth, googleProvider);
    } catch (e) {
      if (e?.code === 'auth/unauthorized-domain') {
        const currentDomain = window.location.hostname;
        setUnauthorizedDomain(currentDomain);
        setError(`النطاق الحالي (${currentDomain}) غير مصرح به في Firebase Authentication.`);
      } else if (e?.code === 'auth/popup-blocked') {
        setError('المتصفح منع نافذة Google. اسمح بالنوافذ المنبثقة لهذا الموقع ثم حاول مرة أخرى.');
      } else if (e?.code === 'auth/popup-closed-by-user') {
        setError('تم إغلاق نافذة Google قبل إكمال تسجيل الدخول.');
      } else {
        setError(`تعذر تسجيل الدخول (${e?.code || 'unknown-error'}). تأكد من إعداد Google/Firebase ثم حاول مرة أخرى.`);
      }
    }
  }

  return (
    <div className="loginScreen">
      <div className="loginCard">
        <div className="loginLogo">
          <WalletCards />
        </div>
        <h1>El Pachax</h1>
        <p>دفتر الديون الخاص بك</p>
        <button className="googleButton" onClick={login}>
          <LogIn size={18} /> الدخول بحساب Google
        </button>
        {error && <div className="loginError">{error}</div>}
        {unauthorizedDomain && (
          <div style={{ marginTop: '10px', padding: '10px', background: '#fffbeb', border: '1px solid #fef3c7', borderRadius: '6px', fontSize: '12px', color: '#92400e', textAlign: 'right', direction: 'rtl' }}>
            <b>خطوات السماح بالنطاق:</b>
            <ol style={{ margin: '6px 0 0', paddingRight: '18px', lineHeight: '1.6' }}>
              <li>افتح <a href="https://console.firebase.google.com/project/el-pacha/authentication/settings" target="_blank" rel="noreferrer" style={{ color: '#2563eb', fontWeight: 'bold' }}>Firebase Console</a></li>
              <li>انتقل إلى <b>Authentication</b> &gt; <b>Settings</b> &gt; <b>Authorized domains</b></li>
              <li>أضف النطاق: <code style={{ direction: 'ltr', display: 'inline-block', background: '#f1f5f9', padding: '2px 5px', borderRadius: '4px', color: '#0f172a' }}>{unauthorizedDomain}</code></li>
            </ol>
          </div>
        )}
        <small>الحسابات المسموحة: {ALLOWED_EMAILS.join(' | ')}</small>
      </div>
    </div>
  );
}

function App({ user }) {
  const [people, setPeople] = useState(loadInitialPeople);
  const [selectedId, setSelectedId] = useState(people[0]?.id || 1);
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState('all'); // 'all' | 'due' | 'advance' | 'category'
  const [mobilePage, setMobilePage] = useState('home'); // 'home' | 'all-transactions' | 'person-transactions'
  const [soldeToggle, setSoldeToggle] = useState(true);

  // Modals
  const [showPerson, setShowPerson] = useState(false);
  const [showTransaction, setShowTransaction] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showPersonActions, setShowPersonActions] = useState(false);
  const [showAccountPicker, setShowAccountPicker] = useState(false);
  const [pickerSearch, setPickerSearch] = useState('');
  const [editingPersonId, setEditingPersonId] = useState(null);
  const [editScreen, setEditScreen] = useState(false);
  const [personToDelete, setPersonToDelete] = useState(null);
  const [showConfirmDeletePerson, setShowConfirmDeletePerson] = useState(false);

  // Restore state
  const fileInputRef = useRef(null);
  const [pendingRestoreData, setPendingRestoreData] = useState(null);
  const [showConfirmRestore, setShowConfirmRestore] = useState(false);
  const [restoreError, setRestoreError] = useState(null);
  const [restoreSuccess, setRestoreSuccess] = useState(null);

  // One-time SQLite Migration state
  const [showMigrationModal, setShowMigrationModal] = useState(false);
  const [migrationLoading, setMigrationLoading] = useState(false);
  const [migrationError, setMigrationError] = useState(null);

  // Settings state
  const [lastBackupTime, setLastBackupTime] = useState(
    () => localStorage.getItem('el-pachax-last-backup') || null
  );
  const [autoDriveBackup, setAutoDriveBackup] = useState(
    () => localStorage.getItem('el-pachax-auto-drive') === 'true'
  );
  const [syncing, setSyncing] = useState(false);
  const [driveStatus, setDriveStatus] = useState('');

  // Profile Photo state
  const cameraInputRef = useRef(null);
  const galleryInputRef = useRef(null);
  const [personPhotoPreview, setPersonPhotoPreview] = useState(null);
  const [pendingPhotoBlob, setPendingPhotoBlob] = useState(null);
  const [photoChanged, setPhotoChanged] = useState(false);
  const [photoError, setPhotoError] = useState('');
  const [isUploadingPhoto, setIsUploadingPhoto] = useState(false);
  const [showPhotoSourceModal, setShowPhotoSourceModal] = useState(false);

  function recordSuccessfulBackup() {
    const iso = new Date().toISOString();
    setLastBackupTime(iso);
    try {
      localStorage.setItem('el-pachax-last-backup', iso);
    } catch {}
  }

  // Forms state
  const [personName, setPersonName] = useState('');
  const [personPhone, setPersonPhone] = useState('');
  const [personNote, setPersonNote] = useState('');
  const [personCategory, setPersonCategory] = useState('Autres');
  const [personCompany, setPersonCompany] = useState('Carnet de Dettes');
  const [tx, setTx] = useState({ type: 'credit', amount: '', goods: '', note: '', date: today() });

  // Firestore Realtime Subscription
  useEffect(() => {
    const unsubscribe = subscribeToLedger(
      user,
      (remote, docData) => {
        if (Array.isArray(remote)) {
          setPeople(remote);
          saveLocal(remote);
        }
      },
      err => {
        console.error('Firestore sync error:', err);
      },
      status => {
        const localDone = localStorage.getItem('el-pachax-migration-completed') === MIGRATION_VERSION;
        const dismissed = sessionStorage.getItem('el-pachax-migration-dismissed') === MIGRATION_VERSION;
        if (!status?.migrationCompleted && !localDone && !dismissed) {
          setShowMigrationModal(true);
        }
      }
    );
    return unsubscribe;
  }, [user]);

  const filteredPeople = useMemo(() => {
    const cleanQ = normalizeSearchText(query);
    return people.filter(p => {
      if (cleanQ) {
        const nameNorm = normalizeSearchText(p.name);
        const phoneNorm = normalizeSearchText(p.phone);
        const companyNorm = normalizeSearchText(p.company);
        const phoneDigits = (p.phone || '').replace(/\D/g, '');
        const queryDigits = cleanQ.replace(/\D/g, '');

        const matchesName = nameNorm.includes(cleanQ);
        const matchesPhone = phoneNorm.includes(cleanQ) || (queryDigits.length >= 2 && phoneDigits.includes(queryDigits));
        const matchesCompany = companyNorm.includes(cleanQ);

        if (!matchesName && !matchesPhone && !matchesCompany) {
          return false;
        }
      }

      const b = balance(p);
      if (filter === 'due') return b > 0;
      if (filter === 'advance') return b < 0;
      return true;
    });
  }, [people, query, filter]);

  const selectedPerson = people.find(p => String(p.id) === String(selectedId)) || people[0];

  // Totals calculations
  let totalAdvance = 0;
  let totalDette = 0;
  let totalRecu = 0;
  let totalPaye = 0;

  people.forEach(p => {
    const b = balance(p);
    if (b >= 0) totalAdvance += b;
    else totalDette += Math.abs(b);

    (p.transactions || []).forEach(t => {
      if (t.type === 'credit') totalRecu += Number(t.amount) || 0;
      else totalPaye += Number(t.amount) || 0;
    });
  });

  const totalReceivable = people.reduce((s, p) => s + Math.max(balance(p), 0), 0);
  const totalSolde = totalRecu - totalPaye;

  // All transactions flattened and sorted
  const allTransactions = useMemo(() => {
    const rows = [];
    people.forEach(p => {
      (p.transactions || []).forEach(t => {
        rows.push({ p, t });
      });
    });
    rows.sort((a, b) => {
      const da = parseDate(a.t.date)?.getTime() || 0;
      const db = parseDate(b.t.date)?.getTime() || 0;
      return db - da || Number(b.t.id || 0) - Number(a.t.id || 0);
    });
    return rows;
  }, [people]);

  // Selected person sorted transactions with running balances
  const personTransactionsWithBalance = useMemo(() => {
    if (!selectedPerson) return [];
    const txs = [...(selectedPerson.transactions || [])];
    txs.sort((a, b) => {
      const da = parseDate(a.date)?.getTime() || 0;
      const db = parseDate(b.date)?.getTime() || 0;
      return da - db || Number(a.id || 0) - Number(b.id || 0);
    });
    let running = 0;
    const withRunning = txs.map(t => {
      running += t.type === 'credit' ? Number(t.amount) || 0 : -(Number(t.amount) || 0);
      return { ...t, solde: running };
    });
    return withRunning.reverse();
  }, [selectedPerson]);

  async function commit(next) {
    setPeople(next);
    saveLocal(next);
    setSyncing(true);
    try {
      await saveLedger(user, next);
      if (autoDriveBackup) {
        setDriveStatus('جاري تحديث Google Drive...');
        await uploadBackupToDrive(next);
        recordSuccessfulBackup();
        setDriveStatus('تم تحديث Google Drive ✓');
      }
    } catch (e) {
      setDriveStatus(e?.message || 'تعذر تحديث Google Drive');
    } finally {
      setSyncing(false);
    }
  }

  function handleExportLocal() {
    try {
      exportLocal(people);
      recordSuccessfulBackup();
      setRestoreError(null);
      setRestoreSuccess('تم تصدير النسخة الاحتياطية بنجاح إلى هذا الجهاز ✓');
      setTimeout(() => setRestoreSuccess(null), 4000);
    } catch (e) {
      setRestoreError('تعذر تصدير النسخة الاحتياطية محلياً');
    }
  }

  async function manualDriveExport() {
    try {
      setRestoreError(null);
      setDriveStatus('جاري التصدير إلى Google Drive...');
      await uploadBackupToDrive(people);
      recordSuccessfulBackup();
      setDriveStatus('تم التصدير إلى Google Drive ✓');
      setRestoreSuccess('تم حفظ النسخة الاحتياطية في Google Drive بنجاح ✓');
      setTimeout(() => setRestoreSuccess(null), 4000);
    } catch (e) {
      setDriveStatus(e?.message || 'تعذر التصدير إلى Google Drive');
      setRestoreError(e?.message || 'تعذر التصدير إلى Google Drive');
    }
  }

  async function manualDriveImport() {
    setRestoreError(null);
    setDriveStatus('جاري جلب النسخة الاحتياطية من Google Drive...');
    try {
      const rawContent = await downloadBackupFromDrive();
      const result = validateAndNormalizeBackup(rawContent);
      if (!result.success) {
        setRestoreError(result.error);
        setPendingRestoreData(null);
        setDriveStatus('ملف النسخة الاحتياطية غير صالح');
        return;
      }
      setDriveStatus(null);
      setRestoreError(null);
      setPendingRestoreData({ ...result, source: 'Google Drive' });
      setShowConfirmRestore(true);
    } catch (e) {
      setRestoreError(e?.message || 'تعذر استيراد النسخة من Google Drive');
      setDriveStatus(e?.message || 'تعذر الوصول إلى Google Drive');
    }
  }

  function triggerLocalFileSelect() {
    setRestoreError(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
      fileInputRef.current.click();
    }
  }

  function handleLocalFileSelect(e) {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      const content = event.target?.result;
      const result = validateAndNormalizeBackup(content);
      if (!result.success) {
        setRestoreError(result.error);
        setPendingRestoreData(null);
        return;
      }
      setRestoreError(null);
      setPendingRestoreData(result);
      setShowConfirmRestore(true);
    };
    reader.onerror = () => {
      setRestoreError('تعذر قراءة ملف النسخة الاحتياطية من الجهاز.');
    };
    reader.readAsText(file);
  }

  async function executeRestore() {
    if (!pendingRestoreData?.people) return;
    const targetPeople = pendingRestoreData.people;
    const stats = pendingRestoreData.stats;

    // 1. Create safety backup of current data
    createSafetyBackup(people);

    // 2. Clear pending restore and confirmation dialog
    setShowConfirmRestore(false);
    setPendingRestoreData(null);

    // 3. Immediately apply to React state, localStorage & Firestore
    setSelectedId(targetPeople[0]?.id || null);
    await commit(targetPeople);

    // 4. Show success message
    const msg = `تم استيراد واستعادة البيانات بنجاح: ${stats.totalAccounts} حساب و ${stats.totalTransactions} معاملة ✓`;
    setRestoreSuccess(msg);
    setTimeout(() => {
      setRestoreSuccess(null);
    }, 6000);
  }

  function cancelRestore() {
    setShowConfirmRestore(false);
    setPendingRestoreData(null);
  }

  async function handleExecuteMigration() {
    setMigrationError(null);
    setMigrationLoading(true);
    try {
      // 1. Verify JSON structure and statistics (15 accounts, 66 transactions)
      const validation = validateAndNormalizeBackup(IMPORTED_DATABASE);
      if (!validation.success) {
        throw new Error(validation.error || 'Échec de la validation de la base SQLite importée.');
      }

      if (validation.stats.totalAccounts !== 15 || validation.stats.totalTransactions !== 66) {
        throw new Error(
          `Vérification incorrecte : attendu 15 comptes et 66 transactions, trouvé ${validation.stats.totalAccounts} comptes et ${validation.stats.totalTransactions} transactions.`
        );
      }

      const targetPeople = validation.people;

      // 2. Safety snapshot before replacing
      createSafetyBackup(people);

      // 3. Atomically replace the ledger document in Firestore
      await executeMigrationToFirestore(user, targetPeople);

      // 4. Update local storage and React state
      localStorage.setItem('el-pachax-migration-completed', MIGRATION_VERSION);
      saveLocal(targetPeople);
      setPeople(targetPeople);
      setSelectedId(targetPeople[0]?.id || null);

      // 5. Close modal & show success feedback
      setShowMigrationModal(false);
      const msg = 'Migration terminée avec succès : 15 comptes et 66 transactions importés dans votre compte Firestore ✓';
      setRestoreSuccess(msg);
      setTimeout(() => setRestoreSuccess(null), 7000);
    } catch (err) {
      console.error('Migration failed:', err);
      setMigrationError(err?.message || 'Erreur lors de la migration. Les données actuelles restent inchangées.');
    } finally {
      setMigrationLoading(false);
    }
  }

  function handleCancelMigration() {
    setShowMigrationModal(false);
    setMigrationError(null);
    sessionStorage.setItem('el-pachax-migration-dismissed', MIGRATION_VERSION);
  }

  async function handlePhotoSelected(e) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;

    const validation = validateImageFile(file);
    if (!validation.valid) {
      setPhotoError(validation.error);
      return;
    }

    setPhotoError('');
    setIsUploadingPhoto(true);
    try {
      const { blob, previewUrl } = await processProfileImage(file, 512, 0.85);
      setPendingPhotoBlob(blob);
      setPersonPhotoPreview(previewUrl);
      setPhotoChanged(true);
    } catch (err) {
      setPhotoError(err?.message || 'Erreur lors du traitement de la photo.');
    } finally {
      setIsUploadingPhoto(false);
    }
  }

  function handleRemovePhoto() {
    setPendingPhotoBlob(null);
    setPersonPhotoPreview(null);
    setPhotoChanged(true);
    setPhotoError('');
  }

  function openAddPerson() {
    setEditingPersonId(null);
    setPersonName('');
    setPersonPhone('');
    setPersonNote('');
    setPersonCategory('Autres');
    setPersonCompany('Carnet de Dettes');
    setPersonPhotoPreview(null);
    setPendingPhotoBlob(null);
    setPhotoChanged(false);
    setPhotoError('');
    setShowPerson(true);
  }

  function openPersonActions(p) {
    setSelectedId(p.id);
    setShowPersonActions(true);
  }

  function openEditPerson(p) {
    setEditingPersonId(p.id);
    setPersonName(p.name || '');
    setPersonPhone(p.phone || '');
    setPersonNote(p.note || '');
    setPersonCategory(p.category || 'Autres');
    setPersonCompany(p.company || 'Carnet de Dettes');
    setPersonPhotoPreview(p.photoURL || null);
    setPendingPhotoBlob(null);
    setPhotoChanged(false);
    setPhotoError('');
    setShowPersonActions(false);
    setEditScreen(true);
  }

  function closePersonModal() {
    setShowPerson(false);
    setEditingPersonId(null);
    setPersonName('');
    setPersonPhone('');
    setPersonNote('');
    setPersonCategory('Autres');
    setPersonCompany('Carnet de Dettes');
    setPersonPhotoPreview(null);
    setPendingPhotoBlob(null);
    setPhotoChanged(false);
    setPhotoError('');
  }

  async function savePerson(e) {
    e.preventDefault();
    if (!personName.trim()) return;
    setIsUploadingPhoto(true);
    setPhotoError('');
    try {
      if (editingPersonId !== null) {
        const cur = people.find(p => p.id === editingPersonId);
        let finalPhotoURL = cur?.photoURL || null;
        if (photoChanged) {
          if (pendingPhotoBlob && user?.uid) {
            const { downloadUrl } = await uploadProfilePhotoToStorage(user.uid, editingPersonId, pendingPhotoBlob);
            finalPhotoURL = downloadUrl;
            if (cur?.photoURL && cur.photoURL !== downloadUrl) {
              deleteProfilePhotoFromStorage(cur.photoURL);
            }
          } else {
            finalPhotoURL = null;
            if (cur?.photoURL) {
              deleteProfilePhotoFromStorage(cur.photoURL);
            }
          }
        }
        const next = people.map(p => {
          if (p.id !== editingPersonId) return p;
          const updated = {
            id: p.id,
            name: personName.trim(),
            phone: personPhone.trim(),
            note: personNote.trim(),
            category: personCategory.trim() || 'Autres',
            company: personCompany.trim() || 'Carnet de Dettes',
            transactions: p.transactions || []
          };
          if (finalPhotoURL) {
            updated.photoURL = finalPhotoURL;
          }
          return updated;
        });
        await commit(next);
        setSelectedId(editingPersonId);
        closePersonModal();
        return;
      }

      const id = Date.now();
      let newPhotoURL = null;
      if (pendingPhotoBlob && user?.uid) {
        const { downloadUrl } = await uploadProfilePhotoToStorage(user.uid, id, pendingPhotoBlob);
        newPhotoURL = downloadUrl;
      }

      const newPerson = {
        id,
        name: personName.trim(),
        phone: personPhone.trim(),
        note: personNote.trim(),
        category: personCategory.trim() || 'Autres',
        company: personCompany.trim() || 'Carnet de Dettes',
        transactions: []
      };
      if (newPhotoURL) {
        newPerson.photoURL = newPhotoURL;
      }

      const next = [...people, newPerson];
      await commit(next);
      setSelectedId(id);
      closePersonModal();
    } catch (err) {
      console.error('Error saving person / photo:', err);
      setPhotoError('Échec de la sauvegarde de la photo: ' + (err?.message || ''));
    } finally {
      setIsUploadingPhoto(false);
    }
  }

  async function saveEditScreen(e) {
    e.preventDefault();
    if (editingPersonId === null) return;
    const cur = people.find(p => p.id === editingPersonId);
    setIsUploadingPhoto(true);
    setPhotoError('');
    try {
      let finalPhotoURL = cur?.photoURL || null;
      if (photoChanged) {
        if (pendingPhotoBlob && user?.uid) {
          const { downloadUrl } = await uploadProfilePhotoToStorage(user.uid, editingPersonId, pendingPhotoBlob);
          finalPhotoURL = downloadUrl;
          if (cur?.photoURL && cur.photoURL !== downloadUrl) {
            deleteProfilePhotoFromStorage(cur.photoURL);
          }
        } else {
          finalPhotoURL = null;
          if (cur?.photoURL) {
            deleteProfilePhotoFromStorage(cur.photoURL);
          }
        }
      }

      const next = people.map(p => {
        if (p.id !== editingPersonId) return p;
        const updated = {
          id: p.id,
          name: personName.trim(),
          phone: personPhone.trim(),
          note: personNote.trim(),
          category: personCategory.trim() || 'Autres',
          company: personCompany.trim() || 'Carnet de Dettes',
          transactions: p.transactions || []
        };
        if (finalPhotoURL) {
          updated.photoURL = finalPhotoURL;
        }
        return updated;
      });
      await commit(next);
      setSelectedId(editingPersonId);
      setEditScreen(false);
      setEditingPersonId(null);
    } catch (err) {
      console.error('Error updating person / photo:', err);
      setPhotoError('Échec du téléversement de la photo: ' + (err?.message || ''));
    } finally {
      setIsUploadingPhoto(false);
    }
  }

  function requestDeletePerson(p) {
    if (!p || !p.id) return;
    setPersonToDelete(p);
    setShowPersonActions(false);
    setShowConfirmDeletePerson(true);
  }

  function cancelDeletePerson() {
    setShowConfirmDeletePerson(false);
    setPersonToDelete(null);
  }

  async function confirmDeletePerson() {
    if (!personToDelete?.id) return;
    const targetId = personToDelete.id;
    const targetPhotoURL = personToDelete.photoURL;
    const next = people.filter(p => p.id !== targetId);

    setShowConfirmDeletePerson(false);
    setPersonToDelete(null);
    setShowPersonActions(false);
    setEditScreen(false);
    setEditingPersonId(null);

    setMobilePage('home');
    setSelectedId(next[0]?.id || null);

    await commit(next);
    if (targetPhotoURL) {
      deleteProfilePhotoFromStorage(targetPhotoURL);
    }
  }

  function addTransaction(e) {
    e.preventDefault();
    const amount = Number(tx.amount);
    if (!amount || !selectedPerson || !tx.date) return;
    const item = {
      id: Date.now(),
      type: tx.type,
      amount,
      goods: tx.goods.trim(),
      note: tx.note.trim(),
      date: tx.date
    };
    const next = people.map(p =>
      p.id === selectedPerson.id ? { ...p, transactions: [...(p.transactions || []), item] } : p
    );
    commit(next);
    setTx({ type: 'credit', amount: '', goods: '', note: '', date: today() });
    setShowTransaction(false);
  }

  function openTransaction(type = 'credit') {
    setTx({ type, amount: '', goods: '', note: '', date: today() });
    setShowTransaction(true);
  }

  function toggleAutoDrive() {
    const next = !autoDriveBackup;
    setAutoDriveBackup(next);
    localStorage.setItem('el-pachax-auto-drive', String(next));
    if (next) {
      uploadBackupToDrive(people)
        .then(() => setDriveStatus('تم تفعيل النسخ التلقائي ✓'))
        .catch(e => setDriveStatus(e?.message || 'تعذر تفعيل Google Drive'));
    }
  }

  if (editScreen && editingPersonId !== null) {
    const currentEditingPerson = people.find(p => p.id === editingPersonId);
    return (
      <div className="accountEditPage">
        <header className="accountEditHeader">
          <button
            className="editBack"
            onClick={() => {
              setEditScreen(false);
              setEditingPersonId(null);
            }}
          >
            <ArrowLeft size={22} />
          </button>
          <h1>Modifier un compte</h1>
          <button
            type="button"
            className="editDelete"
            onClick={() => {
              if (currentEditingPerson) {
                requestDeletePerson(currentEditingPerson);
              }
            }}
          >
            <Trash2 size={19} />
          </button>
        </header>
        <form className="accountEditForm" onSubmit={saveEditScreen}>
          <div className="editAvatar">
            <div
              className={`editAvatarPreviewWrap ${personPhotoPreview ? 'hasPhoto' : ''}`}
              onClick={() => setShowPhotoSourceModal(true)}
            >
              {personPhotoPreview ? (
                <img
                  src={personPhotoPreview}
                  alt="Profile"
                  className="editAvatarImg"
                  referrerPolicy="no-referrer"
                />
              ) : (
                <UserRound size={48} />
              )}
              <button
                type="button"
                className="cameraButton"
                onClick={e => {
                  e.stopPropagation();
                  setShowPhotoSourceModal(true);
                }}
                aria-label="Changer la photo"
              >
                <Camera size={16} />
              </button>
            </div>

            <div className="editAvatarControls">
              {personPhotoPreview ? (
                <>
                  <button
                    type="button"
                    className="photoBtn change"
                    onClick={() => setShowPhotoSourceModal(true)}
                  >
                    <Camera size={14} /> Changer la photo
                  </button>
                  <button
                    type="button"
                    className="photoBtn delete"
                    onClick={handleRemovePhoto}
                  >
                    <Trash2 size={14} /> Supprimer la photo
                  </button>
                </>
              ) : (
                <button
                  type="button"
                  className="photoBtn add"
                  onClick={() => setShowPhotoSourceModal(true)}
                >
                  <Camera size={14} /> Ajouter une photo
                </button>
              )}
            </div>

            {photoError && (
              <div className="photoErrorBanner" style={{ marginTop: '8px' }}>
                <AlertTriangle size={15} />
                <span>{photoError}</span>
              </div>
            )}
          </div>
          <div className="editCard">
            <label>Nom</label>
            <div className="editInput">
              <ContactRound size={17} />
              <input value={personName} onChange={e => setPersonName(e.target.value)} autoFocus />
              <button type="button">
                <ContactRound size={15} />
              </button>
            </div>
            <small>Ajouter Client Fournisseur Nom</small>

            <label>Numéro de téléphone (facultatif)</label>
            <div className="editInput">
              <Phone size={17} />
              <input
                type="tel"
                value={personPhone}
                onChange={e => setPersonPhone(e.target.value)}
                placeholder="+216"
              />
            </div>

            <label>Catégorie</label>
            <div className="editInput">
              <ContactRound size={17} />
              <input value={personCategory} onChange={e => setPersonCategory(e.target.value)} />
              <button type="button" className="categoryDot" />
            </div>
            <small>Ajouter Client Fournisseur (facultatif)</small>

            <label>Entreprise</label>
            <div className="editInput">
              <Building2 size={17} />
              <input value={personCompany} onChange={e => setPersonCompany(e.target.value)} />
            </div>

            <label className="editNoteLabel">Note</label>
            <textarea
              value={personNote}
              onChange={e => setPersonNote(e.target.value)}
              placeholder="Note facultative"
            />
          </div>
          <button className="saveEditButton" disabled={isUploadingPhoto}>
            {isUploadingPhoto ? 'Téléversement de la photo...' : 'Sauvegarder et quitter'}
          </button>
        </form>
        {showConfirmDeletePerson && personToDelete && (
          <ConfirmDeleteModal
            person={personToDelete}
            onConfirm={confirmDeletePerson}
            onCancel={cancelDeletePerson}
          />
        )}

        {/* Hidden inputs for Camera and Gallery photo pickers */}
        <input
          ref={cameraInputRef}
          type="file"
          accept="image/*"
          capture="environment"
          style={{ display: 'none' }}
          onChange={handlePhotoSelected}
        />
        <input
          ref={galleryInputRef}
          type="file"
          accept="image/jpeg,image/jpg,image/png,image/webp,image/*"
          style={{ display: 'none' }}
          onChange={handlePhotoSelected}
        />

        {/* Photo Source Selection Bottom Sheet */}
        {showPhotoSourceModal && (
          <div className="photoSourceOverlay" onClick={() => setShowPhotoSourceModal(false)}>
            <div className="photoSourceSheet" onClick={e => e.stopPropagation()}>
              <div className="photoSourceHeader">
                <h4>{personPhotoPreview ? 'Changer la photo' : 'Ajouter une photo'}</h4>
              </div>

              <div className="photoSourceOptions">
                <button
                  type="button"
                  className="photoSourceOption"
                  onClick={() => {
                    setShowPhotoSourceModal(false);
                    if (cameraInputRef.current) {
                      cameraInputRef.current.click();
                    }
                  }}
                >
                  <span className="photoSourceIcon">📷</span>
                  <div className="photoSourceText">
                    <b>Prendre une photo</b>
                    <small>Utiliser l'appareil photo</small>
                  </div>
                </button>

                <button
                  type="button"
                  className="photoSourceOption"
                  onClick={() => {
                    setShowPhotoSourceModal(false);
                    if (galleryInputRef.current) {
                      galleryInputRef.current.click();
                    }
                  }}
                >
                  <span className="photoSourceIcon">🖼️</span>
                  <div className="photoSourceText">
                    <b>Choisir depuis la galerie</b>
                    <small>JPG, PNG, WebP depuis l'appareil</small>
                  </div>
                </button>
              </div>

              <button
                type="button"
                className="photoSourceCancel"
                onClick={() => setShowPhotoSourceModal(false)}
              >
                Annuler
              </button>
            </div>
          </div>
        )}
      </div>
    );
  }

  if (!selectedPerson && mobilePage === 'person-transactions') {
    return (
      <div className="app">
        <header className="topbar">
          <div className="brandSide">
            <button className="iconButton" onClick={() => setMobilePage('home')}>
              <Menu size={22} />
            </button>
            <div>
              <h1>Credit Debit</h1>
            </div>
          </div>
        </header>
        <main>
          <div className="empty" style={{ padding: '60px 20px', textAlign: 'center' }}>
            <p>Compte introuvable</p>
            <button className="primary" style={{ margin: '16px auto' }} onClick={() => setMobilePage('home')}>
              Retour à l'accueil
            </button>
          </div>
        </main>
      </div>
    );
  }

  return (
    <div className={`app ${mobilePage === 'home' ? 'home-mode' : ''}`}>
      {/* Topbar */}
      <header className="topbar">
        <div className="brandSide">
          <button className="iconButton" onClick={() => setMobilePage('home')} aria-label="Menu principal">
            <Menu size={22} />
          </button>
          <div>
            <h1>Credit Debit</h1>
          </div>
        </div>
        <div className="headerControls">
          <div className="headerSearchWrap">
            <Search size={16} className="headerSearchIcon" />
            <input
              type="text"
              className="headerSearchInput"
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder="Rechercher un compte..."
              aria-label="Rechercher un compte"
            />
            {query && (
              <button
                type="button"
                className="headerSearchClear"
                onClick={() => setQuery('')}
                aria-label="Effacer la recherche"
              >
                <X size={14} />
              </button>
            )}
          </div>
          <button
            type="button"
            className="headerSettingsBtn"
            onClick={() => setShowSettings(true)}
            aria-label="Paramètres"
          >
            <Settings size={17} />
            <span>Paramètres</span>
          </button>
        </div>
      </header>

      <main className={mobilePage === 'home' ? 'main-home' : ''}>
        {restoreSuccess && (
          <div className="restoreSuccessBanner" style={{ margin: '0 8px 10px', direction: 'rtl' }}>
            <CheckCircle2 size={18} />
            <span style={{ flex: 1 }}>{restoreSuccess}</span>
            <button
              type="button"
              style={{ background: 'transparent', border: 0, cursor: 'pointer', color: 'inherit' }}
              onClick={() => setRestoreSuccess(null)}
            >
              <X size={16} />
            </button>
          </div>
        )}
        {/* ===================== ACTIVE VIEWS ===================== */}
        {mobilePage === 'home' && (
          <div className="mobile-ref-home">
            {/* Filter tabs below topbar */}
            <div className="refFilters">
              {[
                ['all', 'Tous'],
                ['due', 'Dette'],
                ['advance', 'Avance'],
                ['category', 'Catégorie']
              ].map(([key, label]) => (
                <button
                  key={key}
                  className={filter === key ? 'active' : ''}
                  onClick={() => setFilter(key)}
                >
                  {label}
                </button>
              ))}
            </div>

            {/* Client list */}
            <div className="refPeopleList">
              {filteredPeople.length === 0 ? (
                <div
                  style={{
                    padding: '54px 20px',
                    textAlign: 'center',
                    color: '#64748b',
                    fontSize: '15px'
                  }}
                >
                  <Search size={32} style={{ color: '#94a3b8', marginBottom: '10px', display: 'inline-block' }} />
                  <p style={{ margin: 0, fontWeight: '600', color: '#334155', fontSize: '16px' }}>Aucun compte trouvé</p>
                  {query && (
                    <button
                      type="button"
                      onClick={() => setQuery('')}
                      style={{
                        marginTop: '14px',
                        background: '#e0f2fe',
                        color: '#0284c7',
                        border: 0,
                        borderRadius: '6px',
                        padding: '7px 16px',
                        fontSize: '13px',
                        fontWeight: '700',
                        cursor: 'pointer'
                      }}
                    >
                      Effacer la recherche
                    </button>
                  )}
                </div>
              ) : (
                filteredPeople.map(p => {
                  const b = balance(p);
                  const latest = getLatestTransaction(p);
                  const d = formatHomeDate(latest?.date);
                  const initial = (p.name || '?').trim().charAt(0).toUpperCase();
                  return (
                    <div
                      key={p.id}
                      className="refPerson"
                      onClick={() => {
                        setSelectedId(p.id);
                        setMobilePage('person-transactions');
                      }}
                    >
                      <div className="refAvatar">
                        {p.photoURL ? (
                          <img src={p.photoURL} alt={p.name} referrerPolicy="no-referrer" />
                        ) : (
                          initial
                        )}
                      </div>
                      <div className="refMain">
                        <div className="refName" title={p.name}>{p.name || ''}</div>
                        <div className="refCat">{p.category || 'Autres'}</div>
                      </div>
                      <div className="refDate">
                        {d.top ? (
                          <>
                            <span className="refDateTop">{d.top}</span>
                            <span className="refDateYear">{d.year}</span>
                          </>
                        ) : (
                          <span className="refDateEmpty">—</span>
                        )}
                      </div>
                      <div className={`refAmount ${b >= 0 ? 'advance' : 'debt'}`}>
                        <span className="refAmountVal">
                          {b < 0 ? '-' : ''}
                          {formatAmountFr(Math.abs(b))}
                        </span>
                        <span className="refAmountLabel">
                          {b >= 0 ? 'Avance' : 'Dette'}
                        </span>
                      </div>
                      <button
                        type="button"
                        className="refMore"
                        aria-label="Actions"
                        onClick={e => {
                          e.stopPropagation();
                          openPersonActions(p);
                        }}
                      >
                        ⋮
                      </button>
                    </div>
                  );
                })
              )}
            </div>

            {/* Fixed Bottom Action & Summary Section */}
            <div className="refBottomFixed">
              {/* Action Bar (Bottom of Home) */}
              <div className="refActionBar">
                <button className="txBtn" onClick={() => setMobilePage('all-transactions')}>
                  <span className="btnIcon">☷</span> Transactions
                </button>
                <button className="clientBtn" onClick={openAddPerson}>
                  <span className="btnIcon">✚</span> Ajouter un Client
                </button>
              </div>

              {/* Reference Totals */}
              <div className="refTotals">
                <div className="refTotal av">
                  <b>Total Avance</b>
                  <strong>{formatAmountFr(totalAdvance)}</strong>
                </div>
                <div className="refTotal dt">
                  <b>Total Dette</b>
                  <strong>-{formatAmountFr(totalDette)}</strong>
                </div>
                <div className="refTotal sd">
                  <b>Solde</b>
                  <strong>
                    {formatAmountFr(totalAdvance - totalDette)}
                    <br />
                    <span className="soldeSubText">{totalAdvance >= totalDette ? 'Avance' : 'Dette'}</span>
                  </strong>
                </div>
              </div>
            </div>
          </div>
        )}

        {mobilePage === 'all-transactions' && (
          <div className="mobileTxPage">
            <div className="txHeader">
              <button className="txBack" onClick={() => setMobilePage('home')}>
                ‹
              </button>
              <span>Transactions</span>
              <button className="txTools" onClick={() => setShowSettings(true)}>
                ⋮
              </button>
            </div>
            <div className="txCount" style={{ padding: '11px 14px 7px' }}>
              Transactions {allTransactions.length}
            </div>
            <div className="txPills">
              <button className="active">Tous</button>
              <button>Quotidien</button>
              <button>Hebdomadaire</button>
              <button>Mensuel</button>
            </div>
            <div className="txAll">Tous</div>
            <div className="txTableHead">
              <span>Date</span>
              <span>Nom</span>
              <span className="r">Reçu</span>
              <span className="p">Payé</span>
            </div>
            <div className="txRows">
              {allTransactions.map(({ p, t }) => (
                <div className="txRow" key={t.id}>
                  <span className="txDate">{formatTxDateText(t.date)}</span>
                  <span className="txName">{p.name || ''}</span>
                  <span className="txRecv">{t.type === 'credit' ? formatAmountFr(t.amount) : ''}</span>
                  <span className="txPay">{t.type === 'payment' ? formatAmountFr(t.amount) : ''}</span>
                  {(t.goods || t.note) && (
                    <span className="txGoods">{[t.goods, t.note].filter(Boolean).join(' • ')}</span>
                  )}
                </div>
              ))}
            </div>
            <div className="txTotals">
              <div className="txTotal recu">
                <b>Total Reçu</b>
                <strong>{formatAmountFr(totalRecu)}</strong>
              </div>
              <div className="txTotal paye">
                <b>Total Payé</b>
                <strong>{formatAmountFr(totalPaye)}</strong>
              </div>
              <div className="txTotal solde">
                <b>Solde</b>
                <strong>
                  {formatAmountFr(totalRecu - totalPaye)}
                  <br />
                  {totalRecu >= totalPaye ? 'Avance' : 'Dette'}
                </strong>
              </div>
            </div>
            <div className="txAdd">
              <button onClick={() => setShowAccountPicker(true)}>⊕ Ajouter une Transaction</button>
            </div>
          </div>
        )}

        {mobilePage === 'person-transactions' && selectedPerson && (
          <div className="mobileTxPage">
            <div className="txHeader txPersonMode">
              <button className="txBack" onClick={() => setMobilePage('home')}>
                ‹
              </button>
              <div className="txHeaderIdentityWrap">
                {selectedPerson.photoURL ? (
                  <div className="txAvatar">
                    <img src={selectedPerson.photoURL} alt={selectedPerson.name} referrerPolicy="no-referrer" />
                  </div>
                ) : (
                  <div className="txAvatar">
                    {(selectedPerson.name || '?').trim().charAt(0).toUpperCase()}
                  </div>
                )}
                <div className="txIdentity">
                  <div className="txPersonName">{selectedPerson.name}</div>
                  {selectedPerson.phone && <div className="txPhone">{selectedPerson.phone}</div>}
                </div>
              </div>
              <button className="txTools" onClick={() => openPersonActions(selectedPerson)}>
                ☰ ⋮
              </button>
            </div>
            <div className="txMeta">
              <div className="txCount">Transactions {personTransactionsWithBalance.length}</div>
              <div className="txSoldeToggle">
                Solde{' '}
                <button
                  type="button"
                  className={`txSwitch ${soldeToggle ? '' : 'off'}`}
                  onClick={() => setSoldeToggle(!soldeToggle)}
                />
              </div>
            </div>
            <div className={`txTableHead ${soldeToggle ? '' : 'solde-off'}`}>
              <span>Date</span>
              <span className="r">Reçu</span>
              <span className="p">Payé</span>
              {soldeToggle && <span className="soldeHead">Solde</span>}
            </div>
            <div className="txRows">
              {personTransactionsWithBalance.map(t => (
                <div className={`txRow ${soldeToggle ? '' : 'solde-off'}`} key={t.id}>
                  <span className="txDate">{formatTxDateText(t.date)}</span>
                  <span className="txRecv">{t.type === 'credit' ? formatAmountFr(t.amount) : ''}</span>
                  <span className="txPay">{t.type === 'payment' ? formatAmountFr(t.amount) : ''}</span>
                  {soldeToggle && (
                    <span className={`txSoldeCell ${t.solde < 0 ? 'negative' : 'positive'}`}>
                      {t.solde < 0 ? '-' : ''}
                      {formatAmountFr(Math.abs(t.solde))}
                    </span>
                  )}
                  {(t.goods || t.note) && (
                    <span className="txGoods">{[t.goods, t.note].filter(Boolean).join(' • ')}</span>
                  )}
                </div>
              ))}
            </div>
            <div className="txTotals">
              <div className="txTotal recu">
                <b>Total Reçu</b>
                <strong>
                  {formatAmountFr(
                    (selectedPerson.transactions || []).reduce(
                      (s, t) => s + (t.type === 'credit' ? Number(t.amount) || 0 : 0),
                      0
                    )
                  )}
                </strong>
              </div>
              <div className="txTotal paye">
                <b>Total Payé</b>
                <strong>
                  {formatAmountFr(
                    (selectedPerson.transactions || []).reduce(
                      (s, t) => s + (t.type === 'payment' ? Number(t.amount) || 0 : 0),
                      0
                    )
                  )}
                </strong>
              </div>
              <div className="txTotal solde">
                <b>Solde</b>
                <strong>
                  {formatAmountFr(Math.abs(balance(selectedPerson)))}
                  <br />
                  {balance(selectedPerson) >= 0 ? 'Avance' : 'Dette'}
                </strong>
              </div>
            </div>
            <div className="txAdd">
              <button onClick={() => openTransaction('credit')}>⊕ Ajouter une Transaction</button>
            </div>
          </div>
        )}
      </main>

      {/* Account Picker Modal */}
      {showAccountPicker && (
        <div className="el-pachax-account-picker" onClick={() => setShowAccountPicker(false)}>
          <div className="pickerCard" onClick={e => e.stopPropagation()}>
            <div className="pickerTitle">Sélectionner un compte</div>
            <div className="pickerSearch">
              <span>⌕</span>
              <input
                autoFocus
                placeholder="Chercher"
                value={pickerSearch}
                onChange={e => setPickerSearch(e.target.value)}
              />
            </div>
            <div className="pickerList">
              {people
                .filter(p => (p.name || '').toLowerCase().includes(pickerSearch.trim().toLowerCase()))
                .map(p => (
                  <button
                    key={p.id}
                    className="pickerPerson"
                    onClick={() => {
                      setSelectedId(p.id);
                      setShowAccountPicker(false);
                      setMobilePage('person-transactions');
                      openTransaction('credit');
                    }}
                  >
                    {p.name}
                  </button>
                ))}
            </div>
            <button
              className="pickerAdd"
              onClick={() => {
                setShowAccountPicker(false);
                openAddPerson();
              }}
            >
              AJOUTER UN CLIENT
            </button>
          </div>
        </div>
      )}

      {/* Account Actions Sheet */}
      {showPersonActions && selectedPerson && (
        <div className="accountActionOverlay" onClick={() => setShowPersonActions(false)}>
          <div className="accountActionSheet" onClick={e => e.stopPropagation()}>
            <div className="accountActionHeader">
              <span className="actionAvatar">
                {selectedPerson.photoURL ? (
                  <img src={selectedPerson.photoURL} alt={selectedPerson.name} referrerPolicy="no-referrer" />
                ) : (
                  <UserRound size={24} />
                )}
              </span>
              <div>
                <b>{selectedPerson.name}</b>
                <strong className={balance(selectedPerson) < 0 ? 'green' : ''}>
                  {Math.abs(balance(selectedPerson)).toFixed(0)}{' '}
                  {balance(selectedPerson) < 0 ? 'Avance' : 'Dette'}
                </strong>
              </div>
            </div>
            <button
              onClick={() => {
                setShowPersonActions(false);
                openTransaction('credit');
              }}
            >
              <Plus size={17} /> Ajouter une Transaction
            </button>
            <button onClick={() => setShowPersonActions(false)}>
              <Settings size={17} /> Régler le compte
            </button>
            <button
              onClick={() => {
                setShowPersonActions(false);
                if (selectedPerson.phone) window.open(`tel:${selectedPerson.phone}`);
              }}
            >
              <Phone size={17} /> Appeler
            </button>
            <button onClick={() => setShowPersonActions(false)}>
              <BellRing size={17} /> Envoyer rappel de paiement
            </button>
            <button onClick={() => setShowPersonActions(false)}>
              <FileSignature size={17} /> Signet
            </button>
            <button type="button" onClick={() => openEditPerson(selectedPerson)}>
              <Pencil size={17} /> Modifier un compte
            </button>
            <button
              type="button"
              className="dangerAction"
              onClick={() => requestDeletePerson(selectedPerson)}
            >
              <Trash2 size={17} /> Supprimer Compte
            </button>
          </div>
        </div>
      )}

      {/* Settings Modal */}
      {showSettings && (
        <div className="overlay" onClick={() => setShowSettings(false)}>
          <div className="modal settingsModal" onClick={e => e.stopPropagation()}>
            <div className="modalTitle">
              <h3>Settings</h3>
              <button className="close" onClick={() => setShowSettings(false)}>
                <X size={19} />
              </button>
            </div>
            <div className="settingRow">
              <div>
                <b>Automatic Google Drive Backup</b>
                <small>تحديث نسخة واحدة في Google Drive بعد كل معلومة جديدة.</small>
              </div>
              <button
                className={`toggle ${autoDriveBackup ? 'on' : ''}`}
                onClick={toggleAutoDrive}
              >
                <span />
              </button>
            </div>
            <div className={`settingStatus ${autoDriveBackup ? 'enabled' : ''}`}>
              {autoDriveBackup
                ? '🟢 ON — النسخ التلقائي مفعّل'
                : '⚪ OFF — النسخ التلقائي متوقف'}
            </div>
            <div className="accountBox">
              <b>Google Account</b>
              <span>{user.email}</span>
            </div>
            <div className="syncStatus">
              {syncing ? '☁️ جاري حفظ التغييرات...' : '☁️ المزامنة مع Firestore مفعّلة'}
              {driveStatus && (
                <>
                  <br />☁️ {driveStatus}
                </>
              )}
            </div>

            {/* BACKUP & RESTORE SECTION */}
            <div className="settingsSection">
              <div className="settingsSectionTitle">BACKUP & RESTORE</div>

              {/* EXPORT */}
              <div className="backupGroup">
                <span className="backupGroupLabel">EXPORT</span>
                <div className="backupButtonGroup">
                  <button
                    type="button"
                    className="backupBtn exportDrive"
                    onClick={manualDriveExport}
                  >
                    <Cloud size={16} /> Export to Drive
                  </button>
                  <button
                    type="button"
                    className="backupBtn exportLocal"
                    onClick={handleExportLocal}
                  >
                    <HardDrive size={16} /> Export to Local
                  </button>
                </div>
              </div>

              {/* IMPORT / RESTORE */}
              <div className="backupGroup">
                <span className="backupGroupLabel">IMPORT / RESTORE</span>
                <div className="backupButtonGroup">
                  <button
                    type="button"
                    className="backupBtn importDrive"
                    onClick={manualDriveImport}
                  >
                    <Download size={16} /> Import from Drive
                  </button>
                  <button
                    type="button"
                    className="backupBtn importLocal"
                    onClick={triggerLocalFileSelect}
                  >
                    <Upload size={16} /> Import from Local
                  </button>
                </div>
              </div>

              {/* Last Backup Notice */}
              <div className="lastBackupNotice">
                {formatLastBackup(lastBackupTime)}
              </div>

              {restoreError && (
                <div className="restoreErrorBanner" style={{ marginTop: '10px' }}>
                  <AlertTriangle size={18} /> {restoreError}
                </div>
              )}
              {restoreSuccess && (
                <div className="restoreSuccessBanner" style={{ marginTop: '10px' }}>
                  <CheckCircle2 size={18} /> {restoreSuccess}
                </div>
              )}
            </div>

            {/* Bottom Actions */}
            <div className="actions" style={{ marginTop: '16px' }}>
              <button
                type="button"
                className="secondary"
                onClick={() => signOut(auth)}
              >
                <LogOut size={16} /> تسجيل الخروج
              </button>
              <button type="button" onClick={() => setShowSettings(false)}>
                إغلاق
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Hidden input for local JSON backup import */}
      <input
        ref={fileInputRef}
        type="file"
        accept=".json,application/json"
        style={{ display: 'none' }}
        onChange={handleLocalFileSelect}
      />

      {/* Restore Confirmation Modal */}
      {showConfirmRestore && pendingRestoreData && (
        <div className="overlay">
          <div className="modal" onClick={e => e.stopPropagation()}>
            <div className="modalTitle">
              <h3>تأكيد استيراد النسخة الاحتياطية</h3>
              <button className="close" onClick={cancelRestore}>
                <X size={19} />
              </button>
            </div>

            <div className="restoreStats">
              <b>معلومات النسخة الاحتياطية المحددة:</b>
              <ul>
                <li>عدد الحسابات (العملاء): <strong>{pendingRestoreData.stats?.totalAccounts}</strong></li>
                <li>إجمالي المعاملات: <strong>{pendingRestoreData.stats?.totalTransactions}</strong></li>
                {pendingRestoreData.stats?.exportedAt && (
                  <li>تاريخ التصدير: <strong>{new Date(pendingRestoreData.stats.exportedAt).toLocaleString('fr-FR')}</strong></li>
                )}
              </ul>
            </div>

            <div className="restoreNotice">
              <strong>⚠️ تحذير:</strong> سيتم استبدال جميع البيانات الحالية في التطبيق بالكامل بالبيانات المستوردة من هذه النسخة الاحتياطية. تم حفظ نسخة احتياطية أمان تلقائياً من بياناتك الحالية قبل الاستبدال.
            </div>

            <div className="actions">
              <button type="button" onClick={cancelRestore}>
                إلغاء
              </button>
              <button
                type="button"
                className="primary"
                style={{ background: '#d32f2f', color: '#fff' }}
                onClick={executeRestore}
              >
                تأكيد واستبدال البيانات
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Add / Edit Person Modal */}
      {showPerson && (
        <div className="overlay">
          <form className="modal" onSubmit={savePerson}>
            <h3>{editingPersonId !== null ? 'تعديل معلومات الشخص' : 'إضافة شخص'}</h3>

            {/* Profile Photo Selection */}
            <div className="addPersonPhotoSection">
              <div
                className={`addPersonAvatarWrap ${!personPhotoPreview ? 'empty' : ''}`}
                onClick={() => setShowPhotoSourceModal(true)}
              >
                {personPhotoPreview ? (
                  <img
                    src={personPhotoPreview}
                    alt="Aperçu"
                    className="addPersonAvatarImg"
                    referrerPolicy="no-referrer"
                  />
                ) : (
                  <div className="addPersonAvatarPlaceholder">
                    <UserRound size={34} />
                    <span className="addPersonAvatarPlus">+</span>
                  </div>
                )}
              </div>

              <div className="addPersonPhotoControls">
                {personPhotoPreview ? (
                  <>
                    <button
                      type="button"
                      className="photoActionBtn change"
                      onClick={() => setShowPhotoSourceModal(true)}
                    >
                      <Camera size={13} /> Changer la photo
                    </button>
                    <button
                      type="button"
                      className="photoActionBtn delete"
                      onClick={handleRemovePhoto}
                    >
                      <Trash2 size={13} /> Supprimer la photo
                    </button>
                  </>
                ) : (
                  <button
                    type="button"
                    className="photoActionBtn add"
                    onClick={() => setShowPhotoSourceModal(true)}
                  >
                    <Camera size={13} /> Ajouter une photo
                  </button>
                )}
              </div>

              {photoError && (
                <div className="photoErrorBanner" style={{ marginTop: '8px' }}>
                  <AlertTriangle size={14} />
                  <span>{photoError}</span>
                </div>
              )}
            </div>

            <input
              autoFocus
              placeholder="اسم الشخص"
              value={personName}
              onChange={e => setPersonName(e.target.value)}
            />
            <input
              type="tel"
              placeholder="رقم الهاتف"
              value={personPhone}
              onChange={e => setPersonPhone(e.target.value)}
            />
            <input
              placeholder="الفئة"
              value={personCategory}
              onChange={e => setPersonCategory(e.target.value)}
            />
            <input
              placeholder="الشركة"
              value={personCompany}
              onChange={e => setPersonCompany(e.target.value)}
            />
            <textarea
              placeholder="Note — العنوان أو أي معلومة إضافية"
              value={personNote}
              onChange={e => setPersonNote(e.target.value)}
            />
            <div className="actions">
              <button type="button" onClick={closePersonModal} disabled={isUploadingPhoto}>
                إلغاء
              </button>
              <button className="primary" disabled={isUploadingPhoto}>
                {isUploadingPhoto
                  ? 'جاري حفظ الصورة...'
                  : editingPersonId !== null
                  ? 'حفظ التعديلات'
                  : 'حفظ'}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Add Transaction Modal */}
      {showTransaction && (
        <div className="overlay">
          <form className="modal" onSubmit={addTransaction}>
            <h3>إضافة عملية — {selectedPerson.name}</h3>
            <div className="tabs">
              <button
                type="button"
                className={tx.type === 'credit' ? 'selected' : ''}
                onClick={() => setTx({ ...tx, type: 'credit' })}
              >
                دين
              </button>
              <button
                type="button"
                className={tx.type === 'payment' ? 'selected' : ''}
                onClick={() => setTx({ ...tx, type: 'payment' })}
              >
                دفع
              </button>
            </div>
            <input
              type="number"
              step="0.001"
              min="0"
              placeholder="المبلغ (د.ت)"
              value={tx.amount}
              onChange={e => setTx({ ...tx, amount: e.target.value })}
            />
            <input
              placeholder="البضاعة — مثال: 50 كغ بطيخ"
              value={tx.goods}
              onChange={e => setTx({ ...tx, goods: e.target.value })}
            />
            <label className="fieldLabel">📅 تاريخ المعاملة</label>
            <input
              type="date"
              required
              value={tx.date}
              onChange={e => setTx({ ...tx, date: e.target.value })}
            />
            <textarea
              placeholder="Note — ملاحظة اختيارية"
              value={tx.note}
              onChange={e => setTx({ ...tx, note: e.target.value })}
            />
            <div className="actions">
              <button type="button" onClick={() => setShowTransaction(false)}>
                إلغاء
              </button>
              <button className="primary">حفظ العملية</button>
            </div>
          </form>
        </div>
      )}

      {/* Account Delete Confirmation Modal */}
      {showConfirmDeletePerson && personToDelete && (
        <ConfirmDeleteModal
          person={personToDelete}
          onConfirm={confirmDeletePerson}
          onCancel={cancelDeletePerson}
        />
      )}

      {/* One-time SQLite Database Migration Modal */}
      {showMigrationModal && (
        <MigrationPromptModal
          onConfirm={handleExecuteMigration}
          onCancel={handleCancelMigration}
          loading={migrationLoading}
          error={migrationError}
        />
      )}

      {/* Hidden inputs for Camera and Gallery photo pickers */}
      <input
        ref={cameraInputRef}
        type="file"
        accept="image/*"
        capture="environment"
        style={{ display: 'none' }}
        onChange={handlePhotoSelected}
      />
      <input
        ref={galleryInputRef}
        type="file"
        accept="image/jpeg,image/jpg,image/png,image/webp,image/*"
        style={{ display: 'none' }}
        onChange={handlePhotoSelected}
      />

      {/* Photo Source Selection Bottom Sheet */}
      {showPhotoSourceModal && (
        <div className="photoSourceOverlay" onClick={() => setShowPhotoSourceModal(false)}>
          <div className="photoSourceSheet" onClick={e => e.stopPropagation()}>
            <div className="photoSourceHeader">
              <h4>{personPhotoPreview ? 'Changer la photo' : 'Ajouter une photo'}</h4>
            </div>

            <div className="photoSourceOptions">
              <button
                type="button"
                className="photoSourceOption"
                onClick={() => {
                  setShowPhotoSourceModal(false);
                  if (cameraInputRef.current) {
                    cameraInputRef.current.click();
                  }
                }}
              >
                <span className="photoSourceIcon">📷</span>
                <div className="photoSourceText">
                  <b>Prendre une photo</b>
                  <small>Utiliser l'appareil photo</small>
                </div>
              </button>

              <button
                type="button"
                className="photoSourceOption"
                onClick={() => {
                  setShowPhotoSourceModal(false);
                  if (galleryInputRef.current) {
                    galleryInputRef.current.click();
                  }
                }}
              >
                <span className="photoSourceIcon">🖼️</span>
                <div className="photoSourceText">
                  <b>Choisir depuis la galerie</b>
                  <small>JPG, PNG, WebP depuis l'appareil</small>
                </div>
              </button>
            </div>

            <button
              type="button"
              className="photoSourceCancel"
              onClick={() => setShowPhotoSourceModal(false)}
            >
              Annuler
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function Root() {
  const [user, setUser] = useState(undefined);
  useEffect(() => onAuthStateChanged(auth, setUser), []);

  if (user === undefined) {
    return (
      <div className="loginScreen">
        <div className="loginCard">
          <h2>جاري التحميل...</h2>
        </div>
      </div>
    );
  }

  if (!user || !ALLOWED_EMAILS.includes(user.email?.toLowerCase())) {
    return <LoginScreen />;
  }

  return <App user={user} />;
}

createRoot(document.getElementById('root')).render(<Root />);
