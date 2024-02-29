use darling::{FromMeta, ToTokens};
use proc_macro::TokenStream;
use proc_macro_error::{abort, emit_error};
use quote::quote;
use std::collections::{HashMap, HashSet};
use syn::{
    parse, parse_macro_input, parse_quote, visit_mut::VisitMut, Expr, Ident, Item, ItemFn, Lit,
    LitStr, Macro, NestedMeta, ReturnType,
};

#[derive(Debug)]
struct Services(HashSet<LitStr>);

impl FromMeta for Services {
    fn from_list(items: &[NestedMeta]) -> Result<Self, darling::Error> {
        let items: Result<_, _> = items
            .iter()
            .map(|item| match &item {
                NestedMeta::Lit(lit) => {
                    if let Lit::Str(x) = lit {
                        Ok(x.clone())
                    } else {
                        Err(darling::Error::custom("expected list of string"))
                    }
                }
                NestedMeta::Meta(_) => Err(darling::Error::custom("expected list of string"))?,
            })
            .collect();
        Ok(Self(items?))
    }
}

#[derive(Debug, FromMeta)]
#[darling(default)]
struct Options {
    services: Services,
}

impl Default for Options {
    fn default() -> Self {
        Options {
            services: Services(HashSet::new()),
        }
    }
}

pub fn test_case_macro_impl(attr: TokenStream, item: TokenStream) -> TokenStream {
    let attr = parse_macro_input!(attr as syn::AttributeArgs);
    let options = match Options::from_list(&attr) {
        Ok(val) => val,
        Err(err) => {
            return err.write_errors().into();
        }
    };
    let item = parse_macro_input!(item as Item);
    match item {
        Item::Fn(func) => process_fn(options, func),
        _ => {
            abort!(item, "test_case attribute may only be used on a function")
        }
    }
}

fn process_fn(options: Options, mut func: ItemFn) -> TokenStream {
    if func.sig.generics.lt_token.is_some() {
        abort!(
            func.sig.generics.lt_token,
            "generics not supported in test_case"
        )
    }
    if func.sig.inputs.len() > 1 {
        abort!(func.sig.inputs, "test_case has more than 1 argument")
    }

    let inputs = func.sig.inputs;
    let output = func.sig.output;
    func.sig.inputs = Default::default();
    func.sig.output = ReturnType::Default;

    let mut load_services = LoadServices {
        requests: options.services.0,
        locations: None,
    };

    let env = std::env::var("CARGO_PSIBASE_SERVICE_LOCATIONS");
    if let Ok(locations) = env {
        load_services.locations = Some(
            locations
                .split(';')
                .collect::<Vec<_>>()
                .chunks(2)
                .filter_map(|x| {
                    if x.len() == 2 {
                        Some((x[0].to_owned(), x[1].to_owned()))
                    } else {
                        None
                    }
                })
                .collect(),
        );
    }

    let mut block = *func.block;

    if !inputs.is_empty() {
        let name = func.sig.ident.to_string();
        let deploy_services: TokenStream = load_services.requests.iter().fold(quote! {}, |acc: TokenStream, s: &LitStr| {
            let ss = s.value().replace('_', "-");
            quote! {
                #acc
                chain.deploy_service(psibase::account!(#ss), include_service!(#s))?;
            }
        });
        block = parse_quote! {{
            fn with_chain(#inputs) #output #block
            fn create_chain() -> Result<psibase::Chain, psibase::Error> {
                let mut chain = psibase::Chain::new();

                let (boot_tx, subsequent_tx) = in psibase::create_boot_transactions(
                    &None,
                    psibase::account!("prod"),
                    false,
                    false,
                    psibase::TimePointSec { seconds: 10 },
                );
                
                for trx in boot_tx {
                    chain.push(&trx).ok()?;
                }
                
                for trx in subsequent_tx {
                    chain.push(&trx).ok()?;
                }

                #deploy_services
                Ok(chain)
            }
            let chain = create_chain();
            if let Err(e) = chain {
                panic!("test {} failed with {:?}", #name, e);
            }
            with_chain(chain.unwrap())
        }};
    }

    if matches!(output, ReturnType::Type(_, _)) {
        let ident = func.sig.ident.to_string();
        block = parse_quote! {{
            fn with_output() #output #block
            if let Err(e) = with_output() {
                panic!("test {} failed with {:?}", #ident, e);
            }
        }};
    }

    load_services.visit_block_mut(&mut block);

    if load_services.locations.is_none() {
        func.sig.ident = Ident::new(
            &(func.sig.ident.to_string() + "_psibase_test_get_needed_services"),
            func.sig.ident.span(),
        );
        let prints = load_services.requests.iter().fold(
            quote! {},
            |acc, x| quote! {#acc println!("psibase-test-need-service {} {}:{}", #x, file!(), line!());},
        );
        // Preserves the original code to enable rust-analyzer and other tools to function
        block = parse_quote! {{
            #[allow(unused_macros)]
            macro_rules! include_service {
                ($service:expr) => {
                    &[] as &[u8]
                };
            }
            fn skip_so_cargo_psibase_can_get_deps() #block
            if false {
                skip_so_cargo_psibase_can_get_deps()
            } else {
                #prints
            }
        }};
    }

    func.block = block.into();
    quote! {
        #[::std::prelude::v1::test]
        #func
    }
    .into()
}

struct LoadServices {
    requests: HashSet<LitStr>,
    locations: Option<HashMap<String, String>>,
}

impl VisitMut for LoadServices {
    fn visit_macro_mut(&mut self, node: &mut Macro) {
        if node.path.to_token_stream().to_string() == "include_service" {
            let expr = parse::<Expr>(node.tokens.clone().into());
            if let Ok(Expr::Lit(lit)) = expr {
                if let Lit::Str(lit) = lit.lit {
                    let service = lit.value();
                    if let Some(locations) = &mut self.locations {
                        if let Some(path) = locations.get(service.as_str()) {
                            node.path = parse_quote! {::std::prelude::v1::include_bytes};
                            node.tokens = parse_quote! {#path};
                            return;
                        }
                        emit_error! {node, "Service \"{}\" not present", service};
                        return;
                    } else {
                        self.requests.insert(lit);
                        return;
                    }
                }
            }
            emit_error! {node, "Expected service name. e.g. include_service!(\"example\")"};
        }
    }
}
