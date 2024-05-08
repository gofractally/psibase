export const formatNumber = (num: number, precision: number = 4) =>
  new Intl.NumberFormat(undefined, {
    maximumFractionDigits: precision,
  }).format(num);
