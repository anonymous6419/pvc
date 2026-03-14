import { contextBridge } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'
import { ipcRenderer } from 'electron'

// Custom APIs for renderer
const api = {
  // ── existing identity card APIs ──────────────────────────────────────────
  saveIdentityRecord: (payload) => ipcRenderer.invoke('identity:save', payload),
  listIdentityRecords: (limit) => ipcRenderer.invoke('identity:list', limit),
  saveAadhaarRecord: (payload) => ipcRenderer.invoke('aadhaar:save', payload),
  listAadhaarRecords: (limit) => ipcRenderer.invoke('aadhaar:list', limit),

  // ── PDF extraction APIs ───────────────────────────────────────────────────
  /** Open a native file dialog and return { filePath, fileName } or null */
  openPdfDialog: () => ipcRenderer.invoke('dialog:openPdf'),

  /**
   * Process a PDF through the full extraction pipeline.
   * @param {object} opts - { filePath, documentType, password?, useOCR? }
   * @returns {Promise<object>} structured extraction result
   */
  processDocument: (opts) => ipcRenderer.invoke('pdf:process', opts),

  /**
   * Convert a stored image path to a base64 data URL for display.
   * @param {string} imagePath - relative path like /images/{id}/page-1.png
   */
  imageToDataUrl: (imagePath) => ipcRenderer.invoke('image:toDataUrl', imagePath)
}

// Use `contextBridge` APIs to expose Electron APIs to
// renderer only if context isolation is enabled, otherwise
// just add to the DOM global.
if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('electron', electronAPI)
    contextBridge.exposeInMainWorld('api', api)
  } catch (error) {
    console.error(error)
  }
} else {
  window.electron = electronAPI
  window.api = api
}
