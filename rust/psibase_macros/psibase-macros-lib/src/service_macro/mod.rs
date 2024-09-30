use darling::ast::NestedMeta;
use darling::Error;
use proc_macro2::TokenStream;
use proc_macro_error::abort;

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
