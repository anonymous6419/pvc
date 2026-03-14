/**
 * ================================
 * PAN TEXT PARSER (HELPER)
 * ================================
 * Extracts PAN Number, Name, Father's Name, DOB
 */
export function parsePanText(text) {
    console.log('[PAN PARSER] Parsing text started');

    const fields = {
        panNumber: null,
        name: null,
        fatherName: null,
        dob: null,
    };

    // 1️⃣ PAN Number (ABCDE1234F)
    const panMatch = text.match(/[A-Z]{5}[0-9]{4}[A-Z]/);
    if (panMatch) {
        fields.panNumber = panMatch[0];
        console.log('[PAN PARSER] PAN number found:', fields.panNumber);
    }

    // 2️⃣ Date of Birth
    const dobMatch = text.match(/\d{2}\/\d{2}\/\d{4}/);
    if (dobMatch) {
        fields.dob = dobMatch[0];
        console.log('[PAN PARSER] DOB found:', fields.dob);
    }

    // 3️⃣ Line-based name detection
    const lines = text
        .split('\n')
        .map(l => l.trim())
        .filter(Boolean);

    console.log('[PAN PARSER] Total text lines:', lines.length);

    // Find index of "INCOME TAX DEPARTMENT"
    const incomeTaxIdx = lines.findIndex(l =>
        /INCOME TAX DEPARTMENT/i.test(l)
    );

    const startIdx = incomeTaxIdx !== -1 ? incomeTaxIdx + 1 : 0;

    const potentialNames = lines
        .slice(startIdx, startIdx + 10)
        .filter(l =>
            /^[A-Z\s]+$/.test(l) &&
            l.length > 3 &&
            !/INCOME TAX|DEPARTMENT|INDIA|GOVT|PERMANENT/i.test(l)
        );

    if (potentialNames[0]) {
        fields.name = potentialNames[0];
        console.log('[PAN PARSER] Name detected:', fields.name);
    }

    if (potentialNames[1]) {
        fields.fatherName = potentialNames[1];
        console.log('[PAN PARSER] Father name detected:', fields.fatherName);
    }

    console.log('[PAN PARSER] Parsing completed');
    return { fields };
}
