// Fréquences des cordes standard d'une guitare (en Hz)
const notes = {
    'E2': 82.41,  // Mi grave
    'A2': 110.00, // La
    'D3': 146.83, // Ré
    'G3': 196.00, // Sol
    'B3': 246.94, // Si
    'E4': 329.63  // Mi aigu
};

// Contexte audio
const audioContext = new (window.AudioContext || window.webkitAudioContext)();
let analyser, source, activeNote = null;

// Jouer une note de référence
function playNote(note) {
    const oscillator = audioContext.createOscillator();
    oscillator.type = 'sine';
    oscillator.frequency.setValueAtTime(notes[note], audioContext.currentTime);
    oscillator.connect(audioContext.destination);
    oscillator.start();
    oscillator.stop(audioContext.currentTime + 2);

    // Mettre à jour l'indicateur pour la note jouée
    document.querySelectorAll('.string').forEach(string => {
        const indicator = string.querySelector('.indicator');
        if (string.dataset.note === note) {
            indicator.classList.add('in-tune');
            setTimeout(() => indicator.classList.remove('in-tune'), 2000);
        }
    });
}

// Détection de la fréquence via le micro
async function startMicrophone() {
    try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        source = audioContext.createMediaStreamSource(stream);
        analyser = audioContext.createAnalyser();
        analyser.fftSize = 2048;
        source.connect(analyser);
        detectPitch();
    } catch (err) {
        console.error('Erreur d’accès au micro :', err);
        alert('Impossible d’accéder au micro. Vérifiez les permissions.');
    }
}

// Algorithme de détection de hauteur (basé sur autocorrélation)
function detectPitch() {
    const buffer = new Float32Array(analyser.fftSize);
    analyser.getFloatTimeDomainData(buffer);
    let bestOffset = -1;
    let bestCorrelation = 0;
    let rms = 0;

    for (let i = 0; i < buffer.length; i++) {
        rms += buffer[i] * buffer[i];
    }
    rms = Math.sqrt(rms / buffer.length);
    if (rms < 0.01) {
        requestAnimationFrame(detectPitch);
        return;
    }

    let lastCorrelation = 1;
    for (let offset = 0; offset < buffer.length; offset++) {
        let correlation = 0;
        for (let i = 0; i < buffer.length - offset; i++) {
            correlation += Math.abs(buffer[i] - buffer[i + offset]);
        }
        correlation = 1 - correlation / buffer.length;
        if (correlation > bestCorrelation && correlation > 0.9 * lastCorrelation) {
            bestCorrelation = correlation;
            bestOffset = offset;
        }
        lastCorrelation = correlation;
    }

    if (bestCorrelation > 0.98) {
        const fundamental = audioContext.sampleRate / bestOffset;
        updateIndicator(fundamental);
    }

    requestAnimationFrame(detectPitch);
}

// Mettre à jour l'indicateur visuel
function updateIndicator(frequency) {
    let closestNote = null;
    let minDiff = Infinity;

    for (const [note, freq] of Object.entries(notes)) {
        const diff = Math.abs(frequency - freq);
        if (diff < minDiff) {
            minDiff = diff;
            closestNote = note;
        }
    }

    document.querySelectorAll('.string').forEach(string => {
        const indicator = string.querySelector('.indicator');
        if (string.dataset.note === closestNote) {
            const diff = frequency - notes[closestNote];
            const isInTune = Math.abs(diff) < 2;
            indicator.classList.toggle('in-tune', isInTune);
        } else {
            indicator.classList.remove('in-tune');
        }
    });
}

// Gestionnaires d'événements
document.getElementById('startMic').addEventListener('click', startMicrophone);

document.querySelectorAll('.string').forEach(string => {
    string.addEventListener('click', () => {
        const note = string.dataset.note;
        playNote(note);
        activeNote = note;
    });
    string.addEventListener('touchstart', (e) => {
        e.preventDefault();
        const note = string.dataset.note;
        playNote(note);
        activeNote = note;
    });
});