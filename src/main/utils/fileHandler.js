import multer from 'multer';
import path from 'path';
import fs from 'fs';

const uploadDir = 'uploads';
const imageDir = 'images';

if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir);
}
if (!fs.existsSync(imageDir)) {
    fs.mkdirSync(imageDir);
}

const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, uploadDir);
    },
    filename: (req, file, cb) => {
        cb(null, `${Date.now()}-${file.originalname}`);
    },
});

const fileFilter = (req, file, cb) => {
    if (file.mimetype === 'application/pdf') {
        cb(null, true);
    } else {
        cb(new Error('Only PDF files are allowed!'), false);
    }
};

export const upload = multer({
    storage,
    fileFilter,
    limits: { fileSize: 10 * 1024 * 1024 },
});
