// Load canvas polyfills FIRST before pdfjs-dist
import '../utils/pdfPolyfills.js'
import { createCanvas } from '@napi-rs/canvas'
import Tesseract from 'tesseract.js'
import { Jimp } from 'jimp'
import fs from 'fs'
import path from 'path'
import { createRequire } from 'module'
import { pathToFileURL } from 'url'
import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs'
import { createWorker } from 'tesseract.js'
import { performEnhancedOCR } from '../utils/enhancedOCR.js'

// ─── PDF.js worker + asset paths ─────────────────────────────────────────────
const _require = createRequire(import.meta.url)

pdfjsLib.GlobalWorkerOptions.workerSrc = pathToFileURL(
  _require.resolve('pdfjs-dist/legacy/build/pdf.worker.mjs')
).href

const standardFontDataUrl =
  pathToFileURL(
    path.join(path.dirname(_require.resolve('pdfjs-dist/package.json')), 'standard_fonts')
  ).href + '/'

const cMapUrl =
  pathToFileURL(
    path.join(path.dirname(_require.resolve('pdfjs-dist/package.json')), 'cmaps')
  ).href + '/'

// ─── Canvas Factory ───────────────────────────────────────────────────────────
class NodeCanvasFactory {
  create(width, height) {
    const w = Math.max(width, 1)
    const h = Math.max(height, 1)
    const canvas = createCanvas(w, h)
    canvas.style = {}
    canvas.tagName = 'CANVAS'
    canvas.nodeName = 'CANVAS'
    canvas.nodeType = 1
    canvas.ownerDocument = global.document
    canvas.contains = () => false
    canvas.addEventListener = () => {}
    canvas.removeEventListener = () => {}
    return { canvas, context: canvas.getContext('2d') }
  }
  reset(ref, width, height) {
    if (ref?.canvas) {
      ref.canvas.width = Math.max(width, 1)
      ref.canvas.height = Math.max(height, 1)
    }
  }
  destroy(ref) {
    if (ref?.canvas) {
      ref.canvas.width = 0
      ref.canvas.height = 0
      ref.canvas = null
      ref.context = null
    }
  }
}

// ─── Render all PDF pages to page-1.png, page-2.png … ────────────────────────
// Replaces the pdf-poppler convert() call used in the original ExtractData app.
async function renderPDFPagesToImages(pdfPath, outputDir, password = null) {
  const data = new Uint8Array(fs.readFileSync(pdfPath))
  const pdf = await pdfjsLib
    .getDocument({
      data,
      password: password || '',
      useSystemFonts: true,
      standardFontDataUrl,
      cMapUrl,
      cMapPacked: true
    })
    .promise

  fs.mkdirSync(outputDir, { recursive: true })

  for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
    const page = await pdf.getPage(pageNum)
    // scale 3 ≈ 300 DPI for typical 96-DPI PDF coordinate space
    const viewport = page.getViewport({ scale: 3 })
    const w = Math.floor(viewport.width)
    const h = Math.floor(viewport.height)

    const canvas = createCanvas(w, h)
    const ctx = canvas.getContext('2d')
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, w, h)

    const factory = new NodeCanvasFactory()
    try {
      await page.render({ canvasContext: ctx, viewport, canvasFactory: factory }).promise
    } catch (renderErr) {
      console.warn(`renderPDFPagesToImages page ${pageNum} error:`, renderErr.message)
    }

    const pagePath = path.join(outputDir, `page-${pageNum}.png`)
    fs.writeFileSync(pagePath, canvas.toBuffer('image/png'))
    console.log(`  ✅ Rendered page ${pageNum} → ${pagePath}`)
  }

  await pdf.cleanup()
}

// ─── Text Extraction ──────────────────────────────────────────────────────────
export const extractText = async (filePath, options = {}) => {
  console.log(`extractText → Starting: ${filePath}`)
  try {
    const data = new Uint8Array(fs.readFileSync(filePath))
    const pdf = await pdfjsLib
      .getDocument({
        data,
        password: options.password,
        useSystemFonts: true,
        standardFontDataUrl,
        cMapUrl,
        cMapPacked: true
      })
      .promise

    let text = ''
    for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
      const page = await pdf.getPage(pageNum)
      const content = await page.getTextContent()
      const items = content.items.sort((a, b) =>
        Math.abs(a.transform[5] - b.transform[5]) < 5
          ? a.transform[4] - b.transform[4]
          : b.transform[5] - a.transform[5]
      )
      let lastY = null
      for (const item of items) {
        if (lastY !== null) {
          text += Math.abs(item.transform[5] - lastY) > 5 ? '\n' : ' '
        }
        text += item.str
        lastY = item.transform[5]
      }
      text += '\n'
    }

    console.log(`extractText → Extracted from ${pdf.numPages} pages`)
    return { text, pageCount: pdf.numPages }
  } catch (err) {
    console.error('extractText ❌', err)
    throw err
  }
}

// ─── Image Extraction ─────────────────────────────────────────────────────────
export const extractImages = async (filePath, outputDir, password = null, options = {}) => {
  console.log(`extractImages → Scanning PDF for embedded images`)
  const { scale = 2, minSize = 100 } = options

  const data = new Uint8Array(fs.readFileSync(filePath))
  const pdf = await pdfjsLib
    .getDocument({
      data,
      password,
      useSystemFonts: true,
      standardFontDataUrl,
      cMapUrl,
      cMapPacked: true
    })
    .promise

  const imageDir = path.resolve(outputDir)
  fs.mkdirSync(imageDir, { recursive: true })

  const imagePaths = []

  for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
    const page = await pdf.getPage(pageNum)
    const pageImage = await renderPageAsImage(page, pageNum, outputDir, scale)
    if (pageImage) imagePaths.push(pageImage)

    const operators = await page.getOperatorList()
    for (let i = 0; i < operators.fnArray.length; i++) {
      const fn = operators.fnArray[i]
      if (
        fn === pdfjsLib.OPS.paintImageXObject ||
        fn === pdfjsLib.OPS.paintInlineImageXObject ||
        fn === pdfjsLib.OPS.paintImageMaskXObject
      ) {
        try {
          const args = operators.argsArray[i]
          const imgKey = args[0]
          let img = await new Promise((r) => page.objs.get(imgKey, r))
          if (!img) img = await new Promise((r) => page.commonObjs.get(imgKey, r))
          if (img?.data)
            await saveEmbeddedImage(img, pageNum, i, imageDir, minSize, imagePaths)
        } catch (err) {
          console.warn(`extractImages ⚠️ Skipped image on page ${pageNum}`, err.message)
        }
      }
    }
  }

  console.log(`extractImages → Total: ${imagePaths.length}`)
  return imagePaths
}

async function saveEmbeddedImage(img, pageNum, index, imageDir, minSize, imagePaths) {
  const { width, height, data } = img
  if (width < minSize || height < minSize) return
  if (!data || data.length === 0) return

  try {
    const canvas = createCanvas(width, height)
    const ctx = canvas.getContext('2d')
    const imageData = ctx.createImageData(width, height)
    const totalPixels = width * height
    const expectedRGBA = totalPixels * 4

    if (data.length === expectedRGBA) {
      imageData.data.set(data)
    } else if (data.length === totalPixels * 3) {
      for (let i = 0, j = 0; i < data.length; i += 3, j += 4) {
        imageData.data[j] = data[i]
        imageData.data[j + 1] = data[i + 1]
        imageData.data[j + 2] = data[i + 2]
        imageData.data[j + 3] = 255
      }
    } else if (data.length === totalPixels) {
      for (let i = 0, j = 0; i < data.length; i++, j += 4) {
        const v = data[i]
        imageData.data[j] = v
        imageData.data[j + 1] = v
        imageData.data[j + 2] = v
        imageData.data[j + 3] = 255
      }
    } else {
      imageData.data.fill(255)
      imageData.data.set(data.slice(0, Math.min(data.length, imageData.data.length)))
    }

    ctx.putImageData(imageData, 0, 0)
    const name = `img-p${pageNum}-${Date.now()}-${index}.png`
    const savePath = path.join(imageDir, name)
    const buffer = canvas.toBuffer('image/png', { compressionLevel: 6 })
    if (!buffer || buffer.length < 100) return
    fs.writeFileSync(savePath, buffer)
    if (fs.existsSync(savePath) && fs.statSync(savePath).size > 100) {
      imagePaths.push(`/images/${path.basename(imageDir)}/${name}`)
    }
  } catch (err) {
    console.error(`saveEmbeddedImage`, err.message)
  }
}

// ─── Page → PNG helper ────────────────────────────────────────────────────────
async function renderPageAsImage(page, pageNum, outputDir, scale = 2) {
  try {
    const viewport = page.getViewport({ scale })
    const w = Math.floor(viewport.width)
    const h = Math.floor(viewport.height)
    if (!w || !h) return null

    const canvas = createCanvas(w, h)
    const ctx = canvas.getContext('2d')
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, w, h)

    const factory = new NodeCanvasFactory()
    try {
      await page.render({ canvasContext: ctx, viewport, canvasFactory: factory }).promise
    } catch (renderErr) {
      console.warn(`renderPageAsImage page ${pageNum}:`, renderErr.message)
      return null
    }

    const name = `page-${pageNum}-${Date.now()}.png`
    const savePath = path.join(outputDir, name)
    fs.mkdirSync(outputDir, { recursive: true })
    fs.writeFileSync(savePath, canvas.toBuffer('image/png'))
    return `/images/${path.basename(outputDir)}/${name}`
  } catch (err) {
    console.error(`renderPageAsImage page ${pageNum}:`, err.message)
    return null
  }
}

// ─── OCR ─────────────────────────────────────────────────────────────────────
export const performOCR = async (imagePaths) => {
  let result = ''
  const worker = await createWorker('hin+eng')
  try {
    for (const imgPath of imagePaths) {
      const local = path.resolve(imgPath.replace(/^\//, ''))
      if (fs.existsSync(local)) {
        const {
          data: { text }
        } = await worker.recognize(local)
        result += text + '\n'
      }
    }
  } finally {
    await worker.terminate()
  }
  return result
}

// ─── Image-based PDF detection ────────────────────────────────────────────────
export async function isImageBasedPDF(filePath, password = null) {
  let pdf = null
  try {
    const data = new Uint8Array(fs.readFileSync(filePath))
    pdf = await pdfjsLib
      .getDocument({
        data,
        password,
        useSystemFonts: true,
        standardFontDataUrl,
        cMapUrl,
        cMapPacked: true
      })
      .promise
    const page = await pdf.getPage(1)
    const content = await page.getTextContent()
    const textLength = content.items.reduce((acc, item) => acc + (item.str || '').length, 0)
    console.log(`isImageBasedPDF → Text length: ${textLength}`)
    return textLength < 50
  } catch (err) {
    console.error('isImageBasedPDF error:', err.message)
    return false
  } finally {
    if (pdf) await pdf.cleanup()
  }
}

// ─── processImagePDF ──────────────────────────────────────────────────────────
export async function processImagePDF(pdfPath, jobId, config = {}) {
  const {
    documentType = 'GENERIC',
    enableSplitting = false,
    ocrLanguages = 'eng',
    parser = null,
    extractRegions = [],
    password = null
  } = config

  console.log(`processImagePDF started for ${documentType}`)
  if (!pdfPath || typeof pdfPath !== 'string') throw new Error('pdfPath is invalid')
  if (!jobId || typeof jobId !== 'string') throw new Error('jobId is invalid')

  const baseDir = global.__imagesBaseDir || process.cwd()
  const outputDir = path.join(baseDir, 'images', jobId)
  fs.mkdirSync(outputDir, { recursive: true })

  const processingPromise = (async () => {
    // DF → PNG pages (pdfjs-dist replaces pdf-poppler)
    console.log('Converting PDF to PNG pages...')
    await renderPDFPagesToImages(pdfPath, outputDir, password)

    const pageImage = path.join(outputDir, 'page-1.png')
    if (!fs.existsSync(pageImage)) throw new Error('page-1.png not generated')

    const page2Image = path.join(outputDir, 'page-2.png')
    const hasMultiplePages = fs.existsSync(page2Image)

    // 2️⃣ Autocrop
    console.log('Autocropping...')
    let image
    try {
      image = await Jimp.read(pageImage)
      image = image.autocrop()
      await image.write(pageImage)
    } catch (autocropErr) {
      console.warn('Autocrop failed, using original:', autocropErr.message)
      image = await Jimp.read(pageImage)
    }

    // 3️⃣ Split front / back (conditional)
    let frontPath = pageImage
    let backPath = null
    let frontText = ''
    let backText = ''

    if (enableSplitting) {
      if (hasMultiplePages) {
        console.log('Two pages → separate front/back cards')
        frontPath = path.join(outputDir, 'front.png')
        await image.write(frontPath)

        backPath = path.join(outputDir, 'back.png')
        try {
          let bi = await Jimp.read(page2Image)
          bi = bi.autocrop()
          await bi.write(backPath)
        } catch {
          const bi = await Jimp.read(page2Image)
          await bi.write(backPath)
        }

        try {
          const fr = await performEnhancedOCR(frontPath, ocrLanguages, outputDir, 'front')
          frontText = fr.text
        } catch (e) {
          console.error('Front OCR failed:', e.message)
        }
        try {
          const br = await performEnhancedOCR(backPath, ocrLanguages, outputDir, 'back')
          backText = br.text
        } catch (e) {
          console.error('Back OCR failed:', e.message)
        }
      } else {
        console.log('Single page → vertical split')
        const { width, height } = image.bitmap
        frontPath = path.join(outputDir, 'front.png')
        backPath = path.join(outputDir, 'back.png')
        await image
          .clone()
          .crop({ x: 0, y: 0, w: width, h: Math.floor(height / 2) })
          .write(frontPath)
        await image
          .clone()
          .crop({ x: 0, y: Math.floor(height / 2), w: width, h: Math.floor(height / 2) })
          .write(backPath)

        try {
          const fr = await performEnhancedOCR(frontPath, ocrLanguages, outputDir, 'front-half')
          frontText = fr.text
        } catch { }
        try {
          const br = await performEnhancedOCR(backPath, ocrLanguages, outputDir, 'back-half')
          backText = br.text
        } catch { }
      }
    } else {
      try {
        const r = await performEnhancedOCR(pageImage, ocrLanguages, outputDir, 'fullpage')
        frontText = r.text
      } catch (e) {
        console.error('Full OCR failed:', e.message)
      }
    }

    const combinedText = enableSplitting
      ? `${frontText}\n\n===== BACK CARD =====\n\n${backText}`
      : frontText

    // 4️⃣ Extract custom regions
    const extractedRegions = {}
    if (extractRegions.length > 0) {
      for (const region of extractRegions) {
        if (region.source === 'back' && !backPath) continue
        const sourceImg = await Jimp.read(region.source === 'back' ? backPath : frontPath)
        const regionPath = path.join(outputDir, `${region.name}.png`)
        const box = {
          x: Math.floor(sourceImg.bitmap.width * region.x),
          y: Math.floor(sourceImg.bitmap.height * region.y),
          w: Math.floor(sourceImg.bitmap.width * region.w),
          h: Math.floor(sourceImg.bitmap.height * region.h)
        }
        await sourceImg.crop(box).autocrop().write(regionPath)
        extractedRegions[region.name] = `/images/${jobId}/${region.name}.png`
      }
    }

    // 5️⃣ Parse structured data
    let parsedData = {}
    if (parser && typeof parser === 'function') {
      parsedData = await parser(combinedText, {
        frontPath,
        backPath,
        outputDir,
        frontText,
        backText
      })
    }

    // 6️⃣ Cleanup extra page files
    for (const extra of [page2Image, path.join(outputDir, 'page-3.png')]) {
      if (fs.existsSync(extra)) fs.unlinkSync(extra)
    }

    return {
      jobId,
      status: 'completed',
      structured: {
        ...parsedData,
        cardImagePath: `/images/${jobId}/page-1.png`,
        ...(enableSplitting && {
          frontCardPath: `/images/${jobId}/front.png`,
          backCardPath: `/images/${jobId}/back.png`
        }),
        ...extractedRegions,
        rawText: combinedText
      }
    }
  })()

  return Promise.race([
    processingPromise,
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error('processImagePDF timeout after 3 minutes')), 180000)
    )
  ])
}
