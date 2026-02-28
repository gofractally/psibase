use proc_macro::TokenStream;
use quote::quote;
use syn::{parse_macro_input, Data, DeriveInput, Meta};

pub fn plugin_error_derive_impl(input: TokenStream) -> TokenStream {
    let input = parse_macro_input!(input as DeriveInput);
    let name = &input.ident;

    let is_enum = matches!(input.data, Data::Enum(_));
    if !is_enum {
        return syn::Error::new(
            input.ident.span(),
            "PluginError can only be derived for enums",
        )
        .to_compile_error()
        .into();
    }

    let has_repr_u32 = input.attrs.iter().any(|attr| {
        if attr.path.is_ident("repr") {
            if let Ok(Meta::List(meta_list)) = attr.parse_meta() {
                meta_list.nested.iter().any(|nested| {
                    if let syn::NestedMeta::Meta(Meta::Path(path)) = nested {
                        path.is_ident("u32")
                    } else {
                        false
                    }
                })
            } else {
                false
            }
        } else {
            false
        }
    });

    if !has_repr_u32 {
        return syn::Error::new(
            input.ident.span(),
            "PluginError requires #[repr(u32)] on the enum",
        )
        .to_compile_error()
        .into();
    }

    let expanded = quote! {
        unsafe impl psibase_plugin::error_trait::PluginError for #name {}
    };

    TokenStream::from(expanded)
}
