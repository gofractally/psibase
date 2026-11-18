export interface PreparedImage {
    contentType: string;
    content: Uint8Array<ArrayBuffer>;
}

/**
 * How a non-square source becomes a square, using CSS `object-fit` names:
 * - `cover`: scale to fill the square and crop the overflow, centered
 * - `contain`: scale to fit inside the square and pad with transparency
 * - `fill`: stretch to the square, ignoring the aspect ratio
 */
export type ImageFit = "cover" | "contain" | "fill";

/** A region of the source image, as fractions of its width and height */
export interface ImageCrop {
    x: number;
    y: number;
    width: number;
    height: number;
}

export interface PrepareImageOptions {
    /** Largest encoded size, in bytes */
    maxBytes: number;
    /** Largest width and height, in pixels. Raster sources are not upscaled. */
    maxDimension: number;
    /** Defaults to `cover` */
    fit?: ImageFit;
    /** The region of the source to keep, before fitting. Defaults to the whole image. */
    crop?: ImageCrop;
}

const FULL_IMAGE: ImageCrop = { x: 0, y: 0, width: 1, height: 1 };

export const TOKEN_ICON_OPTIONS: PrepareImageOptions = {
    maxBytes: 32 * 1024,
    maxDimension: 256,
    fit: "cover",
};

export const NETWORK_LOGO_OPTIONS: PrepareImageOptions = {
    maxBytes: 32 * 1024,
    maxDimension: 256,
    fit: "cover",
};

export const AVATAR_OPTIONS: PrepareImageOptions = {
    maxBytes: 100 * 1024,
    maxDimension: 512,
    fit: "cover",
};

const WEBP_QUALITIES = [0.85, 0.75, 0.6];
const JPEG_QUALITY = 0.85;
/** Fallback sizes, as fractions of the first attempt's size */
const FALLBACK_SCALES = [0.75, 0.5];

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
export const loadImage = async (source: Blob) => {
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
    fit: ImageFit,
    isVector: boolean,
    crop: ImageCrop,
) => {
    // SVGs without intrinsic dimensions report 0 (or the 150px default)
    const width = (img.naturalWidth || maxDimension) * crop.width;
    const height = (img.naturalHeight || maxDimension) * crop.height;

    // The source length that maps onto the square's side
    const governing =
        fit === "cover" ? Math.min(width, height) : Math.max(width, height);
    const side = Math.max(
        1,
        Math.round(isVector ? maxDimension : Math.min(maxDimension, governing)),
    );

    const canvas = document.createElement("canvas");
    canvas.width = side;
    canvas.height = side;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Canvas is not supported");

    // Draws the whole image, placed so the crop region lands on the given
    // rect, and lets the canvas clip the rest. The 9-argument drawImage would
    // need source coordinates, which SVGs without intrinsic dimensions lack.
    const drawCrop = (x: number, y: number, w: number, h: number) => {
        const fullWidth = w / crop.width;
        const fullHeight = h / crop.height;
        ctx.drawImage(
            img,
            x - crop.x * fullWidth,
            y - crop.y * fullHeight,
            fullWidth,
            fullHeight,
        );
    };

    if (fit === "fill") {
        drawCrop(0, 0, side, side);
    } else {
        const scale = side / governing;
        const w = width * scale;
        const h = height * scale;
        drawCrop((side - w) / 2, (side - h) / 2, w, h);
    }
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
    { maxDimension, fit = "cover", crop = FULL_IMAGE }: PrepareImageOptions,
): AsyncGenerator<Blob> {
    const { canvas, ctx } = draw(img, maxDimension, fit, isVector, crop);

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

    for (const scale of FALLBACK_SCALES) {
        const dimension = Math.round(canvas.width * scale);
        if (dimension < 1) continue;
        const smaller = draw(img, dimension, fit, isVector, crop).canvas;
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
 * GIFs keep their first frame.
 */
export const prepareImage = async (
    source: Blob,
    options: PrepareImageOptions,
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
