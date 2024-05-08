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
  ) {}

  public toNumber(): number {
    return Number(this.amount) / Math.pow(10, this.precision);
  }

  public toString(): string {
    return `${formatTrailingZeros(this.toNumber(), this.precision)}${
      this.symbol ? ` ${this.symbol}` : ""
    }`;
  }

  public toRawNumber(): string {
    return this.amount;
  }

  public getPrecision() {
    return this.precision;
  }
}
