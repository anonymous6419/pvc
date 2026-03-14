import jsQR from 'jsqr';
import { Jimp } from 'jimp';
import fs from 'fs';

/**
 * Decode QR code from image and extract E-Shram data
 */
export async function decodeEShramQR(qrImagePath) {
    if (!qrImagePath || !fs.existsSync(qrImagePath)) {
        console.log('⚠️ QR image not available');
        return null;
    }
    
    console.log('\n📱 Attempting QR decode...');
    
    try {
        const image = await Jimp.read(qrImagePath);
        const { width, height } = image.bitmap;
        
        // Get image buffer in the format jsQR expects
        const imageData = {
            data: new Uint8ClampedArray(image.bitmap.data),
            width,
            height
        };
        
        const qrCode = jsQR(imageData.data, width, height);
        
        if (!qrCode) {
            console.log('   ❌ No QR code found in image');
            return null;
        }
        
        console.log('   ✅ QR code decoded successfully');
        console.log('   📄 Raw data:', qrCode.data.substring(0, 100) + '...');
        
        // Parse E-Shram QR data
        // E-Shram QR typically contains: Name, Father's Name, DOB, Gender, UAN, etc.
        const parsed = parseEShramQRData(qrCode.data);
        
        if (parsed) {
            console.log('   ✅ QR data parsed:');
            Object.entries(parsed).forEach(([key, value]) => {
                if (value) console.log(`      ${key}: ${value}`);
            });
        }
        
        return {
            rawData: qrCode.data,
            parsed,
            confidence: 100, // QR data is binary accurate
            source: 'qr'
        };
        
    } catch (err) {
        console.error('   ❌ QR decode failed:', err.message);
        return null;
    }
}

/**
 * Parse E-Shram QR code data
 * Format can vary, but typically includes delimited fields
 */
function parseEShramQRData(qrData) {
    const result = {};
    
    try {
        // Try JSON format first
        if (qrData.trim().startsWith('{')) {
            const json = JSON.parse(qrData);
            return {
                name: json.name || json.Name || null,
                fatherName: json.fatherName || json.father_name || json.FatherName || null,
                dob: json.dob || json.DOB || json.dateOfBirth || null,
                gender: json.gender || json.Gender || null,
                uan: json.uan || json.UAN || json.accountNumber || null,
                bloodGroup: json.bloodGroup || json.blood_group || null,
                contactNumber: json.mobile || json.phone || json.contact || null,
                address: json.address || json.Address || null
            };
        }
        
        // Try pipe-delimited format (common in government cards)
        if (qrData.includes('|')) {
            const parts = qrData.split('|').map(p => p.trim());
            
            // Common patterns in E-Shram QR:
            // Format 1: UAN|Name|Father|DOB|Gender
            // Format 2: Name|Father|DOB|Gender|UAN|Mobile
            
            if (parts.length >= 5) {
                // Try to identify UAN (12 digits)
                const uanIndex = parts.findIndex(p => /^\d{12}$/.test(p));
                
                if (uanIndex !== -1) {
                    result.uan = parts[uanIndex];
                    
                    // Try to map other fields based on position
                    if (uanIndex === 0) {
                        // Format 1: UAN first
                        result.name = parts[1] || null;
                        result.fatherName = parts[2] || null;
                        result.dob = parts[3] || null;
                        result.gender = parts[4] || null;
                    } else {
                        // Format 2: UAN later
                        result.name = parts[0] || null;
                        result.fatherName = parts[1] || null;
                        result.dob = parts[2] || null;
                        result.gender = parts[3] || null;
                    }
                    
                    // Look for mobile number (10 digits)
                    const mobileIndex = parts.findIndex(p => /^\d{10}$/.test(p));
                    if (mobileIndex !== -1) {
                        result.contactNumber = parts[mobileIndex];
                    }
                }
            }
        }
        
        // Try XML format
        if (qrData.includes('<') && qrData.includes('>')) {
            // Simple XML parsing (can be enhanced)
            const extractXML = (tag) => {
                const match = qrData.match(new RegExp(`<${tag}>(.*?)</${tag}>`, 'i'));
                return match ? match[1] : null;
            };
            
            result.name = extractXML('name') || extractXML('Name');
            result.fatherName = extractXML('father') || extractXML('FatherName');
            result.dob = extractXML('dob') || extractXML('DOB');
            result.gender = extractXML('gender') || extractXML('Gender');
            result.uan = extractXML('uan') || extractXML('UAN');
            result.contactNumber = extractXML('mobile') || extractXML('contact');
        }
        
        return Object.keys(result).length > 0 ? result : null;
        
    } catch (err) {
        console.warn('   ⚠️ QR parsing failed:', err.message);
        return null;
    }
}

/**
 * Validate and merge QR data with OCR data
 * QR data takes precedence as it's 100% accurate
 */
export function mergeQRWithOCR(qrData, ocrData) {
    if (!qrData || !qrData.parsed) {
        return ocrData;
    }
    
    console.log('\n🔄 Merging QR data with OCR data...');
    
    const merged = { ...ocrData };
    
    Object.entries(qrData.parsed).forEach(([field, value]) => {
        if (value && value.trim().length > 0) {
            if (merged[field] && merged[field].confidence < 100) {
                console.log(`   ✓ Replacing OCR ${field} (${merged[field].confidence.toFixed(1)}% conf) with QR data`);
            }
            merged[field] = {
                text: value,
                confidence: 100,
                source: 'qr'
            };
        }
    });
    
    return merged;
}
