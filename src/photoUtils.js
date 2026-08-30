import { ref, uploadBytes, getDownloadURL, deleteObject } from 'firebase/storage';
import { storage } from './firebase';

const MAX_INPUT_FILE_SIZE = 10 * 1024 * 1024; // 10MB
const UPLOAD_TIMEOUT_MS = 45 * 1000;
const DOWNLOAD_URL_TIMEOUT_MS = 20 * 1000;

/**
 * Validates selected file is an image and within size limit.
 */
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

/**
 * Resizes and crops image to a square avatar of targetDimension (default 512x512),
 * compressed as JPEG with high visual quality.
 */
export function processProfileImage(file, targetDimension = 512, quality = 0.85) {
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
 * Uploads the already-processed avatar with the simple Firebase Storage upload API.
 * For small 512x512 profile images this is more reliable than resumable uploads in
 * embedded WebViews and mobile browsers. A hard timeout prevents an infinite spinner.
 */
export async function uploadProfilePhotoToStorage(userId, personId, blob, onProgress) {
  if (!userId) throw new Error('Utilisateur non identifié. Veuillez vous reconnecter.');
  if (!personId) throw new Error('Identifiant du compte manquant.');
  if (!(blob instanceof Blob) || blob.size <= 0) throw new Error('Image vide ou invalide.');

  const safePersonId = String(personId);
  const storagePath = `profilePhotos/${userId}/${safePersonId}_${Date.now()}.jpg`;
  const storageRef = ref(storage, storagePath);
  const metadata = {
    contentType: 'image/jpeg',
    cacheControl: 'public,max-age=31536000',
    customMetadata: {
      userId: String(userId),
      personId: safePersonId,
      uploadedAt: new Date().toISOString()
    }
  };

  onProgress?.(0);

  const uploadPromise = uploadBytes(storageRef, blob, metadata);
  let uploadResult;
  try {
    uploadResult = await Promise.race([
      uploadPromise,
      new Promise((_, reject) =>
        setTimeout(
          () => reject(new Error('Le téléversement de la photo a pris trop de temps. Vérifiez votre connexion Internet et les autorisations Firebase Storage.')),
          UPLOAD_TIMEOUT_MS
        )
      )
    ]);
  } catch (error) {
    const code = error?.code || '';
    if (code === 'storage/unauthorized') {
      throw new Error("Vous n'avez pas l'autorisation d'enregistrer cette photo. Vérifiez les règles Firebase Storage.");
    }
    if (code === 'storage/unauthenticated') {
      throw new Error('Votre session Firebase a expiré. Reconnectez-vous puis réessayez.');
    }
    if (code === 'storage/retry-limit-exceeded') {
      throw new Error('Le réseau est instable. Le téléversement a été interrompu.');
    }
    if (code === 'storage/bucket-not-found') {
      throw new Error('Le stockage Firebase Storage est introuvable ou non configuré pour ce projet.');
    }
    if (code === 'storage/quota-exceeded') {
      throw new Error('Le quota Firebase Storage est dépassé.');
    }
    throw new Error(error?.message || 'Échec du téléversement de la photo.');
  }

  onProgress?.(90);

  try {
    const downloadUrl = await Promise.race([
      getDownloadURL(uploadResult.ref),
      new Promise((_, reject) =>
        setTimeout(
          () => reject(new Error('Impossible de récupérer le lien de la photo depuis Firebase Storage.')),
          DOWNLOAD_URL_TIMEOUT_MS
        )
      )
    ]);
    onProgress?.(100);
    return { downloadUrl, storagePath };
  } catch (error) {
    throw new Error(error?.message || 'Impossible de récupérer le lien de la photo.');
  }
}

/**
 * Attempts to safely remove a photo from Firebase Storage.
 */
export async function deleteProfilePhotoFromStorage(photoURL) {
  if (!photoURL || typeof photoURL !== 'string') return;

  try {
    const storageRef = photoURL.startsWith('profilePhotos/')
      ? ref(storage, photoURL)
      : ref(storage, photoURL);
    await deleteObject(storageRef);
  } catch (err) {
    console.warn('Could not delete old storage image:', err?.code || err?.message || err);
  }
}
