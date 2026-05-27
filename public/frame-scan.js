const camera = document.querySelector("#camera");
const canvas = document.querySelector("#snapshot");
const startCameraButton = document.querySelector("#startCamera");
const scanFrameButton = document.querySelector("#scanFrame");
const statusText = document.querySelector("#status");
const cameraMessage = document.querySelector("#cameraMessage");
const matchedImage = document.querySelector("#matchedImage");
const matchPlaceholder = document.querySelector("#matchPlaceholder");
const matchInfo = document.querySelector("#matchInfo");
function debugLog_func(msg) {
  console.log(msg);
}

const usesBrowserStorage = location.protocol === "file:" || location.hostname.endsWith("github.io");
const localImageKey = "drawing-scan-prototype.latest";
const localImagesKey = "drawing-scan-prototype.images";
const imageChannel = "BroadcastChannel" in window ? new BroadcastChannel("drawing-scan-prototype") : null;
const frameSlots = [
  { id: "001", label: "Cornice 001", position: { x: 0.18, y: 0.22 }, size: "small", role: "single" },
  { id: "002", label: "Cornice 002", position: { x: 0.42, y: 0.18 }, size: "small", role: "single" },
  { id: "003", label: "Cornice 003", position: { x: 0.68, y: 0.24 }, size: "small", role: "single" },
  { id: "004", label: "Cornice 004", position: { x: 0.2, y: 0.68 }, size: "small", role: "single" },
  { id: "005", label: "Cornice 005", position: { x: 0.48, y: 0.72 }, size: "small", role: "single" },
  { id: "006", label: "Cornice 006", position: { x: 0.74, y: 0.66 }, size: "small", role: "single" },
  { id: "101", label: "Cornice composizione 101", position: { x: 0.5, y: 0.34 }, size: "large", role: "composition" },
  { id: "102", label: "Cornice composizione 102", position: { x: 0.32, y: 0.78 }, size: "large", role: "composition" },
  { id: "103", label: "Cornice composizione 103", position: { x: 0.72, y: 0.78 }, size: "large", role: "composition" }
];

const rawMarkerToFrame = {
  "755": "001",
  "907": "002",
  "408": "003",
  "135": "004",
  "830": "005",
  "765": "006"
};

const knownMarkerSources = [
  { frameId: "001", arucoId: "755", src: "assets/aruco/frame-001.jpg" },
  { frameId: "002", arucoId: "907", src: "assets/aruco/frame-002.jpg" },
  { frameId: "003", arucoId: "408", src: "assets/aruco/frame-003.jpg" },
  { frameId: "004", arucoId: "135", src: "assets/aruco/frame-004.jpg" },
  { frameId: "005", arucoId: "830", src: "assets/aruco/frame-005.jpg" },
  { frameId: "006", arucoId: "765", src: "assets/aruco/frame-006.jpg" }
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

async function scanFrame() {
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
  await moveMatchedImage(match, marker.frameId);
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

async function moveMatchedImage(image, fromFrameId) {
  try {
    const result = usesBrowserStorage
      ? moveLocalComposition(image.id, fromFrameId)
      : await moveServerImage(image.id, fromFrameId);
    const movedImages = Array.isArray(result?.images) ? result.images : result ? [result] : [];

    if (result?.locked) {
      matchInfo.textContent = "Questo disegno è già dentro una composizione e resta bloccato lì.";
      return;
    }

    if (result?.full) {
      matchInfo.textContent = "Disegno trovato. Le cornici di composizione sono già complete.";
      return;
    }

    if (result?.stale) {
      matchInfo.textContent = "La parete è già cambiata: aggiorno le informazioni e non sposto questo disegno.";
      await loadImages();
      return;
    }

    if (movedImages.length > 0) {
      const updateMap = new Map(movedImages.map((item) => [item.id, item]));
      images = images.map((item) => updateMap.get(item.id) || item);
      const destination = movedImages[0].frame;
      matchInfo.textContent = movedImages.length > 1
        ? `Disegno trovato. Sulla parete si sta componendo con un altro disegno della stessa domanda in ${destination.label}.`
        : `Disegno trovato. Non ci sono ancora altri disegni con lo stesso simbolo: si sposta da solo verso ${destination.label}.`;
    }
  } catch (error) {
    console.error(error);
    matchInfo.textContent = "Disegno trovato. Non sono riuscito a spostarlo sulla parete.";
  }
}

async function moveServerImage(imageId, fromFrameId) {
  const response = await fetch("api/reassign-frame", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ imageId, fromFrameId })
  });

  if (!response.ok) {
    throw new Error("Move failed");
  }

  return response.json();
}

function moveLocalComposition(imageId, fromFrameId) {
  const localImages = readLocalImages();
  const imageIndex = localImages.findIndex((image) => image.id === imageId);

  if (imageIndex < 0) {
    return { images: [] };
  }

  const currentFrameId = normalizeFrameId(localImages[imageIndex].frame?.id);
  const requestedFrameId = normalizeFrameId(fromFrameId);

  if (requestedFrameId && currentFrameId !== requestedFrameId) {
    return { images: [], stale: true };
  }

  if (isCompositionImage(localImages[imageIndex])) {
    return { images: [], locked: true };
  }

  const partnerIndex = chooseRandomPartnerIndex(localImages, imageId);
  const targetIndexes = partnerIndex >= 0 ? [imageIndex, partnerIndex] : [imageIndex];
  const destination = chooseCompositionFrame(localImages, targetIndexes.length);

  if (!destination) {
    return { images: [], full: true };
  }

  const now = new Date().toISOString();
  const movedImages = targetIndexes.map((index) => ({
    ...localImages[index],
    frame: {
      ...destination,
      confidence: 1,
      detectedAt: now
    },
    movedAt: now
  }));

  for (const movedImage of movedImages) {
    const index = localImages.findIndex((image) => image.id === movedImage.id);
    if (index >= 0) {
      localImages[index] = movedImage;
    }
  }

  localStorage.setItem(localImagesKey, JSON.stringify(localImages));
  localStorage.setItem(localImageKey, JSON.stringify(movedImages[0]));
  imageChannel?.postMessage({ type: "move", images: movedImages });
  return { images: movedImages };
}

function chooseRandomPartnerIndex(allImages, imageId) {
  const sourceImage = allImages.find((image) => image.id === imageId);
  const sourceSymbol = sourceImage?.symbol;

  if (!sourceSymbol || sourceSymbol === "unknown") {
    return -1;
  }

  const candidates = allImages
    .map((image, index) => ({ image, index }))
    .filter(({ image }) => image.id !== imageId && image.symbol === sourceSymbol && !isCompositionImage(image));
  const picked = candidates[Math.floor(Math.random() * candidates.length)];
  return picked ? picked.index : -1;
}

function chooseCompositionFrame(allImages, movingCount) {
  const candidates = frameSlots.filter((frame) => (
    frame.role === "composition" &&
    countImagesInFrame(allImages, frame.id) + movingCount <= 2
  ));
  return candidates[Math.floor(Math.random() * candidates.length)] || null;
}

function countImagesInFrame(allImages, frameId) {
  const normalizedFrameId = normalizeFrameId(frameId);
  return allImages.filter((image) => normalizeFrameId(image.frame?.id) === normalizedFrameId).length;
}

function isCompositionImage(image) {
  return image?.frame?.role === "composition" || frameSlots.some((frame) => (
    frame.role === "composition" && normalizeFrameId(frame.id) === normalizeFrameId(image?.frame?.id)
  ));
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
  const templateMatch = findBestKnownMarkerMatch(bitsStr);
  const frameId = templateMatch?.frameId || mappedFrameId || null;

  debugLog_func("📍 Extracted bits: " + bitsStr);
  debugLog_func("🔢 Decoded raw ID: " + rawId);
  debugLog_func("🧭 Raw map: " + (mappedFrameId || "none"));
  debugLog_func("🧩 Template match: " + (templateMatch ? templateMatch.frameId + " distance=" + templateMatch.distance + " margin=" + templateMatch.margin : "none"));

  if (!frameId) {
    debugLog_func("❌ Marker not confidently matched. Try flatter, closer, and with only one marker in frame.");
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

function findDarkBounds(luminance, imageWidth, threshold, imageHeight = imageWidth) {
  const darkLimit = Math.min(128, threshold + 8);
  const minArea = imageWidth * imageHeight * 0.015;
  const visited = new Uint8Array(imageWidth * imageHeight);
  let best = null;
  debugLog_func("🎯 findDarkBounds using darkLimit: " + darkLimit + " (threshold: " + threshold + ")");

  for (let y = 0; y < imageHeight; y += 1) {
    for (let x = 0; x < imageWidth; x += 1) {
      const startIndex = y * imageWidth + x;

      if (visited[startIndex] || luminance[startIndex] > darkLimit) {
        continue;
      }

      const queue = [startIndex];
      visited[startIndex] = 1;
      let cursor = 0;
      let minX = x;
      let minY = y;
      let maxX = x;
      let maxY = y;
      let count = 0;

      while (cursor < queue.length) {
        const current = queue[cursor++];
        const currentX = current % imageWidth;
        const currentY = Math.floor(current / imageWidth);
        count += 1;
        minX = Math.min(minX, currentX);
        minY = Math.min(minY, currentY);
        maxX = Math.max(maxX, currentX);
        maxY = Math.max(maxY, currentY);

        const neighbors = [
          currentX > 0 ? current - 1 : -1,
          currentX < imageWidth - 1 ? current + 1 : -1,
          currentY > 0 ? current - imageWidth : -1,
          currentY < imageHeight - 1 ? current + imageWidth : -1
        ];

        for (const neighbor of neighbors) {
          if (neighbor >= 0 && !visited[neighbor] && luminance[neighbor] <= darkLimit) {
            visited[neighbor] = 1;
            queue.push(neighbor);
          }
        }
      }

      const width = maxX - minX + 1;
      const height = maxY - minY + 1;
      const squareRatio = Math.min(width, height) / Math.max(width, height);
      const candidate = { minX, minY, maxX, maxY, width, height, count, squareRatio };

      if (squareRatio >= 0.65 && (!best || count > best.count)) {
        best = candidate;
      }
    }
  }

  if (!best || best.count < minArea) {
    debugLog_func("❌ Not enough dark marker pixels: " + (best?.count || 0) + " < " + Math.round(minArea));
    return null;
  }

  debugLog_func("✓ Found marker component with " + best.count + " dark pixels");

  return best;
}

function sampleMarkerGrid(luminance, imageWidth, threshold, bounds, gridSize, imageHeight = imageWidth) {
  const grid = [];
  const centerX = (bounds.minX + bounds.maxX) / 2;
  const centerY = (bounds.minY + bounds.maxY) / 2;
  const side = Math.max(bounds.width, bounds.height);
  const startX = Math.round(centerX - side / 2);
  const startY = Math.round(centerY - side / 2);
  const sampleWidth = Math.max(1, side);
  const sampleHeight = Math.max(1, side);
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

      for (let y = Math.max(0, y0); y < Math.min(imageHeight, y1); y += 1) {
        for (let x = Math.max(0, x0); x < Math.min(imageWidth, x1); x += 1) {
          darkPixels += luminance[y * imageWidth + x] <= darkLimit ? 1 : 0;
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
      const bits = extractMarkerBits(markerCanvas);

      if (bits) {
        patterns.push({ ...marker, bits });
      }
    } catch (error) {
      console.warn("Unable to load marker template", marker.src, error);
    }
  }

  knownMarkerPatterns = patterns;
  debugLog_func("🧩 Loaded " + knownMarkerPatterns.length + " marker templates");
}

function extractMarkerBits(sourceCanvas) {
  const context = sourceCanvas.getContext("2d", { willReadFrequently: true });
  const image = context.getImageData(0, 0, sourceCanvas.width, sourceCanvas.height);
  const luminance = [];

  for (let index = 0; index < image.data.length; index += 4) {
    luminance.push(getLuminance(image.data[index], image.data[index + 1], image.data[index + 2]));
  }

  const threshold = getOtsuThreshold(buildHistogram(luminance));
  const bounds = findDarkBounds(luminance, sourceCanvas.width, threshold, sourceCanvas.height);

  if (!bounds) {
    return null;
  }

  const grid = sampleMarkerGrid(luminance, sourceCanvas.width, threshold, bounds, 6, sourceCanvas.height);
  return getInnerBits(grid).join("");
}

function findBestKnownMarkerMatch(bitsStr) {
  let best = null;
  let secondBest = null;

  for (const marker of knownMarkerPatterns) {
    for (const variant of getBitVariants(marker.bits)) {
      const distance = getHammingDistance(bitsStr, variant);
      const candidate = { frameId: marker.frameId, arucoId: marker.arucoId, distance };

      if (!best || distance < best.distance) {
        secondBest = best;
        best = candidate;
      } else if (!secondBest || distance < secondBest.distance) {
        secondBest = candidate;
      }
    }
  }

  if (!best) {
    return null;
  }

  const margin = secondBest ? secondBest.distance - best.distance : 16;
  debugLog_func("🧪 Best template: " + best.frameId + " dist=" + best.distance + ", second=" + (secondBest ? secondBest.frameId + "/" + secondBest.distance : "none"));

  if (best.distance <= 2 || (best.distance <= 4 && margin >= 2)) {
    return { ...best, margin };
  }

  return null;
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
  if (!a || !b || a.length !== b.length) {
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
