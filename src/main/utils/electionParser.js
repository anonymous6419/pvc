/**
 * ===============================
 * PARSE ELECTION CARD TEXT
 * ===============================
 */
export function parseElectionText(text) {
    console.log('[Parser] Starting election card parsing');

    const fields = {
        epicNumber: null,
        name: null,
        relation: null,
        gender: null,
        dob: null,
        address: null,
        city: null,
        state: null,
        pincode: null,
        assemblyConstituency: null,
        partNumber: null,
        pollingStationNumber: null,
        ero: null,
        downloadDate: null,
        rawText: text || ''
    };

    if (!text || typeof text !== 'string') {
        console.log('[Parser] No valid text received');
        return { fields };
    }

    // Normalize text
    const normalized = text.replace(/\r/g, '');
    const lines = normalized
        .split('\n')
        .map(line => line.replace(/\s+/g, ' ').trim())
        .filter(Boolean);

    console.log('[Parser] Total lines after normalization:', lines.length);

    // EPIC Number
    const epicMatch = normalized.match(/[A-Z]{3}[0-9]{7}/);
    if (epicMatch) {
        fields.epicNumber = epicMatch[0];
        console.log('[Parser] EPIC Number found:', fields.epicNumber);
    }

    // Name
    fields.name =
        extractLabeledValue(lines, {
            labelRegex: /^Name\s*:/i,
            disqualifyRegex: /(Father|Husband|Mother|Relation)/i,
            maxEnglishWords: 5
        }) ||
        fallbackNameFromRegionalLabel(lines);
    
    // Filter to English only
    if (fields.name) {
        fields.name = filterEnglishOnly(fields.name);
    }

    console.log('[Parser] Name:', fields.name);

    // Relation (nested object)
    const relation = extractRelation(lines);
    if (relation) {
        fields.relation = {
            type: relation.type.toUpperCase(),
            name: filterEnglishOnly(relation.name)  // Filter to English only
        };
        console.log('[Parser] Relation:', fields.relation);
    }

    // Gender
    fields.gender = extractGender(lines);
    console.log('[Parser] Gender:', fields.gender);

    // DOB (convert to YYYY-MM-DD format)
    const dobRaw = extractDob(lines);
    if (dobRaw) {
        fields.dob = convertToISODate(dobRaw);
    }
    console.log('[Parser] DOB:', fields.dob);

    // Address and location extraction
    const addressData = extractAddressWithLocation(lines, normalized, fields.epicNumber);
    fields.address = addressData.address;
    fields.city = addressData.city;
    fields.state = addressData.state;
    fields.pincode = addressData.pincode;
    console.log('[Parser] Address extracted:', fields.address);

    // ERO extraction (separate from address)
    fields.ero = extractERO(lines);
    console.log('[Parser] ERO:', fields.ero);

    // Fix name if it contains location details (Karnataka format issue)
    if (fields.name) {
        const nameCleanup = cleanNameFromLocation(fields.name, lines);
        if (nameCleanup.locationPart) {
            // Append location to address
            if (fields.address) {
                fields.address = fields.address + ', ' + nameCleanup.locationPart;
            }
            // Re-extract location details from updated address
            const locationData = extractLocationFromText(fields.address);
            if (locationData.city) fields.city = locationData.city;
            if (locationData.state) fields.state = locationData.state;
            if (locationData.pincode) fields.pincode = locationData.pincode;
        }
        fields.name = nameCleanup.cleanName;
    }

    // Assembly Constituency
    fields.assemblyConstituency = extractAssembly(lines);
    console.log('[Parser] Assembly:', fields.assemblyConstituency);

    // Part Number
    const partDetails = extractPartDetails(lines);
    if (partDetails) {
        const partMatch = partDetails.match(/^\s*(\d+)/);
        if (partMatch) {
            fields.partNumber = partMatch[1];
        }
    }

    // Polling Station Number
    const pollingStation = extractPollingStation(lines);
    if (pollingStation) {
        const stationMatch = pollingStation.match(/^\s*(\d+)/);
        if (stationMatch) {
            fields.pollingStationNumber = stationMatch[1];
        }
    }

    // Download Date (convert to YYYY-MM-DD format)
    const downloadDateRaw = extractDownloadDate(lines);
    if (downloadDateRaw) {
        fields.downloadDate = convertToISODate(downloadDateRaw);
    }

    console.log('[Parser] Parsing completed');

    return { fields };
}

/**
 * ===============================
 * HELPER FUNCTIONS
 * ===============================
 */

function extractLabeledValue(lines, options) {
    const { labelRegex, disqualifyRegex, maxEnglishWords = 5 } = options;

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (!labelRegex.test(line)) continue;
        if (disqualifyRegex && disqualifyRegex.test(line)) continue;

        const value = getValuePortion(line) || lines[i + 1];
        const english = takeEnglishSegment(value, maxEnglishWords);
        if (english) return english;
    }
    return null;
}

function getValuePortion(line) {
    if (!line || !line.includes(':')) return '';
    return line.split(':').slice(1).join(':').trim();
}

function takeEnglishSegment(value, maxWords = 5) {
    if (!value) return null;
    const match = value.match(/[A-Za-z][A-Za-z'.-]*(?:\s+[A-Za-z][A-Za-z'.-]*)*/);
    if (!match) return null;

    const words = match[0].split(' ');
    if (words.length > maxWords) return null;
    return words.join(' ');
}

function fallbackNameFromRegionalLabel(lines) {
    const index = lines.findIndex(line => /নাম/i.test(line));
    if (index !== -1 && lines[index + 1]) {
        return takeEnglishSegment(lines[index + 1], 4);
    }
    return null;
}

function extractRelation(lines) {
    for (const line of lines) {
        // Match "Father's Name:", "Husband Name:", etc.
        const match = line.match(/(Father|Husband|Mother|Wife|Guardian)'?s?\s*Name\s*:\s*(.+)/i);
        if (match) {
            const name = takeEnglishSegment(match[2], 6);
            if (name) {
                return {
                    type: match[1],
                    name: name
                };
            }
        }
    }
    
    // Alternative pattern: Look for relation labels in regional scripts followed by English name
    for (let i = 0; i < lines.length - 1; i++) {
        if (/Father|Husband|Mother/i.test(lines[i]) && /Name/i.test(lines[i])) {
            const name = takeEnglishSegment(lines[i + 1], 6);
            if (name) {
                const typeMatch = lines[i].match(/(Father|Husband|Mother|Wife|Guardian)/i);
                if (typeMatch) {
                    return {
                        type: typeMatch[1],
                        name: name
                    };
                }
            }
        }
    }
    
    return null;
}

function extractGender(lines) {
    for (const line of lines) {
        if (/Female/i.test(line)) return 'Female';
        if (/Male/i.test(line) && !/Female/i.test(line)) return 'Male';
    }
    return null;
}

function extractAge(lines) {
    for (const line of lines) {
        const match = line.match(/Age\s*:\s*(\d{1,3})/i);
        if (match) return match[1];
    }
    return null;
}

function extractDob(lines) {
    for (const line of lines) {
        const match = line.match(/(\d{2}[/-]\d{2}[/-]\d{4})/);
        if (match) return match[1];
    }
    return null;
}

function extractAddress(lines, voterId) {
    const index = lines.findIndex(line => /Address\s*:/i.test(line));
    if (index === -1) return null;

    const parts = [];
    for (let i = index; i < lines.length; i++) {
        if (i !== index && isAddressTerminator(lines[i])) break;
        let value = lines[i].replace(/Address\s*:/i, '').trim();
        if (voterId) value = value.replace(voterId, '').trim();
        if (value) parts.push(value);
    }
    return parts.join(' ');
}

function isAddressTerminator(line) {
    return /^(Name|Father|Gender|Age|Serial|Assembly|Polling|Download|Poll)/i.test(line);
}

function extractSerialNumber(lines) {
    for (const line of lines) {
        const match = line.match(/Serial\s*No\.?\s*:\s*(\d+)/i);
        if (match) return match[1];
    }
    return null;
}

function extractAssembly(lines) {
    for (const line of lines) {
        // Try to match patterns like "216-Krishnaraja" or "27 - Jalgaon (Jamod)"
        const match = line.match(/Assembly\s+Constituency(?:\s+No\.?\s+and\s+Name)?\s*:\s*(.+)/i);
        if (match) {
            let value = filterEnglishOnly(match[1].trim());
            // Clean up the format (e.g., "216-Krishnaraja" -> "216 - Krishnaraja")
            value = value.replace(/(\d+)\s*-\s*/, '$1 - ');
            return value;
        }
        
        // Alternative pattern: direct number-name format
        const directMatch = line.match(/(\d+)\s*-\s*([A-Za-z\s()]+)/);
        if (directMatch && /Assembly|Constituency/i.test(lines[Math.max(0, lines.indexOf(line) - 1)])) {
            return `${directMatch[1]} - ${filterEnglishOnly(directMatch[2].trim())}`;
        }
    }
    return null;
}

function extractPartDetails(lines) {
    for (const line of lines) {
        const match = line.match(/Part\s+No.*:\s*(.+)/i);
        if (match) return match[1];
    }
    return null;
}

function extractPollingStation(lines) {
    for (const line of lines) {
        // Try to extract just the number if it's at the start
        const match = line.match(/Polling\s+Station(?:\s+Address)?\s*:\s*(\d+)/i);
        if (match) return match[1];
        
        // Try full pattern
        const fullMatch = line.match(/Polling\s+Station.*:\s*(.+)/i);
        if (fullMatch && fullMatch[1] !== 'N.A' && fullMatch[1] !== 'N.A.') {
            // Try to extract number from the result
            const numMatch = fullMatch[1].match(/^\s*(\d+)/);
            if (numMatch) return numMatch[1];
            return filterEnglishOnly(fullMatch[1]);
        }
    }
    return null;
}

function extractDownloadDate(lines) {
    for (const line of lines) {
        // Match "Download Date -:" or "Download Date:"
        const match = line.match(/Download\s+Date\s*-?\s*:\s*(\d{2}[/-]\d{2}[/-]\d{4})/i);
        if (match) return match[1];
    }
    return null;
}

function extractPollDate(lines) {
    for (const line of lines) {
        const match = line.match(/Poll\s+Date\s*:\s*(\d{2}[/-]\d{2}[/-]\d{4}|N\.A)/i);
        if (match && match[1] !== 'N.A') return match[1];
    }
    return null;
}

function extractPollTime(lines) {
    for (const line of lines) {
        const match = line.match(/Timings\s*:\s*(\d{1,2}:\d{2}\s*(AM|PM)?|N\.A)/i);
        if (match && match[1] !== 'N.A') return match[1];
    }
    return null;
}

/**
 * Convert date from DD-MM-YYYY or DD/MM/YYYY to YYYY-MM-DD
 */
function convertToISODate(dateStr) {
    if (!dateStr) return null;
    
    const match = dateStr.match(/(\d{2})[/-](\d{2})[/-](\d{4})/);
    if (match) {
        const [, day, month, year] = match;
        return `${year}-${month}-${day}`;
    }
    return dateStr;
}

/**
 * Extract address with location details (city, state, pincode)
 */
function extractAddressWithLocation(lines, fullText, epicNumber) {
    const result = {
        address: null,
        city: null,
        state: null,
        pincode: null
    };

    // Find address section
    const addressIndex = lines.findIndex(line => /Address\s*:/i.test(line));
    if (addressIndex === -1) return result;

    // Collect address lines
    const addressParts = [];
    for (let i = addressIndex; i < lines.length; i++) {
        if (i !== addressIndex && isAddressTerminator(lines[i])) break;
        
        let value = lines[i].replace(/Address\s*:/i, '').trim();
        
        // Remove EPIC number from address
        if (epicNumber) {
            value = value.replace(epicNumber, '').trim();
        }
        
        // Skip ERO lines (handled separately)
        if (/ERO\s*[-:]|Electoral\s+Registration\s+Officer/i.test(value)) {
            continue;
        }
        
        // Skip relation lines (already extracted separately)
        if (/(Father|Husband|Mother|Wife)'?s?\s*Name\s*:/i.test(value)) {
            continue;
        }
        
        if (value) addressParts.push(value);
    }

    // Join address parts
    let fullAddress = addressParts.join(', ').replace(/\s+/g, ' ').trim();

    // Filter to English only
    fullAddress = filterEnglishOnly(fullAddress);

    // Extract pincode
    const pincodeMatch = fullAddress.match(/(\d{6})/);
    if (pincodeMatch) {
        result.pincode = pincodeMatch[1];
    }

    // Extract state (common Indian states)
    const stateMatch = fullAddress.match(/(Maharashtra|Karnataka|Tamil Nadu|Kerala|Gujarat|Rajasthan|Punjab|Haryana|Uttar Pradesh|Madhya Pradesh|Bihar|West Bengal|Andhra Pradesh|Telangana|Odisha|Assam|Jharkhand|Chhattisgarh|Uttarakhand|Himachal Pradesh|Tripura|Meghalaya|Manipur|Nagaland|Goa|Arunachal Pradesh|Mizoram|Sikkim|Delhi|Puducherry|Chandigarh|Jammu and Kashmir|Ladakh)/i);
    if (stateMatch) {
        result.state = stateMatch[1];
    }

    // Extract city - try multiple strategies
    // Strategy 1: Look for "City Corporation" or "Municipal Corporation" pattern
    const cityCorpMatch = fullAddress.match(/([A-Z][A-Z\s]+?)\s+(?:MUNICIPAL[,\s]+CORPORATION|City\s+Corporation)/i);
    if (cityCorpMatch) {
        result.city = cityCorpMatch[1].trim();
    }
    
    // Strategy 2: Word before state (handles both Title Case and UPPERCASE)
    if (!result.city && result.state) {
        const beforeState = fullAddress.split(result.state)[0];
        const cityMatch = beforeState.match(/,\s*([A-Z][A-Z\s]+?|[A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)(?:\s+SADAR)?\s*,?\s*$/i);
        if (cityMatch) {
            result.city = cityMatch[1].trim();
        }
    }
    
    // Strategy 3: Word before pincode (handles both Title Case and UPPERCASE)
    if (!result.city && result.pincode) {
        const beforePincode = fullAddress.split(result.pincode)[0];
        const cityMatch = beforePincode.match(/,\s*([A-Z][A-Z\s]+?|[A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)(?:\s+SADAR)?\s*,?\s*$/i);
        if (cityMatch) {
            result.city = cityMatch[1].trim();
        }
    }

    // Clean address (remove duplicates, extra commas)
    fullAddress = fullAddress
        .replace(/,\s*,/g, ', ')
        .replace(/\s*,\s*/g, ', ')
        .replace(/\s+/g, ' ')
        .replace(/^,\s*/, '')
        .replace(/,\s*$/, '')
        .trim();

    result.address = fullAddress;

    return result;
}

/**
 * Filter text to keep only English characters, numbers, and common punctuation
 */
function filterEnglishOnly(text) {
    if (!text) return '';
    
    // Keep only English letters, numbers, spaces, and common punctuation
    return text
        .replace(/[^\x00-\x7F]+/g, ' ')  // Remove non-ASCII characters
        .replace(/\s+/g, ' ')              // Normalize spaces
        .replace(/,\s*,/g, ', ')           // Remove duplicate commas
        .replace(/\s*,\s*/g, ', ')         // Normalize comma spacing
        .trim();
}
/**
 * Extract ERO (Electoral Registration Officer) from any line in the document
 */
function extractERO(lines) {
    for (const line of lines) {
        // Match "ERO - Name" or "Electoral Registration Officer, Name"
        const eroMatch = line.match(/(?:ERO\s*[-:]\s*|Electoral\s+Registration\s+Officer[,:]\s*)(.+)/i);
        if (eroMatch) {
            return filterEnglishOnly(eroMatch[1].trim());
        }
    }
    return null;
}

/**
 * Clean name that has location details appended (Karnataka format issue)
 * Returns { cleanName, locationPart }
 */
function cleanNameFromLocation(name, lines) {
    // Find the full Name line to check for location details
    const nameLine = lines.find(line => /^Name\s*:/i.test(line) && line.includes(name));
    if (!nameLine) {
        return { cleanName: name, locationPart: null };
    }

    const fullValue = getValuePortion(nameLine);
    if (!fullValue) {
        return { cleanName: name, locationPart: null };
    }

    // Check if full value contains location keywords (city, state, pincode pattern)
    const hasLocation = /,\s*[A-Z][a-z]+,\s*[A-Z][a-z\s]+[-]\d{6}|,\s*\d{6}/.test(fullValue);
    if (!hasLocation) {
        return { cleanName: name, locationPart: null };
    }

    // Split by common Indian city names or state names
    const locationMatch = fullValue.match(/^(.+?)\s+(Mysore|Bangalore|Mumbai|Delhi|Chennai|Kolkata|Hyderabad|Pune|Ahmedabad|Surat|Lucknow|Jaipur|[A-Z][a-z]+,\s*[A-Z][a-z\s]+[-]\d{6})/);
    if (locationMatch) {
        const cleanName = filterEnglishOnly(locationMatch[1].trim());
        const locationPart = filterEnglishOnly(locationMatch[2].trim() + (fullValue.substring(locationMatch[0].length) || ''));
        return { cleanName, locationPart };
    }

    return { cleanName: name, locationPart: null };
}

/**
 * Extract location details (city, state, pincode) from text
 */
function extractLocationFromText(text) {
    const result = { city: null, state: null, pincode: null };
    
    if (!text) return result;

    // Extract pincode
    const pincodeMatch = text.match(/(\d{6})/);
    if (pincodeMatch) {
        result.pincode = pincodeMatch[1];
    }

    // Extract state
    const stateMatch = text.match(/(Maharashtra|Karnataka|Tamil Nadu|Kerala|Gujarat|Rajasthan|Punjab|Haryana|Uttar Pradesh|Madhya Pradesh|Bihar|West Bengal|Andhra Pradesh|Telangana|Odisha|Assam|Jharkhand|Chhattisgarh|Uttarakhand|Himachal Pradesh|Tripura|Meghalaya|Manipur|Nagaland|Goa|Arunachal Pradesh|Mizoram|Sikkim|Delhi|Puducherry|Chandigarh|Jammu and Kashmir|Ladakh)/i);
    if (stateMatch) {
        result.state = stateMatch[1];
    }

    // Extract city - look for word before state or pincode
    if (result.state) {
        const beforeState = text.split(result.state)[0];
        const cityMatch = beforeState.match(/,?\s*([A-Z][A-Za-z\s]+?)(?:\s+SADAR)?\s*,?\s*$/i);
        if (cityMatch) {
            result.city = cityMatch[1].trim();
        }
    } else if (result.pincode) {
        const beforePincode = text.split(result.pincode)[0];
        const cityMatch = beforePincode.match(/,?\s*([A-Z][A-Za-z\s]+?)(?:\s+SADAR)?\s*,?\s*$/i);
        if (cityMatch) {
            result.city = cityMatch[1].trim();
        }
    }

    return result;
}