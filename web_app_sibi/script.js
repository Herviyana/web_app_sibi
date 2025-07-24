let model;
let currentStream;
let lastGesture = "";
let sentence = "";
let lastUpdateTime = 0;
const gestureDelay = 1000;

// Label untuk SIBI
const sibiLabels = [
  "Sibi_A",
  "Sibi_B",
  "Sibi_C",
  "Sibi_D",
  "Sibi_E",
  "Sibi_F",
  "Sibi_G",
  "Sibi_H",
  "Sibi_I",
  "Sibi_K",
  "Sibi_L",
  "Sibi_M",
  "Sibi_N",
  "Sibi_O",
  "Sibi_P",
  "Sibi_Q",
  "Sibi_R",
  "Sibi_S",
  "Sibi_T",
  "Sibi_U",
  "Sibi_V",
  "Sibi_W",
  "Sibi_X",
  "Sibi_Y",
];

// Label untuk BISINDO
const bisindoLabels = [
  "Angka_1",
  "Angka_2",
  "Angka_3",
  "Angka_4",
  "Angka_5",
  "Angka_6",
  "Angka_7",
  "Angka_8",
  "Angka_9",
  "Bisindo_a",
  "Bisindo_b",
  "Bisindo_c",
  "Bisindo_d",
  "Bisindo_e",
  "Bisindo_f",
  "Bisindo_g",
  "Bisindo_h",
  "Bisindo_i",
  "Bisindo_j",
  "Bisindo_k",
  "Bisindo_l",
  "Bisindo_m",
  "Bisindo_n",
  "Bisindo_o",
  "Bisindo_p",
  "Bisindo_q",
  "Bisindo_r",
  "Bisindo_s",
  "Bisindo_t",
  "Bisindo_u",
  "Bisindo_v",
  "Bisindo_w",
  "Bisindo_x",
  "Bisindo_y",
  "Bisindo_z",
  "Kata_Benar",
  "Kata_Bertemu",
  "Kata_Bis",
  "Kata_Kamu",
  "Kata_Kapan",
  "Kata_Maaf",
  "Kata_Makan",
  "Kata_Minum",
  "Kata_Mobil",
  "Kata_Motor",
  "Kata_Sama-sama",
  "Kata_Terimakasih",
];

// Load model sesuai mode
async function loadModel() {
  const mode = document.getElementById("mode-select").value;

  try {
    if (mode === "sibi") {
      model = await tf.loadGraphModel("tfjs_sibi/model_sibi.json");
    } else {
      model = await tf.loadGraphModel("tfjs_bisindo/model_bisindo.json");
    }
    console.log(`Model ${mode} berhasil dimuat.`);
  } catch (err) {
    console.error("Gagal memuat model:", err);
  }
}

function predict(inputTensor) {
  if (!model) {
    console.error("Model belum dimuat, tidak bisa memprediksi.");
    return;
  }

  try {
    const output = model.predict(inputTensor);
    output.print();
    // lakukan sesuatu dengan output (misal: argMax, ubah ke label)
  } catch (e) {
    console.error("Gagal prediksi:", e);
  }
}

// Deteksi kamera
async function getCameras() {
  const devices = await navigator.mediaDevices.enumerateDevices();
  const videoDevices = devices.filter((device) => device.kind === "videoinput");
  const select = document.getElementById("camera-select");
  select.innerHTML = "";
  videoDevices.forEach((device, i) => {
    const opt = document.createElement("option");
    opt.value = device.deviceId;
    opt.innerText = device.label || `Kamera ${i + 1}`;
    select.appendChild(opt);
  });
}

// Ganti kamera
async function switchCamera() {
  const deviceId = document.getElementById("camera-select").value;
  if (currentStream) currentStream.getTracks().forEach((t) => t.stop());
  currentStream = await navigator.mediaDevices.getUserMedia({
    video: { deviceId: { exact: deviceId } },
  });
  document.getElementById("webcam").srcObject = currentStream;
}

// Ambil label gesture
function getLabel(pred) {
  const mode = document.getElementById("mode-select").value;
  const idx = pred.indexOf(Math.max(...pred));
  return mode === "sibi" ? sibiLabels[idx] : bisindoLabels[idx];
}

// Update kalimat dari gesture
function updateSentence(gesture) {
  const now = Date.now();
  if (gesture !== lastGesture && now - lastUpdateTime > gestureDelay) {
    sentence += gesture + " ";
    document.getElementById("sentence-result").innerText =
      "Kalimat: " + sentence.trim();
    lastGesture = gesture;
    lastUpdateTime = now;
  }
}

function predict(inputTensor) {
  if (!model) {
    console.error("Model belum siap.");
    return;
  }

  const prediction = model.predict(inputTensor);
  prediction.print();
}

// Reset kalimat
function resetSentence() {
  sentence = "";
  lastGesture = "";
  document.getElementById("sentence-result").innerText = "Kalimat: ";
}

// TTS – Text-to-speech
function speakSentence() {
  const utterance = new SpeechSynthesisUtterance(sentence.trim());
  utterance.lang = "id-ID";
  speechSynthesis.speak(utterance);
}

// Inisialisasi Mediapipe Hands
const hands = new Hands({
  locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${file}`,
});
hands.setOptions({
  maxNumHands: 2,
  modelComplexity: 0,
  minDetectionConfidence: 0.7,
  minTrackingConfidence: 0.7,
});

hands.onResults((results) => {
  if (!results.multiHandLandmarks || results.multiHandLandmarks.length === 0)
    return;

  const landmarks = results.multiHandLandmarks
    .flat()
    .flatMap((p) => [p.x, p.y, p.z]);
  if (landmarks.length !== 63 && landmarks.length !== 126) return;

  tf.tidy(() => {
    const input = tf.tensor(landmarks).reshape([1, landmarks.length, 1]);
    const pred = model.predict(input);
    pred.array().then((p) => {
      const gesture = getLabel(p[0]);
      document.getElementById("gesture-result").innerText =
        "Gesture: " + gesture;
      updateSentence(gesture);
    });
  });
});

// Inisialisasi kamera dan canvas
const videoElement = document.getElementById("webcam");
const camera = new Camera(videoElement, {
  onFrame: async () => await hands.send({ image: videoElement }),
  width: 640,
  height: 480,
});

// STT – Speech-to-text
const SpeechRecognition =
  window.SpeechRecognition || window.webkitSpeechRecognition;
const recognition = new SpeechRecognition();
recognition.lang = "id-ID";
recognition.continuous = true;
recognition.onresult = (e) => {
  const text = e.results[e.results.length - 1][0].transcript;
  document.getElementById("speech-result").innerText = "STT: " + text;
};
recognition.start();

// Fungsi inisialisasi utama untuk memastikan urutan yang benar
async function main() {
  document.getElementById("gesture-result").innerText =
    "Gesture: Memuat model...";
  await loadModel(); // 1. Tunggu hingga model selesai dimuat
  await getCameras(); // 2. Dapatkan daftar kamera
  camera.start(); // 3. Baru jalankan kamera setelah semua siap
  document.getElementById("gesture-result").innerText = "Gesture: -";
}

main(); // Jalankan aplikasi

document.getElementById("mode-select").addEventListener("change", loadModel);
