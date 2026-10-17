/**
 * Banx forms use the monorepo shared TanStack Form hook
 * (`@shared/components/form/app-form`).
 *
 * Prefer `form.AppField` + `TextField` / `NumberField` / `CheckboxField` /
 * `SwitchField` for standard inputs. Use `form.Field` for Banx-specific
 * controls (`AssetField`, `ExpiresAtPicker`) that are not registered on the
 * shared form.
 */
import { PPM_PER_PERCENT, ppmToPercent } from "@/lib/constants";

import { getAccount } from "@shared/lib/get-account";
import { zAccount } from "@shared/lib/schemas/account";

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

function accountFormatError(value: string): string | undefined {
    const parsed = zAccount.safeParse(value);
    if (parsed.success) return undefined;
    return parsed.error.issues[0]?.message ?? "Invalid account";
}

async function accountExistsError(
    value: string,
): Promise<string | undefined> {
    const fmt = accountFormatError(value);
    if (fmt) return fmt;
    const account = await getAccount(value);
    if (!account?.accountNum) return "Account does not exist";
    return undefined;
}

/** Ticker / asset symbol: same shape as a chain account, must exist as a name. */
export function symbolValidators() {
    return {
        onChange: ({ value }: { value: string }) => {
            const t = value.trim().toLowerCase();
            if (!t) return "Required";
            return accountFormatError(t);
        },
        onSubmit: ({ value }: { value: string }) => {
            const t = value.trim().toLowerCase();
            if (!t) return "Required";
            return accountFormatError(t);
        },
    };
}

/** Free-text chain account. `optional`: empty is allowed (invoice anyone). */
export function existingAccountValidators(opts?: { optional?: boolean }) {
    const optional = opts?.optional ?? false;
    const emptyMsg = optional ? undefined : "Required";
    return {
        onChange: ({ value }: { value: string }) => {
            const t = value.trim();
            if (!t) return emptyMsg;
            return accountFormatError(t);
        },
        onChangeAsyncDebounceMs: 400,
        onChangeAsync: async ({ value }: { value: string }) => {
            const t = value.trim();
            if (!t) return emptyMsg;
            return accountExistsError(t);
        },
        onSubmit: ({ value }: { value: string }) => {
            const t = value.trim();
            if (!t) return emptyMsg;
            return accountFormatError(t);
        },
        onSubmitAsync: async ({ value }: { value: string }) => {
            const t = value.trim();
            if (!t) return emptyMsg;
            return accountExistsError(t);
        },
    };
}

/**
 * TanStack field validator: percent string in [0, maxPercent].
 * Rejects non-numeric / out of range; notes ppm precision (0.0001%).
 * `allowEmpty` treats a blank field as valid (the caller reads it as 0).
 */
export function percentFieldValidator(
    maxPercent: number,
    allowEmpty = false,
) {
    return ({ value }: { value: string }) => {
        const t = String(value).trim();
        if (t === "") return allowEmpty ? undefined : "Required";
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

/** Signed percent in [-maxPercent, maxPercent]. */
export function signedPercentFieldValidator(maxAbsPercent: number) {
    return ({ value }: { value: string }) => {
        const t = String(value).trim();
        if (t === "") return "Required";
        const n = Number(t);
        if (!Number.isFinite(n)) return "Enter a number";
        if (n < -maxAbsPercent || n > maxAbsPercent) {
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

/** Percent in [minPpm, maxPpm] after rounding to 1 ppm. */
export function ppmRangeValidator(minPpm: number, maxPpm: number) {
    return ({ value }: { value: string }) => {
        const t = String(value).trim();
        if (t === "") return "Required";
        const n = Number(t);
        if (!Number.isFinite(n)) return "Enter a number";
        const ppm = Math.round(n * PPM_PER_PERCENT);
        if (ppm < minPpm || ppm > maxPpm) {
            return `Must be between ${ppmToPercent(minPpm)} and ${ppmToPercent(maxPpm)}`;
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
        // Count the fraction as written. The chain rejects extra zeros
        // (`"1.00"` is not a precision-0 amount).
        const frac = t.includes(".") ? (t.split(".")[1] ?? "") : "";
        if (frac.length > precision) {
            return precision <= 0
                ? "Whole numbers only for this asset"
                : `Max ${precision} decimal place${precision === 1 ? "" : "s"} for this asset`;
        }
        return undefined;
    };
}
