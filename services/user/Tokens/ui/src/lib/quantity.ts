import { formatThousands } from "./formatNumber";

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
    return this.tokenSymbol?.toUpperCase() || `#${this.tokenNumber}`;
  }

  public format(includeLabel = true, full = false): string {
    return `${formatThousands(this.toNumber(), this.precision, full)}${
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
