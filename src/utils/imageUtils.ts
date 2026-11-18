/**
 * Utilities for fetching, validating, and converting image links and files to base64 data URLs.
 * Ensures images work 100% offline and can be embedded in jsPDF cost sheets.
 */

export async function fetchImageAsBase64(imageUrl: string): Promise<string> {
  const cleanUrl = imageUrl.trim();
  if (!cleanUrl) {
    throw new Error('Image URL cannot be empty');
  }

  // If already a base64 data URL, return it directly
  if (cleanUrl.startsWith('data:image/')) {
    return cleanUrl;
  }

  // 1. Try local dev-server proxy first (bypasses CORS restrictions on MakerWorld, Printables, etc.)
  try {
    const proxyUrl = `/api/proxy-image?url=${encodeURIComponent(cleanUrl)}`;
    const res = await fetch(proxyUrl);
    if (res.ok) {
      const data = await res.json();
      if (data?.dataUrl) {
        return data.dataUrl;
      }
    }
  } catch {
    // If proxy endpoint is not reachable (e.g. static production deployment), fall through
  }

  // 2. Direct client-side fetch fallback
  try {
    const directRes = await fetch(cleanUrl, { mode: 'cors' });
    if (directRes.ok) {
      const blob = await directRes.blob();
      return await blobToDataUrl(blob);
    }
  } catch {
    // Direct fetch failed (likely CORS), try canvas image element
  }

  // 3. Canvas Image loading fallback
  return new Promise<string>((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      try {
        const canvas = document.createElement('canvas');
        canvas.width = img.naturalWidth || img.width || 300;
        canvas.height = img.naturalHeight || img.height || 300;
        const ctx = canvas.getContext('2d');
        if (!ctx) throw new Error('Canvas 2D context unavailable');
        ctx.drawImage(img, 0, 0);
        const dataUrl = canvas.toDataURL('image/png');
        resolve(dataUrl);
      } catch (err) {
        reject(new Error('Unable to convert image due to browser CORS restriction. Try downloading the image and uploading the file directly.'));
      }
    };
    img.onerror = () => {
      reject(new Error('Failed to load image from the provided link. Please check the URL or upload the image file.'));
    };
    img.src = cleanUrl;
  });
}

export function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        resolve(reader.result);
      } else {
        reject(new Error('Failed to read image data'));
      }
    };
    reader.onerror = () => reject(reader.error || new Error('Failed to convert blob to data URL'));
    reader.readAsDataURL(blob);
  });
}

export function fileToBase64(file: File): Promise<string> {
  return blobToDataUrl(file);
}
