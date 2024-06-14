import { SimulationNodeDatum } from "d3";
import { ChangeEventHandler, MouseEventHandler } from "react";

export interface GraphFixtureData {
  [dataSet: string]: AttestationGraph;
}

export const isD3ifiedLink = (link: AttestationGraphLink | AttestationGraphSecondaryLink): link is AttestationGraphLink => {
  return (link as AttestationGraphLink).source.id !== undefined && (link as AttestationGraphLink).target.id !== undefined;
}

export interface AttestationGraphNode extends SimulationNodeDatum {
  id: number;
  index?: number;
  name?: string;
  reputation?: number;
  council?: boolean;
}

export interface AttestationGraphSecondaryLink {
  source: number;
  target: number;
}

export interface AttestationGraphLink extends SimulationNodeDatum {
  source: AttestationGraphNode;
  target: AttestationGraphNode;
}

export interface NodeAwareLink {
  source: {
    id: number;
    x: number;
    y: number;
  }
  target: {
    id: number;
    x: number;
    y: number;
  }
}

export interface NodeUnawareLink {
  source: number;
  target: number;
}

export interface AttestationGraph {
  nodes: AttestationGraphNode[];
  attestations: AttestationGraphLink[];
  backAttestations?: AttestationGraphLink[];
  ["account-creations"]: AttestationGraphLink[];
}

export interface UiOptions {
    graphMode: string;
    centeredNodeIdx: number;
    dagDepth: number;
    councilDistance: number;
    checkAttestations: boolean;
    checkBackAttestations: boolean;
    checkAccountCreations: boolean;
    checkCouncilDistance: boolean;
    colors: {
      [linkTypeSelector: string]: string,
    },
  }

export interface UiOptionsHandlers {
    handleGraphDepthChange: (newDepth: number) => void,
    handleCouncilDistanceChange: (newCouncilDistance: number) => void,
    handleCheckAttestations: MouseEventHandler<HTMLInputElement>,
    handleCheckBackAttestations: MouseEventHandler<HTMLInputElement>,
    handleCheckAccountCreations: MouseEventHandler<HTMLInputElement>,
    handleCheckCouncilDistance: MouseEventHandler<HTMLInputElement>,
    handleResetToFullGraph: () => void,
    handleLinkColorChange: (selector: string) => ChangeEventHandler<HTMLInputElement>,
}

export interface Vector {
  x: number,
  y: number,
}
