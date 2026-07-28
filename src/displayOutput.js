/**
 * Projector output display routing.
 *
 * Prefers Electron IPC (reliable multi-monitor fullscreen). Falls back to the
 * Window Management API in Chromium, then a single "this display" entry.
 */

function isElectronBridge() {
  return Boolean(window.dungeonStage?.isElectron);
}

function fallbackCurrentDisplay() {
  const screenObject = window.screen || {};
  const width = screenObject.availWidth || screenObject.width || 1280;
  const height = screenObject.availHeight || screenObject.height || 720;
  const x = Number.isFinite(screenObject.availLeft)
    ? screenObject.availLeft
    : Number.isFinite(screenObject.left)
      ? screenObject.left
      : 0;
  const y = Number.isFinite(screenObject.availTop)
    ? screenObject.availTop
    : Number.isFinite(screenObject.top)
      ? screenObject.top
      : 0;
  return [
    {
      id: "current",
      label: `This display · ${width}×${height}`,
      bounds: { x, y, width, height },
      primary: true,
    },
  ];
}

function normalizeDisplayEntry(entry, index = 0) {
  const bounds = entry?.bounds || {};
  const width = Math.max(1, Number(bounds.width) || 1280);
  const height = Math.max(1, Number(bounds.height) || 720);
  const id = String(entry?.id ?? index);
  const primary = Boolean(entry?.primary);
  const label =
    typeof entry?.label === "string" && entry.label.trim()
      ? entry.label.trim()
      : `Display ${index + 1} · ${width}×${height}${primary ? " · primary" : ""}`;
  return {
    id,
    label,
    bounds: {
      x: Number(bounds.x) || 0,
      y: Number(bounds.y) || 0,
      width,
      height,
    },
    primary,
  };
}

async function listDisplaysViaWindowManagement() {
  if (typeof window.getScreenDetails !== "function") return null;
  try {
    const details = await window.getScreenDetails();
    const screens = details?.screens || [];
    if (!screens.length) return null;
    return screens.map((screenEntry, index) =>
      normalizeDisplayEntry(
        {
          id: screenEntry.id ?? index,
          label:
            screenEntry.label ||
            `Display ${index + 1}${screenEntry.isPrimary ? " · primary" : ""}`,
          bounds: {
            x: screenEntry.left ?? screenEntry.availLeft ?? 0,
            y: screenEntry.top ?? screenEntry.availTop ?? 0,
            width: screenEntry.width ?? screenEntry.availWidth ?? 1280,
            height: screenEntry.height ?? screenEntry.availHeight ?? 720,
          },
          primary: Boolean(screenEntry.isPrimary),
        },
        index
      )
    );
  } catch {
    return null;
  }
}

/** @returns {Promise<Array<{id:string,label:string,bounds:{x:number,y:number,width:number,height:number},primary:boolean}>>} */
export async function listProjectorOutputDisplays() {
  if (isElectronBridge() && window.dungeonStage.listDisplays) {
    try {
      const displays = await window.dungeonStage.listDisplays();
      if (Array.isArray(displays) && displays.length) {
        return displays.map((entry, index) => normalizeDisplayEntry(entry, index));
      }
    } catch {
      // fall through
    }
  }

  const managed = await listDisplaysViaWindowManagement();
  if (managed?.length) return managed;
  return fallbackCurrentDisplay();
}

/**
 * Open (or reuse) a projector / stage / tool window on the chosen display.
 * @returns {Promise<{ ok: boolean, window?: Window | null, error?: string, reused?: boolean }>}
 */
export async function openProjectorOutputWindow({
  pathWithQuery,
  windowName,
  displayId,
  fullscreen = true,
  width,
  height,
} = {}) {
  const relativePath = String(pathWithQuery || "/stage.html");
  const name = String(windowName || "dungeon-stage-projector");
  const absoluteUrl = new URL(relativePath, window.location.origin).href;
  const windowWidth = Math.round(Number(width) || 0) || undefined;
  const windowHeight = Math.round(Number(height) || 0) || undefined;

  if (isElectronBridge() && window.dungeonStage.openProjectorWindow) {
    try {
      const result = await window.dungeonStage.openProjectorWindow({
        url: absoluteUrl,
        name,
        displayId: displayId == null ? "" : String(displayId),
        fullscreen: Boolean(fullscreen),
        width: windowWidth,
        height: windowHeight,
      });
      return {
        ok: Boolean(result?.ok),
        reused: Boolean(result?.reused),
        error: result?.error,
        window: null,
      };
    } catch (error) {
      return {
        ok: false,
        error: error?.message || "Electron could not open the projector window",
      };
    }
  }

  const displays = await listProjectorOutputDisplays();
  const selected =
    displays.find((entry) => String(entry.id) === String(displayId)) ||
    displays.find((entry) => entry.primary) ||
    displays[0];

  const popupWidth = fullscreen
    ? Math.round(selected.bounds.width)
    : Math.min(windowWidth || 1600, Math.round(selected.bounds.width));
  const popupHeight = fullscreen
    ? Math.round(selected.bounds.height)
    : Math.min(windowHeight || 900, Math.round(selected.bounds.height));
  const popupLeft = fullscreen
    ? Math.round(selected.bounds.x)
    : Math.round(
        selected.bounds.x +
          Math.max(0, (selected.bounds.width - popupWidth) / 2)
      );
  const popupTop = fullscreen
    ? Math.round(selected.bounds.y)
    : Math.round(
        selected.bounds.y +
          Math.max(0, (selected.bounds.height - popupHeight) / 2)
      );

  const features = [
    "popup=yes",
    `left=${popupLeft}`,
    `top=${popupTop}`,
    `width=${popupWidth}`,
    `height=${popupHeight}`,
  ].join(",");

  const popup = window.open(absoluteUrl, name, features);
  if (!popup) {
    return {
      ok: false,
      error: "Popup blocked — allow popups for this site",
      window: null,
    };
  }

  try {
    popup.moveTo(popupLeft, popupTop);
    popup.resizeTo(popupWidth, popupHeight);
  } catch {
    // Cross-origin timing / browser policy — coordinates in features still help.
  }

  if (fullscreen) {
    window.setTimeout(() => {
      try {
        popup.document?.documentElement?.requestFullscreen?.();
      } catch {
        // User can press F in the projector window.
      }
    }, 400);
  }

  return { ok: true, window: popup, reused: false };
}
