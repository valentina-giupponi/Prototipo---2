const camera = document.querySelector("#camera");
const canvas = document.querySelector("#snapshot");
const startCameraButton = document.querySelector("#startCamera");
const scanFrameButton = document.querySelector("#scanFrame");
const statusText = document.querySelector("#status");
const cameraMessage = document.querySelector("#cameraMessage");
const matchedImage = document.querySelector("#matchedImage");
const matchPlaceholder = document.querySelector("#matchPlaceholder");
const matchInfo = document.querySelector("#matchInfo");
const debugLog = document.querySelector("#debugLog");
const debugContent = document.querySelector("#debugContent");

let debugMessages = [];
function debugLog_func(msg) {
  debugMessages.push(msg);
  if (debugMessages.length > 20) debugMessages.shift();
  if (debugContent) debugContent.textContent = debugMessages.join("\n");
  if (debugLog) debugLog.style.display = "block";
  console.log(msg);
}

const usesBrowserStorage = location.protocol === "file:" || location.hostname.endsWith("github.io");
const localImageKey = "drawing-scan-prototype.latest";
const localImagesKey = "drawing-scan-prototype.images";

const rawMarkerToFrame = {
  "102": "001",
  "1654": "002",
  "100": "003",
  "119": "004",
  "30583": "006"
};

const knownMarkerSources = [
  { frameId: "001", src: "assets/aruco/frame-001.jpg" },
  { frameId: "002", src: "assets/aruco/frame-002.jpg" },
  { frameId: "003", src: "assets/aruco/frame-003.jpg" },
  { frameId: "004", src: "assets/aruco/frame-004.jpg" },
  { frameId: "005", src: "assets/aruco/frame-005.jpg" },
  { frameId: "006", src: "assets/aruco/frame-006.jpg" }
];

let knownMarkerPatterns = [];

let stream = null;
let images = [];

startCameraButton.addEventListener("click", startCamera);
scanFrameButton.addEventListener("click", scanFrame);

loadImages();
loadKnownMarkerPatterns();

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
    debugLog_func("📚 Loaded " + images.length + " images from browser storage");
    return;
  }

  try {
    const response = await fetch("api/images");
    images = await response.json();
    debugLog_func("📚 Loaded " + images.length + " images from server");
    for (let i = 0; i < images.length; i++) {
      const img = images[i];
      debugLog_func("  [" + i + "] ID:" + img.id + " Frame:" + (img.frame?.id || "none"));
    }
  } catch (error) {
    console.error(error);
    debugLog_func("❌ Failed to load images from server");
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

  debugLog_func("📸 Capturing frame: " + width + "x" + height);
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  context.drawImage(camera, 0, 0, width, height);

  const marker = detectFrameMarker(canvas);

  if (!marker) {
    setStatus("Cornice non riconosciuta. Avvicina il codice e riprova.", true);
    return;
  }

  debugLog_func("🔍 Looking for image with frameId: " + marker.frameId);
  const match = findImageByFrame(marker.frameId);

  if (!match) {
    debugLog_func("❌ No image found for frame " + marker.frameId);
    clearMatch();
    setStatus(`Riconosciuta ${marker.label}, ma nessun disegno risulta associato.`, true);
    matchInfo.textContent = "Controlla che un disegno sia stato proiettato in quella cornice.";
    return;
  }

  debugLog_func("✅ Found image for frame " + marker.frameId);
  showMatch(match, marker);
  setStatus(`Riconosciuta ${marker.label}: disegno trovato.`);
}

function findImageByFrame(frameId) {
  const normalizedFrameId = normalizeFrameId(frameId);
  debugLog_func("🔎 Searching in " + images.length + " images for frameId=" + normalizedFrameId);

  for (let i = 0; i < images.length; i++) {
    const img = images[i];
    const imageFrameId = normalizeFrameId(img.frame?.id);
    debugLog_func("  [" + i + "] has frameId=" + (imageFrameId || "none"));

    if (imageFrameId === normalizedFrameId) {
      debugLog_func("  ✓ MATCH!");
      return img;
    }
  }

  return null;
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
  debugLog_func("🔍 Scanning for marker...");
  debugLog_func("canvasSize: " + sourceCanvas.width + ", size: " + size + ", sampleSize: " + sampleSize);
  
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
  debugLog_func("🎯 Otsu threshold: " + threshold);
  
  const bounds = findDarkBounds(luminance, sampleSize, threshold);

  if (!bounds) {
    debugLog_func("❌ No dark bounds found (marker not visible)");
    return null;
  }
  
  debugLog_func("📦 Found dark bounds: " + JSON.stringify(bounds));

  const markerSize = Math.max(bounds.width, bounds.height);

  if (markerSize < sampleSize * 0.08) {
    debugLog_func("❌ Marker too small: " + markerSize + " < " + (sampleSize * 0.08));
    return null;
  }

  const grid = sampleMarkerGrid(luminance, sampleSize, threshold, bounds, 6);
  const borderScore = getBorderScore(grid);
  const bits = getInnerBits(grid);
  const bitsStr = bits.join("");
  const numericId = parseInt(bitsStr, 2);
  const rawId = String(Number.isFinite(numericId) ? numericId : 0);
  const mappedFrameId = rawMarkerToFrame[rawId];
  const patternMatch = findClosestKnownMarker(bitsStr);
  const frameId = mappedFrameId || patternMatch?.frameId || normalizeFrameId(rawId);

  debugLog_func("📍 Extracted bits: " + bitsStr);
  debugLog_func("🔢 Decoded raw ID: " + rawId);
  debugLog_func("🧭 Raw map: " + (mappedFrameId || "none"));
  debugLog_func("🧩 Pattern match: " + (patternMatch ? patternMatch.frameId + " (distance " + patternMatch.distance + ")" : "none"));

  if (!mappedFrameId && !patternMatch && borderScore < 0.01) {
    debugLog_func("❌ Border score too low and no known pattern match: " + borderScore);
    return null;
  }

  debugLog_func("✅ Marker detected! Frame: " + frameId + ", raw ID: " + rawId + ", borderScore: " + borderScore);

  return {
    frameId,
    rawId,
    label: `Cornice ${frameId}`,
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
  const darkLimit = Math.min(128, threshold + 8);
  debugLog_func("🎯 findDarkBounds using darkLimit: " + darkLimit + " (threshold: " + threshold + ")");

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
    debugLog_func("❌ Not enough dark pixels: " + count + " < " + Math.round(size * size * 0.015));
    return null;
  }
  
  debugLog_func("✓ Found " + count + " dark pixels");

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
  const startX = bounds.minX;
  const startY = bounds.minY;
  const sampleWidth = Math.max(1, bounds.width);
  const sampleHeight = Math.max(1, bounds.height);
  const darkLimit = Math.min(128, threshold + 8);
  debugLog_func("🎯 sampleMarkerGrid using darkLimit: " + darkLimit + " (threshold: " + threshold + ")");

  for (let row = 0; row < gridSize; row += 1) {
    const cells = [];

    for (let col = 0; col < gridSize; col += 1) {
      const x0 = Math.round(startX + (col / gridSize) * sampleWidth);
      const x1 = Math.round(startX + ((col + 1) / gridSize) * sampleWidth);
      const y0 = Math.round(startY + (row / gridSize) * sampleHeight);
      const y1 = Math.round(startY + ((row + 1) / gridSize) * sampleHeight);
      let darkPixels = 0;
      let totalPixels = 0;

      for (let y = Math.max(0, y0); y < Math.min(imageSize, y1); y += 1) {
        for (let x = Math.max(0, x0); x < Math.min(imageSize, x1); x += 1) {
          darkPixels += luminance[y * imageSize + x] <= darkLimit ? 1 : 0;
          totalPixels += 1;
        }
      }

      cells.push(totalPixels > 0 && darkPixels / totalPixels > 0.45 ? 1 : 0);
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

async function loadKnownMarkerPatterns() {
  const patterns = [];

  for (const marker of knownMarkerSources) {
    try {
      const image = await loadImage(marker.src);
      const markerCanvas = document.createElement("canvas");
      const markerContext = markerCanvas.getContext("2d", { willReadFrequently: true });
      markerCanvas.width = image.naturalWidth;
      markerCanvas.height = image.naturalHeight;
      markerContext.drawImage(image, 0, 0);
      const pattern = extractMarkerBits(markerCanvas);

      if (pattern) {
        patterns.push({ frameId: marker.frameId, bits: pattern });
      }
    } catch (error) {
      console.warn("Unable to load known marker", marker.src, error);
    }
  }

  knownMarkerPatterns = patterns;
  debugLog_func("🧩 Loaded " + knownMarkerPatterns.length + " known marker patterns");
}

function extractMarkerBits(sourceCanvas) {
  const context = sourceCanvas.getContext("2d", { willReadFrequently: true });
  const image = context.getImageData(0, 0, sourceCanvas.width, sourceCanvas.height);
  const luminance = [];

  for (let index = 0; index < image.data.length; index += 4) {
    luminance.push(getLuminance(image.data[index], image.data[index + 1], image.data[index + 2]));
  }

  const threshold = getOtsuThreshold(buildHistogram(luminance));
  const bounds = findDarkBounds(luminance, sourceCanvas.width, threshold);

  if (!bounds) {
    return null;
  }

  const grid = sampleMarkerGrid(luminance, sourceCanvas.width, threshold, bounds, 6);
  return getInnerBits(grid).join("");
}

function findClosestKnownMarker(bitsStr) {
  let bestMatch = null;

  for (const knownMarker of knownMarkerPatterns) {
    for (const variant of getBitVariants(knownMarker.bits)) {
      const distance = getHammingDistance(bitsStr, variant);

      if (!bestMatch || distance < bestMatch.distance) {
        bestMatch = {
          frameId: knownMarker.frameId,
          distance
        };
      }
    }
  }

  return bestMatch && bestMatch.distance <= 3 ? bestMatch : null;
}

function getBitVariants(bitsStr) {
  const grid = [];
  let index = 0;

  for (let row = 0; row < 4; row += 1) {
    const cells = [];

    for (let col = 0; col < 4; col += 1) {
      cells.push(bitsStr[index++]);
    }

    grid.push(cells);
  }

  const variants = [];
  let current = grid;

  for (let turn = 0; turn < 4; turn += 1) {
    variants.push(current.flat().join(""));
    current = rotateGrid(current);
  }

  return variants;
}

function rotateGrid(grid) {
  return grid[0].map((_, index) => grid.map((row) => row[index]).reverse());
}

function getHammingDistance(a, b) {
  if (a.length !== b.length) {
    return Number.POSITIVE_INFINITY;
  }

  let distance = 0;

  for (let index = 0; index < a.length; index += 1) {
    distance += a[index] === b[index] ? 0 : 1;
  }

  return distance;
}

function normalizeFrameId(frameId) {
  if (!frameId) {
    return "";
  }

  return String(frameId).padStart(3, "0");
}

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = reject;
    image.src = src;
  });
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
