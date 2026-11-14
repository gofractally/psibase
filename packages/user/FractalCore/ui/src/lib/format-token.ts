/** Fractal tokens are created at precision 4. Display uses that, not the raw units. */
export const FRACTAL_TOKEN_PRECISION = 4;

/** `10000` at precision 4 is `1`. Drops trailing zeros. */
export const formatRawAmount = (
    raw: string,
    precision = FRACTAL_TOKEN_PRECISION,
): string => {
    const negative = raw.startsWith("-");
    const digits = (negative ? raw.slice(1) : raw).replace(/^0+/, "") || "0";
    const padded = digits.padStart(precision + 1, "0");
    const split = padded.length - precision;
    const whole = padded.slice(0, split);
    const fraction = padded.slice(split).replace(/0+$/, "");
    const amount = fraction ? `${whole}.${fraction}` : whole;
    return negative ? `-${amount}` : amount;
};
