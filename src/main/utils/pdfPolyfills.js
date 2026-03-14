import { pathToFileURL } from 'url';
import { createCanvas, Image, ImageData, Canvas } from '@napi-rs/canvas';

// Apply globals BEFORE any other imports to ensure they are captured by libraries
global.Canvas = Canvas;
global.Image = Image;
global.ImageData = ImageData;

// Map HTML classes for internal PDF.js instanceof checks
global.HTMLCanvasElement = Canvas;
global.HTMLImageElement = Image;
global.HTMLElement = class HTMLElement {};
global.HTMLVideoElement = class HTMLVideoElement {};

// Mock window and navigator
if (!global.window) global.window = global;
if (!global.navigator) global.navigator = { userAgent: 'node' };
if (!global.location) global.location = { href: pathToFileURL(process.cwd() + '/').href };

// Mock DOM environment for PDF.js internals
if (!global.document) {
    global.document = {
        createElement: (tag) => {
            if (tag === 'canvas') {
                const canvas = createCanvas(1, 1);
                canvas.style = {};
                canvas.tagName = 'CANVAS';
                canvas.nodeName = 'CANVAS';
                canvas.nodeType = 1;
                // Essential properties for PDF.js internals
                canvas.contains = () => false;
                canvas.ownerDocument = global.document;
                canvas.addEventListener = () => {};
                canvas.removeEventListener = () => {};
                return canvas;
            }
            if (tag === 'img') {
                const img = new Image();
                img.style = {};
                img.tagName = 'IMG';
                img.nodeName = 'IMG';
                img.nodeType = 1;
                img.ownerDocument = global.document;
                img.addEventListener = () => {};
                img.removeEventListener = () => {};
                return img;
            }
            return {
                style: {},
                tagName: tag.toUpperCase(),
                nodeName: tag.toUpperCase(),
                nodeType: 1,
                onpageshow: null,
                contains: () => false,
                ownerDocument: global.document,
                getElementsByTagName: () => [],
                addEventListener: () => {},
                removeEventListener: () => {},
            };
        },
        createElementNS: (_, tag) => global.document.createElement(tag),
        documentElement: { style: {} },
        body: { style: {} },
        // Added to support some internal pdf.js checks
        nodeType: 9 
    };
}

// Disable Path2D for PDF.js to force it to use fallback drawing commands
// node-canvas does not support Path2D and it can cause crashes if PDF.js tries to use it.
delete global.Path2D;

// Force PDF.js to use our Canvas/Image polyfills by disabling potentially broken native-like features in Node
delete global.OffscreenCanvas;

// Polyfills for Base64 (needed by some PDF functions)
if (!global.btoa) global.btoa = (str) => Buffer.from(str, 'binary').toString('base64');
if (!global.atob) global.atob = (str) => Buffer.from(str, 'base64').toString('binary');

// Mock requestAnimationFrame
if (!global.requestAnimationFrame) {
    global.requestAnimationFrame = (callback) => setTimeout(callback, 0);
}

// Support for Blob and URL (needed by some newer PDF.js features)
if (!global.Blob) {
    global.Blob = class Blob {
        constructor(parts, options) {
            this.parts = parts || [];
            this.options = options || {};
            this.size = this.parts.reduce((acc, part) => acc + (part.length || 0), 0);
        }
    };
}
if (!global.URL) global.URL = {};
    
global.URL.createObjectURL = (obj) => {
    if (obj instanceof global.Blob) {
        try {
            // console.log(`Polyfill: converting Blob type ${obj.options.type} size ${obj.size} to Data URL`);
            // Combine parts into a single buffer
            const buffers = obj.parts.map(p => {
                if (typeof p === 'string') return Buffer.from(p);
                if (ArrayBuffer.isView(p)) return Buffer.from(p.buffer, p.byteOffset, p.byteLength);
                if (p instanceof ArrayBuffer) return Buffer.from(p);
                return Buffer.from([]);
            });
            const concatenated = Buffer.concat(buffers);
            const type = obj.options.type || 'application/octet-stream';
            return `data:${type};base64,${concatenated.toString('base64')}`;
        } catch (err) {
            console.warn('Polyfill createObjectURL failed:', err);
            return '';
        }
    }
    return '';
};

global.URL.revokeObjectURL = () => {};

export { createCanvas, Image, ImageData, Canvas };
