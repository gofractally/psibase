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
