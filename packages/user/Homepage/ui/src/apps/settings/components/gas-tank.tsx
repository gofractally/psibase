interface GasTankProps {
    fillPercentage: number; // 0-100
}

export const GasTank = ({ fillPercentage }: GasTankProps) => {
    const clampedFill = Math.max(0, Math.min(100, fillPercentage));
    const percentageText = `${Math.round(clampedFill)}%`;

    // XOR color flip: text is positioned at 50% (middle)
    // If fill level is above 50%, text is in the filled (light blue) area -> use dark text
    // If fill level is below 50%, text is in the empty (dark) area -> use light text
    // This ensures the text is always readable regardless of fill level
    const textColor = clampedFill >= 50 ? "text-gray-900" : "text-white";

    return (
        <div className="relative h-full w-16 rounded-lg border-2 border-gray-700 bg-gray-900 overflow-hidden">
            {/* Fill level with shimmer effect */}
            <div
                className="absolute bottom-0 left-0 right-0 transition-all duration-500 ease-out"
                style={{
                    height: `${clampedFill}%`,
                    background: `linear-gradient(
                        to top,
                        rgba(100, 150, 255, 0.9) 0%,
                        rgba(150, 200, 255, 0.8) 50%,
                        rgba(200, 230, 255, 0.7) 100%
                    )`,
                    boxShadow: `inset 0 0 20px rgba(150, 200, 255, 0.5),
                                0 0 10px rgba(100, 150, 255, 0.3)`,
                }}
            >
                {/* Shimmer animation overlay */}
                <div
                    className="absolute inset-0 opacity-40 shimmer-overlay"
                    style={{
                        background: `linear-gradient(
                            90deg,
                            transparent 0%,
                            rgba(255, 255, 255, 0.6) 50%,
                            transparent 100%
                        )`,
                        width: "200%",
                    }}
                />
            </div>
            {/* Fill line indicator */}
            {clampedFill > 0 && (
                <div
                    className="absolute left-0 right-0 border-t-2 border-blue-300 opacity-80"
                    style={{
                        bottom: `${clampedFill}%`,
                        boxShadow: "0 0 4px rgba(150, 200, 255, 0.8)",
                    }}
                />
            )}
            {/* Percentage label in the middle with XOR color flip */}
            <div
                className={`absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 font-bold text-sm ${textColor} transition-colors duration-300`}
                style={{
                    textShadow:
                        clampedFill > 50
                            ? "0 1px 2px rgba(0, 0, 0, 0.3)"
                            : "0 1px 2px rgba(0, 0, 0, 0.8)",
                }}
            >
                {percentageText}
            </div>
            <style>{`
                @keyframes shimmer {
                    0% { transform: translateX(-100%); }
                    100% { transform: translateX(0%); }
                }
                .shimmer-overlay {
                    animation: shimmer 3s infinite;
                }
            `}</style>
        </div>
    );
};
