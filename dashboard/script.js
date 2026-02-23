// FILE: frontend/dashboard/script.js

const API_BASE    ='https://info-view-backend-wblb.vercel.app'; //'http://localhost:5000'; //
const STATIC_USER = 'admin';
const STATIC_PASS = 'interview2024';

let allInterviews  = [];
let deleteTargetId = null;

// ─── SIDEBAR TOGGLE ────────────────────────────────────────────────────────────
function toggleSidebar() {
    const sidebar = document.getElementById('sidebar');
    const main    = document.getElementById('mainContent');
    sidebar.classList.toggle('collapsed');
}

// ─── AUTH ──────────────────────────────────────────────────────────────────────
function doLogin() {
    const user  = document.getElementById('loginUser').value.trim();
    const pass  = document.getElementById('loginPass').value.trim();
    const errEl = document.getElementById('loginError');

    if (user === STATIC_USER && pass === STATIC_PASS) {
        sessionStorage.setItem('dashboard_auth', '1');
        document.getElementById('loginScreen').classList.add('hidden');
        document.getElementById('dashboardScreen').classList.remove('hidden');
        loadInterviews();
    } else {
        errEl.textContent  = 'Invalid username or password';
        errEl.style.display = 'block';
        setTimeout(() => errEl.style.display = 'none', 3000);
    }
}

function doLogout() {
    sessionStorage.removeItem('dashboard_auth');
    document.getElementById('dashboardScreen').classList.add('hidden');
    document.getElementById('loginScreen').classList.remove('hidden');
    document.getElementById('loginUser').value = '';
    document.getElementById('loginPass').value = '';
}

document.addEventListener('DOMContentLoaded', () => {
    if (sessionStorage.getItem('dashboard_auth') === '1') {
        document.getElementById('loginScreen').classList.add('hidden');
        document.getElementById('dashboardScreen').classList.remove('hidden');
        loadInterviews();
    }
});

// ─── TABS ──────────────────────────────────────────────────────────────────────
function showTab(tab, el) {
    document.querySelectorAll('.tab-content').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
    document.getElementById(`tab-${tab}`).classList.add('active');
    el.classList.add('active');

    if (tab === 'interviews') {
        document.getElementById('pageTitle').textContent    = 'All Interviews';
        document.getElementById('pageSubtitle').textContent = 'Manage and review all candidate sessions';
    } else {
        document.getElementById('pageTitle').textContent    = 'Statistics';
        document.getElementById('pageSubtitle').textContent = 'Overview of interview performance metrics';
        computeStats();
    }
}

// ─── FETCH ALL INTERVIEWS ──────────────────────────────────────────────────────
async function loadInterviews() {
    showLoading(true);
    try {
        const res  = await fetch(`${API_BASE}/api/scheduler/all`);
        if (!res.ok) {
            const err = await res.json().catch(() => ({}));
            throw new Error(err.error || `Server error ${res.status}`);
        }
        const data     = await res.json();
        allInterviews  = Array.isArray(data) ? data : (data.interviews || []);
        renderTable(allInterviews);
        computeStats();
    } catch (err) {
        document.getElementById('loadingState').innerHTML = `
            <div style="font-size:2rem;">⚠️</div>
            <p style="color:#ef4444;font-weight:600;">Failed to load: ${escHtml(err.message)}</p>
            <button onclick="loadInterviews()" style="margin-top:12px;background:#f06767;border:none;
                color:white;padding:9px 20px;border-radius:8px;cursor:pointer;font-weight:700;font-size:0.85rem;">
                ↻ Retry
            </button>`;
    }
}

function showLoading(show) {
    document.getElementById('loadingState').style.display  = show ? 'flex' : 'none';
    document.getElementById('emptyState').classList.add('hidden');
    document.getElementById('interviewsTable').classList.add('hidden');
}

// ─── RENDER TABLE ──────────────────────────────────────────────────────────────
function renderTable(interviews) {
    document.getElementById('loadingState').style.display = 'none';

    if (!interviews.length) {
        document.getElementById('emptyState').classList.remove('hidden');
        document.getElementById('interviewsTable').classList.add('hidden');
        return;
    }

    document.getElementById('emptyState').classList.add('hidden');
    document.getElementById('interviewsTable').classList.remove('hidden');
    document.getElementById('tableBody').innerHTML = interviews.map(iv => buildRow(iv)).join('');
}

function buildRow(iv) {
    const id       = iv._id?.$oid || iv._id || iv.id || '';
    const name     = iv.candidate_name  || '—';
    const email    = iv.candidate_email || '—';
    const jd       = iv.job_description || '';
    const start    = formatDateCompact(iv.start_time);
    const end      = formatDateCompact(iv.end_time);
    const status   = iv.interview_status || 'scheduled';
    const ev       = iv.evaluation || {};
    const score    = ev.overall_score != null ? ev.overall_score : null;
    const rec      = ev.recommendation || '';
    const feedback = ev.feedback       || '';

    // JD cell
    const jdCell = buildTruncCell(jd, 'Job Description', id + '_jd');

    // Feedback cell
    const fbCell = buildTruncCell(feedback, 'AI Feedback', id + '_fb');

    // Score cell
    const scoreCell = score != null
        ? `<span class="score-val">${score}<span style="font-size:0.65rem;color:var(--muted);font-weight:400;">/10</span></span>`
        : `<span class="score-empty">—</span>`;

    // Rec cell
    const recClass = rec === 'Yes' ? 'rec-yes' : rec === 'Maybe' ? 'rec-maybe' : rec === 'No' ? 'rec-no' : '';
    const recCell  = rec
        ? `<span class="rec-badge ${recClass}">${escHtml(rec)}</span>`
        : `<span style="color:var(--hint);">—</span>`;

    return `<tr>
        <td><div class="cand-name" title="${escHtml(name)}">${escHtml(name)}</div></td>
        <td><div class="email-cell" title="${escHtml(email)}">${escHtml(email)}</div></td>
        <td>${jdCell}</td>
        <td><div class="date-cell">${start}</div></td>
        <td><div class="date-cell">${end}</div></td>
        <td><span class="status-badge status-${escHtml(status)}">${statusLabel(status)}</span></td>
        <td>${scoreCell}</td>
        <td>${recCell}</td>
        <td>${fbCell}</td>
    </tr>`;
        // If you want delete button So please below line to inside <tr> tag
        // <td><button class="btn-del" onclick="openDeleteModal('${escHtml(id)}')">🗑 Delete</button></td>
}

// ─── READ MORE ─────────────────────────────────────────────────────────────────
const readMoreMap = {};

function buildTruncCell(text, title, uid) {
    if (!text) return `<span style="color:var(--hint);font-size:0.78rem;">—</span>`;
    readMoreMap[uid] = { text, title };
    const isLong = text.length > 100;
    return `<div class="trunc-cell">
        <div class="trunc-text">${escHtml(text)}</div>
        ${isLong ? `<button class="read-more-btn" onclick="openReadMore('${escHtml(uid)}')">Read more ↗</button>` : ''}
    </div>`;
}

function openReadMore(uid) {
    const d = readMoreMap[uid];
    if (!d) return;
    document.getElementById('readMoreTitle').textContent = d.title;
    document.getElementById('readMoreBody').textContent  = d.text;
    document.getElementById('readMoreModal').classList.remove('hidden');
}
function closeReadMore() {
    document.getElementById('readMoreModal').classList.add('hidden');
}

// ─── FILTER ────────────────────────────────────────────────────────────────────
function filterInterviews() {
    const q       = document.getElementById('searchInput').value.toLowerCase();
    const statusF = document.getElementById('statusFilter').value;
    const filtered = allInterviews.filter(iv => {
        const name  = (iv.candidate_name  || '').toLowerCase();
        const email = (iv.candidate_email || '').toLowerCase();
        return (!q || name.includes(q) || email.includes(q)) &&
               (!statusF || (iv.interview_status || '') === statusF);
    });
    renderTable(filtered);
}

// ─── STATS ─────────────────────────────────────────────────────────────────────
function computeStats() {
    const total      = allInterviews.length;
    const completed  = allInterviews.filter(iv => iv.interview_status === 'completed').length;
    const inProgress = allInterviews.filter(iv => ['started','in_progress'].includes(iv.interview_status)).length;
    const waiting    = allInterviews.filter(iv => iv.interview_status === 'scheduled').length;
    const withScores = allInterviews.filter(iv => iv.evaluation?.overall_score != null);
    const avgScore   = withScores.length
        ? (withScores.reduce((s, iv) => s + iv.evaluation.overall_score, 0) / withScores.length).toFixed(1)
        : '—';
    const yesCount = allInterviews.filter(iv => iv.evaluation?.recommendation === 'Yes').length;
    const yesRate  = completed ? `${Math.round((yesCount / completed) * 100)}%` : '—';

    document.getElementById('statTotal').textContent      = total;
    document.getElementById('statCompleted').textContent  = completed;
    document.getElementById('statInProgress').textContent = inProgress;
    document.getElementById('statWaiting').textContent    = waiting;
    document.getElementById('statAvgScore').textContent   = avgScore;
    document.getElementById('statYesRate').textContent    = yesRate;
}

// ─── DELETE ────────────────────────────────────────────────────────────────────
// function openDeleteModal(id) {
//     deleteTargetId = id;
//     document.getElementById('deleteModal').classList.remove('hidden');
// }
// function closeDeleteModal() {
//     deleteTargetId = null;
//     document.getElementById('deleteModal').classList.add('hidden');
// }
// async function confirmDelete() {
//     if (!deleteTargetId) return;
//     const btn = document.querySelector('.btn-delete');
//     btn.textContent = 'Deleting…'; btn.disabled = true;
//     try {
//         const res = await fetch(`${API_BASE}/api/scheduler/${deleteTargetId}`, { method: 'DELETE' });
//         if (!res.ok) { const d = await res.json().catch(()=>({})); throw new Error(d.error||'Delete failed'); }
//         allInterviews = allInterviews.filter(iv => (iv._id?.$oid||iv._id||iv.id||'') !== deleteTargetId);
//         renderTable(allInterviews);
//         computeStats();
//         closeDeleteModal();
//     } catch (err) { alert('Error: ' + err.message); }
//     finally { btn.textContent = 'Delete'; btn.disabled = false; }
// }

// ─── UTILS ─────────────────────────────────────────────────────────────────────
// Compact date: "23 Feb\n03:37 pm"
function formatDateCompact(iso) {
    if (!iso) return '—';
    try {
        const d = new Date(iso);
        const date = d.toLocaleDateString('en-IN', { timeZone:'Asia/Kolkata', day:'2-digit', month:'short' });
        const time = d.toLocaleTimeString('en-IN', { timeZone:'Asia/Kolkata', hour:'2-digit', minute:'2-digit', hour12:true });
        return `${date}\n${time}`;
    } catch { return iso; }
}

function statusLabel(s) {
    return { scheduled:'Scheduled', started:'Started', in_progress:'In Progress', completed:'Completed', expired:'Expired' }[s] || s;
}

function escHtml(str) {
    return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}