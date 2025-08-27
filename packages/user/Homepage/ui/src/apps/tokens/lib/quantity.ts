import { z } from "zod";

import { formatThousands } from "@/lib/formatNumber";

const Decimal = z.number().or(z.string());

type QuantityInput = string | number;

/**
 * Format configuration options for Quantity formatting
 */
interface FormatConfig {
    includeLabel?: boolean;
    fullPrecision?: boolean;
    showThousandsSeparator?: boolean;
}

export class Quantity {
    /**
     * The amount as a number
     */
    public readonly amount: number;

    /**
     * The precision (number of decimal places)
     */
    public readonly precision: number;

    /**
     * The token number identifier
     */
    public readonly tokenNumber: number;

    /**
     * The token symbol (optional)
     */
    public readonly tokenSymbol?: string;

    /**
     * Creates a new Quantity instance
     * @param amount - The amount as a string (e.g., "9000.0000") or number (e.g., 9000)
     * @param precision - Number of decimal places for the token
     * @param tokenNumber - Token identifier number
     * @param tokenSymbol - Optional token symbol
     * @throws {Error} If inputs are invalid
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

        // Handle amount input
        let amountNum: number;

        if (typeof amount === "string") {
            // Validate string amount
            const parsed = Number(amount);
            if (!Number.isFinite(parsed)) {
                throw new Error(`Invalid amount string: "${amount}"`);
            }
            amountNum = parsed;
        } else if (typeof amount === "number") {
            // Validate number amount
            if (!Number.isFinite(amount)) {
                throw new Error(`Invalid amount number: ${amount}`);
            }
            amountNum = amount;
        } else {
            throw new Error(
                `Amount must be a string or number, got ${typeof amount}`,
            );
        }

        this.amount = amountNum;
        this.precision = precision;
        this.tokenNumber = tokenNumber;
        this.tokenSymbol = tokenSymbol;
    }

    /**
     * Check if this quantity equals another
     */
    public equals(other: Quantity): boolean {
        return (
            this.amount === other.amount &&
            this.precision === other.precision &&
            this.tokenNumber === other.tokenNumber
        );
    }

    /**
     * Check if this quantity is greater than another
     */
    public isGreaterThan(other: Quantity): boolean {
        if (this.precision !== other.precision) {
            throw new Error(
                "Cannot compare quantities with different precisions",
            );
        }
        return this.amount > other.amount;
    }

    /**
     * Check if this quantity is less than another
     */
    public isLessThan(other: Quantity): boolean {
        if (this.precision !== other.precision) {
            throw new Error(
                "Cannot compare quantities with different precisions",
            );
        }
        return this.amount < other.amount;
    }

    /**
     * Check if this quantity has a token symbol
     */
    public hasTokenSymbol(): boolean {
        return !!this.tokenSymbol;
    }

    /**
     * Get the display label for the token
     */
    public getDisplayLabel(): string {
        return this.tokenSymbol?.toUpperCase() || `#${this.tokenNumber}`;
    }

    /**
     * Format the quantity for display
     * TODO: i18n
     */
    /**
     * Format the quantity for display
     * @param config Configuration options for formatting
     * @param config.includeLabel Whether to include the token label in the output (default: true)
     * @param config.fullPrecision Whether to show all decimal places (default: false)
     * @param config.showThousandsSeparator Whether to separate thousands with commas (default: true)
     */
    public format(config: FormatConfig = {}): string {
        const {
            includeLabel = true,
            fullPrecision = false,
            showThousandsSeparator = true,
        } = config;

        try {
            let formattedAmount: string;

            if (showThousandsSeparator) {
                formattedAmount = formatThousands(
                    this.amount,
                    this.precision,
                    fullPrecision,
                );
            } else {
                // Simple number formatting without thousands separator
                formattedAmount = fullPrecision
                    ? this.amount.toFixed(this.precision)
                    : this.amount.toString();
            }

            return `${formattedAmount}${includeLabel ? ` ${this.getDisplayLabel()}` : ""}`;
        } catch {
            return "Invalid amount";
        }
    }

    /**
     * Subtract an amount from this quantity
     */
    public subtract(decimalAmount: QuantityInput): Quantity {
        Decimal.parse(decimalAmount);
        const amountToSubtract =
            typeof decimalAmount === "string"
                ? Number(decimalAmount)
                : decimalAmount;

        const newAmount = this.amount - amountToSubtract;
        if (newAmount < 0) {
            throw new Error("Result cannot be negative");
        }

        return new Quantity(
            newAmount,
            this.precision,
            this.tokenNumber,
            this.tokenSymbol,
        );
    }

    /**
     * Add an amount to this quantity
     */
    public add(amount: QuantityInput): Quantity {
        Decimal.parse(amount);
        const amountToAdd =
            typeof amount === "string" ? Number(amount) : amount;

        const newAmount = this.amount + amountToAdd;
        if (!Number.isFinite(newAmount)) {
            throw new Error("Addition would overflow");
        }

        return new Quantity(
            newAmount,
            this.precision,
            this.tokenNumber,
            this.tokenSymbol,
        );
    }

    /**
     * Create a new Quantity with a different amount but same token properties
     */
    public withAmount(newAmount: QuantityInput): Quantity {
        return new Quantity(
            newAmount,
            this.precision,
            this.tokenNumber,
            this.tokenSymbol,
        );
    }
}
