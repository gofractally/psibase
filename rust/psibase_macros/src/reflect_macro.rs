use crate::fracpack_macro::Options as FracpackOptions;
use darling::{FromDeriveInput, FromField, FromMeta};
use proc_macro::TokenStream;
use proc_macro2::{Ident, TokenStream as TokenStream2};
use proc_macro_error::{abort, emit_error};
use quote::quote;
use std::str::FromStr;
use syn::{
    parse_macro_input, Data, DataEnum, DeriveInput, Fields, FieldsNamed, FieldsUnnamed, FnArg,
    ImplItem, Item, ItemImpl, Pat, Type, Visibility,
};

#[derive(Debug, FromDeriveInput)]
#[darling(default, attributes(reflect))]
struct DeriveOptions {
    psibase_mod: String,
    custom_json: bool,
    static_type: Option<String>,
}

impl Default for DeriveOptions {
    fn default() -> Self {
        Self {
            psibase_mod: "psibase".into(),
            custom_json: false,
            static_type: None,
        }
    }
}

#[derive(Debug, Default, FromField)]
#[darling(default, attributes(reflect))]
struct FieldOptions {
    skip: bool,
}

#[derive(Debug, FromMeta)]
#[darling(default)]
pub struct AttrOptions {
    psibase_mod: String,
}

impl Default for AttrOptions {
    fn default() -> Self {
        Self {
            psibase_mod: "psibase".into(),
        }
    }
}

struct StructField<'a> {
    name: &'a proc_macro2::Ident,
    ty: &'a syn::Type,
    options: FieldOptions,
}

fn struct_fields(named: &FieldsNamed) -> Vec<StructField> {
    named
        .named
        .iter()
        .map(|field| StructField {
            name: field.ident.as_ref().unwrap(),
            ty: &field.ty,
            options: match FieldOptions::from_field(field) {
                Ok(val) => val,
                Err(err) => abort!("{}", err),
            },
        })
        .collect()
}

pub fn reflect_derive_macro(input: TokenStream) -> TokenStream {
    let input = parse_macro_input!(input as DeriveInput);
    let opts = match DeriveOptions::from_derive_input(&input) {
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
    let static_type = if let Some(t) = &opts.static_type {
        TokenStream2::from_str(t).unwrap()
    } else {
        quote! {#name #static_generics}
    };

    let mut additional_defs = quote! {};
    let visit = match &input.data {
        Data::Struct(data) => match &data.fields {
            Fields::Named(named) => visit_struct(
                &psibase_mod,
                &input,
                named,
                &opts,
                &fracpack_opts,
                &mut additional_defs,
            ),
            Fields::Unnamed(unnamed) => {
                visit_struct_unnamed(&psibase_mod, &input, unnamed, &opts, &fracpack_opts)
            }
            Fields::Unit => unimplemented!("reflect does not support unit struct"),
        },
        Data::Enum(data) => visit_enum(&psibase_mod, &input, data, &opts, &fracpack_opts),
        Data::Union(_) => unimplemented!("reflect does not support union"),
    };

    quote! {
        impl #impl_generics #psibase_mod::reflect::Reflect for #name #ty_generics #where_clause {
            type StaticType = #static_type;
            fn reflect<V: #psibase_mod::reflect::Visitor>(visitor: V) -> V::Return {
                #visit
            }
        }
        #additional_defs
    }
    .into()
}

fn visit_struct(
    psibase_mod: &TokenStream2,
    input: &DeriveInput,
    fields: &FieldsNamed,
    opts: &DeriveOptions,
    fracpack_opts: &FracpackOptions,
    additional_defs: &mut TokenStream2,
) -> TokenStream2 {
    let name = &input.ident;
    let str_name = name.to_string();
    let fields = struct_fields(fields);
    let fields_len = fields.len();

    let mut enable_options = quote! {};
    if opts.custom_json {
        enable_options = quote! {.custom_json()}
    }
    if fracpack_opts.definition_will_not_change {
        enable_options = quote! {#enable_options .definition_will_not_change()}
    }

    let reflect_methods_type = Ident::new(
        &("psibase_reflect_struct_with_named_fields_".to_owned() + &str_name),
        name.span(),
    );

    let visit_fields = fields
        .iter()
        .filter_map(|field| {
            if field.options.skip {
                None
            } else {
                let name_str = field.name.to_string();
                let ty = field.ty;
                Some(quote! { .field::<#ty>(#name_str.into()) })
            }
        })
        .fold(quote! {}, |acc, new| quote! {#acc #new});

    *additional_defs = quote! {
        #[allow(non_camel_case_types)]
        struct #reflect_methods_type;
    };

    quote! {
        use #psibase_mod::reflect::NamedVisitor;
        use #psibase_mod::reflect::ReflectNoMethods;

        #reflect_methods_type::reflect_methods::<V::Return>(
            visitor
            #enable_options
            .struct_named::<Self>(#str_name.into(), #fields_len)
            #visit_fields
        )
    }
}

fn visit_struct_unnamed(
    psibase_mod: &TokenStream2,
    input: &DeriveInput,
    unnamed: &FieldsUnnamed,
    opts: &DeriveOptions,
    fracpack_opts: &FracpackOptions,
) -> TokenStream2 {
    if opts.custom_json {
        unimplemented!("custom_json only supported on structs with named fields")
    }
    if fracpack_opts.definition_will_not_change {
        unimplemented!("definition_will_not_change only supported on structs with named fields")
    }

    let name = &input.ident;
    let str_name = name.to_string();
    let fields = &unnamed.unnamed;
    let fields_len = fields.len();

    if fields.len() == 1 {
        let inner = &fields[0].ty;
        quote! {
            use #psibase_mod::reflect::UnnamedVisitor;

            visitor
            .struct_single::<Self, #inner>(#str_name.into())
        }
    } else {
        let visit_fields = fields
            .iter()
            .map(|field| {
                let ty = &field.ty;
                quote! { .field::<#ty>() }
            })
            .fold(quote! {}, |acc, new| quote! {#acc #new});

        quote! {
            use #psibase_mod::reflect::UnnamedVisitor;

            visitor
            .struct_tuple::<Self>(#str_name.into(), #fields_len)
            #visit_fields
            .end()
        }
    }
}

fn visit_enum(
    psibase_mod: &TokenStream2,
    input: &DeriveInput,
    data: &DataEnum,
    opts: &DeriveOptions,
    fracpack_opts: &FracpackOptions,
) -> TokenStream2 {
    if opts.custom_json {
        unimplemented!("custom_json only supported on structs")
    }
    if fracpack_opts.definition_will_not_change {
        unimplemented!("definition_will_not_change only supported on structs")
    }

    let name = &input.ident;
    let str_name = name.to_string();
    let num_variants = data.variants.len();

    let visit_variants = data
        .variants
        .iter()
        .map(|variant| {
            if let Some((eq, _)) = &variant.discriminant {
                emit_error! {eq, "Reflect does not support discriminants"};
                return quote! {};
            }
            let variant_name = variant.ident.to_string();
            match &variant.fields {
                Fields::Named(fields) => {
                    let num_fields = fields.named.len();
                    let fields = fields
                        .named
                        .iter()
                        .map(|field| {
                            let ty = &field.ty;
                            let name = field.ident.as_ref().unwrap().to_string();
                            quote! {.field::<#ty>(#name.into())}
                        })
                        .fold(quote! {}, |acc, field| quote! {#acc #field});
                    quote! {
                        .named::<Self>(#variant_name.into(), #num_fields)
                        #fields
                        .end()
                    }
                }
                Fields::Unnamed(fields) => {
                    if fields.unnamed.len() == 1 {
                        let ty = &fields.unnamed[0].ty;
                        quote! {.single::<Self, #ty>(#variant_name.into())}
                    } else {
                        let num_fields = fields.unnamed.len();
                        let fields = fields
                            .unnamed
                            .iter()
                            .map(|field| {
                                let ty = &field.ty;
                                quote! {.field::<#ty>()}
                            })
                            .fold(quote! {}, |acc, field| quote! {#acc #field});
                        quote! {
                            .tuple::<Self>(#variant_name.into(), #num_fields)
                            #fields
                            .end()
                        }
                    }
                }
                Fields::Unit => {
                    emit_error! {variant, "Reflect does not support unit variants"};
                    quote! {}
                }
            }
        })
        .fold(quote! {}, |acc, field| quote! {#acc #field});

    quote! {
        use #psibase_mod::reflect::EnumVisitor;
        use #psibase_mod::reflect::UnnamedVisitor;
        use #psibase_mod::reflect::NamedVisitor;

        visitor
        .enumeration::<Self>(#str_name.into(), #num_variants)
        #visit_variants
        .end()
    }
}

pub fn reflect_attr_macro(attr: TokenStream, item: TokenStream) -> TokenStream {
    let attr = parse_macro_input!(attr as syn::AttributeArgs);
    let options = match AttrOptions::from_list(&attr) {
        Ok(val) => val,
        Err(err) => {
            return err.write_errors().into();
        }
    };
    let psibase_mod = proc_macro2::TokenStream::from_str(&options.psibase_mod).unwrap();
    let item = parse_macro_input!(item as Item);
    match item {
        Item::Impl(imp) => reflect_impl(&psibase_mod, imp),
        Item::Enum(_) => {
            abort!(
                item,
                "reflect attribute may only be used on an impl. use #[derive(Reflect)] instead."
            )
        }
        Item::Struct(_) => {
            abort!(
                item,
                "reflect attribute may only be used on an impl. use #[derive(Reflect)] instead."
            )
        }
        _ => {
            abort!(item, "reflect attribute may only be used on an impl")
        }
    }
}

pub fn reflect_impl(psibase_mod: &TokenStream2, imp: ItemImpl) -> TokenStream {
    if imp.trait_.is_some() {
        abort!(imp, "reflect attribute does not support this form of impl")
    }
    let name = if let Type::Path(path) = imp.self_ty.as_ref() {
        if path.path.segments.len() == 1 {
            &path.path.segments[0].ident
        } else {
            abort!(imp, "reflect attribute does not support this form of impl")
        }
    } else {
        abort!(imp, "reflect attribute does not support this form of impl")
    };
    let str_name = name.to_string();
    let reflect_methods_type = Ident::new(
        &("psibase_reflect_struct_with_named_fields_".to_owned() + &str_name),
        name.span(),
    );

    let sigs: Vec<_> = imp
        .items
        .iter()
        .filter_map(|item| {
            if let ImplItem::Method(method) = item {
                if matches!(method.vis, Visibility::Public(_)) {
                    let inputs = &method.sig.inputs;
                    if !inputs.is_empty() && matches!(inputs[0], FnArg::Receiver(_)) {
                        return Some(&method.sig);
                    }
                }
            }
            None
        })
        .collect();
    let num_methods = sigs.len();
    let methods = sigs
        .iter()
        .map(|sig| {
            let name = sig.ident.to_string();
            let output = match &sig.output {
                syn::ReturnType::Default => quote! {#psibase_mod::reflect::Void},
                syn::ReturnType::Type(_, ty) => quote! {#ty},
            };
            let num_args = sig.inputs.len() - 1;
            let args = sig
                .inputs
                .iter()
                .skip(1)
                .map(|arg| match arg {
                    FnArg::Receiver(r) => abort!(r, "receiver in unexpected position"),
                    FnArg::Typed(arg) => {
                        if let Pat::Ident(n) = arg.pat.as_ref() {
                            let name = n.ident.to_string();
                            let ty = &arg.ty;
                            quote! {.arg::<#ty>(#name.into())}
                        } else {
                            abort!(output, "unsupported argument pattern")
                        }
                    }
                })
                .fold(quote! {}, |acc, new| quote! {#acc #new});
            quote! {.method::<#output>(#name.into(), #num_args) #args .end()}
        })
        .fold(quote! {}, |acc, new| quote! {#acc #new});

    quote! {
        #imp
        impl #reflect_methods_type {
            fn reflect_methods<Return>(visitor: impl #psibase_mod::reflect::StructVisitor<Return>) -> Return {
                use #psibase_mod::reflect::MethodsVisitor;
                use #psibase_mod::reflect::ArgVisitor;

                visitor.with_methods(#num_methods)
                #methods
                .end()
            }
        }
    }
    .into()
}
