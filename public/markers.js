const markerGrid = document.querySelector("#markerGrid");
const frames = ["001", "002", "003", "004", "005", "006"];

for (const frameId of frames) {
  const card = document.createElement("article");
  card.className = "marker-card";

  const title = document.createElement("h2");
  title.textContent = `Cornice ${frameId}`;

  const marker = document.createElement("div");
  marker.className = "marker-code";
  marker.setAttribute("aria-label", `Marker Cornice ${frameId}`);

  const bits = Number(frameId).toString(2).padStart(16, "0").slice(-16).split("").map(Number);
  let bitIndex = 0;

  for (let row = 0; row < 6; row += 1) {
    for (let col = 0; col < 6; col += 1) {
      const cell = document.createElement("span");
      const isBorder = row === 0 || col === 0 || row === 5 || col === 5;
      const bitValue = isBorder ? 1 : bits[bitIndex++];
      const isDark = bitValue === 1;
      cell.className = isDark ? "is-dark" : "";
      marker.append(cell);
    }
  }

  card.append(title, marker);
  markerGrid.append(card);
}
