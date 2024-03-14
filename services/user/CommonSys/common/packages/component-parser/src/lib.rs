#[allow(warnings)]
mod bindings;

use bindings::exports::psibase::component_parser::intf;
use intf::{ComponentExtraction, ImportedFunc};
use wit_component::{decode, WitPrinter};
use wit_parser::Package;

pub struct ComponentParser;

fn split_import(imp: &String) -> (String, String, String) {
    let parts: Vec<&str> = imp.split(':').collect();
    assert!(parts.len() == 2);
    let namespace = parts[0];

    let parts: Vec<&str> = parts[1].split('/').collect();
    assert!(parts.len() == 2);

    let comp = parts[0];
    let interf = parts[1];

    (namespace.to_string(), comp.to_string(), interf.to_string())
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

impl intf::Guest for ComponentParser {
    fn parse(name: String, bytes: Vec<u8>) -> Result<ComponentExtraction, String> {
        // Todo - What should name be here?
        let component = wasm_compose::graph::Component::from_bytes(name, bytes)
            .map_err(|e| format!("{e:#}"))?;

        let named_imports: Vec<(String, String, String)> = component
            .imports()
            .map(|(_, name, _)| split_import(&name.to_string()))
            .collect();

        let is_import =
            |i: &(String, String, String)| named_imports.iter().any(|import| import == i);

        let decoded = decode(component.bytes()).map_err(|e| format!("{e:#}"))?;
        let resolve = decoded.resolve();

        // Get all packages referenced by the component
        let packages: Vec<&Package> = resolve
            .packages
            .iter()
            .map(|(_, package)| package)
            .collect();

        // Get all import functions from the packages
        let mut imported_funcs: Vec<ImportedFunc> = Vec::new();
        for package in packages {
            let mut package_imported_funcs: Vec<ImportedFunc> = package
                .interfaces
                .iter()
                .filter(|&(intf_name, _)| {
                    is_import(&(
                        package.name.namespace.to_owned(),
                        package.name.name.to_owned(),
                        intf_name.to_owned(),
                    ))
                })
                .map(|(_, id)| {
                    let interface = resolve.interfaces.get(*id).unwrap();
                    let func_names: Vec<ImportedFunc> = interface
                        .functions
                        .iter()
                        .map(|(_, func)| ImportedFunc {
                            comp_intf: format!(
                                "{}:{}/{}",
                                package.name.namespace,
                                package.name.name,
                                interface.name.to_owned().unwrap(),
                            ),
                            func_name: kebab_to_camel(&func.name.to_owned()),
                        })
                        .collect();
                    func_names
                })
                .flatten()
                .collect();
            imported_funcs.append(&mut package_imported_funcs);
        }

        // Extract a wit file from the component for debugging purposes
        let mut printer = WitPrinter::default();
        let mut wit = String::new();
        for (i, (id, _)) in resolve.packages.iter().enumerate() {
            if i > 0 {
                wit.push_str("\n\n");
            }
            match printer.print(resolve, id) {
                Ok(s) => wit.push_str(&s),
                Err(e) => {
                    // If we can't print the document, just use the error text
                    wit = format!("{e:#}");
                    break;
                }
            }
        }

        Ok(ComponentExtraction {
            imported_funcs: imported_funcs,
            wit: wit,
        })
    }
}

bindings::export!(ComponentParser with_types_in bindings);
