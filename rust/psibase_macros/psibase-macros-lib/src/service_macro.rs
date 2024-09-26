use std::str::FromStr;

use darling::ast::NestedMeta;
use darling::{Error, FromMeta};
use proc_macro2::TokenStream;
use proc_macro_error::abort;
use quote::quote;
use syn::{Item, ItemMod};

#[derive(Debug, FromMeta)]
#[darling(default)]
pub struct Options {
    name: String,
    recursive: bool,
    constant: String,
    actions: String,
    wrapper: String,
    structs: String,
    history_events: String,
    ui_events: String,
    merkle_events: String,
    event_structs: String,
    dispatch: Option<bool>,
    pub_constant: bool,
    psibase_mod: String,
    gql: bool,
}

impl Default for Options {
    fn default() -> Self {
        Options {
            name: "".into(),
            recursive: false,
            constant: "SERVICE".into(),
            actions: "Actions".into(),
            wrapper: "Wrapper".into(),
            structs: "action_structs".into(),
            history_events: "HistoryEvents".into(),
            ui_events: "UiEvents".into(),
            merkle_events: "MerkleEvents".into(),
            event_structs: "event_structs".into(),
            dispatch: None,
            pub_constant: true,
            psibase_mod: "psibase".into(),
            gql: true,
        }
    }
}

pub fn service_macro_impl(attr: TokenStream, item: TokenStream) -> TokenStream {
    let attr_args = match NestedMeta::parse_meta_list(attr) {
        Ok(v) => v,
        Err(e) => {
            return TokenStream::from(Error::from(e).write_errors());
        }
    };

    let mut options: Options = match Options::from_list(&attr_args) {
        Ok(val) => val,
        Err(err) => {
            return err.write_errors().into();
        }
    };

    if options.name.is_empty() {
        options.name = std::env::var("CARGO_PKG_NAME").unwrap().replace('_', "-");
    }
    if options.dispatch.is_none() {
        options.dispatch = Some(std::env::var_os("CARGO_PRIMARY_PACKAGE").is_some());
    }
    if std::env::var_os("CARGO_PSIBASE_TEST").is_some() {
        options.dispatch = Some(false);
    }
    let psibase_mod = proc_macro2::TokenStream::from_str(&options.psibase_mod).unwrap();
    let item = syn::parse2::<syn::Item>(item).unwrap();
    match item {
        Item::Mod(impl_mod) => process_mod(&options, &psibase_mod, impl_mod),
        _ => {
            abort!(item, "service attribute may only be used on a module")
        }
    }
}

fn process_mod(
    _options: &Options,
    _psibase_mod: &proc_macro2::TokenStream,
    mut _impl_mod: ItemMod,
) -> TokenStream {
    quote! {
        42
    }
    .into()
}
