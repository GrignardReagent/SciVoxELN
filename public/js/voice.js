/**
 * Voice dictation controller (Web Speech API) with explicit
 * Start / Pause / Resume / Stop control.
 *
 * How transcription works: the browser's SpeechRecognition streams microphone
 * audio to the platform speech service (Google's servers in Chrome/Edge) and
 * returns text — "interim" results while you speak, then a "final" result for
 * each phrase. We keep finalised text in `committed` and show the live interim
 * on top. For a compliant on-prem deployment this is the seam to swap for a
 * self-hosted Whisper endpoint (see src/routes/stt.js); the rest of the UI is
 * unaffected because it only listens to the callbacks below.
 *
 * States: 'idle' → 'recording' ⇄ 'paused' → 'idle'
 */
const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
export const voiceSupported = !!SR;

export class VoiceController {
  constructor({ onText, onState }) {
    this.onText = onText || (() => {});
    this.onState = onState || (() => {});
    this.state = 'idle';
    this.committed = '';
    this.interim = '';
    this.recog = null;
    this._wantActive = false; // whether we intend recognition to be running
  }

  _emitText() { this.onText((this.committed + this.interim).replace(/\s+/g, ' ').trimStart()); }
  _setState(s) { this.state = s; this.onState(s); }

  _make() {
    const r = new SR();
    r.continuous = true;
    r.interimResults = true;
    r.lang = 'en-US';
    r.onresult = ev => {
      this.interim = '';
      for (let i = ev.resultIndex; i < ev.results.length; i++) {
        const res = ev.results[i];
        if (res.isFinal) this.committed += res[0].transcript + ' ';
        else this.interim += res[0].transcript;
      }
      this._emitText();
    };
    r.onerror = ev => { if (ev.error === 'not-allowed' || ev.error === 'service-not-allowed') { this._wantActive = false; this._setState('idle'); this.onState('error:' + ev.error); } };
    r.onend = () => {
      // Chrome ends the session on silence; if we still want to record, restart.
      if (this._wantActive && this.state === 'recording') {
        try { r.start(); } catch {}
      }
    };
    return r;
  }

  /** Begin a fresh dictation, seeding from any existing composer text. */
  start(seedText = '') {
    if (!SR) return;
    this.committed = seedText ? seedText.trimEnd() + ' ' : '';
    this.interim = '';
    this.recog = this._make();
    this._wantActive = true;
    this._setState('recording');
    try { this.recog.start(); } catch {}
  }

  pause() {
    if (this.state !== 'recording') return;
    this._wantActive = false;
    // fold any interim into committed so nothing is lost
    if (this.interim) { this.committed += this.interim + ' '; this.interim = ''; }
    this._setState('paused');
    try { this.recog && this.recog.stop(); } catch {}
    this._emitText();
  }

  resume() {
    if (this.state !== 'paused') return;
    this.recog = this._make();
    this._wantActive = true;
    this._setState('recording');
    try { this.recog.start(); } catch {}
  }

  /** Stop entirely and finalise; text remains available to the caller. */
  stop() {
    this._wantActive = false;
    if (this.interim) { this.committed += this.interim + ' '; this.interim = ''; }
    try { this.recog && this.recog.stop(); } catch {}
    this.recog = null;
    this._setState('idle');
    this._emitText();
  }

  toggle(seedText = '') {
    if (this.state === 'idle') this.start(seedText);
    else this.stop();
  }
}
