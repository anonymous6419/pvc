/**
 * ABHA (Ayushman Bharat Health Account) Card Parser
 * Extracts fields from OCR text of ABHA card
 * 
 * Fields to extract:
 * - Name
 * - ABHA Number (14-digit)
 * - ABHA Address
 * - Gender
 * - Date of Birth
 * - Mobile
 */

export function parseABHAText(text) {
    const result = {
        name: null,
        abhaNumber: null,
        abhaAddress: null,
        gender: null,
        dob: null,
        mobile: null
    };

    if (!text) return result;

    // Clean text - normalize line breaks and spaces
    const cleanText = text.replace(/[\r\n]+/g, '\n').replace(/\s+/g, ' ').trim();
    
    // Also keep original with line breaks for line-by-line matching
    const originalLines = text.split(/[\r\n]+/).map(l => l.trim()).filter(Boolean);

    // Extract Name - Multiple patterns
    let nameMatch = cleanText.match(/(?:Name|नाम|NAME)\s*[:：]?\s*([A-Za-z][A-Za-z\s]{2,50})(?=\s*(?:नाम|ABHA|आभा|Gender|लिंग|Mobile|$))/i);
    if (!nameMatch) {
        // Try line-by-line approach
        for (const line of originalLines) {
            if (/(?:Name|नाम|NAME)/i.test(line)) {
                const match = line.match(/(?:Name|नाम|NAME)\s*[:：]?\s*([A-Za-z][A-Za-z\s]+)/i);
                if (match) {
                    nameMatch = match;
                    break;
                }
            }
        }
    }
    if (!nameMatch) {
        // Fallback: Look for lines with full names (2-4 words, each capitalized)
        // Should appear after ABHA header but before ABHA Number
        for (let i = 0; i < originalLines.length; i++) {
            const line = originalLines[i];
            // Skip header lines
            if (/Ayushman|आयुष्मान|ABHA|आभा|Health|Account|खाता/i.test(line)) continue;
            // Skip lines with ABHA Number, Address, Gender, DOB, Mobile
            if (/(?:Abha\s*Number|Abha\s*Address|Gender|Date|Birth|Mobile|[0-9]{10}|@abdm|@sbx)/i.test(line)) continue;
            // Look for proper name pattern: 2-4 words, mostly alphabetic
            const namePattern = line.match(/^([A-Z][a-z]+(?:\s+[A-Z][a-z]+){1,3})(?:\s+[A-Z][a-z]{0,2})?/);
            if (namePattern && namePattern[1].length > 5) {
                nameMatch = namePattern;
                break;
            }
        }
    }
    if (nameMatch) {
        let name = nameMatch[1].trim().replace(/\s+/g, ' ');
        // Clean up OCR noise: Remove trailing 1-2 letter words (likely OCR artifacts)
        name = name.replace(/\s+[A-Z][a-z]{0,2}$/, '');
        result.name = name;
    }

    // Extract ABHA Number - More flexible patterns
    // Try with explicit label first
    let abhaNumberMatch = cleanText.match(/(?:ABHA\s*(?:Number|No\.?|Card\s*Number)|आभा\s*(?:नंबर|संख्या))\s*[:：]?\s*([0-9\s-]{12,20})/i);
    if (!abhaNumberMatch) {
        // Try standalone 14-digit pattern (not phone number)
        abhaNumberMatch = cleanText.match(/(?:^|\s)([0-9]{2}[\s-]?[0-9]{4}[\s-]?[0-9]{4}[\s-]?[0-9]{4})(?:\s|$)/);
    }
    if (!abhaNumberMatch) {
        // Try line-by-line
        for (const line of originalLines) {
            if (/(?:ABHA|आभा|Health\s*ID)/i.test(line) && /\d{10,}/.test(line)) {
                const match = line.match(/([0-9\s-]{12,20})/);
                if (match) {
                    const cleaned = match[1].replace(/[\s-]/g, '');
                    if (cleaned.length === 14) {
                        abhaNumberMatch = match;
                        break;
                    }
                }
            }
        }
    }
    if (abhaNumberMatch) {
        const cleaned = abhaNumberMatch[1].replace(/[\s-]/g, '');
        if (cleaned.length >= 14) {
            result.abhaNumber = cleaned.slice(0, 14);
        }
    }

    // Extract ABHA Address (already working well)
    const abhaAddressMatch = cleanText.match(/(?:ABHA\s*Address|आभा\s*पता|Address)\s*[:：]?\s*([a-zA-Z0-9._-]+@[a-zA-Z0-9.-]+)/i);
    if (abhaAddressMatch) {
        result.abhaAddress = abhaAddressMatch[1].trim().toLowerCase();
    } else {
        // Fallback: Look for any @abdm or @sbx address
        const addressFallback = cleanText.match(/([a-zA-Z0-9._-]+@(?:abdm|sbx))/i);
        if (addressFallback) {
            result.abhaAddress = addressFallback[1].toLowerCase();
        }
    }

    // Extract Gender - Enhanced patterns
    let genderMatch = cleanText.match(/(?:Gender|लिंग|SEX)\s*[:：\/]?\s*[^\n]{0,30}?\s*(Male|पुरुष)/i);
    if (!genderMatch) {
        genderMatch = cleanText.match(/(?:Gender|लिंग|SEX)\s*[:：\/]?\s*[^\n]{0,30}?\s*(Female|महिला)/i);
    }
    if (!genderMatch) {
        // Try line-by-line - look for line with Gender keyword
        for (const line of originalLines) {
            if (/(?:Gender|लिंग|SEX)/i.test(line)) {
                // Look for Male first, then Female (to avoid matching labels)
                let match = line.match(/(Male|पुरुष)/i);
                if (!match) {
                    match = line.match(/(Female|महिला)/i);
                }
                if (match) {
                    genderMatch = match;
                    break;
                }
            }
        }
    }
    if (!genderMatch) {
        // Fallback: Look for gender on same line as DOB and Mobile
        for (const line of originalLines) {
            if (/(?:\d{2}[\/-]\d{2}[\/-]\d{4}|\d{10})/.test(line)) {
                let match = line.match(/(Male|पुरुष)/i);
                if (!match) {
                    match = line.match(/(Female|महिला)/i);
                }
                if (match) {
                    genderMatch = match;
                    break;
                }
            }
        }
    }
    if (genderMatch) {
        const gender = genderMatch[1].toUpperCase();
        // Convert to standard format
        if (gender === 'पुरुष' || gender === 'M' || gender === 'MALE') result.gender = 'Male';
        else if (gender === 'महिला' || gender === 'F' || gender === 'FEMALE') result.gender = 'Female';
        else if (gender === 'अन्य' || gender === 'OTHER') result.gender = 'Other';
        else result.gender = genderMatch[1];
    }

    // Extract Date of Birth - Enhanced patterns
    let dobMatch = cleanText.match(/(?:Date\s*of\s*Birth|DOB|Birth\s*Date|जन्म\s*(?:तिथि|दिनांक))\s*[:：]?\s*(\d{1,2}[\/-]\d{1,2}[\/-]\d{2,4})/i);
    if (!dobMatch) {
        // Try line-by-line
        for (const line of originalLines) {
            if (/(?:Date\s*of\s*Birth|DOB|Birth|जन्म)/i.test(line)) {
                const match = line.match(/(\d{1,2}[\/-]\d{1,2}[\/-]\d{2,4})/);
                if (match) {
                    dobMatch = match;
                    break;
                }
            }
        }
    }
    if (!dobMatch) {
        // Fallback: Look for DD/MM/YYYY or DD-MM-YYYY pattern
        dobMatch = cleanText.match(/(?:^|\s)(\d{1,2}[\/-]\d{1,2}[\/-]\d{4})(?:\s|$)/);
    }
    if (dobMatch) {
        result.dob = dobMatch[1].replace(/[.-]/g, '/');
    }

    // Extract Mobile Number - Enhanced with multiple fallback patterns
    let mobileMatch = cleanText.match(/(?:Mobile|Phone|Contact|मोबाइल|संपर्क)\s*[:：]?\s*(?:[+]?91[\s-]?)?(\d{10})/i);
    if (!mobileMatch) {
        // Try with +91 prefix
        mobileMatch = cleanText.match(/[+]91[\s-]?(\d{10})/);
    }
    if (!mobileMatch) {
        // Try line-by-line
        for (const line of originalLines) {
            if (/(?:Mobile|Phone|Contact|मोबाइल|Tel|Mob)/i.test(line)) {
                const match = line.match(/(?:[+]?91[\s-]?)?(\d{10})/);
                if (match) {
                    mobileMatch = match;
                    break;
                }
            }
        }
    }
    if (!mobileMatch) {
        // Fallback: Look for standalone 10-digit number (but not part of 14-digit ABHA number)
        // Match 10 digits that are not preceded or followed by another digit
        const matches = cleanText.match(/(?<!\d)(\d{10})(?!\d)/g);
        if (matches && matches.length > 0) {
            // Filter out ABHA number if it contains a 10-digit sequence
            for (const match of matches) {
                // Check if this 10-digit is part of the already extracted ABHA number
                if (result.abhaNumber && result.abhaNumber.includes(match)) {
                    continue; // Skip if it's part of ABHA number
                }
                mobileMatch = [match, match]; // Create match array format
                break;
            }
        }
    }
    if (mobileMatch) {
        result.mobile = mobileMatch[1];
    }

    return result;
}
