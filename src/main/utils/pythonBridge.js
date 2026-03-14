import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Execute a Python script and return the result
 * @param {string} scriptName - Name of the Python script (without .py)
 * @param {Array<string>} args - Arguments to pass to the script
 * @returns {Promise<Object>} - Parsed JSON result from Python script
 */
async function executePythonScript(scriptName, args) {
    return new Promise((resolve, reject) => {
        const scriptPath = path.join(process.cwd(), 'scripts', `${scriptName}.py`);
        const pythonBinary = resolvePythonBinary();
        const python = spawn(pythonBinary, [scriptPath, ...args]);

        let stdout = '';
        let stderr = '';

        python.stdout.on('data', (data) => {
            stdout += data.toString();
        });

        python.stderr.on('data', (data) => {
            stderr += data.toString();
        });

        python.on('close', (code) => {
            // Python scripts always output JSON to stdout, but logs may precede it.
            try {
                const result = parseJsonFromStdout(stdout);
                resolve(result);  // Let the caller handle success/failure
            } catch (err) {
                // If JSON parsing fails, return error
                reject(new Error(`Failed to parse Python output. Exit code: ${code}, stdout: ${stdout}, stderr: ${stderr}`));
            }
        });

        python.on('error', (err) => {
            reject(new Error(`Failed to spawn Python process: ${err.message}`));
        });
    });
}

function resolvePythonBinary() {
    const envPython = process.env.PYTHON_BIN || process.env.PYTHON_PATH;
    if (envPython) {
        return envPython;
    }

    const venvPath = process.platform === 'win32'
        ? path.join(process.cwd(), '.venv', 'Scripts', 'python.exe')
        : path.join(process.cwd(), '.venv', 'bin', 'python');

    if (fs.existsSync(venvPath)) {
        return venvPath;
    }

    return 'python';
}

function parseJsonFromStdout(stdout) {
    const trimmed = stdout.trim();
    if (!trimmed) {
        throw new Error('Empty stdout');
    }

    if (trimmed.startsWith('{')) {
        return JSON.parse(trimmed);
    }

    const lastBrace = trimmed.lastIndexOf('{');
    if (lastBrace === -1) {
        throw new Error('No JSON object found in stdout');
    }

    const jsonText = trimmed.slice(lastBrace);
    return JSON.parse(jsonText);
}

/**
 * Detect face in image using Python + OpenCV
 * @param {string} imagePath - Path to input image
 * @param {string} outputPath - Path to save cropped face image
 * @returns {Promise<Object>} - Result with success status and output path
 */
export async function detectFaceWithPython(imagePath, outputPath) {
    try {
        console.log('🐍 Calling Python face detector...');
        const result = await executePythonScript('face_detector', [imagePath, outputPath]);
        
        if (result.success) {
            console.log(`✅ Face detected and saved: ${result.path}`);
            console.log(`   📐 Face Size: ${result.bbox.width}x${result.bbox.height}px`);
            if (result.padding.horizontal) {
                console.log(`   📦 Padding: ${result.padding.horizontal}px sides, ${result.padding.top}px top, ${result.padding.bottom}px bottom (includes shoulders)`);
            }
        } else {
            console.log(`❌ Face detection failed: ${result.error}`);
        }
        
        return result;
    } catch (err) {
        console.error('❌ Python face detection error:', err.message);
        return { success: false, error: err.message };
    }
}

/**
 * Detect and decode QR code in image using Python + OpenCV
 * @param {string} imagePath - Path to input image
 * @param {string} outputPath - Path to save cropped QR image
 * @returns {Promise<Object>} - Result with success status, output path, and decoded data
 */
export async function detectQRWithPython(imagePath, outputPath) {
    try {
        console.log('🐍 Calling Python QR detector...');
        const result = await executePythonScript('qr_detector', [imagePath, outputPath]);
        
        if (result.success) {
            console.log(`✅ QR region saved: ${result.path}`);
            console.log(`   📦 Bbox: ${result.bbox.width}x${result.bbox.height}px with ${result.padding}px padding`);
            if (result.data) {
                console.log(`   📊 Data decoded: ${result.dataLength} characters`);
                console.log(`   📝 Preview: ${result.data.substring(0, 80)}${result.data.length > 80 ? '...' : ''}`);
            } else {
                console.log(`   ℹ️  QR image extracted but not decoded (may be too small or damaged)`);
                if (result.note) {
                    console.log(`   💡 Note: ${result.note}`);
                }
            }
        } else {
            console.log(`❌ QR detection failed: ${result.error}`);
        }
        
        return result;
    } catch (err) {
        console.error('❌ Python QR detection error:', err.message);
        return { success: false, error: err.message };
    }
}
