import path from 'path';
import fs from 'fs';
import ExtractedData from '../models/ExtractedData.js';
import { extractText, extractImages, performOCR, processImagePDF, isImageBasedPDF } from './pdfService.js';
import { Jimp } from 'jimp';

// Import Parsers
import { parseAadhaarText } from '../utils/aadhaarParser.js';
import { parsePanText } from '../utils/panParser.js';
import { parseAyushmanText } from '../utils/ayushmanParser.js';
import { parseElectionText } from '../utils/electionParser.js';
import { parseEShramEnhanced } from '../utils/eshramEnhancedParser.js';
import { parseABHAText, parseABHAFromQR } from '../utils/aabhaParser.js';
import { parseDrivingLicenceText } from '../utils/drivingLicenceParser.js';
import { extractFaceRegion, extractQRRegion, extractSignatureRegion, decodeQRImage } from '../utils/imageDetection.js';

function getBaseDir() {
  return global.__imagesBaseDir || process.cwd()
}

function buildDetectedImagePath(outputDir, documentId) {
  const fileName = `asset-${documentId}-${Date.now()}.png`
  return {
    absolutePath: path.join(outputDir, fileName),
    relativePath: `/images/${documentId}/${fileName}`
  }
}

function applyFixedAadhaarImageSelection(imagePaths, result, imageObject) {
  if (!Array.isArray(imagePaths) || imagePaths.length === 0) return

  const qrImagePath = imagePaths[0] || null
  const faceImagePath = imagePaths[7] || null

  imageObject.qrImage = qrImagePath
  imageObject.faceImage = faceImagePath

  result.structured.aadhaarFixedImageSelection = {
    qrSourceIndex: 1,
    qrImagePath,
    faceSourceIndex: 8,
    faceImagePath,
    availableImageCount: imagePaths.length
  }

  if (qrImagePath) {
    result.structured.qrDetected = qrImagePath
    console.log('   ✓ Aadhaar fixed QR image mapped from image 1')
  }

  if (faceImagePath) {
    result.structured.faceDetected = faceImagePath
    console.log('   ✓ Aadhaar fixed face image mapped from image 8')
  }
}

function applyFixedPanImageSelection(imagePaths, result, imageObject) {
  if (!Array.isArray(imagePaths) || imagePaths.length === 0) return

  const cardImagePath = imagePaths[6] || null
  const qrImagePath = imagePaths[7] || null
  const faceImagePath = imagePaths[8] || null
  const signatureImagePath = imagePaths[9] || imagePaths[2] || null

  if (cardImagePath) {
    result.structured.cardImagePath = cardImagePath
    imageObject.cardImage = cardImagePath
  }

  if (qrImagePath) {
    imageObject.qrImage = qrImagePath
    result.structured.qrDetected = qrImagePath
  }

  if (faceImagePath) {
    imageObject.faceImage = faceImagePath
    result.structured.faceDetected = faceImagePath
  }

  if (signatureImagePath) {
    imageObject.signatureImage = signatureImagePath
    result.structured.signatureDetected = signatureImagePath
  }

  result.structured.panFixedImageSelection = {
    cardSourceIndex: cardImagePath ? 7 : null,
    cardImagePath,
    qrSourceIndex: qrImagePath ? 8 : null,
    qrImagePath,
    faceSourceIndex: faceImagePath ? 9 : null,
    faceImagePath,
    signatureSourceIndex: signatureImagePath === imagePaths[9] ? 10 : signatureImagePath ? 3 : null,
    signatureImagePath,
    availableImageCount: imagePaths.length
  }

  if (cardImagePath) {
    console.log('   ✓ PAN fixed card image mapped from image 7')
  }

  if (qrImagePath) {
    console.log('   ✓ PAN fixed QR image mapped from image 8')
  }

  if (faceImagePath) {
    console.log('   ✓ PAN fixed face image mapped from image 9')
  }

  if (signatureImagePath === imagePaths[9]) {
    console.log('   ✓ PAN fixed signature image mapped from image 10')
  } else if (signatureImagePath === imagePaths[2]) {
    console.log('   ✓ PAN fixed signature image mapped from image 3')
  }
}

/* ======================================================
   DOCUMENT CONFIG - Single Source of Truth
   ====================================================== */
const DOCUMENT_CONFIG = {
  AADHAAR: {
    ocrLanguages: 'eng+hin',
    enableSplitting: true,
    minImageSize: 20,  // Capture address blocks and small elements
    parser: async (text) => {
      const result = parseAadhaarText(text);
      return result.fields || result;
    },
    hasPhoto: true,
    hasQR: true,
    hasSignature: false
  },
  PAN: {
    ocrLanguages: 'eng',
    enableSplitting: false,
    parser: async (text) => {
      const result = parsePanText(text);
      return result.fields || result;
    },
    hasPhoto: true,
    hasQR: true,
    hasSignature: true
  },
  AYUSHMAN: {
    ocrLanguages: 'eng+hin',
    enableSplitting: false,
    minImageSize: 20,  // Capture QR codes and all text blocks
    parser: async (text) => {
      const result = parseAyushmanText(text);
      return result.fields || result;
    },
    hasPhoto: false,
    hasQR: true,
    hasSignature: false
  },
  DRIVING_LICENCE: {
    ocrLanguages: 'eng+hin',
    enableSplitting: false,
    minImageSize: 10,  // Capture signatures and small text sections
    parser: async (text) => {
      const result = parseDrivingLicenceText(text);
      return result.fields || result;
    },
    hasPhoto: true,
    hasQR: true,
    hasSignature: true
  },
  ELECTION_CARD: {
    ocrLanguages: 'eng+hin',
    enableSplitting: false,
    minImageSize: 10,  // Very low threshold to capture signatures (typically 20-50px)
    parser: async (text) => {
      const result = parseElectionText(text);
      return result.fields || result;
    },
    hasPhoto: true,
    hasQR: false,
    hasSignature: true
  },
  ABHA: {
    ocrLanguages: 'eng+hin',
    enableSplitting: false,
    forceImagePipeline: true,
    minImageSize: 10,  // Capture signatures, QR code, and all details
    parser: async (text) => parseABHAText(text),
    hasPhoto: true,
    hasQR: true,
    hasSignature: false
  },
  'E-SHRAM': {
    ocrLanguages: 'eng+hin',
    enableSplitting: true,
    forceImagePipeline: true,
    minImageSize: 15,  // Capture signatures and all text blocks
    parser: parseEShramEnhanced,
    hasPhoto: true,
    hasQR: true,
    hasSignature: false,
    extractRegions: [
      {
        name: 'name-region',
        source: 'front',
        x: 0.0,   // Start from left edge
        y: 0.15,  // Below header
        w: 1.0,   // Full width
        h: 0.25   // Name area (15-40% height)
      }
    ]
  }
};

/* ======================================================
   MAIN PROCESSING FUNCTION
   ====================================================== */
export const processPDF = async ({ documentId, filePath, password, useOCR, documentType }) => {
  console.log('\n' + '='.repeat(60));
  console.log(`🚀 STARTING PROCESSING: ${documentId}`);
  console.log(`📄 Document Type: ${documentType}`);
  console.log(`📁 File Path: ${filePath}`);

  // Force OCR for E-Shram as it has poor PDF text quality
  const forceOCR = documentType === 'E-SHRAM';
  const actualUseOCR = forceOCR || useOCR;

  console.log(`🔤 OCR Enabled: ${actualUseOCR} ${forceOCR ? '(forced for E-SHRAM)' : ''}`);
  console.log('='.repeat(60) + '\n');

  if (!fs.existsSync(filePath)) {
    throw new Error(`File not found: ${filePath}`);
  }

  try {
    await ExtractedData.findByIdAndUpdate(documentId, { status: 'processing' });

    const config = DOCUMENT_CONFIG[documentType];
    if (!config) {
      throw new Error(`Unsupported document type: ${documentType}`);
    }

    // Check if document is image-based
    const isImagePDF = config?.forceImagePipeline || await isImageBasedPDF(filePath, password);

    if (isImagePDF) {
      console.log(`✅ ${documentType} is IMAGE-BASED → Using specialized pipeline\n`);
      await handleImageBasedPDF({ documentId, filePath, password, useOCR: actualUseOCR, documentType }, config);
    } else {
      console.log(`✅ ${documentType} is TEXT-BASED → Direct extraction\n`);
      await handleTextBasedPDF({ documentId, filePath, password, useOCR: actualUseOCR, documentType }, config);
    }

    console.log('\n' + '='.repeat(60));
    console.log(`✅ ${documentType} PROCESSING COMPLETED: ${documentId}`);
    console.log('='.repeat(60) + '\n');

  } catch (error) {
    console.error('\n' + '!'.repeat(60));
    console.error(`❌ PROCESSING FAILED: ${documentId}`);
    console.error(`💥 Error: ${error.message}`);
    console.error('!'.repeat(60) + '\n');

    await ExtractedData.findByIdAndUpdate(documentId, {
      status: 'failed',
      error: error.message
    });

    throw error;
  }
};

/* ======================================================
   IMAGE-BASED PDF HANDLER
   ====================================================== */
async function handleImageBasedPDF(jobData, config) {
  const { documentId, filePath, password, documentType } = jobData;
  const docId = documentId.toString(); // Convert ObjectId to string

  console.log(`⚙️  Config: ${documentType} → ${config.enableSplitting ? 'Front/Back split + ' : ''}${config.ocrLanguages} OCR`);

  // Process PDF to images
  const result = await processImagePDF(filePath, docId, {
    documentType,
    ocrLanguages: config.ocrLanguages,
    enableSplitting: config.enableSplitting,
    extractRegions: config.extractRegions || [],
    parser: config.parser,
    password
  });

  // Smart detection
  console.log('\n' + '-'.repeat(60));
  console.log('🎯 SMART DETECTION: Photo + QR Code');
  console.log('-'.repeat(60));

  const outputDir = path.join(getBaseDir(), 'images', docId);
  await performSmartDetection(result, config, outputDir, docId, documentType);

  // Post-process: for ABHA cards merge any fields the QR decoded that OCR missed
  if (documentType === 'ABHA' && result.structured.qrData) {
    console.log('\n🔗 ABHA: merging QR data into extracted fields...');
    const qrFields = parseABHAFromQR(result.structured.qrData);
    let merged = 0;
    for (const [key, value] of Object.entries(qrFields)) {
      if (value && !result.structured[key]) {
        result.structured[key] = value;
        merged++;
        console.log(`   ✅ QR filled missing field "${key}": ${String(value).substring(0, 60)}`);
      }
    }
    if (merged === 0) console.log('   ℹ️  All ABHA fields already populated from OCR.');
  }

  // Build response
  console.log('\n📦 Building Response Structure...');
  const imageObject = buildImageObject(result, config);

  console.log('\n💾 Saving to Database...');
  console.log('   Images:', Object.keys(imageObject).join(', '));
  console.log('   QR Data Available:', !!result.structured.qrData);
  console.log('   Parsed Fields:', Object.keys(result.structured).length);

  await ExtractedData.findByIdAndUpdate(documentId, {
    status: 'completed',
    structured: result.structured,
    images: [imageObject]
  });
}

/* ======================================================
   TEXT-BASED PDF HANDLER
   ====================================================== */
async function handleTextBasedPDF(jobData, config) {
  const { documentId, filePath, password, useOCR, documentType } = jobData;
  const docId = documentId.toString(); // Convert ObjectId to string
  const docOutputDir = path.join(getBaseDir(), 'images', docId);

  console.log('-'.repeat(60));
  console.log('📖 TEXT EXTRACTION');
  console.log('-'.repeat(60));

  console.log('\n📝 Step 1: Extracting text from PDF...');
  const textData = await extractText(filePath, { password });
  let finalText = textData.text || '';
  console.log(`   ✓ Extracted ${finalText.length} characters`);

  console.log('\n🖼️  Step 2: Extracting embedded images...');
  const imageOptions = { minSize: config?.minImageSize || 100 };
  const imagePaths = await extractImages(filePath, docOutputDir, password, imageOptions);
  console.log(`   ✓ Found ${imagePaths.length} image(s)`);

  if ((useOCR || !finalText.trim()) && imagePaths.length > 0) {
    console.log('\n🔤 Step 3: Running OCR on images...');
    const ocrText = await performOCR(imagePaths);
    finalText = finalText.trim() ? `${finalText}\n\n--- OCR ---\n${ocrText}` : ocrText;
    console.log(`   ✓ OCR added ${ocrText.length} characters`);
  } else {
    console.log('\n🔤 Step 3: OCR → Skipped (not needed)');
  }

  console.log('\n' + '-'.repeat(60));
  console.log('📋 PARSING STRUCTURED FIELDS');
  console.log('-'.repeat(60) + '\n');

  console.log(`⚙️  Parser: ${documentType}`);

  // Prepare parser options based on document type
  let parserOptions = {};
  if (documentType === 'E-SHRAM' && imagePaths.length > 0) {
    // For E-SHRAM, provide image paths for enhanced parsing
    parserOptions = {
      frontPath: imagePaths[0], // First image is front card
      outputDir: docOutputDir
    };
  }

  const structuredFields = config?.parser ? await config.parser(finalText, parserOptions) : {};

  console.log(`   ✓ Parsed ${Object.keys(structuredFields).length} field(s)`);
  if (Object.keys(structuredFields).length > 0) {
    console.log('   Fields:', Object.keys(structuredFields).join(', '));
  }

  const imageObject = imagePaths.reduce((acc, p, i) => {
    acc[`image${i + 1}`] = p;
    return acc;
  }, {});

  const result = {
    structured: {
      ...structuredFields,
      rawText: finalText,
      // Use the first extracted image as primary card image for smart detection
      ...(imagePaths[0] ? { cardImagePath: imagePaths[0] } : {})
    }
  };

  if (imagePaths.length > 0) {
    console.log('\n' + '-'.repeat(60));
    console.log('🎯 SMART DETECTION: Photo + QR Code + Signature');
    console.log('-'.repeat(60));
    await performSmartDetection(result, config, docOutputDir, docId, documentType);
  }

  Object.assign(imageObject, buildImageObject(result, config));

  if (documentType === 'AADHAAR') {
    applyFixedAadhaarImageSelection(imagePaths, result, imageObject)
  }

  if (documentType === 'PAN') {
    applyFixedPanImageSelection(imagePaths, result, imageObject)
  }

  console.log('\n💾 Saving to Database...');
  console.log('   Images:', imagePaths.length);
  console.log('   Text Length:', finalText.length);
  console.log('   Structured Fields:', Object.keys(structuredFields).length);

  await ExtractedData.findByIdAndUpdate(documentId, {
    status: 'completed',
    images: [imageObject],
    structured: result.structured
  });
}

/* ======================================================
   SMART DETECTION (Photo + QR) — pure JS, no Python
   ====================================================== */
async function performSmartDetection(result, config, outputDir, documentId, documentType) {
  // PHOTO DETECTION (JS: variance + edge + skin-tone scoring via imageDetection.js)
  if (config.hasPhoto) {
    console.log('\n👤 Step 1: Photo Detection (JS)');

    const imagePath = documentType === 'E-SHRAM' && result.structured.frontCardPath
      ? path.join(getBaseDir(), result.structured.frontCardPath.replace(/^\//, ''))
      : path.join(getBaseDir(), result.structured.cardImagePath.replace(/^\//, ''));

    const faceAsset = buildDetectedImagePath(outputDir, documentId);
    const faceOutputPath = faceAsset.absolutePath;
    try {
      const faceSuccess = await extractFaceRegion(imagePath, faceOutputPath);
      if (faceSuccess && fs.existsSync(faceOutputPath)) {
        result.structured.faceDetected = faceAsset.relativePath;
        console.log('   ✅ Face region extracted');
      } else {
        console.log('   ⚠️  Face region not found, coordinate-based fallback will be used');
      }
    } catch (err) {
      console.warn('   ⚠️  Face detection failed:', err.message);
    }

  } else {
    console.log('\n👤 Step 1: Photo Detection → Skipped (not applicable)');
  }

  // QR CODE DETECTION (JS: jsQR via imageDetection.js)
  if (config.hasQR) {
    console.log('\n📱 Step 2: QR Code Detection (JS / jsQR)');

    if (result.structured.qrData && result.structured.qrData.toString().trim()) {
      console.log('   ✅ QR data already available from parser, skipping redundant QR detection');
    } else {
      const scanImagePath = documentType === 'E-SHRAM' && result.structured.backCardPath
        ? path.join(getBaseDir(), result.structured.backCardPath.replace(/^\//, ''))
        : path.join(getBaseDir(), result.structured.cardImagePath.replace(/^\//, ''));

      const qrAsset = buildDetectedImagePath(outputDir, documentId);
      const qrOutputPath = qrAsset.absolutePath;
      let decoded = null;
      let qrFoundByJs = false;
      try {
        const qrSuccess = await extractQRRegion(scanImagePath, qrOutputPath);
        if (qrSuccess && fs.existsSync(qrOutputPath)) {
          qrFoundByJs = true;
          result.structured.qrDetected = qrAsset.relativePath;
          console.log('   ✅ QR region extracted');

          // Prefer already-decoded data from detection; only re-scan the saved crop as fallback
          decoded = (qrSuccess.data && qrSuccess.data.trim()) ? qrSuccess.data : await decodeQRImage(qrOutputPath);
          if (decoded) {
            result.structured.qrData = decoded;
            console.log(`   📊 QR decoded: ${decoded.length} characters`);
          } else {
            console.log('   ⚠️  QR region found but could not decode data');
          }
        } else {
          console.log('   ⚠️  QR region not found');
        }
      } catch (err) {
        console.warn('   ⚠️  QR detection failed:', err.message);
      }

    }
  } else {
    console.log('\n📱 Step 2: QR Code Detection → Skipped (not applicable)');
  }

  // SIGNATURE DETECTION (JS: stroke-density + aspect-ratio scoring)
  if (config.hasSignature) {
    console.log('\n✍️  Step 3: Signature Detection (JS)');

    const sigSourcePath = documentType === 'E-SHRAM' && result.structured.frontCardPath
      ? path.join(getBaseDir(), result.structured.frontCardPath.replace(/^\//, ''))
      : path.join(getBaseDir(), result.structured.cardImagePath.replace(/^\//, ''));

    const signatureAsset = buildDetectedImagePath(outputDir, documentId);
    const sigOutputPath = signatureAsset.absolutePath;
    try {
      const sigSuccess = await extractSignatureRegion(sigSourcePath, sigOutputPath);
      if (sigSuccess && fs.existsSync(sigOutputPath)) {
        result.structured.signatureDetected = signatureAsset.relativePath;
        console.log('   ✅ Signature region extracted');
      } else {
        console.log('   ⚠️  Signature region not found, coordinate-based fallback will be used');
      }
    } catch (err) {
      console.warn('   ⚠️  Signature detection failed:', err.message);
    }

  } else {
    console.log('\n✍️  Step 3: Signature Detection → Skipped (not applicable)');
  }
}

/* ======================================================
   BUILD IMAGE OBJECT FOR RESPONSE
   ====================================================== */
function buildImageObject(result, config) {
  const imageObject = {
    cardImage: result.structured.cardImagePath
  };

  // Front/Back split images
  if (result.structured.frontCardPath) {
    imageObject.frontCard = result.structured.frontCardPath;
    imageObject.backCard = result.structured.backCardPath;
    console.log('   ✓ Front/back split images available');
  }

  // Face/Photo image (prefer detected over coordinate-based)
  if (result.structured.faceDetected) {
    imageObject.faceImage = result.structured.faceDetected;
    console.log('   ✓ Using smart-detected face image');
  } else if (result.structured.face) {
    imageObject.faceImage = result.structured.face;
    console.log('   ✓ Using coordinate-based face image');
  } else if (result.structured.photoDetected) {
    imageObject.photoImage = result.structured.photoDetected;
    console.log('   ✓ Using smart-detected photo image');
  } else if (result.structured.photo) {
    imageObject.photoImage = result.structured.photo;
    console.log('   ✓ Using coordinate-based photo image');
  }

  // QR image (prefer detected over coordinate-based)
  if (result.structured.qrDetected) {
    imageObject.qrImage = result.structured.qrDetected;
    console.log('   ✓ Using decoded QR image');
  } else if (result.structured.qr) {
    imageObject.qrImage = result.structured.qr;
    console.log('   ✓ Using coordinate-based QR image');
  }

  // Signature image
  if (result.structured.signatureDetected) {
    imageObject.signatureImage = result.structured.signatureDetected;
    console.log('   ✓ Using smart-detected signature image');
  } else if (result.structured.signature) {
    imageObject.signatureImage = result.structured.signature;
    console.log('   ✓ Using coordinate-based signature image');
  }

  return imageObject;
}
