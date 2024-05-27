const formatTrailingZeros = (num: number, precision: number) =>
  new Intl.NumberFormat("en-US", {
    minimumFractionDigits: precision,
    maximumFractionDigits: precision,
    useGrouping: false,
  }).format(num);

export class Quantity {
  constructor(
    private amount: string,
    private precision: number,
    private symbol?: string
  ) {
    if (amount.includes("."))
      throw new Error(`Expected integer, e.g. 10000 not 1.0000`);
  }

  public containsSymbol(): boolean {
    return !!this.symbol;
  }

  public toNumber(): number {
    return Number(this.amount) / Math.pow(10, this.precision);
  }

  public format(includeSymbol = true): string {
    return `${formatTrailingZeros(this.toNumber(), this.precision)}${
      this.symbol && includeSymbol ? ` ${this.symbol}` : ""
    }`;
  }

  public toRawNumber(): string {
    return this.amount;
  }

  public getPrecision() {
    return this.precision;
  }
}
