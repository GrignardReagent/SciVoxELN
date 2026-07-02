/** OCR of handwritten/printed notes via Tesseract.js (runs entirely in-browser),
 *  plus laptop/phone camera capture helpers. */

export async function runOCR(imageSource, onProgress) {
  if (!window.Tesseract) throw new Error('OCR engine still loading — try again in a moment');
  const res = await window.Tesseract.recognize(imageSource, 'eng', {
    logger: m => { if (m.status === 'recognizing text' && onProgress) onProgress(Math.round(m.progress * 100)); }
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

export const cameraSupported = !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia);

/** Start the camera into a <video>. facingMode 'environment' = rear (phones). */
export async function startCamera(videoEl, facingMode = 'environment') {
  const stream = await navigator.mediaDevices.getUserMedia({
    video: { facingMode: { ideal: facingMode } }, audio: false
  });
  videoEl.srcObject = stream;
  await videoEl.play().catch(() => {});
  return stream;
}

export function stopCamera(stream) {
  if (stream) stream.getTracks().forEach(t => t.stop());
}

/** Grab the current video frame as { dataURL, blob }. */
export function captureFrame(videoEl) {
  const w = videoEl.videoWidth || 1280, h = videoEl.videoHeight || 720;
  const canvas = document.createElement('canvas');
  canvas.width = w; canvas.height = h;
  canvas.getContext('2d').drawImage(videoEl, 0, 0, w, h);
  const dataURL = canvas.toDataURL('image/jpeg', 0.9);
  return new Promise(resolve => {
    canvas.toBlob(blob => resolve({ dataURL, blob: blob || dataURLtoBlob(dataURL) }), 'image/jpeg', 0.9);
  });
}

function dataURLtoBlob(dataURL) {
  const [meta, b64] = dataURL.split(',');
  const mime = (meta.match(/:(.*?);/) || [])[1] || 'image/jpeg';
  const bin = atob(b64); const arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  return new Blob([arr], { type: mime });
}
