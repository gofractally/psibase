import { z } from "zod";

export const PPM = 1_000_000;

/** 1 percent is 10,000 ppm. Four decimal places of a percent is exactly 1 ppm. */
export const percentToPpm = (value: string): number | null => {
    const trimmed = value.trim();
    if (!/^\d+(\.\d+)?$/.test(trimmed)) return null;

    const [whole, fraction = ""] = trimmed.split(".");
    if (fraction.length > 4) return null;

    const ppm = Number(whole) * 10_000 + Number(fraction.padEnd(4, "0"));
    if (!Number.isSafeInteger(ppm) || ppm < 1 || ppm > PPM) return null;
    return ppm;
};

export const ppmToPercent = (ppm: number): string => {
    const whole = Math.floor(ppm / 10_000);
    const fraction = String(ppm % 10_000).padStart(4, "0").replace(/0+$/, "");
    return fraction ? `${whole}.${fraction}` : String(whole);
};

export const zPercent = z.string().refine(
    (value) => percentToPpm(value) !== null,
    "Enter a percent from 0.0001 to 100, with at most 4 decimal places",
);
