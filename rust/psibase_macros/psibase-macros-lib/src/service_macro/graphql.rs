use quote::quote;
use syn::ItemFn;

pub fn process_gql_union_member(
    psibase_mod: &proc_macro2::TokenStream,
    event_struct: &proc_macro2::TokenStream,
    f: &ItemFn,
    enumerators: &mut proc_macro2::TokenStream,
    dispatch: &mut proc_macro2::TokenStream,
) {
    let name = &f.sig.ident;
    let name_str = name.to_string();

    *enumerators = quote! {
        #enumerators
        #name(#name),
    };
    *dispatch = quote! {
        #dispatch

        #psibase_mod::method_raw!(#name_str) => {
            Ok(#event_struct::#name(#psibase_mod::decode_event_data::<#name>(gql_imp_data)?))
        },
    };
}

pub fn process_gql_union(
    psibase_mod: &proc_macro2::TokenStream,
    event_struct: &proc_macro2::TokenStream,
    enumerators: &proc_macro2::TokenStream,
    dispatch: &proc_macro2::TokenStream,
    db: &proc_macro2::TokenStream,
    out: &mut proc_macro2::TokenStream,
) {
    *out = quote! {
        #out
        #[derive(async_graphql::Union)]
        pub enum #event_struct {
            #enumerators
        }
        impl #psibase_mod::DecodeEvent for #event_struct {
            fn decode(gql_imp_type: #psibase_mod::MethodNumber, gql_imp_data: &[u8]) -> Result<#event_struct, anyhow::Error> {
                match gql_imp_type.value {
                    #dispatch
                    _ => { Err(anyhow::anyhow!("Unknown event type")) }
                }
            }
        }
        impl #psibase_mod::EventDb for #event_struct {
            fn db() -> #psibase_mod::DbId {
                #psibase_mod::DbId::#db
            }
        }
    };
}
