export const formatNumber = (num: number) =>
  new Intl.NumberFormat(undefined, {
    ...(num > 10000 && { maximumFractionDigits: 0 }),
  }).format(num);
