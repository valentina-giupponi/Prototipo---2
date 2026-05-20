const displayWall = document.querySelector("#displayWall");
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

loadImages();
connectToImageEvents();

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
    const frameImages = images.filter((image, index) => getDisplayFrameId(image, index) === frame.id);
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
      frameImages.forEach((image, index) => {
        const img = document.createElement("img");
        img.src = image.dataUrl || image.url;
        img.alt = "Disegno caricato";
        img.style.setProperty("--layer-index", index);
        img.style.setProperty("--layer-count", frameImages.length);
        img.className = frame.role === "composition" ? "composition-image" : "single-image";
        artLayer.append(img);
      });
    }

    const caption = document.createElement("figcaption");
    caption.textContent = frame.label + (frame.role === "composition" && frameImages.length > 1 ? " · composizione" : "");

    figure.append(artLayer, caption);
    displayWall.append(figure);
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
