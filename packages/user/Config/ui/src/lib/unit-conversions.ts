export type StorageUnit = "GB" | "TB" | "PB";
export type TimeUnit = "ns" | "us" | "ms";
export type RateTimeUnit = "sec" | "min";

export const STORAGE_FACTORS: Record<StorageUnit, number> = {
    GB: 1_000_000_000, // 1e9
    TB: 1_000_000_000_000, // 1e12
    PB: 1_000_000_000_000_000, // 1e15
};

export const TIME_FACTORS: Record<TimeUnit, number> = {
    ns: 1,
    us: 1_000, // 1e3
    ms: 1_000_000, // 1e6
};

export const RATE_TIME_FACTORS: Record<RateTimeUnit, number> = {
    sec: 1,
    min: 60,
};

// Helper function to determine the best STORAGE unit for a value (between 1-999)
export function getBestStorageUnit(bytes: number): { value: number; unit: StorageUnit } {
    if (bytes === 0) return { value: 0, unit: "GB" };
    
    // Use logarithm to determine the power of 10
    const power = Math.floor(Math.log10(bytes));
    
    if (power >= 15) {
        return { value: bytes / STORAGE_FACTORS.PB, unit: "PB" };
    } else if (power >= 12) {
        return { value: bytes / STORAGE_FACTORS.TB, unit: "TB" };
    } else {
        return { value: bytes / STORAGE_FACTORS.GB, unit: "GB" };
    }
}

// Helper function to determine the best TIME unit for a value (between 1-999)
export function getBestTimeUnit(nanoseconds: number): { value: number; unit: TimeUnit } {
    if (nanoseconds === 0) return { value: 0, unit: "ns" };
    
    const power = Math.floor(Math.log10(nanoseconds));
    
    if (power >= 6) {
        return { value: nanoseconds / TIME_FACTORS.ms, unit: "ms" };
    } else if (power >= 3) {
        return { value: nanoseconds / TIME_FACTORS.us, unit: "us" };
    } else {
        return { value: nanoseconds, unit: "ns" };
    }
}

// Helper to convert seconds to the best RATE unit (sec or min)
export function getBestRateTimeUnit(seconds: number): { value: number; unit: RateTimeUnit } {
    if (seconds === 0) return { value: 0, unit: "sec" };
    
    if (seconds >= 60 && seconds % 60 === 0) {
        return { value: seconds / 60, unit: "min" };
    }
    
    return { value: seconds, unit: "sec" };
}

export function convertRateTimeUnit(
    value: number,
    fromUnit: RateTimeUnit,
    toUnit: RateTimeUnit,
): number {
    if (fromUnit === toUnit) return value;
    
    const seconds = value * RATE_TIME_FACTORS[fromUnit];
    return seconds / RATE_TIME_FACTORS[toUnit];
}
