import humanizeDuration from "humanize-duration";

export const humanize = (seconds: number) =>
    humanizeDuration(seconds * 1000, {
        units: ["w", "d", "h", "m", "s"],
        largest: 2,
        round: true,
    });
