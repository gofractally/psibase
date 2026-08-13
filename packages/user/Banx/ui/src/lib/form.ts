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

/** Convert a percent string (e.g. `"1.5"`) to ppm. */
export function percentStringToPpm(pct: string): number {
    return Math.round(Number(pct) * 10_000);
}

/** Non-empty trimmed account string, or undefined if invalid. */
export function requireAccount(value: string): string | undefined {
    const t = value.trim();
    return t || undefined;
}
