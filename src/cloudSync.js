import {
  collection,
  deleteDoc,
  doc,
  getDocs,
  getDoc,
  onSnapshot,
  setDoc
} from 'firebase/firestore';
import { db } from './firebase';

export const MIGRATION_VERSION = 'carnetdedettes-2026-08-29-v3-15p-66t';
const FIRESTORE_WRITE_TIMEOUT_MS = 30 * 1000;

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

function stripPhotoFields(people) {
  return (Array.isArray(people) ? people : []).map(person => {
    const clean = { ...person };
    delete clean.photoURL;
    delete clean.photoData;
    return clean;
  });
}

function mergeProfilePhotos(people, photoMap) {
  return (Array.isArray(people) ? people : []).map(person => {
    const photo = photoMap.get(String(person.id));
    if (photo?.dataUrl) return { ...person, photoURL: photo.dataUrl };
    const clean = { ...person };
    delete clean.photoURL;
    delete clean.photoData;
    return clean;
  });
}

export async function syncProfilePhotosToFirestore(user, people) {
  if (!user?.uid) return;
  const photosRef = collection(db, 'users', user.uid, 'profilePhotos');
  const targetPeople = Array.isArray(people) ? people : [];
  const desired = new Map();

  for (const person of targetPeople) {
    const dataUrl = person?.photoURL || person?.photoData;
    if (typeof dataUrl === 'string' && dataUrl.startsWith('data:image/')) {
      desired.set(String(person.id), dataUrl);
    }
  }

  const existingSnapshot = await withTimeout(
    getDocs(photosRef),
    FIRESTORE_WRITE_TIMEOUT_MS,
    'La lecture des photos Firestore a pris trop de temps.'
  );

  const writes = [];
  existingSnapshot.forEach(photoDoc => {
    if (!desired.has(photoDoc.id)) {
      writes.push(deleteDoc(photoDoc.ref));
    }
  });

  for (const [personId, dataUrl] of desired.entries()) {
    writes.push(
      setDoc(doc(photosRef, personId), {
        personId,
        dataUrl,
        contentType: 'image/jpeg',
        updatedAt: new Date().toISOString()
      })
    );
  }

  await withTimeout(
    Promise.all(writes),
    FIRESTORE_WRITE_TIMEOUT_MS,
    'La synchronisation des photos Firestore a pris trop de temps.'
  );
}

export function subscribeToLedger(user, onData, onError, onMigrationStatus) {
  if (!user?.uid) return () => {};
  const ref = doc(db, 'users', user.uid);
  const photosRef = collection(db, 'users', user.uid, 'profilePhotos');
  let unsubscribeLedger = () => {};
  let unsubscribePhotos = () => {};
  let cancelled = false;
  let latestPeople = [];
  let photoMap = new Map();

  const emit = () => {
    if (!cancelled) onData(mergeProfilePhotos(latestPeople, photoMap));
  };

  const start = async () => {
    try {
      const snapshot = await getDoc(ref);
      const data = snapshot.exists() ? snapshot.data() : {};
      latestPeople = Array.isArray(data.people) ? data.people : [];
      const isCompleted = data.migrationCompleted === true && data.importVersion === MIGRATION_VERSION;
      if (onMigrationStatus) {
        onMigrationStatus({
          migrationCompleted: isCompleted,
          currentVersion: data.importVersion || null,
          hasExistingData: snapshot.exists() && latestPeople.length > 0
        });
      }
      if (cancelled) return;

      unsubscribeLedger = onSnapshot(ref, nextSnapshot => {
        if (nextSnapshot.exists() && Array.isArray(nextSnapshot.data().people)) {
          latestPeople = nextSnapshot.data().people;
          emit();
        }
      }, onError);

      unsubscribePhotos = onSnapshot(photosRef, nextSnapshot => {
        const nextMap = new Map();
        nextSnapshot.forEach(photoDoc => {
          const photo = photoDoc.data();
          if (photo?.dataUrl) nextMap.set(photoDoc.id, photo);
        });
        photoMap = nextMap;
        emit();
      }, onError);

      emit();
    } catch (error) {
      if (!cancelled) onError?.(error);
    }
  };

  start();
  return () => {
    cancelled = true;
    unsubscribeLedger();
    unsubscribePhotos();
  };
}

export async function executeMigrationToFirestore(user, people) {
  if (!user?.uid) throw new Error('Utilisateur non connecté');
  const ref = doc(db, 'users', user.uid);
  const payload = sanitizeFirestoreData({
    people: stripPhotoFields(people),
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
  await syncProfilePhotosToFirestore(user, people);
}

export async function saveLedger(user, people) {
  if (!user?.uid) return;
  const payload = sanitizeFirestoreData({
    people: stripPhotoFields(people),
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
