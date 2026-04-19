export const INLINE_IMAGE_ACCEPT = 'image/png,image/jpeg,image/jpg,image/webp';
export const MAX_INLINE_IMAGE_BYTES = 2 * 1024 * 1024;

const MAX_SOURCE_IMAGE_BYTES = 12 * 1024 * 1024;
const DEFAULT_MAX_DIMENSION = 1600;
const ALLOWED_INLINE_IMAGE_MIME_TYPES = new Set(['image/jpeg', 'image/png', 'image/jpg', 'image/webp']);

const loadImageFromFile = (file) => new Promise((resolve, reject) => {
  const objectUrl = URL.createObjectURL(file);
  const image = new Image();

  image.onload = () => {
    URL.revokeObjectURL(objectUrl);
    resolve(image);
  };

  image.onerror = () => {
    URL.revokeObjectURL(objectUrl);
    reject(new Error('Unable to read image.'));
  };

  image.src = objectUrl;
});

const canvasToBlob = (canvas, mimeType, quality) => new Promise((resolve, reject) => {
  canvas.toBlob((blob) => {
    if (!blob) {
      reject(new Error('Image compression failed.'));
      return;
    }
    resolve(blob);
  }, mimeType, quality);
});

const blobToDataUrl = (blob) => new Promise((resolve, reject) => {
  const reader = new FileReader();
  reader.onload = () => resolve(String(reader.result || ''));
  reader.onerror = () => reject(new Error('Unable to read image.'));
  reader.readAsDataURL(blob);
});

const fileToDataUrl = (file) => new Promise((resolve, reject) => {
  const reader = new FileReader();
  reader.onload = () => resolve(String(reader.result || ''));
  reader.onerror = () => reject(new Error('Unable to read image.'));
  reader.readAsDataURL(file);
});

export const getInlineImageFileError = (file) => {
  const mimeType = String(file?.type || '').toLowerCase();
  if (!ALLOWED_INLINE_IMAGE_MIME_TYPES.has(mimeType)) {
    return 'Only JPG, JPEG, PNG, and WEBP images are allowed.';
  }

  if (Number(file?.size || 0) > MAX_SOURCE_IMAGE_BYTES) {
    return 'Please choose an image smaller than 12 MB.';
  }

  return '';
};

export const fileToInlineImageDataUrl = async (file, {
  maxBytes = MAX_INLINE_IMAGE_BYTES,
  maxDimension = DEFAULT_MAX_DIMENSION,
} = {}) => {
  const fileError = getInlineImageFileError(file);
  if (fileError) {
    throw new Error(fileError);
  }

  if (Number(file?.size || 0) <= maxBytes) {
    return fileToDataUrl(file);
  }

  const image = await loadImageFromFile(file);
  const scale = Math.min(1, maxDimension / Math.max(image.width, image.height));
  let width = Math.max(1, Math.round(image.width * scale));
  let height = Math.max(1, Math.round(image.height * scale));

  const canvas = document.createElement('canvas');
  const context = canvas.getContext('2d');
  if (!context) {
    return fileToDataUrl(file);
  }

  let smallestBlob = null;

  for (let pass = 0; pass < 5; pass += 1) {
    canvas.width = width;
    canvas.height = height;
    context.clearRect(0, 0, width, height);
    context.drawImage(image, 0, 0, width, height);

    for (const mimeType of ['image/webp', 'image/jpeg']) {
      for (const quality of [0.92, 0.85, 0.78, 0.7, 0.62, 0.55, 0.48]) {
        const blob = await canvasToBlob(canvas, mimeType, quality);
        if (!smallestBlob || blob.size < smallestBlob.size) {
          smallestBlob = blob;
        }
        if (blob.size <= maxBytes) {
          return blobToDataUrl(blob);
        }
      }
    }

    width = Math.max(1, Math.round(width * 0.82));
    height = Math.max(1, Math.round(height * 0.82));
  }

  if (smallestBlob) {
    return blobToDataUrl(smallestBlob);
  }

  return fileToDataUrl(file);
};

export const filesToInlineImageDataUrls = async (files, options = {}) => {
  return Promise.all(Array.from(files || []).map((file) => fileToInlineImageDataUrl(file, options)));
};