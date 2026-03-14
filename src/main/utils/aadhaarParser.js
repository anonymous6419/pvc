/**
 * AADHAAR TEXT PARSING HELPER
 */
export function parseAadhaarText(text) {
  const fields = {
    aadhaarNumber: null,
    name: null,
    dob: null,
    gender: null,
    address: null,
    enrolmentNo: null,
  };

  /* Aadhaar Number */
  const aadhaarMatch = text.match(/\d{4}\s\d{4}\s\d{4}/);
  if (aadhaarMatch) fields.aadhaarNumber = aadhaarMatch[0];

  /* Enrolment Number */
  const enrolmentMatch = text.match(
    /(?:Enrolment|Enrollment|[\u0A80-\u0AFF\u0900-\u097F]+)[^0-9\n]*([\d/\s-]{14,})/i,
  );
  if (enrolmentMatch) {
    fields.enrolmentNo = enrolmentMatch[1].replace(/\s+/g, " ").trim();
  }

  /* Name Extraction */
  const nameToMatch = text.match(/To\s+(?:[^\n]+\n){1,2}\s*([A-Z][A-Za-z\s]{2,})\n\s*(?:C\/O|Address|S\/O)/i);
  if (nameToMatch) {
    fields.name = nameToMatch[1].trim();
  }

  if (!fields.name) {
    const lines = text.split('\n');
    const dobIndex = lines.findIndex(l => /DOB|Year of Birth|YOB|जन्म|જન્મ/i.test(l));
    if (dobIndex > 0) {
      const potentialName = lines[dobIndex - 1].split('  ')[0].trim();
      if (potentialName && potentialName.length > 3 && !/Address|To|Aadhaar|Details/i.test(potentialName)) {
        fields.name = potentialName;
      }
    }
  }

  if (!fields.name) {
    const nameMatch = text.match(/([A-Z][a-z]+\s[A-Z][a-z]+(?:\s[A-Z][a-z]+)?)/);
    if (nameMatch) {
      fields.name = nameMatch[1].trim();
    }
  }

  /* DOB / YOB */
  const dobMatch = text.match(
    /(?:DOB|Year of Birth|YOB|जन्म|જન્મ)[:\s/]*(\d{2}\/\d{2}\/\d{4}|\d{4})/i,
  );
  if (dobMatch) fields.dob = dobMatch[1];

  /* Gender */
  const genderMatch = text.match(
    /(MALE|FEMALE|TRANSGENDER|पुरुष|महिला|પુરૂષ|સ્ત્રી)/i,
  );
  if (genderMatch) {
    const g = genderMatch[0].toUpperCase();
    fields.gender =
      g === "पुरुष" || g === "પુરૂષ" ? "MALE" :
      g === "महिला" || g === "સ્ત્રી" ? "FEMALE" :
      g;
  }

  /* Address - Multiple strategies */
  
  // Strategy 1: Look for "Address:" or variations (Addr ess, Add ress, etc.)
  let addressMatch = text.match(
    /(?:Addr?\s*[e]?\s*ss?|Address|सरनामुું|पता)[:\s]*([\s\S]*?)(?=\n\s*(?:Issue Date|Download Date|VID|Enrolment|\d{4}\s\d{4}\s\d{4})|$)/i
  );
  
  if (addressMatch && addressMatch[1].trim().length > 10) {
    fields.address = addressMatch[1]
      .replace(/\s+/g, " ")
      .replace(/\n/g, " ")
      .trim()
      .replace(/,\s*,/g, ",") // Remove duplicate commas
      .replace(/\s*,\s*/g, ", "); // Normalize comma spacing
  }
  
  // Strategy 2: If address not found, look for S/O or C/O pattern (address usually follows)
  if (!fields.address) {
    const soMatch = text.match(
      /(?:S\/O|C\/O|D\/O|W\/O)[:\s]*([^,\n]+,?\s*(?:\d+\s+)?[^,\n]+[\s\S]*?)(?=\n\s*(?:DOB|MALE|FEMALE|Issue Date|Download Date|\d{4}\s\d{4}\s\d{4})|$)/i
    );
    
    if (soMatch && soMatch[1].trim().length > 10) {
      fields.address = soMatch[1]
        .replace(/\s+/g, " ")
        .replace(/\n/g, " ")
        .trim()
        .replace(/,\s*,/g, ",")
        .replace(/\s*,\s*/g, ", ");
    }
  }
  
  // Strategy 3: Extract multi-line address after name (common pattern)
  if (!fields.address && fields.name) {
    const lines = text.split('\n');
    const nameIndex = lines.findIndex(l => l.includes(fields.name));
    
    if (nameIndex >= 0 && nameIndex < lines.length - 3) {
      const addressLines = [];
      
      // Collect lines that look like address (contain numbers, locality names)
      for (let i = nameIndex + 1; i < Math.min(nameIndex + 10, lines.length); i++) {
        const line = lines[i].trim();
        
        // Stop at certain markers
        if (/^(?:DOB|MALE|FEMALE|Issue Date|Download Date|\d{4}\s\d{4}\s\d{4}|VID)/i.test(line)) {
          break;
        }
        
        // Add lines that look like address parts
        if (line.length > 2 && !/^To$|^Enrolment/i.test(line)) {
          addressLines.push(line);
        }
        
        // Stop if we have enough address content
        if (addressLines.join('').length > 50) {
          break;
        }
      }
      
      if (addressLines.length > 0) {
        fields.address = addressLines
          .join(', ')
          .replace(/\s+/g, " ")
          .replace(/,\s*,/g, ",")
          .replace(/\s*,\s*/g, ", ")
          .trim();
      }
    }
  }
  
  // Clean up address if found
  if (fields.address) {
    // Remove "Address:", "Addr ess:", and similar OCR errors from the beginning
    fields.address = fields.address.replace(/^(?:Addr?\s*[e]?\s*ss?|Address|सरनामुું|पता)[:\s]*/i, '');
    
    // Normalize S/O, C/O, D/O, W/O format (keep them, just clean spacing)
    fields.address = fields.address.replace(/\b(S\/O|C\/O|D\/O|W\/O)\s*:\s*/g, '$1, ');
    
    // Ensure proper capitalization and formatting
    fields.address = fields.address
      .replace(/,\s*,/g, ", ")
      .replace(/\s*,\s*/g, ", ")
      .replace(/\s+/g, " ")
      .trim();
    
    // If address is too short or seems invalid, set to null
    if (fields.address.length < 10 || /^[,\s.-]+$/.test(fields.address)) {
      fields.address = null;
    }
  }

  return { fields };
}
