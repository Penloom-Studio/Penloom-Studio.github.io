/*!
 * fx.js — Penloom's adapter for the vendored canvas-ui components.
 * Effects are declared in markup and cost nothing until they scroll into view:
 *
 *   <section data-fx="liquid" data-fx-opts='{"rainbow":true}'> …content… </section>
 *
 * Every component ships the same {source, content, output} contract, so one adapter drives all 28.
 * If WebGL2 is missing, the effect declines to start and the page is untouched — the markup below
 * the canvas is the real page, never a fallback.
 */

const HEAVY_CAP = window.matchMedia("(max-width: 720px)").matches ? 2 : 8;
const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const saveData = navigator.connection && navigator.connection.saveData;

let live = 0;

/** canvas-ui's html-in-canvas path: the live DOM becomes the texture. Chrome-only for now. */
function supportsHtmlInCanvas() {
  const probe = document.createElement("canvas");
  const ctx = probe.getContext("2d");
  return Boolean(
    ctx &&
      typeof ctx.drawElementImage === "function" &&
      typeof probe.requestPaint === "function",
  );
}

function assign(el, styles) {
  Object.assign(el.style, styles);
}

function mount(host) {
  const native = supportsHtmlInCanvas();

  const content = document.createElement("div");
  assign(content, { position: "relative", width: "100%" });
  while (host.firstChild) content.appendChild(host.firstChild);

  const source = document.createElement("canvas");
  source.setAttribute("layoutsubtree", "true");
  source.setAttribute("aria-hidden", "true");
  assign(
    source,
    native
      ? { position: "absolute", inset: "0", width: "100%", height: "100%" }
      : { display: "none" },
  );

  const output = document.createElement("canvas");
  output.setAttribute("aria-hidden", "true");
  assign(output, {
    position: "absolute",
    inset: "0",
    width: "100%",
    height: "100%",
    pointerEvents: "none",
  });

  if (getComputedStyle(host).position === "static") host.style.position = "relative";
  if (native) source.appendChild(content);
  host.append(source);
  if (!native) host.append(content);
  host.append(output);

  return { source, content, output };
}

async function start(host) {
  const id = host.dataset.fx;
  if (!id || live >= HEAVY_CAP) return;

  let options = {};
  try {
    options = host.dataset.fxOpts ? JSON.parse(host.dataset.fxOpts) : {};
  } catch (e) {
    console.warn(`fx: bad data-fx-opts on`, host, e);
  }

  let mod;
  try {
    mod = await import(`./canvas/${id}.js`);
  } catch (e) {
    console.warn(`fx: no component "${id}"`, e);
    return;
  }
  const create = mod[Object.keys(mod).find((k) => k.startsWith("create"))];
  if (typeof create !== "function") return;

  const elements = mount(host);
  const under = host.dataset.fxUnder && document.querySelector(host.dataset.fxUnder);
  if (under) elements.under = under;

  const instance = create(elements, options);
  if (!instance) {
    // No WebGL2 / no float render targets. Undo the scaffolding, leave the page as authored.
    elements.source.remove();
    elements.output.remove();
    host.dataset.fxState = "unsupported";
    return;
  }

  live++;
  host.dataset.fxState = "on";
  addEventListener("resize", () => instance.resize(), { passive: true });
}

export function init(root = document) {
  const hosts = [...root.querySelectorAll("[data-fx]")];
  if (reduced || saveData) {
    hosts.forEach((h) => (h.dataset.fxState = "off"));
    return;
  }
  const io = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        io.unobserve(entry.target);
        start(entry.target);
      }
    },
    { rootMargin: "200px" },
  );
  hosts.forEach((h) => io.observe(h));
}

init();
