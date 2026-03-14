/**
 * =================================
 * DRIVING LICENCE TEXT PARSER
 * =================================
 */
export function parseDrivingLicenceText(text) {
    console.log('[DL-PARSER] Parsing started');

    if (!text || typeof text !== 'string') {
        console.log('[DL-PARSER] Empty or invalid text');
        return { fields: getEmptyDLStructure(), confidence: 0, missingFields: [] };
    }

    // OCR Text Cleanup - Fix common OCR errors
    text = cleanupOCRText(text);

    const lines = text
        .replace(/\r/g, '')
        .split('\n')
        .map(normalizeLine)
        .filter(Boolean);

    const joinedText = lines.join('\n');
    console.log('[DL-PARSER] Total lines:', lines.length);

    // Extract basic info
    const licenseNumber = extractLicenseNumber(joinedText);
    const name = extractName(lines, joinedText);
    const dob = extractDOB(lines, joinedText);
    const fatherName = extractFatherName(lines, joinedText);
    const bloodGroup = extractBloodGroup(lines, joinedText);
    const organDonor = extractOrganDonor(lines, joinedText);
    const gender = extractGender(lines, joinedText);
    const rtoCode = extractRTOCode(licenseNumber);
    const state = extractState(licenseNumber, lines);
    const issuedBy = extractIssuedBy(lines, joinedText);
    
    // Extract dates
    const issueDate = extractIssueDate(lines, joinedText);
    const firstIssueDate = extractFirstIssueDate(lines, joinedText);
    const validityNT = extractValidityNT(lines, joinedText);
    const validityTR = extractValidityTR(lines, joinedText);
    
    // Extract address
    const address = extractAddressStructured(lines, joinedText);
    
    // Extract vehicle classes with detailed info
    const vehicleClasses = extractVehicleClassesDetailed(lines, joinedText);
    
    // Extract licensing office and emergency contact
    const licensingOffice = extractLicensingOffice(lines, joinedText);
    const emergencyContact = extractEmergencyContact(lines, joinedText);

    const fields = {
        documentType: "DRIVING_LICENSE",
        licenseNumber: licenseNumber,
        state: state,
        country: "IN",
        issuedBy: issuedBy || deriveIssuedBy(state),
        rtoCode: rtoCode,
        issueDate: formatDate(issueDate),
        firstIssueDate: formatDate(firstIssueDate),
        validityNT: formatDate(validityNT),
        validityTR: formatDate(validityTR),
        name: cleanName(name),
        dob: formatDate(dob),
        gender: gender,
        bloodGroup: bloodGroup,
        organDonor: organDonor,
        fatherName: cleanName(fatherName),
        address: address,
        vehicleClasses: vehicleClasses,
        licensingOffice: licensingOffice,
        emergencyContact: emergencyContact
    };

    // Calculate confidence and missing fields
    const { confidence, missingFields } = calculateConfidence(fields);

    console.log('[DL-PARSER] Parsing completed');
    console.log(`[DL-PARSER] Confidence: ${confidence}%`);
    if (missingFields.length > 0) {
        console.log(`[DL-PARSER] Missing fields: ${missingFields.join(', ')}`);
    }
    
    return { fields, confidence, missingFields };
}

/**
 * =================================
 * HELPER FUNCTIONS
 * =================================
 */

function cleanupOCRText(text) {
    if (!text) return '';
    
    // Fix common OCR errors but preserve line structure
    return text
        // Remove carriage returns but keep newlines
        .replace(/\r/g, '')
        // Normalize multiple spaces on same line (but keep single spaces)
        .replace(/[ \t]+/g, ' ')
        // Fix common character substitutions in license numbers
        .replace(/([A-Z]{2})([Oo0])(\d[A-Z])/g, (match, p1, p2, p3) => {
            // Convert O/o to 0 in license context
            return p1 + '0' + p3;
        })
        // Remove excessive newlines (more than 2)
        .replace(/\n{3,}/g, '\n\n')
        // Normalize date separators to standard format
        .replace(/(\d{2})[\.\/](\d{2})[\.\/](\d{4})/g, '$1-$2-$3')
        // Trim each line
        .split('\n')
        .map(line => line.trim())
        .join('\n')
        .trim();
}

function getEmptyDLStructure() {
    return {
        documentType: "DRIVING_LICENSE",
        licenseNumber: null,
        state: null,
        country: "IN",
        issuedBy: null,
        rtoCode: null,
        issueDate: null,
        firstIssueDate: null,
        validityNT: null,
        validityTR: null,
        name: null,
        dob: null,
        gender: null,
        bloodGroup: null,
        organDonor: null,
        fatherName: null,
        address: {},
        vehicleClasses: [],
        licensingOffice: null,
        emergencyContact: null
    };
}

function deriveIssuedBy(state) {
    if (!state) return null;
    return `GOVERNMENT OF ${state}`;
}

function calculateConfidence(fields) {
    const criticalFields = [
        'licenseNumber', 'name', 'dob', 'issueDate', 'state', 'rtoCode'
    ];
    
    const importantFields = [
        'fatherName', 'bloodGroup', 'validityNT', 'validityTR', 
        'address', 'vehicleClasses', 'licensingOffice'
    ];
    
    const missingFields = [];
    let criticalCount = 0;
    let importantCount = 0;
    
    // Check critical fields (70% weight)
    for (const field of criticalFields) {
        if (fields[field]) {
            criticalCount++;
        } else {
            missingFields.push(field);
        }
    }
    
    // Check important fields (30% weight)
    for (const field of importantFields) {
        const value = fields[field];
        if (value && (Array.isArray(value) ? value.length > 0 : typeof value === 'object' ? Object.keys(value).some(k => value[k]) : true)) {
            importantCount++;
        } else {
            missingFields.push(field);
        }
    }
    
    const criticalScore = (criticalCount / criticalFields.length) * 70;
    const importantScore = (importantCount / importantFields.length) * 30;
    const confidence = Math.round(criticalScore + importantScore);
    
    return { confidence, missingFields };
}

function normalizeLine(line) {
    return line ? line.replace(/\s+/g, ' ').trim() : '';
}

function cleanValue(value) {
    if (!value) return null;
    const cleaned = value.replace(/\s+/g, ' ').trim();
    return cleaned || null;
}

function cleanName(name) {
    if (!name) return null;
    return name.replace(/^[:\-\s]+/, '').replace(/\s+/g, ' ').trim() || null;
}

function extractLicenseNumber(text) {
    // More flexible regex for DL variants
    // Format: XX##X#######  (State code + District code + Initial + Unique number)
    // Examples: RJ13A20180067228, DL01A20190012345, MH0220200098765
    
    // Try standard format first
    let match = text.match(/\b([A-Z]{2}[0-9]{2}[A-Z0-9]{1}[0-9]{11})\b/);
    if (match) return match[1];
    
    // Try with spaces/separators
    match = text.match(/\b([A-Z]{2}[\s\-]?[0-9]{2}[\s\-]?[A-Z0-9]{1}[\s\-]?[0-9]{11})\b/);
    if (match) return match[1].replace(/[\s\-]/g, '');
    
    // Try shorter variants (some states use shorter format)
    match = text.match(/\b([A-Z]{2}[0-9]{2}[A-Z]{1}[0-9]{7,11})\b/);
    if (match) return match[1];
    
    // Fallback: look for "DL No" or "License" label
    match = text.match(/(?:DL\s+No|License\s+No|Licence\s+No)[:\-\s]*([A-Z0-9\s\-]{12,20})/i);
    if (match) return match[1].replace(/[\s\-]/g, '');
    
    return null;
}

function extractRTOCode(licenseNumber) {
    if (!licenseNumber) return null;
    
    // RTO code is typically first 4-5 chars
    // Format: XX## or XX##X (State + District + optional office code)
    // Examples: RJ13, RJ13A, DL01, MH02
    
    // Try 5-char format first (most common)
    if (licenseNumber.length >= 5) {
        const code = licenseNumber.substring(0, 5);
        // Validate format: XX##X
        if (/^[A-Z]{2}[0-9]{2}[A-Z0-9]$/.test(code)) {
            return code;
        }
    }
    
    // Try 4-char format
    if (licenseNumber.length >= 4) {
        const code = licenseNumber.substring(0, 4);
        // Validate format: XX##
        if (/^[A-Z]{2}[0-9]{2}$/.test(code)) {
            return code;
        }
    }
    
    return null;
}

function extractState(licenseNumber, lines) {
    let state = null;
    
    // Try to extract from license number first
    if (licenseNumber) {
        const stateCode = licenseNumber.substring(0, 2);
        state = getStateFromCode(stateCode);
    }
    
    // If not found, try to extract from "GOVERNMENT OF STATE" text
    if (!state) {
        for (const line of lines) {
            const match = line.match(/GOVERNMENT\s+OF\s+([A-Z]+)/i);
            if (match) {
                state = match[1].toUpperCase();
                break;
            }
        }
    }
    
    // Fallback: try to extract from address
    if (!state) {
        for (const line of lines) {
            if (/Address/i.test(line)) {
                const stateMatch = line.match(/,\s*([A-Z]{2})\s*,/);
                if (stateMatch) {
                    state = getStateFromCode(stateMatch[1]);
                    break;
                }
            }
        }
    }
    
    return state;
}

function getStateFromCode(stateCode) {
    if (!stateCode) return null;
    
    // Map state codes to state names
    const stateMap = {
        'RJ': 'RAJASTHAN', 'MH': 'MAHARASHTRA', 'UP': 'UTTAR PRADESH',
        'DL': 'DELHI', 'KA': 'KARNATAKA', 'TN': 'TAMIL NADU',
        'GJ': 'GUJARAT', 'WB': 'WEST BENGAL', 'MP': 'MADHYA PRADESH',
        'PB': 'PUNJAB', 'HR': 'HARYANA', 'KL': 'KERALA',
        'TG': 'TELANGANA', 'JK': 'JAMMU & KASHMIR', 'HP': 'HIMACHAL PRADESH',
        'UK': 'UTTARAKHAND', 'AP': 'ANDHRA PRADESH', 'BR': 'BIHAR',
        'OD': 'ODISHA', 'OR': 'ODISHA', 'CT': 'CHHATTISGARH', 'CG': 'CHHATTISGARH',
        'AS': 'ASSAM', 'GA': 'GOA', 'JH': 'JHARKHAND', 'MN': 'MANIPUR',
        'ML': 'MEGHALAYA', 'MZ': 'MIZORAM', 'NL': 'NAGALAND',
        'SK': 'SIKKIM', 'TR': 'TRIPURA', 'AR': 'ARUNACHAL PRADESH'
    };
    
    return stateMap[stateCode.toUpperCase()] || null;
}

function extractName(lines, joinedText) {
    // Look for "Name" label followed by name
    for (let i = 0; i < lines.length; i++) {
        if (/^Name\s*[:\-]/i.test(lines[i])) {
            const match = lines[i].match(/^Name\s*[:\-]\s*(.+)/i);
            if (match) return match[1];
        }
        if (/Name\s+Date\s+Of\s+Birth/i.test(lines[i])) {
            // Look backwards for name
            for (let j = i - 1; j >= 0; j--) {
                if (!/\d{2}[\/-]\d{2}[\/-]\d{4}/.test(lines[j]) && lines[j].length > 2) {
                    return lines[j];
                }
            }
        }
    }
    return null;
}

function extractDOB(lines, joinedText) {
    // Look for date after "Date of Birth" label
    for (let i = 0; i < lines.length; i++) {
        if (/Date\s+Of\s+Birth|DOB/i.test(lines[i])) {
            const match = lines[i].match(/\d{2}[\/-]\d{2}[\/-]\d{4}/);
            if (match) {
                // Validate it's a birth date (year between 1930-2010)
                const year = parseInt(match[0].split(/[\/-]/)[2]);
                if (year >= 1930 && year <= 2010) {
                    return match[0];
                }
            }
            // Check next few lines
            for (let j = i + 1; j < Math.min(i + 3, lines.length); j++) {
                const nextMatch = lines[j].match(/\d{2}[\/-]\d{2}[\/-]\d{4}/);
                if (nextMatch) {
                    const year = parseInt(nextMatch[0].split(/[\/-]/)[2]);
                    if (year >= 1930 && year <= 2010) {
                        return nextMatch[0];
                    }
                }
            }
        }
    }
    // Fallback: search in joined text with flexible pattern
    let match = joinedText.match(/Date\s+Of\s+Birth[:\-\s]*(\d{2}[\/-]\d{2}[\/-]\d{4})/i);
    if (match) {
        const year = parseInt(match[1].split(/[\/-]/)[2]);
        if (year >= 1930 && year <= 2010) {
            return match[1];
        }
    }
    
    // Alternative: extract date near end of identity pattern (: DD-MM-YYYY)
    match = joinedText.match(/:\s*(\d{2}[\/-]\d{2}[\/-]\d{4})\n:\s+[A-Z]/m);
    if (match) {
        const year = parseInt(match[1].split(/[\/-]/)[2]);
        if (year >= 1930 && year <= 2010) {
            return match[1];
        }
    }
    return null;
}

function extractFatherName(lines, joinedText) {
    // Look for colon-prefixed name that appears before the identity section
    // Pattern: ": NAME" followed eventually by "Name Date Of Birth"
    let match = joinedText.match(/:\s*([A-Z][A-Z\s]+)\n[^]*?Indian\s+Union\s+Driving\s+Licence/i);
    if (match) {
        const name = cleanValue(match[1]);
        if (name && name.length > 3 && !/Address|WN|Validity|issued|Form/.test(name)) {
            return name;
        }
    }
    
    // Alternative: look for ": FATHER_NAME" before ": DOB" before ": PERSON_NAME"
    match = joinedText.match(/:\s*([A-Z][A-Z\s]+)\n[^]*?:\s*\d{2}[\/-]\d{2}[\/-]\d{4}\n[^]*?:\s*([A-Z][A-Z\s]+)\nName\s+Date/i);
    if (match && match[1]) {
        const name = cleanValue(match[1]);
        if (name && name.length > 3 && !/Address|WN|Validity|issued|Form|RJ\d+/.test(name)) {
            return name;
        }
    }
    
    // Look in lines array for pattern
    for (let i = 0; i < lines.length; i++) {
        if (/^:\s+[A-Z]/.test(lines[i])) {
            const candidate = cleanValue(lines[i].replace(/^:\s*/, ''));
            // Check if next lines contain DOB and then name section
            let hasIdentityBelow = false;
            for (let j = i + 1; j < Math.min(i + 10, lines.length); j++) {
                if (/Name\s+Date\s+Of\s+Birth/i.test(lines[j])) {
                    hasIdentityBelow = true;
                    break;
                }
            }
            if (hasIdentityBelow && candidate.length > 3 && !/Address|WN|RJ\d+|Validity|issued|Form|blood|Organ/.test(candidate)) {
                return candidate;
            }
        }
    }
    
    return null;
}

function extractIssueDate(lines, joinedText) {
    // Look for "Issue Date" or "Date of Issue" labels
    for (let i = 0; i < lines.length; i++) {
        if (/(?:Date\s+Of\s+Issue|Issue\s+Date|DOI)(?!\s*First)/i.test(lines[i])) {
            // Try current line first
            const match = lines[i].match(/\d{2}[\/-]\d{2}[\/-]\d{4}/);
            if (match) return match[0];
            
            // Try next 2 lines
            for (let j = i + 1; j < Math.min(i + 3, lines.length); j++) {
                const nextMatch = lines[j].match(/\d{2}[\/-]\d{2}[\/-]\d{4}/);
                if (nextMatch) return nextMatch[0];
            }
        }
    }
    
    // Fallback: search in joined text
    const match = joinedText.match(/(?:Issue\s+Date|Date\s+Of\s+Issue)[:\-\s]+(\d{2}[\/-]\d{2}[\/-]\d{4})/i);
    return match ? match[1] : null;
}

function extractFirstIssueDate(lines, joinedText) {
    // Look for "Date of First Issue" label
    for (let i = 0; i < lines.length; i++) {
        if (/Date\s+Of\s+First\s+Issue/i.test(lines[i])) {
            // Try current line first
            const match = lines[i].match(/\d{2}[\/-]\d{2}[\/-]\d{4}/);
            if (match) return match[0];
            
            // Try previous line (date might be above the label)
            if (i > 0) {
                const prevMatch = lines[i - 1].match(/\d{2}[\/-]\d{2}[\/-]\d{4}/);
                if (prevMatch) return prevMatch[0];
            }
            
            // Try next line
            if (i + 1 < lines.length) {
                const nextMatch = lines[i + 1].match(/\d{2}[\/-]\d{2}[\/-]\d{4}/);
                if (nextMatch) return nextMatch[0];
            }
        }
    }
    
    // Fallback: search in joined text
    const match = joinedText.match(/(\d{2}[\/-]\d{2}[\/-]\d{4})[\s\n]+Date\s+Of\s+First\s+Issue/i);
    return match ? match[1] : null;
}

function extractValidityNT(lines, joinedText) {
    // Search for Validity (NT) pattern with date before or after
    for (let i = 0; i < lines.length; i++) {
        if (/Validity\s*\(\s*NT\s*\)/i.test(lines[i])) {
            // Check previous line first (date often appears before the label)
            if (i > 0) {
                const prevMatch = lines[i - 1].match(/\d{2}[\/-]\d{2}[\/-]\d{4}/);
                if (prevMatch) {
                    // Validate this is a validity date (year in future, typically 2030-2070)
                    const year = parseInt(prevMatch[0].split(/[\/-]/)[2]);
                    if (year >= 2025 && year <= 2070) {
                        return prevMatch[0];
                    }
                }
            }
            
            // Check current line for date
            let match = lines[i].match(/\d{2}[\/-]\d{2}[\/-]\d{4}/);
            if (match) {
                const year = parseInt(match[0].split(/[\/-]/)[2]);
                if (year >= 2025 && year <= 2070) {
                    return match[0];
                }
            }
            
            // Check next line
            if (i + 1 < lines.length) {
                match = lines[i + 1].match(/\d{2}[\/-]\d{2}[\/-]\d{4}/);
                if (match) {
                    const year = parseInt(match[0].split(/[\/-]/)[2]);
                    if (year >= 2025 && year <= 2070) {
                        return match[0];
                    }
                }
            }
        }
    }
    
    // Search in joined text - look for pattern with dates around Validity (NT)
    let match = joinedText.match(/(\d{2}[\/\-]\d{2}[\/\-]\d{4})\s*.*?Validity\s*\(\s*NT\s*\)/i);
    if (match) {
        const year = parseInt(match[1].split(/[\/-]/)[2]);
        if (year >= 2025 && year <= 2070) {
            return match[1];
        }
    }
    
    // Alternative: date after Validity (NT)
    match = joinedText.match(/Validity\s*\(\s*NT\s*\)\s*(\d{2}[\/\-]\d{2}[\/\-]\d{4})/i);
    if (match) {
        const year = parseInt(match[1].split(/[\/-]/)[2]);
        if (year >= 2025 && year <= 2070) {
            return match[1];
        }
    }
    
    return null;
}

function extractValidityTR(lines, joinedText) {
    // Search for Validity (TR) pattern  
    for (let i = 0; i < lines.length; i++) {
        if (/Validity\s*\(\s*TR\s*\)/i.test(lines[i])) {
            // Check current line for date
            let match = lines[i].match(/\d{2}[\/-]\d{2}[\/-]\d{4}/);
            if (match) {
                const year = parseInt(match[0].split(/[\/-]/)[2]);
                if (year >= 2020 && year <= 2050) {
                    return match[0];
                }
            }
            
            // Check previous line
            if (i > 0) {
                const prevMatch = lines[i - 1].match(/\d{2}[\/-]\d{2}[\/-]\d{4}/);
                if (prevMatch) {
                    const year = parseInt(prevMatch[0].split(/[\/-]/)[2]);
                    if (year >= 2020 && year <= 2050) {
                        return prevMatch[0];
                    }
                }
            }
            
            // Check next line
            if (i + 1 < lines.length) {
                match = lines[i + 1].match(/\d{2}[\/-]\d{2}[\/-]\d{4}/);
                if (match) {
                    const year = parseInt(match[0].split(/[\/-]/)[2]);
                    if (year >= 2020 && year <= 2050) {
                        return match[0];
                    }
                }
            }
        }
    }
    
    // Fallback: search in joined text
    const match = joinedText.match(/Validity\s*\(\s*TR\s*\)\s*(\d{2}[\/-]\d{2}[\/-]\d{4})/i);
    if (match) {
        const year = parseInt(match[1].split(/[\/-]/)[2]);
        if (year >= 2020 && year <= 2050) {
            return match[1];
        }
    }
    
    return null;
}

function extractBloodGroup(lines, joinedText) {
    for (const line of lines) {
        if (/Blood\s+Group|Gr[ou]?p/i.test(line)) {
            const match = line.match(/(A|B|AB|O)[+-]/);
            if (match) return match[0];
        }
    }
    
    // Fallback: search entire text
    const match = joinedText.match(/[:\s](A|B|AB|O)[+-]/);
    if (match) {
        // Clean up the blood group - remove any leading colons or spaces
        return match[1] + match[0].slice(-1);  // e.g., "A+"
    }
    
    return null;
}

function extractOrganDonor(lines, joinedText) {
    for (const line of lines) {
        if (/Organ\s+Donor/i.test(line)) {
            if (/Yes/i.test(line)) return true;
            if (/No/i.test(line)) return false;
            const match = line.match(/Organ\s+Donor\s*[:\-]?\s*(Yes|No)/i);
            if (match) return match[1].toLowerCase() === 'yes';
        }
    }
    return null;
}

function extractGender(lines, joinedText) {
    // Look for explicit gender/sex labels
    for (const line of lines) {
        // Match "Gender: M/F" or "Sex: M/F" patterns
        let match = line.match(/(?:Gender|Sex)\s*[:\-]?\s*([MF])/i);
        if (match) {
            return match[1].toUpperCase();
        }
    }
    
    // Search in joined text
    let match = joinedText.match(/(?:Gender|Sex)\s*[:\-]?\s*([MF])/i);
    if (match) return match[1].toUpperCase();
    
    // Look for "Male" or "Female" text
    if (/\bMale\b/i.test(joinedText)) return 'M';
    if (/\bFemale\b/i.test(joinedText)) return 'F';
    
    // Note: Gender information is not available in this document's OCR text
    // It may be:
    // 1. Stored as image data (in the photo/signature region)
    // 2. Not printed on this particular DL variant
    // 3. Encoded in a format OCR cannot capture
    // To extract gender from images, use image processing on the face detection region
    
    return null;
}

function extractIssuedBy(lines, joinedText) {
    for (const line of lines) {
        if (/GOVERNMENT\s+OF|Issued\s+By/i.test(line)) {
            const match = line.match(/GOVERNMENT\s+OF\s+(\w+)/i);
            if (match) return `GOVERNMENT OF ${match[1].toUpperCase()}`;
            return cleanValue(line);
        }
    }
    return null;
}

function extractAddressStructured(lines, joinedText) {
    const address = {
        wardNo: null,
        locality: null,
        city: null,
        district: null,
        state: null,
        pincode: null
    };

    // Find address section - handle multiline address blocks
    let addressText = '';
    let foundAddress = false;
    
    for (let i = 0; i < lines.length; i++) {
        if (/Address/i.test(lines[i])) {
            foundAddress = true;
            
            // Extract address after "Address:" if on same line
            let match = lines[i].match(/Address[:\-]\s*(.+)/i);
            if (match && match[1].length > 3) {
                addressText = match[1];
            } else {
                // Collect multiline address (next 2-3 lines)
                const addressLines = [];
                for (let j = i + 1; j < Math.min(i + 4, lines.length); j++) {
                    const line = lines[j];
                    // Stop at form/rule or other section markers
                    if (/Form\s+\d+|Rule\s+\d+|Badge|Licencing|Vehicle|Code/i.test(line)) break;
                    if (line.length > 2) {
                        addressLines.push(line);
                    }
                }
                addressText = addressLines.join(', ');
            }
            break;
        }
    }
    
    // Fallback: search in joined text for address pattern
    if (!addressText) {
        const match = joinedText.match(/Address[:\-\s]+([^]*?)(?:Form|Rule|Badge|$)/i);
        if (match) {
            addressText = match[1].replace(/\n/g, ' ').trim();
        }
    }

    if (addressText) {
        const parsed = parseIndianAddress(addressText);
        return { ...address, ...parsed };
    }

    return address;
}

function parseIndianAddress(addressStr) {
    if (!addressStr) return {};

    const address = {
        wardNo: null,
        locality: null,
        city: null,
        district: null,
        state: null,
        pincode: null
    };

    // Clean up the address string
    addressStr = addressStr.replace(/Form\s+\d+|Rule\s+\d.*/gi, '').trim();

    // Extract pincode (6 digits)
    let pincodeMatch = addressStr.match(/(\d{6})/);
    if (pincodeMatch) address.pincode = pincodeMatch[1];

    // Extract state (2-char code, usually before pincode)
    let stateMatch = addressStr.match(/,\s*([A-Z]{2})\s*,/);
    if (stateMatch) {
        address.state = stateMatch[1];
    }

    // Extract ward number if present (WN XX)
    let wardMatch = addressStr.match(/\bWN\s+(\d+)/i);
    if (wardMatch) address.wardNo = `WN ${wardMatch[1]}`;

    // Remove WN and everything after state,pincode for cleaner parsing
    let cleanedAddr = addressStr
        .replace(/\bWN\s+\d+\s*/i, '')  // Remove ward
        .replace(/,\s*[A-Z]{2}\s*,\s*\d{6}.*/, '')  // Remove state and pincode
        .trim();

    // Parse address: "11 SD JANKIDASWALA, SURATGARH, GANGANAGAR"
    // We want locality to be JANKIDASWALA (the main place name)
    
    // First, try to extract any standalone place names
    // Places typically come after prefixes like "SD", "RD", etc.
    let localityMatch = cleanedAddr.match(/\b(?:SD|RD|BO|PO)\s+([A-Z]+)/i);
    if (localityMatch) {
        address.locality = localityMatch[1];
        // Remove this from cleaned addr for remaining parsing
        cleanedAddr = cleanedAddr.replace(/\b(?:SD|RD|BO|PO)\s+[A-Z]+/i, '').trim();
    }

    // Split remaining by commas to get city and district
    const parts = cleanedAddr.split(/,/).map(p => p.replace(/\d+\s*/g, '').trim()).filter(p => p.length > 1);
    
    if (parts.length >= 2) {
        address.city = parts[0];
        address.district = parts[1];
    } else if (parts.length === 1) {
        address.city = parts[0];
    }

    return address;
}

function extractVehicleClassesDetailed(lines, joinedText) {
    const vehicleClasses = [];
    const vehicleTypes = new Set();
    const vehicleInfo = {};

    // Scan for vehicle class codes
    const classPatterns = /\b(LMV|HMV|MCWG|MCWOG|MCW|TRAC|TRANS|HPMV|GVWR)\b/gi;
    let match;

    while ((match = classPatterns.exec(joinedText)) !== null) {
        vehicleTypes.add(match[1].toUpperCase());
    }

    // For each vehicle type, extract detailed info
    for (const type of vehicleTypes) {
        const info = extractVehicleClassInfo(lines, joinedText, type);
        vehicleInfo[type] = info;
    }

    // Build vehicle classes array
    for (const type of vehicleTypes) {
        const info = vehicleInfo[type];
        const vehicleClass = {
            type: type,
            category: info.category || null,
            issueDate: formatDate(info.issueDate) || null
        };

        if (info.badgeNumber) {
            vehicleClass.badgeNumber = info.badgeNumber;
        }

        vehicleClasses.push(vehicleClass);
    }

    return vehicleClasses;
}

function extractVehicleClassInfo(lines, joinedText, vehicleType) {
    const info = {
        category: null,
        issueDate: null,
        badgeNumber: null
    };

    // Find the "Code MCWG LMV TRANS" line which shows vehicle order
    let codeLineIndex = -1;
    let vehicleOrder = [];
    
    for (let i = 0; i < lines.length; i++) {
        if (/Code\s+/i.test(lines[i]) && /MCWG|LMV|TRANS|HMV/i.test(lines[i])) {
            codeLineIndex = i;
            // Extract all vehicle types from this line in order
            const matches = lines[i].match(/\b(LMV|HMV|MCWG|MCWOG|MCW|TRAC|TRANS|HPMV|GVWR)\b/gi);
            if (matches) {
                vehicleOrder = matches.map(m => m.toUpperCase());
            }
            break;
        }
    }

    if (codeLineIndex !== -1 && vehicleOrder.length > 0) {
        // Find the vehicle's position in the order
        const vehicleIndex = vehicleOrder.indexOf(vehicleType.toUpperCase());
        
        if (vehicleIndex !== -1) {
            // Look for category line (usually contains "Hill Validity NT NT TR" or similar)
            for (let i = codeLineIndex - 1; i >= Math.max(0, codeLineIndex - 10); i--) {
                const line = lines[i];
                
                // Look for line with categories
                if (/\bNT\b.*\bTR\b|\bTR\b.*\bNT\b|Hill\s+Validity|Vehicle\s+Category/i.test(line)) {
                    // Extract NT/TR values from this line
                    const categories = line.match(/\b(NT|TR)\b/gi);
                    
                    if (categories && categories.length > vehicleIndex) {
                        info.category = categories[vehicleIndex].toUpperCase();
                        break;
                    }
                }
            }
            
            // Look for date line (usually contains issue dates for each vehicle)
            for (let i = codeLineIndex - 1; i >= Math.max(0, codeLineIndex - 10); i--) {
                const line = lines[i];
                
                // Look for dates
                const dates = [];
                let match;
                const dateRegex = /\d{2}[\/-]\d{2}[\/-]\d{4}/g;
                while ((match = dateRegex.exec(line)) !== null) {
                    dates.push(match[0]);
                }
                
                // If we found dates, assume they correspond to vehicles in order
                if (dates.length > vehicleIndex && !info.issueDate) {
                    info.issueDate = dates[vehicleIndex];
                }
            }
        }
    }

    // Extract badge info for TRANS vehicle
    if (/TRANS/i.test(vehicleType)) {
        const badgeMatch = joinedText.match(/Badge\s+(?:Number|No\.?)\s*[:\-]?\s*(\S+)/i);
        if (badgeMatch) info.badgeNumber = badgeMatch[1];

        const badgeDateMatch = joinedText.match(/Badge\s+issued\s+date\s+(\d{2}[/-]\d{2}[/-]\d{4})/i);
        if (badgeDateMatch) info.issueDate = badgeDateMatch[1];
    }

    return info;
}

function extractLicensingOffice(lines, joinedText) {
    // Look for office location near "Licencing Authority" or "SUB OFFICE"
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        
        // Match "SUB OFFICE, LOCATION" - stop at section keywords
        let match = line.match(/SUB\s+OFFICE[,:]\s*([A-Z\s,]+?)(?:\s+Hill|\s+Badge|\s+Vehicle|\s+Category|$)/i);
        if (match) {
            const location = cleanValue(match[1]);
            if (location && location.length > 2) return location;
        }
        
        // Match "Licencing Authority" followed by location on next line
        if (/Licencing\s+Authority/i.test(line) && i + 1 < lines.length) {
            const nextLine = lines[i + 1];
            // Skip if next line contains section keywords
            if (!/Badge|Issued|Code|Hill|Validity|Vehicle|Category/i.test(nextLine)) {
                const location = cleanValue(nextLine);
                if (location && location.length > 2) return location;
            }
        }
    }
    
    // Search in joined text - stop at section keywords
    let match = joinedText.match(/SUB\s+OFFICE[,:\s]+([A-Z\s,]+?)(?:\s+Hill|\s+Badge|\s+Vehicle|$)/i);
    if (match) {
        const location = cleanValue(match[1]);
        if (location && location.length > 2) return location;
    }
    
    return null;
}

function extractEmergencyContact(lines, joinedText) {
    for (const line of lines) {
        if (/Emergency\s+Contact/i.test(line)) {
            const match = line.match(/Emergency\s+Contact\s+(?:Number|No\.?)[:\-\s]*(.+)/i);
            if (match) return cleanValue(match[1]);
        }
    }
    return null;
}

function formatDate(dateStr) {
    if (!dateStr) return null;
    
    // Match DD-MM-YYYY, DD/MM/YYYY formats
    const match = dateStr.match(/(\d{2})[/-](\d{2})[/-](\d{4})/);
    if (!match) return null;

    const day = match[1];
    const month = match[2];
    const year = match[3];

    // Return YYYY-MM-DD format
    return `${year}-${month}-${day}`;
}
