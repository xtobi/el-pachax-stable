import { ref, uploadBytes, getDownloadURL, deleteObject } from 'firebase/storage';
import { storage } from './firebase';

const MAX_INPUT_FILE_SIZE = 10 * 1024 * 1024; // 10MB

/**
 * Validates selected file is an image and within size limit.
 */
export function validateImageFile(file) {
  if (!file) {
    return { valid: false, error: 'Aucun fichier sélectionné.' };
  }

  const validTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'];
  if (!file.type.startsWith('image/') && !validTypes.includes(file.type.toLowerCase())) {
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
        reject(new Error('Impossible de charger le format de l\'image.'));
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

          // Center-crop to square
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
                return reject(new Error('Erreur lors de la compression de l\'image.'));
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
 * Uploads processed photo blob to Firebase Storage under user-isolated path.
 */
export async function uploadProfilePhotoToStorage(userId, personId, blob) {
  if (!userId) throw new Error('Utilisateur non identifié.');
  if (!personId) throw new Error('Identifiant du compte manquant.');

  const safePersonId = String(personId);
  const storagePath = `profilePhotos/${userId}/${safePersonId}_${Date.now()}.jpg`;
  const storageRef = ref(storage, storagePath);

  const metadata = {
    contentType: 'image/jpeg',
    customMetadata: {
      userId,
      personId: safePersonId,
      uploadedAt: new Date().toISOString()
    }
  };

  await uploadBytes(storageRef, blob, metadata);
  const downloadUrl = await getDownloadURL(storageRef);
  return { downloadUrl, storagePath };
}

/**
 * Attempts to safely remove a photo from Firebase Storage.
 */
export async function deleteProfilePhotoFromStorage(photoURL) {
  if (!photoURL || typeof photoURL !== 'string') return;
  
  // Only attempt deletion if it's a Firebase Storage URL or path
  try {
    if (photoURL.startsWith('http') && photoURL.includes('firebasestorage.googleapis.com')) {
      const storageRef = ref(storage, photoURL);
      await deleteObject(storageRef);
    } else if (photoURL.startsWith('profilePhotos/')) {
      const storageRef = ref(storage, photoURL);
      await deleteObject(storageRef);
    }
  } catch (err) {
    // Ignore if object doesn't exist or permission already revoked
    console.warn('Could not delete old storage image:', err?.message || err);
  }
}
