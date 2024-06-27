use crate::fracpack_macro::Options as FracpackOptions;
use darling::{error::Accumulator, FromDeriveInput, FromVariant};
use proc_macro::TokenStream;
use proc_macro2::TokenStream as TokenStream2;
use quote::quote;
use std::str::FromStr;
use syn::{
    parse_macro_input, Data, DataEnum, DeriveInput, Fields, FieldsNamed, FieldsUnnamed, LitStr,
};

#[derive(Debug, FromDeriveInput, FromVariant)]
#[darling(default, attributes(schema))]
struct DeriveOptions {
    custom: Option<LitStr>,
}

impl Default for DeriveOptions {
    fn default() -> Self {
        Self { custom: None }
    }
}

fn visit_fields_named(
    fracpack_mod: &TokenStream2,
    fields: &FieldsNamed,
    fracpack_opts: &FracpackOptions,
    _errors: &mut Accumulator,
) -> TokenStream2 {
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

    quote! {
        {
            let mut fields = #fracpack_mod::indexmap::IndexMap::new();
            #visit_fields
            #fracpack_mod::AnyType::#ty(fields)
        }
    }
}

fn visit_fields_unnamed(
    fracpack_mod: &TokenStream2,
    unnamed: &FieldsUnnamed,
    fracpack_opts: &FracpackOptions,
    errors: &mut Accumulator,
) -> TokenStream2 {
    if fracpack_opts.definition_will_not_change {
        errors.push(darling::Error::custom(
            "definition_will_not_change only supported on structs with named fields",
        ));
    }

    let fields = &unnamed.unnamed;

    if fields.len() == 1 {
        let inner = &fields[0].ty;
        quote! {
            builder.insert::<#inner>()
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
            {
                let mut fields = Vec::new();
                #visit_fields
                #fracpack_mod::AnyType::Tuple(fields)
            }
        }
    }
}

fn visit_fields(
    fracpack_mod: &TokenStream2,
    fields: &Fields,
    fracpack_opts: &FracpackOptions,
    errors: &mut Accumulator,
) -> TokenStream2 {
    match fields {
        Fields::Named(named) => visit_fields_named(&fracpack_mod, named, &fracpack_opts, errors),
        Fields::Unnamed(unnamed) => {
            visit_fields_unnamed(&fracpack_mod, unnamed, &fracpack_opts, errors)
        }
        Fields::Unit => {
            errors.push(
                darling::Error::custom("schema does not support unit struct").with_span(fields),
            );
            quote! {}
        }
    }
}

fn visit_enum(
    fracpack_mod: &TokenStream2,
    data: &DataEnum,
    fracpack_opts: &FracpackOptions,
    errors: &mut Accumulator,
) -> TokenStream2 {
    if fracpack_opts.definition_will_not_change {
        errors.push(darling::Error::custom(
            "definition_will_not_change only supported on structs",
        ));
    }
    let visit_variants = data
        .variants
        .iter()
        .map(|variant| {
            if let Some((eq, _)) = &variant.discriminant {
                errors.push(
                    darling::Error::custom("Schema does not support discriminants").with_span(eq),
                );
                return quote! {};
            }
            let opts = DeriveOptions::from_variant(variant).unwrap();
            let fracpack_opts = errors
                .handle(FracpackOptions::from_variant(variant))
                .unwrap_or_default();
            let variant_name = variant.ident.to_string();
            let variant_type = apply_custom(
                fracpack_mod,
                &opts,
                visit_fields(&fracpack_mod, &variant.fields, &fracpack_opts, errors),
            );
            quote! {
                variants.insert(#variant_name.into(), #variant_type);
            }
        })
        .fold(quote! {}, |acc, field| quote! {#acc #field});

    quote! {
        {
            let mut variants = #fracpack_mod::indexmap::IndexMap::new();
            #visit_variants
            #fracpack_mod::AnyType::Variant(variants)
        }
    }
}

fn apply_custom(
    fracpack_mod: &TokenStream2,
    opts: &DeriveOptions,
    result: TokenStream2,
) -> TokenStream2 {
    if let Some(id) = &opts.custom {
        quote! { #fracpack_mod::AnyType::Custom{type_: Box::new(#result), id: #id.into() } }
    } else {
        result
    }
}

pub fn schema_derive_macro(input: TokenStream) -> TokenStream {
    let input = parse_macro_input!(input as DeriveInput);
    let mut errors = darling::Error::accumulator();

    let opts = errors
        .handle(DeriveOptions::from_derive_input(&input))
        .unwrap_or_default();
    let fracpack_opts = errors
        .handle(FracpackOptions::from_derive_input(&input))
        .unwrap_or_default();
    let fracpack_mod = TokenStream2::from_str(&fracpack_opts.fracpack_mod).unwrap();

    let name = &input.ident;

    let result = apply_custom(
        &fracpack_mod,
        &opts,
        match &input.data {
            Data::Struct(data) => {
                visit_fields(&fracpack_mod, &data.fields, &fracpack_opts, &mut errors)
            }
            Data::Enum(data) => visit_enum(&fracpack_mod, &data, &fracpack_opts, &mut errors),
            Data::Union(data) => {
                errors.push(
                    darling::Error::custom("schema does not support union")
                        .with_span(&data.union_token),
                );
                quote! {}
            }
        },
    );

    if let Err(err) = errors.finish() {
        return err.write_errors().into();
    }

    quote! {
        impl ToSchema for #name {
            fn schema(builder: &mut SchemaBuilder) -> #fracpack_mod::AnyType {
                #result
            }
        }
    }
    .into()
}
