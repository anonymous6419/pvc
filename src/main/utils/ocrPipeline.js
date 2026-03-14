import Tesseract from 'tesseract.js';
import { Jimp } from 'jimp';
import path from 'path';
import fs from 'fs';

/**
 * E-Shram Card Field Definitions
 * Using relative positioning instead of hardcoded pixels
 */
export const ESHRAM_FIELD_REGIONS = {
    FRONT_CARD: {
        name: { x: 0.0, y: 0.15, w: 1.0, h: 0.20 },
        fatherName: { x: 0.0, y: 0.25, w: 1.0, h: 0.18 },
        dob: { x: 0.0, y: 0.40, w: 0.6, h: 0.15 },
        gender: { x: 0.6, y: 0.40, w: 0.4, h: 0.15 },
        uan: { x: 0.0, y: 0.55, w: 1.0, h: 0.20 }
    },
    BACK_CARD: {
        bloodGroup: { x: 0.0, y: 0.10, w: 0.5, h: 0.20 },
        occupation: { x: 0.0, y: 0.15, w: 1.0, h: 0.35 },
        address: { x: 0.0, y: 0.45, w: 1.0, h: 0.30 },
        contactNumber: { x: 0.0, y: 0.70, w: 1.0, h: 0.25 }
    }
};

/**
 * OCR Configuration
 */
export const OCR_CONFIG = {
    MIN_WIDTH: 1200,
    MIN_CONFIDENCE: 70,
    RETRY_THRESHOLD: 50,
    MAX_RETRIES: 3,
    CONCURRENT_LIMIT: 4,
    TIMEOUT_PER_FIELD: 30000
};

/**
 * Image Preprocessing Strategies
 */
const PREPROCESS_STRATEGIES = {
    STANDARD: 'standard',
    HIGH_CONTRAST: 'high_contrast',
    ADAPTIVE_THRESHOLD: 'adaptive_threshold',
    AGGRESSIVE: 'aggressive'
};

/**
 * Apply preprocessing strategy to image
 */
function applyPreprocessing(image, strategy) {
    const processed = image.clone();
    
    switch (strategy) {
        case PREPROCESS_STRATEGIES.STANDARD:
            return processed
                .greyscale()
                .normalize()
                .contrast(0.4);
        
        case PREPROCESS_STRATEGIES.HIGH_CONTRAST:
            return processed
                .greyscale()
                .contrast(0.7)
                .brightness(0.15)
                .normalize();
        
        case PREPROCESS_STRATEGIES.ADAPTIVE_THRESHOLD:
            return processed
                .greyscale()
                .normalize()
                .contrast(0.6)
                .threshold({ max: 128, replace: 255, autoGreyscale: false });
        
        case PREPROCESS_STRATEGIES.AGGRESSIVE:
            return processed
                .greyscale()
                .contrast(0.9)
                .brightness(0.2)
                .convolute([
                    [-1, -1, -1],
                    [-1, 10, -1],
                    [-1, -1, -1]
                ])
                .normalize()
                .threshold({ max: 140, replace: 255, autoGreyscale: false });
        
        default:
            return processed.greyscale().normalize();
    }
}

/**
 * Ensure image meets minimum width requirement
 */
async function ensureMinimumDimensions(imagePath, minWidth = OCR_CONFIG.MIN_WIDTH) {
    const image = await Jimp.read(imagePath);
    const { width, height } = image.bitmap;
    
    console.log(`   📐 Image dimensions: ${width}x${height}px`);
    
    if (width < minWidth) {
        const scaleFactor = minWidth / width;
        const newHeight = Math.floor(height * scaleFactor);
        
        console.log(`   ⚠️ Upscaling from ${width}x${height} to ${minWidth}x${newHeight}`);
        
        const resized = image.resize(minWidth, newHeight, Jimp.RESIZE_BICUBIC);
        await resized.write(imagePath);
        
        return { width: minWidth, height: newHeight, scaled: true };
    }
    
    return { width, height, scaled: false };
}

/**
 * Extract region from image based on relative coordinates
 */
async function extractRegion(imagePath, regionDef, outputPath) {
    const image = await Jimp.read(imagePath);
    const { width, height } = image.bitmap;
    
    const box = {
        x: Math.floor(width * regionDef.x),
        y: Math.floor(height * regionDef.y),
        w: Math.floor(width * regionDef.w),
        h: Math.floor(height * regionDef.h)
    };
    
    const region = image.clone().crop(box);
    await region.write(outputPath);
    
    return { box, dimensions: { width: box.w, height: box.h } };
}

/**
 * Perform OCR with confidence scoring
 */
async function performOCRWithConfidence(imagePath, languages, options = {}) {
    const tesseractOptions = {
        logger: () => {}
    };
    
    if (options.charWhitelist) {
        tesseractOptions.tessedit_char_whitelist = options.charWhitelist;
    }
    
    const result = await Tesseract.recognize(imagePath, languages, tesseractOptions);
    
    return {
        text: result.data.text,
        confidence: result.data.confidence || 0,
        words: result.data.words || []
    };
}

/**
 * Perform field extraction with retry mechanism
 */
async function extractFieldWithRetry(
    imagePath,
    regionDef,
    fieldName,
    languages,
    outputDir,
    options = {}
) {
    console.log(`\n🔍 Extracting field: ${fieldName}`);
    
    // Extract region
    const regionPath = path.join(outputDir, `${fieldName}-region.png`);
    const { dimensions } = await extractRegion(imagePath, regionDef, regionPath);
    
    const strategies = [
        PREPROCESS_STRATEGIES.STANDARD,
        PREPROCESS_STRATEGIES.HIGH_CONTRAST,
        PREPROCESS_STRATEGIES.ADAPTIVE_THRESHOLD,
        PREPROCESS_STRATEGIES.AGGRESSIVE
    ];
    
    let bestResult = { text: '', confidence: 0, strategy: null };
    
    for (const strategy of strategies) {
        try {
            console.log(`   🔬 Trying ${strategy} preprocessing...`);
            
            const regionImage = await Jimp.read(regionPath);
            const preprocessed = applyPreprocessing(regionImage, strategy);
            
            const preprocessedPath = path.join(outputDir, `${fieldName}-${strategy}.png`);
            await preprocessed.write(preprocessedPath);
            
            // Perform OCR with timeout
            const ocrPromise = performOCRWithConfidence(preprocessedPath, languages, options);
            const timeoutPromise = new Promise((_, reject) => 
                setTimeout(() => reject(new Error('OCR timeout')), OCR_CONFIG.TIMEOUT_PER_FIELD)
            );
            
            const result = await Promise.race([ocrPromise, timeoutPromise]);
            
            console.log(`   ✓ ${strategy}: confidence=${result.confidence.toFixed(1)}%, ${result.text.length} chars`);
            
            // Clean up preprocessed file
            if (fs.existsSync(preprocessedPath)) {
                fs.unlinkSync(preprocessedPath);
            }
            
            // Keep best result
            if (result.confidence > bestResult.confidence) {
                bestResult = { ...result, strategy };
            }
            
            // If confidence is good enough, stop trying
            if (result.confidence >= OCR_CONFIG.MIN_CONFIDENCE) {
                console.log(`   ✅ Acceptable confidence reached: ${result.confidence.toFixed(1)}%`);
                break;
            }
            
        } catch (err) {
            console.warn(`   ⚠️ ${strategy} failed:`, err.message);
        }
    }
    
    // Evaluate final result
    if (bestResult.confidence < OCR_CONFIG.MIN_CONFIDENCE) {
        console.warn(`   ⚠️ Low confidence for ${fieldName}: ${bestResult.confidence.toFixed(1)}% < ${OCR_CONFIG.MIN_CONFIDENCE}%`);
    } else {
        console.log(`   ✅ ${fieldName} extracted with ${bestResult.confidence.toFixed(1)}% confidence (${bestResult.strategy})`);
    }
    
    // Clean up region file
    if (fs.existsSync(regionPath)) {
        fs.unlinkSync(regionPath);
    }
    
    return {
        text: bestResult.text,
        confidence: bestResult.confidence,
        strategy: bestResult.strategy,
        fieldName,
        dimensions
    };
}

/**
 * Main OCR Pipeline for E-Shram Cards
 */
export async function runEShramOCRPipeline(frontCardPath, backCardPath, outputDir) {
    console.log('\n' + '='.repeat(70));
    console.log('🚀 E-SHRAM OCR PIPELINE');
    console.log('='.repeat(70));
    
    const results = {
        frontCard: {},
        backCard: {},
        metadata: {
            totalConfidence: 0,
            fieldsExtracted: 0,
            lowConfidenceFields: []
        }
    };
    
    try {
        // Ensure minimum dimensions
        if (frontCardPath && fs.existsSync(frontCardPath)) {
            const frontDims = await ensureMinimumDimensions(frontCardPath);
            console.log(`✅ Front card ready: ${frontDims.width}x${frontDims.height}px${frontDims.scaled ? ' (scaled)' : ''}`);
        }
        
        if (backCardPath && fs.existsSync(backCardPath)) {
            const backDims = await ensureMinimumDimensions(backCardPath);
            console.log(`✅ Back card ready: ${backDims.width}x${backDims.height}px${backDims.scaled ? ' (scaled)' : ''}`);
        }
        
        // Extract all fields from front card
        if (frontCardPath && fs.existsSync(frontCardPath)) {
            console.log('\n📄 Processing FRONT card fields...');
            
            for (const [fieldName, regionDef] of Object.entries(ESHRAM_FIELD_REGIONS.FRONT_CARD)) {
                try {
                    const fieldOptions = {};
                    
                    // Field-specific configurations
                    if (fieldName === 'name' || fieldName === 'fatherName') {
                        fieldOptions.charWhitelist = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz ';
                    } else if (fieldName === 'dob') {
                        fieldOptions.charWhitelist = '0123456789/-. ';
                    } else if (fieldName === 'uan') {
                        fieldOptions.charWhitelist = '0123456789 ';
                    }
                    
                    const result = await extractFieldWithRetry(
                        frontCardPath,
                        regionDef,
                        fieldName,
                        fieldName === 'dob' || fieldName === 'uan' ? 'eng' : 'eng+hin',
                        outputDir,
                        fieldOptions
                    );
                    
                    results.frontCard[fieldName] = result;
                    results.metadata.totalConfidence += result.confidence;
                    results.metadata.fieldsExtracted++;
                    
                    if (result.confidence < OCR_CONFIG.MIN_CONFIDENCE) {
                        results.metadata.lowConfidenceFields.push(fieldName);
                    }
                    
                } catch (err) {
                    console.error(`   ❌ Failed to extract ${fieldName}:`, err.message);
                    results.frontCard[fieldName] = { text: '', confidence: 0, error: err.message };
                }
            }
        }
        
        // Extract all fields from back card
        if (backCardPath && fs.existsSync(backCardPath)) {
            console.log('\n📄 Processing BACK card fields...');
            
            for (const [fieldName, regionDef] of Object.entries(ESHRAM_FIELD_REGIONS.BACK_CARD)) {
                try {
                    const fieldOptions = {};
                    
                    // Field-specific configurations
                    if (fieldName === 'contactNumber') {
                        fieldOptions.charWhitelist = '0123456789 .-';
                    } else if (fieldName === 'bloodGroup') {
                        fieldOptions.charWhitelist = 'ABOab+- ';
                    }
                    
                    const result = await extractFieldWithRetry(
                        backCardPath,
                        regionDef,
                        fieldName,
                        fieldName === 'contactNumber' ? 'eng' : 'eng+hin',
                        outputDir,
                        fieldOptions
                    );
                    
                    results.backCard[fieldName] = result;
                    results.metadata.totalConfidence += result.confidence;
                    results.metadata.fieldsExtracted++;
                    
                    if (result.confidence < OCR_CONFIG.MIN_CONFIDENCE) {
                        results.metadata.lowConfidenceFields.push(fieldName);
                    }
                    
                } catch (err) {
                    console.error(`   ❌ Failed to extract ${fieldName}:`, err.message);
                    results.backCard[fieldName] = { text: '', confidence: 0, error: err.message };
                }
            }
        }
        
        // Calculate average confidence
        if (results.metadata.fieldsExtracted > 0) {
            results.metadata.averageConfidence = 
                results.metadata.totalConfidence / results.metadata.fieldsExtracted;
        }
        
        console.log('\n' + '='.repeat(70));
        console.log(`📊 Pipeline Summary:`);
        console.log(`   Fields extracted: ${results.metadata.fieldsExtracted}`);
        console.log(`   Average confidence: ${(results.metadata.averageConfidence || 0).toFixed(1)}%`);
        console.log(`   Low confidence fields: ${results.metadata.lowConfidenceFields.join(', ') || 'None'}`);
        console.log('='.repeat(70) + '\n');
        
        return results;
        
    } catch (err) {
        console.error('❌ OCR Pipeline failed:', err);
        throw err;
    }
}

/**
 * Concurrent-safe OCR job manager
 */
class OCRJobQueue {
    constructor(concurrentLimit = OCR_CONFIG.CONCURRENT_LIMIT) {
        this.concurrentLimit = concurrentLimit;
        this.activeJobs = 0;
        this.queue = [];
    }
    
    async add(jobFunction) {
        if (this.activeJobs >= this.concurrentLimit) {
            await new Promise(resolve => this.queue.push(resolve));
        }
        
        this.activeJobs++;
        
        try {
            return await jobFunction();
        } finally {
            this.activeJobs--;
            if (this.queue.length > 0) {
                const nextResolve = this.queue.shift();
                nextResolve();
            }
        }
    }
}

export const ocrJobQueue = new OCRJobQueue();
