#[allow(warnings)]
mod bindings;

use bindings::psibase::component_parser::types::{ComponentExtraction, Functions, Intf};
use bindings::Guest as Parser;
use indexmap::IndexMap;
use wasm_compose::graph::Component;
use wit_component::{decode, WitPrinter};
use wit_parser::{World, WorldItem, WorldKey};

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
        match printer.print(resolved_wit, id) {
            Ok(s) => wit.push_str(&s),
            Err(e) => {
                // If we can't print the document, just use the error text
                wit = format!("{e:#}");
                break;
            }
        }
    }
    Ok(wit)
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
    for (_, item) in get_world_item(world) {
        match item {
            WorldItem::Interface(i) => {
                let intf = resolved_wit.interfaces.get(*i).unwrap();
                let pkg = resolved_wit.packages.get(intf.package.unwrap()).unwrap();
                let mut new_intf = Intf {
                    namespace: pkg.name.namespace.to_owned(),
                    package: pkg.name.name.to_owned(),
                    name: intf.name.to_owned().unwrap(),
                    funcs: vec![],
                };
                for (func_name, _) in &intf.functions {
                    new_intf.funcs.push(kebab_to_camel(&func_name.to_owned()));
                }
                funcs.interfaces.push(new_intf);
            }
            WorldItem::Function(func) => {
                funcs.funcs.push(kebab_to_camel(&func.name.to_owned()));
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
        let resolved_wit = decoded.resolve();

        Ok(ComponentExtraction {
            imported_funcs: extract_functions(resolved_wit, |w: &World| &w.imports),
            exported_funcs: extract_functions(resolved_wit, |w: &World| &w.exports),
            wit: extract_wit(resolved_wit)?,
            debug: serde_json::to_string(&resolved_wit).unwrap(),
        })
    }
}

bindings::export!(ComponentParser with_types_in bindings);
