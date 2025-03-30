import humanizeDuration from "humanize-duration";



export const humanize = (ms: number) =>
    humanizeDuration(ms, {
        units: ["w", "d", "h", "m"],
        largest: 3,
        round: true,
    });