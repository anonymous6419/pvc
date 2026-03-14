/**
 * E-Shram Field Extractor
 * Contains business logic for extracting structured data from OCR text
 * with confidence scoring for each field
 */

/**
 * Extract name from OCR text
 */
export function extractName(ocrText, confidence) {
    const lines = ocrText.split('\n').map(l => l.trim()).filter(l => l.length > 0);
    
    const skipKeywords = /eShram|eSHRAM|Card|MINISTRY|GOVT|INDIA|भारत|पिता|Father|Fates|UAN|Account/i;
    
    // Strategy 1: Multi-word capitalized name
    for (const line of lines) {
        if (line.match(/^[A-Z][a-z]+(\s+[A-Z][a-z]+)+$/) && !skipKeywords.test(line)) {
            return {
                value: line.trim(),
                confidence: Math.min(confidence, 95),
                method: 'multi-word'
            };
        }
    }
    
    // Strategy 2: Single word name (at least 4 chars)
    for (const line of lines) {
        if (line.match(/^[A-Z][a-z]{3,}$/) && !skipKeywords.test(line)) {
            return {
                value: line.trim(),
                confidence: Math.min(confidence * 0.85, 80),
                method: 'single-word'
            };
        }
    }
    
    return { value: null, confidence: 0, method: null };
}

/**
 * Extract father's name from OCR text
 */
export function extractFatherName(ocrText, confidence) {
    const lines = ocrText.split('\n').map(l => l.trim()).filter(l => l.length > 0);
    
    for (const line of lines) {
        if (/पिता|Father/i.test(line)) {
            // Extract multi-word name after the label
            const match = line.match(/(?:पिता|Father)[^A-Za-z]*([A-Z][a-z]+(?:\s+[a-z]+)+)/i);
            if (match) {
                const name = match[1].trim();
                // Filter out OCR garbage
                if (name.length >= 3 && !/Father|Fates|Name|नाम/i.test(name)) {
                    return {
                        value: name,
                        confidence: Math.min(confidence, 90),
                        method: 'label-match'
                    };
                }
            }
        }
    }
    
    return { value: null, confidence: 0, method: null };
}

/**
 * Extract UAN (Universal Account Number) - 12 digits
 */
export function extractUAN(ocrText, confidence) {
    // Remove all non-digits and spaces
    const cleaned = ocrText.replace(/[^\d\s]/g, '');
    
    // Pattern 1: 12 consecutive digits
    const match12 = cleaned.match(/(\d{12})/);
    if (match12) {
        return {
            value: match12[1],
            confidence: Math.min(confidence, 95),
            method: 'exact-12'
        };
    }
    
    // Pattern 2: 12 digits with spaces (e.g., "7790 4600 5819")
    const digitsOnly = cleaned.replace(/\s/g, '');
    if (digitsOnly.length >= 12) {
        return {
            value: digitsOnly.substring(0, 12),
            confidence: Math.min(confidence * 0.9, 85),
            method: 'with-spaces'
        };
    }
    
    return { value: null, confidence: 0, method: null };
}

/**
 * Extract Date of Birth
 */
export function extractDOB(ocrText, confidence) {
    const patterns = [
        /(\d{2})[\s\/\-](\d{2})[\s\/\-](\d{4})/,  // DD/MM/YYYY
        /(\d{1,2})\.(\d{1,2})\.(\d{4})/,          // D.M.YYYY
        /(\d{2})\s*(\d{2})\s*(\d{4})/             // DD MM YYYY
    ];
    
    for (const pattern of patterns) {
        const match = ocrText.match(pattern);
        if (match) {
            const day = match[1].padStart(2, '0');
            const month = match[2].padStart(2, '0');
            const year = match[3];
            
            // Validate date ranges
            const dayNum = parseInt(day);
            const monthNum = parseInt(month);
            const yearNum = parseInt(year);
            
            if (dayNum >= 1 && dayNum <= 31 && 
                monthNum >= 1 && monthNum <= 12 && 
                yearNum >= 1950 && yearNum <= 2010) {
                
                return {
                    value: `${day}/${month}/${year}`,
                    confidence: Math.min(confidence, 92),
                    method: 'pattern-match'
                };
            }
        }
    }
    
    return { value: null, confidence: 0, method: null };
}

/**
 * Extract Gender
 */
export function extractGender(ocrText, confidence) {
    const text = ocrText.toLowerCase();
    
    if (text.includes('male') && !text.includes('female')) {
        return { value: 'Male', confidence: Math.min(confidence, 95), method: 'text-match' };
    }
    if (text.includes('female')) {
        return { value: 'Female', confidence: Math.min(confidence, 95), method: 'text-match' };
    }
    if (text.includes('पुरुष')) {
        return { value: 'Male', confidence: Math.min(confidence, 95), method: 'hindi-match' };
    }
    if (text.includes('महिला')) {
        return { value: 'Female', confidence: Math.min(confidence, 95), method: 'hindi-match' };
    }
    
    // Check for M/F letters
    const match = text.match(/\b(m|f)\b/i);
    if (match) {
        const value = match[1].toLowerCase() === 'm' ? 'Male' : 'Female';
        return { value, confidence: Math.min(confidence * 0.8, 75), method: 'letter-match' };
    }
    
    return { value: null, confidence: 0, method: null };
}

/**
 * Extract Blood Group
 */
export function extractBloodGroup(ocrText, confidence) {
    // Look for blood group patterns: A+, B-, O+, AB+, etc.
    const match = ocrText.match(/\b([ABO]+)\s*([+-])\b/i);
    if (match) {
        const group = match[1].toUpperCase();
        const rh = match[2];
        
        // Validate it's a real blood group
        if (/^(A|B|AB|O)$/.test(group)) {
            return {
                value: `${group}${rh}`,
                confidence: Math.min(confidence, 90),
                method: 'pattern-match'
            };
        }
    }
    
    // Try without RH factor
    const simpleMatch = ocrText.match(/\b([ABO]+)\b/i);
    if (simpleMatch) {
        const group = simpleMatch[1].toUpperCase();
        if (/^(A|B|AB|O)$/.test(group)) {
            return {
                value: group,
                confidence: Math.min(confidence * 0.85, 80),
                method: 'simple-match'
            };
        }
    }
    
    return { value: null, confidence: 0, method: null };
}

/**
 * Extract Occupation
 */
export function extractOccupation(ocrText, confidence) {
    const lines = ocrText.split('\n').map(l => l.trim()).filter(l => l.length > 0);
    
    // Common occupation keywords
    const occupationKeywords = [
        'Laborer', 'Labourer', 'Worker', 'Driver', 'Carpenter', 'Electrician',
        'Plumber', 'Mason', 'Painter', 'Welder', 'Mechanic', 'Tailor',
        'Farmer', 'Agriculture', 'Construction', 'Helper', 'Cleaner', 'Guard',
        'Vendor', 'Seller', 'Cook', 'Waiter', 'Shop', 'Factory', 'Agri'
    ];
    
    // Strategy 1: Direct keyword match
    for (const line of lines) {
        // Skip lines that look like father's name
        if (/Father|Fates|पिता|Name|नाम|Hame|का|दी/i.test(line)) {
            continue;
        }
        
        for (const keyword of occupationKeywords) {
            if (new RegExp(keyword, 'i').test(line)) {
                // Extract the occupation phrase
                const regex = new RegExp(`(${keyword}[a-z\\s]*(?:worker|labour|work|er)?)`, 'gi');
                const match = line.match(regex);
                if (match) {
                    return {
                        value: match[0].trim(),
                        confidence: Math.min(confidence, 88),
                        method: 'keyword-match'
                    };
                }
            }
        }
    }
    
    // Strategy 2: Look for capitalized occupation words
    for (const line of lines) {
        if (/Father|Fates|पिता|Name|नाम/i.test(line)) continue;
        
        if (line.match(/^[A-Z][a-z]+(?:\s+[A-Z]?[a-z]+)*$/) && line.length >= 4 && line.length <= 50) {
            return {
                value: line.trim(),
                confidence: Math.min(confidence * 0.75, 70),
                method: 'capitalized-word'
            };
        }
    }
    
    return { value: null, confidence: 0, method: null };
}

/**
 * Extract Contact Number (10 digits for India)
 */
export function extractContactNumber(ocrText, confidence) {
    // Remove all non-digits
    const digitsOnly = ocrText.replace(/\D/g, '');
    
    // Pattern 1: Look for 10-digit sequences
    const match10 = digitsOnly.match(/(\d{10})/);
    if (match10) {
        const number = match10[1];
        // Indian mobile numbers start with 6, 7, 8, or 9
        if (/^[6-9]/.test(number)) {
            return {
                value: number,
                confidence: Math.min(confidence, 90),
                method: 'standard-mobile'
            };
        }
        // Accept any 10-digit number with lower confidence
        return {
            value: number,
            confidence: Math.min(confidence * 0.8, 75),
            method: 'alternative-10-digit'
        };
    }
    
    return { value: null, confidence: 0, method: null };
}

/**
 * Extract Address
 */
export function extractAddress(ocrText, confidence) {
    const lines = ocrText.split('\n').map(l => l.trim()).filter(l => l.length > 5);
    
    // Look for address after "Address" or "Current Address" label
    const fullText = lines.join(' ');
    const match = fullText.match(/(?:Current\s*Address|Address)[:\s]*(.+?)(?=Contact|Mobile|Phone|Emergency|$)/i);
    
    if (match) {
        let address = match[1]
            .replace(/REIS|Silo|Bed/g, '')  // Remove OCR artifacts
            .replace(/\s+/g, ' ')
            .trim();
        
        if (address.length > 10) {
            return {
                value: address,
                confidence: Math.min(confidence * 0.85, 82),
                method: 'label-match'
            };
        }
    }
    
    // Strategy 2: Extract multi-line text as address
    if (lines.length >= 2) {
        // Skip lines that contain other field labels
        const addressLines = lines.filter(l => 
            !/Blood|Occupation|Contact|Mobile|Phone|Emergency|Father|Name/i.test(l)
        );
        
        if (addressLines.length >= 2) {
            const address = addressLines.slice(0, 3).join(', ');
            if (address.length > 15) {
                return {
                    value: address,
                    confidence: Math.min(confidence * 0.7, 68),
                    method: 'multi-line'
                };
            }
        }
    }
    
    return { value: null, confidence: 0, method: null };
}

/**
 * Process all OCR results and extract structured fields
 */
export function processEShramFields(ocrResults) {
    const extracted = {};
    
    // Process front card fields
    if (ocrResults.frontCard) {
        if (ocrResults.frontCard.name) {
            extracted.name = extractName(
                ocrResults.frontCard.name.text,
                ocrResults.frontCard.name.confidence
            );
        }
        
        if (ocrResults.frontCard.fatherName) {
            extracted.fatherName = extractFatherName(
                ocrResults.frontCard.fatherName.text,
                ocrResults.frontCard.fatherName.confidence
            );
        }
        
        if (ocrResults.frontCard.uan) {
            extracted.uan = extractUAN(
                ocrResults.frontCard.uan.text,
                ocrResults.frontCard.uan.confidence
            );
        }
        
        if (ocrResults.frontCard.dob) {
            extracted.dob = extractDOB(
                ocrResults.frontCard.dob.text,
                ocrResults.frontCard.dob.confidence
            );
        }
        
        if (ocrResults.frontCard.gender) {
            extracted.gender = extractGender(
                ocrResults.frontCard.gender.text,
                ocrResults.frontCard.gender.confidence
            );
        }
    }
    
    // Process back card fields
    if (ocrResults.backCard) {
        if (ocrResults.backCard.bloodGroup) {
            extracted.bloodGroup = extractBloodGroup(
                ocrResults.backCard.bloodGroup.text,
                ocrResults.backCard.bloodGroup.confidence
            );
        }
        
        if (ocrResults.backCard.occupation) {
            extracted.occupation = extractOccupation(
                ocrResults.backCard.occupation.text,
                ocrResults.backCard.occupation.confidence
            );
        }
        
        if (ocrResults.backCard.contactNumber) {
            extracted.contactNumber = extractContactNumber(
                ocrResults.backCard.contactNumber.text,
                ocrResults.backCard.contactNumber.confidence
            );
        }
        
        if (ocrResults.backCard.address) {
            extracted.address = extractAddress(
                ocrResults.backCard.address.text,
                ocrResults.backCard.address.confidence
            );
        }
    }
    
    return extracted;
}
