import { runEShramOCRPipeline, ocrJobQueue } from './ocrPipeline.js';
import { decodeEShramQR, mergeQRWithOCR } from './qrDecoder.js';
import { processEShramFields } from './eshramFieldExtractor.js';
import path from 'path';
import fs from 'fs';

/**
 * Refactored E-Shram Parser with Robust OCR Pipeline
 * 
 * Features:
 * - QR code decoding with priority
 * - Field-level confidence scoring
 * - Minimum dimension enforcement (1200px)
 * - Retry mechanism with multiple preprocessing strategies
 * - Concurrent job management
 * - No regex parsing on full text blob
 * - Relative positioning instead of hardcoded pixels
 */
export async function parseEShramRobust(options = {}) {
    const {
        frontPath,
        backPath,
        qrPath,
        outputDir,
        documentId
    } = options;
    
    console.log('\n' + '═'.repeat(70));
    console.log('🚀 E-SHRAM ROBUST PARSER V2');
    console.log('═'.repeat(70));
    
    // Validate inputs
    if (!frontPath || !fs.existsSync(frontPath)) {
        throw new Error('Front card image is required');
    }
    
    if (!outputDir) {
        throw new Error('Output directory is required');
    }
    
    // Ensure output directory exists
    if (!fs.existsSync(outputDir)) {
        fs.mkdirSync(outputDir, { recursive: true });
    }
    
    const result = {
        documentId,
        fields: {},
        metadata: {
            qrDecoded: false,
            ocrPerformed: false,
            totalConfidence: 0,
            averageConfidence: 0,
            lowConfidenceFields: [],
            processingTime: 0
        },
        rawData: {
            qr: null,
            ocr: null
        }
    };
    
    const startTime = Date.now();
    
    try {
        // Step 1: Try QR decoding first (highest accuracy)
        if (qrPath && fs.existsSync(qrPath)) {
            console.log('\n📱 STEP 1: QR Decoding');
            const qrData = await decodeEShramQR(qrPath);
            
            if (qrData && qrData.parsed) {
                result.rawData.qr = qrData;
                result.metadata.qrDecoded = true;
                
                // Convert QR data to field format
                Object.entries(qrData.parsed).forEach(([field, value]) => {
                    if (value) {
                        result.fields[field] = {
                            value,
                            confidence: 100,
                            source: 'qr',
                            method: 'qr-decode'
                        };
                    }
                });
                
                console.log(`   ✅ ${Object.keys(result.fields).length} fields extracted from QR`);
            }
        }
        
        // Step 2: Perform OCR pipeline (concurrent-safe)
        console.log('\n📸 STEP 2: OCR Pipeline');
        console.log('   ⏳ Adding to OCR queue...');
        
        const ocrResults = await ocrJobQueue.add(async () => {
            return await runEShramOCRPipeline(frontPath, backPath, outputDir);
        });
        
        result.rawData.ocr = ocrResults;
        result.metadata.ocrPerformed = true;
        
        // Step 3: Extract structured fields from OCR
        console.log('\n📋 STEP 3: Field Extraction');
        const extractedFields = processEShramFields(ocrResults);
        
        // Step 4: Merge QR and OCR data (QR takes precedence)
        console.log('\n🔄 STEP 4: Data Merging');
        Object.entries(extractedFields).forEach(([field, data]) => {
            // Only use OCR data if QR didn't provide this field
            if (!result.fields[field] || result.fields[field].confidence < data.confidence) {
                if (data.value) {
                    result.fields[field] = {
                        value: data.value,
                        confidence: data.confidence,
                        source: result.fields[field] ? 'qr' : 'ocr',
                        method: data.method
                    };
                }
            }
        });
        
        // Calculate metadata
        const fieldsWithData = Object.values(result.fields).filter(f => f.value);
        result.metadata.totalConfidence = fieldsWithData.reduce((sum, f) => sum + f.confidence, 0);
        result.metadata.averageConfidence = fieldsWithData.length > 0 
            ? result.metadata.totalConfidence / fieldsWithData.length 
            : 0;
        
        result.metadata.lowConfidenceFields = Object.entries(result.fields)
            .filter(([_, data]) => data.confidence < 70)
            .map(([field, _]) => field);
        
        result.metadata.processingTime = Date.now() - startTime;
        
        // Final report
        console.log('\n' + '═'.repeat(70));
        console.log('📊 EXTRACTION SUMMARY');
        console.log('═'.repeat(70));
        console.log(`✅ Fields extracted: ${fieldsWithData.length}`);
        console.log(`📈 Average confidence: ${result.metadata.averageConfidence.toFixed(1)}%`);
        console.log(`⚡ Processing time: ${(result.metadata.processingTime / 1000).toFixed(2)}s`);
        console.log(`📱 QR decoded: ${result.metadata.qrDecoded ? 'Yes' : 'No'}`);
        console.log(`🔍 OCR performed: ${result.metadata.ocrPerformed ? 'Yes' : 'No'}`);
        
        if (result.metadata.lowConfidenceFields.length > 0) {
            console.log(`⚠️  Low confidence: ${result.metadata.lowConfidenceFields.join(', ')}`);
        }
        
        console.log('\n📋 EXTRACTED FIELDS:');
        Object.entries(result.fields).forEach(([field, data]) => {
            if (data.value) {
                const icon = data.source === 'qr' ? '📱' : '📸';
                const conf = data.confidence.toFixed(0);
                const source = data.source.toUpperCase();
                console.log(`   ${icon} ${field}: ${data.value} (${conf}% - ${source})`);
            }
        });
        
        console.log('═'.repeat(70) + '\n');
        
        return result;
        
    } catch (err) {
        console.error('❌ Parsing failed:', err);
        result.metadata.error = err.message;
        result.metadata.processingTime = Date.now() - startTime;
        throw err;
    }
}

/**
 * Convert robust parser result to legacy format for backward compatibility
 */
export function convertToLegacyFormat(robustResult, imagePaths = {}) {
    const legacy = {
        name: robustResult.fields.name?.value || null,
        fatherName: robustResult.fields.fatherName?.value || null,
        dob: robustResult.fields.dob?.value || null,
        gender: robustResult.fields.gender?.value || null,
        uan: robustResult.fields.uan?.value || null,
        bloodGroup: robustResult.fields.bloodGroup?.value || null,
        occupation: robustResult.fields.occupation?.value || null,
        address: robustResult.fields.address?.value || null,
        contactNumber: robustResult.fields.contactNumber?.value || null,
        
        // Add metadata
        _confidence: {
            name: robustResult.fields.name?.confidence || 0,
            fatherName: robustResult.fields.fatherName?.confidence || 0,
            dob: robustResult.fields.dob?.confidence || 0,
            gender: robustResult.fields.gender?.confidence || 0,
            uan: robustResult.fields.uan?.confidence || 0,
            bloodGroup: robustResult.fields.bloodGroup?.confidence || 0,
            occupation: robustResult.fields.occupation?.confidence || 0,
            address: robustResult.fields.address?.confidence || 0,
            contactNumber: robustResult.fields.contactNumber?.confidence || 0,
            average: robustResult.metadata.averageConfidence
        },
        
        // Add image paths
        ...imagePaths
    };
    
    return legacy;
}

/**
 * Wrapper for backward compatibility with existing eshramEnhancedParser
 */
export async function parseEShramEnhanced(text, { frontPath, outputDir } = {}) {
    console.log('⚠️  Legacy parser called - redirecting to robust parser...');
    
    // Derive back card path
    const backPath = frontPath ? frontPath.replace('front.png', 'back.png') : null;
    const qrPath = outputDir ? path.join(path.dirname(frontPath), 'qr-detected.png') : null;
    
    try {
        const robustResult = await parseEShramRobust({
            frontPath,
            backPath: fs.existsSync(backPath) ? backPath : null,
            qrPath: fs.existsSync(qrPath) ? qrPath : null,
            outputDir,
            documentId: path.basename(outputDir)
        });
        
        // Convert to legacy format
        const legacy = convertToLegacyFormat(robustResult, {
            cardImagePath: path.join(outputDir, 'page-1.png'),
            frontCardPath: frontPath,
            backCardPath: backPath,
            'name-region': path.join(outputDir, 'name-region.png')
        });
        
        return legacy;
        
    } catch (err) {
        console.error('❌ Robust parser failed, returning empty result:', err.message);
        
        // Return empty legacy format on failure
        return {
            name: null,
            fatherName: null,
            dob: null,
            gender: null,
            uan: null,
            bloodGroup: null,
            occupation: null,
            address: null,
            contactNumber: null
        };
    }
}
