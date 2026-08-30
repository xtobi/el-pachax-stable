import { doc, getDoc, onSnapshot, setDoc } from 'firebase/firestore';
import { db } from './firebase';

export const MIGRATION_VERSION = 'carnetdedettes-2026-08-29-v3-15p-66t';
const FIRESTORE_WRITE_TIMEOUT_MS = 30 * 1000;

/**
 * Recursively cleans and removes all keys with `undefined` values from objects
 * and arrays before writing to Firestore.
 * Preserves valid null, false, 0, "", non-empty strings, numbers, etc.
 */
export function sanitizeFirestoreData(data) {
  if (data === undefined) return undefined;
  if (data === null || typeof data !== 'object') return data;
  if (Array.isArray(data)) {
    return data.map(item => sanitizeFirestoreData(item)).filter(item => item !== undefined);
  }
  const clean = {};
  for (const [key, value] of Object.entries(data)) {
    if (value !== undefined) {
      const sanitized = sanitizeFirestoreData(value);
      if (sanitized !== undefined) clean[key] = sanitized;
    }
  }
  return clean;
}

function withTimeout(promise, timeoutMs, message) {
  let timeoutId;
  const timeout = new Promise((_, reject) => {
    timeoutId = setTimeout(() => reject(new Error(message)), timeoutMs);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timeoutId));
}

export function subscribeToLedger(user, onData, onError, onMigrationStatus) {
  if (!user?.uid) return () => {};
  const ref = doc(db, 'users', user.uid);
  let unsubscribe = () => {};
  let cancelled = false;

  const start = async () => {
    try {
      const snapshot = await getDoc(ref);
      const data = snapshot.exists() ? snapshot.data() : {};
      const isCompleted = data.migrationCompleted === true && data.importVersion === MIGRATION_VERSION;
      if (onMigrationStatus) {
        onMigrationStatus({
          migrationCompleted: isCompleted,
          currentVersion: data.importVersion || null,
          hasExistingData: snapshot.exists() && Array.isArray(data.people) && data.people.length > 0
        });
      }
      if (cancelled) return;
      unsubscribe = onSnapshot(ref, nextSnapshot => {
        if (nextSnapshot.exists() && Array.isArray(nextSnapshot.data().people)) {
          onData(nextSnapshot.data().people, nextSnapshot.data());
        }
      }, onError);
    } catch (error) {
      if (!cancelled) onError?.(error);
    }
  };

  start();
  return () => {
    cancelled = true;
    unsubscribe();
  };
}

export async function executeMigrationToFirestore(user, people) {
  if (!user?.uid) throw new Error('Utilisateur non connecté');
  const ref = doc(db, 'users', user.uid);
  const payload = sanitizeFirestoreData({
    people,
    importVersion: MIGRATION_VERSION,
    migrationCompleted: true,
    importedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    sourceFile: 'carnetdedettes 29-août-2026.db',
    totalAccounts: people.length,
    totalTransactions: people.reduce((acc, p) => acc + (p.transactions?.length || 0), 0)
  });
  await withTimeout(
    setDoc(ref, payload),
    FIRESTORE_WRITE_TIMEOUT_MS,
    'La synchronisation Firestore a pris trop de temps. Vérifiez votre connexion Internet puis réessayez.'
  );
}

export async function saveLedger(user, people) {
  if (!user?.uid) return;
  const payload = sanitizeFirestoreData({
    people,
    importVersion: MIGRATION_VERSION,
    migrationCompleted: true,
    updatedAt: new Date().toISOString()
  });
  await withTimeout(
    setDoc(doc(db, 'users', user.uid), payload, { merge: true }),
    FIRESTORE_WRITE_TIMEOUT_MS,
    'La synchronisation Firestore a pris trop de temps. Vérifiez votre connexion Internet puis réessayez.'
  );
}
