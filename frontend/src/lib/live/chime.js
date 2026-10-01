/**
 * A short two-note chime for a big play, synthesised rather than shipped as a file.
 *
 * Browsers only let a page make sound after a user gesture, so the context is created
 * by enableChime(), which the sound toggle calls from its click handler.
 */
let context = null;

export function enableChime() {
    try {
        const Ctx = window.AudioContext || window.webkitAudioContext;
        if (!Ctx) return;
        context ??= new Ctx();
        context.resume?.();
    } catch { /* no audio on this device - the toggle simply does nothing */ }
}

export function chime() {
    if (!context || context.state !== 'running') return;
    const start = context.currentTime;
    [[880, 0], [1318.5, 0.11]].forEach(([freq, offset]) => {
        const osc = context.createOscillator();
        const gain = context.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(freq, start + offset);
        gain.gain.setValueAtTime(0.0001, start + offset);
        gain.gain.exponentialRampToValueAtTime(0.18, start + offset + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.0001, start + offset + 0.35);
        osc.connect(gain).connect(context.destination);
        osc.start(start + offset);
        osc.stop(start + offset + 0.4);
    });
}
