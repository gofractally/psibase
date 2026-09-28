/** Short, friendly number for headline figures: 84, 1,204.5, 2.4M. */
export const formatCompact = (n: number) =>
    Math.abs(n) >= 100_000
        ? new Intl.NumberFormat(undefined, {
              notation: "compact",
              maximumFractionDigits: 1,
          }).format(n)
        : n.toLocaleString(undefined, { maximumFractionDigits: 2 });
