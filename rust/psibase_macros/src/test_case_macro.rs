use darling::FromMeta;
use proc_macro::TokenStream;
use proc_macro2::Span;
use proc_macro_error::abort;
use quote::quote;
use std::collections::HashSet;
use syn::{parse_macro_input, parse_quote, Item, ItemFn, Lit, LitStr, NestedMeta, ReturnType};

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
    packages: Services,
}

impl Default for Options {
    fn default() -> Self {
        Options {
            services: Services(HashSet::new()),
            packages: Services(HashSet::new()),
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

    let reg = if let Ok(local_packages) = std::env::var("CARGO_PSIBASE_PACKAGE_PATH") {
        let mut load_registry = quote! {
            let mut registry = psibase::JointRegistry::new();
        };
        for path in std::env::split_paths(&local_packages) {
            let path = LitStr::new(path.as_os_str().to_str().unwrap(), Span::mixed_site());
            load_registry = quote! {
                #load_registry
                registry.push(psibase::DirectoryRegistry::new(std::path::Path::new(#path).to_path_buf()))?;
            }
        }
        quote! {
            {
                #load_registry
                registry.push(psibase::Chain::default_registry())?;
                registry
            }
        }
    } else {
        quote! {
            psibase::Chain::default_registry()
        }
    };

    let mut block = *func.block;

    if !inputs.is_empty() {
        let name = func.sig.ident.to_string();
        let packages =
            options
                .packages
                .0
                .iter()
                .fold(quote! { "DevDefault".to_string() }, |acc, p| {
                    quote! {
                        #acc, #p.to_string()
                    }
                });
        block = parse_quote! {{
            fn with_chain(#inputs) #output #block
            fn create_chain() -> Result<psibase::Chain, psibase::Error> {
                use psibase::*;

                let mut chain = psibase::Chain::new();
                chain.boot_with(&#reg, &[#packages])?;

                println!("\n\n>>> {}: Chain Tester Booted & Services Deployed - Running test...", #name);
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

    func.block = block.into();
    quote! {
        #[::std::prelude::v1::test]
        #func
    }
    .into()
}
