#[allow(warnings)]
mod bindings;

use bindings::psibase::component_parser::types::{ComponentExtraction, Function, Functions, Intf};
use bindings::Guest as Parser;
use indexmap::IndexMap;
use wasm_compose::graph::Component;
use wit_component::{decode, WitPrinter};
use wit_parser::{Type, TypeDefKind, TypeOwner, World, WorldItem, WorldKey};

pub struct ComponentParser;

impl Default for Functions {
    fn default() -> Self {
        Functions {
            namespace: "root".to_string(),
            package: "component".to_string(),
            interfaces: Vec::new(),
            funcs: Vec::new(),
        }
    }
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

fn extract_wit(resolved_wit: &wit_parser::Resolve) -> Result<String, String> {
    let mut printer = WitPrinter::default();
    let mut wit = String::new();
    for (i, (id, _)) in resolved_wit.packages.iter().enumerate() {
        if i > 0 {
            wit.push_str("\n\n");
        }
        match printer.print(resolved_wit, id, &[]) {
            Ok(()) => wit = printer.output.to_string(),
            Err(e) => {
                // If we can't print the document, just use the error text
                wit = format!("{e:#}");
                break;
            }
        }
    }
    Ok(wit)
}

// This imported function is dynamically linking to another plugin if:
//   Its first parameter is a handle to an imported resource
//   called "plugin-ref" that is owned by the "host" service
fn is_linking_dynamically(func: &wit_parser::Function, resolved_wit: &wit_parser::Resolve) -> bool {
    if func.params.len() == 0 {
        return false;
    }

    let param_type = match func.params[0].1 {
        Type::Id(id) => resolved_wit.types.get(id).expect("Get param type failed"),
        _ => return false,
    };

    let handle = match param_type.kind {
        TypeDefKind::Handle(handle) => handle,
        _ => return false,
    };

    let guest_type = match handle {
        wit_parser::Handle::Own(id) => resolved_wit.types.get(id).expect("Get guest type failed"),
        _ => return false,
    };

    let guest_type_kind = match guest_type.kind {
        TypeDefKind::Type(ty) => ty,
        _ => return false,
    };

    let host_type = match guest_type_kind {
        Type::Id(id) => resolved_wit.types.get(id).expect("Get host type failed"),
        _ => return false,
    };

    let is_plugin_ref =
        host_type.name.as_ref().is_some() && host_type.name.as_ref().unwrap() == "plugin-ref";
    let is_resource = host_type.kind == TypeDefKind::Resource;

    let owner_interface = match host_type.owner {
        TypeOwner::Interface(id) => resolved_wit
            .interfaces
            .get(id)
            .expect("Get host type owner interface failed"),
        _ => return false,
    };

    if owner_interface.package.is_none() {
        return false;
    }

    let owner_package_id = owner_interface.package.unwrap();

    let owner_package = resolved_wit
        .packages
        .get(owner_package_id)
        .expect("Get host type owner package failed");

    let is_owner_host = owner_package.name.namespace == "host";

    is_plugin_ref && is_resource && is_owner_host
}

fn extract_functions<F>(resolved_wit: &wit_parser::Resolve, get_world_item: F) -> Functions
where
    F: Fn(&World) -> &IndexMap<WorldKey, WorldItem>,
{
    let worlds = &resolved_wit.worlds;
    assert_eq!(
        worlds.iter().count(),
        1,
        "Only 1 world allowed in merge wit"
    );

    let mut funcs = Functions::default();
    let (_, world) = worlds.iter().next().unwrap();
    for (world_key, item) in get_world_item(world) {
        match item {
            WorldItem::Interface { id, stability: _ } => {
                // Todo: consider omitting items based on the stability feature
                // (https://github.com/WebAssembly/component-model/pull/332)
                let intf = resolved_wit.interfaces.get(*id).unwrap();
                let pkg = resolved_wit.packages.get(intf.package.unwrap()).unwrap();
                let intf_name =
                    intf.name
                        .as_ref()
                        .map(|s| s.as_str())
                        .unwrap_or_else(|| match world_key {
                            WorldKey::Name(name) => name,
                            _ => panic!("Interface has no name in interface or world"),
                        });
                let mut new_intf = Intf {
                    namespace: pkg.name.namespace.to_owned(),
                    package: pkg.name.name.to_owned(),
                    name: kebab_to_camel(&intf_name),
                    funcs: vec![],
                };
                for (func_name, func) in &intf.functions {
                    //if _func.kind == FunctionKind::Method || _func.kind == FunctionKind::Constructor {
                    //  Then this is a method defined within a resource
                    //  But we can also extract this information while generating js bindings
                    //    from the function name
                    //}

                    let dynamic_link = is_linking_dynamically(func, resolved_wit);
                    new_intf.funcs.push(Function {
                        name: kebab_to_camel(&func_name.to_owned()),
                        dynamic_link,
                    });
                }
                funcs.interfaces.push(new_intf);
            }
            WorldItem::Function(func) => {
                let dynamic_link = is_linking_dynamically(func, resolved_wit);
                funcs.funcs.push(Function {
                    name: kebab_to_camel(&func.name.to_owned()),
                    dynamic_link,
                });
            }
            WorldItem::Type(_) => {}
        };
    }

    funcs
}

impl Parser for ComponentParser {
    fn parse(name: String, bytes: Vec<u8>) -> Result<ComponentExtraction, String> {
        let component = Component::from_bytes(name, bytes).map_err(|e| format!("{e:#}"))?;
        let decoded = decode(component.bytes()).map_err(|e| format!("{e:#}"))?;
        let resolve = decoded.resolve();

        Ok(ComponentExtraction {
            imported_funcs: extract_functions(resolve, |w: &World| &w.imports),
            exported_funcs: extract_functions(resolve, |w: &World| &w.exports),
            wit: extract_wit(resolve)?,
            debug: serde_json::to_string_pretty(&resolve).unwrap(),
        })
    }
}

bindings::export!(ComponentParser with_types_in bindings);

// Copy a component wasm into the root directory of this project and then this test will work.
// (Components are in `/build/components/*` )
//
// #[cfg(test)]
// mod tests {
//     use super::*;
//     use std::fs;

//     #[test]
//     fn test_parse_auth_any() {
//         let wasm_bytes = fs::read("auth-any.wasm").expect("Failed to read auth-any");
//         let result = ComponentParser::parse("auth-any".to_string(), wasm_bytes);

//         if let Ok(extraction) = result {
//             println!("WIT: {}", extraction.wit);
//             println!("DEBUG: {}", extraction.debug);
//         }
//     }
// }
