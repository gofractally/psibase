export const formatThousands = (num: number, precision: number, full = false) =>
  new Intl.NumberFormat("en-US", {
    maximumFractionDigits: precision,
    ...(full && { minimumFractionDigits: precision }),
  }).format(Number.isNaN(num) ? 0 : num);
