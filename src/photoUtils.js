import { doc, deleteDoc, setDoc } from 'firebase/firestore';
import { db } from './firebase';

const MAX_INPUT_FILE_SIZE = 10 * 1024 * 1024; // 10MB source image
const FIRESTORE_PHOTO_MAX_BYTES = 180 * 1024; // keep each photo safely below the 1 MiB document limit
const FIRESTORE_WRITE_TIMEOUT_MS = 30 * 1000;

export function validateImageFile(file) {
  if (!file) {
    return { valid: false, error: 'Aucun fichier sélectionné.' };
  }

  const mime = String(file.type || '').toLowerCase();
  if (!mime.startsWith('image/')) {
    return {
      valid: false,
      error: 'Format non supporté. Veuillez sélectionner une image (JPG, PNG, WebP).'
    };
  }

  if (file.size > MAX_INPUT_FILE_SIZE) {
    return {
      valid: false,
      error: 'Image trop volumineuse. Veuillez choisir une image plus petite (max 10 Mo).'
    };
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

/**
 * Resizes/crops a profile image and compresses it as JPEG.
 * The target is intentionally compact because the final image is stored in
 * a dedicated Firestore document, not in Firebase Storage.
 */
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

          canvas.toBlob(
            blob => {
              if (!blob) return reject(new Error("Erreur lors de la compression de l'image."));
              if (blob.size > FIRESTORE_PHOTO_MAX_BYTES) {
                // Retry with a smaller avatar and lower JPEG quality rather than
                // creating a Firestore document that is unnecessarily large.
                canvas.toBlob(
                  smallerBlob => {
                    if (!smallerBlob || smallerBlob.size > FIRESTORE_PHOTO_MAX_BYTES) {
                      reject(new Error("La photo reste trop volumineuse après compression. Choisissez une autre image."));
                      return;
                    }
                    resolve({ blob: smallerBlob, previewUrl: URL.createObjectURL(smallerBlob) });
                  },
                  'image/jpeg',
                  0.62
                );
                return;
              }
              resolve({ blob, previewUrl: URL.createObjectURL(blob) });
            },
            'image/jpeg',
            quality
          );
        } catch (err) {
          reject(err);
        }
      };

      img.src = e.target.result;
    };

    reader.readAsDataURL(file);
  });
}

/**
 * Stores the processed avatar in a dedicated Firestore document:
 * /users/{uid}/profilePhotos/{personId}
 *
 * The returned downloadUrl name is kept for compatibility with the existing
 * UI, but it is now a data URL and never points to Firebase Storage.
 */
export async function uploadProfilePhotoToFirestore(userId, personId, blob, onProgress) {
  if (!userId) throw new Error('Utilisateur non identifié. Veuillez vous reconnecter.');
  if (!personId) throw new Error('Identifiant du compte manquant.');
  if (!(blob instanceof Blob) || blob.size <= 0) throw new Error('Image vide ou invalide.');
  if (blob.size > FIRESTORE_PHOTO_MAX_BYTES) {
    throw new Error('La photo est trop volumineuse après compression.');
  }

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
  onProgress?.(100);

  return { downloadUrl: dataUrl, storagePath: `firestore:users/${userId}/profilePhotos/${personId}` };
}

export async function deleteProfilePhotoFromFirestore(userId, personId) {
  if (!userId || !personId) return;
  const photoRef = doc(db, 'users', String(userId), 'profilePhotos', String(personId));
  try {
    await withTimeout(
      deleteDoc(photoRef),
      FIRESTORE_WRITE_TIMEOUT_MS,
      'La suppression de la photo dans Firestore a pris trop de temps.'
    );
  } catch (err) {
    console.warn('Could not delete Firestore profile image:', err?.code || err?.message || err);
  }
}

// Backward-compatible aliases for any code that still imports the old names.
export const uploadProfilePhotoToStorage = uploadProfilePhotoToFirestore;
export const deleteProfilePhotoFromStorage = deleteProfilePhotoFromFirestore;
