/**
 * Compresses an image file in the browser using HTML5 Canvas.
 * Ensures the output file size is strictly 300 KB or less.
 */
export async function compressPassportPhoto(
  file: File,
  maxSizeKB = 300
): Promise<{ base64: string; sizeKB: number; mimeType: string }> {
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

        canvas.width = width;
        canvas.height = height;

        const ctx = canvas.getContext('2d');
        if (!ctx) {
          return reject(new Error('Canvas 2D context is not available.'));
        }

        // Fill background with white in case of transparent PNGs
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, width, height);
        ctx.drawImage(img, 0, 0, width, height);

        // Progressively compress starting from 0.9 down to 0.4
        let quality = 0.9;
        let base64 = canvas.toDataURL('image/jpeg', quality);
        let sizeInBytes = Math.round((base64.length * 3) / 4);

        while (sizeInBytes > maxSizeKB * 1024 && quality > 0.3) {
          quality -= 0.1;
          base64 = canvas.toDataURL('image/jpeg', quality);
          sizeInBytes = Math.round((base64.length * 3) / 4);
        }

        // If still over maxSizeKB, attempt further dimension downscaling
        if (sizeInBytes > maxSizeKB * 1024) {
          canvas.width = Math.round(width * 0.7);
          canvas.height = Math.round(height * 0.7);
          ctx.fillStyle = '#ffffff';
          ctx.fillRect(0, 0, canvas.width, canvas.height);
          ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
          quality = 0.7;
          base64 = canvas.toDataURL('image/jpeg', quality);
          sizeInBytes = Math.round((base64.length * 3) / 4);
        }

        const finalSizeKB = Math.round(sizeInBytes / 1024);

        if (finalSizeKB > maxSizeKB) {
          return reject(
            new Error(
              `Unable to compress image below ${maxSizeKB} KB. Final size is ${finalSizeKB} KB. Please select a smaller photo.`
            )
          );
        }

        resolve({
          base64,
          sizeKB: finalSizeKB,
          mimeType: 'image/jpeg',
        });
      };
      img.src = reader.result as string;
    };
    reader.readAsDataURL(file);
  });
}
