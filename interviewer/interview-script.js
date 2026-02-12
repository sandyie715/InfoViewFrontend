const API_BASE = 'http://localhost:5000';

// ─── TTS: browser built-in (free, no OpenAI cost) ────────────────────────────
function speakQuestion(question) {
    if ('speechSynthesis' in window) {
        window.speechSynthesis.cancel();
        const utterance = new SpeechSynthesisUtterance(question);
        utterance.rate = 0.95;
        window.speechSynthesis.speak(utterance);
    }
}

// ─── STT: audio recording → Whisper API (via backend) ───────────────────────
let audioRecorder = null;       // dedicated MediaRecorder for answer audio
let audioChunks = [];
let isRecording = false;

// Separate audio-only stream for Whisper (we already have video via recordedStream)
let audioStream = null;

async function startAudioRecorder() {
    // Reuse the existing recorded stream's audio tracks if available,
    // otherwise request a fresh audio-only stream.
    try {
        if (recordedStream) {
            const audioTracks = recordedStream.getAudioTracks();
            if (audioTracks.length > 0) {
                audioStream = new MediaStream(audioTracks);
            }
        }
        if (!audioStream) {
            audioStream = await navigator.mediaDevices.getUserMedia({ audio: true });
        }
    } catch (err) {
        console.error('Cannot access microphone:', err);
        showError('Microphone access denied');
    }
}

function startAnswerRecording() {
    if (!audioStream) {
        console.error('Audio stream not ready');
        return;
    }
    audioChunks = [];
    audioRecorder = new MediaRecorder(audioStream);
    audioRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) audioChunks.push(e.data);
    };
    audioRecorder.start();
    isRecording = true;

    document.getElementById('micButton').classList.add('listening');
    document.getElementById('micStatus').textContent = 'Recording...';
    document.getElementById('transcriptionDisplay').textContent = 'Speak now...';
    document.getElementById('nextBtn').disabled = true;
    console.log('🎙️ Answer recording started');
}

async function stopAnswerRecording() {
    if (!audioRecorder || audioRecorder.state === 'inactive') return;

    return new Promise((resolve) => {
        audioRecorder.onstop = async () => {
            isRecording = false;
            document.getElementById('micButton').classList.remove('listening');
            document.getElementById('micStatus').textContent = 'Transcribing...';

            const audioBlob = new Blob(audioChunks, { type: 'audio/webm' });
            const transcript = await transcribeWithWhisper(audioBlob);

            document.getElementById('transcriptionDisplay').textContent =
                transcript || '(No speech detected)';
            document.getElementById('micStatus').textContent = 'Click to Re-record';

            if (transcript) {
                currentTranscript = transcript;
                document.getElementById('nextBtn').disabled = false;
            }
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

        if (!response.ok) {
            console.error('Whisper API error:', await response.text());
            return '';
        }

        const data = await response.json();
        console.log('✅ Whisper transcript:', data.transcript);
        return data.transcript || '';
    } catch (err) {
        console.error('Transcription request failed:', err);
        return '';
    }
}

function toggleListening() {
    if (isRecording) {
        stopAnswerRecording();
    } else {
        currentTranscript = '';
        startAnswerRecording();
    }
}

// ─── Everything below is unchanged from original ─────────────────────────────

let interviewData = null;
let interviewStartTime = null;
let mediaRecorder = null;
let recordedChunks = [];
let currentTranscript = '';
let timerInterval = null;
let videoBlob = null;
let recordedStream = null;
let waitingInterval = null;
let currentQuestion = '';

document.addEventListener('DOMContentLoaded', async () => {
    const params = new URLSearchParams(window.location.search);
    const interviewId = params.get("id");

    if (!interviewId) {
        showError("Invalid interview link");
        return;
    }

    try {
        const statusResponse = await fetch(`${API_BASE}/api/scheduler/status?id=${interviewId}`);
        const statusData = await statusResponse.json();

        console.log('[DEBUG] Status Response:', statusData);

        if (statusData.status === "completed") {
            document.body.innerHTML = `
                <div style="height:100vh;display:flex;align-items:center;justify-content:center;
                background:#030712;color:white;text-align:center;">
                    <div>
                        <div style="font-size:48px;margin-bottom:20px;">✅</div>
                        <h2 style="color:#FFFFFF;">Interview Already Completed</h2>
                        <p style="color:#94a3b8;margin-top:10px;">
                            Thank you for attending. Our team will get back to you shortly.
                        </p>
                    </div>
                </div>
            `;
            return;
        }

        if (statusData.status === "already_started") {
            document.body.innerHTML = `
                <div style="height:100vh;display:flex;align-items:center;justify-content:center;
                background:#030712;color:white;text-align:center;">
                    <div>
                        <div style="font-size:48px;margin-bottom:20px;">⚠️</div>
                        <h2 style="color:#FFFFFF;">Interview Already Started</h2>
                        <p style="color:#94a3b8;margin-top:10px;">
                            This interview is already in progress from another device or window.
                        </p>
                        <p style="color:#94a3b8;margin-top:15px; font-size: 14px;">
                            If you think this is an error, please contact your recruiter.
                        </p>
                    </div>
                </div>
            `;
            return;
        }

        if (statusData.status === "waiting") {
            showWaitingScreen(new Date(statusData.start_time), statusData.start_time_ist);
            return;
        }

        if (statusData.status === "expired") {
            document.body.innerHTML = `
                <div style="height: 100vh; display: flex; align-items: center; justify-content: center; background: #030712; color: white; text-align: center;">
                    <div>
                        <div style="font-size: 40px; margin-bottom: 20px;">⏰</div>
                        <h2 style="color:#FFFFFF;">Interview window has closed</h2>
                        <p style="color: #94a3b8; margin-top: 10px;">Please contact your recruiter to reschedule</p>
                    </div>
                </div>
            `;
            return;
        }

        if (statusData.status === "live") {
            interviewData = {
                interviewId: statusData.interviewId,
                candidateName: statusData.candidateName,
                candidateEmail: statusData.candidateEmail,
                jobDescription: statusData.jobDescription
            };
            await initializeInterview();
        }
    } catch (error) {
        console.error('[ERROR] Status check failed:', error);
        showError('Failed to validate session');
    }
});

async function initializeInterview() {
    document.getElementById('waitingScreen').classList.remove('active');
    document.getElementById('interviewSection').classList.add('active');

    await startCamera();                // sets up recordedStream (video + audio)
    await startAudioRecorder();         // prepares audio stream for Whisper
    await generateQuestions();
    interviewStartTime = Date.now();
    startInterviewTimer();
    await loadNextQuestion();
}

function showWaitingScreen(startTime, startTimeIST) {
    document.getElementById('waitingScreen').classList.add('active');
    if (startTimeIST) {
        const timeDisplay = document.getElementById('scheduledTimeDisplay');
        timeDisplay.textContent = startTimeIST;
        timeDisplay.style.color = '#F06767';
        timeDisplay.style.fontWeight = '700';
    }
    updateWaitingCountdown(startTime);
    waitingInterval = setInterval(() => {
        const now = new Date();
        if (now >= startTime) {
            clearInterval(waitingInterval);
            window.location.reload();
        }
        updateWaitingCountdown(startTime);
    }, 1000);
}

function updateWaitingCountdown(startTime) {
    const now = new Date();
    const diff = startTime - now;

    if (diff <= 0) {
        document.getElementById('waitingCountdown').textContent = '00:00:00';
        return;
    }

    const hours = Math.floor(diff / (1000 * 60 * 60));
    const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
    const seconds = Math.floor((diff % (1000 * 60)) / 1000);

    const countdownElement = document.getElementById('waitingCountdown');
    countdownElement.textContent =
        `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
    countdownElement.style.color = '#FFFFFF';
    countdownElement.style.textShadow = '0 0 30px rgba(240, 103, 103, 0.4)';
}

async function startCamera() {
    try {
        const stream = await navigator.mediaDevices.getUserMedia({
            video: { width: { ideal: 1280 }, height: { ideal: 720 } },
            audio: true
        });

        recordedStream = stream;
        document.getElementById('cameraFeed').srcObject = stream;
        startRecording(stream);
    } catch (error) {
        showError('Camera access denied');
    }
}

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
        console.log('[DEBUG] Generate Questions Response:', result);

        if (result.status === "already_started") {
            document.body.innerHTML = `
                <div style="height:100vh;display:flex;align-items:center;justify-content:center;
                background:#030712;color:white;text-align:center;">
                    <div>
                        <div style="font-size:48px;margin-bottom:20px;">⚠️</div>
                        <h2 style="color:#FFFFFF;">Interview Already Started</h2>
                        <p style="color:#94a3b8;margin-top:10px;">
                            This interview is already in progress from another device or window.
                        </p>
                        <p style="color:#94a3b8;margin-top:15px; font-size: 14px;">
                            If you think this is an error, please contact your recruiter.
                        </p>
                    </div>
                </div>
            `;
            return;
        }

        if (result.status === "completed") {
            document.body.innerHTML = `
                <div style="height:100vh;display:flex;align-items:center;justify-content:center;
                background:#030712;color:white;text-align:center;">
                    <div>
                        <div style="font-size:48px;margin-bottom:20px;">✅</div>
                        <h2 style="color:#FFFFFF;">Interview Already Completed</h2>
                        <p style="color:#94a3b8;margin-top:10px;">
                            Thank you for attending. Our team will get back to you shortly.
                        </p>
                    </div>
                </div>
            `;
            return;
        }

        if (result.status === "success") {
            console.log('Questions generated:', result.total);
        } else {
            showError(result.message || 'Failed to generate questions');
        }
    } catch (error) {
        console.error('[ERROR] Generate questions failed:', error);
        showError('Failed to generate questions');
    }
}

async function loadNextQuestion() {
    try {
        const response = await fetch(`${API_BASE}/api/interviews/next-question/${interviewData.interviewId}`);
        const data = await response.json();

        if (data.done) {
            await endInterview();
            return;
        }

        currentQuestion = data.question;
        document.getElementById('questionLabel').textContent =
            `Question ${data.questionNumber} of ${data.totalQuestions}`;
        document.getElementById('questionText').textContent = currentQuestion;
        document.getElementById('transcriptionDisplay').textContent =
            'Click microphone and speak...';
        document.getElementById('nextBtn').disabled = true;
        currentTranscript = '';

        // ✅ TTS: free browser speechSynthesis — no OpenAI call
        speakQuestion(currentQuestion);
    } catch (error) {
        console.error('[ERROR] Load next question failed:', error);
        showError('Failed to load question');
    }
}

async function submitAnswer() {
    try {
        // Stop recording if still active, wait for transcript
        if (isRecording) {
            await stopAnswerRecording();
        }

        const answer = currentTranscript.trim() || 'No answer provided';

        await fetch(`${API_BASE}/api/interviews/submit-answer/${interviewData.interviewId}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                question: currentQuestion,
                answer: answer
            })
        });

        await loadNextQuestion();
    } catch (error) {
        console.error('[ERROR] Submit answer failed:', error);
    }
}

async function endInterview() {
    if (isRecording) await stopAnswerRecording();
    if (recordedStream) recordedStream.getTracks().forEach(track => track.stop());
    if (audioStream) audioStream.getTracks().forEach(track => track.stop());
    if (mediaRecorder && mediaRecorder.state === 'recording') mediaRecorder.stop();
    if (timerInterval) clearInterval(timerInterval);

    document.getElementById('interviewSection').classList.remove('active');
    document.getElementById('feedbackSection').classList.add('active');

    await new Promise(resolve => setTimeout(resolve, 1000));

    if (videoBlob) {
        await uploadVideo();
    }

    await getEvaluation();
}

async function uploadVideo() {
    try {
        const formData = new FormData();
        formData.append('video', videoBlob, `interview_${interviewData.interviewId}.webm`);
        formData.append('candidate_name', interviewData.candidateName);
        formData.append('candidate_email', interviewData.candidateEmail);

        const response = await fetch(
            `${API_BASE}/api/interviews/upload-video/${interviewData.interviewId}`,
            { method: 'POST', body: formData }
        );
        const result = await response.json();
        console.log('Video upload:', result.status);
    } catch (error) {
        console.error('Video upload error:', error);
    }
}

async function getEvaluation() {
    try {
        const loadingDiv = document.getElementById('loadingFeedback');
        loadingDiv.innerHTML = `
            <div class="loading-spinner"></div>
            <p style="font-weight: 600; color: #777777;">Generating AI Evaluation...</p>
        `;

        const response = await fetch(
            `${API_BASE}/api/interviews/evaluate/${interviewData.interviewId}`
        );
        const evaluation = await response.json();
        displayFeedback(evaluation);
    } catch (error) {
        document.getElementById('loadingFeedback').innerHTML = `
            <p style="color: #ef4444; font-weight: 600;">Unable to retrieve scores</p>
        `;
    }
}

function displayFeedback(evaluation) {
    document.getElementById('loadingFeedback').style.display = 'none';
    document.getElementById('feedbackContent').style.display = 'block';

    document.getElementById('technicalScore').textContent =
        `${evaluation.technical_score}/10`;
    document.getElementById('communicationScore').textContent =
        `${evaluation.communication_score}/10`;
    document.getElementById('overallScore').textContent =
        `${evaluation.overall_score}/10`;

    const recBox = document.getElementById('recommendationBox');
    const recType = evaluation.recommendation.toLowerCase();
    recBox.className = `recommendation ${recType}`;
    recBox.innerHTML =
        `<h3>Recommendation: ${evaluation.recommendation}</h3><p>${evaluation.feedback}</p>`;

    document.getElementById('feedbackText').textContent = evaluation.feedback;
}

function startInterviewTimer() {
    timerInterval = setInterval(() => {
        const elapsed = Date.now() - interviewStartTime;
        const minutes = Math.floor(elapsed / 60000);
        const seconds = Math.floor((elapsed % 60000) / 1000);
        document.getElementById('interviewTimer').textContent =
            `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
    }, 1000);
}

function showError(message) {
    document.body.innerHTML = `
        <div style="height: 100vh; display: flex; align-items: center; justify-content: center; background: #030712; color: white; text-align: center;">
            <div style="max-width: 400px;">
                <div style="font-size: 40px; margin-bottom: 20px;">⚠️</div>
                <h2 style="color:#FFFFFF;">${message}</h2>
                <button onclick="location.reload()" style="margin-top: 25px; padding: 12px 28px; border-radius: 12px; border: none; background: linear-gradient(135deg, #F06767 0%, #E85555 100%); color: #FFFFFF; cursor: pointer; font-weight: 700; font-size: 16px; box-shadow: 0 8px 20px rgba(240, 103, 103, 0.3); transition: all 0.3s ease;" onmouseover="this.style.transform='translateY(-2px)'" onmouseout="this.style.transform='translateY(0)'">Retry</button>
            </div>
        </div>
    `;
}