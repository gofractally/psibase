use indexmap::IndexMap;
use wit_parser::{Type, TypeDefKind, TypeOwner, World, WorldItem, WorldKey};

use crate::{ParsedFunction, ParsedFunctions, ParsedInterface};

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

fn is_linking_dynamically(func: &wit_parser::Function, resolved_wit: &wit_parser::Resolve) -> bool {
    if func.params.is_empty() {
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

    let is_plugin_ref = host_type
        .name
        .as_ref()
        .is_some_and(|n| n == "plugin-ref");
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

pub fn extract_functions<F>(
    resolved_wit: &wit_parser::Resolve,
    get_world_item: F,
) -> ParsedFunctions
where
    F: Fn(&World) -> &IndexMap<WorldKey, WorldItem>,
{
    let worlds = &resolved_wit.worlds;
    assert_eq!(
        worlds.iter().count(),
        1,
        "Only 1 world allowed in merge wit"
    );

    let mut funcs = ParsedFunctions::default();
    let (_, world) = worlds.iter().next().unwrap();
    for (world_key, item) in get_world_item(world) {
        match item {
            WorldItem::Interface { id, stability: _ } => {
                let intf = resolved_wit.interfaces.get(*id).unwrap();
                let pkg = resolved_wit.packages.get(intf.package.unwrap()).unwrap();
                let intf_name = intf
                    .name
                    .as_ref()
                    .map(|s| s.as_str())
                    .unwrap_or_else(|| match world_key {
                        WorldKey::Name(name) => name,
                        _ => panic!("Interface has no name in interface or world"),
                    });
                let mut new_intf = ParsedInterface {
                    namespace: pkg.name.namespace.to_owned(),
                    package: pkg.name.name.to_owned(),
                    name: kebab_to_camel(intf_name),
                    funcs: vec![],
                };
                for (func_name, func) in &intf.functions {
                    let dynamic_link = is_linking_dynamically(func, resolved_wit);
                    new_intf.funcs.push(ParsedFunction {
                        name: kebab_to_camel(&func_name.to_owned()),
                        dynamic_link,
                    });
                }
                funcs.interfaces.push(new_intf);
            }
            WorldItem::Function(func) => {
                let dynamic_link = is_linking_dynamically(func, resolved_wit);
                funcs.funcs.push(ParsedFunction {
                    name: kebab_to_camel(&func.name.to_owned()),
                    dynamic_link,
                });
            }
            WorldItem::Type(_) => {}
        };
    }
    funcs
}
