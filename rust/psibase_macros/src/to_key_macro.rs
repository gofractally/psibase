use darling::FromDeriveInput;
use proc_macro::TokenStream;
use quote::quote;
use std::str::FromStr;
use syn::{parse_macro_input, Data, DataStruct, DeriveInput, Fields};

#[derive(Debug, FromDeriveInput)]
#[darling(default, attributes(to_key))]
pub struct Options {
    psibase_mod: String,
}

impl Default for Options {
    fn default() -> Self {
        Self {
            psibase_mod: "psibase".into(),
        }
    }
}

struct StructField<'a> {
    name: &'a proc_macro2::Ident,
    ty: &'a syn::Type,
}

fn struct_fields(data: &DataStruct) -> Vec<StructField> {
    match &data.fields {
        Fields::Named(named) => named
            .named
            .iter()
            .map(|field| StructField {
                name: field.ident.as_ref().unwrap(),
                ty: &field.ty,
            })
            .collect(),
        Fields::Unnamed(_) => unimplemented!("ToKey does not support unnamed fields"),
        Fields::Unit => unimplemented!("ToKey does not support unit struct"),
    }
}

pub fn to_key_macro_impl(input: TokenStream) -> TokenStream {
    let input = parse_macro_input!(input as DeriveInput);

    let opts = match Options::from_derive_input(&input) {
        Ok(val) => val,
        Err(err) => {
            return err.write_errors().into();
        }
    };
    let psibase_mod = proc_macro2::TokenStream::from_str(&opts.psibase_mod).unwrap();

    match &input.data {
        Data::Struct(data) => process_struct(&psibase_mod, &input, data),
        Data::Enum(_) => unimplemented!("ToKey does not support enum"),
        Data::Union(_) => unimplemented!("ToKey does not support union"),
    }
}

// TODO: compile time: verify no non-optionals are after an optional
// TODO: unpack: check optionals not in heap
fn process_struct(
    psibase_mod: &proc_macro2::TokenStream,
    input: &DeriveInput,
    data: &DataStruct,
) -> TokenStream {
    let name = &input.ident;
    let generics = &input.generics;
    let append_key = struct_fields(data)
        .iter()
        .map(|field| {
            let name = &field.name;
            let ty = &field.ty;
            quote! {
                <#ty as #psibase_mod::ToKey>::append_key(&self.#name, key);
            }
        })
        .fold(quote! {}, |acc, new| quote! {#acc #new});
    TokenStream::from(quote! {
        impl #generics #psibase_mod::ToKey for #name #generics {
            fn append_key(&self, key: &mut Vec<u8>) {
                #append_key
            }
        }
    })
} // process_struct
