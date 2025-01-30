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

  public hasTokenSymbol(): boolean {
    return !!this.tokenSymbol;
  }

  public toDecimal(): number {
    return Number(this.amount) / Math.pow(10, this.precision);
  }

  public getDisplayLabel(): string {
    return this.tokenSymbol?.toUpperCase() || `#${this.tokenNumber}`;
  }

  public format(includeLabel = true, fullPrecision = false): string {
    return `${formatThousands(
      this.toDecimal(),
      this.precision,
      fullPrecision
    )}${includeLabel ? ` ${this.getDisplayLabel()}` : ""}`;
  }

  public getRawAmount(): string {
    return this.amount;
  }

  public getPrecision() {
    return this.precision;
  }
}
