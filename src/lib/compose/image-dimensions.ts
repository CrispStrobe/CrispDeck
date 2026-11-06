export interface ImageDimensions { width: number; height: number }

/** Gallery records require real dimensions. Do not invent a square ratio. */
export async function readImageDimensions(file: File): Promise<ImageDimensions> {
  if (typeof createImageBitmap === 'function') {
    const bitmap = await createImageBitmap(file);
    try {
      if (bitmap.width > 0 && bitmap.height > 0) return { width: bitmap.width, height: bitmap.height };
      throw new Error(`Could not read the dimensions of ${file.name}.`);
    } finally { bitmap.close(); }
  }
  const url = URL.createObjectURL(file);
  return new Promise((resolve, reject) => {
    const image = new Image();
    const finish = (error?: Error) => {
      clearTimeout(timer);
      image.onload = image.onerror = null;
      URL.revokeObjectURL(url);
      if (error || !image.naturalWidth || !image.naturalHeight) reject(error ?? new Error(`Could not read the dimensions of ${file.name}.`));
      else resolve({ width: image.naturalWidth, height: image.naturalHeight });
    };
    const timer = setTimeout(() => finish(new Error(`Reading ${file.name} took too long. Reattach the image and try again.`)), 15_000);
    image.onload = () => finish();
    image.onerror = () => finish(new Error(`Could not read the dimensions of ${file.name}.`));
    image.src = url;
  });
}
