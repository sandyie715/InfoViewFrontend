// FILE: frontend/interviewer/interview-script.js

const API_BASE ='https://info-view-backend-wblb.vercel.app'; //'http://localhost:5000'; // 

// ─── STATE ────────────────────────────────────────────────────────────────────
let interviewData = null;
let interviewStartTime = null;
let mediaRecorder = null;
let recordedChunks = [];
let currentTranscript = '';
let timerInterval = null;
let videoBlob = null;
let recordedStream = null;
let audioStream = null;
let waitingInterval = null;
let currentQuestion = '';

let audioRecorder = null;
let audioChunks = [];
let isRecording = false;
let thinkInterval = null;
let permissionsGranted = false;

// ─── SCREEN NAVIGATION ────────────────────────────────────────────────────────
function goToScreen(id) {
    document.querySelectorAll('.screen, .interview-container').forEach(el => {
        el.classList.remove('active');
    });
    const target = document.getElementById(id);
    if (target) target.classList.add('active');

    // When going to permission screen, request permissions
    if (id === 'permissionScreen') requestPermissions();
}

// ─── DOMContentLoaded ─────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
    const params = new URLSearchParams(window.location.search);
    const interviewId = params.get("id");

    if (!interviewId) { showFatalError("Invalid interview link"); return; }

    try {
        const statusResponse = await fetch(`${API_BASE}/api/scheduler/status?id=${interviewId}`);
        const statusData = await statusResponse.json();

        if (statusData.status === "completed") {
            showFatalError("Interview Already Completed", "Thank you for attending. Our team will get back to you shortly.", "✅");
            return;
        }
        if (statusData.status === "already_started") {
            showFatalError("Interview Already Started", "This interview is already in progress from another device or window.", "⚠️");
            return;
        }
        if (statusData.status === "expired") {
            showFatalError("Interview Window Closed", "Please contact your recruiter to reschedule.", "⏰");
            return;
        }
        if (statusData.status === "waiting") {
            showWaitingScreen(new Date(statusData.start_time), statusData.start_time_ist);
            return;
        }

        if (statusData.status === "live") {
            interviewData = {
                interviewId: statusData.interviewId,
                candidateName: statusData.candidateName,
                candidateEmail: statusData.candidateEmail,
                jobDescription: statusData.jobDescription
            };

            // Show instruction page first (not directly start interview)
            goToScreen('instructionScreen');
        }

    } catch (error) {
        console.error('Status check failed:', error);
        showFatalError('Failed to validate session');
    }
});

// ─── PERMISSION SCREEN ────────────────────────────────────────────────────────
async function requestPermissions() {
    try {
        const stream = await navigator.mediaDevices.getUserMedia({
            video: { width: { ideal: 1280 }, height: { ideal: 720 } },
            audio: true
        });

        recordedStream = stream;

        // Preview
        const preview = document.getElementById('previewVideo');
        preview.srcObject = stream;
        document.getElementById('previewWrap').style.display = 'block';

        // Mark granted
        setPermStatus('permCamera', 'camStatus', true);
        setPermStatus('permMic', 'micStatus', true);

        permissionsGranted = true;
        document.getElementById('startInterviewBtn').disabled = false;

    } catch (err) {
        console.error('Permission denied:', err);
        document.getElementById('permError').style.display = 'block';
        document.getElementById('permError').textContent = '⚠️ Camera/microphone access was denied. Please allow access in your browser settings and try again.';
        setPermStatus('permCamera', 'camStatus', false);
        setPermStatus('permMic', 'micStatus', false);
    }
}

function setPermStatus(itemId, statusId, granted) {
    const item = document.getElementById(itemId);
    const status = document.getElementById(statusId);
    item.classList.add(granted ? 'granted' : 'denied');
    status.textContent = granted ? '✓ Granted' : '✗ Denied';
}

// ─── BEGIN INTERVIEW ──────────────────────────────────────────────────────────
async function beginInterview() {
    if (!permissionsGranted) return;

    // Transition to interview
    goToScreen('interviewSection');

    // Start recording the stream we already have
    startRecording(recordedStream);

    // Set camera feed to existing stream
    document.getElementById('cameraFeed').srcObject = recordedStream;

    // Prepare audio stream for Whisper
    await startAudioRecorder();

    await generateQuestions();
    interviewStartTime = Date.now();
    startInterviewTimer();
    await loadNextQuestion();
}

// ─── AUDIO SETUP ──────────────────────────────────────────────────────────────
async function startAudioRecorder() {
    try {
        if (recordedStream) {
            const audioTracks = recordedStream.getAudioTracks();
            if (audioTracks.length > 0) {
                audioStream = new MediaStream(audioTracks);
                return;
            }
        }
        audioStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (err) {
        console.error('Cannot access microphone:', err);
    }
}

// ─── RECORDING ────────────────────────────────────────────────────────────────
function startRecording(stream) {
    try {
        mediaRecorder = new MediaRecorder(stream);
        mediaRecorder.ondataavailable = (event) => {
            if (event.data.size > 0) recordedChunks.push(event.data);
        };
        mediaRecorder.onstop = () => {
            videoBlob = new Blob(recordedChunks, { type: 'video/webm' });
        };
        mediaRecorder.start();
    } catch (error) {
        console.error('Recording error:', error);
    }
}

function startAnswerRecording() {
    if (!audioStream) { console.error('Audio stream not ready'); return; }
    audioChunks = [];
    audioRecorder = new MediaRecorder(audioStream);
    audioRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) audioChunks.push(e.data);
    };
    audioRecorder.start();
    isRecording = true;

    setStateLabel('🔴 Recording your answer...');

    // Show transcription area
    const ta = document.getElementById('transcriptionArea');
    ta.style.display = 'block';
    document.getElementById('transcriptionDisplay').textContent = 'Listening...';

    // Enable next button after 3 seconds (give some time to answer)
    setTimeout(() => {
        document.getElementById('nextBtn').disabled = false;
    }, 3000);
}

async function stopAnswerRecording() {
    if (!audioRecorder || audioRecorder.state === 'inactive') return;

    setStateLabel('⏳ Processing your answer...');
    document.getElementById('nextBtn').disabled = true;

    return new Promise((resolve) => {
        audioRecorder.onstop = async () => {
            isRecording = false;
            const audioBlob = new Blob(audioChunks, { type: 'audio/webm' });
            const transcript = await transcribeWithWhisper(audioBlob);
            currentTranscript = transcript;

            document.getElementById('transcriptionDisplay').textContent =
                transcript || '(No speech detected)';
            document.getElementById('nextBtn').disabled = false;
            setStateLabel('');
            resolve(transcript);
        };
        audioRecorder.stop();
    });
}

async function transcribeWithWhisper(audioBlob) {
    try {
        const formData = new FormData();
        formData.append('audio', audioBlob, 'answer.webm');

        const response = await fetch(`${API_BASE}/api/interviews/transcribe`, {
            method: 'POST',
            body: formData
        });

        if (!response.ok) return '';
        const data = await response.json();
        return data.transcript || '';
    } catch (err) {
        console.error('Transcription failed:', err);
        return '';
    }
}

// ─── QUESTION FLOW ────────────────────────────────────────────────────────────
async function generateQuestions() {
    try {
        const response = await fetch(`${API_BASE}/api/interviews/generate-questions`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                jd: interviewData.jobDescription,
                interview_id: interviewData.interviewId
            })
        });
        const result = await response.json();

        if (result.status === "already_started") {
            showFatalError("Interview Already Started", "This interview is already in progress from another device.", "⚠️");
            return;
        }
        if (result.status === "completed") {
            showFatalError("Interview Already Completed", "Thank you for attending.", "✅");
        }
    } catch (error) {
        console.error('Generate questions failed:', error);
    }
}

async function loadNextQuestion() {
    try {
        // Reset UI
        document.getElementById('nextBtn').disabled = true;
        document.getElementById('thinkWrap').style.display = 'none';
        document.getElementById('transcriptionArea').style.display = 'none';
        setStateLabel('Loading question...');
        currentTranscript = '';

        const response = await fetch(`${API_BASE}/api/interviews/next-question/${interviewData.interviewId}`);
        const data = await response.json();

        if (data.done) {
            await endInterview();
            return;
        }

        currentQuestion = data.question;

        // Update question text with animation by forcing reflow
        const qText = document.getElementById('questionText');
        qText.style.animation = 'none';
        qText.offsetHeight; // reflow
        qText.style.animation = '';
        qText.textContent = currentQuestion;
        document.getElementById('questionLabel').textContent =
            `Question ${data.questionNumber} of ${data.totalQuestions}`;

        setStateLabel('🔊 Listen to the question...');

        // Speak question, then start think countdown
        speakQuestion(currentQuestion, () => {
            startThinkCountdown();
        });

    } catch (error) {
        console.error('Load next question failed:', error);
    }
}

function speakQuestion(question, onDone) {
    if (!('speechSynthesis' in window)) {
        onDone && onDone();
        return;
    }
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(question);
    utterance.rate = 0.95;
    utterance.onend = () => onDone && onDone();
    // Fallback in case onend doesn't fire
    const fallback = setTimeout(() => onDone && onDone(), question.length * 80 + 2000);
    utterance.onend = () => { clearTimeout(fallback); onDone && onDone(); };
    window.speechSynthesis.speak(utterance);
}

// ─── THINK COUNTDOWN ──────────────────────────────────────────────────────────
function startThinkCountdown() {
    let remaining = 30;

    const wrap = document.getElementById('thinkWrap');
    const countEl = document.getElementById('thinkCountdown');
    const bar = document.getElementById('thinkBar');

    wrap.style.display = 'flex';
    countEl.textContent = remaining;
    bar.style.width = '100%';
    setStateLabel('⏳ Think before you speak...');

    // Allow skipping think time and start recording early
    document.getElementById('nextBtn').disabled = false;
    document.getElementById('nextBtn').textContent = 'Skip Think Time';
    document.getElementById('nextBtn').onclick = () => {
        skipToRecording();
    };

    thinkInterval = setInterval(() => {
        remaining--;
        countEl.textContent = remaining;
        bar.style.width = `${(remaining / 30) * 100}%`;

        if (remaining <= 0) {
            clearInterval(thinkInterval);
            startRecordingPhase();
        }
    }, 1000);
}

function skipToRecording() {
    if (thinkInterval) clearInterval(thinkInterval);
    startRecordingPhase();
}

function startRecordingPhase() {
    document.getElementById('thinkWrap').style.display = 'none';

    // Reset next button to normal
    document.getElementById('nextBtn').textContent = 'Next Question →';
    document.getElementById('nextBtn').onclick = () => submitAnswer();
    document.getElementById('nextBtn').disabled = true;

    startAnswerRecording();
}

// ─── SUBMIT ANSWER ────────────────────────────────────────────────────────────
async function submitAnswer() {
    try {
        if (isRecording) {
            await stopAnswerRecording();
        }

        const answer = currentTranscript.trim() || 'No answer provided';

        await fetch(`${API_BASE}/api/interviews/submit-answer/${interviewData.interviewId}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ question: currentQuestion, answer })
        });

        await loadNextQuestion();
    } catch (error) {
        console.error('Submit answer failed:', error);
    }
}

// ─── END INTERVIEW ────────────────────────────────────────────────────────────
async function endInterview() {
    if (thinkInterval) clearInterval(thinkInterval);
    if (isRecording) await stopAnswerRecording();
    if (recordedStream) recordedStream.getTracks().forEach(t => t.stop());
    if (audioStream) audioStream.getTracks().forEach(t => t.stop());
    if (mediaRecorder && mediaRecorder.state === 'recording') mediaRecorder.stop();
    if (timerInterval) clearInterval(timerInterval);
    window.speechSynthesis?.cancel();

    // Show thank you page
    goToScreen('thankYouScreen');

    // Upload video in background
    await new Promise(resolve => setTimeout(resolve, 800));
    if (videoBlob) await uploadVideo();

    // Trigger backend evaluation (fire and forget)
    try {
        await fetch(`${API_BASE}/api/interviews/evaluate/${interviewData.interviewId}`);
    } catch (e) { /* silent */ }
}

async function uploadVideo() {
    try {
        const formData = new FormData();
        formData.append('video', videoBlob, `interview_${interviewData.interviewId}.webm`);
        formData.append('candidate_name', interviewData.candidateName);
        formData.append('candidate_email', interviewData.candidateEmail);

        await fetch(`${API_BASE}/api/interviews/upload-video/${interviewData.interviewId}`,
            { method: 'POST', body: formData }
        );
    } catch (err) {
        console.error('Video upload error:', err);
    }
}

// ─── TIMER ────────────────────────────────────────────────────────────────────
function startInterviewTimer() {
    timerInterval = setInterval(() => {
        const elapsed = Date.now() - interviewStartTime;
        const m = Math.floor(elapsed / 60000);
        const s = Math.floor((elapsed % 60000) / 1000);
        document.getElementById('interviewTimer').textContent =
            `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
    }, 1000);
}

// ─── WAITING SCREEN ───────────────────────────────────────────────────────────
function showWaitingScreen(startTime, startTimeIST) {
    goToScreen('waitingScreen');
    if (startTimeIST) {
        const td = document.getElementById('scheduledTimeDisplay');
        td.textContent = startTimeIST;
    }
    updateWaitingCountdown(startTime);
    waitingInterval = setInterval(() => {
        if (new Date() >= startTime) {
            clearInterval(waitingInterval);
            window.location.reload();
        }
        updateWaitingCountdown(startTime);
    }, 1000);
}

function updateWaitingCountdown(startTime) {
    const diff = startTime - new Date();
    if (diff <= 0) {
        document.getElementById('waitingCountdown').textContent = '00:00:00';
        return;
    }
    const h = Math.floor(diff / 3600000);
    const m = Math.floor((diff % 3600000) / 60000);
    const s = Math.floor((diff % 60000) / 1000);
    document.getElementById('waitingCountdown').textContent =
        `${pad(h)}:${pad(m)}:${pad(s)}`;
}

function pad(n) { return String(n).padStart(2, '0'); }

// ─── HELPERS ──────────────────────────────────────────────────────────────────
function setStateLabel(text) {
    const el = document.getElementById('stateLabel');
    if (el) el.textContent = text;
}

function showFatalError(title, msg = '', icon = '⚠️') {
    document.body.innerHTML = `
        <div style="height:100vh;display:flex;align-items:center;justify-content:center;
            background:#030712;color:white;text-align:center;font-family:'Plus Jakarta Sans',sans-serif;">
            <div style="max-width:400px;padding:40px;">
                <div style="font-size:48px;margin-bottom:20px;">${icon}</div>
                <h2 style="font-size:1.5rem;font-weight:800;margin-bottom:12px;">${title}</h2>
                ${msg ? `<p style="color:#94a3b8;line-height:1.6;">${msg}</p>` : ''}
            </div>
        </div>
    `;
}