export interface SpeechRecognitionAlternativeLike {
  transcript: string;
  confidence: number;
}

export interface SpeechRecognitionResultLike {
  isFinal: boolean;
  length: number;
  [index: number]: SpeechRecognitionAlternativeLike;
}

export interface SpeechRecognitionEventLike extends Event {
  resultIndex: number;
  results: {
    length: number;
    [index: number]: SpeechRecognitionResultLike;
  };
}

export interface SpeechRecognitionErrorEventLike extends Event {
  error: string;
  message?: string;
}

export interface SpeechRecognitionLike extends EventTarget {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  start(): void;
  stop(): void;
  abort(): void;
  onresult: ((ev: SpeechRecognitionEventLike) => void) | null;
  onerror: ((ev: SpeechRecognitionErrorEventLike) => void) | null;
  onend: (() => void) | null;
}

type SpeechRecognitionCtor = new () => SpeechRecognitionLike;

export function hasSpeechSynthesis(): boolean {
  return typeof window !== 'undefined' && 'speechSynthesis' in window;
}

export function getSpeechRecognitionCtor(): SpeechRecognitionCtor | null {
  if (typeof window === 'undefined') return null;
  const win = window as unknown as {
    SpeechRecognition?: SpeechRecognitionCtor;
    webkitSpeechRecognition?: SpeechRecognitionCtor;
  };
  return win.SpeechRecognition ?? win.webkitSpeechRecognition ?? null;
}

export function listEnglishVoices(): SpeechSynthesisVoice[] {
  if (!hasSpeechSynthesis()) return [];
  const voices = window.speechSynthesis.getVoices();
  const english = voices.filter((v) => v.lang.toLowerCase().startsWith('en'));
  return english.length > 0 ? english : voices;
}

let speakSeq = 0;

export function stopSpeaking(): void {
  speakSeq += 1;
  if (hasSpeechSynthesis()) {
    window.speechSynthesis.cancel();
  }
}

export function speakMathPrompt(params: {
  text: string;
  rate: number;
  voiceName?: string;
  onStart?: () => void;
  onEnd?: () => void;
}): () => void {
  const token = ++speakSeq;
  if (!hasSpeechSynthesis()) {
    params.onStart?.();
    const t = window.setTimeout(() => {
      if (token === speakSeq) params.onEnd?.();
    }, 350);
    return () => window.clearTimeout(t);
  }

  window.speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(params.text);
  utterance.lang = 'en-US';
  utterance.rate = Math.min(2.2, Math.max(0.7, params.rate));
  utterance.pitch = 1;

  const voices = listEnglishVoices();
  if (params.voiceName) {
    const found = voices.find((v) => v.name === params.voiceName);
    if (found) utterance.voice = found;
  }

  let ended = false;
  let fallbackTimer = 0;
  const finish = () => {
    if (ended) return;
    ended = true;
    window.clearTimeout(fallbackTimer);
    if (token === speakSeq) {
      params.onEnd?.();
    }
  };

  utterance.onstart = () => {
    if (token === speakSeq) params.onStart?.();
  };
  utterance.onend = finish;
  utterance.onerror = finish;

  // Guard against headless/quirky browsers where onend never fires
  const estimatedMs = Math.max(1600, Math.round((params.text.length * 95) / utterance.rate) + 1200);
  fallbackTimer = window.setTimeout(finish, estimatedMs);

  window.speechSynthesis.speak(utterance);

  return () => {
    ended = true;
    window.clearTimeout(fallbackTimer);
  };
}

let sharedAudioCtx: AudioContext | null = null;

function getAudioCtx(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctx) return null;
  if (!sharedAudioCtx) {
    sharedAudioCtx = new Ctx();
  }
  if (sharedAudioCtx.state === 'suspended') {
    void sharedAudioCtx.resume();
  }
  return sharedAudioCtx;
}

export function unlockAudioAndSpeechOnGesture(): void {
  getAudioCtx();
  if (hasSpeechSynthesis()) {
    try {
      window.speechSynthesis.resume();
    } catch {
      // ignore
    }
  }
}

export function playCue(type: 'hit' | 'miss' | 'tick', enabled: boolean): void {
  if (!enabled) return;
  const ctx = getAudioCtx();
  if (!ctx) return;

  const now = ctx.currentTime;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.connect(gain);
  gain.connect(ctx.destination);

  if (type === 'hit') {
    osc.type = 'sine';
    osc.frequency.setValueAtTime(660, now);
    osc.frequency.exponentialRampToValueAtTime(880, now + 0.06);
    gain.gain.setValueAtTime(0.06, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.09);
    osc.start(now);
    osc.stop(now + 0.095);
  } else if (type === 'miss') {
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(220, now);
    osc.frequency.exponentialRampToValueAtTime(145, now + 0.14);
    gain.gain.setValueAtTime(0.08, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.16);
    osc.start(now);
    osc.stop(now + 0.17);
  } else {
    osc.type = 'sine';
    osc.frequency.setValueAtTime(520, now);
    gain.gain.setValueAtTime(0.03, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.05);
    osc.start(now);
    osc.stop(now + 0.055);
  }
}
