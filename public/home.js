const fab = document.querySelector("#navFab");
const overlay = document.querySelector("#fabOverlay");
const menu = document.querySelector("#fabMenu");
const closeBtn = document.querySelector("#fabClose");

fab.addEventListener("click", openMenu);
overlay.addEventListener("click", closeMenu);
closeBtn.addEventListener("click", closeMenu);

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") closeMenu();
});

function openMenu() {
  fab.setAttribute("aria-expanded", "true");
  overlay.classList.add("is-open");
  menu.classList.add("is-open");
  menu.removeAttribute("aria-hidden");
  overlay.removeAttribute("aria-hidden");
}

function closeMenu() {
  fab.setAttribute("aria-expanded", "false");
  overlay.classList.remove("is-open");
  menu.classList.remove("is-open");
  menu.setAttribute("aria-hidden", "true");
  overlay.setAttribute("aria-hidden", "true");
}
