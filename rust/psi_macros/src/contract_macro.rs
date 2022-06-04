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
        Item::Mod(impl_mod) => process_mod(iface_mod_name, impl_mod),
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

// TODO: don't auto number actions
fn process_mod(iface_mod_name: Ident, mut impl_mod: ItemMod) -> TokenStream {
    let impl_mod_name = &impl_mod.ident;
    if iface_mod_name == *impl_mod_name {
        abort!(
            iface_mod_name,
            "interface module name is same as implementation module name"
        );
    }
    let mut iface_use = proc_macro2::TokenStream::new();
    let mut action_structs = proc_macro2::TokenStream::new();
    let mut enum_body = proc_macro2::TokenStream::new();
    let mut dispatch_body = proc_macro2::TokenStream::new();
    if let Some((_, items)) = &mut impl_mod.content {
        let mut action_fns: Vec<usize> = Vec::new();
        for (item_index, item) in items.iter_mut().enumerate() {
            match item {
                Item::Fn(f) => {
                    if f.attrs.iter().any(is_action_attr) {
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
                let mut invoke_args = quote! {};
                process_action(f, &mut action_structs, &mut invoke_args);
                let name = &f.sig.ident;
                enum_body = quote! {
                    #enum_body
                    #name(actions::#name),
                };
                dispatch_body = quote! {
                    #dispatch_body
                    action::#name(args) => {
                        super::#impl_mod_name::#name(#invoke_args);
                    }
                };
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
    quote! {
        #item_mod_stream
        #[automatically_derived]
        #[allow(non_snake_case)]
        #[allow(non_camel_case_types)]
        #[allow(non_upper_case_globals)]
        pub mod #iface_mod_name {
            use super::*;

            pub mod actions {
                #iface_use
                use super::super::#impl_mod_name::*;
                #action_structs
            }
            #[derive(psi_macros::Fracpack)]
            pub enum action {
                #enum_body
            }
            pub fn dispatch(act: Action) -> fracpack::Result<()> {
                // TODO: view instead of unpack
                // TODO: sender

                // TODO: adjust dispatch body
                if act.method == MethodNumber::from("hi") {
                    super::example_contract::hi();
                } else if act.method == MethodNumber::from("add") {
                    let args = <actions::add as fracpack::Packable>::unpack(&act.raw_data, &mut 0)?;
                    let val = super::example_contract::add(args.a, args.b);
                    set_retval(&val);
                } else if act.method == MethodNumber::from("multiply") {
                    let args = <actions::multiply as fracpack::Packable>::unpack(&act.raw_data, &mut 0)?;
                    let val = super::example_contract::multiply(args.a, args.b);
                    set_retval(&val);
                } else {
                    abort_message(&format!(
                        "unknown contract action: {}",
                        act.method.to_string()
                    ));
                }
                Ok(())
            }
        }

        #[no_mangle]
        pub extern "C" fn called(_this_contract: u64, _sender: u64) {
            let act = get_current_action();
            #iface_mod_name::dispatch(act).unwrap();

            // TODO: review
            // with_current_action(|act| {
            //     #iface_mod_name::dispatch(act)
            //         .unwrap_or_else(|_| abort_message("unpack action data failed"));
            // });
        }

        extern "C" {
            fn __wasm_call_ctors();
        }

        #[no_mangle]
        pub extern "C" fn start(this_contract: u64) {
            unsafe {
                __wasm_call_ctors();
            }
        }

    } // quote!
    .into()
} // process_mod

fn process_action(
    f: &ItemFn,
    new_items: &mut proc_macro2::TokenStream,
    invoke_args: &mut proc_macro2::TokenStream,
) {
    match f.vis {
        Visibility::Public(_) => (),
        _ => abort!(f, "action must be public"),
    }
    let mut struct_members = proc_macro2::TokenStream::new();
    for input in f.sig.inputs.iter() {
        match input {
            FnArg::Receiver(_) => (), // Compiler generates errors on self args
            FnArg::Typed(pat_type) => match &*pat_type.pat {
                Pat::Ident(name) => {
                    let ty = &*pat_type.ty;
                    struct_members = quote! {
                        #struct_members
                        pub #name: #ty,
                    };
                    *invoke_args = quote! {
                        #invoke_args
                        args.#name,
                    };
                }
                _ => abort!(*pat_type.pat, "expected identifier"),
            },
        };
    }
    let fn_name = &f.sig.ident;
    *new_items = quote! {
        #new_items
        #[derive(psi_macros::Fracpack)]
        pub struct #fn_name {
            #struct_members
        }
    }
}
