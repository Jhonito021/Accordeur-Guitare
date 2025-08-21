(function() {
    'use strict';

    // UI elements
    const startStopButton = document.getElementById('toggleBtn');
    const modeSelect = document.getElementById('modeSelect');
    const noteNameEl = document.getElementById('noteName');
    const frequencyEl = document.getElementById('frequencyDisplay');
    const centsEl = document.getElementById('centsDisplay');
    const needleEl = document.getElementById('needle');
    const themeToggle = document.getElementById('themeToggle');

    // Audio state
    let audioContext = null;
    let analyser = null;
    let mediaStreamSource = null;
    let mediaStream = null;
    let rafId = null;
    let timeDomainBuffer = null;

    // Smoothing for frequency readout
    let smoothedFrequency = 0;

    // Target string frequencies (standard EADGBE)
    const stringTargets = {
        E2: 82.4069,
        A2: 110.0000,
        D3: 146.8324,
        G3: 195.9977,
        B3: 246.9417,
        E4: 329.6276
    };

    const NOTE_NAMES = [
        'Do', 'Do#', 'Ré', 'Ré#', 'Mi', 'Fa', 'Fa#', 'Sol', 'Sol#', 'La', 'La#', 'Si'
    ];

    function frequencyToNoteData(frequency) {
        if (!frequency || !isFinite(frequency) || frequency <= 0) {
            return null;
        }
        const A4 = 440;
        const n = Math.round(12 * Math.log2(frequency / A4)) + 69; // MIDI note number
        const noteIndex = ((n % 12) + 12) % 12;
        const octave = Math.floor(n / 12) - 1;
        const noteName = `${NOTE_NAMES[noteIndex]}${octave}`;
        const exactFreq = A4 * Math.pow(2, (n - 69) / 12);
        const cents = 1200 * Math.log2(frequency / exactFreq);
        return { noteName, cents, exactFreq };
    }

    function centsToRotation(cents) {
        // Clamp to [-50, 50] cents and map to [-45deg, 45deg]
        const clamped = Math.max(-50, Math.min(50, cents));
        return (clamped / 50) * 45;
    }

    function setUIWaiting() {
        noteNameEl.textContent = '--';
        frequencyEl.textContent = '-- Hz';
        centsEl.textContent = '-- cts';
        if (needleEl) {
            needleEl.style.transform = 'translateX(-50%) rotate(0deg)';
        }
    }

    function applyTheme(theme) {
        const html = document.documentElement;
        html.setAttribute('data-bs-theme', theme);
        document.body.classList.toggle('bg-dark', theme === 'dark');
        document.body.classList.toggle('text-light', theme === 'dark');
    }

    function initTheme() {
        const saved = localStorage.getItem('tuner-theme') || 'light';
        applyTheme(saved);
        if (themeToggle) {
            themeToggle.checked = saved === 'dark';
            themeToggle.addEventListener('change', () => {
                const next = themeToggle.checked ? 'dark' : 'light';
                applyTheme(next);
                localStorage.setItem('tuner-theme', next);
            });
        }
    }

    async function start() {
        if (audioContext) {
            return;
        }
        try {
            const stream = await navigator.mediaDevices.getUserMedia({
                audio: {
                    echoCancellation: false,
                    noiseSuppression: false,
                    autoGainControl: false
                }
            });
            mediaStream = stream;
            audioContext = new (window.AudioContext || window.webkitAudioContext)();
            analyser = audioContext.createAnalyser();
            analyser.fftSize = 2048;
            analyser.smoothingTimeConstant = 0;
            timeDomainBuffer = new Float32Array(analyser.fftSize);
            mediaStreamSource = audioContext.createMediaStreamSource(stream);
            mediaStreamSource.connect(analyser);

            smoothedFrequency = 0;
            update();
        } catch (err) {
            console.error('Microphone access error:', err);
            alert('Impossible d\'accéder au microphone. Vérifiez les permissions.');
        }
    }

    function stop() {
        if (rafId) {
            cancelAnimationFrame(rafId);
            rafId = null;
        }
        if (mediaStream) {
            mediaStream.getTracks().forEach(t => t.stop());
            mediaStream = null;
        }
        if (mediaStreamSource) {
            mediaStreamSource.disconnect();
            mediaStreamSource = null;
        }
        if (analyser) {
            analyser.disconnect();
            analyser = null;
        }
        if (audioContext) {
            // On Safari, closing might throw; guard it
            try { audioContext.close(); } catch (e) {}
            audioContext = null;
        }
        setUIWaiting();
    }

    function update() {
        if (!analyser) {
            return;
        }
        analyser.getFloatTimeDomainData(timeDomainBuffer);
        const frequency = autoCorrelate(timeDomainBuffer, audioContext.sampleRate);

        if (frequency > 0) {
            if (smoothedFrequency === 0) {
                smoothedFrequency = frequency;
            } else {
                smoothedFrequency = smoothedFrequency * 0.85 + frequency * 0.15;
            }
        }

        const displayFreq = smoothedFrequency || 0;
        if (displayFreq > 0) {
            const mode = modeSelect ? modeSelect.value : 'auto';
            let targetFreq = null;
            let noteData = frequencyToNoteData(displayFreq);

            if (mode && mode !== 'auto' && stringTargets[mode]) {
                targetFreq = stringTargets[mode];
                // Compute cents relative to target frequency
                const cents = 1200 * Math.log2(displayFreq / targetFreq);
                noteNameEl.textContent = mode;
                frequencyEl.textContent = `${displayFreq.toFixed(2)} Hz`;
                centsEl.textContent = `${cents.toFixed(1)} cts`;
                const deg = centsToRotation(cents);
                needleEl.style.transform = `translateX(-50%) rotate(${deg}deg)`;
            } else {
                // Auto mode
                if (noteData) {
                    noteNameEl.textContent = noteData.noteName;
                    frequencyEl.textContent = `${displayFreq.toFixed(2)} Hz`;
                    centsEl.textContent = `${noteData.cents.toFixed(1)} cts`;
                    const deg = centsToRotation(noteData.cents);
                    needleEl.style.transform = `translateX(-50%) rotate(${deg}deg)`;
                }
            }
        } else {
            setUIWaiting();
        }

        rafId = requestAnimationFrame(update);
    }

    // Basic time-domain auto-correlation to estimate fundamental frequency
    function autoCorrelate(buffer, sampleRate) {
        const SIZE = buffer.length;
        let rms = 0;
        for (let i = 0; i < SIZE; i++) {
            const val = buffer[i];
            rms += val * val;
        }
        rms = Math.sqrt(rms / SIZE);
        if (rms < 0.01) {
            return -1; // Too quiet
        }

        let r1 = 0, r2 = SIZE - 1, threshold = 0.2;
        // Trim buffer edges where the signal is below the threshold
        for (let i = 0; i < SIZE / 2; i++) {
            if (Math.abs(buffer[i]) < threshold) { r1 = i; break; }
        }
        for (let i = 1; i < SIZE / 2; i++) {
            if (Math.abs(buffer[SIZE - i]) < threshold) { r2 = SIZE - i; break; }
        }

        const newBuffer = buffer.slice(r1, r2);
        const newSize = newBuffer.length;

        const autocorr = new Float32Array(newSize);
        for (let lag = 0; lag < newSize; lag++) {
            let sum = 0;
            for (let i = 0; i < newSize - lag; i++) {
                sum += newBuffer[i] * newBuffer[i + lag];
            }
            autocorr[lag] = sum;
        }

        let bestOffset = -1;
        let bestCorrelation = 0;
        let foundPeak = false;
        const minLag = Math.floor(sampleRate / 1000); // up to 1000 Hz
        const maxLag = Math.floor(sampleRate / 60);   // down to 60 Hz

        for (let lag = minLag; lag <= Math.min(maxLag, newSize - 1); lag++) {
            const correlation = autocorr[lag];
            if (correlation > bestCorrelation) {
                bestCorrelation = correlation;
                bestOffset = lag;
            }
            if (correlation > (autocorr[lag - 1] || 0) && correlation > (autocorr[lag + 1] || 0) && correlation > 0.9 * bestCorrelation) {
                foundPeak = true;
            }
        }

        if (bestOffset > 0 && foundPeak) {
            // Parabolic interpolation around the best offset for finer resolution
            const x0 = (autocorr[bestOffset - 1] || 0);
            const x1 = autocorr[bestOffset];
            const x2 = (autocorr[bestOffset + 1] || 0);
            const a = x0 - 2 * x1 + x2;
            const b = (x2 - x0) / 2;
            const shift = a ? -b / (2 * a) : 0;
            const period = bestOffset + shift;
            const frequency = sampleRate / period;
            return frequency;
        }

        return -1;
    }

    function toggle() {
        if (audioContext) {
            stop();
            startStopButton.innerHTML = '<i class="fa-solid fa-microphone me-2"></i>Démarrer';
        } else {
            start().then(() => {
                startStopButton.innerHTML = '<i class="fa-solid fa-square me-2"></i>Arrêter';
            });
        }
    }

    // Wire up events
    if (startStopButton) {
        startStopButton.addEventListener('click', toggle);
    }

    if (modeSelect) {
        modeSelect.addEventListener('change', () => {
            // Reset smoothing when changing target
            smoothedFrequency = 0;
        });
    }

    // Initialize UI
    setUIWaiting();
    initTheme();
})(); 