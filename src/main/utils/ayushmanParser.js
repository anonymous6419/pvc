/**
 * ==============================
 * AYUSHMAN TEXT PARSER
 * ==============================
 */
export function parseAyushmanText(text) {
    const fields = {
        name: null,
        ayushmanNumber: null,
        pmjayId: null,
        yob: null,
        village: null,
        block: null,
        district: null,
    };

    if (!text || !text.trim()) return { fields };

    const lines = text
        .split('\n')
        .map(l => l.trim())
        .filter(l => l.length > 0);

    // Ayushman Number
    const ayushmanMatch = text.match(/\b91-\d{4}-\d{4}-\d{4}\b/);
    if (ayushmanMatch) fields.ayushmanNumber = ayushmanMatch[0];

    // PM-JAY ID: 8-10 uppercase alphanumerics
    const pmjayLine = lines.find(l => /^[A-Z0-9]{8,10}$/.test(l));
    if (pmjayLine) fields.pmjayId = pmjayLine;

    // YOB: 4-digit number
    const yobLine = lines.find(l => /^\d{4}$/.test(l));
    if (yobLine) fields.yob = yobLine;

    // Name: last line with letters only
    const nameLine = lines.slice().reverse().find(l =>
        /^[A-Za-z\s]+$/.test(l) &&
        !/CARD|M|F|Ayushman|PMJAY|Income Tax|Generated/i.test(l)
    );
    if (nameLine) fields.name = nameLine;

    // Village / Block / District: first line above name with >=3 words
    const nameIndex = lines.indexOf(nameLine);
    for (let i = nameIndex - 1; i >= 0; i--) {
        const line = lines[i];
        if (/^[A-Za-z\s]+$/.test(line) && line.trim().split(' ').length >= 3) {
            const parts = line.trim().split(' ');
            fields.village = parts[0];             // first word
            fields.block = parts[1];               // second word
            fields.district = parts.slice(2).join(' '); // remaining words
            break;
        }
    }

    return { fields };
}
