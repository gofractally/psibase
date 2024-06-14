import * as d3 from "d3";
import rawData from "./members-fixture";
import { getCouncilLinks } from "./graph-data";
import { AttestationGraph, AttestationGraphLink, AttestationGraphNode, AttestationGraphSecondaryLink, NodeAwareLink, UiOptions, Vector, isD3ifiedLink } from "./types";
import { SELECTOR, dataSetName } from "./constants";

export const handleSimulationTick = (simulation: d3.Simulation<AttestationGraphNode, AttestationGraphLink>, nodeRadius: number) => () => {
    // console.info("handleSimulationTick().simulation", simulation, "nodeRadius", nodeRadius)
    // Nodes can be moved
    const svg = d3.select("#canvas")
    svg.selectAll<SVGGElement, AttestationGraphNode>('.node')
        .attr("cx", (d) => { return d.x || null })
        .attr("cy", (d) => { return d.y || null })
        .attr("transform", function (d) {
            return "translate(" + d.x + "," + d.y + ")";
        });

    // Links need to be recalculated for each tick
    svg.selectAll<SVGPathElement, AttestationGraphLink>('.link')
        .attr("d", drawLink(simulation, SELECTOR.LINK, nodeRadius));  
    svg.selectAll<SVGPathElement, AttestationGraphLink>('.back-link')
        .attr("d", drawLink(simulation, SELECTOR.BACK_LINK, nodeRadius));
    svg.selectAll<SVGPathElement, AttestationGraphLink>('.account-creation-link')
        .attr("d", drawLink(simulation, SELECTOR.ACCOUNT_CREATION_LINK, nodeRadius));
}

export const calcNormalizedRep = (repScore: number) => {
    const rep = repScore - 1.0; // since no normal member can get less than a rank of 1 in a meeting
    const maxRep = 5.0;
    return rep / maxRep;
  };

const addLinks = (attestations: AttestationGraphLink[]) => {
    const link = d3.select("#canvas").selectAll<SVGPathElement, AttestationGraphLink>('.link').data(attestations);
    link.enter()
        .insert('path', '.node')
        .attr('class', 'link')
    link // this is redundant, given I wipe the entire svg before rerendering, but I should figure this out at some point
        .exit()
        .remove();
}

function addAccountCreationLineage(accountCreations: AttestationGraphLink[]) {
    if (!accountCreations)
        return;
    // else
    //     console.info("adding account-creations")
    const svg = d3.select("#canvas")
    const link = svg.selectAll<SVGPathElement, AttestationGraphLink>('.account-creation-link').data(accountCreations);
    link.enter()
      .insert('path', '.node')
      .attr('class', 'account-creation-link')
    link
      .exit()
      .remove();
  }
  
  function addBackAttestations(backAttestations: AttestationGraphLink[]) {
    const debug = false;
    if (!backAttestations)
        return;
    else
        debug && console.info("adding backAttestations")
    const svg = d3.select("#canvas")
    const link = svg.selectAll<SVGPathElement, AttestationGraphLink>('.back-link').data(backAttestations);
    link.enter()
      .insert('path', '.node')
      .attr('class', 'back-link')
    link
      .exit()
      .remove();
  }

export const addAllLinks = (graph: AttestationGraph) => {
    // addNodes(graph.nodes, centeredNodeIdx, nodeRadius);
    addLinks(graph.attestations);
    addAccountCreationLineage(graph["account-creations"]);
    if (graph.backAttestations)
        addBackAttestations(graph.backAttestations);
  }

export const addNodes = (nodes: AttestationGraphNode[], centeredNodeIdx: number, nodeRadius: number) => {
    const debug = false
    debug && console.info("addNodes().top nodes", nodes, "centeredNodeIdx", centeredNodeIdx, "nodeRadius:", nodeRadius);
    debug && console.info("graph.nodes:");
    debug && console.info(nodes);
    const Ns = d3.select("#canvas").selectAll<SVGGElement, AttestationGraphNode>(".node").data(nodes);
    debug && console.info("Ns:", Ns)
    const g = Ns.enter().append("g").attr("class", "node");
    debug && console.info("g:", g)
    debug && console.info("g appended");
    const rg = g.append("radialGradient").attr("id", (n) => `grad${n.id}`);
    debug && console.info("rg:", rg)
    //   .attr("cx", "50%")
    //   .attr("cy", "50%")
    //   .attr("r", "50%")
    //   .attr("fx", "50%")
    //   .attr("fy", "50%")
    rg.append("stop")
      .attr(
        "offset",
        (n) => `${Math.round(100 * calcNormalizedRep(n?.reputation || 1))}%`
      )
      .attr(
        "stop-color",
        (n) =>
          `rgba(25%,41%,88%,${calcNormalizedRep(n?.reputation || 1) / 2 + 0.5})`
      ); //"royalblue")
    rg.append("stop")
      .attr("offset", "100%")
      .attr("stop-color", "rgba(100%,100%,100%,1)"); //"white")
    debug && console.info("appending circle...")
    g.append("circle")
      .attr("r", nodeRadius)
      .attr("style", (n) => {
        // const rep = n.reputation - 1.0; // since no normal member can get less than a rank of 1 in a meeting
        // const maxRep = 5.0;
        // for the alpha channel, we want to fade the low reputation people, so...
        // invert reputation (so high numbers mean *less translucency),
        // compress the range by a factor 2 so it only applies to the lower half of reputation (and doesn't at all diminish the high reputations)
        // divide by maxRep to create a 0-1.0 ranged number,
        // then finally invert that number since alpha=0 is transparent and alpha=1 is opaque
        // const opacity: number = 1.0 - (maxRep - rep) / 2.0 / maxRep;
        // const lowRepColor: number = Math.round(((maxRep - rep) / maxRep) * 100);
        // const highRepColor: number = Math.round((rep / maxRep) * 100);
        //console.info(`node color: rep(${rep}), rgba(${lowRepColor}%,${highRepColor}%,0%,${opacity})`);
        // original red-to-green: return `fill: rgba(${lowRepColor}%,${highRepColor}%,0%,${opacity})`;
        return `fill: url(#grad${n.id})`;
      })

    debug && console.info("appending text...")
    g.append("text")
      .attr("class", "text")
      .attr("x", 1.5 * nodeRadius)
      .text((d) => d.name ?? "<no name>");
    
    Ns.exit().remove();
  }
  
const drawStraightLink = (d: NodeAwareLink, dvec: Vector) => {
  return `M${d.source.x + dvec.x} ${d.source.y + dvec.y} L${d.target.x - dvec.x} ${d.target.y - dvec.y}`;
}
const drawArcLink = (d: NodeAwareLink, dvec: Vector) => {
    const dx = d.target.x - d.source.x;
    const dy = d.target.y - d.source.y;
    const dr = Math.sqrt(dx * dx + dy * dy);
    return `M${d.source.x + dvec.x},${d.source.y + dvec.y} A${dr},${dr} 0 0,1 ${d.target.x - dvec.x},${d.target.y - dvec.y}`;
}

export const drawLink = (simulation: d3.Simulation<AttestationGraphNode, AttestationGraphLink>, linkType: string, nodeRadius: number) => (_d: AttestationGraphLink | AttestationGraphSecondaryLink): string => {
    const debug = false
    debug && console.info("drawLink().top d:", JSON.parse(JSON.stringify(_d)), "linkType:", linkType);

    // TODO: This type error is due to the fact that links are comin in here at more than just AttestationGraphLinks; they've been augmented by d3 with position info
    // Whereas the back-links and account-creation-links haven't been augmented, so they don't have the structure to source and target (so they're source and target are number number)
    const sourceNode = simulation.nodes().find(n => {
      if (isD3ifiedLink(_d))
        return n.id === (_d.source?.id)
      else
        return n.id === (_d.source)
    });
    const targetNode = simulation.nodes().find(n => {
      if (isD3ifiedLink(_d))
        return n.id === (_d.target?.id)
      else
        return n.id === (_d.target)
    });
    // debug && console.info("1 _d:", _d, " sourceNode:", sourceNode, "targetNode:", targetNode)
    if (!sourceNode?.x || !sourceNode?.y || !targetNode?.x || !targetNode?.y) return "";

    const d: NodeAwareLink = {
        source: {
            id: isD3ifiedLink(_d) ? _d.source.id : _d.source,
            x: sourceNode.x,
            y: sourceNode.y,
        },
        target: {
            id: isD3ifiedLink(_d) ? _d.target.id : _d.target,
            x: targetNode.x,
            y: targetNode.y,
        }
    };
    // debug && console.info("constructed d:", d);

    // const dx = d.target.x - d.source.x;
    // const dy = d.target.y - d.source.y;
    // const dr = Math.sqrt(dx * dx + dy * dy);
  // calc adjustment for node radius
  // calc source-to-target vector (to approximate the curve)
  if (!d.source.x || !d.source.y || !d.target.x || !d.target.y) return "";
  const vec: Vector = {
    x: d.target.x - d.source.x,
    y: d.target.y - d.source.y
  };
  // calc location of circumference by calculating a ratio between len(radius)/len(vec)
  let dvec: Vector = { x: 0, y: 0 };
  if (vec.x !== 0 && vec.y !== 0) {
    const vec_len = Math.pow(Math.pow(vec.x, 2) + Math.pow(vec.y, 2), 0.5);
    const vec_multiplier = nodeRadius / vec_len;
    dvec = { x: vec.x * vec_multiplier, y: vec.y * vec_multiplier}
  }

  debug && console.info("linkType:", linkType, (linkType === SELECTOR.LINK));
  if (linkType === SELECTOR.LINK) {
    // console.info("processing .link...")
    return drawStraightLink(d, dvec);
  }
  else { // if (linkType === SELECTOR.BACK_LINK || linkType === SELECTOR.ACCOUNT_CREATION_LINK)
    // console.info("processing NOT .link...")
    return drawArcLink(d, dvec);
  }
}

export const applyLinkColors = (uiOptions: UiOptions, selector: string, checked: boolean) => {
    d3.selectAll<SVGPathElement, AttestationGraphLink>(selector).attr(
      "style",
      `visibility: ${checked ? "visible" : "hidden"}`
    );
    d3.selectAll<SVGPathElement, AttestationGraphLink>(selector).style(
      "stroke",
      uiOptions.colors[selector]
    );
    if (selector === SELECTOR.LINK) {
      applyCouncilDistance(
        JSON.parse(JSON.stringify(rawData[dataSetName])),
        uiOptions
      );
    }
  }

export const applyCouncilDistance = (graph: AttestationGraph, {checkCouncilDistance, councilDistance}: UiOptions) => {
    const debug = false;
    debug && console.info("applyCouncilDistance().top");
    
    // remove all red-highlighting
    const Ls = d3.selectAll<SVGPathElement, AttestationGraphLink>(SELECTOR.LINK)
    if (!Ls) return;
    Ls.attr("class", (_, idx, El) => El[idx].classList.toString().split(" ").filter((cl) => cl !== "red-highlight").join(" "))

    // after removing all red-highlighting...
    if (!checkCouncilDistance) return;

    const councilLinks = getCouncilLinks(
      JSON.parse(JSON.stringify(graph)),
      councilDistance
    );

    // existing highlighting already removed, so just apply new highlighting
    // remove any inline styling so we can apply classes and get special class-styling
    Ls.style("stroke", "");
    Ls.attr("class", (L, idx, El) => {
      if (
        councilLinks.find((link) => {
          debug && console.info("council link:", link, "link considered:", L)
          return (
            link.source.id === L.source.id && link.target.id === L.target.id
          );
        })
      ) {
        return El[idx].classList.toString() + " red-highlight";
      } else {
        return El[idx].classList.toString();
      }
    });
  };