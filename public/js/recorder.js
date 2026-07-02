/**
 * Microphone recorder for server-side STT (Whisper).
 *
 * When the server reports serverStt=true, the composer records audio with the
 * MediaRecorder API instead of using the browser Web Speech API. Whisper is a
 * batch engine, so there is no live interim text — the audio is captured with
 * Start / Pause / Resume, then transcribed on Stop.
 */
export const recorderSupported = !!(navigator.mediaDevices && window.MediaRecorder);

export class Recorder {
  constructor() {
    this.mr = null;
    this.stream = null;
    this.chunks = [];
    this.mimeType = 'audio/webm';
    this.state = 'idle'; // idle | recording | paused
  }

  async start() {
    this.stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    this.chunks = [];
    this.mr = new MediaRecorder(this.stream);
    this.mimeType = this.mr.mimeType || 'audio/webm';
    this.mr.ondataavailable = e => { if (e.data && e.data.size) this.chunks.push(e.data); };
    this.mr.start();
    this.state = 'recording';
  }

  pause() {
    if (this.mr && this.state === 'recording') { this.mr.pause(); this.state = 'paused'; }
  }

  resume() {
    if (this.mr && this.state === 'paused') { this.mr.resume(); this.state = 'recording'; }
  }

  /** Stop and return the recorded audio Blob. */
  stop() {
    return new Promise(resolve => {
      if (!this.mr) { this._cleanup(); return resolve(null); }
      const type = this.mimeType;
      this.mr.onstop = () => {
        const blob = new Blob(this.chunks, { type });
        this._cleanup();
        resolve(blob);
      };
      try { this.mr.stop(); } catch { this._cleanup(); resolve(null); }
      this.state = 'idle';
    });
  }

  _cleanup() {
    if (this.stream) this.stream.getTracks().forEach(t => t.stop());
    this.stream = null;
    this.mr = null;
  }
}
