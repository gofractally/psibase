use crate::fracpack_macro::{skip_field, Options};
use darling::FromDeriveInput;
use proc_macro::TokenStream;
use proc_macro2::{Span, TokenStream as TokenStream2};
use quote::quote;
use syn::{
    parse_macro_input, Data, DataStruct, DeriveInput, Field, Fields, GenericParam, Generics, Ident,
    Lifetime,
};

pub fn view_macro_impl(input: TokenStream) -> TokenStream {
    let input = parse_macro_input!(input as DeriveInput);

    let mut opts = match Options::from_derive_input(&input) {
        Ok(val) => val,
        Err(err) => {
            return err.write_errors().into();
        }
    };
    let fracpack_mod: TokenStream2 = opts.fracpack_mod.parse().unwrap();
    if opts.view_name.is_none() {
        opts.view_name = Some(Ident::new(
            &(input.ident.to_string() + "View"),
            Span::call_site(),
        ));
    }

    let def = view_def(&fracpack_mod, &input, &opts);

    let accessors = match &input.data {
        Data::Struct(data) => process_struct(&fracpack_mod, &input, data, &opts),
        Data::Enum(_data) => quote! {},
        Data::Union(_) => unimplemented!("fracpack does not support union"),
    };

    quote! { #def #accessors }.into()
}

// Returns a lifetime distinct from every lifetime in generics
fn new_lifetime(generics: &Generics) -> Lifetime {
    let maxlen = generics
        .params
        .iter()
        .filter_map(|param| {
            if let GenericParam::Lifetime(param) = param {
                Some(param.lifetime.ident.to_string().len())
            } else {
                None
            }
        })
        .max()
        .unwrap_or(0);
    Lifetime::new(&format!("'a{:a<maxlen$}", ""), Span::mixed_site())
}

fn view_def(fracpack_mod: &TokenStream2, input: &DeriveInput, opts: &Options) -> TokenStream2 {
    let (impl_generics, ty_generics, where_clause) = input.generics.split_for_impl();
    let vis = &input.vis;
    let ty = &input.ident;
    let impl_params = &input.generics.params;
    let view_ty = opts.view_name.as_ref().unwrap();
    let lifetime = new_lifetime(&input.generics);
    let where_predicates = input.generics.where_clause.as_ref().map(|w| &w.predicates);
    quote! {
        #vis struct #view_ty #impl_generics #where_clause (#fracpack_mod::GenericView<#ty #ty_generics>);
        impl #impl_generics #fracpack_mod::ViewData for #view_ty #ty_generics #where_clause {
            fn new_unchecked(data: &[u8]) -> &Self {
                unsafe { &*(data as *const [u8] as *const Self) }
            }
            fn get_data(&self) -> &[u8] {
                #fracpack_mod::ViewData::get_data(&self.0)
            }
        }
        impl <#lifetime, #impl_params> #fracpack_mod::ViewExt<#lifetime> for #view_ty #ty_generics where #ty #ty_generics: #fracpack_mod::Unpack<#lifetime>, #where_predicates {
            type ValueType = #ty #ty_generics;
        }
        impl <#lifetime, #impl_params> std::fmt::Debug for &#lifetime #view_ty #ty_generics where &#lifetime #fracpack_mod::GenericView<#ty #ty_generics>: std::fmt::Debug, #where_predicates {
            fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::result::Result<(), std::fmt::Error> {
                std::fmt::Debug::fmt(&&self.0, f)
            }
        }
        impl #impl_generics #fracpack_mod::MakeView for #ty #ty_generics #where_clause {
            type ViewType = #view_ty #ty_generics;
        }
    }
}

fn process_struct(
    fracpack_mod: &TokenStream2,
    input: &DeriveInput,
    data: &DataStruct,
    opts: &Options,
) -> TokenStream2 {
    let view_ty = opts.view_name.as_ref().unwrap();

    if let Fields::Unnamed(fields) = &data.fields {
        if fields.unnamed.len() == 1 {
            return generate_newtype_accessor(
                fracpack_mod,
                &view_ty,
                fields.unnamed.first().unwrap(),
                &input.generics,
            );
        }
    }

    let (impl_generics, ty_generics, where_clause) = input.generics.split_for_impl();

    let field_sizes = data.fields.iter().map(|field| {
        if skip_field(field) {
            quote! { 0 }
        } else {
            let field_ty = &field.ty;
            quote! { <#field_ty as #fracpack_mod::Unpack>::FIXED_SIZE }
        }
    });
    let implicit_fixed_size = opts.definition_will_not_change;

    let view_impls = quote! {
        impl #impl_generics #fracpack_mod::ViewFields for #view_ty #ty_generics #where_clause {
            const IMPLICIT_FIXED_SIZE: bool = #implicit_fixed_size;
            fn get_offset(index: usize) -> u32 {
                [#(#field_sizes),*].into_iter().take(index).sum()
            }
        }
    };

    let accessors: TokenStream2 = data
        .fields
        .iter()
        .enumerate()
        .filter(|(_, field)| !skip_field(field))
        .map(|(field_num, field)| {
            generate_accessor(fracpack_mod, &view_ty, field, field_num, &input.generics)
        })
        .collect();
    quote! {
        #view_impls
        #accessors
    }
}

fn generate_newtype_accessor(
    fracpack_mod: &TokenStream2,
    view_ty: &Ident,
    field: &Field,
    generics: &Generics,
) -> TokenStream2 {
    let vis = &field.vis;
    let field_ty = &field.ty;
    let impl_generics = &generics.params;
    let where_clause = generics.where_clause.as_ref().map(|w| &w.predicates);
    let (_, ty_generics, _) = generics.split_for_impl();
    let lifetime = new_lifetime(generics);
    quote! {
        impl <#lifetime, #impl_generics> #view_ty #ty_generics where #field_ty: #fracpack_mod::MakeView + #fracpack_mod::Unpack<#lifetime>, #where_clause {
            #vis fn get0(&self) -> &#fracpack_mod::View<#field_ty> {
                #fracpack_mod::ViewData::new_unchecked(#fracpack_mod::ViewData::get_data(self))
            }
        }
    }
}

fn generate_accessor(
    fracpack_mod: &TokenStream2,
    view_ty: &Ident,
    field: &Field,
    field_num: usize,
    generics: &Generics,
) -> TokenStream2 {
    let vis = &field.vis;
    let field_ty = &field.ty;
    let field_name = field
        .ident
        .clone()
        .unwrap_or_else(|| Ident::new(&format!("get{field_num}"), Span::call_site()));
    let impl_generics = &generics.params;
    let where_clause = generics.where_clause.as_ref().map(|w| &w.predicates);
    let (_, ty_generics, _) = generics.split_for_impl();
    let lifetime = new_lifetime(generics);
    quote! {
        impl <#lifetime, #impl_generics> #view_ty #ty_generics where #field_ty: #fracpack_mod::MakeView + #fracpack_mod::Unpack<#lifetime>, #where_clause {
            #vis fn #field_name(&self) -> &#fracpack_mod::View<#field_ty> {
                #fracpack_mod::ViewFields::get_field::<#field_ty>(self, #field_num)
            }
        }
    }
}
