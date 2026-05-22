import humanizeDuration from "humanize-duration";

export const humanize = (seconds: number, largest: number = 2) =>
    humanizeDuration(seconds * 1000, {
        units: ["w", "d", "h", "m", "s"],
        largest,
        round: true,
    });
