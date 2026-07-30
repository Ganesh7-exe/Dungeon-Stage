const LAYOUT_STORAGE_KEY = "dungeon-stage-layout-v1";

const DEFAULT_LEFT_WIDTH = 260;
const DEFAULT_RIGHT_WIDTH = 300;
const MIN_LEFT_WIDTH = 200;
const MAX_LEFT_WIDTH = 520;
const MIN_RIGHT_WIDTH = 220;
const MAX_RIGHT_WIDTH = 560;
const MIN_PREVIEW_WIDTH = 280;

function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, value));
}

function loadLayoutWidths() {
  try {
    const raw = localStorage.getItem(LAYOUT_STORAGE_KEY);
    if (!raw) {
      return {
        leftWidth: DEFAULT_LEFT_WIDTH,
        rightWidth: DEFAULT_RIGHT_WIDTH,
      };
    }
    const parsed = JSON.parse(raw);
    return {
      leftWidth: Number.isFinite(parsed.leftWidth)
        ? parsed.leftWidth
        : DEFAULT_LEFT_WIDTH,
      rightWidth: Number.isFinite(parsed.rightWidth)
        ? parsed.rightWidth
        : DEFAULT_RIGHT_WIDTH,
    };
  } catch {
    return {
      leftWidth: DEFAULT_LEFT_WIDTH,
      rightWidth: DEFAULT_RIGHT_WIDTH,
    };
  }
}

function saveLayoutWidths(leftWidth, rightWidth) {
  try {
    localStorage.setItem(
      LAYOUT_STORAGE_KEY,
      JSON.stringify({ leftWidth, rightWidth })
    );
  } catch {
    // ignore quota / private mode
  }
}

function applyRailWidths(workspace, leftWidth, rightWidth) {
  workspace.style.setProperty("--rail-left-width", `${Math.round(leftWidth)}px`);
  workspace.style.setProperty(
    "--rail-right-width",
    `${Math.round(rightWidth)}px`
  );
}

function getCurrentWidths(workspace) {
  const styles = getComputedStyle(workspace);
  const leftWidth =
    Number.parseFloat(styles.getPropertyValue("--rail-left-width")) ||
    DEFAULT_LEFT_WIDTH;
  const rightWidth =
    Number.parseFloat(styles.getPropertyValue("--rail-right-width")) ||
    DEFAULT_RIGHT_WIDTH;
  return { leftWidth, rightWidth };
}

function maxRailWidth(workspaceWidth, otherRailWidth) {
  return Math.max(
    MIN_LEFT_WIDTH,
    workspaceWidth - otherRailWidth - MIN_PREVIEW_WIDTH
  );
}

/**
 * Makes the left and right workspace rails horizontally resizable.
 * Widths persist in localStorage. Double-click a splitter to reset that side.
 */
export function initRailResize(workspace) {
  if (!workspace) return null;

  const leftSplitter = workspace.querySelector('[data-rail-resize="left"]');
  const rightSplitter = workspace.querySelector('[data-rail-resize="right"]');
  if (!leftSplitter || !rightSplitter) return null;

  const saved = loadLayoutWidths();
  let leftWidth = clamp(saved.leftWidth, MIN_LEFT_WIDTH, MAX_LEFT_WIDTH);
  let rightWidth = clamp(saved.rightWidth, MIN_RIGHT_WIDTH, MAX_RIGHT_WIDTH);
  applyRailWidths(workspace, leftWidth, rightWidth);

  function persist() {
    const current = getCurrentWidths(workspace);
    leftWidth = current.leftWidth;
    rightWidth = current.rightWidth;
    saveLayoutWidths(leftWidth, rightWidth);
  }

  function bindSplitter(splitter, side) {
    splitter.addEventListener("pointerdown", (event) => {
      if (event.button !== 0) return;
      event.preventDefault();
      splitter.setPointerCapture(event.pointerId);
      document.body.classList.add("is-resizing-rails");

      const workspaceBounds = workspace.getBoundingClientRect();
      const start = getCurrentWidths(workspace);

      const onPointerMove = (moveEvent) => {
        const workspaceWidth = workspaceBounds.width;
        if (workspaceWidth < 1) return;

        if (side === "left") {
          const rawWidth = moveEvent.clientX - workspaceBounds.left;
          const maximum = Math.min(
            MAX_LEFT_WIDTH,
            maxRailWidth(workspaceWidth, start.rightWidth)
          );
          leftWidth = clamp(rawWidth, MIN_LEFT_WIDTH, maximum);
          applyRailWidths(workspace, leftWidth, start.rightWidth);
        } else {
          const rawWidth = workspaceBounds.right - moveEvent.clientX;
          const maximum = Math.min(
            MAX_RIGHT_WIDTH,
            maxRailWidth(workspaceWidth, start.leftWidth)
          );
          rightWidth = clamp(rawWidth, MIN_RIGHT_WIDTH, maximum);
          applyRailWidths(workspace, start.leftWidth, rightWidth);
        }
      };

      const onPointerUp = () => {
        try {
          splitter.releasePointerCapture(event.pointerId);
        } catch {
          // already released
        }
        splitter.removeEventListener("pointermove", onPointerMove);
        splitter.removeEventListener("pointerup", onPointerUp);
        splitter.removeEventListener("pointercancel", onPointerUp);
        document.body.classList.remove("is-resizing-rails");
        persist();
      };

      splitter.addEventListener("pointermove", onPointerMove);
      splitter.addEventListener("pointerup", onPointerUp);
      splitter.addEventListener("pointercancel", onPointerUp);
    });

    splitter.addEventListener("dblclick", () => {
      if (side === "left") {
        leftWidth = DEFAULT_LEFT_WIDTH;
      } else {
        rightWidth = DEFAULT_RIGHT_WIDTH;
      }
      applyRailWidths(workspace, leftWidth, rightWidth);
      persist();
    });
  }

  bindSplitter(leftSplitter, "left");
  bindSplitter(rightSplitter, "right");

  window.addEventListener("resize", () => {
    const workspaceWidth = workspace.getBoundingClientRect().width;
    if (workspaceWidth < 1) return;
    const current = getCurrentWidths(workspace);
    leftWidth = clamp(
      current.leftWidth,
      MIN_LEFT_WIDTH,
      Math.min(MAX_LEFT_WIDTH, maxRailWidth(workspaceWidth, current.rightWidth))
    );
    rightWidth = clamp(
      current.rightWidth,
      MIN_RIGHT_WIDTH,
      Math.min(MAX_RIGHT_WIDTH, maxRailWidth(workspaceWidth, leftWidth))
    );
    applyRailWidths(workspace, leftWidth, rightWidth);
  });

  return {
    reset() {
      leftWidth = DEFAULT_LEFT_WIDTH;
      rightWidth = DEFAULT_RIGHT_WIDTH;
      applyRailWidths(workspace, leftWidth, rightWidth);
      persist();
    },
  };
}
