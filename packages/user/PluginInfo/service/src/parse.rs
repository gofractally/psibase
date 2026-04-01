use crate::tables::tables::*;
use psibase::{abort_message, AccountNumber};
use std::collections::HashSet;
use wasmparser::component_types::{
    ComponentAnyTypeId, ComponentDefinedType, ComponentEntityType, ComponentFuncType,
    ComponentFuncTypeId, ComponentInstanceTypeId, ComponentValType, ResourceId,
};
use wasmparser::types::Types;
use wasmparser::{Encoding, Parser, Payload, Validator};

fn component_parse_abort(service: AccountNumber, path: &str, detail: &str) -> ! {
    abort_message(&format!("{detail} (service={service}, path={path})"))
}

fn kebab_to_camel(s: &str) -> String {
    s.split('-')
        .enumerate()
        .map(|(i, part)| {
            if i == 0 {
                part.to_string()
            } else {
                part[..1].to_uppercase() + &part[1..]
            }
        })
        .collect()
}

fn parse_interface_extern(name: &str) -> Option<(String, String, String)> {
    let head = name.split_once('@').map(|(a, _)| a).unwrap_or(name);
    let (ns_pkg, interface) = head.rsplit_once('/')?;
    let (namespace, package) = ns_pkg.split_once(':')?;
    if namespace.is_empty() || package.is_empty() || interface.is_empty() {
        return None;
    }
    Some((
        namespace.to_string(),
        package.to_string(),
        interface.to_string(),
    ))
}

fn export_func_display_name(export_name: &str) -> String {
    if export_name.starts_with('[') {
        if let Some(dot) = export_name.rfind('.') {
            kebab_to_camel(&export_name[dot + 1..])
        } else {
            kebab_to_camel(export_name)
        }
    } else {
        kebab_to_camel(export_name)
    }
}

fn collect_top_level_import_export_names(
    service: AccountNumber,
    path: &str,
    bytes: &[u8],
) -> (Vec<String>, Vec<String>) {
    let mut imports = Vec::new();
    let mut exports = Vec::new();
    let mut depth = 0usize;
    let mut saw_version = false;

    let do_abort = |detail: &str| -> ! { component_parse_abort(service, path, detail) };

    for payload in Parser::new(0).parse_all(bytes) {
        let payload = payload.unwrap_or_else(|_| do_abort("failed to parse wasm component"));

        match &payload {
            Payload::Version { encoding, .. } => {
                if depth == 0 {
                    saw_version = true;
                    if *encoding != Encoding::Component {
                        do_abort("expected a wasm component");
                    }
                }
            }
            Payload::ComponentImportSection(reader) => {
                if depth == 0 {
                    for imp in reader.clone() {
                        let imp = imp.unwrap_or_else(|_| do_abort("invalid component import"));
                        imports.push(imp.name.0.to_string());
                    }
                }
            }
            Payload::ComponentExportSection(reader) => {
                if depth == 0 {
                    for exp in reader.clone() {
                        let exp = exp.unwrap_or_else(|_| do_abort("invalid component export"));
                        exports.push(exp.name.0.to_string());
                    }
                }
            }
            Payload::ModuleSection { .. } | Payload::ComponentSection { .. } => {
                depth += 1;
            }
            Payload::End(_) => {
                if depth > 0 {
                    depth -= 1;
                }
            }
            _ => {}
        }
    }

    if !saw_version {
        component_parse_abort(service, path, "invalid wasm: missing version header");
    }

    (imports, exports)
}

fn collect_host_plugin_ref_resources(
    types: &Types,
    import_names: &[String],
) -> HashSet<ResourceId> {
    let mut set = HashSet::new();
    for name in import_names {
        if !name.starts_with("host:") {
            continue;
        }
        let Some(entity) = types.component_entity_type_of_import(name.as_str()) else {
            continue;
        };
        let ComponentEntityType::Instance(inst_id) = entity else {
            continue;
        };
        let inst = &types[inst_id];
        for (export_name, export_entity) in &inst.exports {
            if export_name.as_str() != "plugin-ref" {
                continue;
            }
            if let ComponentEntityType::Type { created, .. } = export_entity {
                if let ComponentAnyTypeId::Resource(rid) = created {
                    set.insert(rid.resource());
                }
            }
        }
    }
    set
}

fn is_dynamic_from_first_param(
    types: &Types,
    func_id: ComponentFuncTypeId,
    host_plugin_refs: &HashSet<ResourceId>,
) -> bool {
    let func: &ComponentFuncType = &types[func_id];
    let Some((_, first_ty)) = func.params.first() else {
        return false;
    };
    match first_ty {
        ComponentValType::Primitive(_) => false,
        ComponentValType::Type(def_id) => match &types[*def_id] {
            ComponentDefinedType::Own(alias_rid) => {
                host_plugin_refs.contains(&alias_rid.resource())
            }
            _ => false,
        },
    }
}

fn push_instance_exports(
    types: &Types,
    inst_id: ComponentInstanceTypeId,
    namespace: String,
    package: String,
    interface: String,
    out: &mut ParsedFunctions,
    host_plugin_refs: &HashSet<ResourceId>,
) {
    let inst = &types[inst_id];
    let mut funcs = Vec::new();
    for (export_name, export_entity) in &inst.exports {
        if let ComponentEntityType::Func(func_id) = export_entity {
            funcs.push(ParsedFunction {
                name: export_func_display_name(export_name.as_str()),
                dynamic_link: is_dynamic_from_first_param(types, *func_id, host_plugin_refs),
            });
        }
    }
    out.interfaces.push(ParsedInterface {
        namespace,
        package,
        name: kebab_to_camel(&interface),
        funcs,
    });
}

fn entity_to_parsed(
    types: &Types,
    name: &str,
    entity: ComponentEntityType,
    out: &mut ParsedFunctions,
    host_plugin_refs: &HashSet<ResourceId>,
) {
    match entity {
        ComponentEntityType::Instance(inst_id) => {
            if let Some((ns, pkg, intf)) = parse_interface_extern(name) {
                push_instance_exports(types, inst_id, ns, pkg, intf, out, host_plugin_refs);
            }
        }
        ComponentEntityType::Func(func_id) => {
            out.funcs.push(ParsedFunction {
                name: kebab_to_camel(name),
                dynamic_link: is_dynamic_from_first_param(types, func_id, host_plugin_refs),
            });
        }
        _ => {}
    }
}

fn build_side(
    types: &Types,
    names: &[String],
    imports: bool,
    host_plugin_refs: &HashSet<ResourceId>,
) -> ParsedFunctions {
    let mut out = ParsedFunctions::default();
    for name in names {
        let entity = if imports {
            types.component_entity_type_of_import(name.as_str())
        } else {
            types.component_entity_type_of_export(name.as_str())
        };
        let Some(entity) = entity else {
            continue;
        };
        entity_to_parsed(types, name.as_str(), entity, &mut out, host_plugin_refs);
    }
    out
}

pub fn parse_component(
    service: AccountNumber,
    path: &str,
    bytes: &[u8],
) -> (ParsedFunctions, ParsedFunctions) {
    let mut validator = Validator::new();
    let types = validator.validate_all(bytes).unwrap_or_else(|_| {
        component_parse_abort(service, path, "failed to validate wasm component")
    });

    let (import_names, export_names) = collect_top_level_import_export_names(service, path, bytes);
    let host_plugin_refs = collect_host_plugin_ref_resources(&types, &import_names);

    let imported = build_side(&types, &import_names, true, &host_plugin_refs);
    let exported = build_side(&types, &export_names, false, &host_plugin_refs);
    (imported, exported)
}
