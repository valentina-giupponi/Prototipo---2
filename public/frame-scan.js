const camera = document.querySelector("#camera");
const canvas = document.querySelector("#snapshot");
const startCameraButton = document.querySelector("#startCamera");
const scanFrameButton = document.querySelector("#scanFrame");
const statusText = document.querySelector("#status");
const cameraMessage = document.querySelector("#cameraMessage");
const matchedImage = document.querySelector("#matchedImage");
const matchPlaceholder = document.querySelector("#matchPlaceholder");
const matchInfo = document.querySelector("#matchInfo");

const usesBrowserStorage = location.protocol === "file:" || location.hostname.endsWith("github.io");
const localImageKey = "drawing-scan-prototype.latest";
const localImagesKey = "drawing-scan-prototype.images";

let stream = null;
let images = [];

startCameraButton.addEventListener("click", startCamera);
scanFrameButton.addEventListener("click", scanFrame);

loadImages();

async function startCamera() {
  if (!navigator.mediaDevices?.getUserMedia) {
    setStatus("Camera non disponibile.", true);
    return;
  }

  try {
    stream = await navigator.mediaDevices.getUserMedia({
      video: {
        facingMode: "environment",
        width: { ideal: 1280 },
        height: { ideal: 960 }
      },
      audio: false
    });

    camera.srcObject = stream;
    cameraMessage.hidden = true;
    scanFrameButton.disabled = false;
    startCameraButton.textContent = "Camera attiva";
    startCameraButton.disabled = true;
    setStatus("Camera pronta. Inquadra il marker della cornice.");
  } catch (error) {
    console.error(error);
    setStatus("Permesso camera negato o non disponibile.", true);
  }
}

async function loadImages() {
  if (usesBrowserStorage) {
    images = readLocalImages();
    return;
  }

  try {
    const response = await fetch("api/images");
    images = await response.json();
  } catch (error) {
    console.error(error);
    setStatus("Non riesco a leggere i disegni salvati.", true);
  }
}

function scanFrame() {
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

  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  context.drawImage(camera, 0, 0, width, height);

  const marker = detectFrameMarker(canvas);

  if (!marker) {
    setStatus("Cornice non riconosciuta. Avvicina il codice e riprova.", true);
    return;
  }

  const match = findImageByFrame(marker.id);

  if (!match) {
    clearMatch();
    setStatus(`Riconosciuta ${marker.label}, ma nessun disegno risulta associato.`, true);
    matchInfo.textContent = "Controlla che un disegno sia stato proiettato in quella cornice.";
    return;
  }

  showMatch(match, marker);
  setStatus(`Riconosciuta ${marker.label}: disegno trovato.`);
}

function findImageByFrame(frameId) {
  return images.find((image) => image.frame?.id === frameId) || null;
}

function showMatch(image, marker) {
  matchedImage.src = image.dataUrl || `${image.url}?t=${Date.now()}`;
  matchedImage.hidden = false;
  matchPlaceholder.hidden = true;
  matchInfo.textContent = `${marker.label} contiene questo disegno.`;
}

function clearMatch() {
  matchedImage.removeAttribute("src");
  matchedImage.hidden = true;
  matchPlaceholder.hidden = false;
}

function detectFrameMarker(sourceCanvas) {
  const size = Math.min(sourceCanvas.width, sourceCanvas.height);
  const sampleSize = Math.min(360, size);
  const scanCanvas = document.createElement("canvas");
  const scanContext = scanCanvas.getContext("2d", { willReadFrequently: true });
  const sourceX = Math.round((sourceCanvas.width - size) / 2);
  const sourceY = Math.round((sourceCanvas.height - size) / 2);

  scanCanvas.width = sampleSize;
  scanCanvas.height = sampleSize;
  scanContext.drawImage(sourceCanvas, sourceX, sourceY, size, size, 0, 0, sampleSize, sampleSize);

  const image = scanContext.getImageData(0, 0, sampleSize, sampleSize);
  const luminance = [];

  for (let index = 0; index < image.data.length; index += 4) {
    luminance.push(getLuminance(image.data[index], image.data[index + 1], image.data[index + 2]));
  }

  const threshold = getOtsuThreshold(buildHistogram(luminance));
  const bounds = findDarkBounds(luminance, sampleSize, threshold);

  if (!bounds) {
    return null;
  }

  const markerSize = Math.max(bounds.width, bounds.height);

  if (markerSize < sampleSize * 0.12) {
    return null;
  }

  const grid = sampleMarkerGrid(luminance, sampleSize, threshold, bounds, 6);
  const borderScore = getBorderScore(grid);

  if (borderScore < 0.45) {
    return null;
  }

  const bits = getInnerBits(grid);
  const numericId = parseInt(bits.join(""), 2);
  const id = String(Number.isFinite(numericId) ? numericId : 0).padStart(3, "0");

  return {
    id,
    label: `Cornice ${id}`,
    confidence: Number(borderScore.toFixed(2))
  };
}

function buildHistogram(values) {
  const histogram = new Array(256).fill(0);

  for (const value of values) {
    histogram[value] += 1;
  }

  return histogram;
}

function findDarkBounds(luminance, size, threshold) {
  let minX = size;
  let minY = size;
  let maxX = 0;
  let maxY = 0;
  let count = 0;
  const darkLimit = Math.min(125, threshold + 10);

  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      if (luminance[y * size + x] <= darkLimit) {
        minX = Math.min(minX, x);
        minY = Math.min(minY, y);
        maxX = Math.max(maxX, x);
        maxY = Math.max(maxY, y);
        count += 1;
      }
    }
  }

  if (count < size * size * 0.015) {
    return null;
  }

  return {
    minX,
    minY,
    maxX,
    maxY,
    width: maxX - minX + 1,
    height: maxY - minY + 1
  };
}

function sampleMarkerGrid(luminance, imageSize, threshold, bounds, gridSize) {
  const grid = [];
  const squareSize = Math.max(bounds.width, bounds.height);
  const startX = Math.round((bounds.minX + bounds.maxX - squareSize) / 2);
  const startY = Math.round((bounds.minY + bounds.maxY - squareSize) / 2);
  const darkLimit = Math.min(140, threshold + 20);

  for (let row = 0; row < gridSize; row += 1) {
    const cells = [];

    for (let col = 0; col < gridSize; col += 1) {
      const x0 = Math.round(startX + (col / gridSize) * squareSize);
      const x1 = Math.round(startX + ((col + 1) / gridSize) * squareSize);
      const y0 = Math.round(startY + (row / gridSize) * squareSize);
      const y1 = Math.round(startY + ((row + 1) / gridSize) * squareSize);
      let darkPixels = 0;
      let totalPixels = 0;

      for (let y = Math.max(0, y0); y < Math.min(imageSize, y1); y += 1) {
        for (let x = Math.max(0, x0); x < Math.min(imageSize, x1); x += 1) {
          darkPixels += luminance[y * imageSize + x] <= darkLimit ? 1 : 0;
          totalPixels += 1;
        }
      }

      cells.push(totalPixels > 0 && darkPixels / totalPixels > 0.48 ? 1 : 0);
    }

    grid.push(cells);
  }

  return grid;
}

function getBorderScore(grid) {
  let borderCells = 0;
  let darkBorderCells = 0;
  const last = grid.length - 1;

  for (let row = 0; row < grid.length; row += 1) {
    for (let col = 0; col < grid[row].length; col += 1) {
      if (row === 0 || col === 0 || row === last || col === last) {
        borderCells += 1;
        darkBorderCells += grid[row][col];
      }
    }
  }

  return darkBorderCells / borderCells;
}

function getInnerBits(grid) {
  const bits = [];

  for (let row = 1; row < grid.length - 1; row += 1) {
    for (let col = 1; col < grid[row].length - 1; col += 1) {
      bits.push(grid[row][col]);
    }
  }

  return bits;
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

function setStatus(message, isError = false) {
  statusText.textContent = message;
  statusText.classList.toggle("error", isError);
}
