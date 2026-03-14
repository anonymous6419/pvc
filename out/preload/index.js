"use strict";
const electron = require("electron");
const preload = require("@electron-toolkit/preload");
const api = {
  // ── existing identity card APIs ──────────────────────────────────────────
  saveIdentityRecord: (payload) => electron.ipcRenderer.invoke("identity:save", payload),
  listIdentityRecords: (limit) => electron.ipcRenderer.invoke("identity:list", limit),
  saveAadhaarRecord: (payload) => electron.ipcRenderer.invoke("aadhaar:save", payload),
  listAadhaarRecords: (limit) => electron.ipcRenderer.invoke("aadhaar:list", limit),
  // ── PDF extraction APIs ───────────────────────────────────────────────────
  /** Open a native file dialog and return { filePath, fileName } or null */
  openPdfDialog: () => electron.ipcRenderer.invoke("dialog:openPdf"),
  /**
   * Process a PDF through the full extraction pipeline.
   * @param {object} opts - { filePath, documentType, password?, useOCR? }
   * @returns {Promise<object>} structured extraction result
   */
  processDocument: (opts) => electron.ipcRenderer.invoke("pdf:process", opts),
  /**
   * Convert a stored image path to a base64 data URL for display.
   * @param {string} imagePath - relative path like /images/{id}/page-1.png
   */
  imageToDataUrl: (imagePath) => electron.ipcRenderer.invoke("image:toDataUrl", imagePath)
};
if (process.contextIsolated) {
  try {
    electron.contextBridge.exposeInMainWorld("electron", preload.electronAPI);
    electron.contextBridge.exposeInMainWorld("api", api);
  } catch (error) {
    console.error(error);
  }
} else {
  window.electron = preload.electronAPI;
  window.api = api;
}
