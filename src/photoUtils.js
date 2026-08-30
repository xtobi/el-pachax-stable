import { collection, deleteDoc, doc, getDocs, setDoc } from 'firebase/firestore';
import { auth, db } from './firebase';

const MAX_INPUT_FILE_SIZE = 10 * 1024 * 1024;
const FIRESTORE_PHOTO_MAX_BYTES = 180 * 1024;
const FIRESTORE_WRITE_TIMEOUT_MS = 30 * 1000;
const PHOTO_SYNC_CACHE_KEY = 'el-pachax-photo-sync-signatures';

export function validateImageFile(file) {
  if (!file) return { valid: false, error: 'Aucun fichier sélectionné.' };
  const mime = String(file.type || '').toLowerCase();
  if (!mime.startsWith('image/')) {
    return { valid: false, error: 'Format non supporté. Veuillez sélectionner une image (JPG, PNG, WebP).' };
  }
  if (file.size > MAX_INPUT_FILE_SIZE) {
    return { valid: false, error: 'Image trop volumineuse. Veuillez choisir une image plus petite (max 10 Mo).' };
  }
  return { valid: true };
}

function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Erreur lors de la préparation de l'image."));
    reader.onload = () => resolve(String(reader.result || ''));
    reader.readAsDataURL(blob);
  });
}

function withTimeout(promise, timeoutMs, message) {
  let timeoutId;
  const timeout = new Promise((_, reject) => {
    timeoutId = setTimeout(() => reject(new Error(message)), timeoutMs);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timeoutId));
}

function clearPhotoCache(personId) {
  try {
    const cache = JSON.parse(localStorage.getItem(PHOTO_SYNC_CACHE_KEY) || '{}');
    delete cache[String(personId)];
    localStorage.setItem(PHOTO_SYNC_CACHE_KEY, JSON.stringify(cache));
  } catch {}
}

function clearPhotoCacheByDataUrl(dataUrl) {
  if (typeof dataUrl !== 'string') return;
  try {
    const cache = JSON.parse(localStorage.getItem(PHOTO_SYNC_CACHE_KEY) || '{}');
    const signature = `${dataUrl.length}:${dataUrl.slice(0, 80)}:${dataUrl.slice(-80)}`;
    for (const [personId, value] of Object.entries(cache)) {
      if (value === signature) delete cache[personId];
    }
    localStorage.setItem(PHOTO_SYNC_CACHE_KEY, JSON.stringify(cache));
  } catch {}
}

export function processProfileImage(file, targetDimension = 384, quality = 0.78) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Erreur lors de la lecture du fichier image.'));
    reader.onload = e => {
      const img = new Image();
      img.onerror = () => reject(new Error("Impossible de charger le format de l'image."));
      img.onload = () => {
        try {
          const canvas = document.createElement('canvas');
          canvas.width = targetDimension;
          canvas.height = targetDimension;
          const ctx = canvas.getContext('2d');
          if (!ctx) return reject(new Error('Canvas context not available.'));

          const minEdge = Math.min(img.width, img.height);
          const sx = (img.width - minEdge) / 2;
          const sy = (img.height - minEdge) / 2;
          ctx.imageSmoothingEnabled = true;
          ctx.imageSmoothingQuality = 'high';
          ctx.drawImage(img, sx, sy, minEdge, minEdge, 0, 0, targetDimension, targetDimension);

          const finish = (blob, previewUrl) => {
            if (!blob || blob.size > FIRESTORE_PHOTO_MAX_BYTES) {
              reject(new Error("La photo reste trop volumineuse après compression. Choisissez une autre image."));
              return;
            }
            resolve({ blob, previewUrl });
          };

          canvas.toBlob(blob => {
            if (blob && blob.size <= FIRESTORE_PHOTO_MAX_BYTES) {
              finish(blob, URL.createObjectURL(blob));
              return;
            }
            canvas.toBlob(
              smallerBlob => finish(smallerBlob, smallerBlob ? URL.createObjectURL(smallerBlob) : null),
              'image/jpeg',
              0.62
            );
          }, 'image/jpeg', quality);
        } catch (err) {
          reject(err);
        }
      };
      img.src = e.target.result;
    };
    reader.readAsDataURL(file);
  });
}

export async function uploadProfilePhotoToFirestore(userId, personId, blob, onProgress) {
  if (!userId) throw new Error('Utilisateur non identifié. Veuillez vous reconnecter.');
  if (!personId) throw new Error('Identifiant du compte manquant.');
  if (!(blob instanceof Blob) || blob.size <= 0) throw new Error('Image vide ou invalide.');
  if (blob.size > FIRESTORE_PHOTO_MAX_BYTES) throw new Error('La photo est trop volumineuse après compression.');

  onProgress?.(10);
  const dataUrl = await blobToDataUrl(blob);
  if (!dataUrl || dataUrl.length > 250000) {
    throw new Error('La photo compressée est trop volumineuse pour Firestore.');
  }

  onProgress?.(40);
  const photoRef = doc(db, 'users', String(userId), 'profilePhotos', String(personId));
  await withTimeout(
    setDoc(photoRef, {
      personId: String(personId),
      dataUrl,
      contentType: 'image/jpeg',
      byteSize: blob.size,
      updatedAt: new Date().toISOString()
    }),
    FIRESTORE_WRITE_TIMEOUT_MS,
    'La sauvegarde de la photo dans Firestore a pris trop de temps. Vérifiez votre connexion Internet.'
  );
  clearPhotoCache(personId);
  onProgress?.(100);
  return { downloadUrl: dataUrl, storagePath: `firestore:users/${userId}/profilePhotos/${personId}` };
}

export async function deleteProfilePhotoFromFirestore(userId, personId) {
  if (userId && personId) {
    const photoRef = doc(db, 'users', String(userId), 'profilePhotos', String(personId));
    try {
      await withTimeout(
        deleteDoc(photoRef),
        FIRESTORE_WRITE_TIMEOUT_MS,
        'La suppression de la photo dans Firestore a pris trop de temps.'
      );
      clearPhotoCache(personId);
    } catch (err) {
      console.warn('Could not delete Firestore profile image:', err?.code || err?.message || err);
    }
    return;
  }

  const photoDataUrl = userId;
  const uid = auth.currentUser?.uid;
  if (!uid || typeof photoDataUrl !== 'string') return;

  try {
    const photosSnapshot = await withTimeout(
      getDocs(collection(db, 'users', uid, 'profilePhotos')),
      FIRESTORE_WRITE_TIMEOUT_MS,
      'La recherche de la photo à supprimer a pris trop de temps.'
    );
    const matching = photosSnapshot.docs.find(d => d.data()?.dataUrl === photoDataUrl);
    if (matching) {
      await withTimeout(
        deleteDoc(matching.ref),
        FIRESTORE_WRITE_TIMEOUT_MS,
        'La suppression de la photo dans Firestore a pris trop de temps.'
      );
      clearPhotoCache(matching.id);
    } else {
      clearPhotoCacheByDataUrl(photoDataUrl);
    }
  } catch (err) {
    console.warn('Could not delete Firestore profile image:', err?.code || err?.message || err);
  }
}

export const uploadProfilePhotoToStorage = uploadProfilePhotoToFirestore;
export const deleteProfilePhotoFromStorage = deleteProfilePhotoFromFirestore;
