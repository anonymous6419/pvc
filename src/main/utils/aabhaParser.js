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

    const devanagariDigitMap = {
        '०': '0', '१': '1', '२': '2', '३': '3', '४': '4',
        '५': '5', '६': '6', '७': '7', '८': '8', '९': '9'
    };

    const normalizeDigits = (value) => value
        .replace(/[०-९]/g, (digit) => devanagariDigitMap[digit] || digit);

    const normalizeOcrNumber = (value) => normalizeDigits(value)
        .replace(/[Oo]/g, '0')
        .replace(/[Il|]/g, '1')
        .replace(/S/g, '5')
        .replace(/B/g, '8');

    const collectNumericCandidates = (value) => {
        const candidates = [];
        const matches = value.match(/[0-9OIlSBo०-९][0-9OIlSBo०-९\s:-]{12,30}/g) || [];
        for (const raw of matches) {
            const normalized = normalizeOcrNumber(raw).replace(/\D/g, '');
            if (normalized.length >= 14) {
                candidates.push(normalized.slice(0, 14));
            }
        }
        return candidates;
    };

    // Clean text - normalize line breaks and spaces
    const cleanText = text.replace(/[\r\n]+/g, '\n').replace(/\s+/g, ' ').trim();
    const cleanTextNormalizedDigits = normalizeDigits(cleanText);
    
    // Also keep original with line breaks for line-by-line matching
    const originalLines = text.split(/[\r\n]+/).map(l => l.trim()).filter(Boolean);

    // Extract Name - Multiple patterns
    let nameMatch = cleanText.match(/(?:Name|नाम|NAME)\s*[:：]?\s*([A-Za-z][A-Za-z\s]{2,50})(?=\s*(?:नाम|ABHA|आभा|Gender|लिंग|Mobile|$))/i);
    if (!nameMatch) {
        // Try line-by-line approach
        for (const line of originalLines) {
            if (/(?:Name|नाम|NAME)/i.test(line)) {
                const match = line.match(/(?:Name|नाम|NAME)\s*[:：]?\s*([A-Za-z\u0900-\u097F][A-Za-z\u0900-\u097F\s]+)/i);
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

            const hindiNamePattern = line.match(/^([\u0900-\u097F]{2,}(?:\s+[\u0900-\u097F]{2,}){1,3})/);
            if (hindiNamePattern && hindiNamePattern[1].length > 3) {
                nameMatch = hindiNamePattern;
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
    let abhaNumberMatch = cleanTextNormalizedDigits.match(/(?:ABHA\s*(?:Number|No\.?|Card\s*Number)|आभा\s*(?:नंबर|संख्या))\s*[:：]?\s*([0-9OIlSBo\s-]{12,24})/i);
    if (!abhaNumberMatch) {
        // Try standalone 14-digit pattern (not phone number)
        abhaNumberMatch = cleanTextNormalizedDigits.match(/(?:^|\s)([0-9OIlSBo]{2}[\s-:]?[0-9OIlSBo]{4}[\s-:]?[0-9OIlSBo]{4}[\s-:]?[0-9OIlSBo]{4})(?:\s|$)/);
    }
    if (!abhaNumberMatch) {
        // Try line-by-line
        for (const line of originalLines) {
            if (/(?:ABHA|आभा|Health\s*ID)/i.test(line) && /\d{10,}/.test(line)) {
                const match = line.match(/([0-9OIlSBo०-९\s:-]{12,30})/);
                if (match) {
                    const cleaned = normalizeOcrNumber(match[1]).replace(/\D/g, '');
                    if (cleaned.length === 14) {
                        abhaNumberMatch = match;
                        break;
                    }
                }
            }
        }
    }
    if (abhaNumberMatch) {
        const cleaned = normalizeOcrNumber(abhaNumberMatch[1]).replace(/\D/g, '');
        if (cleaned.length >= 14) {
            result.abhaNumber = cleaned.slice(0, 14);
        }
    }

    if (!result.abhaNumber) {
        const candidates = collectNumericCandidates(cleanTextNormalizedDigits);
        if (candidates.length > 0) {
            result.abhaNumber = candidates[0];
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
    let genderMatch = cleanText.match(/(?:Gender|लिंग|SEX)\s*[:：\/]?\s*[^\n]{0,30}?\s*(Female|महिला|Male|पुरुष)/i);
    if (!genderMatch) {
        genderMatch = cleanText.match(/\b(Female|महिला|Male|पुरुष)\b/i);
    }
    if (!genderMatch) {
        // Try line-by-line - look for line with Gender keyword
        for (const line of originalLines) {
            if (/(?:Gender|लिंग|SEX)/i.test(line)) {
                // Look for Male first, then Female (to avoid matching labels)
                const match = line.match(/(Female|महिला|Male|पुरुष)/i);
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
                const match = line.match(/(Female|महिला|Male|पुरुष)/i);
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

/**
 * Parse ABHA card data from a decoded QR code payload.
 * Handles JSON payloads (most common), ABDM-signed XML, URL-only, and key=value formats.
 * Returns the same shape as parseABHAText so the caller can merge the two results.
 */
export function parseABHAFromQR(qrData) {
    const result = {
        name: null,
        abhaNumber: null,
        abhaAddress: null,
        gender: null,
        dob: null,
        mobile: null
    };

    if (!qrData || typeof qrData !== 'string' || !qrData.trim()) return result;

    const raw = qrData.trim();

    // ── 1. Try JSON parse ─────────────────────────────────────────────────────
    const tryJSON = (str) => {
        try { return JSON.parse(str); } catch { return null; }
    };

    let parsed = null;
    if (raw.startsWith('{') || raw.startsWith('[')) {
        parsed = tryJSON(raw);
    } else {
        // QR may contain a URL followed by JSON, or JSON embedded in another structure
        const jsonMatch = raw.match(/(\{[\s\S]*\})/);
        if (jsonMatch) parsed = tryJSON(jsonMatch[1]);
    }

    if (parsed && typeof parsed === 'object') {
        // ABDM / NHA field name variants
        const pick = (...keys) => {
            for (const k of keys) {
                const v = parsed[k] ?? parsed[k.toLowerCase()] ?? parsed[k.toUpperCase()];
                if (v && String(v).trim()) return String(v).trim();
            }
            return null;
        };

        const rawAbha = pick('hidn', 'healthId', 'abhaNumber', 'ABHA_Number', 'healthIdNumber', 'phr');
        if (rawAbha) {
            const digits = rawAbha.replace(/\D/g, '');
            if (digits.length >= 14) result.abhaNumber = digits.slice(0, 14);
        }

        result.abhaAddress = pick('hid', 'abhaAddress', 'phrAddress', 'address') || null;
        if (result.abhaAddress && !result.abhaAddress.includes('@')) result.abhaAddress = null; // must be @abdm/@sbx

        result.name = pick('name', 'Name', 'fullName') || null;

        const g = pick('gender', 'Gender', 'sex');
        if (g) {
            const upper = g.toUpperCase();
            if (upper === 'M' || upper === 'MALE') result.gender = 'Male';
            else if (upper === 'F' || upper === 'FEMALE') result.gender = 'Female';
            else if (upper === 'O' || upper === 'OTHER') result.gender = 'Other';
            else result.gender = g;
        }

        const dob = pick('dob', 'dateOfBirth', 'DOB', 'birthDate');
        if (dob) {
            // Normalize various DOB formats to DD/MM/YYYY
            const dateMatch = dob.match(/(\d{1,4})[-\/\.](\d{1,2})[-\/\.](\d{1,4})/);
            if (dateMatch) {
                const [, p1, p2, p3] = dateMatch;
                if (p1.length === 4) {
                    // YYYY-MM-DD
                    result.dob = `${p2.padStart(2,'0')}/${p3.padStart(2,'0')}/${p1}`;
                } else {
                    // DD/MM/YYYY or DD/MM/YY
                    const year = p3.length === 2 ? `19${p3}` : p3;
                    result.dob = `${p1.padStart(2,'0')}/${p2.padStart(2,'0')}/${year}`;
                }
            }
        }

        const mob = pick('mobile', 'mobileNumber', 'phone', 'phoneNumber');
        if (mob) {
            const digits = mob.replace(/\D/g, '');
            result.mobile = digits.slice(-10) || null;
        }

        return result;
    }

    // ── 2. URL-only payload — extract ABHA number from path segment ────────────
    const urlAbhaMatch = raw.match(/(?:healthid\.ndhm\.gov\.in|abha\.abdm\.gov\.in)\/([0-9-]{14,17})/i);
    if (urlAbhaMatch) {
        const digits = urlAbhaMatch[1].replace(/\D/g, '');
        if (digits.length >= 14) result.abhaNumber = digits.slice(0, 14);
    }

    // ── 3. Plain key=value or pipe-delimited ──────────────────────────────────
    const hidnMatch = raw.match(/hidn[=:\s]+([0-9-]{14,17})/i);
    if (hidnMatch) {
        result.abhaNumber = hidnMatch[1].replace(/\D/g, '').slice(0, 14);
    }
    const hidMatch = raw.match(/hid[=:\s]+([a-zA-Z0-9._-]+@(?:abdm|sbx))/i);
    if (hidMatch) result.abhaAddress = hidMatch[1].toLowerCase();

    // Fallback: bare @abdm address anywhere in the string
    if (!result.abhaAddress) {
        const addrFallback = raw.match(/([a-zA-Z0-9._-]+@(?:abdm|sbx))/i);
        if (addrFallback) result.abhaAddress = addrFallback[1].toLowerCase();
    }

    return result;
}
