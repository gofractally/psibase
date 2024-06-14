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
  const debug = false
    if (targetDepth > 6) throw Error("Depth must be <= 6");
    councilLinks = [];
    // get Council members
    const councilMembers = graph.nodes.filter((n) => n.council);
    debug && console.info("getCouncilLinks(). graph", graph, "targetDepth", targetDepth, "councilMembers:", councilMembers)

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

    debug && console.info("sorting coucnilLinks... councilLinks:", councilLinks)
    // walk through councilLinks, eliminating dups
    councilLinks.sort(
      (a, b) => (a.source.id - b.source.id) * 100 + (a.target.id - b.target.id)
    );
    debug && console.info("councilLinks sorted:", councilLinks)
    let l_prev: AttestationGraphLink | undefined = undefined;
    // dedup councilLinks
    councilLinks = councilLinks.filter((l) => {
      // console.info(l_prev, l)
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
    debug && console.info("councilLinks deduped:", councilLinks)
    return councilLinks;
  }

  function recurseForCouncilLinks(graph: AttestationGraph, node: AttestationGraphNode, depth: number, targetDepth: number, pathLinks: AttestationGraphLink[]) {
    const debug = false;
    debug &&
      console.info(
        "recurseForCouncilLinks() ",
        graph,
        node,
        depth,
        targetDepth,
        pathLinks
      );
    if (depth > targetDepth) {
      debug && console.info("hit target depth");
      return;
    }
    if (visitedNodeIds.has(node)) {
      debug && console.info("hit visited node");
      return;
    }
    if (depth > 0 && node.council) {
      debug && console.info("found Council member; adding path");
      councilLinks = councilLinks.concat(pathLinks);
      debug && console.info("councilLinks:", councilLinks);
      return;
    }

    debug && console.info("going deeper...");
    visitedNodeIds.add(node.id);
    // for all links that start at this node, recurse to all its neighbors
    debug && console.info("graph.attestations:");
    debug && console.info(graph.attestations);
    const links = graph.attestations.filter((link) => {
      // console.info("link:", link, "node:", node);
      return link.source.id === node.id;
    });
    debug && console.info("links w matching source:", links);
    links.forEach((L) => {
      // debug && console.info("L:", L);
      const targetNode = graph.nodes.find((n) => n.id === L.target.id)
      if (!targetNode) throw Error("next targetNode DNE")
      recurseForCouncilLinks(
        graph,
        targetNode,
        depth + 1,
        targetDepth,
        pathLinks.concat([L])
      );
    });
    debug && console.info("recurseForCouncilLinks() returning");
    return;
  }

export const convertCyclicToAcyclicGraph = (orig_graph: AttestationGraph, { centeredNodeIdx, dagDepth }: UiOptions) => {
    const debug = false;
      let ls: AttestationGraphLink[] = [];
      const accountedFor = new Set<number>();
      const queue: AttestationGraphNode[][] = [[]];
      const ns: AttestationGraphNode[] = [];
      const graph = orig_graph;
      debug && console.info("convertCyclicToAcyclicGraph() centeredNodeIdx", centeredNodeIdx, "dagDepth", dagDepth)
    
      // start at nodes[0]
      let node = graph.nodes.find(n => n.id === centeredNodeIdx);
      if (!node) throw Error(`node id ${centeredNodeIdx} DNE`)
    //   NEEDED? centeredNode = node.name;
      let depth = 0;
      debug && console.info("centeredNodeIdx:", centeredNodeIdx, "node:", node);
      accountedFor.add(node.id);
      queue[depth].push(node);
      let iterations = 0;
      while (queue[depth].length > 0 && iterations < 30) {
          node = queue[depth].shift();
          if (!node) throw Error(`nothing left in the queue`)
          debug && console.info("==========");
          debug && console.info("queue:", queue.map(e => e));
          debug && console.info("ns:", ns.map(e => e));
          debug && console.info("ls:", ls.map(e => e));
          debug && console.info("node:", node);
            ns.push(node);
            // add all attestations where source = 0
            debug && console.info("attestations:", graph.attestations)
          const nextAttestations = graph.attestations.filter(l => {
            // iterate through all the attestations just added and for any nodes where link.targets unused link.source
            //   console.info(l.source === node.id && !accountedFor.has(l.target), l.source, node.id, l.target, !accountedFor.has(l.target));
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
          debug && console.info("queue.length:", queue.length)
          debug && console.info("depth+1:", depth+1)
          if (depth+1 >= queue.length) {
              queue[depth+1] = []
          }
          queue[depth+1] = queue[depth+1].concat(nextNodes);
          debug && console.info("--------");
          let accountedForStr = "";
          accountedFor.forEach(i => {
            accountedForStr += " " + i;
          });
          debug && console.info("accountedFor:", accountedForStr);
          debug && console.info("nextNodes:", nextNodes.map(e => e));
          debug && console.info("nextAttestations:", nextAttestations.map(e => e));
          debug && console.info("queue:", queue[depth].map(e => e));
          debug && console.info("ns:", ns.map(e => e));
          debug && console.info("ls:", ls.map(e => e));
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