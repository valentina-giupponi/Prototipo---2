const markerGrid = document.querySelector("#markerGrid");

const markers = [
  { frameId: "001", arucoLabel: "Marker 1", rawId: "755", src: "assets/aruco/frame-001.jpg" },
  { frameId: "002", arucoLabel: "Marker 2", rawId: "907", src: "assets/aruco/frame-002.jpg" },
  { frameId: "003", arucoLabel: "Marker 3", rawId: "408", src: "assets/aruco/frame-003.jpg" },
  { frameId: "004", arucoLabel: "Marker 4", rawId: "135", src: "assets/aruco/frame-004.jpg" },
  { frameId: "005", arucoLabel: "Marker 5", rawId: "830", src: "assets/aruco/frame-005.jpg" },
  { frameId: "006", arucoLabel: "Marker 6", rawId: "765", src: "assets/aruco/frame-006.jpg" }
];

for (const marker of markers) {
  const card = document.createElement("article");
  card.className = "marker-card";

  const title = document.createElement("h2");
  title.textContent = `Cornice ${marker.frameId}`;

  const img = document.createElement("img");
  img.className = "marker-image";
  img.src = marker.src;
  img.alt = `${marker.arucoLabel} ID ${marker.rawId} associato alla cornice ${marker.frameId}`;

  const meta = document.createElement("p");
  meta.className = "marker-meta";
  meta.textContent = `${marker.arucoLabel} · ID ArUco ${marker.rawId}`;

  card.append(title, img, meta);
  markerGrid.append(card);
}
