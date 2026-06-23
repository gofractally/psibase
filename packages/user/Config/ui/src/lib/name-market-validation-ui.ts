const MARKET_FIELD_ORDER = [
    "initialPrice",
    "floorPrice",
    "target",
    "increasePpm",
    "decreasePpm",
] as const;

type MarketFieldName = (typeof MARKET_FIELD_ORDER)[number];

const MARKET_FIELD_INPUT_ID: Record<MarketFieldName, string> = {
    initialPrice: "pm-initial",
    floorPrice: "pm-floor",
    target: "pm-target",
    increasePpm: "pm-inc-ppm",
    decreasePpm: "pm-dec-ppm",
};

function parseMarketFieldPath(fieldPath: string): {
    index: number;
    field: MarketFieldName;
} | null {
    const match = fieldPath.match(/^markets\[(\d+)\]\.(\w+)$/);
    if (!match) {
        return null;
    }

    const index = Number(match[1]);
    const field = match[2] as MarketFieldName;
    if (
        !Number.isInteger(index) ||
        !MARKET_FIELD_ORDER.includes(field)
    ) {
        return null;
    }

    return { index, field };
}

export function getFirstMarketFieldError(
    fields: Record<string, string>,
): string | undefined {
    const sorted = Object.keys(fields).sort((a, b) => {
        const left = parseMarketFieldPath(a);
        const right = parseMarketFieldPath(b);

        if (!left || !right) {
            return a.localeCompare(b);
        }

        if (left.index !== right.index) {
            return left.index - right.index;
        }

        return (
            MARKET_FIELD_ORDER.indexOf(left.field) -
            MARKET_FIELD_ORDER.indexOf(right.field)
        );
    });

    return sorted[0];
}

export function marketFieldPathToInputId(fieldPath: string): string | null {
    const parsed = parseMarketFieldPath(fieldPath);
    if (!parsed) {
        return null;
    }

    return `${MARKET_FIELD_INPUT_ID[parsed.field]}-${parsed.index}`;
}

export function scrollToMarketFieldError(fieldPath: string): void {
    const inputId = marketFieldPathToInputId(fieldPath);
    if (!inputId) {
        return;
    }

    const input = document.getElementById(inputId);
    if (!(input instanceof HTMLElement)) {
        return;
    }

    input.scrollIntoView({ behavior: "smooth", block: "center" });
    input.focus({ preventScroll: true });
}

export function scrollToFirstMarketFieldError(
    fields: Record<string, string>,
): void {
    const firstField = getFirstMarketFieldError(fields);
    if (!firstField) {
        return;
    }

    scrollToMarketFieldError(firstField);
}
