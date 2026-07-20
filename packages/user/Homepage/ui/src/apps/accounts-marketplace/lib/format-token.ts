import { Quantity } from "@shared/lib/quantity";

export function unitTokenDecimal(precision: number): string {
    return new Quantity(1, precision, 0).format({
        fullPrecision: true,
        includeLabel: false,
        showThousandsSeparator: false,
    });
}
