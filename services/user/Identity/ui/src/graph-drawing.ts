import * as d3 from "d3";

import { SELECTOR, dataSetName } from "./constants";
import { getCouncilLinks } from "./graph-data";
import rawData from "./members-fixture";
import {
    AttestationGraph,
    AttestationGraphLink,
    AttestationGraphNode,
    AttestationGraphSecondaryLink,
    UiOptions,
    Vector,
    isD3ifiedLink,
} from "./types";

export const handleSimulationTick =
    (
        simulation: d3.Simulation<AttestationGraphNode, AttestationGraphLink>,
        nodeRadius: number,
    ) =>
    () => {
        // Nodes can be moved
        const svg = d3.select("#canvas");
        svg.selectAll<SVGGElement, AttestationGraphNode>(".node")
            .attr("cx", (d) => {
                return d.x || null;
            })
            .attr("cy", (d) => {
                return d.y || null;
            })
            .attr("transform", function (d) {
                return "translate(" + d.x + "," + d.y + ")";
            });

        // Links need to be recalculated for each tick
        svg.selectAll<SVGPathElement, AttestationGraphLink>(".link").attr(
            "d",
            drawLink(simulation, SELECTOR.LINK, nodeRadius),
        );
        svg.selectAll<SVGPathElement, AttestationGraphLink>(".back-link").attr(
            "d",
            drawLink(simulation, SELECTOR.BACK_LINK, nodeRadius),
        );
        svg.selectAll<SVGPathElement, AttestationGraphLink>(
            ".account-creation-link",
        ).attr(
            "d",
            drawLink(simulation, SELECTOR.ACCOUNT_CREATION_LINK, nodeRadius),
        );
    };

export const calcNormalizedRep = (repScore: number) => {
    const rep = repScore - 1.0; // since no normal member can get less than a rank of 1 in a meeting
    const maxRep = 5.0;
    return rep / maxRep;
};

const addLinks = (attestations: AttestationGraphLink[]) => {
    const link = d3
        .select("#canvas")
        .selectAll<SVGPathElement, AttestationGraphLink>(".link")
        .data(attestations);
    link.enter().insert("path", ".node").attr("class", "link");
    link.exit() // this is redundant, given I wipe the entire svg before rerendering, but I should figure this out at some point
        .remove();
};

function addAccountCreationLineage(accountCreations: AttestationGraphLink[]) {
    if (!accountCreations) return;
    const svg = d3.select("#canvas");
    const link = svg
        .selectAll<
            SVGPathElement,
            AttestationGraphLink
        >(".account-creation-link")
        .data(accountCreations);
    link.enter().insert("path", ".node").attr("class", "account-creation-link");
    link.exit().remove();
}

function addBackAttestations(backAttestations: AttestationGraphLink[]) {
    if (!backAttestations) return;
    const svg = d3.select("#canvas");
    const link = svg
        .selectAll<SVGPathElement, AttestationGraphLink>(".back-link")
        .data(backAttestations);
    link.enter().insert("path", ".node").attr("class", "back-link");
    link.exit().remove();
}

export const addAllLinks = (graph: AttestationGraph) => {
    addLinks(graph.attestations);
    addAccountCreationLineage(graph["account-creations"]);
    if (graph.backAttestations) addBackAttestations(graph.backAttestations);
};

export const addNodes = (nodes: AttestationGraphNode[], nodeRadius: number) => {
    const Ns = d3
        .select("#canvas")
        .selectAll<SVGGElement, AttestationGraphNode>(".node")
        .data(nodes);
    const g = Ns.enter().append("g").attr("class", "node");
    const rg = g.append("radialGradient").attr("id", (n) => `grad${n.id}`);
    rg.append("stop")
        .attr(
            "offset",
            (n) =>
                `${Math.round(100 * calcNormalizedRep(n?.reputation || 1))}%`,
        )
        .attr(
            "stop-color",
            (n) =>
                `rgba(25%,41%,88%,${calcNormalizedRep(n?.reputation || 1) / 2 + 0.5})`,
        );
    rg.append("stop")
        .attr("offset", "100%")
        .attr("stop-color", "rgba(100%,100%,100%,1)");
    g.append("circle")
        .attr("r", nodeRadius)
        .attr("style", (n) => `fill: url(#grad${n.id})`);

    g.append("text")
        .attr("class", "text")
        .attr("x", 1.5 * nodeRadius)
        .text((d) => d.name ?? "<no name>");

    Ns.exit().remove();
};

const drawStraightLink = (d: AttestationGraphLink, dvec: Vector): string => {
    if (!d.source?.x || !d.source.y || !d.target.x || !d.target.y) return "";
    return `M${d.source.x + dvec.x} ${d.source.y + dvec.y} L${d.target.x - dvec.x} ${d.target.y - dvec.y}`;
};
const drawArcLink = (d: AttestationGraphLink, dvec: Vector): string => {
    if (!d.source?.x || !d.source.y || !d.target.x || !d.target.y) return "";
    const dx = d.target.x - d.source.x;
    const dy = d.target.y - d.source.y;
    const dr = Math.sqrt(dx * dx + dy * dy);
    return `M${d.source.x + dvec.x},${d.source.y + dvec.y} A${dr},${dr} 0 0,1 ${d.target.x - dvec.x},${d.target.y - dvec.y}`;
};

export const drawLink =
    (
        simulation: d3.Simulation<AttestationGraphNode, AttestationGraphLink>,
        linkType: string,
        nodeRadius: number,
    ) =>
    (_d: AttestationGraphLink | AttestationGraphSecondaryLink): string => {
        const sourceNode = simulation.nodes().find((n) => {
            if (isD3ifiedLink(_d)) return n.id === _d.source?.id;
            else return n.id === _d.source;
        });
        const targetNode = simulation.nodes().find((n) => {
            if (isD3ifiedLink(_d)) return n.id === _d.target?.id;
            else return n.id === _d.target;
        });
        if (
            !sourceNode?.x ||
            !sourceNode?.y ||
            !targetNode?.x ||
            !targetNode?.y
        )
            return "";

        const d: AttestationGraphLink = {
            source: {
                id: isD3ifiedLink(_d) ? _d.source.id : _d.source,
                x: sourceNode.x,
                y: sourceNode.y,
            },
            target: {
                id: isD3ifiedLink(_d) ? _d.target.id : _d.target,
                x: targetNode.x,
                y: targetNode.y,
            },
        };

        // calc source-to-target vector (to approximate the curve)
        if (!d.source.x || !d.source.y || !d.target.x || !d.target.y) return "";
        const vec: Vector = {
            x: d.target.x - d.source.x,
            y: d.target.y - d.source.y,
        };
        // calc location of circumference by calculating a ratio between len(radius)/len(vec)
        let dvec: Vector = { x: 0, y: 0 };
        if (vec.x !== 0 && vec.y !== 0) {
            const vec_len = Math.pow(
                Math.pow(vec.x, 2) + Math.pow(vec.y, 2),
                0.5,
            );
            const vec_multiplier = nodeRadius / vec_len;
            dvec = { x: vec.x * vec_multiplier, y: vec.y * vec_multiplier };
        }

        if (linkType === SELECTOR.LINK) {
            return drawStraightLink(d, dvec);
        } else {
            // if (linkType === SELECTOR.BACK_LINK || linkType === SELECTOR.ACCOUNT_CREATION_LINK)
            return drawArcLink(d, dvec);
        }
    };

export const applyLinkColors = (
    uiOptions: UiOptions,
    selector: string,
    checked: boolean,
) => {
    d3.selectAll<SVGPathElement, AttestationGraphLink>(selector).attr(
        "style",
        `visibility: ${checked ? "visible" : "hidden"}`,
    );
    d3.selectAll<SVGPathElement, AttestationGraphLink>(selector).style(
        "stroke",
        uiOptions.colors[selector],
    );
    if (selector === SELECTOR.LINK) {
        applyCouncilDistance(
            JSON.parse(JSON.stringify(rawData[dataSetName])),
            uiOptions,
        );
    }
};

export const applyCouncilDistance = (
    graph: AttestationGraph,
    { checkCouncilDistance, councilDistance }: UiOptions,
) => {
    // remove all red-highlighting
    const Ls = d3.selectAll<SVGPathElement, AttestationGraphLink>(
        SELECTOR.LINK,
    );
    if (!Ls) return;
    Ls.attr("class", (_, idx, El) =>
        El[idx].classList
            .toString()
            .split(" ")
            .filter((cl) => cl !== "red-highlight")
            .join(" "),
    );

    // after removing all red-highlighting...
    if (!checkCouncilDistance) return;

    const councilLinks = getCouncilLinks(
        JSON.parse(JSON.stringify(graph)),
        councilDistance,
    );

    // existing highlighting already removed, so just apply new highlighting
    // remove any inline styling so we can apply classes and get special class-styling
    const existing_stroke = Ls.style("stroke");
    Ls.style("stroke", "");
    Ls.attr("class", (L, idx, El) => {
        if (
            councilLinks.find((link) => {
                return (
                    link.source.id === L.source.id &&
                    link.target.id === L.target.id
                );
            })
        ) {
            return El[idx].classList.toString() + " red-highlight";
        } else {
            El[idx].style.stroke = existing_stroke;
            return El[idx].classList.toString();
        }
    });
};
