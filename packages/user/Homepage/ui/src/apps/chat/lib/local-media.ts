/** Browser getUserMedia helper for Meet / WebRTC paths. */
export async function acquireMeetLocalMedia(
    wantVideo: boolean,
    wantAudio: boolean,
): Promise<{ stream: MediaStream; videoDisabled: boolean }> {
    const tryVideo = wantVideo;
    try {
        const stream = await navigator.mediaDevices.getUserMedia({
            audio: wantAudio,
            video: tryVideo ? { facingMode: "user" } : false,
        });
        return { stream, videoDisabled: !tryVideo };
    } catch {
        if (wantAudio && wantVideo) {
            const stream = await navigator.mediaDevices.getUserMedia({
                audio: true,
                video: false,
            });
            return { stream, videoDisabled: true };
        }
        throw new Error("media_denied");
    }
}
