import { parseEShramText } from './eshramParser.js';
import { performEnhancedOCR } from './enhancedOCR.js';
import { Jimp } from 'jimp';
import path from 'path';
import fs from 'fs';

/**
 * Enhanced E-Shram parser with occupation and name region OCR
 */
export async function parseEShramEnhanced(text, { frontPath, outputDir } = {}) {
    console.log('\n' + '='.repeat(60));
    console.log('🎯 E-SHRAM ENHANCED PARSER');
    console.log('='.repeat(60));
    
    // Parse main text
    let parsedData = parseEShramText(text);
    
    // If name looks incomplete (too short or clearly truncated) and region data available, try enhanced OCR
    const nameIsIncomplete = !parsedData.name || parsedData.name.length < 3 || parsedData.name === 'N/A';
    
    if (nameIsIncomplete && frontPath && outputDir) {
        try {
            console.log("\n🔍 Additional: Re-scanning name area with enhanced OCR...");
            console.log(`   Current name: "${parsedData.name || 'N/A'}" - attempting to improve...`);
            const fImg = await Jimp.read(frontPath);
            
            // Extract name region (upper portion, below header)
            const nameBox = {
                x: Math.floor(fImg.bitmap.width * 0.0),
                y: Math.floor(fImg.bitmap.height * 0.15),
                w: Math.floor(fImg.bitmap.width * 1.0),
                h: Math.floor(fImg.bitmap.height * 0.25)
            };
            
            const namePath = path.join(outputDir, "name-region.png");
            const nameImage = fImg
                .crop(nameBox)
                .contrast(0.6)
                .greyscale();
            await nameImage.write(namePath);
            
            console.log("📸 Scanning name region from image...");
            const nameResult = await performEnhancedOCR(namePath, "eng+hin", outputDir, 'name-enh', {
                charWhitelist: 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz '
            });
            const nameText = nameResult.text;
            
            console.log("📄 Name region OCR result:", nameText);

            // Extract full name - look for capitalized words before "पिता" or "Father"
            const nameLines = nameText.split('\n').map(l => l.trim()).filter(l => l.length > 0);
            
            // Strategy 1: Look for multi-word capitalized names
            for (const line of nameLines) {
                const skipKeywords = /eShram|Card|MINISTRY|GOVT|INDIA|भारत|पिता|Father|Fates/i;
                if (line.match(/^[A-Z][a-z]+(\s+[A-Z][a-z]+)+$/) && !skipKeywords.test(line)) {
                    parsedData.name = line;
                    console.log("✅ Enhanced name extraction (multi-word):", line);
                    break;
                }
            }
            
            // Strategy 2: If no multi-word name, accept single word names that are at least 4 chars
            if (!parsedData.name) {
                for (const line of nameLines) {
                    const skipKeywords = /eShram|Card|MINISTRY|GOVT|INDIA|भारत|पिता|Father|Fates|Name|नाम/i;
                    if (line.match(/^[A-Z][a-z]{3,}$/) && !skipKeywords.test(line)) {
                        parsedData.name = line;
                        console.log("✅ Enhanced name extraction (single-word):", line);
                        break;
                    }
                }
            }
        } catch (err) {
            console.warn("⚠️ Name region OCR failed:", err.message);
        }
    }
    
    // If occupation is still null and we have front card image, do enhanced OCR on occupation region
    // IMPORTANT: Occupation is on BACK card, not front!
    if (!parsedData.occupation && frontPath && outputDir) {
        try {
            console.log("\n🔍 Additional: Re-scanning occupation area with enhanced OCR...");
            
            // Try to use back card if it exists, otherwise fall back to front
            const backCardPath = frontPath.replace('front.png', 'back.png');
            const occCardPath = fs.existsSync(backCardPath) ? backCardPath : frontPath;
            console.log(`   Using card: ${occCardPath.includes('back') ? 'BACK' : 'FRONT'}`);
            
            const fImgForOcc = await Jimp.read(occCardPath);
            
            // Extract top-middle section where occupation usually appears
            const occupationBox = {
                x: Math.floor(fImgForOcc.bitmap.width * 0.05),
                y: Math.floor(fImgForOcc.bitmap.height * 0.15),
                w: Math.floor(fImgForOcc.bitmap.width * 0.90),
                h: Math.floor(fImgForOcc.bitmap.height * 0.40)
            };
            
            const occPath = path.join(outputDir, "occupation-region.png");
            const occImage = fImgForOcc
                .crop(occupationBox)
                .contrast(0.5)
                .greyscale();
            await occImage.write(occPath);
            
            console.log("📸 Scanning occupation region from image...");
            const occResult = await performEnhancedOCR(occPath, "eng+hin", outputDir, 'occ-enh', {
                charWhitelist: 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz, ()-/।'
            });
            const occText = occResult.text;
            
            console.log("📄 Occupation region OCR result:", occText);

            // Try to extract occupation from enhanced OCR - use keyword-based approach
            if (occText && occText.length > 3) {
                const occupationKeywords = [
                    'Laborer', 'Labourer', 'Worker', 'Driver', 'Carpenter', 'Electrician', 
                    'Plumber', 'Mason', 'Painter', 'Welder', 'Mechanic', 'Tailor',
                    'Farmer', 'Agriculture', 'Construction', 'Helper', 'Cleaner', 'Guard',
                    'Vendor', 'Seller', 'Cook', 'Waiter', 'Shop', 'Factory'
                ];
                
                // First try keyword matching
                let found = false;
                for (const keyword of occupationKeywords) {
                    if (new RegExp(keyword, 'i').test(occText)) {
                        const regex = new RegExp(`(${keyword}[a-z\\s]*(?:worker|labour|labourer|work)?)`, 'gi');
                        const match = occText.match(regex);
                        if (match && !/Father|Fates|पिता|Name|नाम/i.test(match[0])) {
                            parsedData.occupation = match[0].trim();
                            console.log("✅ Enhanced occupation extracted (keyword):", parsedData.occupation);
                            found = true;
                            break;
                        }
                    }
                }
                
                // If keyword approach fails, try generic extraction
                if (!found) {
                    let occupation = occText
                        .replace(/Occupation|Occ\.|Primary|पाय|व्यवसाय|व्यवसाये|दि\s*\|/gi, '')
                        .trim();
                    
                    const lines = occupation.split('\n');
                    occupation = lines[0].trim();
                    
                    // Very strict: reject if contains father/name keywords
                    if (occupation && occupation.length > 2 && !/Father|Fates|पिता|Name|नाम|Hame|का|दी/i.test(occupation)) {
                        parsedData.occupation = occupation;
                        console.log("✅ Enhanced occupation extracted (generic):", parsedData.occupation);
                    } else {
                        console.log("⚠️ Rejected enhanced occupation (contains father/name keywords):", occupation);
                    }
                }
            }
        } catch (err) {
            console.warn("⚠️ Enhanced occupation OCR failed:", err.message);
        }
    }
    
    // If father name is missing and we have front card image
    if (!parsedData.fatherName && frontPath && outputDir) {
        try {
            console.log("\n🔍 Additional: Re-scanning father name area with enhanced OCR...");
            const fImgForFather = await Jimp.read(frontPath);
            
            // Extract upper-middle portion where father name typically appears
            const fatherBox = {
                x: Math.floor(fImgForFather.bitmap.width * 0.0),
                y: Math.floor(fImgForFather.bitmap.height * 0.20),
                w: Math.floor(fImgForFather.bitmap.width * 1.0),
                h: Math.floor(fImgForFather.bitmap.height * 0.25)
            };
            
            const fatherPath = path.join(outputDir, "father-region.png");
            const fatherImage = fImgForFather
                .crop(fatherBox)
                .contrast(0.6)
                .greyscale();
            await fatherImage.write(fatherPath);
            
            console.log("📸 Scanning father name region...");
            const fatherResult = await performEnhancedOCR(fatherPath, "eng+hin", outputDir, 'father-enh');
            const fatherText = fatherResult.text;
            
            console.log("📄 Father name region OCR result:", fatherText);

            // Extract father's name - look for pattern after "Father" or "पिता"
            const fatherLines = fatherText.split('\n').map(l => l.trim()).filter(l => l.length > 0);
            for (const line of fatherLines) {
                if (/पिता|Father/i.test(line)) {
                    const match = line.match(/(?:पिता|Father)[^A-Za-z]*([A-Z][a-z]+(?:\s+[a-z]+)+)/i);
                    if (match) {
                        parsedData.fatherName = match[1].trim();
                        console.log("✅ Enhanced father name extraction:", parsedData.fatherName);
                        break;
                    }
                }
            }
        } catch (err) {
            console.warn("⚠️ Father name region OCR failed:", err.message);
        }
    }
    
    // If DOB is missing and we have front card image
    if (!parsedData.dob && frontPath && outputDir) {
        try {
            console.log("\n🔍 Additional: Re-scanning DOB area with enhanced OCR...");
            const fImgForDob = await Jimp.read(frontPath);
            
            // Extract middle section where DOB typically appears
            const dobBox = {
                x: Math.floor(fImgForDob.bitmap.width * 0.0),
                y: Math.floor(fImgForDob.bitmap.width * 0.35),
                w: Math.floor(fImgForDob.bitmap.width * 1.0),
                h: Math.floor(fImgForDob.bitmap.height * 0.25)
            };
            
            const dobPath = path.join(outputDir, "dob-region.png");
            const dobImage = fImgForDob
                .crop(dobBox)
                .contrast(0.6)
                .greyscale();
            await dobImage.write(dobPath);
            
            console.log("📸 Scanning DOB region...");
            const dobResult = await performEnhancedOCR(dobPath, "eng", outputDir, 'dob-enh', {
                charWhitelist: '0123456789/-. DOBDateofBirth'
            });
            const dobText = dobResult.text;
            
            console.log("📄 DOB region OCR result:", dobText);

            // Extract DOB - look for DD/MM/YYYY or DD-MM-YYYY pattern
            const dobMatch = dobText.match(/(\d{1,2})[\s\/\-](\d{1,2})[\s\/\-](\d{4})/);
            if (dobMatch) {
                const day = dobMatch[1].padStart(2, '0');
                const month = dobMatch[2].padStart(2, '0');
                const year = dobMatch[3];
                
                // Validate date
                if (parseInt(day) <= 31 && parseInt(month) <= 12 && parseInt(year) >= 1950 && parseInt(year) <= 2010) {
                    parsedData.dob = `${day}/${month}/${year}`;
                    console.log("✅ Enhanced DOB extraction:", parsedData.dob);
                }
            }
        } catch (err) {
            console.warn("⚠️ DOB region OCR failed:", err.message);
        }
    }
    
    // If gender is missing and we have front card image
    if (!parsedData.gender && frontPath && outputDir) {
        try {
            console.log("\n🔍 Additional: Re-scanning gender area with enhanced OCR...");
            const fImgForGender = await Jimp.read(frontPath);
            
            // Extract middle section where gender typically appears
            const genderBox = {
                x: Math.floor(fImgForGender.bitmap.width * 0.0),
                y: Math.floor(fImgForGender.bitmap.height * 0.45),
                w: Math.floor(fImgForGender.bitmap.width * 1.0),
                h: Math.floor(fImgForGender.bitmap.height * 0.20)
            };
            
            const genderPath = path.join(outputDir, "gender-region.png");
            const genderImage = fImgForGender
                .crop(genderBox)
                .contrast(0.6)
                .greyscale();
            await genderImage.write(genderPath);
            
            console.log("📸 Scanning gender region...");
            const genderResult = await performEnhancedOCR(genderPath, "eng+hin", outputDir, 'gender-enh');
            const genderText = genderResult.text;
            
            console.log("📄 Gender region OCR result:", genderText);

            // Extract gender - look for M/F/Male/Female
            const genderMatch = genderText.match(/(?:Gender|लिंग|Sex)[:\s\/]*(M|F|Male|Female|पुरुष|महिला)/i);
            if (genderMatch) {
                const g = genderMatch[1].toLowerCase();
                if (g === 'm' || g === 'male' || g === 'पुरुष') parsedData.gender = 'Male';
                else if (g === 'f' || g === 'female' || g === 'महिला') parsedData.gender = 'Female';
                console.log("✅ Enhanced gender extraction:", parsedData.gender);
            }
        } catch (err) {
            console.warn("⚠️ Gender region OCR failed:", err.message);
        }
    }
    
    // If blood group is missing and we have back card image (blood group is on back)
    if (!parsedData.bloodGroup && frontPath && outputDir) {
        try {
            console.log("\n🔍 Additional: Re-scanning blood group area with enhanced OCR...");
            // Use frontPath but if there's a back card, use that instead
            const backCardPath = frontPath.replace('front.png', 'back.png');
            const bloodCardPath = fs.existsSync(backCardPath) ? backCardPath : frontPath;
            
            const fImgForBlood = await Jimp.read(bloodCardPath);
            
            // Extract top-middle section of back card where blood group typically appears
            const bloodBox = {
                x: Math.floor(fImgForBlood.bitmap.width * 0.0),
                y: Math.floor(fImgForBlood.bitmap.height * 0.10),
                w: Math.floor(fImgForBlood.bitmap.width * 1.0),
                h: Math.floor(fImgForBlood.bitmap.height * 0.30)
            };
            
            const bloodPath = path.join(outputDir, "blood-region.png");
            const bloodImage = fImgForBlood
                .crop(bloodBox)
                .contrast(0.7)
                .greyscale();
            await bloodImage.write(bloodPath);
            
            console.log("📸 Scanning blood group region...");
            const bloodResult = await performEnhancedOCR(bloodPath, "eng+hin", outputDir, 'blood-enh', {
                charWhitelist: 'ABOab+-BloodGrupoव्रक्त'
            });
            const bloodText = bloodResult.text;
            
            console.log("📄 Blood group region OCR result:", bloodText);

            // Extract blood group
            const bloodMatch = bloodText.match(/Blood\s*Gro[uwp]*[:\s]*([ABO]+[+-]?)/i);
            if (bloodMatch) {
                const bg = bloodMatch[1].toUpperCase().replace(/[^ABO+-]/g, '');
                if (bg && /^[ABO]+[+-]?$/.test(bg)) {
                    parsedData.bloodGroup = bg;
                    console.log("✅ Enhanced blood group extraction:", parsedData.bloodGroup);
                }
            }
        } catch (err) {
            console.warn("⚠️ Blood group region OCR failed:", err.message);
        }
    }
    
    // If contact number is missing and we have back card image
    if (!parsedData.contactNumber && frontPath && outputDir) {
        try {
            console.log("\n🔍 Additional: Re-scanning contact number area with enhanced OCR...");
            const backCardPath = frontPath.replace('front.png', 'back.png');
            const contactCardPath = fs.existsSync(backCardPath) ? backCardPath : frontPath;
            
            const fImgForContact = await Jimp.read(contactCardPath);
            
            // Extract bottom section where contact usually appears
            const contactBox = {
                x: Math.floor(fImgForContact.bitmap.width * 0.0),
                y: Math.floor(fImgForContact.bitmap.height * 0.60),
                w: Math.floor(fImgForContact.bitmap.width * 1.0),
                h: Math.floor(fImgForContact.bitmap.height * 0.35)
            };
            
            const contactPath = path.join(outputDir, "contact-region.png");
            const contactImage = fImgForContact
                .crop(contactBox)
                .contrast(0.7)
                .greyscale();
            await contactImage.write(contactPath);
            
            console.log("📸 Scanning contact number region...");
            const contactResult = await performEnhancedOCR(contactPath, "eng", outputDir, 'contact-enh', {
                charWhitelist: '0123456789 .-ContactMobilePhoneNumber'
            });
            const contactText = contactResult.text;
            
            console.log("📄 Contact region OCR result:", contactText);

            // Extract 10-digit phone number
            const digitMatch = contactText.match(/(\d[\s\.\-]*\d[\s\.\-]*\d[\s\.\-]*\d[\s\.\-]*\d[\s\.\-]*\d[\s\.\-]*\d[\s\.\-]*\d[\s\.\-]*\d[\s\.\-]*\d)/);
            if (digitMatch) {
                const digits = digitMatch[1].replace(/[\s\.\-]/g, '');
                if (digits.length === 10) {
                    parsedData.contactNumber = digits;
                    console.log("✅ Enhanced contact extraction:", parsedData.contactNumber);
                }
            }
        } catch (err) {
            console.warn("⚠️ Contact number region OCR failed:", err.message);
        }
    }
    
    // If address is missing and we have back card image
    if (!parsedData.address && frontPath && outputDir) {
        try {
            console.log("\n🔍 Additional: Re-scanning address area with enhanced OCR...");
            const backCardPath = frontPath.replace('front.png', 'back.png');
            const addressCardPath = fs.existsSync(backCardPath) ? backCardPath : frontPath;
            
            const fImgForAddress = await Jimp.read(addressCardPath);
            
            // Extract middle-bottom section where address usually appears
            const addressBox = {
                x: Math.floor(fImgForAddress.bitmap.width * 0.0),
                y: Math.floor(fImgForAddress.bitmap.height * 0.40),
                w: Math.floor(fImgForAddress.bitmap.width * 1.0),
                h: Math.floor(fImgForAddress.bitmap.height * 0.40)
            };
            
            const addressPath = path.join(outputDir, "address-region.png");
            const addressImage = fImgForAddress
                .crop(addressBox)
                .contrast(0.6)
                .greyscale();
            await addressImage.write(addressPath);
            
            console.log("📸 Scanning address region...");
            const addressResult = await performEnhancedOCR(addressPath, "eng+hin", outputDir, 'address-enh');
            const addressText = addressResult.text;
            
            console.log("📄 Address region OCR result:", addressText);

            // Extract address - look for text after "Address" or "Current Address"
            const addressMatch = addressText.match(/(?:Current\s*Address|Address)[:\s]*([^]+?)(?=Contact|Mobile|Phone|Emergency|$)/i);
            if (addressMatch) {
                let addr = addressMatch[1]
                    .replace(/REIS|Silo|Bed/g, '')
                    .replace(/\s+/g, ' ')
                    .trim();
                
                if (addr && addr.length > 5) {
                    parsedData.address = addr;
                    console.log("✅ Enhanced address extraction:", parsedData.address.substring(0, 60) + '...');
                }
            } else {
                // Try to extract any multi-line text that looks like an address
                const lines = addressText.split('\n').map(l => l.trim()).filter(l => l.length > 5);
                if (lines.length >= 2) {
                    const addr = lines.slice(0, 3).join(', ');
                    if (addr.length > 10 && !/Contact|Mobile|Blood|Occupation/i.test(addr)) {
                        parsedData.address = addr;
                        console.log("✅ Enhanced address extraction (generic):", parsedData.address.substring(0, 60) + '...');
                    }
                }
            }
        } catch (err) {
            console.warn("⚠️ Address region OCR failed:", err.message);
        }
    }
    
    console.log('='.repeat(60) + '\n');
    return parsedData;
}
