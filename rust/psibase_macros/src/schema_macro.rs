use crate::fracpack_macro::Options as FracpackOptions;
use darling::FromDeriveInput;
use proc_macro::TokenStream;
use proc_macro2::TokenStream as TokenStream2;
use quote::quote;
use std::str::FromStr;
use syn::{parse_macro_input, Data, DeriveInput, Fields, FieldsNamed, FieldsUnnamed, LitStr};

#[derive(Debug, FromDeriveInput)]
#[darling(default, attributes(schema))]
struct DeriveOptions {
    custom: Option<LitStr>,
}

impl Default for DeriveOptions {
    fn default() -> Self {
        Self { custom: None }
    }
}

fn visit_struct(
    fracpack_mod: &TokenStream2,
    input: &DeriveInput,
    fields: &FieldsNamed,
    opts: &DeriveOptions,
    fracpack_opts: &FracpackOptions,
) -> TokenStream2 {
    let name = &input.ident;

    let ty = if fracpack_opts.definition_will_not_change {
        quote! { Struct }
    } else {
        quote! { Object }
    };

    let visit_fields = fields
        .named
        .iter()
        .map(|field| {
            let name_str = field.ident.as_ref().unwrap().to_string();
            let ty = &field.ty;
            quote! { fields.insert(#name_str.into(), builder.insert::<#ty>()); }
        })
        .fold(quote! {}, |acc, new| quote! {#acc #new});

    let mut build_result = quote! { #fracpack_mod::AnyType::#ty(fields) };

    if let Some(id) = &opts.custom {
        build_result =
            quote! { #fracpack_mod::AnyType::Custom{type_: Box::new(#build_result)}, id: #id };
    }

    quote! {
        impl ToSchema for #name {
            fn schema(builder: &mut SchemaBuilder) -> #fracpack_mod::AnyType {
                let mut fields = #fracpack_mod::indexmap::IndexMap::new();
                #visit_fields
                #build_result
            }
        }
    }
}

fn visit_struct_unnamed(
    fracpack_mod: &TokenStream2,
    input: &DeriveInput,
    unnamed: &FieldsUnnamed,
    _opts: &DeriveOptions,
    fracpack_opts: &FracpackOptions,
) -> TokenStream2 {
    if fracpack_opts.definition_will_not_change {
        unimplemented!("definition_will_not_change only supported on structs with named fields")
    }

    let name = &input.ident;
    let fields = &unnamed.unnamed;

    if fields.len() == 1 {
        let inner = &fields[0].ty;
        quote! {
            impl ToSchema for #name {
                fn schema(builder: &mut SchemaBuilder) -> AnyType {
                    builder.insert::<#inner>()
                }
            }
        }
    } else {
        let visit_fields = fields
            .iter()
            .map(|field| {
                let ty = &field.ty;
                quote! { fields.push(builder.insert::<#ty>()); }
            })
            .fold(quote! {}, |acc, new| quote! {#acc #new});

        quote! {
            fn schema(builder: &mut SchemaBuilder) -> AnyType {
                let mut fields = Vec::new();
                #visit_fields
                #fracpack_mod::AnyType::Tuple(fields)
            }
        }
    }
}

pub fn schema_derive_macro(input: TokenStream) -> TokenStream {
    let input = parse_macro_input!(input as DeriveInput);
    let opts = match DeriveOptions::from_derive_input(&input) {
        Ok(val) => val,
        Err(err) => {
            return err.write_errors().into();
        }
    };
    let fracpack_opts = match FracpackOptions::from_derive_input(&input) {
        Ok(val) => val,
        Err(err) => {
            return err.write_errors().into();
        }
    };
    let fracpack_mod = TokenStream2::from_str(&fracpack_opts.fracpack_mod).unwrap();

    let result = match &input.data {
        Data::Struct(data) => match &data.fields {
            Fields::Named(named) => {
                visit_struct(&fracpack_mod, &input, named, &opts, &fracpack_opts)
            }
            Fields::Unnamed(unnamed) => {
                visit_struct_unnamed(&fracpack_mod, &input, unnamed, &opts, &fracpack_opts)
            }
            Fields::Unit => unimplemented!("reflect does not support unit struct"),
        },
        Data::Enum(_) => unimplemented!("reflect does not support enum"),
        Data::Union(_) => unimplemented!("reflect does not support union"),
    };
    result.into()
}
