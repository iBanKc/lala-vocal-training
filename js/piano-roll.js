// Piano-roll แบบแอปฝึกร้องจริง: เลนโน้ตแนวนอน + บล็อกเป้าหมาย + เส้น pitch สดไหลจากขวาไปซ้าย
// option `piano: true` → คีย์เปียโนแนวตั้งขอบขวา เส้นเสียงวิ่งชนคีย์ คีย์คำตอบไฮไลต์เขียว
// (หน้าตาเดียวกับเกมเสียงพาบิน — ใช้ร่วมโดย จับคู่โน้ต / ร้องตามทำนอง)
import { NOTE_NAMES, midiToNoteName } from './pitch-engine.js';

const BLACK_KEYS = new Set([1, 3, 6, 8, 10]);

export class PianoRoll {
  constructor(canvas, { lowMidi, highMidi, historyMs = 4000, piano = false } = {}) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.lowMidi = lowMidi - 1;
    this.highMidi = highMidi + 1;
    this.historyMs = historyMs;
    this.pianoW = piano ? 46 : 0;
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
    const fieldW = w - this.pianoW; // สนามวาดเส้น (ไม่ทับเปียโน)
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
      ctx.fillRect(0, y, fieldW, laneH);
      if (laneH >= 11 || isC) {
        ctx.fillStyle = isC ? 'rgba(25,118,210,0.75)' : 'rgba(74,101,133,0.55)';
        ctx.font = `${isC ? '600 ' : ''}9px Inter, sans-serif`;
        ctx.fillText(NOTE_NAMES[((m % 12) + 12) % 12] + (Math.floor(m / 12) - 1), 4, y + laneH / 2 + 3);
      }
    }

    // บล็อกโน้ตเป้าหมาย (แถบเขียวโปร่ง = ช่วง tolerance) + เส้นประวิ่งเข้าคีย์
    if (this.target) {
      const { midi, toleranceCents } = this.target;
      const tolSemi = toleranceCents / 100;
      const yTop = this._y(midi + tolSemi, h);
      const yBot = this._y(midi - tolSemi, h);
      ctx.fillStyle = 'rgba(22,163,74,0.22)';
      ctx.fillRect(0, yTop, fieldW, yBot - yTop);
      const yC = this._y(midi, h);
      ctx.strokeStyle = 'rgba(22,163,74,0.9)';
      ctx.lineWidth = 3;
      ctx.setLineDash([6, 4]);
      ctx.beginPath(); ctx.moveTo(0, yC); ctx.lineTo(fieldW, yC); ctx.stroke();
      ctx.setLineDash([]);
    }

    // เส้น pitch สด — จุด "ตอนนี้" ชนขอบเปียโน (เส้นวิ่งตรงเข้าคีย์)
    let headMidi = null;
    if (this.trace.length >= 2) {
      const now = performance.now();
      ctx.lineWidth = 4.5;
      ctx.lineCap = 'round';
      let started = false;
      for (const pt of this.trace) {
        const x = fieldW - ((now - pt.time) / this.historyMs) * fieldW;
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
        headMidi = last.midi;
        const y = this._y(last.midi, h);
        ctx.fillStyle = '#1976D2';
        ctx.beginPath();
        ctx.arc(fieldW - ((now - last.time) / this.historyMs) * fieldW, y, 7, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    if (this.pianoW > 0) this._drawPiano(fieldW, w, h, laneH, headMidi);
  }

  // คีย์เปียโนแนวตั้งขอบขวา: คีย์คำตอบเขียว+ชื่อโน้ต, จุดฟ้า = คีย์ที่เสียงผู้เล่นอยู่
  _drawPiano(fieldW, w, h, laneH, headMidi) {
    const ctx = this.ctx;
    const targetRound = this.target ? Math.round(this.target.midi) : null;
    const headRound = headMidi !== null ? Math.round(headMidi) : null;

    ctx.fillStyle = '#ffffff';
    ctx.fillRect(fieldW, 0, this.pianoW, h);
    for (let m = Math.ceil(this.lowMidi); m <= Math.floor(this.highMidi); m++) {
      const pc = ((m % 12) + 12) % 12;
      const yTop = this._y(m + 0.5, h);
      const isBlack = BLACK_KEYS.has(pc);
      const isTarget = m === targetRound;
      const keyW = isBlack ? this.pianoW * 0.62 : this.pianoW;
      ctx.fillStyle = isTarget ? '#16a34a' : isBlack ? '#334155' : '#ffffff';
      ctx.fillRect(fieldW, yTop, keyW, laneH);
      ctx.strokeStyle = 'rgba(13,27,46,0.18)';
      ctx.strokeRect(fieldW + 0.5, yTop + 0.5, keyW - 1, laneH - 1);
      if (isTarget && laneH >= 9) {
        ctx.fillStyle = '#fff';
        ctx.font = `700 ${Math.min(12, laneH - 1)}px Inter, sans-serif`;
        ctx.textAlign = 'right';
        ctx.fillText(midiToNoteName(m), w - 4, yTop + laneH / 2 + 4);
        ctx.textAlign = 'left';
      } else if (m === headRound) {
        ctx.fillStyle = '#1976D2';
        ctx.beginPath();
        ctx.arc(fieldW + this.pianoW - 8, yTop + laneH / 2, 3.5, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.strokeStyle = 'rgba(13,27,46,0.35)';
    ctx.strokeRect(fieldW + 0.5, 0.5, this.pianoW - 1, h - 1);
  }
}
