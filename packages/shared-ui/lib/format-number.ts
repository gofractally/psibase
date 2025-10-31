export const formatThousands = (
    num: number,
    precision: number,
    fullPrecision = false,
) =>
    new Intl.NumberFormat("en-US", {
        maximumFractionDigits: precision,
        ...(fullPrecision && { minimumFractionDigits: precision }),
    }).format(Number.isNaN(num) ? 0 : num);
