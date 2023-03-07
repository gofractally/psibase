import { PeerOverlay, Video } from ".";

// TODO: Would be nice to come up with a replacement for this any, but I don't find one. May have to create it.
interface Props {
    peer?: any;
    displayName?: string;
    isMicMuted?: boolean;
    isCamMuted?: boolean;
}

export const VideoParticipant = ({
    peer,
    displayName,
    isCamMuted,
    isMicMuted,
}: Props) => {
    let video;
    if (peer) {
        video = peer.stream ? (
            // mute local video so local user doesn't hear their own voice echoed
            <Video muted={peer.isLocal} srcObject={peer.stream} />
        ) : (
            <div>Loading {peer.socketId}</div>
        );
    } else {
        video = (
            <div style={{ aspectRatio: "1.6" }}>
                <img
                    style={{ aspectRatio: "1.6" }}
                    src="https://images.unsplash.com/photo-1509967419530-da38b4704bc6?ixlib=rb-1.2.1&ixid=MnwxMjA3fDB8MHxwaG90by1wYWdlfHx8fGVufDB8fHx8&auto=format&fit=crop&w=640&q=80"
                    alt="absent user pic"
                />
            </div>
        );
    }

    return (
        <div
            className="relative border-[0.5px] border-gray-900"
            style={{ aspectRatio: "1.6" }}
        >
            <div>
                {video}
                <PeerOverlay
                    micOff={isMicMuted}
                    videoOff={isCamMuted}
                    displayName={displayName}
                    absent={!peer}
                />
            </div>
        </div>
    );
};

export default VideoParticipant;
