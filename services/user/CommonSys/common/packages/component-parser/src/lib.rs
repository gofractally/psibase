#[allow(warnings)]
mod bindings;

use bindings::exports::psibase::component_parser::provider::{GuestComponentParser, Component, Export, Import, ItemKind};
use wit_component::WitPrinter;
use wasmparser::{ComponentExternalKind, ComponentTypeRef};

pub struct ComponentParser;

impl bindings::exports::psibase::component_parser::provider::Guest for ComponentParser {
    type ComponentParser = ComponentParser;
}

impl GuestComponentParser for ComponentParser {

    fn new() -> Self {
        Self {}
    }

    fn parse(&self, name: String, bytes: Vec::<u8>) -> Result<Component, String>
    {
        let component = wasm_compose::graph::Component::from_bytes(name, bytes)
            .map_err(|e| format!("{e:#}"))?;

            // Extract a wit file from the component.
            let wit = match wit_component::decode(component.bytes()) {
                Ok(decoded) => {
                    // Print the wit for the component
                    let resolve = decoded.resolve();
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
                    wit
                }
                Err(e) => {
                    // If we can't decode the component, just use the error text
                    format!("{e:#}")
                }
            };

            Ok(
                Component {
                name: component.name().to_string(),
                imports: component
                    .imports()
                    .map(|(_, name, ty)| Import {
                        name: name.to_string(),
                        kind: match ty {
                            ComponentTypeRef::Module(_) => ItemKind::Module,
                            ComponentTypeRef::Func(_) => ItemKind::Function,
                            ComponentTypeRef::Value(_) => ItemKind::Value,
                            ComponentTypeRef::Type(_) => ItemKind::Type,
                            ComponentTypeRef::Instance(_) => ItemKind::Instance,
                            ComponentTypeRef::Component(_) => ItemKind::Component,
                        },
                    })
                    .collect(),
                exports: component
                    .exports()
                    .map(|(_, name, kind, _)| Export {
                        name: name.to_string(),
                        kind: match kind {
                            ComponentExternalKind::Module => ItemKind::Module,
                            ComponentExternalKind::Func => ItemKind::Function,
                            ComponentExternalKind::Value => ItemKind::Value,
                            ComponentExternalKind::Type => ItemKind::Type,
                            ComponentExternalKind::Instance => ItemKind::Instance,
                            ComponentExternalKind::Component => ItemKind::Component,
                        },
                    })
                    .collect(),
                wit,
            })
    }
}

bindings::export!(ComponentParser with_types_in bindings);