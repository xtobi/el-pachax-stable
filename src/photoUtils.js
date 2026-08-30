import { ref, uploadBytesResumable, getDownloadURL, deleteObject } from 'firebase/storage';
import { storage } from './firebase';

const MAX_INPUT_FILE_SIZE = 10 * 1024 * 1024; // 10MB
const UPLOAD_TIMEOUT_MS = 60 * 1000;
const DOWNLOAD_URL_TIMEOUT_MS = 20 * 1000;

/**
 * Validates selected file is an image and within size limit.
 */
export function validateImageFile(file) {
  if (!file) {
    return { valid: false, error: 'Aucun fichier sélectionné.' };
  }

  const validTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'];
  const mime = String(file.type || '').toLowerCase();
  if (!mime.startsWith('image/') && !validTypes.includes(mime)) {
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

/**
 * Resizes and crops image to a square avatar of targetDimension (default 512x512),
 * compressed as JPEG with high visual quality.
 */
export function processProfileImage(file, targetDimension = 512, quality = 0.85) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();

    reader.onerror = () => {
      reject(new Error('Erreur lors de la lecture du fichier image.'));
    };

    reader.onload = e => {
      const img = new Image();

      img.onerror = () => {
        reject(new Error("Impossible de charger le format de l'image."));
      };

      img.onload = () => {
        try {
          const canvas = document.createElement('canvas');
          canvas.width = targetDimension;
          canvas.height = targetDimension;
          const ctx = canvas.getContext('2d');

          if (!ctx) {
            return reject(new Error('Canvas context not available.'));
          }

          const minEdge = Math.min(img.width, img.height);
          const sx = (img.width - minEdge) / 2;
          const sy = (img.height - minEdge) / 2;

          ctx.imageSmoothingEnabled = true;
          ctx.imageSmoothingQuality = 'high';
          ctx.drawImage(
            img,
            sx,
            sy,
            minEdge,
            minEdge,
            0,
            0,
            targetDimension,
            targetDimension
          );

          canvas.toBlob(
            blob => {
              if (!blob) {
                return reject(new Error("Erreur lors de la compression de l'image."));
              }
              const previewUrl = URL.createObjectURL(blob);
              resolve({ blob, previewUrl });
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
 * Uploads a processed photo to Firebase Storage with progress reporting and
 * a hard timeout so a stalled WebView/network request cannot leave the UI stuck forever.
 */
export async function uploadProfilePhotoToStorage(userId, personId, blob, onProgress) {
  if (!userId) throw new Error('Utilisateur non identifié.');
  if (!personId) throw new Error('Identifiant du compte manquant.');
  if (!(blob instanceof Blob) || blob.size <= 0) throw new Error('Image vide ou invalide.');

  const safePersonId = String(personId);
  const storagePath = `profilePhotos/${userId}/${safePersonId}_${Date.now()}.jpg`;
  const storageRef = ref(storage, storagePath);
  const metadata = {
    contentType: 'image/jpeg',
    cacheControl: 'public,max-age=31536000',
    customMetadata: {
      userId,
      personId: safePersonId,
      uploadedAt: new Date().toISOString()
    }
  };

  return new Promise((resolve, reject) => {
    const uploadTask = uploadBytesResumable(storageRef, blob, metadata);
    let settled = false;

    const finish = (fn, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeoutId);
      fn(value);
    };

    const timeoutId = setTimeout(() => {
      try { uploadTask.cancel(); } catch {}
      finish(reject, new Error('Le téléversement de la photo a pris trop de temps. Vérifiez votre connexion Internet puis réessayez.'));
    }, UPLOAD_TIMEOUT_MS);

    uploadTask.on(
      'state_changed',
      snapshot => {
        const progress = snapshot.totalBytes > 0
          ? Math.round((snapshot.bytesTransferred / snapshot.totalBytes) * 100)
          : 0;
        onProgress?.(progress);
      },
      error => {
        let message = 'Échec du téléversement de la photo.';
        if (error?.code === 'storage/unauthorized') {
          message = "Vous n'avez pas l'autorisation d'enregistrer cette photo.";
        } else if (error?.code === 'storage/canceled') {
          message = 'Le téléversement de la photo a été annulé.';
        } else if (error?.code === 'storage/retry-limit-exceeded') {
          message = 'Le réseau est instable. Le téléversement a été interrompu.';
        } else if (error?.message) {
          message = `Échec du téléversement de la photo : ${error.message}`;
        }
        finish(reject, new Error(message));
      },
      async () => {
        try {
          const downloadUrl = await Promise.race([
            getDownloadURL(storageRef),
            new Promise((_, rejectUrl) =>
              setTimeout(() => rejectUrl(new Error('Impossible de récupérer le lien de la photo.')), DOWNLOAD_URL_TIMEOUT_MS)
            )
          ]);
          onProgress?.(100);
          finish(resolve, { downloadUrl, storagePath });
        } catch (error) {
          finish(reject, error instanceof Error ? error : new Error('Impossible de récupérer le lien de la photo.'));
        }
      }
    );
  });
}

/**
 * Attempts to safely remove a photo from Firebase Storage.
 */
export async function deleteProfilePhotoFromStorage(photoURL) {
  if (!photoURL || typeof photoURL !== 'string') return;

  try {
    if (photoURL.startsWith('http') && photoURL.includes('firebasestorage.googleapis.com')) {
      const storageRef = ref(storage, photoURL);
      await deleteObject(storageRef);
    } else if (photoURL.startsWith('profilePhotos/')) {
      const storageRef = ref(storage, photoURL);
      await deleteObject(storageRef);
    }
  } catch (err) {
    console.warn('Could not delete old storage image:', err?.message || err);
  }
}
