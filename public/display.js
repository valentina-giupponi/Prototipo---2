const displayWall = document.querySelector("#displayWall");
const transitLayer = document.querySelector("#transitLayer");
const emptyState = document.querySelector("#emptyState");
const connectionState = document.querySelector("#connectionState");
const imageTime = document.querySelector("#imageTime");
const recordPathButton = document.querySelector("#recordPathButton");
const recordPathStatus = document.querySelector("#recordPathStatus");

const usesBrowserStorage = location.protocol === "file:";
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

let images = [];
let previousImageFrames = new Map();
const imagesInTransit = new Set();

// Sistema di registrazione percorsi
let recordingPath = false;
let recordingFromFrame = null;
let recordingToFrame = null;
let recordedCoordinates = [];
const savedPaths = new Map(); // Mappa di percorsi salvati: "001_to_101" -> [coordinates]

function loadSavedPaths() {
  try {
    const stored = localStorage.getItem('recordedPaths');
    if (stored) {
      const paths = JSON.parse(stored);
      for (const [key, coords] of Object.entries(paths)) {
        savedPaths.set(key, coords);
      }
      updatePathStatus();
    }
  } catch (e) {
    console.warn('Impossibile caricare percorsi da localStorage:', e);
  }
}

function persistSavedPaths() {
  try {
    const pathsObj = {};
    for (const [key, coords] of savedPaths.entries()) {
      pathsObj[key] = coords;
    }
    localStorage.setItem('recordedPaths', JSON.stringify(pathsObj));
    updatePathStatus();
  } catch (e) {
    console.warn('Impossibile salvare percorsi su localStorage:', e);
  }
}

// Aggiorna il display dello stato
function updatePathStatus() {
  const totalPossible = 18; // 6 small frames × 3 composition frames
  const count = savedPaths.size;
  if (recordingPath && !recordingFromFrame) {
    recordPathStatus.textContent = `${count}/${totalPossible} percorsi registrati - Muovi il mouse dalla cornice singola alla composizione...`;
  }
}

loadSavedPaths(); // Carica percorsi precedentemente registrati
loadImages();
connectToImageEvents();

// Setup registrazione percorsi
recordPathButton.addEventListener("click", startPathRecording);
document.addEventListener("mousemove", handleMouseMove);
document.addEventListener("click", handleClickDuringRecording);

// Funzione per colorare le immagini nelle composizioni
function getSymbolColor(symbol) {
  return {
    heart: { r: 255, g: 46, b: 0 },      // #FF2E00 Rosso
    flower: { r: 0, g: 103, b: 229 },    // #0067E5 Blu
    star: { r: 255, g: 207, b: 0 }       // #FFCF00 Giallo
  }[symbol] || { r: 18, g: 22, b: 26 };   // Nero di default
}

function getLuminance(r, g, b) {
  return 0.299 * r + 0.587 * g + 0.114 * b;
}

function colorizeImageForDisplay(imageSrc, symbol) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.crossOrigin = "anonymous";

    image.onload = () => {
      try {
        const colorCanvas = document.createElement("canvas");
        colorCanvas.width = image.width;
        colorCanvas.height = image.height;
        const ctx = colorCanvas.getContext("2d");

        ctx.drawImage(image, 0, 0);
        const imageData = ctx.getImageData(0, 0, colorCanvas.width, colorCanvas.height);
        const data = imageData.data;
        const { r, g, b } = getSymbolColor(symbol);

        // Cambia i pixel scuri (tratto) con il colore del simbolo
        for (let i = 0; i < data.length; i += 4) {
          const pixelR = data[i];
          const pixelG = data[i + 1];
          const pixelB = data[i + 2];

          // Se il pixel è scuro (il tratto), sostituiscilo con il colore
          const luminance = getLuminance(pixelR, pixelG, pixelB);
          if (luminance < 100) {
            data[i] = r;
            data[i + 1] = g;
            data[i + 2] = b;
          }
        }

        ctx.putImageData(imageData, 0, 0);
        resolve(colorCanvas.toDataURL("image/png"));
      } catch (error) {
        reject(error);
      }
    };

    image.onerror = () => reject(new Error("Failed to load image"));
    image.src = imageSrc;
  });
}

async function loadImages() {
  if (usesBrowserStorage) {
    images = readLocalImages();
    connectionState.textContent = "Modalità interna";
    renderImages();
    return;
  }

  try {
    const response = await fetch("api/images");
    images = await response.json();
    renderImages();
  } catch (error) {
    console.error(error);
    connectionState.textContent = "Server non raggiungibile";
  }
}

function connectToImageEvents() {
  if (usesBrowserStorage) {
    imageChannel?.addEventListener("message", (event) => {
      if (event.data?.type === "delete") {
        removeImage(event.data.id);
        return;
      }

      if (event.data?.type === "move") {
        updateImages(event.data.images || event.data.image);
        return;
      }

      if (event.data?.type === "react") {
        triggerReaction(event.data.id);
        return;
      }

      addImage(event.data?.image || event.data);
    });

    window.addEventListener("storage", (event) => {
      if (event.key !== localImagesKey && event.key !== localImageKey) {
        return;
      }

      images = readLocalImages();
      renderImages();
    });

    return;
  }

  const events = new EventSource("events");

  events.addEventListener("open", () => {
    connectionState.textContent = "In ascolto";
  });

  events.addEventListener("hello", (event) => {
    const payload = JSON.parse(event.data);
    images = Array.isArray(payload) ? payload : payload ? [payload] : [];
    renderImages();
  });

  events.addEventListener("image", (event) => {
    addImage(JSON.parse(event.data));
  });

  events.addEventListener("move", (event) => {
    const payload = JSON.parse(event.data);
    updateImages(payload.images || payload);
  });

  events.addEventListener("delete", (event) => {
    const payload = JSON.parse(event.data);
    removeImage(payload?.id || null);
  });

  events.addEventListener("react", (event) => {
    const payload = JSON.parse(event.data);
    triggerReaction(payload?.id || null);
  });

  events.addEventListener("error", () => {
    connectionState.textContent = "Riconnessione...";
  });
}

function addImage(image) {
  if (!image?.id) {
    return;
  }

  images = [...images.filter((item) => item.id !== image.id), image];
  renderImages();
}

function updateImages(updatedImages) {
  const updates = Array.isArray(updatedImages) ? updatedImages : [updatedImages];
  const validUpdates = updates.filter((image) => image?.id);

  if (validUpdates.length === 0) {
    return;
  }

  const updateMap = new Map(validUpdates.map((image) => [image.id, image]));
  images = images.map((item) => updateMap.get(item.id) || item);
  renderImages(validUpdates[0].id);
}

function removeImage(id) {
  images = id ? images.filter((image) => image.id !== id) : images.slice(0, -1);
  renderImages();
}

// "Incanto": burst di stelline gialle sul disegno indicato
function triggerReaction(imageId) {
  if (!imageId) {
    return;
  }

  const img = displayWall.querySelector(`img[data-image-id="${imageId}"]`);
  if (!img) {
    return;
  }

  const rect = img.getBoundingClientRect();
  spawnStarBurst(rect.left + rect.width / 2, rect.top + rect.height / 2);
}

function spawnStarBurst(centerX, centerY) {
  const count = 16;

  for (let i = 0; i < count; i++) {
    const star = document.createElement("span");
    star.className = "spell-star";
    star.textContent = "★";

    const angle = (Math.PI * 2 * i) / count + (Math.random() - 0.5) * 0.5;
    const distance = 80 + Math.random() * 110;

    star.style.left = `${centerX}px`;
    star.style.top = `${centerY}px`;
    star.style.setProperty("--dx", `${Math.cos(angle) * distance}px`);
    star.style.setProperty("--dy", `${Math.sin(angle) * distance}px`);
    star.style.setProperty("--rot", `${(Math.random() * 2 - 1) * 180}deg`);
    star.style.fontSize = `${18 + Math.random() * 22}px`;
    star.style.animationDelay = `${Math.random() * 140}ms`;

    document.body.append(star);
    star.addEventListener("animationend", () => star.remove(), { once: true });
  }
}

function renderImages(activeImageId = null) {
  displayWall.replaceChildren();
  emptyState.hidden = images.length > 0;

  const transitingImages = new Set();

  for (const frame of frameSlots) {
    const frameImages = images
      .filter((image, index) => getDisplayFrameId(image, index) === frame.id)
      .slice(0, frame.role === "composition" ? 2 : 1);

    for (const image of frameImages) {
      const previousFrame = previousImageFrames.get(image.id);
      const isMovingToComposition = frame.role === "composition" && previousFrame && previousFrame !== frame.id;

      if (isMovingToComposition) {
        transitingImages.add(image.id);
        const imageSrc = image.dataUrl || image.url;
        createTransitAnimation(imageSrc, image.symbol, previousFrame, frame.id, image.id);
      }
    }

    const figure = document.createElement("figure");
    figure.className = "wall-frame";
    figure.classList.add(frame.size === "large" ? "is-large" : "is-small");
    figure.classList.add(frame.role === "composition" ? "is-composition-frame" : "is-single-frame");
    figure.dataset.frame = frame.id;

    if (frameImages.some((image) => image.id === activeImageId)) {
      figure.classList.add("is-active");
    }

    const artLayer = document.createElement("div");
    artLayer.className = "wall-frame-art";

    if (frameImages.length === 0) {
      const placeholder = document.createElement("span");
      placeholder.textContent = "Cornice libera";
      placeholder.className = "wall-frame-placeholder";
      artLayer.append(placeholder);
    } else {
      for (let index = 0; index < frameImages.length; index++) {
        const image = frameImages[index];
        const img = document.createElement("img");
        img.alt = "Disegno caricato";
        img.style.setProperty("--layer-index", index);
        img.style.setProperty("--layer-count", frameImages.length);
        img.style.setProperty("--motion-delay", getDrawingMotionDelay(image.id, index));
        img.style.setProperty("--motion-duration", getDrawingMotionDuration(image.id));
        img.className = frame.role === "composition" ? "composition-image drawing-motion" : "single-image drawing-motion";
        img.dataset.imageId = image.id;

        if (transitingImages.has(image.id) || imagesInTransit.has(image.id)) {
          img.style.visibility = "hidden";
          img.dataset.transiting = "true";
        }

        const isComposition = frame.role === "composition";
        const imageSrc = image.dataUrl || image.url;

        if (isComposition && image.symbol && image.symbol !== "unknown") {
          colorizeImageForDisplay(imageSrc, image.symbol)
            .then(colorizedSrc => { img.src = colorizedSrc; })
            .catch(() => { img.src = imageSrc; });
        } else {
          img.src = imageSrc;
        }

        artLayer.append(img);
      }
    }

    const caption = document.createElement("figcaption");
    caption.textContent = frame.label + (frame.role === "composition" && frameImages.length > 1 ? " · composizione" : "");

    figure.append(artLayer, caption);
    displayWall.append(figure);
  }

  // Aggiorna la traccia delle posizioni precedenti
  for (const image of images) {
    const currentFrame = getDisplayFrameId(image, images.indexOf(image));
    previousImageFrames.set(image.id, currentFrame);
  }

  const latestImage = images.at(-1);

  if (!latestImage) {
    imageTime.textContent = "";
    return;
  }

  imageTime.textContent = new Intl.DateTimeFormat("it-IT", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit"
  }).format(new Date(latestImage.createdAt));
}

function getDrawingMotionDelay(seed, index) {
  return `${-1 * (getStableNumber(seed) % 7200 + index * 600) / 1000}s`;
}

function getDrawingMotionDuration(seed) {
  return `${4.0 + (getStableNumber(seed) % 10) * 0.44}s`;
}

function getStableNumber(value) {
  return String(value || "")
    .split("")
    .reduce((total, character) => total + character.charCodeAt(0), 0);
}

function getDisplayFrameId(image, index) {
  return normalizeFrameId(image.frame?.id) || frameSlots[index % frameSlots.length].id;
}

function normalizeFrameId(frameId) {
  return frameId ? String(frameId).padStart(3, "0") : "";
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

function createTransitAnimation(imageSrc, symbol, fromFrameId, toFrameId, imageId) {
  imagesInTransit.add(imageId);

  const savedPath = getPathForTransit(fromFrameId, toFrameId);

  const image = new Image();
  image.crossOrigin = "anonymous";

  image.onload = () => {
    const fromFrame = displayWall.querySelector(`[data-frame="${fromFrameId}"]`);
    const toFrame = displayWall.querySelector(`[data-frame="${toFrameId}"]`);

    if (!fromFrame || !toFrame) {
      imagesInTransit.delete(imageId);
      return;
    }

    const fromRect = fromFrame.getBoundingClientRect();
    const toRect = toFrame.getBoundingClientRect();

    // Trova l'immagine nascosta specifica e misura la sua posizione nel layout
    // (visibility:hidden mantiene il layout, quindi il rect è valido)
    const finalImgInFrame = toFrame.querySelector(`img[data-image-id="${imageId}"][data-transiting]`);
    const finalRect = finalImgInFrame ? finalImgInFrame.getBoundingClientRect() : null;

    // Punto esatto dove il clone deve arrivare = centro dell'immagine finale nella cornice
    const targetX = finalRect && finalRect.width > 0
      ? finalRect.left + finalRect.width / 2
      : toRect.left + toRect.width / 2;
    const targetY = finalRect && finalRect.height > 0
      ? finalRect.top + finalRect.height / 2
      : toRect.top + toRect.height / 2;

    colorizeImageForDisplay(imageSrc, symbol).then((colorizedSrc) => {
      const transitItem = document.createElement("div");
      transitItem.className = "transit-item";

      // Dimensione identica all'immagine finale: nessun cambio di scala all'arrivo
      const imgW = finalRect && finalRect.width > 0 ? finalRect.width : Math.min(toRect.width * 0.42, 190);
      const imgH = finalRect && finalRect.height > 0 ? finalRect.height : Math.min(toRect.height * 0.82, 190);
      transitItem.style.width = `${imgW}px`;
      transitItem.style.height = `${imgH}px`;

      const transitMotion = document.createElement("div");
      transitMotion.className = "drawing-motion transit-motion";
      // Stesso delay e duration dell'immagine finale → stessa fase dell'animazione al momento dello swap
      const motionDelay = finalImgInFrame?.style.getPropertyValue("--motion-delay") || getDrawingMotionDelay(imageSrc, 0);
      const motionDuration = finalImgInFrame?.style.getPropertyValue("--motion-duration") || getDrawingMotionDuration(imageSrc);
      transitMotion.style.setProperty("--motion-delay", motionDelay);
      transitMotion.style.setProperty("--motion-duration", motionDuration);

      const transitImg = document.createElement("img");
      transitImg.src = colorizedSrc;
      transitImg.className = "transit-image";
      transitImg.style.width = "100%";
      transitImg.style.height = "100%";
      transitImg.style.objectFit = "contain";
      transitMotion.append(transitImg);
      transitItem.append(transitMotion);

      function revealFinalImage() {
        imagesInTransit.delete(imageId);
        // A questo punto il clone è esattamente sopra l'immagine finale:
        // swap istantaneo → nessuna differenza visibile
        transitItem.remove();
        const currentToFrame = displayWall.querySelector(`[data-frame="${toFrameId}"]`);
        if (currentToFrame) {
          const finalImg = currentToFrame.querySelector(`img[data-image-id="${imageId}"][data-transiting]`)
            || currentToFrame.querySelector(`img[data-transiting]`);
          if (finalImg) {
            finalImg.removeAttribute("data-transiting");
            finalImg.dataset.imageId && delete finalImg.dataset.imageId;
            finalImg.style.removeProperty("visibility");
          }
        }
      }

      transitItem.style.top = "0";
      transitItem.style.left = "0";
      transitLayer.append(transitItem);

      if (savedPath) {
        const startPoint = savedPath[0];
        transitItem.style.transform = `translate(calc(${startPoint.x}px - 50%), calc(${startPoint.y}px - 50%))`;
        animateAlongPathToTarget(transitItem, savedPath, targetX, targetY, revealFinalImage);
      } else {
        const startX = fromRect.left + fromRect.width / 2;
        const startY = fromRect.top + fromRect.height / 2;
        animateStraightToTarget(transitItem, startX, startY, targetX, targetY, revealFinalImage);
      }
    }).catch(() => { imagesInTransit.delete(imageId); });
  };

  image.onerror = () => { imagesInTransit.delete(imageId); };
  image.src = imageSrc;
}

// Segue il percorso registrato, nell'ultimo 25% converge esattamente
// verso targetX/targetY (posizione reale dell'immagine nella cornice di composizione)
function animateAlongPathToTarget(element, coordinates, targetX, targetY, onComplete) {
  const startTime = performance.now();
  const duration = 3500;
  const convergenceAt = 0.75;

  function animate(now) {
    const progress = Math.min((now - startTime) / duration, 1);
    const index = Math.floor(progress * (coordinates.length - 1));
    const coord = coordinates[index];

    let x = coord.x;
    let y = coord.y;

    if (progress > convergenceAt) {
      const t = (progress - convergenceAt) / (1 - convergenceAt);
      const ease = t * t * (3 - 2 * t); // smoothstep
      x = coord.x + (targetX - coord.x) * ease;
      y = coord.y + (targetY - coord.y) * ease;
    }

    element.style.transform = `translate(calc(${x}px - 50%), calc(${y}px - 50%))`;

    if (progress < 1) {
      requestAnimationFrame(animate);
    } else {
      onComplete();
    }
  }

  requestAnimationFrame(animate);
}

// Animazione linea retta (fallback senza percorso registrato)
function animateStraightToTarget(element, startX, startY, targetX, targetY, onComplete) {
  const startTime = performance.now();
  const duration = 3500;

  function animate(now) {
    const progress = Math.min((now - startTime) / duration, 1);
    const ease = progress < 0.5
      ? 2 * progress * progress
      : 1 - Math.pow(-2 * progress + 2, 2) / 2;

    const x = startX + (targetX - startX) * ease;
    const y = startY + (targetY - startY) * ease;
    element.style.transform = `translate(calc(${x}px - 50%), calc(${y}px - 50%))`;

    if (progress < 1) {
      requestAnimationFrame(animate);
    } else {
      onComplete();
    }
  }

  requestAnimationFrame(animate);
}

// ===================== SISTEMA DI REGISTRAZIONE PERCORSI =====================

function startPathRecording() {
  if (recordingPath) {
    recordingPath = false;
    recordPathButton.classList.remove("recording");
    recordPathStatus.textContent = "Registrazione terminata";
    return;
  }

  recordingPath = true;
  recordingFromFrame = null;
  recordingToFrame = null;
  recordedCoordinates = [];
  recordPathButton.classList.add("recording");
  recordPathStatus.textContent = "Muovi il mouse dalla cornice singola alla composizione...";
}

function handleMouseMove(event) {
  if (!recordingPath) return;

  const mouseX = event.clientX;
  const mouseY = event.clientY;

  // Traccia il movimento
  recordedCoordinates.push({ x: mouseX, y: mouseY, timestamp: Date.now() });

  // Identifica quale frame è sotto il mouse
  const target = document.elementFromPoint(mouseX, mouseY);
  const frameElement = target?.closest("[data-frame]");

  if (frameElement) {
    const frameId = frameElement.dataset.frame;
    const frameObj = frameSlots.find(f => f.id === frameId);

    if (!recordingFromFrame && frameObj?.role === "single") {
      recordingFromFrame = frameId;
      recordPathStatus.textContent = `Partenza: ${frameId} → muovi verso composizione`;
    }

    if (recordingFromFrame && frameObj?.role === "composition") {
      recordingToFrame = frameId;
    }
  }
}

function handleClickDuringRecording(event) {
  if (!recordingPath || !recordingFromFrame || !recordingToFrame) return;

  const pathKey = `${recordingFromFrame}_to_${recordingToFrame}`;
  savedPaths.set(pathKey, recordedCoordinates);
  persistSavedPaths();

  const totalCount = savedPaths.size;
  recordPathStatus.textContent = `${pathKey} salvato (${recordedCoordinates.length} pt) — ${totalCount}/18`;

  recordingFromFrame = null;
  recordingToFrame = null;
  recordedCoordinates = [];

  setTimeout(() => { updatePathStatus(); }, 1500);
}

function getPathForTransit(fromFrameId, toFrameId) {
  const pathKey = `${fromFrameId}_to_${toFrameId}`;
  return savedPaths.get(pathKey);
}
