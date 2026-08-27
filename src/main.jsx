import React, { useEffect, useMemo, useState } from 'react';
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
  FileSignature
} from 'lucide-react';
import { auth, googleProvider } from './firebase';
import { saveLedger, subscribeToLedger } from './cloudSync';
import { uploadBackupToDrive } from './drive';
import { IMPORTED_PEOPLE } from './importedData';
import './styles.css';
import './accountEdit.css';
import './reference-ui.css';

const OWNER_EMAIL = 'huthelias39@gmail.com';
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
      if (Array.isArray(parsed) && parsed.length > 0) return parsed;
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

function LoginScreen() {
  const [error, setError] = useState('');
  async function login() {
    setError('');
    try {
      await signInWithPopup(auth, googleProvider);
    } catch (e) {
      setError(
        e?.code === 'auth/popup-blocked'
          ? 'المتصفح منع نافذة Google. اسمح بالنوافذ المنبثقة لهذا الموقع ثم حاول مرة أخرى.'
          : e?.code === 'auth/popup-closed-by-user'
          ? 'تم إغلاق نافذة Google قبل إكمال تسجيل الدخول.'
          : `تعذر تسجيل الدخول (${e?.code || 'unknown-error'}). تأكد من إعداد Google/Firebase ثم حاول مرة أخرى.`
      );
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
        <small>الحساب المسموح: {OWNER_EMAIL}</small>
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
  const [showExport, setShowExport] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showPersonActions, setShowPersonActions] = useState(false);
  const [showAccountPicker, setShowAccountPicker] = useState(false);
  const [pickerSearch, setPickerSearch] = useState('');
  const [editingPersonId, setEditingPersonId] = useState(null);
  const [editScreen, setEditScreen] = useState(false);

  // Settings state
  const [autoDriveBackup, setAutoDriveBackup] = useState(
    () => localStorage.getItem('el-pachax-auto-drive') === 'true'
  );
  const [syncing, setSyncing] = useState(false);
  const [driveStatus, setDriveStatus] = useState('');

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
      remote => {
        if (Array.isArray(remote) && remote.length > 0) {
          setPeople(remote);
          saveLocal(remote);
        }
      },
      err => {
        console.error('Firestore sync error:', err);
      }
    );
    return unsubscribe;
  }, [user]);

  const filteredPeople = useMemo(() => {
    return people.filter(p => {
      const q = (p.name || '').toLowerCase().includes(query.toLowerCase()) || (p.phone || '').includes(query);
      const b = balance(p);
      if (!q) return false;
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
        setDriveStatus('تم تحديث Google Drive ✓');
      }
    } catch (e) {
      setDriveStatus(e?.message || 'تعذر تحديث Google Drive');
    } finally {
      setSyncing(false);
    }
  }

  async function manualDriveExport() {
    try {
      setDriveStatus('جاري التصدير...');
      await uploadBackupToDrive(people);
      setDriveStatus('تم التصدير إلى Google Drive ✓');
    } catch (e) {
      setDriveStatus(e?.message || 'تعذر التصدير إلى Google Drive');
    }
  }

  function openAddPerson() {
    setEditingPersonId(null);
    setPersonName('');
    setPersonPhone('');
    setPersonNote('');
    setPersonCategory('Autres');
    setPersonCompany('Carnet de Dettes');
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
  }

  function savePerson(e) {
    e.preventDefault();
    if (!personName.trim()) return;
    if (editingPersonId !== null) {
      const next = people.map(p =>
        p.id === editingPersonId
          ? {
              ...p,
              name: personName.trim(),
              phone: personPhone.trim(),
              note: personNote.trim(),
              category: personCategory.trim() || 'Autres',
              company: personCompany.trim() || 'Carnet de Dettes'
            }
          : p
      );
      commit(next);
      setSelectedId(editingPersonId);
      closePersonModal();
      return;
    }
    const id = Date.now();
    const next = [
      ...people,
      {
        id,
        name: personName.trim(),
        phone: personPhone.trim(),
        note: personNote.trim(),
        category: personCategory.trim() || 'Autres',
        company: personCompany.trim() || 'Carnet de Dettes',
        transactions: []
      }
    ];
    commit(next);
    setSelectedId(id);
    closePersonModal();
  }

  function saveEditScreen(e) {
    e.preventDefault();
    if (editingPersonId === null) return;
    const next = people.map(p =>
      p.id === editingPersonId
        ? {
            ...p,
            name: personName.trim(),
            phone: personPhone.trim(),
            note: personNote.trim(),
            category: personCategory.trim() || 'Autres',
            company: personCompany.trim() || 'Carnet de Dettes'
          }
        : p
    );
    commit(next);
    setSelectedId(editingPersonId);
    setEditScreen(false);
    setEditingPersonId(null);
  }

  function deletePerson() {
    if (editingPersonId === null) return;
    const next = people.filter(p => p.id !== editingPersonId);
    commit(next);
    setEditScreen(false);
    setEditingPersonId(null);
    setSelectedId(next[0]?.id || null);
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
          <button className="editDelete" onClick={deletePerson}>
            <Trash2 size={19} />
          </button>
        </header>
        <form className="accountEditForm" onSubmit={saveEditScreen}>
          <div className="editAvatar">
            <UserRound size={62} />
            <button type="button" className="cameraButton">
              <Camera size={17} />
            </button>
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
          <button className="saveEditButton">Sauvegarder et quitter</button>
        </form>
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
    <div className="app">
      {/* Topbar */}
      <header className="topbar">
        <div className="brandSide">
          <button className="iconButton" onClick={() => setMobilePage('home')}>
            <Menu size={22} />
          </button>
          <div>
            <h1>Credit Debit</h1>
          </div>
        </div>
        <div className="topActions">
          <button className="iconButton">
            <Search size={20} />
          </button>
          <button className="iconButton">
            <Bell size={20} />
          </button>
          <button className="iconButton" onClick={() => setShowSettings(true)}>
            <MoreVertical size={20} />
          </button>
        </div>
      </header>

      <main>
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
              {filteredPeople.map(p => {
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
                    <div className="refAvatar">{initial}</div>
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
              })}
            </div>

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
              <div className="txIdentity">
                <div className="txPersonName">{selectedPerson.name}</div>
                {selectedPerson.phone && <div className="txPhone">{selectedPerson.phone}</div>}
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
                <UserRound size={24} />
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
            <button onClick={() => openEditPerson(selectedPerson)}>
              <Pencil size={17} /> Modifier un compte
            </button>
            <button
              className="dangerAction"
              onClick={() => {
                setShowPersonActions(false);
                setEditingPersonId(selectedPerson.id);
                setEditScreen(true);
              }}
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
            <div className="actions">
              <button type="button" onClick={() => setShowSettings(false)}>
                إغلاق
              </button>
              <button
                type="button"
                className="secondary"
                onClick={() => {
                  setShowSettings(false);
                  setShowExport(true);
                }}
              >
                <Download size={16} /> تصدير
              </button>
              <button
                type="button"
                className="secondary"
                onClick={() => signOut(auth)}
              >
                <LogOut size={16} /> تسجيل الخروج
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Export Modal */}
      {showExport && (
        <div className="overlay" onClick={() => setShowExport(false)}>
          <div className="modal exportModal" onClick={e => e.stopPropagation()}>
            <h3>تصدير البيانات</h3>
            <p className="modalHint">اختر طريقة التصدير التي تريدها.</p>
            <button className="exportOption" onClick={() => exportLocal(people)}>
              <span className="exportIcon local">
                <HardDrive />
              </span>
              <span>
                <b>Export to Local</b>
                <small>حفظ نسخة احتياطية على هذا الجهاز</small>
              </span>
            </button>
            <button className="exportOption" onClick={manualDriveExport}>
              <span className="exportIcon cloud">
                <Cloud />
              </span>
              <span>
                <b>Export to Google Drive</b>
                <small>حفظ أو تحديث نسخة واحدة في Google Drive</small>
              </span>
            </button>
            {driveStatus && <div className="syncStatus">☁️ {driveStatus}</div>}
            <div className="actions">
              <button onClick={() => setShowExport(false)}>إغلاق</button>
            </div>
          </div>
        </div>
      )}

      {/* Add / Edit Person Modal */}
      {showPerson && (
        <div className="overlay">
          <form className="modal" onSubmit={savePerson}>
            <h3>{editingPersonId !== null ? 'تعديل معلومات الشخص' : 'إضافة شخص'}</h3>
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
              <button type="button" onClick={closePersonModal}>
                إلغاء
              </button>
              <button className="primary">
                {editingPersonId !== null ? 'حفظ التعديلات' : 'حفظ'}
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

  if (!user || user.email?.toLowerCase() !== OWNER_EMAIL) {
    return <LoginScreen />;
  }

  return <App user={user} />;
}

createRoot(document.getElementById('root')).render(<Root />);
