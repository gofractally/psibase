interface SvgCanvasArgs {
    width: number;
    height: number;
    viewBoxWidth: number;
    viewBoxScalar: number;
}

export const SvgCanvas = ({
    width,
    height,
    viewBoxWidth,
    viewBoxScalar,
}: SvgCanvasArgs) => (
    <svg
        id="canvas"
        width="95%"
        height={height}
        // viewBox={`${-width / 2}, ${-height / 2}, ${width / 2}, ${height / 2}`}
        viewBox={`${-width / 2}, ${-height / 2}, ${width}, ${height}`}
        // viewBox={`${-width}, ${-height}, ${width}, ${height}`}
    >
        <defs>
            <marker
                id="arrow-end-link"
                refX={0.5 * viewBoxWidth}
                refY={0.5 * viewBoxWidth}
                viewBox={`0 0 ${viewBoxWidth} ${viewBoxWidth}`}
                markerUnits="strokeWidth"
                markerWidth={viewBoxScalar * viewBoxWidth}
                markerHeight={viewBoxScalar * viewBoxWidth}
                orient="auto"
            >
                <path className="link-arrow-head" d="M0,0 L0.5,2 L0,4 L2,2 Z" />
            </marker>
            <marker
                id="arrow-end-backlink"
                refX={0.5 * viewBoxWidth}
                refY={0.5 * viewBoxWidth}
                viewBox={`0 0 ${viewBoxWidth} ${viewBoxWidth}`}
                markerUnits="strokeWidth"
                markerWidth={viewBoxScalar * viewBoxWidth}
                markerHeight={viewBoxScalar * viewBoxWidth}
                orient="auto"
            >
                <path
                    className="back-link-arrow-head"
                    d="M0,0 L0.5,2 L0,4 L2,2 Z"
                />
            </marker>
            <marker
                id="arrow-end-accountcreation"
                refX={0.5 * viewBoxWidth}
                refY={0.5 * viewBoxWidth}
                viewBox={`0 0 ${viewBoxWidth} ${viewBoxWidth}`}
                markerUnits="strokeWidth"
                markerWidth={viewBoxScalar * viewBoxWidth}
                markerHeight={viewBoxScalar * viewBoxWidth}
                orient="auto"
            >
                <path
                    className="account-creation-link-arrow-head"
                    d="M0,0 L0.5,2 L0,4 L2,2 Z"
                />
            </marker>
        </defs>
    </svg>
);
