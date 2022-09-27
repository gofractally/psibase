use darling::FromMeta;
use proc_macro::TokenStream;
use proc_macro_error::abort;
use quote::{quote, ToTokens};
use std::str::FromStr;
use syn::{
    parse_macro_input, parse_quote, AttrStyle, Attribute, FnArg, Item, ItemFn, ItemMod, Pat,
    ReturnType, Visibility,
};

#[derive(Debug, FromMeta)]
#[darling(default)]
pub struct Options {
    dispatch: bool,
    psibase_mod: String,
}

impl Default for Options {
    fn default() -> Self {
        Options {
            dispatch: true,
            psibase_mod: "psibase".into(),
        }
    }
}

pub fn service_macro_impl(attr: TokenStream, item: TokenStream) -> TokenStream {
    let attr = parse_macro_input!(attr as syn::AttributeArgs);
    let options = match Options::from_list(&attr) {
        Ok(val) => val,
        Err(err) => {
            return err.write_errors().into();
        }
    };
    let psibase_mod = proc_macro2::TokenStream::from_str(&options.psibase_mod).unwrap();
    let item = parse_macro_input!(item as Item);
    match item {
        Item::Mod(impl_mod) => process_mod(&options, &psibase_mod, impl_mod),
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

fn process_mod(
    options: &Options,
    psibase_mod: &proc_macro2::TokenStream,
    mut impl_mod: ItemMod,
) -> TokenStream {
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
                process_action_args(psibase_mod, f, &mut action_structs, &mut invoke_args);
                process_dispatch_body(psibase_mod, f, &mut dispatch_body, invoke_args);
                if let Some(i) = f.attrs.iter().position(is_action_attr) {
                    f.attrs.remove(i);
                }
            }
        }
        add_unknown_action_check_to_dispatch_body(psibase_mod, &mut dispatch_body);
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
        if options.dispatch {
            items.push(parse_quote! {
                #[automatically_derived]
                pub mod wasm_interface {
                        pub fn dispatch(act: #psibase_mod::SharedAction) -> #psibase_mod::fracpack::Result<()> {
                        #dispatch_body
                        Ok(())
                    }

                    #[no_mangle]
                        pub extern "C" fn called(_this_service: u64, _sender: u64) {
                            #psibase_mod::with_current_action(|act| {
                            dispatch(act)
                                    .unwrap_or_else(|_| #psibase_mod::abort_message("unpack action data failed"));
                        });
                    }

                    extern "C" {
                        fn __wasm_call_ctors();
                    }

                    #[no_mangle]
                        pub unsafe extern "C" fn start(this_service: u64) {
                        __wasm_call_ctors();
                    }
                }
            });
        }
    } else {
        abort!(
            impl_mod,
            "#[psibase::service] module must have inline contents"
        )
    }
    impl_mod.to_token_stream().into()
} // process_mod

fn process_action_args(
    psibase_mod: &proc_macro2::TokenStream,
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
    let fracpack_mod = psibase_mod.to_string() + "::fracpack";
    *new_items = quote! {
        #new_items
        #[derive(#psibase_mod::Fracpack)]
        #[fracpack(fracpack_mod = #fracpack_mod)]
        pub struct #fn_name {
            #struct_members
        }
    }
}

fn process_dispatch_body(
    psibase_mod: &proc_macro2::TokenStream,
    f: &ItemFn,
    dispatch_body: &mut proc_macro2::TokenStream,
    invoke_args: proc_macro2::TokenStream,
) {
    let name = &f.sig.ident;

    let args_unpacking = if !invoke_args.is_empty() {
        quote! { let args = <super::action_structs::#name as #psibase_mod::fracpack::Packable>::unpack(&act.rawData, &mut 0)?; }
    } else {
        quote! {}
    };

    let action_invoking = if f.sig.output == ReturnType::Default {
        quote! {
            super::#name(#invoke_args);
        }
    } else {
        quote! {
            let val = super::#name(#invoke_args);
            #psibase_mod::set_retval(&val);
        }
    };

    let method_comparison =
        quote! { act.method == #psibase_mod::MethodNumber::from(stringify!(#name)) };

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

fn add_unknown_action_check_to_dispatch_body(
    psibase_mod: &proc_macro2::TokenStream,
    dispatch_body: &mut proc_macro2::TokenStream,
) {
    if !dispatch_body.is_empty() {
        *dispatch_body = quote! {
            #dispatch_body
            else {
                #psibase_mod::abort_message(&format!(
                    "unknown service action: {}",
                    act.method.to_string()
                ));
            }
        };
    }
}
