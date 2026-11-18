import type { ImageCrop } from "@shared/lib/prepare-image";

import { ZoomIn, ZoomOut } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { loadImage } from "@shared/lib/prepare-image";
import { Button } from "@shared/shadcn/ui/button";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@shared/shadcn/ui/dialog";
import { Skeleton } from "@shared/shadcn/ui/skeleton";

const MAX_ZOOM = 4;
const WHEEL_ZOOM_RATE = 0.002;
const KEY_ZOOM_FACTOR = 1.1;
/** Fraction of the crop area moved per arrow key press */
const KEY_PAN_STEP = 0.05;

interface LoadedImage {
    src: string;
    /** Width over height */
    aspect: number;
}

interface View {
    zoom: number;
    /** Center of the crop, as fractions of the image's width and height */
    centerX: number;
    centerY: number;
}

const INITIAL_VIEW: View = { zoom: 1, centerX: 0.5, centerY: 0.5 };

const clamp = (value: number, min: number, max: number) =>
    Math.min(max, Math.max(min, value));

// At zoom 1 the image's short side spans the square crop.
const cropSize = (aspect: number, zoom: number) => ({
    width: Math.min(1, 1 / aspect) / zoom,
    height: Math.min(1, aspect) / zoom,
});

const clampView = (aspect: number, view: View): View => {
    const zoom = clamp(view.zoom, 1, MAX_ZOOM);
    const { width, height } = cropSize(aspect, zoom);
    return {
        zoom,
        centerX: clamp(view.centerX, width / 2, 1 - width / 2),
        centerY: clamp(view.centerY, height / 2, 1 - height / 2),
    };
};

const toCrop = (aspect: number, view: View): ImageCrop => {
    const { width, height } = cropSize(aspect, view.zoom);
    return {
        x: view.centerX - width / 2,
        y: view.centerY - height / 2,
        width,
        height,
    };
};

interface Props {
    file: File;
    onCancel: () => void;
    onConfirm: (crop: ImageCrop) => void;
}

/** Lets the user pan and zoom a square crop of `file` before it's uploaded as their avatar */
export const AvatarCropDialog = ({ file, onCancel, onConfirm }: Props) => {
    const [image, setImage] = useState<LoadedImage | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [view, setView] = useState<View>(INITIAL_VIEW);

    useEffect(() => {
        let cancelled = false;
        loadImage(file).then(
            (img) => {
                if (cancelled) return;
                const { naturalWidth: w, naturalHeight: h } = img;
                setImage({ src: img.src, aspect: w && h ? w / h : 1 });
            },
            (e: Error) => {
                if (!cancelled) setError(e.message);
            },
        );
        return () => {
            cancelled = true;
        };
    }, [file]);

    const aspect = image?.aspect ?? 1;
    const update = (change: (view: View) => View) =>
        setView((view) => clampView(aspect, change(view)));
    const zoomBy = (factor: number) =>
        update((view) => ({ ...view, zoom: view.zoom * factor }));

    return (
        <Dialog
            open
            onOpenChange={(open) => {
                if (!open) onCancel();
            }}
        >
            <DialogContent className="sm:max-w-sm">
                <DialogHeader>
                    <DialogTitle>Crop avatar</DialogTitle>
                    <DialogDescription>
                        Drag to reposition. Scroll or use the slider to zoom.
                    </DialogDescription>
                </DialogHeader>

                {error ? (
                    <p className="text-destructive text-sm">{error}</p>
                ) : image ? (
                    <CropArea
                        image={image}
                        crop={toCrop(aspect, view)}
                        update={update}
                        zoomBy={zoomBy}
                    />
                ) : (
                    <Skeleton className="mx-auto aspect-square w-full max-w-72 rounded-lg" />
                )}

                <div className="flex items-center gap-3">
                    <ZoomOut
                        className="text-muted-foreground size-4 shrink-0"
                        aria-hidden
                    />
                    <input
                        type="range"
                        aria-label="Zoom"
                        min={1}
                        max={MAX_ZOOM}
                        step={0.01}
                        value={view.zoom}
                        disabled={!image}
                        onChange={(e) => {
                            const zoom = Number(e.target.value);
                            update((view) => ({ ...view, zoom }));
                        }}
                        className="accent-primary w-full"
                    />
                    <ZoomIn
                        className="text-muted-foreground size-4 shrink-0"
                        aria-hidden
                    />
                </div>

                <DialogFooter>
                    <Button variant="outline" onClick={onCancel}>
                        Cancel
                    </Button>
                    <Button
                        disabled={!image}
                        onClick={() => onConfirm(toCrop(aspect, view))}
                    >
                        Save avatar
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
};

interface CropAreaProps {
    image: LoadedImage;
    crop: ImageCrop;
    update: (change: (view: View) => View) => void;
    zoomBy: (factor: number) => void;
}

const CropArea = ({ image, crop, update, zoomBy }: CropAreaProps) => {
    const ref = useRef<HTMLDivElement>(null);
    const drag = useRef<{ pointerId: number; x: number; y: number } | null>(
        null,
    );

    // Moves the image by fractions of the crop area, as if dragged
    const panBy = (dx: number, dy: number) =>
        update((view) => {
            const { width, height } = cropSize(image.aspect, view.zoom);
            return {
                ...view,
                centerX: view.centerX - dx * width,
                centerY: view.centerY - dy * height,
            };
        });

    // React registers wheel listeners as passive, so preventDefault needs a native one
    const zoomByRef = useRef(zoomBy);
    zoomByRef.current = zoomBy;
    useEffect(() => {
        const el = ref.current;
        if (!el) return;
        const onWheel = (e: WheelEvent) => {
            e.preventDefault();
            zoomByRef.current(Math.exp(-e.deltaY * WHEEL_ZOOM_RATE));
        };
        el.addEventListener("wheel", onWheel, { passive: false });
        return () => el.removeEventListener("wheel", onWheel);
    }, []);

    const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
        if (e.button !== 0) return;
        e.currentTarget.setPointerCapture(e.pointerId);
        drag.current = { pointerId: e.pointerId, x: e.clientX, y: e.clientY };
    };

    const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
        const start = drag.current;
        if (start?.pointerId !== e.pointerId) return;
        const { width, height } = e.currentTarget.getBoundingClientRect();
        panBy((e.clientX - start.x) / width, (e.clientY - start.y) / height);
        drag.current = { ...start, x: e.clientX, y: e.clientY };
    };

    const endDrag = (e: React.PointerEvent<HTMLDivElement>) => {
        if (drag.current?.pointerId === e.pointerId) drag.current = null;
    };

    const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
        switch (e.key) {
            case "ArrowLeft":
                panBy(-KEY_PAN_STEP, 0);
                break;
            case "ArrowRight":
                panBy(KEY_PAN_STEP, 0);
                break;
            case "ArrowUp":
                panBy(0, -KEY_PAN_STEP);
                break;
            case "ArrowDown":
                panBy(0, KEY_PAN_STEP);
                break;
            case "+":
            case "=":
                zoomBy(KEY_ZOOM_FACTOR);
                break;
            case "-":
                zoomBy(1 / KEY_ZOOM_FACTOR);
                break;
            default:
                return;
        }
        e.preventDefault();
    };

    return (
        <div
            ref={ref}
            tabIndex={0}
            aria-label="Avatar crop area. Use the arrow keys to reposition and + or - to zoom."
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={endDrag}
            onPointerCancel={endDrag}
            onKeyDown={onKeyDown}
            className="bg-muted focus-visible:ring-ring relative mx-auto aspect-square w-full max-w-72 cursor-grab touch-none select-none overflow-hidden rounded-lg outline-none focus-visible:ring-2 active:cursor-grabbing"
        >
            <img
                src={image.src}
                alt=""
                draggable={false}
                className="pointer-events-none absolute max-w-none"
                style={{
                    left: `${(-crop.x / crop.width) * 100}%`,
                    top: `${(-crop.y / crop.height) * 100}%`,
                    width: `${100 / crop.width}%`,
                    height: `${100 / crop.height}%`,
                }}
            />
            {/* Avatars render as circles; dim what falls outside one */}
            <div className="pointer-events-none absolute inset-0 rounded-full shadow-[0_0_0_9999px_rgb(0_0_0/0.5)] ring-2 ring-white/80" />
        </div>
    );
};
