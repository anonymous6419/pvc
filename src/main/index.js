import { app, shell, BrowserWindow, ipcMain, dialog, protocol, net } from 'electron'
import { join, basename } from 'path'
import fs from 'fs'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import icon from '../../resources/icon.png?asset'
import { getRecentIdentityCards, saveIdentityCard } from './db/db'
import { processPDF } from './services/pdfProcessingService.js'
import ExtractedData from './models/ExtractedData.js'

// Register custom protocol for serving local images to the renderer
protocol.registerSchemesAsPrivileged([
  { scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true } }
])

function createWindow() {
  // Create the browser window.
  const mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    show: false,
    autoHideMenuBar: true,
    ...(process.platform === 'linux' ? { icon } : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false
    }
  })

  mainWindow.on('ready-to-show', () => {
    mainWindow.show()
  })

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  // HMR for renderer base on electron-vite cli.
  // Load the remote URL for development or the local html file for production.
  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
// Some APIs can only be used after this event occurs.
app.whenReady().then(() => {
  // Set the base directory for image storage to userData
  const userData = app.getPath('userData')
  global.__imagesBaseDir = userData
  const imagesDir = join(userData, 'images')
  fs.mkdirSync(imagesDir, { recursive: true })

  // Serve images stored in userData via app:// protocol
  protocol.handle('app', (request) => {
    const url = request.url.slice('app://'.length)
    const filePath = join(userData, url)
    return net.fetch('file://' + filePath)
  })

  // Set app user model id for windows
  electronApp.setAppUserModelId('com.electron')

  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  // ── existing identity card IPC ────────────────────────────────────────────
  ipcMain.on('ping', () => console.log('pong'))

  ipcMain.handle('identity:save', (_event, payload) => {
    const recordId = saveIdentityCard(payload)
    return { ok: true, id: recordId }
  })

  ipcMain.handle('identity:list', (_event, limit = 20) => {
    const safeLimit = Math.max(1, Math.min(Number(limit) || 20, 100))
    return getRecentIdentityCards(safeLimit)
  })

  ipcMain.handle('aadhaar:save', (_event, payload) => {
    const recordId = saveIdentityCard({ ...payload, cardType: 'aadhaar' })
    return { ok: true, id: recordId }
  })

  ipcMain.handle('aadhaar:list', (_event, limit = 20) => {
    const safeLimit = Math.max(1, Math.min(Number(limit) || 20, 100))
    return getRecentIdentityCards(safeLimit)
  })

  // ── PDF document extraction IPC ───────────────────────────────────────────

  /** Open a native file dialog and return the selected PDF path */
  ipcMain.handle('dialog:openPdf', async () => {
    const result = await dialog.showOpenDialog({
      title: 'Select PDF Document',
      filters: [{ name: 'PDF Files', extensions: ['pdf'] }],
      properties: ['openFile']
    })
    if (result.canceled || !result.filePaths.length) return null
    return { filePath: result.filePaths[0], fileName: basename(result.filePaths[0]) }
  })

  /**
   * Process a PDF document through the full extraction pipeline.
   * Returns the structured result with image paths usable as app:// URLs.
   */
  ipcMain.handle('pdf:process', async (_event, { filePath, documentType, password, useOCR }) => {
    if (!filePath || !fs.existsSync(filePath)) {
      throw new Error('File not found: ' + filePath)
    }

    const normalizedType = (documentType || 'UNKNOWN').toUpperCase()
    const fileName = basename(filePath)

    // Create a pending DB record first
    const doc = new ExtractedData({
      originalName: fileName,
      filePath,
      documentType: normalizedType,
      status: 'pending',
      structured: {}
    })
    await doc.save()

    // Run the processing pipeline
    await processPDF({
      documentId: doc._id,
      filePath,
      password: password || null,
      useOCR: Boolean(useOCR),
      documentType: normalizedType
    })

    // Fetch and return completed record
    const completed = await ExtractedData.findById(doc._id)
    return completed
  })

  /**
   * Read an image file from userData images directory and return as base64 data URL.
   * The imagePath should be the relative path like /images/{docId}/page-1.png
   */
  ipcMain.handle('image:toDataUrl', (_event, imagePath) => {
    const absPath = join(userData, imagePath.replace(/^\//, ''))
    if (!fs.existsSync(absPath)) return null
    const ext = absPath.endsWith('.png') ? 'png' : 'jpeg'
    const data = fs.readFileSync(absPath)
    return `data:image/${ext};base64,${data.toString('base64')}`
  })

  createWindow()

  app.on('activate', function () {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})
