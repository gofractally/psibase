#[allow(warnings)]
mod bindings;

use bindings::psibase::component_parser::types::{ComponentExtraction, QualifiedFunc};
use bindings::Guest as Parser;
use indexmap::IndexMap;
use wasm_compose::graph::Component;
use wit_component::{decode, WitPrinter};
use wit_parser::{World, WorldItem, WorldKey};

pub struct ComponentParser;

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

fn extract_functions<F>(resolved_wit: &wit_parser::Resolve, get_world_item: F) -> Vec<QualifiedFunc>
where
    F: Fn(&World) -> &IndexMap<WorldKey, WorldItem>,
{
    let worlds = &resolved_wit.worlds;
    assert_eq!(
        worlds.iter().count(),
        1,
        "Only 1 world allowed in merge wit"
    );

    let mut funcs: Vec<QualifiedFunc> = vec![];
    let (_, world) = worlds.iter().next().unwrap();
    for (_, item) in get_world_item(world) {
        match item {
            WorldItem::Interface(i) => {
                let intf = resolved_wit.interfaces.get(*i).unwrap();
                let pkg = resolved_wit.packages.get(intf.package.unwrap()).unwrap();
                for (func_name, _) in &intf.functions {
                    funcs.push(QualifiedFunc {
                        namespace: pkg.name.namespace.to_owned(),
                        package: pkg.name.name.to_owned(),
                        intf: intf.name.to_owned(),
                        func_name: kebab_to_camel(&func_name.to_owned()),
                    });
                }
            }
            WorldItem::Function(func) => {
                funcs.push(QualifiedFunc {
                    // It is not important to know what the component self-reports its identity to be.
                    // It's true namespace/package name are equal to the registry domain at which
                    //   the component was retrieved.
                    namespace: "root".to_string(),
                    package: "component".to_string(),
                    intf: None,
                    func_name: kebab_to_camel(&func.name.to_owned()),
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
