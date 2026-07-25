const { app, BrowserWindow, shell } = require("electron");
const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");

let mainWindow = null;
let staticServer = null;

function getDistRoot() {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, "app-dist");
  }
  return path.join(__dirname, "..", "dist");
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

async function createMainWindow(origin) {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1100,
    minHeight: 700,
    title: "Dungeon Stage",
    backgroundColor: "#0e1116",
    autoHideMenuBar: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
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
            webPreferences: {
              contextIsolation: true,
              nodeIntegration: false,
              sandbox: true,
            },
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

app.whenReady().then(async () => {
  const distRoot = getDistRoot();
  if (!fs.existsSync(path.join(distRoot, "index.html"))) {
    const message =
      "Missing built files. Run npm run build before packaging, or npm run app:dev.";
    console.error(message, distRoot);
    app.quit();
    return;
  }

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
