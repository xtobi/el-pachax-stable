import { doc, getDoc, onSnapshot, setDoc } from 'firebase/firestore';
import { db } from './firebase';

export const MIGRATION_VERSION = 'carnetdedettes-2026-08-29-v3-15p-66t';

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
  await setDoc(ref, {
    people,
    importVersion: MIGRATION_VERSION,
    migrationCompleted: true,
    importedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    sourceFile: 'carnetdedettes 29-août-2026.db',
    totalAccounts: people.length,
    totalTransactions: people.reduce((acc, p) => acc + (p.transactions?.length || 0), 0)
  });
}

export async function saveLedger(user, people) {
  if (!user?.uid) return;
  await setDoc(doc(db, 'users', user.uid), {
    people,
    importVersion: MIGRATION_VERSION,
    migrationCompleted: true,
    updatedAt: new Date().toISOString()
  }, { merge: true });
}
