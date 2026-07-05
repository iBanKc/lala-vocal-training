// ห้องครู — ภาพรวมห้องเรียน / รายคน / กิจกรรม / จัดการบัญชีนักเรียน
import { api, getToken } from './api.js';
import { BADGE_INFO, levelTitle } from './badges.js';
import { midiToNoteName } from './pitch-engine.js';

const GAME_NAMES = {
  note_match: '🎯 จับคู่โน้ต', note_hold: '🧘 เสียงนิ่ง', melody_echo: '🦜 ร้องตามทำนอง',
  pitch_glide: '🎈 เสียงพาบิน', song_compare: '🎤 ร้องเพลงเต็ม',
};

const $ = sel => document.querySelector(sel);
let overview = null; // { students, activity }

function fmtTime(ts) {
  if (!ts) return '—';
  const d = new Date(ts);
  return d.toLocaleString('th-TH', { timeZone: 'Asia/Bangkok', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}

function accClass(v) {
  if (v === null || v === undefined) return '';
  return v >= 80 ? 'acc-green' : v >= 60 ? 'acc-yellow' : 'acc-red';
}

// ── gate: ต้องเป็นครู ──────────────────────────────────
async function init() {
  if (!getToken()) return showGate();
  try {
    const { user } = await api('/api/me');
    if (user.role !== 'teacher') return showGate();
    $('#teacherName').textContent = user.display_name;
    $('#teacherMain').classList.remove('hidden');
    await loadOverview();
  } catch {
    showGate();
  }
}
function showGate() {
  $('#teacherGate').classList.remove('hidden');
}

// ── tabs ───────────────────────────────────────────────
document.querySelectorAll('.teacher-tab').forEach(tab =>
  tab.addEventListener('click', () => {
    document.querySelectorAll('.teacher-tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.teacher-view').forEach(v => v.classList.remove('active'));
    tab.classList.add('active');
    $('#view' + tab.dataset.view[0].toUpperCase() + tab.dataset.view.slice(1)).classList.add('active');
  }));
$('#backToOverview').addEventListener('click', () => {
  document.querySelectorAll('.teacher-view').forEach(v => v.classList.remove('active'));
  $('#viewOverview').classList.add('active');
});

// ── ภาพรวม ─────────────────────────────────────────────
let showGuests = true;

async function loadOverview() {
  overview = await api('/api/admin/students');
  renderOverview();
}

function renderOverview() {
  const students = overview.students.filter(s => showGuests || !s.is_guest);

  $('#studentsTable tbody').innerHTML = students.map(s => `
    <tr class="${s.is_active ? '' : 'inactive-row'}">
      <td>${s.is_guest ? '🎟 ' : ''}<a href="#" class="student-link" data-id="${s.id}">${s.display_name}</a></td>
      <td>${s.level}</td>
      <td>${s.xp}</td>
      <td>${s.streak_days || 0}</td>
      <td>${s.sessions_7d}</td>
      <td class="${accClass(s.acc_7d)}">${s.acc_7d != null ? s.acc_7d + '%' : '—'}</td>
      <td>${s.cents_7d != null ? s.cents_7d + '¢' : '—'}</td>
      <td>${fmtTime(s.last_active)}</td>
    </tr>`).join('') || '<tr><td colspan="8">ยังไม่มีนักเรียน — เพิ่มได้ที่แท็บ "จัดการนักเรียน"</td></tr>';

  document.querySelectorAll('.student-link').forEach(a =>
    a.addEventListener('click', e => { e.preventDefault(); openStudent(Number(a.dataset.id)); }));

  $('#activityTable tbody').innerHTML = overview.activity
    .filter(a => showGuests || !a.is_guest)
    .map(a => `
    <tr>
      <td>${fmtTime(a.created_at)}</td>
      <td>${a.is_guest ? '🎟 ' : ''}${a.display_name}</td>
      <td>${GAME_NAMES[a.game_id] || a.game_id}</td>
      <td>${a.level}</td>
      <td>${a.score}</td>
      <td>${'★'.repeat(a.stars)}</td>
    </tr>`).join('') || '<tr><td colspan="6">ยังไม่มีกิจกรรม</td></tr>';

  renderManage();
}

// ── รายคน ──────────────────────────────────────────────
let chart = null;
async function openStudent(id) {
  document.querySelectorAll('.teacher-view').forEach(v => v.classList.remove('active'));
  $('#viewStudent').classList.add('active');
  $('#studentDetail').innerHTML = '<p>⏳ กำลังโหลด...</p>';

  const d = await api(`/api/admin/student-detail?id=${id}`);
  const u = d.user;
  const earned = new Set(d.badges.map(b => b.badge_id));

  $('#studentDetail').innerHTML = `
    <div class="hub-profile">
      <div class="hub-greeting"><strong>${u.display_name}</strong> <small>(@${u.username})</small></div>
      <div class="hub-level-row">
        <span class="hub-level">ระดับ ${u.level} · ${levelTitle(u.level)} · ${u.xp} XP</span>
        <span class="hub-streak">🔥 ${u.streak_days} วัน</span>
      </div>
      <div class="xp-text" style="text-align:left">
        ช่วงเสียง: ${u.voice_low_midi != null ? `${midiToNoteName(u.voice_low_midi)} – ${midiToNoteName(u.voice_high_midi)}` : 'ยังไม่ได้วัด'}
        · เหรียญ: ${[...earned].map(b => BADGE_INFO[b]?.emoji || '🏅').join(' ') || '—'}
      </div>
    </div>
    <div class="manage-card">
      <h3>📈 พัฒนาการ 60 วัน</h3>
      ${d.daily.length ? '<canvas id="trendChart" height="130"></canvas>' : '<p class="note-text">ยังไม่มีข้อมูลการฝึก</p>'}
    </div>
    <div class="manage-card">
      <h3>⭐ ความคืบหน้าต่อเกม</h3>
      <div class="prog-grid">
        ${Object.entries(GAME_NAMES).map(([gid, name]) => {
          const rows = d.progress.filter(p => p.game_id === gid);
          const stars = rows.reduce((a, p) => a + p.best_stars, 0);
          const maxLv = rows.reduce((a, p) => Math.max(a, p.best_stars >= 2 ? p.level : 0), 0);
          return `<div class="prog-item"><span>${name}</span><span>⭐ ${stars} · ผ่านด่าน ${maxLv}</span></div>`;
        }).join('')}
      </div>
    </div>
    <div class="table-wrap">
      <table class="t-table">
        <thead><tr><th>เวลา</th><th>เกม</th><th>ด่าน</th><th>คะแนน</th><th>แม่นยำ</th><th>เพี้ยน</th></tr></thead>
        <tbody>
          ${d.sessions.map(s => `<tr>
            <td>${fmtTime(s.created_at)}</td>
            <td>${GAME_NAMES[s.game_id] || s.game_id}</td>
            <td>${s.level}</td>
            <td>${s.score} ${'★'.repeat(s.stars)}</td>
            <td class="${accClass(s.accuracy_pct)}">${s.accuracy_pct != null ? Math.round(s.accuracy_pct) + '%' : '—'}</td>
            <td>${s.avg_cents_off != null ? Math.round(s.avg_cents_off) + '¢' : '—'}</td>
          </tr>`).join('') || '<tr><td colspan="6">ยังไม่มีข้อมูล</td></tr>'}
        </tbody>
      </table>
    </div>`;

  if (d.daily.length) {
    if (chart) chart.destroy();
    chart = new Chart($('#trendChart'), {
      type: 'line',
      data: {
        labels: d.daily.map(r => r.day.slice(5)),
        datasets: [
          {
            label: 'ความแม่นยำ (%)', data: d.daily.map(r => r.acc),
            borderColor: '#1976D2', backgroundColor: 'rgba(33,150,243,0.1)', yAxisID: 'y', tension: 0.3,
          },
          {
            label: 'เพี้ยนเฉลี่ย (cents) — ยิ่งต่ำยิ่งดี', data: d.daily.map(r => r.cents),
            borderColor: '#dc2626', backgroundColor: 'rgba(220,38,38,0.08)', yAxisID: 'y2', tension: 0.3,
          },
        ],
      },
      options: {
        scales: {
          y: { min: 0, max: 100, title: { display: true, text: '%' } },
          y2: { position: 'right', min: 0, title: { display: true, text: 'cents' }, grid: { drawOnChartArea: false } },
        },
        plugins: { legend: { labels: { font: { family: 'Sarabun' } } } },
      },
    });
  }
}

// ── จัดการนักเรียน ─────────────────────────────────────
function renderManage() {
  $('#manageTable tbody').innerHTML = overview.students.map(s => `
    <tr class="${s.is_active ? '' : 'inactive-row'}">
      <td>${s.is_guest ? '🎟 ' : ''}${s.display_name}</td>
      <td>@${s.username}</td>
      <td>${s.is_active ? '✅ ใช้งานได้' : '⛔ ปิดอยู่'}</td>
      <td class="manage-actions">
        ${s.is_guest ? '' : `<button class="btn-secondary btn-sm" data-act="reset" data-id="${s.id}" data-name="${s.display_name}">รีเซ็ตรหัส</button>`}
        <button class="btn-secondary btn-sm" data-act="toggle" data-id="${s.id}" data-active="${s.is_active}">${s.is_active ? 'ปิดใช้งาน' : 'เปิดใช้งาน'}</button>
      </td>
    </tr>`).join('') || '<tr><td colspan="4">ยังไม่มีนักเรียน</td></tr>';

  document.querySelectorAll('#manageTable [data-act]').forEach(btn =>
    btn.addEventListener('click', async () => {
      const id = Number(btn.dataset.id);
      try {
        if (btn.dataset.act === 'reset') {
          const pw = genPassword();
          if (!confirm(`รีเซ็ตรหัสผ่านของ ${btn.dataset.name} เป็น "${pw}" ?`)) return;
          await api('/api/admin/students', { method: 'PATCH', body: { id, action: 'reset_password', password: pw } });
          alert(`รหัสใหม่ของ ${btn.dataset.name}: ${pw}\n(จดไว้แล้วส่งให้นักเรียน)`);
        } else {
          const nowActive = btn.dataset.active === 'true';
          await api('/api/admin/students', { method: 'PATCH', body: { id, action: 'set_active', active: !nowActive } });
        }
        await loadOverview();
      } catch (err) { alert('⚠️ ' + err.message); }
    }));
}

function genPassword() {
  // อ่านง่าย พิมพ์ง่ายบนมือถือ: พยัญชนะ+สระสลับ + เลข 2 ตัว
  const c = 'bcdfghjkmnprstvw', v = 'aeiou';
  let pw = '';
  for (let i = 0; i < 3; i++) pw += c[Math.floor(Math.random() * c.length)] + v[Math.floor(Math.random() * v.length)];
  return pw + Math.floor(10 + Math.random() * 90);
}

$('#guestToggle').addEventListener('change', e => {
  showGuests = e.target.checked;
  renderOverview();
});

$('#genPassword').addEventListener('click', () => { $('#newPassword').value = genPassword(); });

$('#createStudent').addEventListener('click', async () => {
  const msg = $('#createMsg');
  msg.textContent = '';
  try {
    const body = {
      username: $('#newUsername').value,
      display_name: $('#newDisplayName').value,
      password: $('#newPassword').value,
    };
    await api('/api/admin/students', { method: 'POST', body });
    msg.style.color = '#16a34a';
    msg.textContent = `✅ สร้างแล้ว: ${body.username} / ${body.password} (ส่งให้นักเรียนได้เลย)`;
    $('#newUsername').value = $('#newDisplayName').value = $('#newPassword').value = '';
    await loadOverview();
  } catch (err) {
    msg.style.color = '';
    msg.textContent = '⚠️ ' + err.message;
  }
});

init();
