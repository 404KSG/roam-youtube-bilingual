const SPACING_WRAPPER = '.rm-video-player__spacing-wrapper, .rm-iframe__spacing-wrapper';
const VIDEO_CONTAINER = '.rm-video-player__container, .rm-iframe__container, .rm-iframe-container, .rm-video-player:not(iframe)';
const theaterOwners = new Map();

export function findVideoAnchor(iframe) {
  // In Roam the IFRAME itself has class rm-video-player. Never use it as a
  // container selector: its anonymous parent sits inside a clipped height:0 box.
  const spacing = iframe.parentElement?.closest(SPACING_WRAPPER);
  if (spacing) return spacing;
  const container = iframe.parentElement?.closest(VIDEO_CONTAINER);
  if (container) return container;
  if (getComputedStyle(iframe).position === 'absolute') {
    for (let parent = iframe.parentElement; parent && parent !== document.body; parent = parent.parentElement) {
      if (getComputedStyle(parent).position !== 'static') return parent;
    }
  }
  return iframe;
}

function retainTheater(theater) {
  if (!theater) return;
  let entry = theaterOwners.get(theater);
  if (!entry) {
    entry = { count: 0, original: theater.getAttribute('data-ryb-theater') };
    theaterOwners.set(theater, entry);
    theater.setAttribute('data-ryb-theater', 'managed');
  }
  entry.count++;
}
function releaseTheater(theater) {
  const entry = theaterOwners.get(theater);
  if (!entry || --entry.count > 0) return;
  theaterOwners.delete(theater);
  if (theater.getAttribute('data-ryb-theater') !== 'managed') return;
  if (entry.original === null) theater.removeAttribute('data-ryb-theater');
  else theater.setAttribute('data-ryb-theater', entry.original);
}

export function mountPanel(iframe, panel) {
  const anchor = findVideoAnchor(iframe);
  const theater = anchor.closest('.rm-video-theater');
  retainTheater(theater);
  anchor.insertAdjacentElement('afterend', panel);
  const resize = () => {
    const width = anchor.getBoundingClientRect().width;
    panel.style.maxWidth = width > 0 ? `${width}px` : '100%';
  };
  resize();
  const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(resize) : null;
  observer?.observe(anchor);
  if (!observer) window.addEventListener('resize', resize);
  return {
    anchor, theater,
    isCurrent: () => findVideoAnchor(iframe) === anchor && panel.previousElementSibling === anchor && anchor.closest('.rm-video-theater') === theater,
    dispose() { observer?.disconnect(); window.removeEventListener('resize', resize); releaseTheater(theater); },
  };
}
