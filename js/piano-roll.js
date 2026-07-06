// Piano-roll แบบแอปฝึกร้องจริง: เลนโน้ตแนวนอน + บล็อกเป้าหมาย + เส้น pitch สดไหลจากขวาไปซ้าย
import { NOTE_NAMES } from './pitch-engine.js';

export class PianoRoll {
  constructor(canvas, { lowMidi, highMidi, historyMs = 4000 } = {}) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.lowMidi = lowMidi - 1;
    this.highMidi = highMidi + 1;
    this.historyMs = historyMs;
    this.target = null;          // { midi, toleranceCents }
    this.trace = [];             // [{ time, midi }] — midi = null คือช่วงเงียบ
    this.resize();
  }

  resize() {
    const dpr = window.devicePixelRatio || 1;
    this.canvas.width = this.canvas.offsetWidth * dpr;
    this.canvas.height = this.canvas.offsetHeight * dpr;
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  setRange(lowMidi, highMidi) {
    this.lowMidi = lowMidi - 1;
    this.highMidi = highMidi + 1;
  }

  setTarget(midi, toleranceCents) {
    this.target = midi === null ? null : { midi, toleranceCents };
  }

  pushPitch(midi) {
    const now = performance.now();
    this.trace.push({ time: now, midi });
    const cutoff = now - this.historyMs;
    while (this.trace.length && this.trace[0].time < cutoff) this.trace.shift();
  }

  clearTrace() { this.trace = []; }

  _y(midi, h) {
    const span = this.highMidi - this.lowMidi;
    return h - ((midi - this.lowMidi) / span) * h;
  }

  draw() {
    const w = this.canvas.offsetWidth, h = this.canvas.offsetHeight;
    const ctx = this.ctx;
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = '#f0f6ff';
    ctx.fillRect(0, 0, w, h);

    // เลนโน้ต (แถบสลับสี + ชื่อโน้ต)
    const laneH = h / (this.highMidi - this.lowMidi);
    for (let m = Math.ceil(this.lowMidi); m <= this.highMidi; m++) {
      const y = this._y(m + 0.5, h);
      const isC = m % 12 === 0;
      ctx.fillStyle = m % 2 ? 'rgba(33,150,243,0.045)' : 'rgba(33,150,243,0.09)';
      ctx.fillRect(0, y, w, laneH);
      if (laneH >= 11 || isC) {
        ctx.fillStyle = isC ? 'rgba(25,118,210,0.75)' : 'rgba(74,101,133,0.55)';
        ctx.font = `${isC ? '600 ' : ''}9px Inter, sans-serif`;
        ctx.fillText(NOTE_NAMES[((m % 12) + 12) % 12] + (Math.floor(m / 12) - 1), 4, y + laneH / 2 + 3);
      }
    }

    // บล็อกโน้ตเป้าหมาย (แถบเขียวโปร่ง = ช่วง tolerance)
    if (this.target) {
      const { midi, toleranceCents } = this.target;
      const tolSemi = toleranceCents / 100;
      const yTop = this._y(midi + tolSemi, h);
      const yBot = this._y(midi - tolSemi, h);
      ctx.fillStyle = 'rgba(22,163,74,0.22)';
      ctx.fillRect(0, yTop, w, yBot - yTop);
      const yC = this._y(midi, h);
      ctx.strokeStyle = 'rgba(22,163,74,0.9)';
      ctx.lineWidth = 3;
      ctx.setLineDash([6, 4]);
      ctx.beginPath(); ctx.moveTo(0, yC); ctx.lineTo(w, yC); ctx.stroke();
      ctx.setLineDash([]);
    }

    // เส้น pitch สด (ตอนนี้ = ขอบขวา)
    if (this.trace.length >= 2) {
      const now = performance.now();
      ctx.lineWidth = 4.5;
      ctx.lineCap = 'round';
      let started = false;
      for (const pt of this.trace) {
        const x = w - ((now - pt.time) / this.historyMs) * w;
        if (pt.midi === null) { started = false; continue; }
        const y = this._y(pt.midi, h);
        const inTol = this.target &&
          Math.abs(pt.midi - this.target.midi) * 100 <= this.target.toleranceCents;
        ctx.strokeStyle = inTol ? '#16a34a' : '#1976D2';
        if (!started) { ctx.beginPath(); ctx.moveTo(x, y); started = true; }
        else { ctx.lineTo(x, y); ctx.stroke(); ctx.beginPath(); ctx.moveTo(x, y); }
      }
      // จุดหัวเส้น
      const last = [...this.trace].reverse().find(p => p.midi !== null);
      if (last && now - last.time < 200) {
        const y = this._y(last.midi, h);
        ctx.fillStyle = '#1976D2';
        ctx.beginPath(); ctx.arc(w - ((now - last.time) / this.historyMs) * w, y, 7, 0, Math.PI * 2); ctx.fill();
      }
    }
  }
}
