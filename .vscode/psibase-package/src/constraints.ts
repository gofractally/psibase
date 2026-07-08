import { EntityType } from "./model";

export function constraintViolation(
  entity: EntityType,
  value: string,
): string | undefined {
  for (const constraint of ENTITY_CONSTRAINTS[entity]) {
    const msg = checkConstraint(constraint, value);
    if (msg) {
      return msg;
    }
  }
  return undefined;
}

const ENTITY_CONSTRAINTS: Record<EntityType, string[]> = {
  published_package: ["pascalCase"],
  package_crate: ["kebabCase"],
  service_crate: ["kebabCase"],
  query_crate: ["kebabCase"],
  plugin_crate: ["kebabCase"],
  wit_package: ["witPackage"],
  external_plugin: [],
  on_chain_service: ["accountNumber"],
  on_chain_query: ["accountNumberSubaccount"],
};

function checkConstraint(
  constraint: string,
  value: string,
): string | undefined {
  switch (constraint) {
    case "kebabCase":
      return validateKebabCase(value);
    case "cargoCrateName":
      return validateCargoCrateName(value);
    case "pascalCase":
      return validatePascalCase(value);
    case "witPackage":
      return validateWitPackage(value);
    case "accountNumber":
      return validateAccountNumber(value);
    case "accountNumberSubaccount":
      return validateAccountSubaccount(value);
    default:
      return undefined;
  }
}

function validateKebabCase(value: string): string | undefined {
  if (!value) return "name must not be empty";
  if (value.includes("_")) return "use kebab-case, not snake_case";
  if (/^[A-Z]/.test(value)) return "use kebab-case, not PascalCase";
  if (!/^[a-z0-9-]+$/.test(value)) {
    return "kebab-case allows only lowercase letters, digits, and hyphens";
  }
  if (/^-|-$|--/.test(value)) {
    return "hyphens must not be leading, trailing, or consecutive";
  }
  return undefined;
}

function validateCargoCrateName(value: string): string | undefined {
  if (!value) return "name must not be empty";
  if (/[A-Z]/.test(value)) return "Cargo crate names must be lowercase";
  if (!/^[a-z0-9_-]+$/.test(value)) {
    return "Cargo crate names allow only lowercase letters, digits, hyphens, and underscores";
  }
  return undefined;
}

function validatePascalCase(value: string): string | undefined {
  if (!value) return "name must not be empty";
  if (!/^[A-Z]/.test(value)) return "published package name must be PascalCase";
  if (/[-_]/.test(value)) {
    return "published package name must be PascalCase without separators";
  }
  if (!/^[A-Za-z0-9]+$/.test(value)) {
    return "PascalCase allows only letters and digits";
  }
  return undefined;
}

function validateWitPackage(value: string): string | undefined {
  const idx = value.indexOf(":");
  if (idx < 0) return "WIT package must end with `:plugin`";
  const base = value.slice(0, idx);
  const suffix = value.slice(idx + 1);
  if (suffix !== "plugin") return "WIT package must end with `:plugin`";
  return validateKebabCase(base);
}

function validateAccountNumber(value: string): string | undefined {
  if (!value) return "on-chain account name must not be empty";
  return validatePrimaryAccount(value);
}

function validateAccountSubaccount(value: string): string | undefined {
  if (!value) return "on-chain query account name must not be empty";
  const plus = value.indexOf("+");
  if (plus < 0) return "query account must use `{service}+{N}` format";
  const base = value.slice(0, plus);
  const sub = value.slice(plus + 1);
  if (!sub || !/^\d+$/.test(sub)) {
    return "subaccount suffix must be a positive integer";
  }
  if (sub === "0") return "subaccount suffix must be non-zero";
  return validatePrimaryAccount(base);
}

function validatePrimaryAccount(value: string): string | undefined {
  if (value.length > 10) return "account name must be at most 10 characters";
  if (/^-|-$|--/.test(value)) {
    return "hyphens must not be leading, trailing, or consecutive";
  }
  if (value.startsWith("x-")) return "account names must not begin with `x-`";
  if (!/^[a-z0-9-]+$/.test(value)) {
    return "account names allow only `a-z`, `0-9`, and `-`";
  }
  return undefined;
}
