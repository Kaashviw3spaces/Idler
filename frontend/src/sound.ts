/**
 * Idler Cross-Platform Sound System
 * Plays distinct native audio chimes for macOS vs Windows when background tasks complete.
 */

export type SoundPlatform = 'mac' | 'win' | 'auto';

let audioCtx: AudioContext | null = null;

function getAudioContext(): AudioContext {
  if (!audioCtx) {
    const AudioContextClass = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    audioCtx = new AudioContextClass();
  }
  if (audioCtx.state === 'suspended') {
    audioCtx.resume();
  }
  return audioCtx;
}

export function detectUserPlatform(): 'mac' | 'win' {
  const ua = (navigator.userAgent || navigator.platform || '').toLowerCase();
  if (ua.includes('mac') || ua.includes('darwin') || ua.includes('iphone') || ua.includes('ipad')) {
    return 'mac';
  }
  return 'win';
}

/**
 * macOS Glass Chime:
 * A pure, resonant crystal bell chime with dual harmonic frequencies (1760 Hz / A6 + 2637 Hz / E7).
 */
export function playMacChime(volume = 0.45) {
  try {
    const ctx = getAudioContext();
    const now = ctx.currentTime;

    const masterGain = ctx.createGain();
    masterGain.gain.setValueAtTime(volume, now);
    masterGain.connect(ctx.destination);

    // Fundamental: 1760 Hz (A6)
    const osc1 = ctx.createOscillator();
    const gain1 = ctx.createGain();
    osc1.type = 'sine';
    osc1.frequency.setValueAtTime(1760, now);
    gain1.gain.setValueAtTime(0.7, now);
    gain1.gain.exponentialRampToValueAtTime(0.0001, now + 0.42);
    osc1.connect(gain1);
    gain1.connect(masterGain);

    // Harmonic: 2637 Hz (E7 - Perfect Fifth above)
    const osc2 = ctx.createOscillator();
    const gain2 = ctx.createGain();
    osc2.type = 'sine';
    osc2.frequency.setValueAtTime(2637, now);
    gain2.gain.setValueAtTime(0.35, now);
    gain2.gain.exponentialRampToValueAtTime(0.0001, now + 0.35);
    osc2.connect(gain2);
    gain2.connect(masterGain);

    // High overtone: 3520 Hz (A7)
    const osc3 = ctx.createOscillator();
    const gain3 = ctx.createGain();
    osc3.type = 'sine';
    osc3.frequency.setValueAtTime(3520, now);
    gain3.gain.setValueAtTime(0.15, now);
    gain3.gain.exponentialRampToValueAtTime(0.0001, now + 0.22);
    osc3.connect(gain3);
    gain3.connect(masterGain);

    osc1.start(now);
    osc2.start(now);
    osc3.start(now);

    osc1.stop(now + 0.45);
    osc2.stop(now + 0.45);
    osc3.stop(now + 0.45);
  } catch (err) {
    console.warn('Audio chime playback error:', err);
  }
}

/**
 * Windows Notify Chime:
 * A cheerful ascending 3-note notification chord:
 * C5 (523 Hz) -> E5 (659 Hz) -> G5 (784 Hz) + C6 (1046 Hz).
 */
export function playWindowsChime(volume = 0.45) {
  try {
    const ctx = getAudioContext();
    const now = ctx.currentTime;

    const masterGain = ctx.createGain();
    masterGain.gain.setValueAtTime(volume, now);
    masterGain.connect(ctx.destination);

    // Note 1: C5 (523.25 Hz)
    const osc1 = ctx.createOscillator();
    const gain1 = ctx.createGain();
    osc1.type = 'triangle';
    osc1.frequency.setValueAtTime(523.25, now);
    gain1.gain.setValueAtTime(0.5, now);
    gain1.gain.exponentialRampToValueAtTime(0.001, now + 0.12);
    osc1.connect(gain1);
    gain1.connect(masterGain);
    osc1.start(now);
    osc1.stop(now + 0.14);

    // Note 2: E5 (659.25 Hz)
    const osc2 = ctx.createOscillator();
    const gain2 = ctx.createGain();
    osc2.type = 'triangle';
    osc2.frequency.setValueAtTime(659.25, now + 0.08);
    gain2.gain.setValueAtTime(0.001, now);
    gain2.gain.setValueAtTime(0.55, now + 0.08);
    gain2.gain.exponentialRampToValueAtTime(0.001, now + 0.22);
    osc2.connect(gain2);
    gain2.connect(masterGain);
    osc2.start(now + 0.08);
    osc2.stop(now + 0.24);

    // Note 3: G5 (783.99 Hz) & C6 (1046.50 Hz) chord
    const osc3 = ctx.createOscillator();
    const gain3 = ctx.createGain();
    osc3.type = 'sine';
    osc3.frequency.setValueAtTime(783.99, now + 0.16);
    gain3.gain.setValueAtTime(0.001, now);
    gain3.gain.setValueAtTime(0.65, now + 0.16);
    gain3.gain.exponentialRampToValueAtTime(0.0001, now + 0.48);
    osc3.connect(gain3);
    gain3.connect(masterGain);
    osc3.start(now + 0.16);
    osc3.stop(now + 0.50);

    const osc4 = ctx.createOscillator();
    const gain4 = ctx.createGain();
    osc4.type = 'sine';
    osc4.frequency.setValueAtTime(1046.50, now + 0.16);
    gain4.gain.setValueAtTime(0.001, now);
    gain4.gain.setValueAtTime(0.4, now + 0.16);
    gain4.gain.exponentialRampToValueAtTime(0.0001, now + 0.45);
    osc4.connect(gain4);
    gain4.connect(masterGain);
    osc4.start(now + 0.16);
    osc4.stop(now + 0.50);
  } catch (err) {
    console.warn('Audio chime playback error:', err);
  }
}

/**
 * Plays the chime tailored to the user's platform or preference,
 * and additionally triggers OS-native chime via backend.
 */
export function playTaskCompleteChime(mode: SoundPlatform = 'auto') {
  const isMuted = localStorage.getItem('idler_chime_muted') === 'true';
  if (isMuted) return;

  const targetPlatform = mode === 'auto' ? detectUserPlatform() : mode;

  if (targetPlatform === 'mac') {
    playMacChime();
  } else {
    playWindowsChime();
  }

  // Also trigger OS-level native sound (afplay / powershell) in the backend asynchronously
  fetch(`http://127.0.0.1:8000/api/system/chime?platform=${targetPlatform}`, {
    method: 'POST',
  }).catch(() => {
    // Non-blocking fallback
  });
}
