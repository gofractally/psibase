export const formatThousands = (num: number) =>
  new Intl.NumberFormat("en-US").format(Number.isNaN(num) ? 0 : num);

const parseIntegerAndDecimalPart = (
  str: string,
  precision: number
): [integer: string, decimal: string] => {
  const isPrecision = str.includes(".");
  const [integerPart, decimalPart] = str.split(".");
  const calculatedInteger = formatThousands(Number(integerPart));
  const calculatedDecimal = (isPrecision ? decimalPart : "")
    .padEnd(precision, "0")
    .slice(0, precision);
  return [calculatedInteger, calculatedDecimal];
};

export const formatNumber = (
  num: number | string,
  precision: number = 4,
  symbol?: string
): string => {
  const str = typeof num == "number" ? num.toString() : num;
  const [integerPart, decimal] = parseIntegerAndDecimalPart(str, precision);

  return `${integerPart}.${decimal}${symbol ? ` ${symbol}` : ``}`;
};
