import { useEffect, useRef, useState } from "react";
import * as d3 from "d3";

import "./App.css";
import {
  addAllLinks,
  addNodes,
  applyCouncilDistance,
  applyLinkColors,
  handleSimulationTick,
} from "./graph-drawing";
import { initSimulation } from "./simulations";
import rawData from "./members-fixture";
import { Sidebar } from "./Sidebar";
import { convertCyclicToAcyclicGraph } from "./graph-data";
import { SvgCanvas } from "./SvgCanvas";
import {
  AttestationGraph,
  AttestationGraphLink,
  AttestationGraphNode,
  UiOptions,
} from "./types";
import {
  SELECTOR,
  dataSetName,
  defaultUiOptions,
  height,
  nodeRadius,
  reenergizingForce,
  viewBoxScalar,
  viewBoxWidth,
  width,
} from "./constants";

function App() {
  const opt1 = true; // false => Links; true => no Links
  const opt2 = !opt1;

  const [rerenderSidebar, setTerenderSidebar] = useState<boolean>(false);
  const simulation = useRef<
    d3.Simulation<AttestationGraphNode, AttestationGraphLink>
  >(d3.forceSimulation<AttestationGraphNode, AttestationGraphLink>());
  const uiOptions = useRef<UiOptions>(defaultUiOptions);

  const deployNewGraph = () => {
    const graphCopy = JSON.parse(JSON.stringify(rawData[dataSetName]));
    const graph =
      uiOptions.current.centeredNodeIdx >= 0
        ? convertCyclicToAcyclicGraph(graphCopy, uiOptions.current)
        : graphCopy;

    // ATTEMPT to apply the link force only to links currently shown in graph; didn't work
    // Option 1: just recreate the simulation with the new graph
    if (opt1) kickOffSimulation(graph);
    // Option 2 (didn't work): Try to reset the link force to only apply to current graph's attestations (rather than all attestations)
    // simulation.current.force(
    //   "link",
    //   d3.forceLink(graph.attestations).distance(120).strength(1)
    // );

    // 5: add/remove/update links to/in DOM and style them
    addAllLinks(graph);
    applyLinkColors(
      uiOptions.current,
      SELECTOR.LINK,
      uiOptions.current.checkAttestations
    );
    applyLinkColors(
      uiOptions.current,
      SELECTOR.BACK_LINK,
      uiOptions.current.checkBackAttestations
    );
    applyLinkColors(
      uiOptions.current,
      SELECTOR.BACK_LINK,
      uiOptions.current.checkAccountCreations
    );

    d3.selectAll<SVGGElement, AttestationGraphNode>(".node").attr(
      "class",
      (n) =>
        "node" +
        (n.council ? " council" : "") +
        (n.id === uiOptions.current.centeredNodeIdx ? " centered" : "")
    );

    simulation.current.alpha(reenergizingForce);
    simulation.current.restart();
  };

  const centerThisNode = () => {
    const centeredNode = d3
      .selectAll<SVGGElement, AttestationGraphNode>(".node")
      .data()
      .find((n) => n.id === uiOptions.current.centeredNodeIdx);
    // console.info("centeredNode:", centeredNode);
    if (centeredNode) {
      centeredNode.x = 0;
      centeredNode.y = 0;
    }
  };

  const kickOffSimulation = (graph: AttestationGraph) => {
    // 3: Define and kick off the simulation
    simulation.current = initSimulation(graph, width, height, centerThisNode);

    simulation.current
      .on("tick", handleSimulationTick(simulation.current, nodeRadius))
      .alphaDecay(0.002); // just added alpha decay to delay end of execution
    // 4: add/remove/update nodes to/in DOM and style them
    addNodes(graph.nodes, uiOptions.current.centeredNodeIdx, nodeRadius);

    // deployNewGraph();

    d3.select("#canvas")
      .selectAll<SVGCircleElement, AttestationGraphNode>("circle")
      .on("click", (_, node) => {
        if (!!node && node?.id !== uiOptions.current.centeredNodeIdx) {
          uiOptions.current.centeredNodeIdx = node.id;
          if (uiOptions.current.centeredNodeIdx === -1)
            uiOptions.current.graphMode = "fullGraph";
          else uiOptions.current.graphMode = "subGraph";
          setTerenderSidebar((prev) => !prev);

          d3.select("#canvas")
            .selectAll<SVGGElement, AttestationGraphNode>(".node")
            .attr(
              "class",
              (n) =>
                "node" +
                (n.council ? " council" : "") +
                (n.id === uiOptions.current.centeredNodeIdx ? " centered" : "")
            );
        }

        // To Ensure a decent layout of a fresh graph
        // Option 1: regenerate the simulation from scratch
        // kickOffSimulation();
        // Option 2: don't regenerate the simulation; just redraw it (layout isn't as good)
        deployNewGraph();
      });
  };

  useEffect(() => {
    if (opt2) {
      const graphCopy = JSON.parse(JSON.stringify(rawData[dataSetName]));
      kickOffSimulation(graphCopy);
    }
    deployNewGraph();
  }, []);

  const handleLinkColorChange =
    (selector: string) => (e: React.ChangeEvent<HTMLInputElement>) => {
      console.info(
        `handleLinkColorChange(${selector}) newvalue:${e.target.value}`
      );
      const selectedColor = e!.target.value;
      uiOptions.current.colors[selector] = selectedColor;
      setTerenderSidebar((prev) => !prev);
      const checked =
        (selector === SELECTOR.LINK && uiOptions.current.checkAttestations) ||
        (selector === SELECTOR.BACK_LINK &&
          uiOptions.current.checkBackAttestations) ||
        (selector === SELECTOR.ACCOUNT_CREATION_LINK &&
          uiOptions.current.checkAccountCreations);
      applyLinkColors(uiOptions.current, selector, checked);
    };

  const handleGraphDepthChange = (newDepthStr: number) => {
    uiOptions.current.dagDepth = newDepthStr;
    setTerenderSidebar((prev) => !prev);
    deployNewGraph();
  };

  const handleCouncilDistanceChange = (newDistance: number) => {
    // console.info("handleCouncilDistanceChange().top newDistance", newDistance);
    uiOptions.current.councilDistance = newDistance;
    setTerenderSidebar((prev) => !prev);
    applyCouncilDistance(
      JSON.parse(JSON.stringify(rawData[dataSetName])),
      uiOptions.current
    );
  };

  const handleCheckAttestations = (e: React.MouseEvent<HTMLInputElement>) => {
    const checked = e.currentTarget.checked;
    uiOptions.current.checkAttestations = checked;
    setTerenderSidebar((prev) => !prev);
    applyLinkColors(uiOptions.current, SELECTOR.LINK, checked);
  };

  const handleCheckBackAttestations = (
    e: React.MouseEvent<HTMLInputElement>
  ) => {
    const checked = e.currentTarget.checked;
    uiOptions.current.checkBackAttestations = checked;
    setTerenderSidebar((prev) => !prev);
    applyLinkColors(uiOptions.current, SELECTOR.BACK_LINK, checked);
  };

  const handleCheckAccountCreations = (
    e: React.MouseEvent<HTMLInputElement>
  ) => {
    const checked = e.currentTarget.checked;
    uiOptions.current.checkAccountCreations = checked;
    setTerenderSidebar((prev) => !prev);
    applyLinkColors(uiOptions.current, SELECTOR.ACCOUNT_CREATION_LINK, checked);
  };

  const handleResetToFullGraph = () => {
    if (uiOptions.current.graphMode === "subGraph") {
      d3.selectAll<SVGPathElement, AttestationGraphLink>(".back-link").remove();

      uiOptions.current.graphMode = "fullGraph";
      uiOptions.current.centeredNodeIdx = -1;
      setTerenderSidebar((prev) => !prev);
      deployNewGraph();
    }
  };
  const handleCheckCouncilDistance = (
    e: React.MouseEvent<HTMLInputElement>
  ) => {
    const checked = e.currentTarget.checked;
    // console.info("handleApplyCouncilDistance().top");
    uiOptions.current.checkCouncilDistance = checked;
    setTerenderSidebar((prev) => !prev);
    applyLinkColors(
      uiOptions.current,
      SELECTOR.LINK,
      uiOptions.current.checkAttestations
    );
  };

  //console.info("render()...");
  return (
    <div>
      <Sidebar
        rerenderSidebar={rerenderSidebar}
        uiOptions={uiOptions.current}
        handlers={{
          handleLinkColorChange,
          handleGraphDepthChange,
          handleCouncilDistanceChange,
          handleCheckAttestations,
          handleCheckBackAttestations,
          handleCheckAccountCreations,
          handleCheckCouncilDistance,
          handleResetToFullGraph,
        }}
      />
      <div className="workspace">
        <SvgCanvas
          width={width}
          height={height}
          viewBoxWidth={viewBoxWidth}
          viewBoxScalar={viewBoxScalar}
        />
      </div>
    </div>
  );
}

export default App;
