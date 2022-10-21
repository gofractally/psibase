use crate::fracpack_macro::Options as FracpackOptions;
use darling::FromDeriveInput;
use proc_macro::TokenStream;
use proc_macro2::TokenStream as TokenStream2;
use quote::quote;
use std::str::FromStr;
use syn::{parse_macro_input, Data, DataEnum, DeriveInput, Fields, FieldsNamed, FieldsUnnamed};

#[derive(Debug, FromDeriveInput)]
#[darling(default, attributes(fracpack))]
pub(crate) struct Options {
    pub(crate) psibase_mod: String,
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

fn struct_fields(named: &FieldsNamed) -> Vec<StructField> {
    named
        .named
        .iter()
        .map(|field| StructField {
            name: field.ident.as_ref().unwrap(),
            ty: &field.ty,
        })
        .collect()
}

pub fn reflect_macro_impl(input: TokenStream) -> TokenStream {
    let input = parse_macro_input!(input as DeriveInput);
    let opts = match Options::from_derive_input(&input) {
        Ok(val) => val,
        Err(err) => {
            return err.write_errors().into();
        }
    };
    let psibase_mod = TokenStream2::from_str(&opts.psibase_mod).unwrap();
    let fracpack_opts = match FracpackOptions::from_derive_input(&input) {
        Ok(val) => val,
        Err(err) => {
            return err.write_errors().into();
        }
    };

    let name = &input.ident;
    let (impl_generics, ty_generics, where_clause) = input.generics.split_for_impl();
    let static_generics = input
        .generics
        .params
        .iter()
        .map(|param| match param {
            syn::GenericParam::Type(t) => {
                let t = &t.ident;
                quote! {<#t as #psibase_mod::reflect::Reflect>::StaticType}
            }
            syn::GenericParam::Lifetime(_) => quote! {'static},
            syn::GenericParam::Const(c) => {
                let c = &c.ident;
                quote! {<#c as #psibase_mod::reflect::Reflect>::StaticType}
            }
        })
        .reduce(|a, b| quote! {#a, #b})
        .map(|a| quote! {<#a>});

    let visit = match &input.data {
        Data::Struct(data) => match &data.fields {
            Fields::Named(named) => visit_struct(&input, named),
            Fields::Unnamed(unnamed) => {
                process_struct_unnamed(&psibase_mod, &input, unnamed, &fracpack_opts)
            }
            Fields::Unit => unimplemented!("reflect does not support unit struct"),
        },
        Data::Enum(data) => process_enum(&psibase_mod, &input, data, &fracpack_opts),
        Data::Union(_) => unimplemented!("reflect does not support union"),
    };

    quote! {
        impl #impl_generics #psibase_mod::reflect::Reflect for #name #ty_generics #where_clause {
            type StaticType = #name #static_generics;
            fn reflect<V: #psibase_mod::reflect::Visitor>(visitor: V) -> V::Return {
                use #psibase_mod::reflect::NamedVisitor;
                #visit
            }
        }
    }
    .into()
}

fn visit_struct(input: &DeriveInput, fields: &FieldsNamed) -> TokenStream2 {
    let name = &input.ident;
    let str_name = name.to_string();
    let fields = struct_fields(fields);
    let fields_len = fields.len();

    let visit_fields = fields
        .iter()
        .map(|field| {
            let name_str = field.name.to_string();
            let ty = field.ty;
            quote! { .field::<#ty>(#name_str.into()) }
        })
        .fold(quote! {}, |acc, new| quote! {#acc #new});

    quote! {
        visitor.struct_named::<Self>(#str_name.into(), #fields_len)
        #visit_fields
        .end()
    }
}

fn process_struct_unnamed(
    _psibase_mod: &TokenStream2,
    _input: &DeriveInput,
    _unnamed: &FieldsUnnamed,
    fracpack_opts: &FracpackOptions,
) -> TokenStream2 {
    if fracpack_opts.definition_will_not_change {
        unimplemented!("definition_will_not_change only supported on structs with named fields")
    }
    todo!();
}

fn process_enum(
    _psibase_mod: &TokenStream2,
    _input: &DeriveInput,
    _data: &DataEnum,
    fracpack_opts: &FracpackOptions,
) -> TokenStream2 {
    if fracpack_opts.definition_will_not_change {
        unimplemented!("definition_will_not_change only supported on structs")
    }
    todo!();
}
