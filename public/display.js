const displayWall = document.querySelector("#displayWall");
const transitLayer = document.querySelector("#transitLayer");
const emptyState = document.querySelector("#emptyState");
const connectionState = document.querySelector("#connectionState");
const imageTime = document.querySelector("#imageTime");

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
let previousCompositionImages = new Set(); // Traccia quali immagini sono in composizioni
let previousImageFrames = new Map(); // Traccia dove erano le immagini prima

loadImages();
connectToImageEvents();

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

function loadAndColorizeImage(imageSrc, symbol, callback) {
  console.log(`🎨 Colorizing image: symbol=${symbol}, src=${imageSrc}`);
  
  const image = new Image();
  image.crossOrigin = "anonymous";
  
  image.onload = () => {
    try {
      console.log(`✅ Image loaded: ${imageSrc}`);
      const colorCanvas = document.createElement("canvas");
      colorCanvas.width = image.width;
      colorCanvas.height = image.height;
      const ctx = colorCanvas.getContext("2d");
      
      ctx.drawImage(image, 0, 0);
      const imageData = ctx.getImageData(0, 0, colorCanvas.width, colorCanvas.height);
      const data = imageData.data;
      
      // Campiona il colore del tratto (pixel scuri)
      const strokeColor = sampleStrokeColor(data);
      console.log(`📍 Sampled stroke color: RGB(${strokeColor.r},${strokeColor.g},${strokeColor.b})`);
      
      const targetColor = getSymbolColor(symbol);
      console.log(`🎨 Target color: RGB(${targetColor.r},${targetColor.g},${targetColor.b})`);
      
      // Sostituisci il colore del tratto con il colore desiderato
      let recoloredPixels = 0;
      const tolerance = 30; // Tolleranza per il matching del colore
      
      for (let i = 0; i < data.length; i += 4) {
        const pixelR = data[i];
        const pixelG = data[i + 1];
        const pixelB = data[i + 2];
        
        // Verifica se il pixel è simile al colore del tratto (con tolleranza)
        const rDiff = Math.abs(pixelR - strokeColor.r);
        const gDiff = Math.abs(pixelG - strokeColor.g);
        const bDiff = Math.abs(pixelB - strokeColor.b);
        
        if (rDiff < tolerance && gDiff < tolerance && bDiff < tolerance) {
          data[i] = targetColor.r;
          data[i + 1] = targetColor.g;
          data[i + 2] = targetColor.b;
          recoloredPixels++;
        }
      }
      
      console.log(`🎨 Recolored ${recoloredPixels} pixels`);
      ctx.putImageData(imageData, 0, 0);
      const result = colorCanvas.toDataURL("image/png");
      callback(result);
    } catch (error) {
      console.error("❌ Colorization failed:", error);
      callback(imageSrc); // Fallback
    }
  };
  
  image.onerror = () => {
    console.error("❌ Image load failed:", imageSrc);
    callback(imageSrc); // Fallback
  };
  
  image.src = imageSrc;
}

function sampleStrokeColor(imageData) {
  // Campiona il colore più frequente tra i pixel scuri (tratto)
  const colors = {};
  let darkPixelCount = 0;
  
  for (let i = 0; i < imageData.length; i += 4) {
    const r = imageData[i];
    const g = imageData[i + 1];
    const b = imageData[i + 2];
    const luminance = 0.299 * r + 0.587 * g + 0.114 * b;
    
    // Considera pixel scuri
    if (luminance < 150) {
      darkPixelCount++;
      const key = `${r},${g},${b}`;
      colors[key] = (colors[key] || 0) + 1;
    }
  }
  
  // Trova il colore più frequente tra i pixel scuri
  let mostFrequentColor = { r: 0, g: 0, b: 0 };
  let maxCount = 0;
  
  for (const [colorKey, count] of Object.entries(colors)) {
    if (count > maxCount) {
      maxCount = count;
      const [r, g, b] = colorKey.split(",").map(Number);
      mostFrequentColor = { r, g, b };
    }
  }
  
  console.log(`📊 Found ${darkPixelCount} dark pixels, most frequent: RGB(${mostFrequentColor.r},${mostFrequentColor.g},${mostFrequentColor.b}) x${maxCount}`);
  return mostFrequentColor;
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

function renderImages(activeImageId = null) {
  displayWall.replaceChildren();
  emptyState.hidden = images.length > 0;

  for (const frame of frameSlots) {
    const frameImages = images
      .filter((image, index) => getDisplayFrameId(image, index) === frame.id)
      .slice(0, frame.role === "composition" ? 2 : 1);
    
    // Controlla se ci sono immagini che si spostano a questa composizione
    for (const image of frameImages) {
      const previousFrame = previousImageFrames.get(image.id);
      const isMovingToComposition = frame.role === "composition" && previousFrame && previousFrame !== frame.id;
      
      if (isMovingToComposition) {
        console.log(`🚀 Image ${image.id} moving from frame ${previousFrame} to ${frame.id}`);
        // Crea un elemento di transito
        const imageSrc = image.dataUrl || image.url;
        createTransitAnimation(imageSrc, image.symbol, previousFrame, frame.id);
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
        img.className = frame.role === "composition" ? "composition-image" : "single-image";
        
        // Se è una composizione, colora dinamicamente l'immagine
        const isComposition = frame.role === "composition";
        const imageSrc = image.dataUrl || image.url;
        
        console.log(`📦 Frame: ${frame.id}, isComposition: ${isComposition}, symbol: ${image.symbol}`);
        
        if (isComposition && image.symbol) {
          console.log(`🎨 Will colorize: symbol=${image.symbol}`);
          // Carica e colora l'immagine
          loadAndColorizeImage(imageSrc, image.symbol, (colorizedSrc) => {
            img.src = colorizedSrc;
          });
        } else {
          if (isComposition && !image.symbol) {
            console.warn(`⚠️ Composition frame but no symbol for image ${image.id}`);
          }
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

function calculateFrameOffset(fromFrame, toFrame) {
  // Trova gli elementi DOM dei frame
  const fromElement = displayWall.querySelector(`[data-frame="${fromFrame.id}"]`);
  const toElement = displayWall.querySelector(`[data-frame="${toFrame.id}"]`);
  
  if (!fromElement || !toElement) {
    console.warn(`⚠️ Could not find frames: from=${fromFrame.id}, to=${toFrame.id}`);
    return { x: 0, y: 0 };
  }
  
  // Ottieni le posizioni relative al viewport
  const fromRect = fromElement.getBoundingClientRect();
  const toRect = toElement.getBoundingClientRect();
  
  // Calcola l'offset (da dove deve partire per arrivare a destinazione)
  // Se positivo, significa che deve muoversi a sinistra/su
  // Se negativo, significa che deve muoversi a destra/giù
  const offsetX = fromRect.left - toRect.left;
  const offsetY = fromRect.top - toRect.top;
  
  console.log(`📏 Frame offset: from (${fromRect.left}, ${fromRect.top}) to (${toRect.left}, ${toRect.top}) = (${offsetX}, ${offsetY})`);
  
  return { x: offsetX, y: offsetY };
}

function createTransitAnimation(imageSrc, symbol, fromFrameId, toFrameId) {
  console.log(`🎬 Creating transit animation from ${fromFrameId} to ${toFrameId}`);
  
  // Carica l'immagine
  const image = new Image();
  image.crossOrigin = "anonymous";
  
  image.onload = () => {
    // Trova le posizioni dei frame
    const fromFrame = displayWall.querySelector(`[data-frame="${fromFrameId}"]`);
    const toFrame = displayWall.querySelector(`[data-frame="${toFrameId}"]`);
    
    if (!fromFrame || !toFrame) {
      console.warn(`⚠️ Could not find frames for transit`);
      return;
    }
    
    const fromRect = fromFrame.getBoundingClientRect();
    const toRect = toFrame.getBoundingClientRect();
    
    console.log(`📍 Transit: from (${fromRect.left}, ${fromRect.top}) to (${toRect.left}, ${toRect.top})`);
    
    // Crea il canale con l'immagine colorizzata
    colorizeImageForDisplay(imageSrc, symbol).then((colorizedSrc) => {
      // Crea l'elemento di transito
      const transitImg = document.createElement("img");
      transitImg.src = colorizedSrc;
      transitImg.className = "transit-item";
      transitImg.style.width = `${Math.min(fromRect.width * 0.82, toRect.width * 0.42)}px`;
      transitImg.style.height = `${Math.min(fromRect.height * 0.82, toRect.height * 0.82)}px`;
      transitImg.style.objectFit = "contain";
      
      // Posiziona all'inizio (dalla cornice di partenza)
      const startX = fromRect.left + fromRect.width / 2;
      const startY = fromRect.top + fromRect.height / 2;
      const endX = toRect.left + toRect.width / 2;
      const endY = toRect.top + toRect.height / 2;
      
      transitImg.style.setProperty("--from-x", `${startX}px`);
      transitImg.style.setProperty("--from-y", `${startY}px`);
      transitImg.style.setProperty("--to-x", `${endX}px`);
      transitImg.style.setProperty("--to-y", `${endY}px`);
      
      // Aggiusta per centering
      transitImg.style.transform = `translate(calc(var(--from-x) - 50%), calc(var(--from-y) - 50%))`;
      
      transitLayer.append(transitImg);
      
      // Attiva l'animazione
      requestAnimationFrame(() => {
        transitImg.classList.add("animating");
      });
      
      // Rimuovi l'elemento dopo l'animazione
      transitImg.addEventListener("animationend", () => {
        transitImg.remove();
        console.log(`✅ Transit animation completed`);
      }, { once: true });
    }).catch(err => {
      console.error("❌ Transit colorization failed:", err);
    });
  };
  
  image.onerror = () => {
    console.error("❌ Transit image load failed");
  };
  
  image.src = imageSrc;
}
