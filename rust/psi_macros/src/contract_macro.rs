use proc_macro::TokenStream;
use proc_macro2::Ident;
use proc_macro_error::abort;
use quote::{quote, ToTokens};
use syn::{
    parse, parse_macro_input, AttrStyle, Attribute, FnArg, Item, ItemFn, ItemMod, Pat, Visibility,
};

pub fn contract_macro_impl(attr: TokenStream, item: TokenStream) -> TokenStream {
    let iface_mod_name: Ident = parse(attr).unwrap_or_else(|_| {
        panic!("missing interface module name. Try #[contract(contract_name)]")
    });
    let item = parse_macro_input!(item as Item);
    match item {
        Item::Mod(impl_mod) => process_mod(iface_mod_name, impl_mod).into(),
        _ => {
            abort!(item, "contract attribute may only be used on a module")
        }
    }
}

fn is_action_attr(attr: &Attribute) -> bool {
    if let AttrStyle::Outer = attr.style {
        if attr.path.is_ident("action") {
            return true;
        }
    }
    false
}

fn process_mod(iface_mod_name: Ident, mut impl_mod: ItemMod) -> TokenStream {
    if iface_mod_name == impl_mod.ident {
        abort!(
            iface_mod_name,
            "interface module name is same as implementation module name"
        );
    }
    let mut iface_use = proc_macro2::TokenStream::new();
    let mut iface_items = proc_macro2::TokenStream::new();
    if let Some((_, items)) = &mut impl_mod.content {
        let mut action_fns: Vec<usize> = Vec::new();
        for (item_index, item) in items.iter_mut().enumerate() {
            match item {
                Item::Fn(f) => {
                    if let Some(_) = f.attrs.iter().position(is_action_attr) {
                        action_fns.push(item_index);
                    }
                }
                Item::Use(u) => {
                    let ut = u.to_token_stream();
                    iface_use = quote! {#iface_use #ut};
                }
                _ => (),
            }
        }
        for fn_index in action_fns.iter() {
            if let Item::Fn(f) = &mut items[*fn_index] {
                process_action(&mut iface_items, f);
                if let Some(i) = f.attrs.iter().position(is_action_attr) {
                    f.attrs.remove(i);
                }
            }
        }
    } else {
        abort!(
            impl_mod,
            "#[psi_macros::contract] module must have inline contents"
        )
    }
    let item_mod_stream = impl_mod.to_token_stream();
    let impl_mod_name = &impl_mod.ident;
    quote! {
        #item_mod_stream
        mod #iface_mod_name {
            #iface_use
            use #impl_mod_name::*;
            #iface_items
        }
    }
    .into()
}

fn process_action(new_items: &mut proc_macro2::TokenStream, f: &ItemFn) {
    match f.vis {
        Visibility::Public(_) => (),
        _ => abort!(f, "action must be public"),
    }
    let struct_members = f
        .sig
        .inputs
        .iter()
        .map(|input| match input {
            FnArg::Receiver(_) => quote! {}, // Compiler generates better errors on self args
            FnArg::Typed(pat_type) => match &*pat_type.pat {
                Pat::Ident(name) => {
                    let ty = &*pat_type.ty;
                    quote! {pub #name: #ty,}
                }
                _ => abort!(*pat_type.pat, "expected identifier"),
            },
        })
        .fold(quote! {}, |acc, new| quote! {#acc #new});
    let fn_name = &f.sig.ident;
    *new_items = quote! {
        #new_items
        // #[derive(psi_macros::Fracpack)]
        pub struct #fn_name {
            #struct_members
        }
    }
}
