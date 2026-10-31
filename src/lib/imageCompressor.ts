import {
  base64DataUrlByteLength,
  MAX_APPLICATION_PHOTO_BYTES,
} from '../../application-photo-storage';

/**
 * Compresses an image file in the browser using HTML5 Canvas.
 * Ensures the output file size is strictly 300 KB or less.
 */
export async function compressPassportPhoto(
  file: File,
  maxSizeBytes = MAX_APPLICATION_PHOTO_BYTES,
): Promise<{ base64: string; sizeBytes: number; sizeKB: number; mimeType: string }> {
  const allowedMimeTypes = ['image/jpeg', 'image/png', 'image/webp'];
  if (!allowedMimeTypes.includes(file.type)) {
    throw new Error('Unsupported image format. Please upload JPEG, PNG, or WebP.');
  }
  if (file.size === 0) throw new Error('The selected photo is empty. Please choose another image.');

  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Failed to read the selected photo. Please choose it again.'));
    reader.onload = () => {
      if (typeof reader.result !== 'string') {
        reject(new Error('Failed to read the selected photo. Please choose it again.'));
        return;
      }
      const originalSizeBytes = base64DataUrlByteLength(reader.result);
      if (originalSizeBytes === null) {
        reject(new Error('The selected photo could not be decoded. Please choose another image.'));
        return;
      }
      if (originalSizeBytes <= maxSizeBytes) {
        const image = new Image();
        image.onerror = () => reject(new Error('The selected photo is not a valid image. Please choose another file.'));
        image.onload = () => {
          if (!image.naturalWidth || !image.naturalHeight) {
            reject(new Error('The selected photo has invalid dimensions. Please choose another image.'));
            return;
          }
          resolve({
            base64: reader.result as string,
            sizeBytes: originalSizeBytes,
            sizeKB: Math.ceil(originalSizeBytes / 1024 * 10) / 10,
            mimeType: file.type,
          });
        };
        image.src = reader.result;
        return;
      }

      const img = new Image();
      img.onerror = () => reject(new Error('The selected photo is not a valid image. Please choose another file.'));
      img.onload = () => {
        try {
          if (!img.naturalWidth || !img.naturalHeight) {
            reject(new Error('The selected photo has invalid dimensions. Please choose another image.'));
            return;
          }

          const MAX_DIMENSION = 1000;
          const initialScale = Math.min(1, MAX_DIMENSION / Math.max(img.naturalWidth, img.naturalHeight));
          let width = Math.max(1, Math.round(img.naturalWidth * initialScale));
          let height = Math.max(1, Math.round(img.naturalHeight * initialScale));
          const canvas = document.createElement('canvas');
          canvas.width = width;
          canvas.height = height;
          const ctx = canvas.getContext('2d');
          if (!ctx) {
            reject(new Error('Photo processing is unavailable in this browser.'));
            return;
          }

          const qualities = [0.9, 0.8, 0.7, 0.6, 0.5, 0.4, 0.3];
          while (true) {
            canvas.width = width;
            canvas.height = height;
            ctx.fillStyle = '#ffffff';
            ctx.fillRect(0, 0, width, height);
            ctx.drawImage(img, 0, 0, width, height);

            for (const quality of qualities) {
              const base64 = canvas.toDataURL('image/jpeg', quality);
              if (!base64.startsWith('data:image/jpeg;base64,')) continue;
              const sizeBytes = base64DataUrlByteLength(base64);
              if (sizeBytes !== null && sizeBytes <= maxSizeBytes) {
                resolve({
                  base64,
                  sizeBytes,
                  sizeKB: Math.ceil(sizeBytes / 1024 * 10) / 10,
                  mimeType: 'image/jpeg',
                });
                return;
              }
            }

            if (width === 1 && height === 1) break;
            width = Math.max(1, Math.floor(width * 0.7));
            height = Math.max(1, Math.floor(height * 0.7));
          }

          reject(new Error(`Unable to compress this photo below ${Math.floor(maxSizeBytes / 1024)} KB. Please choose a simpler image.`));
        } catch {
          reject(new Error('The selected photo could not be processed. Please choose another image.'));
        }
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}
