import { useEffect, useRef } from "react";

import { cn } from "@shared/lib/utils";

type VideoTileProps = {
    name: string;
    stream: MediaStream | null;
    muted?: boolean;
    mirrored?: boolean;
    cameraOff?: boolean;
};

export const VideoTile = ({
    name,
    stream,
    muted = false,
    mirrored = false,
    cameraOff = false,
}: VideoTileProps) => {
    const videoRef = useRef<HTMLVideoElement>(null);

    useEffect(() => {
        const el = videoRef.current;
        if (!el) return;
        el.srcObject = stream;
    }, [stream]);

    const showVideo = Boolean(stream) && !cameraOff;

    return (
        <div className="bg-muted relative min-h-40 overflow-hidden rounded-xl">
            <video
                ref={videoRef}
                autoPlay
                playsInline
                muted={muted}
                className={cn(
                    "h-full w-full object-cover",
                    mirrored && "-scale-x-100",
                    !showVideo && "hidden",
                )}
            />
            {!showVideo && (
                <div className="text-muted-foreground flex aspect-video h-full w-full items-center justify-center text-sm font-medium">
                    {name}
                </div>
            )}
            <div className="absolute bottom-2 left-2 rounded-md bg-black/60 px-2 py-1 text-xs font-medium text-white">
                {name}
            </div>
        </div>
    );
};
