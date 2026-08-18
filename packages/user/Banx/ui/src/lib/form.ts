/**
 * Banx forms use the monorepo shared TanStack Form hook
 * (`@shared/components/form/app-form`).
 *
 * Prefer `form.AppField` + `TextField` / `NumberField` / `CheckboxField` /
 * `SwitchField` for standard inputs. Use `form.Field` for Banx-specific
 * controls (`AssetSelect`, `ExpiresAtPicker`) that are not registered on the
 * shared form.
 */
export { useAppForm } from "@shared/components/form/app-form";

export {
    MAX_HOP_FEE_PERCENT,
    MAX_HOP_FEE_PPM,
    MAX_PERCENT,
    MIN_PERCENT_STEP,
    PPM_SCALE,
    clampAprPercent,
    clampHopFeePercent,
    percentStringToPpm,
    percentToPpm,
    ppmToPercentInput,
    signedPercentStringToPpm,
} from "@/lib/constants";

/** Non-empty trimmed account string, or undefined if invalid. */
export function requireAccount(value: string): string | undefined {
    const t = value.trim();
    return t || undefined;
}

/**
 * TanStack field validator: percent string in [0, maxPercent].
 * Rejects non-numeric / out of range; notes ppm precision (0.0001%).
 */
export function percentFieldValidator(maxPercent: number) {
    return ({ value }: { value: string }) => {
        const t = String(value).trim();
        if (t === "") return "Required";
        const n = Number(t);
        if (!Number.isFinite(n)) return "Enter a number";
        if (n < 0) return "Cannot be negative";
        if (n > maxPercent) {
            return maxPercent >= 100
                ? "Cannot exceed 100%"
                : `Cannot exceed ${maxPercent}% (100% hop fee is invalid)`;
        }
        // More than 4 decimal places cannot survive ppm rounding cleanly
        const decimals = (t.split(".")[1] ?? "").replace(/0+$/, "").length;
        if (decimals > 4) {
            return "Max 4 decimal places (1 ppm = 0.0001%)";
        }
        return undefined;
    };
}

/** Signed percent in (-maxPercent, maxPercent), exclusive of ±100%. */
export function signedPercentFieldValidator(maxAbsPercent: number) {
    return ({ value }: { value: string }) => {
        const t = String(value).trim();
        if (t === "") return "Required";
        const n = Number(t);
        if (!Number.isFinite(n)) return "Enter a number";
        if (n <= -maxAbsPercent || n >= maxAbsPercent) {
            return `Must be between -${maxAbsPercent}% and ${maxAbsPercent}%`;
        }
        const decimals = (t.replace(/^-/, "").split(".")[1] ?? "").replace(
            /0+$/,
            "",
        ).length;
        if (decimals > 4) {
            return "Max 4 decimal places (1 ppm = 0.0001%)";
        }
        return undefined;
    };
}

/**
 * Human decimal amount for an asset with the given `precision` (fraction digits).
 * Empty allowed when `allowEmpty` (e.g. optional fixed fee of 0).
 */
export function amountFieldValidator(
    precision: number,
    opts?: { allowEmpty?: boolean; allowZero?: boolean },
) {
    const allowEmpty = opts?.allowEmpty ?? false;
    const allowZero = opts?.allowZero ?? true;
    return ({ value }: { value: string }) => {
        const t = String(value).trim();
        if (t === "") return allowEmpty ? undefined : "Required";
        if (!/^\d+(\.\d*)?$|^\.\d+$/.test(t)) return "Enter a valid amount";
        const n = Number(t);
        if (!Number.isFinite(n)) return "Enter a valid amount";
        if (n < 0) return "Cannot be negative";
        if (!allowZero && n === 0) return "Must be greater than zero";
        // Ignore trailing zeros so "1.00" is valid for precision 0 / 2, etc.
        const fracRaw = t.includes(".") ? (t.split(".")[1] ?? "") : "";
        const frac = fracRaw.replace(/0+$/, "");
        if (frac.length > precision) {
            return precision <= 0
                ? "Whole numbers only for this asset"
                : `Max ${precision} decimal place${precision === 1 ? "" : "s"} for this asset`;
        }
        return undefined;
    };
}
