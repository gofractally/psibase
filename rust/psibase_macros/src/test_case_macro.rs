use darling::FromMeta;
use proc_macro::TokenStream;
use proc_macro_error::abort;
use quote::quote;
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
    func.sig.inputs = Default::default();
    func.sig.output = ReturnType::Default;
    func.sig.ident = Ident::new(
        &(func.sig.ident.to_string() + "_psibase_test_get_needed_services"),
        func.sig.ident.span(),
    );
    if std::env::var_os("CARGO_PSIBASE_ENABLE_TEST").is_none() {
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

    todo!()
}
