
export function parseEShramText(text) {
    const result = {
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

    if (!text || text.trim().length === 0) {
        console.log('⚠️ No text provided for E-Shram parsing');
        return result;
    }

    console.log('\n========== E-SHRAM PARSER DEBUG ==========');
    console.log('📝 RAW TEXT LENGTH:', text.length);
    console.log('📝 RAW TEXT PREVIEW:');
    console.log(text);
    console.log('==========================================\n');

    // Split front and back if separator exists
    const parts = text.split('===== BACK CARD =====');
    const frontText = parts[0] || '';
    const backText = parts[1] || '';
    
    if (parts.length > 1) {
        console.log('🔍 Detected FRONT + BACK cards');
        console.log(`   Front: ${frontText.length} chars`);
        console.log(`   Back:  ${backText.length} chars\n`);
    }

    // Helper function to convert Devanagari digits to English
    const toEnglishDigits = (str) => {
        const devanagariMap = {
            '०': '0', '१': '1', '२': '2', '३': '3', '४': '4',
            '५': '5', '६': '6', '७': '7', '८': '8', '९': '9'
        };
        return str.replace(/[०-९]/g, (match) => devanagariMap[match] || match);
    };

    // Clean text for pattern matching
    let cleanText = text.replace(/\s+/g, ' ').trim();
    let normalizedText = toEnglishDigits(cleanText);
    
    // Split into lines for line-by-line analysis
    const lines = text.split('\n').map(l => l.trim()).filter(l => l.length > 0);
    
    console.log('📊 Line-by-line analysis:');
    lines.forEach((line, i) => console.log(`  ${i}: "${line}"`));
    console.log();

    // === Extract Name ===
    // IMPORTANT: Only search in FRONT card to avoid picking up "Blood Group" from back
    const frontLines = frontText.split('\n').map(l => l.trim()).filter(l => l.length > 0);
    
    console.log('🔍 Searching for name in FRONT card lines:', frontLines.length, 'lines');
    
    let nameFound = false;
    
    // Strategy 1: Look for "Name" label pattern with Hindi/English mix
    // Handle OCR garbage like "H gee GOO" between label and name
    for (const line of frontLines) {
        if (/नाम|Name/i.test(line) && !/Father|पिता|INDIA|GOVT/i.test(line)) {
            console.log('   Found name line:', line.substring(0, 80));
            // More flexible pattern: allow single or multi-word names
            const nameMatch = line.match(/(?:नाम|Name)[^A-Z]*([A-Z][a-z]+(?:\s+[A-Z]?[a-z]+)*)\s*\.?/i);
            if (nameMatch) {
                const candidate = nameMatch[1].trim().replace(/\.$/, '');
                // Validate: at least 3 chars and not OCR garbage
                if (candidate.length >= 3 && !/^[A-Z]$/.test(candidate)) {
                    result.name = candidate;
                    console.log('✅ Name (from नाम/Name line):', result.name);
                    nameFound = true;
                    break;
                }
            }
        }
    }
    
    // Strategy 2: Look for capitalized name in FRONT card only (exclude common keywords)
    if (!nameFound) {
        console.log('   Name not found in labeled line, trying clean line strategy...');
        for (const line of frontLines) {
            const skipKeywords = /ई-श्रम|eShram|Card|MINISTRY|Universal|Account|Number|पिता|Father|मंत्रालय|GOVT|INDIA|भारत|सरकार|Pes|Crs|Blood|Group|Primary|Occupation|DOB|Date|Gender/i;
            const tooShort = line.length < 3;
            const hasSpecialChars = /[©@#$%^&*()_+=\[\]{};:'",.<>?\/\\|`~]/.test(line);
            const onlyConsonants = /^[BCDFGHJKLMNPQRSTVWXYZ\s]+$/i.test(line) && line.length < 5;
            
            if (line.match(/^[A-Z][a-z]+(\s+[A-Z][a-z]+)*$/) && 
                !skipKeywords.test(line) && 
                !tooShort && 
                !hasSpecialChars &&
                !onlyConsonants) {
                result.name = line;
                console.log('✅ Name (from clean line):', result.name);
                nameFound = true;
                break;
            }
        }
    }
    
    if (!nameFound) {
        console.log('❌ Name not found');
    }

    // === Extract Father's Name ===
    // Search only in FRONT card, handle OCR garbage between label and name
    for (const line of frontLines) {
        if (/पिता|Father/i.test(line)) {
            // Pattern: "पिता का नाम / [garbage] Actual Name"
            // Extract any capitalized name sequence after the label
            const fatherMatch = line.match(/(?:पिता|Father)[^A-Za-z]*(?:[A-Z]\s+)?([A-Z][a-z]+(?:\s+[a-z]+)+)/i);
            if (fatherMatch) {
                result.fatherName = fatherMatch[1].trim();
                console.log('✅ Father Name:', result.fatherName);
                break;
            }
        }
    }
    
    if (!result.fatherName) {
        console.log('❌ Father Name not found');
    }

    // === Extract UAN (Universal Account Number) ===
    // More flexible patterns to handle OCR errors
    const uanPatterns = [
        /Universal\s*Account\s*Number[^\d]*([\d\s]{10,})/i,
        /UAN[^\d]*([\d\s]{10,})/i,
        /eShram\s*Card[^\d]*([\d\s]{10,})/i,
        /Account\s*No[^\d]*([\d\s]{10,})/i,
        // Fallback: Look for 12-digit number sequences (with optional spaces)
        /(\d[\s]*\d[\s]*\d[\s]*\d[\s]*\d[\s]*\d[\s]*\d[\s]*\d[\s]*\d[\s]*\d[\s]*\d[\s]*\d)/
    ];
    
    for (const pattern of uanPatterns) {
        const match = normalizedText.match(pattern);
        if (match) {
            const digits = match[1].replace(/\s/g, '').replace(/\D/g, '');
            if (digits.length >= 10 && digits.length <= 12) {
                result.uan = digits.slice(0, 12);
                console.log('✅ UAN:', result.uan, '(extracted from:', match[1].substring(0, 30) + '...)');
                break;
            }
        }
    }
    
    if (!result.uan) {
        console.log('❌ UAN not found');
    }

    // === Extract DOB ===
    // Search in FRONT card and handle various formats and OCR errors
    const dobPatterns = [
        /(?:DOB|Date\s*of\s*Birth|जन्म\s*तिथि)[:\s\/\.]*(\d{1,2})[\s\/\-\.](\d{1,2})[\s\/\-\.](\d{4})/i,
        /(?:008|DOB|0OB|D0B)[:\s\/\.]*(\d{2})[\s\/\-](\d{2})[\s\/\-](\d{4})/i, // "008", "0OB", "D0B" are common OCR errors
        /(?:Birth|जन्म)[:\s\/\.]*(\d{1,2})[\s\/\-\.](\d{1,2})[\s\/\-\.](\d{4})/i,
        /(\d{2})[\s\/\-](\d{2})[\s\/\-](\d{4})/  // Fallback for any DD/MM/YYYY pattern
    ];
    
    for (const pattern of dobPatterns) {
        const match = frontText.match(pattern);
        if (match) {
            const day = match[1].padStart(2, '0');
            const month = match[2].padStart(2, '0');
            const year = match[3];
            
            // Validate it's a reasonable date (not UAN or phone number)
            if (parseInt(day) <= 31 && parseInt(month) <= 12 && parseInt(year) >= 1950 && parseInt(year) <= 2010) {
                result.dob = `${day}/${month}/${year}`;
                console.log('✅ DOB:', result.dob);
                break;
            }
        }
    }
    
    if (!result.dob) {
        console.log('❌ DOB not found');
    }

    // === Extract Gender ===
    // More flexible pattern to handle OCR errors like "Bm / Gender +"
    const genderMatch = normalizedText.match(/(?:Gender|लिंग|Sex|Bm)[:\s\/©+]*[\s]*(M|F|Male|Female|पुरुष|महिला)/i);
    if (genderMatch) {
        const g = genderMatch[1].toLowerCase();
        if (g === 'm' || g === 'male' || g === 'पुरुष') result.gender = 'Male';
        else if (g === 'f' || g === 'female' || g === 'महिला') result.gender = 'Female';
        else result.gender = genderMatch[1];
        console.log('✅ Gender:', result.gender);
    } else {
        console.log('❌ Gender not found');
    }

    // === Extract Blood Group ===
    // Search in BACK card only (blood group appears there)
    // Handle OCR errors: "Grow" instead of "Group", "Gro" etc.
    const bloodMatch = backText.match(/Blood\s*Gro[uwp]*[:\s]*([ABO]+[+-]?)/i);
    if (bloodMatch) {
        // Extract just the blood group letters, ignore OCR garbage after
        const bg = bloodMatch[1].toUpperCase().replace(/[^ABO+-]/g, '');
        if (bg && /^[ABO]+[+-]?$/.test(bg)) {
            result.bloodGroup = bg;
            console.log('✅ Blood Group:', result.bloodGroup);
        }
    }
    
    if (!result.bloodGroup) {
        console.log('❌ Blood Group not found');
    }

    // === Extract Occupation ===
    // Search in BACK card where occupation is typically located
    // IMPORTANT: Must not contain "पिता" or "Father" (to avoid father's name line)
    const backLines = backText.split('\n').map(l => l.trim()).filter(l => l.length > 0);
    
    console.log('🔍 Searching for occupation in BACK card lines:', backLines.length, 'lines');
    console.log('📄 BACK CARD TEXT:', backText.substring(0, 200));
    
    // First, try to find common occupation words directly (more reliable)
    const occupationKeywords = [
        'Laborer', 'Labourer', 'Worker', 'Driver', 'Carpenter', 'Electrician', 
        'Plumber', 'Mason', 'Painter', 'Welder', 'Mechanic', 'Tailor',
        'Farm', 'Agriculture', 'Construction', 'Helper', 'Cleaner', 'Guard',
        'Vendor', 'Seller', 'मजदूर', 'कारीगर', 'ड्राइवर'
    ];
    
    for (const line of backLines) {
        for (const keyword of occupationKeywords) {
            if (new RegExp(keyword, 'i').test(line)) {
                // Extract the occupation word and surrounding context
                const regex = new RegExp(`(${keyword}[a-z\\s]*(?:worker|labour|labourer)?)`, 'gi');
                const match = line.match(regex);
                if (match) {
                    const occ = match[0].trim();
                    // Validate it doesn't contain father/name keywords
                    if (!/Father|Fates|पिता|Name|नाम|Hame/i.test(occ)) {
                        result.occupation = occ;
                        console.log('✅ Occupation (keyword match):', result.occupation);
                        break;
                    }
                }
            }
        }
        if (result.occupation) break;
    }
    
    // If no keyword match, try the label-based approach
    if (!result.occupation) {
        for (const line of backLines) {
            // Very strict filter: Skip ANY line that even remotely looks like father's name
            if (/पिता|Father|Fates|Fathe|Fater|Fathers|Name|Hame|ame|नाम|का\s*नाम/i.test(line)) {
                console.log('⏭️  Skipping father/name line:', line.substring(0, 80));
                continue;
            }
            
            if (/Primary|Occupation|व्यवसाय/i.test(line)) {
                console.log('🔍 Found occupation line:', line);
                // Extract occupation after the label
                const occMatch = line.match(/(?:Primary|Occupation|व्यवसाय)[:\s©]*([-A-Za-z\s,&']+?)(?=Current|Address|Contact|$)/i);
                if (occMatch) {
                    let occ = occMatch[1]
                        .replace(/Occupation|व्यवसाय|Pry|Primary|Compe|CE|Coes|Ci|Sty\)/gi, '')
                        .replace(/\s+/g, ' ')
                        .trim();
                    
                    // Very strict validation: reject if it contains ANY father/name keywords or Hindi text patterns
                    if (occ && occ.length > 2 && !/Father|Fates|पिता|Name|नाम|Hame|ame|का|दी/i.test(occ)) {
                        result.occupation = occ;
                        console.log('✅ Occupation (label-based):', result.occupation);
                        break;
                    } else {
                        console.log('   ⚠️ Rejected occupation (contains father/name keywords):', occ);
                    }
                }
            }
        }
    }
    
    if (!result.occupation) {
        console.log('❌ Occupation not found or invalid');
    }

    // === Extract Address ===
    // Search in BACK card where address is typically located
    const addressMatch = backText.match(/(?:Current\s*Address|Address)[:\s]*([^]+?)(?=Contact|Mobile|Phone|©|$)/i);
    if (addressMatch) {
        result.address = addressMatch[1]
            .replace(/REIS|Silo|Bed/g, '') // Remove OCR artifacts
            .replace(/\s+/g, ' ')
            .trim();
        
        if (result.address && result.address.length > 5) {
            console.log('✅ Address:', result.address.substring(0, 60) + '...');
        } else {
            result.address = null;
            console.log('❌ Address too short after cleanup');
        }
    } else {
        console.log('❌ Address not found');
    }

    // === Extract Contact Number ===
    // More flexible pattern to handle spaces, OCR errors, and different formats
    for (const line of backLines) {
        // Handle common OCR errors: "Contact", "Mobile", "Phone", "amber" (OCR error for Number)
        if (/Contact|Mobile|Phone|amber|संपर्क/i.test(line)) {
            console.log('   Found contact line:', line.substring(0, 60));
            // Extract 10-digit number (with or without spaces, dashes, or dots)
            const digitMatch = line.match(/(\d[\s\.\-]*\d[\s\.\-]*\d[\s\.\-]*\d[\s\.\-]*\d[\s\.\-]*\d[\s\.\-]*\d[\s\.\-]*\d[\s\.\-]*\d[\s\.\-]*\d)/);
            if (digitMatch) {
                const digits = digitMatch[1].replace(/[\s\.\-]/g, '');
                // Validate it's exactly 10 digits and starts with 6-9 (Indian mobile numbers)
                if (digits.length === 10 && /^[6-9]/.test(digits)) {
                    result.contactNumber = digits;
                    console.log('✅ Contact:', result.contactNumber);
                    break;
                } else if (digits.length === 10) {
                    // Accept even if doesn't start with 6-9 (some older numbers)
                    result.contactNumber = digits;
                    console.log('✅ Contact (non-standard):', result.contactNumber);
                    break;
                }
            }
        }
    }
    
    if (!result.contactNumber) {
        console.log('❌ Contact not found');
    }

    console.log('\n📋 ===== FINAL PARSED RESULT =====');
    console.log(JSON.stringify(result, null, 2));
    console.log('=====================================\n');
    
    return result;
}