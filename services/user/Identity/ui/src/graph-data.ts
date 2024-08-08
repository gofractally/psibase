import { AttestationGraph, AttestationGraphLink, AttestationGraphNode, UiOptions } from "./types";

let councilLinks: AttestationGraphLink[] = [];
const visitedNodeIds = new Set();

const addBackAttestationsToGraph = (nodesInGraph: AttestationGraphNode[], linksInGraph: AttestationGraphLink[], graphData: AttestationGraph) => {
	const ns = nodesInGraph;
	const ls = linksInGraph;
	// 1. get all attestations that target nodes in the graph
	const backAttestations = graphData.attestations.filter(L => ns.find(n => n.id === L.target.id));
	// 2. filter out attestations that are *forward* attestations, i.e., already in the ls list
	return backAttestations.filter(bl => !ls.find(L => L.source.id === bl.source.id && L.target.id === bl.target.id))
}

export const getCouncilLinks = (graph: AttestationGraph, targetDepth: number) => {
    if (targetDepth > 6) throw Error("Depth must be <= 6");
    councilLinks = [];
    // get Council members
    const councilMembers = graph.nodes.filter((n) => n.council);

    visitedNodeIds.clear();
    councilMembers.forEach((n) => {
      recurseForCouncilLinks(
        JSON.parse(JSON.stringify(graph)),
        n,
        0,
        targetDepth,
        []
      );
    });

    // walk through councilLinks, eliminating dups
    councilLinks.sort(
      (a, b) => (a.source.id - b.source.id) * 100 + (a.target.id - b.target.id)
    );
    let l_prev: AttestationGraphLink | undefined = undefined;
    councilLinks = councilLinks.filter((l) => {
      if (
        l.target !== l_prev?.target ||
        l.source !== l_prev?.source
      ) {
        l_prev = l;
        return true;
      } else {
        return false;
      }
    });
    return councilLinks;
  }

  function recurseForCouncilLinks(graph: AttestationGraph, node: AttestationGraphNode, depth: number, targetDepth: number, pathLinks: AttestationGraphLink[]) {
    if (depth > targetDepth) return;
    if (visitedNodeIds.has(node)) return; // Is this right? What if a node is approached from different directions and different council members?
    // if a council member is encountered, return links (what links exactly?)
    if (depth > 0 && node.council) {
      console.info("stopping at node:", node, "; adding pathLinks:", pathLinks, "; depth:", depth, "; returning...");
      councilLinks = councilLinks.concat(pathLinks);
      console.info("councilLinks:", councilLinks);
      return;
    }

    visitedNodeIds.add(node.id);
    // for all links that start at this node, recurse to all its neighbors
    const linksFromThisNode = graph.attestations.filter((link) => {
      return link.source.id === node.id;
    });
    linksFromThisNode.forEach((L) => {
      // find all the nodes this node has attested
      const nodeAttestedTo = graph.nodes.find((n) => n.id === L.target.id)
      if (!nodeAttestedTo) throw Error("next nodeAttestedTo DNE")
      // and look at the nodes they point at (until we hit our requested depth)
      recurseForCouncilLinks(
        graph,
        nodeAttestedTo,
        depth + 1,
        targetDepth,
        pathLinks.concat([L])
      );
    });
    return;
  }

export const convertCyclicToAcyclicGraph = (orig_graph: AttestationGraph, { centeredNodeIdx, dagDepth }: UiOptions) => {
      let ls: AttestationGraphLink[] = [];
      const accountedFor = new Set<number>();
      const queue: AttestationGraphNode[][] = [[]];
      const ns: AttestationGraphNode[] = [];
      const graph = orig_graph;
    
      let node = graph.nodes.find(n => n.id === centeredNodeIdx);
      if (!node) throw Error(`node id ${centeredNodeIdx} DNE`)
      let depth = 0;
      accountedFor.add(node.id);
      queue[depth].push(node);
      let iterations = 0;
      while (queue[depth].length > 0 && iterations < 30) {
          node = queue[depth].shift();
          if (!node) throw Error(`nothing left in the queue`)
            ns.push(node);
          const nextAttestations = graph.attestations.filter(l => {
            // iterate through all the attestations just added and for any nodes where link.targets unused link.source
              return l.source.id === node!.id && !accountedFor.has(l.target.id);
          });
          const nextNodes: AttestationGraphNode[] = nextAttestations.reduce((acc: AttestationGraphNode[], l) => {
            if(!accountedFor.has(l.target.id)) {
              const foundNode = graph.nodes.find(n => l.target.id == n.id)
              if (foundNode) acc.push(foundNode)
            }
            return acc
          }, [])
          nextNodes.forEach(n => {
            // TODO: should this be necessary?
            if (!n) return;
            accountedFor.add(n.id);
          });
          ls = ls.concat(nextAttestations);
          if (depth+1 >= queue.length) {
              queue[depth+1] = []
          }
          queue[depth+1] = queue[depth+1].concat(nextNodes);

          // if there are no more nodes at this depth to process, go one step deeper
          if (queue[depth].length === 0) {
              depth++;
          }
          if (depth >= dagDepth)
              queue[depth] = []
  
          iterations++;
      }
      //return { nodes: ns.sort((a, b) => a.id - b.id), attestations: ls };
      const backAttestations = addBackAttestationsToGraph(ns, ls, graph);
        // return { nodes: graph.nodes, attestations: ls.concat(backAttestations), backAttestations: backAttestations };
      return { nodes: graph.nodes, attestations: ls, backAttestations: backAttestations };
  }