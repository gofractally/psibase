import { useEffect, useRef, VideoHTMLAttributes } from "react";

type Props = VideoHTMLAttributes<HTMLVideoElement> & {
    srcObject: MediaStream;
};

export const Video = ({ srcObject, ...props }: Props) => {
    const refVideo = useRef<HTMLVideoElement>(null);

    useEffect(() => {
        if (refVideo.current && srcObject) {
            refVideo.current.srcObject = srcObject;
        } else {
            // TODO: add no video icon
        }
    }, [srcObject]);

    return (
        <video
            ref={refVideo}
            playsInline
            autoPlay
            style={{ aspectRatio: "1.6", width: "100%", height: "100%"  }}
            {...props}
            className="object-cover pointer-events-none"
        />
    );
};

export default Video;
