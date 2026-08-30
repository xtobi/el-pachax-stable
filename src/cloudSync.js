import { doc, getDoc, onSnapshot, setDoc } from 'firebase/firestore';
import { db } from './firebase';
import { IMPORTED_PEOPLE } from './importedData';

const IMPORT_VERSION = 'carnetdedettes-2026-08-27-v2';

export function subscribeToLedger(user, onData, onError) {
  if (!user?.uid) return () => {};
  const ref = doc(db, 'users', user.uid);
  let unsubscribe = () => {};
  let cancelled = false;

  const start = async () => {
    try {
      const snapshot = await getDoc(ref);
      const data = snapshot.exists() ? snapshot.data() : {};
      if (data.importVersion !== IMPORT_VERSION) {
        await setDoc(ref, {
          people: IMPORTED_PEOPLE,
          importVersion: IMPORT_VERSION,
          importedAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        }, { merge: true });
      }
      if (cancelled) return;
      unsubscribe = onSnapshot(ref, nextSnapshot => {
        if (nextSnapshot.exists() && Array.isArray(nextSnapshot.data().people)) {
          onData(nextSnapshot.data().people);
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

export async function saveLedger(user, people) {
  if (!user?.uid) return;
  await setDoc(doc(db, 'users', user.uid), {
    people,
    importVersion: IMPORT_VERSION,
    updatedAt: new Date().toISOString()
  }, { merge: true });
}
