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

  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Failed to read image file.'));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error('Failed to parse image data.'));
      img.onload = () => {
        const canvas = document.createElement('canvas');
        let width = img.width;
        let height = img.height;

        // Max dimensions for passport photo (e.g., max 1000px on largest side)
        const MAX_DIMENSION = 1000;
        if (width > MAX_DIMENSION || height > MAX_DIMENSION) {
          if (width > height) {
            height = Math.round((height * MAX_DIMENSION) / width);
            width = MAX_DIMENSION;
          } else {
            width = Math.round((width * MAX_DIMENSION) / height);
            height = MAX_DIMENSION;
          }
        }

        const ctx = canvas.getContext('2d');
        if (!ctx) {
          return reject(new Error('Canvas 2D context is not available.'));
        }

        const qualities = [0.9, 0.8, 0.7, 0.6, 0.5, 0.4, 0.3];
        while (width > 0 && height > 0) {
          canvas.width = width;
          canvas.height = height;
          ctx.fillStyle = '#ffffff';
          ctx.fillRect(0, 0, width, height);
          ctx.drawImage(img, 0, 0, width, height);

          for (const quality of qualities) {
            const base64 = canvas.toDataURL('image/jpeg', quality);
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

        reject(new Error(`Unable to compress image below ${maxSizeBytes} bytes. Please select a smaller photo.`));
      };
      img.src = reader.result as string;
    };
    reader.readAsDataURL(file);
  });
}
