import { useEffect, useState, useCallback } from 'react'

const CARD_TYPES = [
  { value: 'aadhaar', label: 'Aadhaar Card', api: 'aadhaar' },
  { value: 'pan', label: 'PAN Card', api: 'pan' },
  { value: 'election_card', label: 'Election Card', api: 'election' },
  { value: 'driving_licence', label: 'Driving Licence', api: 'driving-licence' },
  { value: 'ayushman', label: 'Ayushman Card', api: 'ayushman' },
  { value: 'abha', label: 'ABHA Card', api: 'aabha' },
  { value: 'e-shram', label: 'E-Shram Card', api: 'e-shram' }
]

// Map document type value → DB enum string expected by pdfProcessingService
const TYPE_TO_ENUM = {
  aadhaar: 'AADHAAR',
  pan: 'PAN',
  election_card: 'ELECTION_CARD',
  driving_licence: 'DRIVING_LICENCE',
  ayushman: 'AYUSHMAN',
  abha: 'ABHA',
  'e-shram': 'E-SHRAM'
}

function FieldRow({ label, value }) {
  const displayValue = formatDisplayValue(value)
  if (!displayValue) return null
  return (
    <div className="field-row">
      <label>{label}</label>
      <span>{displayValue}</span>
    </div>
  )
}

function formatDisplayValue(value) {
  if (value === null || value === undefined) return ''

  if (typeof value === 'string') {
    return value.trim()
  }

  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value)
  }

  if (Array.isArray(value)) {
    return value.map(formatDisplayValue).filter(Boolean).join(', ')
  }

  if (typeof value === 'object') {
    const parts = Object.values(value).map(formatDisplayValue).filter(Boolean)
    if (parts.length > 0) {
      return parts.join(', ')
    }

    try {
      return JSON.stringify(value)
    } catch {
      return ''
    }
  }

  return ''
}

function ImageCard({ label, dataUrl }) {
  if (!dataUrl) return null
  return (
    <div className="image-card">
      <p className="image-label">{label}</p>
      <img src={dataUrl} alt={label} />
    </div>
  )
}

function pickPanSourceImage(urls) {
  const preferred = [
    'cardImage',
    'frontCard',
    'cardImagePath',
    'frontCardPath',
    'image1',
    'image2',
    'image3'
  ]

  for (const key of preferred) {
    if (urls[key]) return urls[key]
  }

  const first = Object.values(urls).find(Boolean)
  return first || ''
}

function cropRegionFromCard(cardDataUrl, region) {
  return new Promise((resolve) => {
    if (!cardDataUrl) {
      resolve('')
      return
    }

    const img = new Image()
    img.onload = () => {
      try {
        const x = Math.floor(img.width * region.x)
        const y = Math.floor(img.height * region.y)
        const w = Math.floor(img.width * region.w)
        const h = Math.floor(img.height * region.h)

        const canvas = document.createElement('canvas')
        canvas.width = Math.max(w, 1)
        canvas.height = Math.max(h, 1)
        const ctx = canvas.getContext('2d')

        if (!ctx) {
          resolve('')
          return
        }

        ctx.drawImage(img, x, y, w, h, 0, 0, canvas.width, canvas.height)
        resolve(canvas.toDataURL('image/png'))
      } catch {
        resolve('')
      }
    }

    img.onerror = () => resolve('')
    img.src = cardDataUrl
  })
}

function trimTransparentBounds(imageData, width, height) {
  let minX = width
  let minY = height
  let maxX = -1
  let maxY = -1

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4
      const alpha = imageData[i + 3]
      if (alpha > 20) {
        if (x < minX) minX = x
        if (y < minY) minY = y
        if (x > maxX) maxX = x
        if (y > maxY) maxY = y
      }
    }
  }

  if (maxX < minX || maxY < minY) return null

  return {
    x: minX,
    y: minY,
    w: maxX - minX + 1,
    h: maxY - minY + 1
  }
}

function removeSignatureBackground(signatureDataUrl) {
  return new Promise((resolve) => {
    if (!signatureDataUrl) {
      resolve('')
      return
    }

    const img = new Image()
    img.onload = () => {
      try {
        const canvas = document.createElement('canvas')
        canvas.width = img.width
        canvas.height = img.height
        const ctx = canvas.getContext('2d')
        if (!ctx) {
          resolve('')
          return
        }

        ctx.drawImage(img, 0, 0)
        const frame = ctx.getImageData(0, 0, canvas.width, canvas.height)
        const data = frame.data

        for (let i = 0; i < data.length; i += 4) {
          const r = data[i]
          const g = data[i + 1]
          const b = data[i + 2]
          const a = data[i + 3]
          if (a < 20) continue

          const max = Math.max(r, g, b)
          const min = Math.min(r, g, b)
          const saturation = max === 0 ? 0 : (max - min) / max
          const brightness = (r + g + b) / 3

          // Remove bright paper/background while keeping darker ink strokes
          if (brightness > 200 || (brightness > 160 && saturation < 0.16)) {
            data[i + 3] = 0
          }
        }

        ctx.putImageData(frame, 0, 0)
        const bounds = trimTransparentBounds(data, canvas.width, canvas.height)
        if (!bounds) {
          resolve('')
          return
        }

        const out = document.createElement('canvas')
        out.width = bounds.w
        out.height = bounds.h
        const outCtx = out.getContext('2d')
        if (!outCtx) {
          resolve('')
          return
        }

        outCtx.drawImage(canvas, bounds.x, bounds.y, bounds.w, bounds.h, 0, 0, bounds.w, bounds.h)
        resolve(out.toDataURL('image/png'))
      } catch {
        resolve('')
      }
    }

    img.onerror = () => resolve('')
    img.src = signatureDataUrl
  })
}

function PanPreviewCard({ structured, imageUrls, autoPhotoUrl, autoQrUrl, signatureUrl }) {
  const name = structured.name || 'NAME'
  const fatherName = structured.fatherName || "FATHER'S NAME"
  const panNumber = (structured.panNumber || '').toUpperCase() || 'ABCDE1234F'
  const dob = structured.dob || structured.dateOfBirth || 'DD/MM/YYYY'
  const photoUrl = imageUrls.faceImage || imageUrls.photoImage || autoPhotoUrl
  const qrUrl = imageUrls.qrImage || autoQrUrl

  return (
    <article className="pan-preview-card" aria-label="PAN preview">
      <header className="pan-template-header">
        <div className="pan-template-head-left">
          <p className="pan-preview-hindi">आयकर विभाग</p>
          <p className="pan-preview-title">INCOME TAX DEPARTMENT</p>
        </div>
        <div className="pan-template-emblem">भारत सरकार</div>
      </header>

      <div className="pan-template-subtitle">
        <p>स्थायी लेखा संख्या कार्ड</p>
        <p>Permanent Account Number Card</p>
        <p className="pan-field-pan">{panNumber}</p>
      </div>

      <div className="pan-template-grid">
        <div className="pan-preview-photo">
          {photoUrl ? <img src={photoUrl} alt="Card holder" /> : <span>Photo</span>}
        </div>

        <div className="pan-template-text">
          <p className="pan-field-label">नाम / Name</p>
          <p className="pan-field-value">{name}</p>

          <p className="pan-field-label">पिता का नाम / Father&apos;s Name</p>
          <p className="pan-field-value">{fatherName}</p>

          <p className="pan-field-label">जन्म की तारीख / Date of Birth</p>
          <p className="pan-field-value">{dob}</p>
        </div>

        <div className="pan-preview-qr">
          {qrUrl ? <img src={qrUrl} alt="QR code" /> : <span>QR</span>}
        </div>
      </div>

      <div className="pan-preview-signature-area">
        {signatureUrl ? (
          <img src={signatureUrl} alt="Signature" className="pan-preview-signature-ink" />
        ) : (
          <span>Signature</span>
        )}
      </div>
    </article>
  )
}

export default function App() {
  const [selectedCardType, setSelectedCardType] = useState('aadhaar')
  const [password, setPassword] = useState('')
  const [useOCR, setUseOCR] = useState(false)
  const [selectedFile, setSelectedFile] = useState(null) // { filePath, fileName }
  const [isProcessing, setIsProcessing] = useState(false)
  const [error, setError] = useState('')
  const [result, setResult] = useState(null)
  const [imageUrls, setImageUrls] = useState({}) // key → base64 data url
  const [panAutoPhotoUrl, setPanAutoPhotoUrl] = useState('')
  const [panAutoQrUrl, setPanAutoQrUrl] = useState('')
  const [panSignatureUrl, setPanSignatureUrl] = useState('')
  const [history, setHistory] = useState([])

  const activeType = CARD_TYPES.find((t) => t.value === selectedCardType) || CARD_TYPES[0]

  // Load history on mount
  const loadHistory = useCallback(async () => {
    try {
      const rows = await window.api.listIdentityRecords(10)
      setHistory(rows || [])
    } catch { }
  }, [])

  useEffect(() => {
    loadHistory()
  }, [loadHistory])

  useEffect(() => {
    let cancelled = false

    async function derivePanAssets() {
      if (selectedCardType !== 'pan' || !result) {
        setPanAutoPhotoUrl('')
        setPanAutoQrUrl('')
        setPanSignatureUrl('')
        return
      }

      const cardDataUrl = pickPanSourceImage(imageUrls)
      if (!cardDataUrl) {
        setPanAutoPhotoUrl('')
        setPanAutoQrUrl('')
        setPanSignatureUrl('')
        return
      }

      const photoRegion = { x: 0.06, y: 0.30, w: 0.18, h: 0.38 }
      const qrRegion = { x: 0.66, y: 0.28, w: 0.29, h: 0.43 }
      const signatureRegion = { x: 0.35, y: 0.82, w: 0.28, h: 0.10 }

      const [autoPhoto, autoQr, rawSignature] = await Promise.all([
        imageUrls.faceImage || imageUrls.photoImage ? '' : cropRegionFromCard(cardDataUrl, photoRegion),
        imageUrls.qrImage ? '' : cropRegionFromCard(cardDataUrl, qrRegion),
        cropRegionFromCard(cardDataUrl, signatureRegion)
      ])

      const transparentSignature = await removeSignatureBackground(rawSignature)

      if (!cancelled) {
        setPanAutoPhotoUrl(autoPhoto)
        setPanAutoQrUrl(autoQr)
        setPanSignatureUrl(transparentSignature)
      }
    }

    derivePanAssets()
    return () => {
      cancelled = true
    }
  }, [selectedCardType, result, imageUrls])

  // Load images for a result object
  const loadImages = useCallback(async (doc) => {
    if (!doc?.images?.length) return
    const urls = {}
    const imgObj = doc.images[0] || {}

    // Helper to format the path for our custom protocol
    const getAppUrl = (imgPath) => {
      const cleanPath = imgPath.startsWith('/') ? imgPath.slice(1) : imgPath
      return `app://${cleanPath}`
    }

    for (const [key, imgPath] of Object.entries(imgObj)) {
      if (imgPath && typeof imgPath === 'string') {
        try {
          urls[key] = getAppUrl(imgPath)
        } catch { }
      }
    }

    // Also check structured fields for detected images
    const s = doc.structured || {}
    const imageFields = [
      'faceDetected',
      'qrDetected',
      'cardImagePath',
      'frontCardPath',
      'backCardPath',
      'photo',
      'face',
      'qr'
    ]
    const aliasMap = {
      cardImagePath: 'cardImage',
      frontCardPath: 'frontCard',
      backCardPath: 'backCard',
      faceDetected: 'faceImage',
      face: 'faceImage',
      photo: 'photoImage',
      qrDetected: 'qrImage',
      qr: 'qrImage'
    }
    for (const field of imageFields) {
      if (s[field]) {
        try {
          const appUrl = getAppUrl(s[field])
          urls[field] = appUrl
          const alias = aliasMap[field]
          if (alias && !urls[alias]) urls[alias] = appUrl
        } catch { }
      }
    }

    setImageUrls(urls)
  }, [])

  const onOpenFile = async () => {
    const picked = await window.api.openPdfDialog()
    if (picked) {
      setSelectedFile(picked)
      setError('')
      setResult(null)
      setImageUrls({})
    }
  }

  const onProcess = async () => {
    if (!selectedFile) {
      setError('Please select a PDF file first.')
      return
    }

    setError('')
    setResult(null)
    setImageUrls({})
    setIsProcessing(true)

    try {
      const doc = await window.api.processDocument({
        filePath: selectedFile.filePath,
        documentType: TYPE_TO_ENUM[selectedCardType] || 'UNKNOWN',
        password: password || null,
        useOCR
      })
      setResult(doc)
      await loadImages(doc)
    } catch (err) {
      setError(err?.message || 'Processing failed. Check that the PDF is a valid document.')
      console.error(err)
    } finally {
      setIsProcessing(false)
    }
  }

  const onSave = async () => {
    if (!result?.structured) return
    const s = result.structured
    try {
      await window.api.saveIdentityRecord({
        cardType: selectedCardType,
        fullName: s.name || s.holderName || s.cardHolderName || '',
        idNumber:
          s.aadhaarNumber ||
          s.panNumber ||
          s.epicNumber ||
          s.dlNumber ||
          s.licenseNumber ||
          s.abhaNumber ||
          s.eshramNumber ||
          s.beneficiaryId ||
          '',
        dateOfBirth: s.dob || s.dateOfBirth || '',
        gender: s.gender || '',
        address: formatDisplayValue(s.address),
        qrText: s.qrData || '',
        details: s,
        sourceFileName: selectedFile?.fileName || ''
      })
      await loadHistory()
      setError('')
    } catch (err) {
      setError('Failed to save: ' + (err?.message || err))
    }
  }

  const structured = result?.structured || {}

  return (
    <main className="page">
      {/* ── Left panel: controls + details ─────────────────────────────── */}
      <section className="panel left-panel no-print">
        <h1>PDF Document Extractor</h1>
        <p className="subtext">
          Extract data from Aadhaar, PAN, Election Card, Driving Licence, Ayushman, ABHA and
          E-Shram PDFs.
        </p>

        {/* Card type */}
        <label className="upload-box" htmlFor="card-type-select">
          <span>Document Type</span>
          <select
            id="card-type-select"
            value={selectedCardType}
            onChange={(e) => {
              setSelectedCardType(e.target.value)
              setResult(null)
              setImageUrls({})
              setError('')
            }}
          >
            {CARD_TYPES.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </select>
        </label>

        {/* File selection via native dialog */}
        <div className="upload-box file-row">
          <button type="button" onClick={onOpenFile} className="secondary">
            Browse PDF…
          </button>
          {selectedFile ? (
            <span className="filename">{selectedFile.fileName}</span>
          ) : (
            <span className="hint-text">No file selected</span>
          )}
        </div>

        {/* Options */}
        <div className="options-row">
          <label className="upload-box grow">
            <span>Password (optional)</span>
            <input
              type="password"
              placeholder="PDF password if protected"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </label>
          <label className="checkbox-label">
            <input
              type="checkbox"
              checked={useOCR}
              onChange={(e) => setUseOCR(e.target.checked)}
            />
            <span>Force OCR</span>
          </label>
        </div>

        {/* Process button */}
        <button
          type="button"
          onClick={onProcess}
          disabled={isProcessing || !selectedFile}
          className="primary-btn"
        >
          {isProcessing ? 'Processing…' : `Extract ${activeType.label} Data`}
        </button>

        {/* Status / error */}
        {isProcessing && <p className="status">Extracting data — this may take a moment…</p>}
        {error && <p className="error">{error}</p>}
        {result?.status === 'completed' && !error && (
          <p className="success">✓ Extraction completed</p>
        )}
        {result?.status === 'failed' && (
          <p className="error">Extraction failed: {result.error}</p>
        )}

        {/* Extracted fields */}
        {result && (
          <>
            <h2>Extracted Details</h2>
            <div className="details-grid">
              <FieldRow label="Document Type" value={result.documentType} />
              <FieldRow label="Name" value={structured.name || structured.holderName || structured.cardHolderName} />
              <FieldRow label="Aadhaar No." value={structured.aadhaarNumber} />
              <FieldRow label="PAN No." value={structured.panNumber} />
              <FieldRow label="EPIC No." value={structured.epicNumber} />
              <FieldRow label="DL No." value={structured.dlNumber || structured.licenseNumber} />
              <FieldRow label="ABHA No." value={structured.abhaNumber} />
              <FieldRow label="E-Shram No." value={structured.eshramNumber} />
              <FieldRow label="Beneficiary ID" value={structured.beneficiaryId} />
              <FieldRow label="DOB / YOB" value={structured.dob || structured.dateOfBirth} />
              <FieldRow label="Gender" value={structured.gender} />
              <FieldRow label="Father's Name" value={structured.fatherName} />
              <FieldRow label="Address" value={structured.address} />
              <FieldRow label="QR Data" value={structured.qrData} />
            </div>

            {/* Save button */}
            <button type="button" onClick={onSave} className="secondary">
              Save to Local DB
            </button>
          </>
        )}

        {/* History */}
        <h2>Recent Records</h2>
        <div className="history-list">
          {history.length === 0 ? (
            <p>No saved records yet.</p>
          ) : (
            history.map((row) => (
              <div className="history-row" key={row.id}>
                <strong>{(row.card_type || '').toUpperCase()}</strong>
                <strong>{row.full_name || 'Unknown'}</strong>
                <span>{row.id_number || '—'}</span>
                <span>{row.created_at}</span>
              </div>
            ))
          )}
        </div>
      </section>

      {/* ── Right panel: images ──────────────────────────────────────────── */}
      <section className="panel right-panel">
        <h2>Document Images</h2>

        {!result && (
          <p className="hint-text">Process a document to see extracted images here.</p>
        )}

        {result && (
          <>
            {selectedCardType === 'pan' && (
              <div className="pan-preview-wrap">
                <h3>PAN Card Preview</h3>
                <PanPreviewCard
                  structured={structured}
                  imageUrls={imageUrls}
                  autoPhotoUrl={panAutoPhotoUrl}
                  autoQrUrl={panAutoQrUrl}
                  signatureUrl={panSignatureUrl}
                />
              </div>
            )}

          <div className="images-grid">
            <ImageCard label="Card Image" dataUrl={imageUrls.cardImage} />
            <ImageCard label="Front" dataUrl={imageUrls.frontCard} />
            <ImageCard label="Back" dataUrl={imageUrls.backCard} />
            <ImageCard label="Photo / Face" dataUrl={imageUrls.faceImage || imageUrls.photoImage} />
            <ImageCard label="QR Code" dataUrl={imageUrls.qrImage} />
            {/* Fallback: show first available image */}
            {Object.keys(imageUrls).length === 0 &&
              Object.values(imageUrls).map((url, i) => (
                <ImageCard key={i} label={`Image ${i + 1}`} dataUrl={url} />
              ))}
          </div>
          </>
        )}

        {/* Raw JSON result */}
        {result && (
          <details className="raw-json">
            <summary>Raw JSON</summary>
            <pre>{JSON.stringify(result, null, 2)}</pre>
          </details>
        )}
      </section>
    </main>
  )
}
