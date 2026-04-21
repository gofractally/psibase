

export const stringToNum = (rawAmount: string): number | undefined => {
    if (!rawAmount || rawAmount.trim() === "") {
      return undefined;
    }

    const cleaned = rawAmount.trim();

    // Common incomplete inputs people type moment-by-moment
    if (
      cleaned === "." ||
      cleaned === "0." ||
      cleaned === "00." ||
      cleaned === "000." ||
      cleaned === "-." ||
      cleaned === "-0."
    ) {
      return undefined;
    }

    // Incomplete decimal (most common typing state)
    if (cleaned.endsWith(".")) {
      return undefined;
    }

    const num = Number(cleaned);

    if (Number.isNaN(num)) {
      return undefined;
    }

    // Optional: forbid negatives in many crypto/deposit contexts
    if (num < 0) return undefined;


    return num;
}