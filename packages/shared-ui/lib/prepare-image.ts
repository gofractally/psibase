export interface PreparedImage {
    contentType: string;
    content: Uint8Array;
}

export interface PrepareImageOptions {
    /** Largest encoded size, in bytes */
    maxBytes: number;
    /** Largest width and height, in pixels. Smaller images are not upscaled. */
    maxDimension: number;
}

export const TOKEN_ICON_OPTIONS: PrepareImageOptions = {
    maxBytes: 32 * 1024,
    maxDimension: 256,
};

const WEBP_QUALITIES = [0.85, 0.75, 0.6];
const JPEG_QUALITY = 0.85;
const FALLBACK_DIMENSIONS = [192, 128];

export class ImageTooLargeError extends Error {
    constructor(maxBytes: number) {
        super(
            `Couldn't fit this image in ${Math.round(maxBytes / 1024)} KB. Try a simpler image.`,
        );
        this.name = "ImageTooLargeError";
    }
}

// Load through a data: URL; the default CSP allows data: images but not blob:.
const readAsDataUrl = (source: Blob) =>
    new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as string);
        reader.onerror = () => reject(new Error("Couldn't read image file"));
        reader.readAsDataURL(source);
    });

// An <img> element rather than createImageBitmap, so SVG sources decode in every browser.
const loadImage = async (source: Blob) => {
    const url = await readAsDataUrl(source);
    return new Promise<HTMLImageElement>((resolve, reject) => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = () => reject(new Error("Couldn't decode image"));
        img.src = url;
    });
};

const draw = (
    img: HTMLImageElement,
    maxDimension: number,
    isVector: boolean,
) => {
    // SVGs without intrinsic dimensions report 0 (or the 150px default)
    const width = img.naturalWidth || maxDimension;
    const height = img.naturalHeight || maxDimension;
    const fit = maxDimension / Math.max(width, height);
    const scale = isVector ? fit : Math.min(1, fit);
    const w = Math.max(1, Math.round(width * scale));
    const h = Math.max(1, Math.round(height * scale));
    const side = Math.max(w, h);

    const canvas = document.createElement("canvas");
    canvas.width = side;
    canvas.height = side;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Canvas is not supported");
    ctx.drawImage(img, (side - w) / 2, (side - h) / 2, w, h);
    return { canvas, ctx };
};

const isOpaque = (ctx: CanvasRenderingContext2D) => {
    const { data } = ctx.getImageData(
        0,
        0,
        ctx.canvas.width,
        ctx.canvas.height,
    );
    for (let i = 3; i < data.length; i += 4) {
        if (data[i] !== 255) return false;
    }
    return true;
};

const encode = (canvas: HTMLCanvasElement, type: string, quality?: number) =>
    new Promise<Blob>((resolve, reject) =>
        canvas.toBlob(
            (blob) =>
                blob
                    ? resolve(blob)
                    : reject(new Error("Couldn't encode image")),
            type,
            quality,
        ),
    );

// Browsers without an encoder for `type` (e.g. Safari for WebP) silently return PNG.
async function* candidates(
    img: HTMLImageElement,
    isVector: boolean,
    { maxDimension }: PrepareImageOptions,
): AsyncGenerator<Blob> {
    const { canvas, ctx } = draw(img, maxDimension, isVector);

    const first = await encode(canvas, "image/webp", WEBP_QUALITIES[0]);
    yield first;
    const hasWebp = first.type === "image/webp";
    const opaque = isOpaque(ctx);

    if (hasWebp) {
        for (const quality of WEBP_QUALITIES.slice(1)) {
            yield await encode(canvas, "image/webp", quality);
        }
    } else if (opaque) {
        yield await encode(canvas, "image/jpeg", JPEG_QUALITY);
    }

    for (const dimension of FALLBACK_DIMENSIONS) {
        if (dimension >= canvas.width) continue;
        const smaller = draw(img, dimension, isVector).canvas;
        if (hasWebp) {
            yield await encode(
                smaller,
                "image/webp",
                WEBP_QUALITIES[WEBP_QUALITIES.length - 1],
            );
        } else if (opaque) {
            yield await encode(smaller, "image/jpeg", JPEG_QUALITY);
        } else {
            yield await encode(smaller, "image/png");
        }
    }
}

/**
 * Converts any browser-decodable image (PNG, JPEG, WebP, GIF, SVG, ...) into a
 * square PNG, JPEG, or WebP no larger than `maxDimension` and `maxBytes`.
 * Raster images are never upscaled; SVGs are rasterized at `maxDimension`.
 * Non-square images are padded with transparency; GIFs keep their first frame.
 */
export const prepareImage = async (
    source: Blob,
    options: PrepareImageOptions = TOKEN_ICON_OPTIONS,
): Promise<PreparedImage> => {
    const img = await loadImage(source);

    const isVector = source.type === "image/svg+xml";

    for await (const blob of candidates(img, isVector, options)) {
        if (blob.size <= options.maxBytes) {
            return {
                contentType: blob.type,
                content: new Uint8Array(await blob.arrayBuffer()),
            };
        }
    }

    throw new ImageTooLargeError(options.maxBytes);
};
