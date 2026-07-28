const { contextBridge, ipcRenderer } = require("electron");

/**
 * Safe bridge for Control / Mapping / Stage windows.
 * Display routing lives here so the renderer never gets nodeIntegration.
 */
contextBridge.exposeInMainWorld("dungeonStage", {
  isElectron: true,
  listDisplays: () => ipcRenderer.invoke("dungeon-stage:list-displays"),
  openProjectorWindow: (options) =>
    ipcRenderer.invoke("dungeon-stage:open-projector-window", options || {}),
  focusProjectorWindow: (name) =>
    ipcRenderer.invoke("dungeon-stage:focus-projector-window", name || ""),
  setFullscreen: (enabled) =>
    ipcRenderer.invoke("dungeon-stage:set-fullscreen", Boolean(enabled)),
  toggleFullscreen: () => ipcRenderer.invoke("dungeon-stage:toggle-fullscreen"),
  isFullscreen: () => ipcRenderer.invoke("dungeon-stage:is-fullscreen"),
  closeWindow: () => ipcRenderer.invoke("dungeon-stage:close-window"),
});
