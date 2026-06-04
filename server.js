const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || "0.0.0.0";
const PUBLIC_DIR = path.join(__dirname, "public");
const UPLOADS_DIR = path.join(__dirname, "uploads");

fs.mkdirSync(UPLOADS_DIR, { recursive: true });

let images = loadImages();
const clients = new Set();
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

const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".svg": "image/svg+xml"
};

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);

    if (req.method === "GET" && url.pathname === "/") {
      return serveFile(res, path.join(PUBLIC_DIR, "home.html"));
    }

    if (req.method === "GET" && url.pathname === "/api/latest") {
      return sendJson(res, getLatestImage() || null);
    }

    if (req.method === "GET" && url.pathname === "/api/images") {
      return sendJson(res, images);
    }

    if (req.method === "GET" && url.pathname === "/events") {
      return handleEvents(req, res);
    }

    if (req.method === "POST" && url.pathname === "/api/upload") {
      return handleUpload(req, res);
    }

    if (req.method === "POST" && url.pathname === "/api/reassign-frame") {
      return handleReassignFrame(req, res);
    }

    if (req.method === "DELETE" && url.pathname === "/api/latest") {
      return handleDeleteLatest(res);
    }

    if (req.method === "GET" && url.pathname.startsWith("/uploads/")) {
      return serveFile(res, path.join(__dirname, url.pathname));
    }

    if (req.method === "GET") {
      const safePath = normalizePublicPath(url.pathname);
      if (!safePath) {
        return notFound(res);
      }

      return serveFile(res, safePath);
    }

    res.writeHead(405, { Allow: "GET, POST, DELETE" });
    res.end("Method not allowed");
  } catch (error) {
    console.error(error);
    sendJson(res, { error: "Server error" }, 500);
  }
});

server.listen(PORT, HOST, () => {
  console.log(`Prototype ready on http://${HOST}:${PORT}`);
  console.log(`Capture page: http://${HOST}:${PORT}/`);
  console.log(`Display page: http://${HOST}:${PORT}/display.html`);
});

function normalizePublicPath(urlPath) {
  const decodedPath = decodeURIComponent(urlPath);
  const filePath = path.join(PUBLIC_DIR, decodedPath);

  if (!filePath.startsWith(PUBLIC_DIR)) {
    return null;
  }

  return filePath;
}

function serveFile(res, filePath) {
  fs.readFile(filePath, (error, content) => {
    if (error) {
      return notFound(res);
    }

    const type = mimeTypes[path.extname(filePath).toLowerCase()] || "application/octet-stream";
    const headers = { "Content-Type": type, "Cache-Control": "no-cache, no-store, must-revalidate" };
    res.writeHead(200, headers);
    res.end(content);
  });
}

function notFound(res) {
  res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
  res.end("Not found");
}

function sendJson(res, data, statusCode = 200) {
  res.writeHead(statusCode, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(data));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";

    req.on("data", (chunk) => {
      body += chunk;

      if (body.length > 12 * 1024 * 1024) {
        req.destroy();
        reject(new Error("Image too large"));
      }
    });

    req.on("end", () => resolve(body));
    req.on("error", reject);
  });
}

async function handleUpload(req, res) {
  const body = await readBody(req);
  const payload = JSON.parse(body || "{}");
  const dataUrl = payload.image;
  const frame = normalizeFrame(payload.frame) || getFrameSlot(images.length);
  const symbol = normalizeSymbol(payload.symbol);

  if (typeof dataUrl !== "string" || !dataUrl.startsWith("data:image/")) {
    return sendJson(res, { error: "Missing image data" }, 400);
  }

  const match = dataUrl.match(/^data:(image\/(?:png|jpeg|webp));base64,(.+)$/);
  if (!match) {
    return sendJson(res, { error: "Unsupported image format" }, 400);
  }

  const extension = match[1] === "image/jpeg" ? "jpg" : match[1].split("/")[1];
  const buffer = Buffer.from(match[2], "base64");
  const id = `${Date.now()}-${crypto.randomBytes(4).toString("hex")}`;
  const filename = `${id}.${extension}`;
  const filePath = path.join(UPLOADS_DIR, filename);

  fs.writeFileSync(filePath, buffer);

  const image = {
    id,
    filename,
    url: `/uploads/${filename}`,
    symbol,
    frame,
    createdAt: new Date().toISOString()
  };

  images.push(image);
  broadcast(image);
  sendJson(res, image, 201);
}

async function handleReassignFrame(req, res) {
  const body = await readBody(req);
  const payload = JSON.parse(body || "{}");
  const imageId = String(payload.imageId || "").trim();
  const fromFrameId = normalizeFrameId(payload.fromFrameId);
  const imageIndex = images.findIndex((image) => image.id === imageId);

  if (imageIndex < 0) {
    return sendJson(res, { error: "Image not found" }, 404);
  }

  const currentFrameId = normalizeFrameId(images[imageIndex].frame?.id);

  if (fromFrameId && currentFrameId !== fromFrameId) {
    return sendJson(res, { images: [], stale: true });
  }

  if (isCompositionImage(images[imageIndex])) {
    return sendJson(res, { images: [], locked: true });
  }

  const partnerIndex = chooseRandomPartnerIndex(imageId);
  const targetIndexes = partnerIndex >= 0 ? [imageIndex, partnerIndex] : [imageIndex];
  const destination = chooseCompositionFrame(targetIndexes.length);

  if (!destination) {
    return sendJson(res, { images: [], full: true });
  }

  const now = new Date().toISOString();
  const movedImages = targetIndexes.map((index) => ({
    ...images[index],
    frame: {
      ...destination,
      confidence: 1,
      detectedAt: now
    },
    movedAt: now
  }));

  for (const movedImage of movedImages) {
    const index = images.findIndex((image) => image.id === movedImage.id);
    if (index >= 0) {
      images[index] = movedImage;
    }
  }

  broadcastMove(movedImages);
  sendJson(res, { images: movedImages, frame: destination });
}

function handleDeleteLatest(res) {
  const deletedImage = images.pop();

  if (deletedImage?.filename) {
    const filePath = path.join(UPLOADS_DIR, deletedImage.filename);

    if (filePath.startsWith(UPLOADS_DIR) && fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
  }

  broadcastDelete(deletedImage);
  sendJson(res, { deleted: true, image: getLatestImage() || null });
}

function handleEvents(req, res) {
  res.writeHead(200, {
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-cache",
    Connection: "keep-alive"
  });

  res.write(`event: hello\ndata: ${JSON.stringify(images)}\n\n`);
  clients.add(res);

  req.on("close", () => {
    clients.delete(res);
  });
}

function broadcast(image) {
  const event = `event: image\ndata: ${JSON.stringify(image)}\n\n`;

  for (const client of clients) {
    client.write(event);
  }
}

function broadcastMove(imagesToMove) {
  const event = `event: move\ndata: ${JSON.stringify({ images: imagesToMove })}\n\n`;

  for (const client of clients) {
    client.write(event);
  }
}

function broadcastDelete(image) {
  const event = `event: delete\ndata: ${JSON.stringify({ id: image?.id || null })}\n\n`;

  for (const client of clients) {
    client.write(event);
  }
}

function chooseRandomPartnerIndex(imageId) {
  const sourceImage = images.find((image) => image.id === imageId);
  const sourceSymbol = sourceImage?.symbol;

  if (!sourceSymbol || sourceSymbol === "unknown") {
    return -1;
  }

  const candidates = images
    .map((image, index) => ({ image, index }))
    .filter(({ image }) => image.id !== imageId && image.symbol === sourceSymbol && !isCompositionImage(image));
  const picked = candidates[Math.floor(Math.random() * candidates.length)];
  return picked ? picked.index : -1;
}

function chooseCompositionFrame(movingCount) {
  const candidates = frameSlots.filter((frame) => (
    frame.role === "composition" &&
    countImagesInFrame(frame.id) + movingCount <= 2
  ));
  return candidates[Math.floor(Math.random() * candidates.length)] || null;
}

function countImagesInFrame(frameId) {
  const normalizedFrameId = normalizeFrameId(frameId);
  return images.filter((image) => normalizeFrameId(image.frame?.id) === normalizedFrameId).length;
}

function isCompositionImage(image) {
  return image?.frame?.role === "composition" || frameSlots.some((frame) => (
    frame.role === "composition" && normalizeFrameId(frame.id) === normalizeFrameId(image?.frame?.id)
  ));
}

function getFrameSlot(index) {
  const singleFrames = frameSlots.filter((frame) => frame.role === "single");
  const slot = singleFrames[index % singleFrames.length] || frameSlots[0];
  return {
    ...slot,
    confidence: 1,
    detectedAt: new Date().toISOString()
  };
}

function normalizeFrameId(frameId) {
  return String(frameId || "").padStart(3, "0");
}

function normalizeSymbol(symbol) {
  return ["heart", "flower", "star"].includes(symbol) ? symbol : "unknown";
}

function normalizeFrame(frame) {
  if (!frame || typeof frame !== "object") {
    return null;
  }

  const id = String(frame.id || "").trim();
  const label = String(frame.label || id || "Cornice").trim();
  const position = frame.position && typeof frame.position === "object"
    ? {
        x: Number(frame.position.x) || 0,
        y: Number(frame.position.y) || 0
      }
    : { x: 0, y: 0 };

  return {
    id,
    label,
    position,
    confidence: Number(frame.confidence) || 0,
    detectedAt: frame.detectedAt || new Date().toISOString()
  };
}

function getLatestImage() {
  return images.at(-1) || null;
}

function loadImages() {
  return fs
    .readdirSync(UPLOADS_DIR)
    .filter((file) => /\.(png|jpg|jpeg|webp)$/i.test(file))
    .map((file) => ({
      file,
      stat: fs.statSync(path.join(UPLOADS_DIR, file))
    }))
    .sort((a, b) => a.stat.mtimeMs - b.stat.mtimeMs)
    .map(({ file, stat }, index) => ({
      id: path.parse(file).name,
      filename: file,
      url: `/uploads/${file}`,
      symbol: "unknown",
      frame: getFrameSlot(index),
      createdAt: stat.mtime.toISOString()
    }));
}
