import { z } from "zod";
import { formatThousands } from "./formatNumber";

const BigInteger = z.string().refine((int) => {
  return !int.includes(".");
});

const Decimal = z.number().or(z.string());
export class Quantity {
  constructor(
    private amount: string,
    private precision: number,
    private tokenNumber: number,
    private tokenSymbol?: string
  ) {
    BigInteger.parse(amount);
  }

  public hasTokenSymbol(): boolean {
    return !!this.tokenSymbol;
  }

  public toDecimal(): number {
    return Number(this.amount) / Math.pow(10, this.precision);
  }

  private fromDecimal(amount: number | string): string {
    return (Number(amount) * Math.pow(10, this.precision)).toString();
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

  public subtract(decimalAmount: string | number): Quantity {
    Decimal.parse(decimalAmount);
    const newAmount = Number(this.toDecimal()) - Number(decimalAmount);
    return new Quantity(
      this.fromDecimal(newAmount),
      this.precision,
      this.tokenNumber,
      this.tokenSymbol
    );
  }

  public add(amount: string | number): Quantity {
    Decimal.parse(amount);
    const newAmount = Number(this.toDecimal()) + Number(amount);
    return new Quantity(
      this.fromDecimal(newAmount),
      this.precision,
      this.tokenNumber,
      this.tokenSymbol
    );
  }
}
