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
const returnToScanButton = document.querySelector("#returnToScan");

const usesBrowserStorage = location.protocol === "file:";
const localImageKey = "drawing-scan-prototype.latest";
const localImagesKey = "drawing-scan-prototype.images";
const imageChannel = "BroadcastChannel" in window ? new BroadcastChannel("drawing-scan-prototype") : null;
const maxScanSize = 1800;
const analysisDelay = 1600;
const frameSlots = [
  { id: "001", label: "Cornice 001", position: { x: 0.18, y: 0.22 }, size: "small", role: "single" },
  { id: "002", label: "Cornice 002", position: { x: 0.42, y: 0.18 }, size: "small", role: "single" },
  { id: "003", label: "Cornice 003", position: { x: 0.68, y: 0.24 }, size: "small", role: "single" },
  { id: "004", label: "Cornice 004", position: { x: 0.2, y: 0.68 }, size: "small", role: "single" },
  { id: "005", label: "Cornice 005", position: { x: 0.48, y: 0.72 }, size: "small", role: "single" },
  { id: "006", label: "Cornice 006", position: { x: 0.74, y: 0.66 }, size: "small", role: "single" }
];

let stream = null;
let pendingScan = null;

startCameraButton.addEventListener("click", startCamera);
takePhotoButton.addEventListener("click", takePhoto);
fileInput.addEventListener("change", uploadSelectedFile);
retakeScanButton.addEventListener("click", discardPendingScan);
confirmScanButton.addEventListener("click", confirmPendingScan);
returnToScanButton.addEventListener("click", returnToScan);

async function startCamera() {
  if (!navigator.mediaDevices?.getUserMedia) {
    setStatus("Camera non disponibile: usa il caricamento immagine.", true);
    return;
  }

  try {
    stream = await navigator.mediaDevices.getUserMedia({
      video: {
        facingMode: "environment",
        width: { ideal: 1200 },
        height: { ideal: 1700 },
        aspectRatio: { ideal: 0.707 }
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

  drawVisibleCameraToCanvas();
  const scan = createScanFromCanvas(canvas);

  await prepareScanForConfirmation(scan);
}

async function uploadSelectedFile(event) {
  const file = event.target.files?.[0];
  if (!file) {
    return;
  }

  try {
    const scan = await createImageDataFromFile(file);
    await prepareScanForConfirmation(scan);
  } catch (error) {
    console.error(error);
    setStatus("Non sono riuscito a leggere l'immagine.", true);
  } finally {
    fileInput.value = "";
  }
}

async function prepareScanForConfirmation(scan) {
  pendingScan = scan;
  showView(loadingView);
  await wait(analysisDelay);
  confirmPreview.src = pendingScan.imageData;
  confirmStatus.textContent = pendingScan.symbol === "unknown"
    ? "Controlla il disegno. Non ho riconosciuto il simbolo della domanda."
    : "Domanda riconosciuta: " + getSymbolLabel(pendingScan.symbol) + ". Controlla il disegno prima di salvarlo.";
  confirmStatus.classList.toggle("error", pendingScan.symbol === "unknown");
  confirmScanButton.disabled = false;
  showView(confirmView);
}

function discardPendingScan() {
  pendingScan = null;
  confirmPreview.removeAttribute("src");
  showView(captureView);
  setStatus("Scansione annullata. Puoi acquisire un nuovo disegno.");
}

async function confirmPendingScan() {
  if (!pendingScan) {
    confirmStatus.textContent = "Nessuna scansione da confermare.";
    confirmStatus.classList.add("error");
    return;
  }

  confirmScanButton.disabled = true;
  confirmStatus.textContent = "Salvataggio del disegno...";
  confirmStatus.classList.remove("error");

  try {
    const image = await saveImage(pendingScan.imageData, pendingScan.symbol);
    pendingScan = null;
    confirmPreview.removeAttribute("src");
    confirmScanButton.disabled = false;
    showView(wallNoticeView);
    setStatus("Disegno salvato in " + (image.frame?.label || "parete") + ". Puoi scansionarne un altro.");
  } catch (error) {
    console.error(error);
    confirmStatus.textContent = "Non sono riuscito a salvare il disegno.";
    confirmStatus.classList.add("error");
    confirmScanButton.disabled = false;
  }
}

async function saveImage(imageData, symbol) {
  if (usesBrowserStorage) {
    return saveLocalImage(imageData, symbol);
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 10000); // 10 secondi timeout

  try {
    const response = await fetch("api/upload", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ image: imageData, symbol }),
      signal: controller.signal
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      throw new Error("Upload failed: " + response.status);
    }

    return response.json();
  } catch (error) {
    clearTimeout(timeoutId);
    if (error.name === "AbortError") {
      throw new Error("Timeout: il server non ha risposto in tempo");
    }
    throw error;
  }
}

function saveLocalImage(imageData, symbol) {
  const images = readLocalImages();
  const frame = getFrameSlot(images.length);
  const image = {
    id: String(Date.now()),
    dataUrl: imageData,
    symbol,
    frame,
    createdAt: new Date().toISOString()
  };

  images.push(image);
  localStorage.setItem(localImagesKey, JSON.stringify(images));
  localStorage.setItem(localImageKey, JSON.stringify(image));
  imageChannel?.postMessage({ type: "image", image });
  return image;
}

function returnToScan() {
  showView(captureView);
  setStatus("Puoi scansionare un nuovo disegno.");
}

function showView(view) {
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
    return createScanFromCanvas(canvas);
  }

  return createScanFromCanvas(canvas);
}

function createScanFromCanvas(sourceCanvas) {
  const symbol = detectQuestionSymbol(sourceCanvas);
  const drawingCanvas = cropDrawingCanvas(sourceCanvas);
  const imageData = scanModeCheckbox.checked
    ? scanDrawingFromCanvas(drawingCanvas)
    : drawingCanvas.toDataURL("image/png", 0.95);

  return { imageData, symbol };
}

function cropDrawingCanvas(sourceCanvas) {
  const crop = {
    x: Math.round(sourceCanvas.width * 0.06),
    y: Math.round(sourceCanvas.height * 0.31),
    width: Math.round(sourceCanvas.width * 0.88),
    height: Math.round(sourceCanvas.height * 0.57)
  };
  const drawingCanvas = document.createElement("canvas");
  const drawingContext = drawingCanvas.getContext("2d", { willReadFrequently: true });

  drawingCanvas.width = crop.width;
  drawingCanvas.height = crop.height;
  drawingContext.drawImage(
    sourceCanvas,
    crop.x,
    crop.y,
    crop.width,
    crop.height,
    0,
    0,
    crop.width,
    crop.height
  );

  return drawingCanvas;
}

function detectQuestionSymbol(sourceCanvas) {
  const context = sourceCanvas.getContext("2d", { willReadFrequently: true });
  const width = sourceCanvas.width;
  const height = sourceCanvas.height;
  const headerHeight = Math.round(height * 0.34);
  
  // Prova prima il riconoscimento del colore
  const colorDetected = detectSymbolColor(context, width, height, headerHeight);
  if (colorDetected !== "unknown") {
    return colorDetected;
  }
  
  // Fallback al template matching per forma
  const image = context.getImageData(0, 0, width, headerHeight);
  const minSymbolArea = width * height * 0.0016;
  const components = findDarkComponents(image, width, headerHeight, 154)
    .filter((component) => (
      component.area > minSymbolArea &&
      component.width > width * 0.045 &&
      component.height > height * 0.035
    ));

  const leftCandidate = getLargestComponent(components.filter((component) => (
    component.centerX < width * 0.32 &&
    component.centerY > height * 0.025 &&
    component.centerY < height * 0.24
  )));

  if (leftCandidate) {
    const verticalPosition = leftCandidate.centerY / height;

    if (verticalPosition < 0.115) {
      return "heart";
    }

    if (verticalPosition >= 0.105 && verticalPosition < 0.2) {
      return "star";
    }
  }

  const rightCandidate = getLargestComponent(components.filter((component) => (
    component.centerX > width * 0.6 &&
    component.centerY > height * 0.08 &&
    component.centerY < height * 0.32
  )));

  if (rightCandidate && rightCandidate.area > minSymbolArea * 1.3) {
    return "flower";
  }

  return "unknown";
}

function findDarkComponents(image, width, height, darkLimit) {
  const data = image.data;
  const visited = new Uint8Array(width * height);
  const components = [];

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const startIndex = y * width + x;

      if (visited[startIndex] || getPixelLuminance(data, startIndex) > darkLimit) {
        continue;
      }

      const queue = [startIndex];
      visited[startIndex] = 1;
      let cursor = 0;
      let minX = x;
      let minY = y;
      let maxX = x;
      let maxY = y;
      let area = 0;

      while (cursor < queue.length) {
        const current = queue[cursor++];
        const currentX = current % width;
        const currentY = Math.floor(current / width);
        area += 1;
        minX = Math.min(minX, currentX);
        minY = Math.min(minY, currentY);
        maxX = Math.max(maxX, currentX);
        maxY = Math.max(maxY, currentY);

        const neighbors = [
          currentX > 0 ? current - 1 : -1,
          currentX < width - 1 ? current + 1 : -1,
          currentY > 0 ? current - width : -1,
          currentY < height - 1 ? current + width : -1
        ];

        for (const neighbor of neighbors) {
          if (neighbor >= 0 && !visited[neighbor] && getPixelLuminance(data, neighbor) <= darkLimit) {
            visited[neighbor] = 1;
            queue.push(neighbor);
          }
        }
      }

      components.push({
        minX,
        minY,
        maxX,
        maxY,
        width: maxX - minX + 1,
        height: maxY - minY + 1,
        centerX: (minX + maxX) / 2,
        centerY: (minY + maxY) / 2,
        area
      });
    }
  }

  return components;
}

function getLargestComponent(components) {
  return components.reduce((largest, component) => (
    !largest || component.area > largest.area ? component : largest
  ), null);
}

function getPixelLuminance(data, pixelIndex) {
  const index = pixelIndex * 4;
  return getLuminance(data[index], data[index + 1], data[index + 2]);
}

function getSymbolLabel(symbol) {
  return {
    heart: "cuore",
    flower: "fiore",
    star: "stella",
    unknown: "simbolo non riconosciuto"
  }[symbol] || "simbolo non riconosciuto";
}

// Riconoscimento colore HSV per i simboli
function getRGB_Hue(r, g, b) {
  r /= 255;
  g /= 255;
  b /= 255;
  
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const delta = max - min;
  
  if (delta === 0) return 0;
  
  let hue;
  if (max === r) {
    hue = ((g - b) / delta) % 6;
  } else if (max === g) {
    hue = (b - r) / delta + 2;
  } else {
    hue = (r - g) / delta + 4;
  }
  
  hue = (hue * 60 + 360) % 360;
  return hue;
}

function getCircularMean(hues) {
  if (hues.length === 0) return 0;
  
  let sinSum = 0;
  let cosSum = 0;
  
  for (const hue of hues) {
    const radians = (hue * Math.PI) / 180;
    sinSum += Math.sin(radians);
    cosSum += Math.cos(radians);
  }
  
  const meanRadians = Math.atan2(sinSum / hues.length, cosSum / hues.length);
  const meanHue = (meanRadians * 180) / Math.PI;
  return (meanHue + 360) % 360;
}

function detectSymbolColor(context, width, height, headerHeight) {
  const imageData = context.getImageData(0, 0, width, headerHeight);
  const data = imageData.data;
  const hues = [];
  
  // Campiona i pixel della zona del simbolo (header)
  for (let i = 0; i < data.length; i += 4) {
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    const a = data[i + 3];
    
    // Salta pixel trasparenti o bianchi
    if (a < 200) continue;
    
    const luminance = getLuminance(r, g, b);
    if (luminance > 220) continue; // Salta pixel bianchi/chiari
    
    const hue = getRGB_Hue(r, g, b);
    hues.push(hue);
  }
  
  if (hues.length < 20) return "unknown"; // Non abbastanza pixel colorati
  
  const meanHue = getCircularMean(hues);
  
  // Determina il colore basato sulla media dell'Hue
  // Rosso (Cuore): H: 0-20° or 340-360° (H:9°)
  if (meanHue < 20 || meanHue > 340) {
    return "heart";
  }
  
  // Giallo (Stella): H: 40-60° (H:48°)
  if (meanHue >= 40 && meanHue <= 60) {
    return "star";
  }
  
  // Blu (Fiore): H: 200-220° (H:211°)
  if (meanHue >= 200 && meanHue <= 220) {
    return "flower";
  }
  
  return "unknown";
}


function drawVisibleCameraToCanvas() {
  const sourceWidth = camera.videoWidth;
  const sourceHeight = camera.videoHeight;
  const viewport = camera.getBoundingClientRect();
  const viewportAspect = viewport.width / viewport.height;
  const sourceAspect = sourceWidth / sourceHeight;
  let cropX = 0;
  let cropY = 0;
  let cropWidth = sourceWidth;
  let cropHeight = sourceHeight;

  if (sourceAspect > viewportAspect) {
    cropWidth = Math.round(sourceHeight * viewportAspect);
    cropX = Math.round((sourceWidth - cropWidth) / 2);
  } else {
    cropHeight = Math.round(sourceWidth / viewportAspect);
    cropY = Math.round((sourceHeight - cropHeight) / 2);
  }

  drawCroppedToCanvas(camera, cropX, cropY, cropWidth, cropHeight);
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

function drawCroppedToCanvas(source, sourceX, sourceY, sourceWidth, sourceHeight) {
  const scale = Math.min(1, maxScanSize / Math.max(sourceWidth, sourceHeight));
  const width = Math.round(sourceWidth * scale);
  const height = Math.round(sourceHeight * scale);
  const context = canvas.getContext("2d", { willReadFrequently: true });

  canvas.width = width;
  canvas.height = height;
  context.clearRect(0, 0, width, height);
  context.drawImage(source, sourceX, sourceY, sourceWidth, sourceHeight, 0, 0, width, height);
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

  const paperTone = getHistogramPercentile(histogram, 0.9);
  const darkTone = getHistogramPercentile(histogram, 0.06);
  const otsuThreshold = getOtsuThreshold(histogram);
  const threshold = clamp(Math.min(178, paperTone - 42, Math.max(darkTone + 62, otsuThreshold + 18)), 72, 178);
  const hardCutoff = Math.min(186, threshold + 14);
  const edgeSoftness = 50;

  for (let index = 0; index < data.length; index += 4) {
    const luminance = getLuminance(data[index], data[index + 1], data[index + 2]);
    const ink = luminance <= hardCutoff
      ? clamp((threshold - luminance + 18) / edgeSoftness, 0, 1)
      : 0;
    const alpha = Math.round(smoothStep(ink) * 255);

    data[index] = 18;
    data[index + 1] = 22;
    data[index + 2] = 26;
    data[index + 3] = alpha < 48 ? 0 : alpha;
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
