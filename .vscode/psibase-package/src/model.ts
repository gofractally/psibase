export type EntityType =
  | "published_package"
  | "package_crate"
  | "service_crate"
  | "query_crate"
  | "plugin_crate"
  | "wit_package"
  | "external_plugin"
  | "on_chain_service"
  | "on_chain_query";

export interface Location {
  file: string;
  line: number;
  startCol: number;
  endCol: number;
}

export interface Occurrence {
  entity: EntityType;
  groupId: string;
  value: string;
  location: Location;
  /** Append "(s)" to inlay label (e.g. `services` array entries). */
  inlayPlural?: boolean;
  /** Show inlay immediately after the identifier instead of at end of line. */
  inlayInline?: boolean;
}

export interface PackageScan {
  packageRoot: string;
  occurrences: Occurrence[];
}

export type Severity = "error" | "warning";

export interface Diagnostic {
  severity: Severity;
  code: string;
  message: string;
  location: Location;
  entity?: EntityType;
  groupId?: string;
}

export const ENTITY_META: Record<
  EntityType,
  {
    label: string;
    role: string;
    convention: string;
    constraints: string[];
  }
> = {
  published_package: {
    label: "Published package (.psi)",
    role: "Name of the built `.psi` artifact and installed package.",
    convention: "PascalCase; output filename is case-sensitive",
    constraints: ["pascalCase"],
  },
  package_crate: {
    label: "Package crate",
    role: "Root wrapper crate for this psibase package.",
    convention: "kebab-case with `-pkg` suffix (e.g. `name-market-pkg`)",
    constraints: ["cargoCrateName"],
  },
  service_crate: {
    label: "Service crate",
    role: "Cargo crate for the service implementation.",
    convention: "kebab-case (e.g. `name-market`)",
    constraints: ["kebabCase"],
  },
  query_crate: {
    label: "Query crate",
    role: "Cargo crate for the GraphQL query service.",
    convention:
      "kebab-case with `r-` prefix (e.g. `r-name-market`); often abbreviated with on-chain account",
    constraints: ["kebabCase"],
  },
  plugin_crate: {
    label: "Plugin crate",
    role: "Cargo crate for the WASM plugin.",
    convention: "kebab-case with `-plugin` suffix (e.g. `name-market-plugin`)",
    constraints: ["kebabCase"],
  },
  wit_package: {
    label: "WIT component package",
    role: "WIT component package identifier for the plugin.",
    convention:
      "kebab-case service crate + `:plugin` (e.g. `name-market:plugin`); independent of on-chain account",
    constraints: ["witPackage"],
  },
  external_plugin: {
    label: "External plugin",
    role: "Package name of another plugin this component imports.",
    convention:
      "Must match the provider's component `package` (e.g. `tokens:plugin`, `host:types`)",
    constraints: [],
  },
  on_chain_service: {
    label: "On-chain service account",
    role: "On-chain account name for the service.",
    convention:
      "≤10 chars; `a-z`, `0-9`, `-`; no leading/trailing/double hyphen; often abbreviated vs service crate",
    constraints: ["accountNumber"],
  },
  on_chain_query: {
    label: "On-chain query account",
    role: "On-chain account name for the query service.",
    convention: "`{on-chain-service}+N` subaccount format; `+1` is usual",
    constraints: ["accountNumberSubaccount"],
  },
};
