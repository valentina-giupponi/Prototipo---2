const camera = document.querySelector("#camera");
const canvas = document.querySelector("#snapshot");
const startCameraButton = document.querySelector("#startCamera");
const takePhotoButton = document.querySelector("#takePhoto");
const fileInput = document.querySelector("#fileInput");
const scanModeCheckbox = document.querySelector("#scanMode");
const statusText = document.querySelector("#status");
const cameraMessage = document.querySelector("#cameraMessage");
const captureView = document.querySelector("#captureView");
const loadingView = document.querySelector("#loadingView");
const confirmView = document.querySelector("#confirmView");
const wallNoticeView = document.querySelector("#wallNoticeView");
const confirmPreview = document.querySelector("#confirmPreview");
const retakeScanButton = document.querySelector("#retakeScan");
const confirmScanButton = document.querySelector("#confirmScan");
const confirmStatus = document.querySelector("#confirmStatus");

const usesBrowserStorage = location.protocol === "file:";
const localImageKey = "drawing-scan-prototype.latest";
const localImagesKey = "drawing-scan-prototype.images";
const imageChannel = "BroadcastChannel" in window ? new BroadcastChannel("drawing-scan-prototype") : null;
const maxScanSize = 1800;
const analysisDelay = 1600;
const wallNoticeDelay = 10000;
const frameSlots = [
  { id: "001", label: "Cornice 001", position: { x: 0.25, y: 0.25 } },
  { id: "002", label: "Cornice 002", position: { x: 0.75, y: 0.25 } },
  { id: "003", label: "Cornice 003", position: { x: 0.25, y: 0.75 } },
  { id: "004", label: "Cornice 004", position: { x: 0.75, y: 0.75 } },
  { id: "005", label: "Cornice 005", position: { x: 0.5, y: 0.5 } },
  { id: "006", label: "Cornice 006", position: { x: 0.5, y: 0.82 } }
];

let stream = null;
let pendingImageData = null;
let noticeTimeout = null;

startCameraButton.addEventListener("click", startCamera);
takePhotoButton.addEventListener("click", takePhoto);
fileInput.addEventListener("change", uploadSelectedFile);
retakeScanButton.addEventListener("click", discardPendingScan);
confirmScanButton.addEventListener("click", confirmPendingScan);

async function startCamera() {
  if (!navigator.mediaDevices?.getUserMedia) {
    setStatus("Camera non disponibile: usa il caricamento immagine.", true);
    return;
  }

  try {
    stream = await navigator.mediaDevices.getUserMedia({
      video: {
        facingMode: "environment",
        width: { ideal: 1600 },
        height: { ideal: 1200 }
      },
      audio: false
    });

    camera.srcObject = stream;
    cameraMessage.hidden = true;
    takePhotoButton.disabled = false;
    startCameraButton.textContent = "Camera attiva";
    startCameraButton.disabled = true;
    setStatus("Camera pronta. Inquadra il foglio e scansiona.");
  } catch (error) {
    console.error(error);
    setStatus("Permesso camera negato o non disponibile. Puoi caricare un'immagine.", true);
  }
}

async function takePhoto() {
  if (!stream) {
    setStatus("Attiva prima la camera.", true);
    return;
  }

  const width = camera.videoWidth;
  const height = camera.videoHeight;

  if (!width || !height) {
    setStatus("La camera non è ancora pronta. Riprova tra un attimo.", true);
    return;
  }

  drawToCanvas(camera, width, height);
  const imageData = scanModeCheckbox.checked
    ? scanDrawingFromCanvas(canvas)
    : canvas.toDataURL("image/png", 0.95);

  await prepareScanForConfirmation(imageData);
}

async function uploadSelectedFile(event) {
  const file = event.target.files?.[0];
  if (!file) {
    return;
  }

  try {
    const imageData = await createImageDataFromFile(file);
    await prepareScanForConfirmation(imageData);
  } catch (error) {
    console.error(error);
    setStatus("Non sono riuscito a leggere l'immagine.", true);
  } finally {
    fileInput.value = "";
  }
}

async function prepareScanForConfirmation(imageData) {
  pendingImageData = imageData;
  showView(loadingView);
  await wait(analysisDelay);
  confirmPreview.src = pendingImageData;
  confirmStatus.textContent = "Controlla il disegno prima di salvarlo.";
  confirmStatus.classList.remove("error");
  confirmScanButton.disabled = false;
  showView(confirmView);
}

function discardPendingScan() {
  pendingImageData = null;
  confirmPreview.removeAttribute("src");
  showView(captureView);
  setStatus("Scansione annullata. Puoi acquisire un nuovo disegno.");
}

async function confirmPendingScan() {
  if (!pendingImageData) {
    confirmStatus.textContent = "Nessuna scansione da confermare.";
    confirmStatus.classList.add("error");
    return;
  }

  confirmScanButton.disabled = true;
  confirmStatus.textContent = "Salvataggio del disegno...";
  confirmStatus.classList.remove("error");

  try {
    const image = await saveImage(pendingImageData);
    pendingImageData = null;
    confirmPreview.removeAttribute("src");
    showView(wallNoticeView);
    window.setTimeout(() => {
      showView(captureView);
      setStatus("Disegno salvato in " + (image.frame?.label || "parete") + ". Puoi scansionarne un altro.");
      confirmScanButton.disabled = false;
    }, wallNoticeDelay);
  } catch (error) {
    console.error(error);
    confirmStatus.textContent = "Non sono riuscito a salvare il disegno.";
    confirmStatus.classList.add("error");
    confirmScanButton.disabled = false;
  }
}

async function saveImage(imageData) {
  if (usesBrowserStorage) {
    return saveLocalImage(imageData);
  }

  const response = await fetch("api/upload", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ image: imageData })
  });

  if (!response.ok) {
    throw new Error("Upload failed");
  }

  return response.json();
}

function saveLocalImage(imageData) {
  const images = readLocalImages();
  const frame = getFrameSlot(images.length);
  const image = {
    id: String(Date.now()),
    dataUrl: imageData,
    frame,
    createdAt: new Date().toISOString()
  };

  images.push(image);
  localStorage.setItem(localImagesKey, JSON.stringify(images));
  localStorage.setItem(localImageKey, JSON.stringify(image));
  imageChannel?.postMessage({ type: "image", image });
  return image;
}

function showView(view) {
  window.clearTimeout(noticeTimeout);
  for (const screen of [captureView, loadingView, confirmView, wallNoticeView]) {
    const isActive = screen === view;
    screen.hidden = !isActive;
    screen.classList.toggle("is-active", isActive);
  }
}

function getFrameSlot(index) {
  const slot = frameSlots[index % frameSlots.length];
  return {
    ...slot,
    confidence: 1,
    detectedAt: new Date().toISOString()
  };
}

function readLocalImages() {
  try {
    const savedImages = localStorage.getItem(localImagesKey);

    if (savedImages) {
      return JSON.parse(savedImages);
    }

    const oldSavedImage = localStorage.getItem(localImageKey);
    return oldSavedImage ? [JSON.parse(oldSavedImage)] : [];
  } catch (error) {
    console.error(error);
    return [];
  }
}

async function createImageDataFromFile(file) {
  const image = await loadImageFromFile(file);
  drawToCanvas(image, image.naturalWidth, image.naturalHeight);

  if (scanModeCheckbox.checked) {
    return scanDrawingFromCanvas(canvas);
  }

  return canvas.toDataURL("image/png", 0.95);
}

function drawToCanvas(source, sourceWidth, sourceHeight) {
  const scale = Math.min(1, maxScanSize / Math.max(sourceWidth, sourceHeight));
  const width = Math.round(sourceWidth * scale);
  const height = Math.round(sourceHeight * scale);
  const context = canvas.getContext("2d", { willReadFrequently: true });

  canvas.width = width;
  canvas.height = height;
  context.clearRect(0, 0, width, height);
  context.drawImage(source, 0, 0, width, height);
}

function scanDrawingFromCanvas(sourceCanvas) {
  const context = sourceCanvas.getContext("2d", { willReadFrequently: true });
  const image = context.getImageData(0, 0, sourceCanvas.width, sourceCanvas.height);
  const data = image.data;
  const histogram = new Array(256).fill(0);

  for (let index = 0; index < data.length; index += 4) {
    const luminance = getLuminance(data[index], data[index + 1], data[index + 2]);
    histogram[luminance] += 1;
  }

  const paperTone = getHistogramPercentile(histogram, 0.78);
  const rawThreshold = Math.min(188, paperTone - 52, Math.max(95, getOtsuThreshold(histogram) + 18));
  const threshold = Math.max(72, rawThreshold);
  const edgeSoftness = 42;

  for (let index = 0; index < data.length; index += 4) {
    const luminance = getLuminance(data[index], data[index + 1], data[index + 2]);
    const ink = clamp((threshold - luminance) / edgeSoftness, 0, 1);
    const alpha = Math.round(smoothStep(ink) * 255);

    data[index] = 18;
    data[index + 1] = 22;
    data[index + 2] = 26;
    data[index + 3] = alpha < 18 ? 0 : alpha;
  }

  context.putImageData(image, 0, 0);
  return sourceCanvas.toDataURL("image/png");
}

function getLuminance(red, green, blue) {
  return Math.round(0.299 * red + 0.587 * green + 0.114 * blue);
}

function getOtsuThreshold(histogram) {
  const total = histogram.reduce((sum, count) => sum + count, 0);
  let sum = 0;

  for (let value = 0; value < histogram.length; value += 1) {
    sum += value * histogram[value];
  }

  let backgroundWeight = 0;
  let backgroundSum = 0;
  let bestVariance = 0;
  let threshold = 150;

  for (let value = 0; value < histogram.length; value += 1) {
    backgroundWeight += histogram[value];

    if (backgroundWeight === 0) {
      continue;
    }

    const foregroundWeight = total - backgroundWeight;

    if (foregroundWeight === 0) {
      break;
    }

    backgroundSum += value * histogram[value];
    const backgroundMean = backgroundSum / backgroundWeight;
    const foregroundMean = (sum - backgroundSum) / foregroundWeight;
    const variance = backgroundWeight * foregroundWeight * (backgroundMean - foregroundMean) ** 2;

    if (variance > bestVariance) {
      bestVariance = variance;
      threshold = value;
    }
  }

  return threshold;
}

function getHistogramPercentile(histogram, percentile) {
  const total = histogram.reduce((sum, count) => sum + count, 0);
  const target = total * percentile;
  let count = 0;

  for (let value = 0; value < histogram.length; value += 1) {
    count += histogram[value];

    if (count >= target) {
      return value;
    }
  }

  return 255;
}

function smoothStep(value) {
  return value * value * (3 - 2 * value);
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function loadImageFromFile(file) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    const objectUrl = URL.createObjectURL(file);

    image.onload = () => {
      URL.revokeObjectURL(objectUrl);
      resolve(image);
    };

    image.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error("Image load failed"));
    };

    image.src = objectUrl;
  });
}

function wait(ms) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function setStatus(message, isError = false) {
  statusText.textContent = message;
  statusText.classList.toggle("error", isError);
}
