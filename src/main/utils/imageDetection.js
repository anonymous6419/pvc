/**
 * Automatic QR Code Detection + Smart Face Region Detection
 * Uses jsQR for QR detection (works perfectly!)
 * Uses edge detection + improved coordinate logic for face regions
 */

import jsQR from 'jsqr';
import { Jimp } from 'jimp';
import fs from 'fs';

/**
 * Decode QR code from an already-cropped QR image
 * Applies aggressive preprocessing to decode small/low-quality QR codes
 * @param {string} imagePath - Path to cropped QR image
 * @returns {string|null} - Decoded QR data or null
 */
export async function decodeQRImage(imagePath) {
    try {
        console.log('🔍 Decoding QR from cropped image:', imagePath);
        
        if (!fs.existsSync(imagePath)) {
            console.log('⚠️ QR image file not found');
            return null;
        }
        
        let image = await Jimp.read(imagePath);
        
        // Try aggressive preprocessing strategies for small QR codes
        const strategies = [
            { name: 'original', process: (img) => img },
            { name: '2x-upscale', process: (img) => img.scale(2) },
            { name: '3x-upscale', process: (img) => img.scale(3) },
            { name: '4x-upscale', process: (img) => img.scale(4) },
            { name: '5x-upscale', process: (img) => img.scale(5) },
            { name: '3x-greyscale-contrast', process: (img) => img.scale(3).greyscale().contrast(0.5) },
            { name: '4x-greyscale-contrast', process: (img) => img.scale(4).greyscale().contrast(0.7) },
            { name: '5x-greyscale-contrast', process: (img) => img.scale(5).greyscale().contrast(1.0) }
        ];
        
        for (const strategy of strategies) {
            console.log(`  Trying decode strategy: ${strategy.name}...`);
            
            const processedImage = image.clone();
            strategy.process(processedImage);
            
            const { width, height, data } = processedImage.bitmap;
            const rgbaData = new Uint8ClampedArray(data);
            
            const qrCode = jsQR(rgbaData, width, height, {
                inversionAttempts: 'attemptBoth'
            });
            
            if (qrCode && qrCode.data) {
                console.log(`✅ QR decoded with strategy: ${strategy.name}`);
                console.log(`📱 Data: ${qrCode.data.substring(0, 100)}...`);
                return qrCode.data;
            }
        }
        
        console.log('⚠️ Could not decode QR with any strategy');
        return null;
        
    } catch (err) {
        console.error('❌ QR decode error:', err.message);
        return null;
    }
}

/**
 * Smart face region detection using multiple strategies
 * Analyzes image for rectangular photo regions with face-like characteristics
 * @param {string} imagePath - Path to image file
 * @returns {Object|null} - {x, y, width, height} or null if failed
 */
export async function detectFace(imagePath) {
    try {
        console.log('🔍 Analyzing image for face region:', imagePath);
        
        const image = await Jimp.read(imagePath);
        const { width, height } = image.bitmap;
        
        // Strategy 1: Check multiple common photo positions on ID cards
        const candidateRegions = [
            // Top-left (common in Indian IDs)
            { name: 'top-left', x: 0.05, y: 0.15, w: 0.25, h: 0.35 },
            { name: 'top-left-wide', x: 0.05, y: 0.18, w: 0.30, h: 0.40 },
            // Top-right (common in ABHA, some cards)
            { name: 'top-right', x: 0.70, y: 0.15, w: 0.25, h: 0.35 },
            { name: 'top-right-wide', x: 0.65, y: 0.18, w: 0.30, h: 0.40 },
            // Left-center (some licenses)
            { name: 'left-center', x: 0.05, y: 0.25, w: 0.25, h: 0.40 },
            // Right-center
            { name: 'right-center', x: 0.70, y: 0.25, w: 0.25, h: 0.40 }
        ];
        
        let bestRegion = null;
        let highestScore = 0;
        
        for (const region of candidateRegions) {
            const cropX = Math.floor(width * region.x);
            const cropY = Math.floor(height * region.y);
            const cropW = Math.floor(width * region.w);
            const cropH = Math.floor(height * region.h);
            
            const sample = image.clone().crop({ x: cropX, y: cropY, w: cropW, h: cropH });
            
            // Calculate multiple scores
            const variance = calculateVariance(sample);
            const edgeScore = calculateEdgeDensity(sample);
            const skinToneScore = calculateSkinTonePresence(sample);
            
            // Weighted score: variance + edges + skin tone
            const score = (variance * 0.4) + (edgeScore * 0.3) + (skinToneScore * 0.3);
            
            console.log(`  ${region.name}: score=${score.toFixed(0)} (var=${variance.toFixed(0)}, edge=${edgeScore.toFixed(0)}, skin=${skinToneScore.toFixed(0)})`);
            
            if (score > highestScore) {
                highestScore = score;
                bestRegion = { 
                    x: cropX, 
                    y: cropY, 
                    width: cropW, 
                    height: cropH, 
                    name: region.name,
                    score: score
                };
            }
        }
        
        if (bestRegion && bestRegion.score > 1000) {
            console.log(`✅ Best face region: ${bestRegion.name} (score: ${bestRegion.score.toFixed(0)})`);
            return bestRegion;
        }
        
        console.log('⚠️ Could not determine best face region (low confidence)');
        return null;
        
    } catch (err) {
        console.error('❌ Face region detection error:', err.message);
        return null;
    }
}

/**
 * Calculate pixel variance (measures image detail/complexity)
 */
function calculateVariance(jimpImage) {
    const { data, width, height } = jimpImage.bitmap;
    let sum = 0;
    let sumSq = 0;
    const totalPixels = width * height;
    
    for (let i = 0; i < data.length; i += 4) {
        // Convert to grayscale
        const gray = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
        sum += gray;
        sumSq += gray * gray;
    }
    
    const mean = sum / totalPixels;
    const variance = (sumSq / totalPixels) - (mean * mean);
    return variance;
}

/**
 * Calculate edge density (faces have lots of edges)
 */
function calculateEdgeDensity(jimpImage) {
    const { data, width, height } = jimpImage.bitmap;
    let edgeCount = 0;
    
    // Simple edge detection: count pixels with high gradient
    for (let y = 1; y < height - 1; y++) {
        for (let x = 1; x < width - 1; x++) {
            const i = (y * width + x) * 4;
            
            // Get grayscale value
            const center = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
            
            // Check neighbors
            const iRight = i + 4;
            const iBottom = i + (width * 4);
            const right = 0.299 * data[iRight] + 0.587 * data[iRight + 1] + 0.114 * data[iRight + 2];
            const bottom = 0.299 * data[iBottom] + 0.587 * data[iBottom + 1] + 0.114 * data[iBottom + 2];
            
            // If gradient is high, it's an edge
            const gradX = Math.abs(center - right);
            const gradY = Math.abs(center - bottom);
            
            if (gradX > 30 || gradY > 30) {
                edgeCount++;
            }
        }
    }
    
    return edgeCount;
}

/**
 * Calculate skin tone presence (faces have skin tones)
 */
function calculateSkinTonePresence(jimpImage) {
    const { data } = jimpImage.bitmap;
    let skinPixels = 0;
    
    for (let i = 0; i < data.length; i += 4) {
        const r = data[i];
        const g = data[i + 1];
        const b = data[i + 2];
        
        // Skin tone detection heuristic (works for various skin tones)
        // Check if pixel falls in skin color range
        if (r > 95 && g > 40 && b > 20 &&
            r > g && r > b &&
            Math.abs(r - g) > 15 &&
            r - b > 15) {
            skinPixels++;
        }
    }
    
    return skinPixels;
}

/**
 * Detect QR code in image and return bounding box
 * Enhanced with image preprocessing for better detection
 * @param {string} imagePath - Path to image file
 * @returns {Object|null} - {x, y, width, height, data} or null if no QR found
 */
export async function detectQRCode(imagePath) {
    try {
        console.log('🔍 Detecting QR code in:', imagePath);
        
        // Load image with Jimp
        let image = await Jimp.read(imagePath);
        const originalWidth = image.bitmap.width;
        const originalHeight = image.bitmap.height;
        
        // ULTRA-AGGRESSIVE preprocessing strategies for difficult QR codes
        const strategies = [
            { name: 'original', process: (img) => img },
            
            // Ultra-high upscaling for small QR codes
            { name: '10x-ultra', process: (img) => img.scale(10).greyscale().contrast(1.0).normalize() },
            { name: '12x-extreme', process: (img) => img.scale(12).greyscale().contrast(1.0).normalize() },
            { name: '15x-maximum', process: (img) => img.scale(15).greyscale().contrast(1.0).normalize() },
            
            // High upscaling with sharpening
            { name: '8x-ultra', process: (img) => img.scale(8).greyscale().contrast(1.0).normalize() },
            { name: '7x-sharp', process: (img) => img.scale(7).greyscale().contrast(1.0).normalize() },
            { name: '6x-sharp', process: (img) => img.scale(6).contrast(1.0).normalize() },
            { name: '5x-sharp', process: (img) => img.scale(5).contrast(1.0).normalize() },
            { name: '4x-sharp', process: (img) => img.scale(4).contrast(0.9).normalize() },
            
            // Extreme binary thresholds for high contrast
            { name: '10x-binary-128', process: (img) => {
                img = img.scale(10).greyscale();
                img.scan(0, 0, img.bitmap.width, img.bitmap.height, function (x, y, idx) {
                    const val = this.bitmap.data[idx] > 128 ? 255 : 0;
                    this.bitmap.data[idx] = this.bitmap.data[idx + 1] = this.bitmap.data[idx + 2] = val;
                });
                return img;
            }},
            { name: '12x-binary-128', process: (img) => {
                img = img.scale(12).greyscale();
                img.scan(0, 0, img.bitmap.width, img.bitmap.height, function (x, y, idx) {
                    const val = this.bitmap.data[idx] > 128 ? 255 : 0;
                    this.bitmap.data[idx] = this.bitmap.data[idx + 1] = this.bitmap.data[idx + 2] = val;
                });
                return img;
            }},
            { name: '8x-binary-128', process: (img) => {
                img = img.scale(8).greyscale();
                img.scan(0, 0, img.bitmap.width, img.bitmap.height, function (x, y, idx) {
                    const val = this.bitmap.data[idx] > 128 ? 255 : 0;
                    this.bitmap.data[idx] = this.bitmap.data[idx + 1] = this.bitmap.data[idx + 2] = val;
                });
                return img;
            }},
            
            // Binary threshold at different levels (with blur to reduce noise)
            { name: '5x-blur-binary-100', process: (img) => {
                img = img.scale(5).greyscale().blur(1);
                img.scan(0, 0, img.bitmap.width, img.bitmap.height, function (x, y, idx) {
                    const val = this.bitmap.data[idx] > 100 ? 255 : 0;
                    this.bitmap.data[idx] = this.bitmap.data[idx + 1] = this.bitmap.data[idx + 2] = val;
                });
                return img;
            }},
            { name: '5x-blur-binary-128', process: (img) => {
                img = img.scale(5).greyscale().blur(1);
                img.scan(0, 0, img.bitmap.width, img.bitmap.height, function (x, y, idx) {
                    const val = this.bitmap.data[idx] > 128 ? 255 : 0;
                    this.bitmap.data[idx] = this.bitmap.data[idx + 1] = this.bitmap.data[idx + 2] = val;
                });
                return img;
            }},
            { name: '5x-blur-binary-150', process: (img) => {
                img = img.scale(5).greyscale().blur(1);
                img.scan(0, 0, img.bitmap.width, img.bitmap.height, function (x, y, idx) {
                    const val = this.bitmap.data[idx] > 150 ? 255 : 0;
                    this.bitmap.data[idx] = this.bitmap.data[idx + 1] = this.bitmap.data[idx + 2] = val;
                });
                return img;
            }},
            { name: '6x-blur-binary-128', process: (img) => {
                img = img.scale(6).greyscale().blur(1);
                img.scan(0, 0, img.bitmap.width, img.bitmap.height, function (x, y, idx) {
                    const val = this.bitmap.data[idx] > 128 ? 255 : 0;
                    this.bitmap.data[idx] = this.bitmap.data[idx + 1] = this.bitmap.data[idx + 2] = val;
                });
                return img;
            }},
            
            // Inverted (white QR on black background)
            { name: '10x-inverted', process: (img) => img.scale(10).greyscale().invert().contrast(1.0) },
            { name: '8x-inverted', process: (img) => img.scale(8).greyscale().invert().contrast(1.0) },
            { name: '6x-inverted', process: (img) => img.scale(6).greyscale().invert().contrast(1.0) },
            { name: '5x-inverted', process: (img) => img.scale(5).greyscale().invert().contrast(1.0) },
            
            // Brightness adjustments for light/dark QR codes
            { name: '10x-bright', process: (img) => img.scale(10).greyscale().brightness(0.2).contrast(1.0) },
            { name: '10x-dark', process: (img) => img.scale(10).greyscale().brightness(-0.2).contrast(1.0) },
            { name: '8x-bright', process: (img) => img.scale(8).greyscale().brightness(0.3).contrast(1.0) },
            { name: '8x-dark', process: (img) => img.scale(8).greyscale().brightness(-0.3).contrast(1.0) },
            
            // Binary without blur (sharper edges)
            { name: '6x-binary-120', process: (img) => {
                img = img.scale(6).greyscale();
                img.scan(0, 0, img.bitmap.width, img.bitmap.height, function (x, y, idx) {
                    const val = this.bitmap.data[idx] > 120 ? 255 : 0;
                    this.bitmap.data[idx] = this.bitmap.data[idx + 1] = this.bitmap.data[idx + 2] = val;
                });
                return img;
            }},
            { name: '7x-binary-128', process: (img) => {
                img = img.scale(7).greyscale();
                img.scan(0, 0, img.bitmap.width, img.bitmap.height, function (x, y, idx) {
                    const val = this.bitmap.data[idx] > 128 ? 255 : 0;
                    this.bitmap.data[idx] = this.bitmap.data[idx + 1] = this.bitmap.data[idx + 2] = val;
                });
                return img;
            }},
            
            // Adaptive: High contrast + greyscale
            { name: '5x-adaptive', process: (img) => img.scale(5).greyscale().normalize().contrast(0.8) },
            { name: '6x-adaptive', process: (img) => img.scale(6).greyscale().normalize().contrast(0.9) }
        ];
        
        for (const strategy of strategies) {
            console.log(`  Trying strategy: ${strategy.name}...`);
            
            // Apply preprocessing
            const processedImage = image.clone();
            strategy.process(processedImage);
            
            const { width, height, data } = processedImage.bitmap;
            const rgbaData = new Uint8ClampedArray(data);
            
            // Detect QR code
            const qrCode = jsQR(rgbaData, width, height, {
                inversionAttempts: 'attemptBoth' // Try both normal and inverted
            });
            
            if (qrCode) {
                console.log(`✅ QR detected with strategy: ${strategy.name}`);
                
                // Calculate bounding box (adjust for upscaling)
                const scale = width / originalWidth;
                const { topLeftCorner, topRightCorner, bottomLeftCorner, bottomRightCorner } = qrCode.location;
                
                const minX = Math.min(topLeftCorner.x, bottomLeftCorner.x) / scale;
                const maxX = Math.max(topRightCorner.x, bottomRightCorner.x) / scale;
                const minY = Math.min(topLeftCorner.y, topRightCorner.y) / scale;
                const maxY = Math.max(bottomLeftCorner.y, bottomRightCorner.y) / scale;
                
                // Add generous padding around QR (25% on each side for quiet zone)
                const padding = 0.25;
                const qrWidth = maxX - minX;
                const qrHeight = maxY - minY;
                
                const paddedBox = {
                    x: Math.max(0, Math.floor(minX - qrWidth * padding)),
                    y: Math.max(0, Math.floor(minY - qrHeight * padding)),
                    width: Math.floor(qrWidth * (1 + 2 * padding)),
                    height: Math.floor(qrHeight * (1 + 2 * padding)),
                    data: qrCode.data // Decoded QR data
                };
                
                // Ensure box is within image bounds
                paddedBox.width = Math.min(paddedBox.width, originalWidth - paddedBox.x);
                paddedBox.height = Math.min(paddedBox.height, originalHeight - paddedBox.y);
                
                console.log('✅ QR code detected at:', paddedBox);
                console.log('📱 QR data length:', qrCode.data.length, 'chars');
                console.log('📝 QR data preview:', qrCode.data.substring(0, 100));
                
                return paddedBox;
            }
        }
        
        console.log('⚠️ No QR code detected with any strategy');
        return null;
        
    } catch (err) {
        console.error('❌ QR detection error:', err.message);
        return null;
    }
}

/**
 * Extract face from image using automatic detection
 * @param {string} imagePath - Source image path
 * @param {string} outputPath - Where to save extracted face
 * @returns {string|null} - Output path or null if failed
 */
export async function extractFaceRegion(imagePath, outputPath) {
    try {
        const faceBox = await detectFace(imagePath);
        if (!faceBox) return null;
        
        const image = await Jimp.read(imagePath);
        const face = image.clone().crop({
            x: faceBox.x,
            y: faceBox.y,
            w: faceBox.width,
            h: faceBox.height
        });
        
        await face.write(outputPath);
        console.log('✅ Face saved to:', outputPath);
        return outputPath;
        
    } catch (err) {
        console.error('❌ Face extraction error:', err.message);
        return null;
    }
}

/**
 * Detect signature region in an ID card image.
 *
 * Signature heuristics:
 *   - Lives in the bottom 40% of the card
 *   - Horizontal: w/h > 1.5
 *   - Mostly white with thin dark ink strokes (5–30% dark pixels)
 *   - Moderate edge density (ink strokes create edges)
 *   - Not a QR code (jsQR fails)
 *   - Not a face (low skin-tone score)
 *
 * @param {string} imagePath
 * @returns {Object|null} {x, y, width, height} or null
 */
export async function detectSignatureRegion(imagePath) {
    try {
        console.log('🔍 Analyzing image for signature region:', imagePath);

        const image = await Jimp.read(imagePath);
        const { width, height } = image.bitmap;

        // Candidate regions: bottom 20–45% of card, various horizontal spans
        const candidateRegions = [
            // Wide center-bottom (most common signature placement)
            { name: 'wide-center-bottom',  x: 0.25, y: 0.70, w: 0.50, h: 0.13 },
            { name: 'wide-center-bottom2', x: 0.25, y: 0.75, w: 0.50, h: 0.13 },
            { name: 'wide-center-bottom3', x: 0.20, y: 0.68, w: 0.55, h: 0.15 },
            // Slightly narrower
            { name: 'mid-center-bottom',   x: 0.30, y: 0.70, w: 0.40, h: 0.12 },
            { name: 'mid-center-bottom2',  x: 0.30, y: 0.75, w: 0.40, h: 0.13 },
            // Lower strip
            { name: 'lower-left',          x: 0.05, y: 0.78, w: 0.45, h: 0.13 },
            { name: 'lower-center',        x: 0.20, y: 0.78, w: 0.55, h: 0.13 },
            { name: 'lower-right',         x: 0.50, y: 0.78, w: 0.45, h: 0.13 },
            // Near-bottom strip
            { name: 'bottom-left',         x: 0.05, y: 0.82, w: 0.45, h: 0.12 },
            { name: 'bottom-center',       x: 0.20, y: 0.82, w: 0.55, h: 0.12 },
            { name: 'bottom-right',        x: 0.50, y: 0.82, w: 0.45, h: 0.12 },
        ];

        let bestRegion = null;
        let highestScore = 0;

        for (const region of candidateRegions) {
            const cropX = Math.floor(width  * region.x);
            const cropY = Math.floor(height * region.y);
            const cropW = Math.floor(width  * region.w);
            const cropH = Math.floor(height * region.h);

            if (cropW < 20 || cropH < 8) continue;

            const sample = image.clone().crop({ x: cropX, y: cropY, w: cropW, h: cropH });

            // --- Signal 1: stroke density (dark pixels on light background) ---
            const strokeDensity = calculateStrokeDensity(sample);

            // Ideal signature: 4–35% dark pixels.  More → likely a text block or QR.
            if (strokeDensity < 0.02 || strokeDensity > 0.45) {
                console.log(`  ${region.name}: skipped (strokeDensity=${strokeDensity.toFixed(3)})`);
                continue;
            }

            // --- Signal 2: aspect ratio (signatures are wide) ---
            const aspectRatio = cropW / cropH;
            if (aspectRatio < 1.5) {
                console.log(`  ${region.name}: skipped (aspectRatio=${aspectRatio.toFixed(2)})`);
                continue;
            }

            // --- Signal 3: edge density (ink strokes have edges) ---
            const edgeScore = calculateEdgeDensity(sample);

            // --- Signal 4: reject face regions (high skin score) ---
            const skinScore = calculateSkinTonePresence(sample);
            if (skinScore > 500) {
                console.log(`  ${region.name}: skipped (high skin score=${skinScore})`);
                continue;
            }

            // --- Signal 5: reject QR codes (attempt quick jsQR decode) ---
            const { data: bmpData, width: bmpW, height: bmpH } = sample.bitmap;
            const rgba = new Uint8ClampedArray(bmpData);
            if (jsQR(rgba, bmpW, bmpH, { inversionAttempts: 'dontInvert' })) {
                console.log(`  ${region.name}: skipped (QR code detected)`);
                continue;
            }

            // Score: reward moderate stroke density and high aspect ratio
            const densityScore  = 1 - Math.abs(strokeDensity - 0.12) / 0.12; // peak at 12%
            const score = densityScore * 100 + (aspectRatio * 10) + (edgeScore * 0.05);

            console.log(`  ${region.name}: score=${score.toFixed(1)} (stroke=${strokeDensity.toFixed(3)}, ar=${aspectRatio.toFixed(2)}, edge=${edgeScore.toFixed(0)})`);

            if (score > highestScore) {
                highestScore = score;
                bestRegion = { x: cropX, y: cropY, width: cropW, height: cropH, name: region.name, score };
            }
        }

        if (bestRegion && bestRegion.score > 10) {
            console.log(`✅ Best signature region: ${bestRegion.name} (score: ${bestRegion.score.toFixed(1)})`);
            return bestRegion;
        }

        console.log('⚠️ Could not determine signature region (low confidence)');
        return null;

    } catch (err) {
        console.error('❌ Signature detection error:', err.message);
        return null;
    }
}

/**
 * Calculate stroke density: fraction of "dark" pixels (< 100 brightness).
 * Used to distinguish ink strokes from blank whitespace.
 */
function calculateStrokeDensity(jimpImage) {
    const { data, width, height } = jimpImage.bitmap;
    let darkPixels = 0;
    const totalPixels = width * height;

    for (let i = 0; i < data.length; i += 4) {
        const brightness = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
        if (brightness < 100) darkPixels++;
    }

    return darkPixels / totalPixels;
}

/**
 * Extract signature from image using automatic detection.
 * @param {string} imagePath - Source image path
 * @param {string} outputPath - Where to save extracted signature
 * @returns {string|null} - outputPath or null if failed
 */
export async function extractSignatureRegion(imagePath, outputPath) {
    try {
        const sigBox = await detectSignatureRegion(imagePath);
        if (!sigBox) return null;

        const image = await Jimp.read(imagePath);
        const sig = image.clone().crop({
            x: sigBox.x,
            y: sigBox.y,
            w: sigBox.width,
            h: sigBox.height
        });

        await sig.write(outputPath);
        console.log('✅ Signature saved to:', outputPath);
        return outputPath;

    } catch (err) {
        console.error('❌ Signature extraction error:', err.message);
        return null;
    }
}

/**
 * Extract QR code from image using automatic detection
 * @param {string} imagePath - Source image path
 * @param {string} outputPath - Where to save extracted QR
 * @returns {Object|null} - {path, data} or null if failed
 */
export async function extractQRRegion(imagePath, outputPath) {
    try {
        const qrBox = await detectQRCode(imagePath);
        if (!qrBox) return null;
        
        const image = await Jimp.read(imagePath);
        const qr = image.clone().crop({
            x: qrBox.x,
            y: qrBox.y,
            w: qrBox.width,
            h: qrBox.height
        });
        
        await qr.write(outputPath);
        console.log('✅ QR code saved to:', outputPath);
        
        return {
            path: outputPath,
            data: qrBox.data
        };
        
    } catch (err) {
        console.error('❌ QR extraction error:', err.message);
        return null;
    }
}
