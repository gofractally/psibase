use proc_macro::TokenStream;
use proc_macro2::Ident;
use proc_macro_error::abort;
use quote::{quote, ToTokens};
use syn::{
    parse_macro_input, parse_quote, AttrStyle, Attribute, FnArg, Item, ItemFn, ItemMod, Pat,
    ReturnType, Visibility,
};

pub fn service_macro_impl(attr: TokenStream, item: TokenStream) -> TokenStream {
    if !attr.is_empty() {
        panic!("service attribute should have no arguments")
    }
    let item = parse_macro_input!(item as Item);
    match item {
        Item::Mod(impl_mod) => process_mod(impl_mod),
        _ => {
            abort!(item, "service attribute may only be used on a module")
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
fn process_mod(mut impl_mod: ItemMod) -> TokenStream {
    let impl_mod_name = &impl_mod.ident;
    let mut iface_use = proc_macro2::TokenStream::new();
    let mut action_structs = proc_macro2::TokenStream::new();
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
                process_action_args(f, &mut action_structs, &mut invoke_args);
                process_dispatch_body(f, &mut dispatch_body, impl_mod_name, invoke_args);
                if let Some(i) = f.attrs.iter().position(is_action_attr) {
                    f.attrs.remove(i);
                }
            }
        }
        add_unknown_action_check_to_dispatch_body(&mut dispatch_body);
        items.push(parse_quote! {
            #[automatically_derived]
            #[allow(non_snake_case)]
            #[allow(non_camel_case_types)]
            #[allow(non_upper_case_globals)]
            pub mod action_structs {
                #iface_use
                #action_structs
            }
        });
        items.push(parse_quote! {
            #[automatically_derived]
            pub fn dispatch(act: psibase::SharedAction) -> fracpack::Result<()> {
                #dispatch_body
                Ok(())
            }
        });
    } else {
        abort!(
            impl_mod,
            "#[psibase::contract] module must have inline contents"
        )
    }
    let item_mod_stream = impl_mod.to_token_stream();
    quote! {
        #item_mod_stream

        #[no_mangle]
        pub extern "C" fn called(_this_contract: u64, _sender: u64) {
            psibase::with_current_action(|act| {
                #impl_mod_name::dispatch(act)
                    .unwrap_or_else(|_| psibase::abort_message("unpack action data failed"));
            });
        }

        extern "C" {
            fn __wasm_call_ctors();
        }

        #[no_mangle]
        pub unsafe extern "C" fn start(this_contract: u64) {
            __wasm_call_ctors();
        }
    } // quote!
    .into()
} // process_mod

fn process_action_args(
    f: &ItemFn,
    new_items: &mut proc_macro2::TokenStream,
    invoke_args: &mut proc_macro2::TokenStream,
) {
    // actions must be exposed, hence public
    match f.vis {
        Visibility::Public(_) => (),
        _ => abort!(f, "action must be public"),
    }

    // if action has no args there's no need for action structs
    if f.sig.inputs.is_empty() {
        return;
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
        #[derive(psibase::Fracpack)]
        pub struct #fn_name {
            #struct_members
        }
    }
}

fn process_dispatch_body(
    f: &ItemFn,
    dispatch_body: &mut proc_macro2::TokenStream,
    impl_mod_name: &Ident,
    invoke_args: proc_macro2::TokenStream,
) {
    let name = &f.sig.ident;

    let args_unpacking = if !invoke_args.is_empty() {
        quote! { let args = <action_structs::#name as fracpack::Packable>::unpack(&act.raw_data, &mut 0)?; }
    } else {
        quote! {}
    };

    let action_invoking = if f.sig.output == ReturnType::Default {
        quote! {
            super::#impl_mod_name::#name(#invoke_args);
        }
    } else {
        quote! {
            let val = super::#impl_mod_name::#name(#invoke_args);
            psibase::set_retval(&val);
        }
    };

    let method_comparison = quote! { act.method == psibase::MethodNumber::from(stringify!(#name)) };

    let if_block = if dispatch_body.is_empty() {
        quote! { if }
    } else {
        quote! { else if }
    };

    *dispatch_body = quote! {
        #dispatch_body
        #if_block #method_comparison {
            #args_unpacking
            #action_invoking
        }
    };
}

fn add_unknown_action_check_to_dispatch_body(dispatch_body: &mut proc_macro2::TokenStream) {
    if !dispatch_body.is_empty() {
        *dispatch_body = quote! {
            #dispatch_body
            else {
                psibase::abort_message(&format!(
                    "unknown contract action: {}",
                    act.method.to_string()
                ));
            }
        };
    }
}
