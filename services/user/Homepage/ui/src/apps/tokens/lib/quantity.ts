import { z } from "zod";

import { formatThousands } from "@/lib/formatNumber";

const Decimal = z.number().or(z.string());

type QuantityInput = string | number;

export class Quantity {
    private readonly amount: string;
    private readonly precision: number;
    private readonly tokenNumber: number;
    private readonly tokenSymbol?: string;

    /**
     * Creates a new Quantity instance
     * @throws {Error} If amount is not a valid integer or inputs are invalid
     */
    constructor(
        amount: QuantityInput,
        precision: number,
        tokenNumber: number,
        tokenSymbol?: string,
    ) {
        if (precision < 0 || !Number.isInteger(precision)) {
            throw new Error("Precision must be a non-negative integer");
        }
        if (tokenNumber < 0 || !Number.isInteger(tokenNumber)) {
            throw new Error("Token number must be a non-negative integer");
        }

        try {
            BigInt(Number(amount)); // Validates that the amount is a valid integer
        } catch {
            throw new Error(
                `Amount must be a valid integer, was ${typeof amount} of "${amount}"`,
            );
        }

        this.amount = String(amount);
        this.precision = precision;
        this.tokenNumber = tokenNumber;
        this.tokenSymbol = tokenSymbol;
    }

    public equals(other: Quantity): boolean {
        return (
            this.amount === other.amount &&
            this.precision === other.precision &&
            this.tokenNumber === other.tokenNumber
        );
    }

    public isGreaterThan(other: Quantity): boolean {
        if (this.precision !== other.precision) {
            throw new Error(
                "Cannot compare quantities with different precisions",
            );
        }
        return BigInt(this.amount) > BigInt(other.amount);
    }

    public isLessThan(other: Quantity): boolean {
        if (this.precision !== other.precision) {
            throw new Error(
                "Cannot compare quantities with different precisions",
            );
        }
        return BigInt(this.amount) < BigInt(other.amount);
    }

    public hasTokenSymbol(): boolean {
        return !!this.tokenSymbol;
    }

    public toDecimal(): number {
        const result = Number(this.amount) / Math.pow(10, this.precision);
        if (!Number.isFinite(result)) {
            throw new Error("Amount too large to convert to decimal");
        }
        return result;
    }

    private fromDecimal(amount: QuantityInput): string {
        const num = Number(amount);
        if (!Number.isFinite(num)) {
            throw new Error("Invalid decimal amount");
        }
        return Math.round(num * Math.pow(10, this.precision)).toString();
    }

    public getDisplayLabel(): string {
        return this.tokenSymbol?.toUpperCase() || `#${this.tokenNumber}`;
    }

    public format(includeLabel = true, fullPrecision = false): string {
        try {
            return `${formatThousands(
                this.toDecimal(),
                this.precision,
                fullPrecision,
            )}${includeLabel ? ` ${this.getDisplayLabel()}` : ""}`;
        } catch (error) {
            return "Invalid amount";
        }
    }

    public getRawAmount(): string {
        return this.amount;
    }

    public getPrecision() {
        return this.precision;
    }

    public subtract(decimalAmount: QuantityInput): Quantity {
        Decimal.parse(decimalAmount);
        const newAmount = Number(this.toDecimal()) - Number(decimalAmount);
        if (newAmount < 0) {
            throw new Error("Result cannot be negative");
        }
        return new Quantity(
            this.fromDecimal(newAmount),
            this.precision,
            this.tokenNumber,
            this.tokenSymbol,
        );
    }

    public add(amount: QuantityInput): Quantity {
        Decimal.parse(amount);
        const newAmount = Number(this.toDecimal()) + Number(amount);
        if (!Number.isFinite(newAmount)) {
            throw new Error("Addition would overflow");
        }
        return new Quantity(
            this.fromDecimal(newAmount),
            this.precision,
            this.tokenNumber,
            this.tokenSymbol,
        );
    }
}
