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
    private tokenNumber: number,
    private tokenSymbol?: string
  ) {
    if (amount.includes("."))
      throw new Error(`Expected integer, e.g. 10000 not 1.0000`);
  }

  public containsSymbol(): boolean {
    return !!this.tokenSymbol;
  }

  public toNumber(): number {
    return Number(this.amount) / Math.pow(10, this.precision);
  }

  public label(): string {
    return this.tokenSymbol || `#${this.tokenNumber}`;
  }

  public format(includeLabel = true): string {
    return `${formatTrailingZeros(this.toNumber(), this.precision)}${
      includeLabel ? ` ${this.label()}` : ""
    }`;
  }

  public toRawNumber(): string {
    return this.amount;
  }

  public getPrecision() {
    return this.precision;
  }
}
