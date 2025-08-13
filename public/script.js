// ==================== BAGIAN 1: SETUP STT (Web Speech API) ====================

// Pindahkan deklarasi ke scope global agar bisa diakses di mana saja
let recognition = null;
let isRecognizing = false;
const errorContainer = document.getElementById("error-container");

function showError(message) {
  errorContainer.textContent = message;
  errorContainer.style.display = "block";
  setTimeout(() => {
    errorContainer.style.display = "none";
  }, 5000); // Sembunyikan setelah 5 detik
}

const SpeechRecognition =
  window.SpeechRecognition || window.webkitSpeechRecognition;

if (SpeechRecognition) {
  recognition = new SpeechRecognition(); // Gunakan variabel global, jangan deklarasi ulang
  recognition.lang = "id-ID";
  recognition.continuous = true;
  recognition.interimResults = true;

  // Handle hasil STT
  recognition.onresult = (event) => {
    let finalTranscript = "";
    let interimTranscript = "";

    for (let i = event.resultIndex; i < event.results.length; ++i) {
      const transcript = event.results[i][0].transcript;
      if (event.results[i].isFinal) {
        finalTranscript += transcript;
      } else {
        interimTranscript += transcript;
      }
    }

    const speechResult = document.getElementById("speech-result");
    speechResult.innerHTML = `STT: ${finalTranscript} <i style="color:gray">${interimTranscript}</i>`;
  };

  // Handle error STT
  recognition.onerror = (event) => {
    console.error("STT Error:", event.error);

    if (event.error === "no-speech") {
      console.log("STT Error: no-speech, mencoba ulang...");
      if (isRecognizing) {
        recognition.stop(); // stop dulu
      }
    }

    if (event.error === "not-allowed") {
      showError(
        "Izin mikrofon ditolak. Silakan izinkan akses mikrofon di pengaturan browser Anda."
      );
    }
  };

  // Handle ketika STT berhenti → start ulang otomatis
  recognition.onend = () => {
    console.warn("STT berhenti, mencoba mengaktifkan ulang...");
    isRecognizing = false;
    // Hanya restart otomatis jika mode suara masih aktif
    if (inputMode === "voice") {
      setTimeout(() => {
        try {
          recognition.start();
        } catch (error) {
          console.warn("Gagal memulai ulang STT:", error.message);
        }
      }, 1000);
    }
  };

  recognition.onstart = () => {
    isRecognizing = true;
    console.log("STT dimulai...");
  };
} else {
  showError(
    "Browser tidak mendukung Web Speech API. Fitur suara tidak akan berfungsi. Silakan gunakan Google Chrome."
  );
}

// ==================== BAGIAN 2: SETUP DETEKSI GESTURE (MediaPipe + TFJS) ====================

let sibiModel = null;
let bisindoModel = null;
let currentMode = "sibi";
let inputMode = "none"; // 'none', 'voice', 'gesture'
let currentStream;
let lastGesture = "";
let sentence = "";
const gestureDelay = 2000;
let predicitionHistory = []; // Riwayat prediksi untuk stabilisasi
const maxHistory = 10; // Ukuran maksimum riwayat prediksi
let lastAddedTIme = 0; // Waktu penambahan terakhir ke riwayat
let predictionBuffer = []; // Buffer untuk stabilisasi prediksi
const bufferSize = 8; // Ukuran buffer prediksi (kalimat)
const cooldown = 2000; // Cooldown antara penambahan kalimat
let kalimat = ""; // Kalimat yang dibangun dari gesture
const kalimatText = document.getElementById("kalimat");
const gestureLabel = document.getElementById("gesture");
let selectedDeviceId = null;
let lastUpdateTime = 0;

//Label SIBI dan BISINDO
const sibiLabels = [
  "A",
  "B",
  "C",
  "D",
  "E",
  "F",
  "G",
  "H",
  "I",
  "K",
  "L",
  "M",
  "N",
  "O",
  "P",
  "Q",
  "R",
  "S",
  "T",
  "U",
  "V",
  "W",
  "X",
  "Y",
];
const bisindoLabels = [
  "1",
  "2",
  "3",
  "4",
  "5",
  "6",
  "7",
  "8",
  "9",
  "Benar",
  "Bertemu",
  "Bis",
  "Kamu",
  "Kapan",
  "Maaf",
  "Makan",
  "Minum",
  "Mobil",
  "Motor",
  "Sama-sama",
  "Terimakasih",
  "a",
  "b",
  "c",
  "d",
  "e",
  "f",
  "g",
  "h",
  "i",
  "j",
  "k",
  "l",
  "m",
  "n",
  "o",
  "p",
  "q",
  "r",
  "s",
  "t",
  "u",
  "v",
  "w",
  "x",
  "y",
  "z",
];

//---------------------Load Model----------------/
async function loadModel() {
  currentMode = document.getElementById("mode-select").value;

  // Update opsi tangan sesuai mode
  hands.setOptions({
    maxNumHands: currentMode === "bisindo" ? 2 : 1,
    modelComplexity: 1,
    minDetectionConfidence: 0.6,
    minTrackingConfidence: 0.6,
  });

  // Model SIBI
  if (currentMode === "sibi" && !sibiModel) {
    sibiModel = await tf.loadGraphModel("./tfjs_model_sibi/tfjs/model.json");
    console.log("Model SIBI loaded");
  }

  // Model BISINDO
  if (currentMode === "bisindo" && !bisindoModel) {
    bisindoModel = await tf.loadGraphModel("./tfjs_bisindo/model.json");
    console.log("Model BISINDO loaded");
  }
}

function getActiveModel() {
  return currentMode === "sibi" ? sibiModel : bisindoModel;
}

function getLabel(pred) {
  const idx = pred.indexOf(Math.max(...pred));
  return currentMode === "sibi" ? sibiLabels[idx] : bisindoLabels[idx];
}

//-----------------MediaPipe Hands-----------------/
const hands = new Hands({
  locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${file}`,
});

let isCanvasInitialized = false;

// Saat hasil deteksi tangan diterima
hands.onResults((results) => {
  if (
    !isCanvasInitialized &&
    videoElement.videoWidth > 0 &&
    videoElement.videoHeight > 0
  ) {
    canvasElement.width = videoElement.videoWidth;
    canvasElement.height = videoElement.videoHeight;
    isCanvasInitialized = true;
  }

  canvasCtx.clearRect(0, 0, canvasElement.width, canvasElement.height);
  canvasCtx.drawImage(
    videoElement,
    0,
    0,
    canvasElement.width,
    canvasElement.height
  );

  const handCount = results.multiHandLandmarks?.length || 0;

  // Validasi jumlah tangan berdasarkan mode
  if (
    (currentMode === "sibi" && handCount !== 1) ||
    (currentMode === "bisindo" && handCount === 0)
  )
    return;

  const boxColor = currentMode === "sibi" ? "lime" : "red";
  canvasCtx.strokeStyle = boxColor;
  canvasCtx.fillStyle = boxColor;
  canvasCtx.font = "16px Arial";

  // Gabungkan semua landmark dari semua tangan
  let allLandmarks = [];

  if (currentMode === "sibi") {
    allLandmarks = results.multiHandLandmarks[0]; // Ambil hanya 1 tangan
  } else if (currentMode === "bisindo") {
    if (handCount === 2) {
      allLandmarks = [
        ...results.multiHandLandmarks[0],
        ...results.multiHandLandmarks[1],
      ];
    } else if (handCount === 1) {
      const zeroLandmarks = Array(21).fill({ x: 0, y: 0, z: 0 });
      allLandmarks = [...results.multiHandLandmarks[0], ...zeroLandmarks];
    }
  }

  // Hitung posisi rata-rata untuk menampilkan label gesture
  const x =
    (allLandmarks.reduce((sum, p) => sum + p.x, 0) / allLandmarks.length) *
    canvasElement.width;
  const y =
    (allLandmarks.reduce((sum, p) => sum + p.y, 0) / allLandmarks.length) *
    canvasElement.height;

  // Gambar landmark dan konektor
  results.multiHandLandmarks.forEach((landmarks) => {
    drawConnectors(canvasCtx, landmarks, HAND_CONNECTIONS, {
      color: boxColor,
      lineWidth: 2,
    });
    drawLandmarks(canvasCtx, landmarks, { color: boxColor, lineWidth: 1 });
  });

  // Ubah ke array 1 dimensi (x,y,z)
  const flat = allLandmarks.flatMap((p) => [p.x, p.y, p.z]);
  const expectedLength = currentMode === "sibi" ? 63 : 126;

  if (flat.length === expectedLength) {
    tf.tidy(() => {
      const input = tf.tensor(flat).reshape([1, expectedLength, 1]);
      const model = getActiveModel();
      if (!model) return;

      const pred = model.predict(input);
      pred.array().then((p) => {
        const maxConfidence = Math.max(...p[0]);
        const gesture = getLabel(p[0]);

        // Selalu update akurasi untuk memberikan feedback real-time
        document.getElementById("confidence-result").innerText = `Akurasi: ${(
          maxConfidence * 100
        ).toFixed(2)}%`;

        if (maxConfidence < 0.8) {
          document.getElementById("gesture-result").innerText =
            "Gesture: (Akurasi rendah)";
          return; // Hentikan jika akurasi tidak cukup
        }

        predictionBuffer.push(gesture);
        if (predictionBuffer.length > bufferSize) predictionBuffer.shift();
        const majority = getMajorityVote(predictionBuffer);

        if (
          majority !== lastGesture &&
          Date.now() - lastUpdateTime > gestureDelay
        ) {
          sentence += majority + " ";
          lastGesture = majority;
          lastUpdateTime = Date.now();

          // Perbaiki bug update kalimat dan panggil MQTT
          document.getElementById("sentence-result").innerText =
            "Kalimat: " + sentence.trim();
          sendPrediction(majority);
        }

        document.getElementById("gesture-result").innerText =
          "Gesture: " + majority;
        canvasCtx.fillText(
          `${majority} (${(maxConfidence * 100).toFixed(0)}%)`,
          x,
          y - 10
        );
      });
    });
  }
});

// Fungsi untuk mengambil vote terbanyak (majority vote)
function getMajorityVote(arr) {
  const freq = {};
  arr.forEach((item) => {
    freq[item] = (freq[item] || 0) + 1;
  });
  let majority = arr[0];
  let maxCount = 0;
  for (const key in freq) {
    if (freq[key] > maxCount) {
      majority = key;
      maxCount = freq[key];
    }
  }
  return majority;
}

//---------------------Kalimat dan suara ----------------/
function resetSentence() {
  sentence = "";
  lastGesture = "";
  document.getElementById("sentence-result").innerText = "Kalimat:";
}

function speakSentence() {
  const utterance = new SpeechSynthesisUtterance(sentence.trim());
  utterance.lang = "id-ID";
  speechSynthesis.speak(utterance);
}

//---------------------Webcam----------------/
const videoElement = document.getElementById("webcam");
const canvasElement = document.getElementById("output-canvas");
const canvasCtx = canvasElement.getContext("2d");

// Webcam
async function getCameras() {
  const devices = await navigator.mediaDevices.enumerateDevices();
  const videoDevices = devices.filter((d) => d.kind === "videoinput");
  const select = document.getElementById("camera-select");
  select.innerHTML = "";
  videoDevices.forEach((device, i) => {
    const opt = document.createElement("option");
    opt.value = device.deviceId;
    opt.innerText = device.label || `Kamera ${i + 1}`;
    select.appendChild(opt);
  });
}

async function switchCamera() {
  try {
    const constraints = {
      video: {
        deviceId: selectedDeviceId ? { exact: selectedDeviceId } : undefined,
      },
    };
    stream = await navigator.mediaDevices.getUserMedia(constraints);
    videoElement.srcObject = stream;
  } catch (error) {
    console.error("Gagal mengakses kamera:", error);

    // fallback: minta akses ke kamera default
    try {
      const fallbackStream = await navigator.mediaDevices.getUserMedia({
        video: true,
      });
      videoElement.srcObject = fallbackStream;
    } catch (fallbackError) {
      showError("Tidak dapat mengakses kamera. Pastikan Anda memberikan izin.");
    }
  }
}

// Kamera aktif
const camera = new Camera(videoElement, {
  onFrame: async () => {
    // Hanya proses gesture jika mode gestur aktif dan model sudah dimuat
    if (inputMode === "gesture" && getActiveModel()) {
      await hands.send({ image: videoElement });
    }
  },
  width: 640,
  height: 480,
});

// ==================== BAGIAN 3: KONTROL MODE INPUT ====================
const voiceModeBtn = document.getElementById("voice-mode-btn");
const gestureModeBtn = document.getElementById("gesture-mode-btn");
const inputModeStatus = document.getElementById("input-mode-status");
const speechResultEl = document.getElementById("speech-result");
const gestureResultEl = document.getElementById("gesture-result");
const confidenceResultEl = document.getElementById("confidence-result");

function activateVoiceMode() {
  if (inputMode === "voice") return; // Sudah aktif
  console.log("Mengaktifkan Mode Suara...");
  inputMode = "voice";

  // Update UI
  inputModeStatus.textContent = "Suara Aktif";
  inputModeStatus.style.color = "#5cb85c"; // Hijau
  voiceModeBtn.disabled = true;
  gestureModeBtn.disabled = false;

  // Beri penekanan visual pada output STT
  speechResultEl.style.opacity = 1;
  gestureResultEl.style.opacity = 0.5;
  confidenceResultEl.style.opacity = 0.5;

  // Mulai STT
  if (recognition && !isRecognizing) {
    try {
      recognition.start();
    } catch (e) {
      console.error("Gagal memulai STT:", e);
    }
  }
}

function activateGestureMode() {
  if (inputMode === "gesture") return; // Sudah aktif
  console.log("Mengaktifkan Mode Gestur...");
  inputMode = "gesture";

  // Update UI
  inputModeStatus.textContent = "Gestur Aktif";
  inputModeStatus.style.color = "#5bc0de"; // Biru
  voiceModeBtn.disabled = false;
  gestureModeBtn.disabled = true;

  // Beri penekanan visual pada output Gesture
  speechResultEl.style.opacity = 0.5;
  gestureResultEl.style.opacity = 1;
  confidenceResultEl.style.opacity = 1;

  // Hentikan STT jika sedang berjalan
  if (recognition && isRecognizing) {
    recognition.stop();
  }
}

// =================== MAIN (inisialisasi utama) ===================
async function main() {
  document.getElementById("gesture-result").innerText =
    "Gesture: Memuat model...";
  await getCameras();
  await switchCamera();
  await loadModel();
  gestureModeBtn.disabled = false; // Aktifkan tombol gestur setelah model siap
  camera.start();
  document.getElementById("gesture-result").innerText = "Gesture: -";
}

main();

document.getElementById("mode-select").addEventListener("change", loadModel);

voiceModeBtn.addEventListener("click", activateVoiceMode);
gestureModeBtn.addEventListener("click", activateGestureMode);

async function sendPrediction(gesture) {
  try {
    const response = await fetch("/prediction", {
      method: "POST",
      headers: { "Content-Type": "text/plain" },
      body: `${gesture}`, // ✅ Kirim gesture sebagai plain text
    });

    const result = await response.json();
    console.log("✅ Publish:", result);
  } catch (err) {
    console.error("❌ Error:", err);
  }
}
