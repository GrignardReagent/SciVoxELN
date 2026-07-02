/** OCR of handwritten/printed notes via Tesseract.js (runs entirely in-browser). */
export async function runOCR(imageSource, onProgress) {
  if (!window.Tesseract) throw new Error('OCR engine still loading — try again in a moment');
  const res = await window.Tesseract.recognize(imageSource, 'eng', {
    logger: m => {
      if (m.status === 'recognizing text' && onProgress) onProgress(Math.round(m.progress * 100));
    }
  });
  return (res.data.text || '').trim();
}

export function fileToDataURL(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = reject;
    r.readAsDataURL(file);
  });
}
