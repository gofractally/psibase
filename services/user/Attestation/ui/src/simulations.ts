import * as d3 from "d3";
import { AttestationGraph, AttestationGraphLink, AttestationGraphNode } from "./types";

// Custom force to put all nodes in a box
const boxingForce = (graph: AttestationGraph, width: number, height: number) => () => {
    const framePadding = 50;
	graph.nodes.forEach(node => {
		if (!node.x || !node.y) return
		// Of the positions exceed the box, set them to the boundary position.
		// You may want to include your nodes width to not overlap with the box.
		node.x = Math.max(-width/2+framePadding, Math.min(width/2-framePadding, node.x));
		node.y = Math.max(-height/2+framePadding, Math.min(height/2-framePadding, node.y));
    });
}

export const initSimulation = (graph: AttestationGraph, width: number, height: number, centerThisNode: () => void) => {
	// Define the params of the simulation
	const simulation = d3.forceSimulation<AttestationGraphNode, AttestationGraphLink>()
		.nodes(graph.nodes)
		//.force("center", d3.forceCenter(width / 2, 0.6 * height).strength(0.01))
		.force("bounding-box", boxingForce(graph, width, height))
		.force("center", d3.forceCenter(0, 0).strength(0.01))
		.force("link", d3.forceLink(graph.attestations).distance(120).strength(1))
		.force("charge", d3.forceManyBody().strength(-100))
		//.force("charge", d3.forceCollide(30).strength(1))
		//.force("x", d3.forceX())
		//.force("y", d3.forceY())
		.force("center-the-target-node", centerThisNode);
	return simulation
}
