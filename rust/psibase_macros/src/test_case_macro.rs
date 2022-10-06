use darling::FromMeta;
use proc_macro::TokenStream;
use proc_macro_error::abort;
use quote::quote;
use std::collections::HashMap;
use syn::{
    parse_macro_input, parse_quote, Ident, Item, ItemFn, Lit, LitStr, NestedMeta, ReturnType,
};

#[derive(Debug)]
struct Services(Vec<LitStr>);

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
            services: Services(Vec::new()),
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
        Item::Fn(func) => process_fn(&options, func),
        _ => {
            abort!(item, "test_case attribute may only be used on a function")
        }
    }
}

fn process_fn(options: &Options, mut func: ItemFn) -> TokenStream {
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

    let locations = std::env::var("CARGO_PSIBASE_SERVICE_LOCATIONS");
    if locations.is_err() {
        func.sig.ident = Ident::new(
            &(func.sig.ident.to_string() + "_psibase_test_get_needed_services"),
            func.sig.ident.span(),
        );
        let prints = options.services.0.iter().fold(
            quote! {},
            |acc, x| quote! {#acc println!("psibase-test-need-service {} {}:{}", #x, file!(), line!());},
        );
        func.block = parse_quote! {{#prints}};
        return quote! {
            #[::std::prelude::v1::test]
            #func
        }
        .into();
    }

    let _locations: HashMap<_, _> = locations
        .unwrap()
        .split(';')
        .collect::<Vec<_>>()
        .chunks(2)
        .map(|x| (x[0], x[1]))
        .collect();
    let mut block = func.block;

    if !inputs.is_empty() {
        let name = func.sig.ident.to_string();
        block = parse_quote! {{
            fn inner(#inputs) #block
            let mut chain = psibase::Chain::new();
            for trx in psibase::create_boot_transactions(
                &None,
                psibase::account!("prod"),
                false,
                false,
                false,
                psibase::TimePointSec { seconds: 10 },
            ) {
                if let Err(e) = chain.push(&trx).ok() {
                    panic!("test {} failed with {:?}", #name, e);
                }
            }
            inner(chain)
        }};
    }

    if matches!(output, ReturnType::Type(_, _)) {
        let ident = &func.sig.ident;
        block = parse_quote! {{
            if let Err(e) = #block {
                panic!("test {} failed with {:?}", #ident, e);
            }
        }};
    }

    func.block = block;
    quote! {
        #[::std::prelude::v1::test]
        #func
    }
    .into()
}
