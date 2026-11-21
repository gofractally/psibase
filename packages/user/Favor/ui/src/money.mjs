export const SCALE = 100000000n;
export const MAX = 9000000000000000n;
export function readUnits(value) {
    if (typeof value !== "string" || !/^\d+(?:\.\d{1,8})?$/.test(value) || value.length > 32)
        throw new Error("Enter an amount with up to 8 decimal places.");
    const [whole, fraction = ""] = value.split(".");
    const n = BigInt(whole) * SCALE + BigInt(fraction.padEnd(8, "0"));
    return n;
}
export function units(value) {
    const n = readUnits(value);
    if (n > MAX) throw new Error("The maximum amount is 90,000,000.");
    return n;
}
export function decimal(n) {
    const sign = n < 0n ? "-" : "";
    n = n < 0n ? -n : n;
    const fraction = (n % SCALE).toString().padStart(8, "0").replace(/0+$/, "");
    return sign + (n / SCALE).toString() + (fraction ? "." + fraction : "");
}
export function display(value, minimum = 2) {
    const [whole, f = ""] = value.split(".");
    return (
        whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",") +
        (f || minimum ? "." + f.padEnd(minimum, "0") : "")
    );
}
export function ppm(value) {
    if (!/^\d+(?:\.\d{1,4})?$/.test(value))
        throw new Error("Enter a fee with up to 4 decimal places.");
    const result = units(value) / 10000n;
    if (result > 1000000n) throw new Error("The fee must be between 0% and 100%.");
    return Number(result);
}
export function percent(value) {
    return decimal(BigInt(value) * 10000n);
}
export function symbol(value) {
    if (!/^[A-Z]{2,12}$/.test(value)) throw new Error("Use 2–12 uppercase letters for the symbol.");
    return value;
}
export function positive(value) {
    if (units(value) <= 0n) throw new Error("Enter an amount greater than zero.");
    return value;
}
export function paymentLink(origin, data) {
    const params = new URLSearchParams(data);
    const url = new URL(origin);
    url.pathname = "/";
    url.hash = `pay?${params}`;
    return url.toString();
}
export function readPaymentLink(hash) {
    if (!hash.startsWith("#pay?")) return null;
    const params = new URLSearchParams(hash.slice(5));
    return {
        to: params.get("to") || "",
        symbol: params.get("symbol") || "USD",
        amount: params.get("amount") || "",
        request: params.get("request") || "",
        note: params.get("note") || "",
    };
}
