// ==================== BAGIAN 1: SETUP STT (Web Speech API) ====================

const SpeechRecognition =
  window.SpeechRecognition || window.webkitSpeechRecognition;

if (SpeechRecognition) {
  const recognition = new SpeechRecognition();
  recognition.lang = "id-ID";
  recognition.continuous = true;
  recognition.interimResults = true;

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

    // Tampilkan hasil STT ke layar
    const speechResult = document.getElementById("speech-result");
    speechResult.innerHTML = `STT: ${finalTranscript} <i style="color:gray">${interimTranscript}</i>`;
  };

  recognition.onerror = (event) => {
    console.error("STT Error:", event.error);

    if (event.error === "no-speech") {
      console.log("STT Error: no-speech, mencoba ulang...");
      recognition.stop();
      setTimeout(() => recognition.start(), 1000);
    }

    if (event.error === "not-allowed") {
      alert("Izin mikrofon ditolak. Silakan izinkan akses mikrofon.");
    }
  };

  recognition.onend = () => {
    console.warn("STT berhenti, mencoba mengaktifkan ulang...");
    recognition.start();
  };

  recognition.start();
} else {
  alert("Browser tidak mendukung Web Speech API. Gunakan Google Chrome.");
}

// ==================== BAGIAN 2: SETUP DETEKSI GESTURE (MediaPipe + TFJS) ====================

let sibiModel = null;
let bisindoModel = null;
let currentMode = "sibi";
let currentStream;
let lastGesture = "";
let sentence = "";
let lastUpdateTime = 0;
const gestureDelay = 2000;
let predicitionHistory = []; // Riwayat prediksi untuk stabilisasi
const maxHistory = 10; // Ukuran maksimum riwayat prediksi
let lastAddedTIme = 0; // Waktu penambahan terakhir ke riwayat
let predictionBuffer = []; // Buffer untuk stabilisasi prediksi
const bufferSize = 15; // Ukuran buffer prediksi (kalimat)
const cooldown = 1000; // Cooldown antara penambahan kalimat
let kalimat = ""; // Kalimat yang dibangun dari gesture
const kalimatText = document.getElementById("kalimat");
const gestureLabel = document.getElementById("gesture");

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
  // Angka
  "1",
  "2",
  "3",
  "4",
  "5",
  "6",
  "7",
  "8",
  "9",

  // Huruf
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

  // Kata umum
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
];

//---------------------Load Model----------------/
async function loadModel() {
  currentMode = document.getElementById("mode-select").value;

  // Update opsi tangan sesuai mode
  hands.setOptions({
    maxNumHands: currentMode === "bisindo" ? 2 : 1,
    modelComplexity: 0,
    minDetectionConfidence: 0.7,
    minTrackingConfidence: 0.7,
  });

  // Model SIBI
  if (currentMode === "sibi" && !sibiModel) {
    sibiModel = await tf.loadGraphModel("./tfjs_model_sibi/tfjs/model.json");
    console.log("Model SIBI loaded");
  }

  // Model BISINDO
  if (currentMode === "bisindo" && !bisindoModel) {
    bisindoModel = await tf.loadGraphModel("./tfjs_bisindo/model_bisindo.json");
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
      alert("Tidak dapat mengakses kamera apa pun.");
    }
  }
}

// Kamera aktif
const camera = new Camera(videoElement, {
  onFrame: async () => {
    if (getActiveModel()) {
      await hands.send({ image: videoElement });
    }
  },
  width: 640,
  height: 480,
});

//-----------------MediaPipe Hands-----------------/
const hands = new Hands({
  locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${file}`,
});

let isCanvasInitialized = false;

// Saat hasil deteksi tangan diterima
hands.onResults((results) => {
  // Jalankan inisialisasi canvas hanya sekali saat pertama kali video sudah aktif
  if (
    !isCanvasInitialized &&
    videoElement.videoWidth > 0 &&
    videoElement.videoHeight > 0
  ) {
    canvasElement.width = videoElement.videoWidth;
    canvasElement.height = videoElement.videoHeight;
    isCanvasInitialized = true;
  }

  // Bersihkan canvas dan gambar ulang dari frame video
  canvasCtx.clearRect(0, 0, canvasElement.width, canvasElement.height);
  canvasCtx.drawImage(
    videoElement,
    0,
    0,
    canvasElement.width,
    canvasElement.height
  );

  // Jika tidak ada tangan, hentikan proses
  if (!results.multiHandLandmarks || results.multiHandLandmarks.length === 0)
    return;

  // Warna tergantung mode
  const boxColor = currentMode === "sibi" ? "lime" : "red";
  canvasCtx.strokeStyle = boxColor;
  canvasCtx.fillStyle = boxColor;
  canvasCtx.font = "16px Arial";

  // Ambil semua titik tangan
  const allLandmarks = results.multiHandLandmarks.flat();
  const x =
    (allLandmarks.reduce((sum, p) => sum + p.x, 0) / allLandmarks.length) *
    canvasElement.width;
  const y =
    (allLandmarks.reduce((sum, p) => sum + p.y, 0) / allLandmarks.length) *
    canvasElement.height;

  // Gambar titik dan garis tangan
  results.multiHandLandmarks.forEach((landmarks) => {
    drawConnectors(canvasCtx, landmarks, HAND_CONNECTIONS, {
      color: boxColor,
      lineWidth: 2,
    });
    drawLandmarks(canvasCtx, landmarks, { color: boxColor, lineWidth: 1 });
  });

  // Ubah ke array flat (x, y, z)
  const flat = allLandmarks.flatMap((p) => [p.x, p.y, p.z]);
  const expectedLength = currentMode === "sibi" ? 63 : 126;

  if (flat.length === expectedLength) {
    tf.tidy(() => {
      const input = tf.tensor(flat).reshape([1, expectedLength, 1]);
      const model = getActiveModel();
      if (!model) return;

      const pred = model.predict(input);
      pred.array().then((p) => {
        const gesture = getLabel(p[0]);

        // Masukkan gesture ke buffer prediksi
        predictionBuffer.push(gesture);
        if (predictionBuffer.length > bufferSize) predictionBuffer.shift();
        const majority = getMajorityVote(predictionBuffer);

        // Update kalimat jika gesture baru dan cukup jeda
        // Update kalimat jika gesture baru dan cukup jeda
        if (
          majority !== lastGesture &&
          Date.now() - lastUpdateTime > gestureDelay
        ) {
          sentence += majority + " ";
          lastGesture = majority;
          lastUpdateTime = Date.now();

          // Update tampilan
          document.getElementById("sentence-result").innerText =
            "Kalimat: " + sentence.trim();

          // Kirim ke MQTT
          sendPrediction(majority);
        }

        // Tampilkan gesture di layar
        document.getElementById("gesture-result").innerText =
          "Gesture: " + majority;
        canvasCtx.fillText(majority, x, y - 10);
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

// Fungsi utama update prediksi gesture
function updateGesture(predictedGesture) {
  predictionHistory.push(predictedGesture);
  if (predictionHistory.length > maxHistory) {
    predictionHistory.shift(); // Hapus prediksi lama
  }

  const majorityGesture = getMajorityVote(predictionHistory);
  gestureLabel.innerText = "Gesture: " + majorityGesture;

  const now = Date.now();

  // Tambahkan ke kalimat hanya jika gesture berubah & sudah lewat cooldown
  if (
    majorityGesture &&
    majorityGesture !== lastGesture &&
    now - lastAddedTime > cooldown
  ) {
    kalimat += majorityGesture + " ";
    kalimatText.innerText = "Kalimat: " + kalimat;
    lastGesture = majorityGesture;
    lastAddedTime = now;
  }
}

// =================== MAIN (inisialisasi utama) ===================
async function main() {
  document.getElementById("gesture-result").innerText =
    "Gesture: Memuat model...";
  await getCameras();
  await switchCamera();
  await loadModel();
  camera.start();
  document.getElementById("gesture-result").innerText = "Gesture: -";
}

main();

document.getElementById("mode-select").addEventListener("change", loadModel);

//-----------------------MQTT--------------------//
function updateKalimat(gesture) {
  const now = Date.now();
  predictionBuffer.push(gesture);
  if (predictionBuffer.length > bufferSize) predictionBuffer.shift();

  const majority = getMajorityVote(predictionBuffer);

  if (majority !== lastGesture && now - lastUpdateTime > gestureDelay) {
    sentence += majority + " ";
    document.getElementById("sentence-result").innerText =
      "Kalimat: " + sentence.trim();
    lastGesture = majority;
    lastUpdateTime = now;
    sendPrediction(majority);
  }
}
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
