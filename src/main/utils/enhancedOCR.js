import Tesseract from 'tesseract.js';
import { Jimp } from 'jimp';
import fs from 'fs';
import path from 'path';

/**
 * Preprocess image for better OCR quality
 * @param {Jimp} image - Input image
 * @param {string} strategy - Preprocessing strategy: 'default', 'high-contrast', 'sharpen', 'threshold'
 * @returns {Jimp} Preprocessed image
 */
export function preprocessImageForOCR(image, strategy = 'default') {
    const processed = image.clone();
    
    switch (strategy) {
        case 'default':
            // Basic preprocessing - good for most cases
            return processed
                .greyscale()
                .contrast(0.3)
                .normalize();
        
        case 'high-contrast':
            // For faded or low-contrast documents
            return processed
                .greyscale()
                .contrast(0.6)
                .brightness(0.1)
                .normalize();
        
        case 'sharpen':
            // For blurry documents
            return processed
                .greyscale()
                .convolute([
                    [0, -1, 0],
                    [-1, 5, -1],
                    [0, -1, 0]
                ])
                .contrast(0.4)
                .normalize();
        
        case 'threshold':
            // For very poor quality - convert to pure black/white
            return processed
                .greyscale()
                .contrast(0.5)
                .normalize()
                .threshold({ max: 128 });
        
        case 'aggressive':
            // Most aggressive preprocessing for extremely poor scans
            return processed
                .greyscale()
                .contrast(0.8)
                .brightness(0.2)
                .convolute([
                    [-1, -1, -1],
                    [-1, 9, -1],
                    [-1, -1, -1]    
                ])
                .normalize()
                .threshold({ max: 140 });
        
        default:
            return processed.greyscale().normalize();
    }
}

/**
 * Try OCR with multiple preprocessing strategies and return best result
 * @param {string} imagePath - Path to image file or Jimp image object
 * @param {string} languages - OCR languages (e.g., 'eng+hin')
 * @param {string} outputDir - Directory to save preprocessed images
 * @param {string} prefix - Prefix for saved preprocessed images
 * @param {Object} options - Additional options (charWhitelist, etc.)
 * @returns {Promise<{text: string, confidence: number, strategy: string}>} Best OCR result
 */
export async function performEnhancedOCR(imagePath, languages, outputDir, prefix = 'preprocessed', options = {}) {
    console.log(`   🔬 Enhanced OCR with multiple preprocessing strategies...`);
    
    const strategies = ['default', 'high-contrast', 'sharpen', 'threshold', 'aggressive'];
    const results = [];
    
    try {
        const originalImage = typeof imagePath === 'string' 
            ? await Jimp.read(imagePath) 
            : imagePath;
        
        for (const strategy of strategies) {
            try {
                console.log(`      Testing ${strategy} preprocessing...`);
                
                const preprocessed = preprocessImageForOCR(originalImage, strategy);
                const tempPath = path.join(outputDir, `${prefix}-${strategy}.png`);
                await preprocessed.write(tempPath);
                
                // Build OCR options
                const ocrOptions = {
                    logger: () => {} // Suppress verbose logs
                };
                if (options.charWhitelist) {
                    ocrOptions.tessedit_char_whitelist = options.charWhitelist;
                }
                
                // Run OCR with 30s timeout per strategy
                const ocrResult = await Promise.race([
                    Tesseract.recognize(tempPath, languages, ocrOptions),
                    new Promise((_, reject) => 
                        setTimeout(() => reject(new Error(`OCR timeout for ${strategy}`)), 30000)
                    )
                ]);
                
                const text = ocrResult.data.text;
                const confidence = ocrResult.data.confidence || 0;
                
                results.push({
                    strategy,
                    text,
                    confidence,
                    length: text.length
                });
                
                console.log(`      ✓ ${strategy}: ${text.length} chars, ${confidence.toFixed(1)}% confidence`);
                
                // Clean up temp file to save space
                if (fs.existsSync(tempPath)) {
                    fs.unlinkSync(tempPath);
                }
                
            } catch (err) {
                console.warn(`      ⚠️ ${strategy} failed:`, err.message);
            }
        }
        
        // Pick best result: highest confidence, then longest text
        if (results.length === 0) {
            throw new Error('All preprocessing strategies failed');
        }
        
        results.sort((a, b) => {
            // Prioritize confidence if difference is significant
            if (Math.abs(a.confidence - b.confidence) > 10) {
                return b.confidence - a.confidence;
            }
            // Otherwise prioritize length (more text = better extraction)
            return b.length - a.length;
        });
        
        const best = results[0];
        console.log(`   ✅ Best result: ${best.strategy} (${best.length} chars, ${best.confidence.toFixed(1)}% confidence)`);
        
        return best;
        
    } catch (err) {
        console.error(`   ❌ Enhanced OCR failed:`, err.message);
        // Fallback to basic OCR
        console.log(`   🔄 Falling back to basic OCR...`);
        const fallbackResult = await Tesseract.recognize(
            typeof imagePath === 'string' ? imagePath : imagePath,
            languages,
            options.charWhitelist ? { tessedit_char_whitelist: options.charWhitelist } : {}
        );
        return {
            text: fallbackResult.data.text,
            confidence: fallbackResult.data.confidence || 0,
            strategy: 'fallback'
        };
    }
}

