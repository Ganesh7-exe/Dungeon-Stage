const { app, BrowserWindow, shell, ipcMain, screen } = require("electron");
const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");

let mainWindow = null;
let staticServer = null;
/** @type {Map<string, Electron.BrowserWindow>} */
const projectorWindows = new Map();

function getDistRoot() {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, "app-dist");
  }
  return path.join(__dirname, "..", "dist");
}

function getPreloadPath() {
  return path.join(__dirname, "preload.cjs");
}

function contentType(filePath) {
  const extension = path.extname(filePath).toLowerCase();
  const types = {
    ".html": "text/html; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".json": "application/json",
    ".map": "application/json",
    ".glb": "model/gltf-binary",
    ".gltf": "model/gltf+json",
    ".bin": "application/octet-stream",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".webp": "image/webp",
    ".svg": "image/svg+xml",
    ".txt": "text/plain; charset=utf-8",
    ".md": "text/plain; charset=utf-8",
    ".woff": "font/woff",
    ".woff2": "font/woff2",
  };
  return types[extension] || "application/octet-stream";
}

function startStaticServer(rootDirectory) {
  return new Promise((resolve, reject) => {
    const server = http.createServer((request, response) => {
      try {
        const requestUrl = new URL(request.url || "/", "http://127.0.0.1");
        let pathname = decodeURIComponent(requestUrl.pathname);
        if (pathname === "/") pathname = "/index.html";

        const normalized = path
          .normalize(pathname)
          .replace(/^([/\\])+/, "")
          .replace(/^(\.\.([/\\]|$))+/, "");
        const filePath = path.join(rootDirectory, normalized);
        const resolvedRoot = path.resolve(rootDirectory);
        const resolvedFile = path.resolve(filePath);

        if (
          resolvedFile !== resolvedRoot &&
          !resolvedFile.startsWith(resolvedRoot + path.sep)
        ) {
          response.writeHead(403);
          response.end("Forbidden");
          return;
        }

        if (!fs.existsSync(resolvedFile) || fs.statSync(resolvedFile).isDirectory()) {
          response.writeHead(404);
          response.end("Not found");
          return;
        }

        const fileBytes = fs.readFileSync(resolvedFile);
        response.writeHead(200, {
          "Content-Type": contentType(resolvedFile),
          "Cache-Control": "no-cache",
        });
        response.end(fileBytes);
      } catch (error) {
        response.writeHead(500);
        response.end(String(error?.message || error));
      }
    });

    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      resolve({
        server,
        port: address.port,
        origin: `http://127.0.0.1:${address.port}`,
      });
    });
  });
}

function listDisplaysPayload() {
  const primaryId = screen.getPrimaryDisplay().id;
  return screen.getAllDisplays().map((display, index) => {
    const width = display.bounds.width;
    const height = display.bounds.height;
    const isPrimary = display.id === primaryId;
    return {
      id: String(display.id),
      label:
        display.label ||
        `Display ${index + 1} · ${width}×${height}${isPrimary ? " · primary" : ""}`,
      bounds: {
        x: display.bounds.x,
        y: display.bounds.y,
        width,
        height,
      },
      primary: isPrimary,
    };
  });
}

function findDisplayById(displayId) {
  const displays = screen.getAllDisplays();
  const match = displays.find((display) => String(display.id) === String(displayId));
  return match || screen.getPrimaryDisplay();
}

function sharedWebPreferences() {
  return {
    preload: getPreloadPath(),
    contextIsolation: true,
    nodeIntegration: false,
    sandbox: true,
  };
}

async function createMainWindow(origin) {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1100,
    minHeight: 700,
    title: "Dungeon Stage",
    backgroundColor: "#0e1116",
    autoHideMenuBar: true,
    webPreferences: sharedWebPreferences(),
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    try {
      const parsed = new URL(url);
      if (parsed.origin === origin) {
        return {
          action: "allow",
          overrideBrowserWindowOptions: {
            width: 1280,
            height: 720,
            title: "Dungeon Stage · Projector",
            backgroundColor: "#000000",
            autoHideMenuBar: true,
            webPreferences: sharedWebPreferences(),
          },
        };
      }
    } catch {
      // fall through
    }
    shell.openExternal(url);
    return { action: "deny" };
  });

  await mainWindow.loadURL(`${origin}/`);
  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

function windowTitleForUrl(url) {
  if (String(url).includes("mapping.html")) {
    return "Dungeon Stage · Align to real box";
  }
  if (String(url).includes("stage.html")) {
    return "Dungeon Stage · Stage";
  }
  return "Dungeon Stage · Projector";
}

function resolveWindowBounds(options = {}) {
  const display = findDisplayById(options.displayId);
  const fullscreen = options.fullscreen !== false;
  const requestedWidth = Math.round(Number(options.width) || 0);
  const requestedHeight = Math.round(Number(options.height) || 0);

  if (fullscreen) {
    return {
      display,
      fullscreen: true,
      x: display.bounds.x,
      y: display.bounds.y,
      width: display.bounds.width,
      height: display.bounds.height,
    };
  }

  const width = Math.max(
    640,
    Math.min(requestedWidth || 1600, display.bounds.width)
  );
  const height = Math.max(
    480,
    Math.min(requestedHeight || 900, display.bounds.height)
  );
  return {
    display,
    fullscreen: false,
    x: display.bounds.x + Math.max(0, Math.floor((display.bounds.width - width) / 2)),
    y: display.bounds.y + Math.max(0, Math.floor((display.bounds.height - height) / 2)),
    width,
    height,
  };
}

function registerIpc() {
  ipcMain.handle("dungeon-stage:list-displays", () => listDisplaysPayload());

  ipcMain.handle(
    "dungeon-stage:focus-projector-window",
    (_event, windowName) => {
      const existing = projectorWindows.get(String(windowName || ""));
      if (!existing || existing.isDestroyed()) return false;
      if (existing.isMinimized()) existing.restore();
      existing.show();
      existing.focus();
      return true;
    }
  );

  ipcMain.handle(
    "dungeon-stage:set-fullscreen",
    (event, enabled) => {
      const browserWindow = BrowserWindow.fromWebContents(event.sender);
      if (!browserWindow || browserWindow.isDestroyed()) return false;
      browserWindow.setFullScreen(Boolean(enabled));
      return browserWindow.isFullScreen();
    }
  );

  ipcMain.handle("dungeon-stage:toggle-fullscreen", (event) => {
    const browserWindow = BrowserWindow.fromWebContents(event.sender);
    if (!browserWindow || browserWindow.isDestroyed()) return false;
    const nextFullscreen = !browserWindow.isFullScreen();
    browserWindow.setFullScreen(nextFullscreen);
    return nextFullscreen;
  });

  ipcMain.handle("dungeon-stage:is-fullscreen", (event) => {
    const browserWindow = BrowserWindow.fromWebContents(event.sender);
    if (!browserWindow || browserWindow.isDestroyed()) return false;
    return browserWindow.isFullScreen();
  });

  ipcMain.handle("dungeon-stage:close-window", (event) => {
    const browserWindow = BrowserWindow.fromWebContents(event.sender);
    if (!browserWindow || browserWindow.isDestroyed()) return false;
    browserWindow.close();
    return true;
  });

  ipcMain.handle(
    "dungeon-stage:open-projector-window",
    async (_event, options = {}) => {
      const url = String(options.url || "");
      const windowName = String(options.name || "dungeon-stage-projector");
      if (!url) return { ok: false, error: "Missing url" };

      const bounds = resolveWindowBounds(options);
      const title = windowTitleForUrl(url);

      const existing = projectorWindows.get(windowName);
      if (existing && !existing.isDestroyed()) {
        try {
          if (existing.isMinimized()) existing.restore();
          if (existing.isFullScreen() && !bounds.fullscreen) {
            existing.setFullScreen(false);
          }
          existing.setBounds({
            x: bounds.x,
            y: bounds.y,
            width: bounds.width,
            height: bounds.height,
          });
          if (bounds.fullscreen) existing.setFullScreen(true);
          existing.setTitle(title);
          existing.show();
          existing.focus();
          await existing.loadURL(url);
        } catch (error) {
          // Navigation can reject if a prior load is in flight — still show/focus.
          existing.show();
          existing.focus();
          return {
            ok: true,
            reused: true,
            warning: error?.message || "Reuse navigation skipped",
          };
        }
        return { ok: true, reused: true };
      }

      // Drop a stale map entry if Electron still has a dead handle.
      if (existing) {
        projectorWindows.delete(windowName);
      }

      const toolWindow = new BrowserWindow({
        x: bounds.x,
        y: bounds.y,
        width: bounds.width,
        height: bounds.height,
        title,
        backgroundColor: bounds.fullscreen ? "#000000" : "#0e1116",
        autoHideMenuBar: true,
        show: false,
        webPreferences: sharedWebPreferences(),
      });

      projectorWindows.set(windowName, toolWindow);
      toolWindow.on("closed", () => {
        if (projectorWindows.get(windowName) === toolWindow) {
          projectorWindows.delete(windowName);
        }
      });

      try {
        await toolWindow.loadURL(url);
      } catch (error) {
        projectorWindows.delete(windowName);
        if (!toolWindow.isDestroyed()) toolWindow.destroy();
        return {
          ok: false,
          error: error?.message || "Could not load window URL",
        };
      }

      if (bounds.fullscreen) {
        toolWindow.setFullScreen(true);
      }
      toolWindow.show();
      toolWindow.focus();
      return { ok: true, reused: false };
    }
  );
}

app.whenReady().then(async () => {
  const distRoot = getDistRoot();
  if (!fs.existsSync(path.join(distRoot, "index.html"))) {
    const message =
      "Missing built files. Run npm run build before packaging, or npm run app:dev.";
    console.error(message, distRoot);
    app.quit();
    return;
  }

  registerIpc();
  staticServer = await startStaticServer(distRoot);
  await createMainWindow(staticServer.origin);

  app.on("activate", async () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      await createMainWindow(staticServer.origin);
    }
  });
});

app.on("window-all-closed", () => {
  if (staticServer?.server) {
    staticServer.server.close();
  }
  if (process.platform !== "darwin") {
    app.quit();
  }
});
