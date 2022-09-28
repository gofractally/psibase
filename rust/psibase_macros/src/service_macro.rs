use darling::FromMeta;
use proc_macro::TokenStream;
use proc_macro_error::abort;
use quote::{quote, ToTokens};
use std::str::FromStr;
use syn::{
    parse_macro_input, parse_quote, AttrStyle, Attribute, FnArg, Item, ItemFn, ItemMod, Pat,
    ReturnType,
};

#[derive(Debug, FromMeta)]
#[darling(default)]
pub struct Options {
    name: String,
    actions_name: String,
    wrapper_name: String,
    dispatch: bool,
    psibase_mod: String,
}

impl Default for Options {
    fn default() -> Self {
        Options {
            name: "".into(),
            actions_name: "".into(),
            wrapper_name: "".into(),
            dispatch: true,
            psibase_mod: "psibase".into(),
        }
    }
}

pub fn service_macro_impl(attr: TokenStream, item: TokenStream) -> TokenStream {
    let attr = parse_macro_input!(attr as syn::AttributeArgs);
    let mut options = match Options::from_list(&attr) {
        Ok(val) => val,
        Err(err) => {
            return err.write_errors().into();
        }
    };
    if options.name.is_empty() {
        options.name = std::env::var("CARGO_PKG_NAME").unwrap().replace('_', "-");
    }
    if options.actions_name.is_empty() {
        options.actions_name = "Actions".into();
    }
    if options.wrapper_name.is_empty() {
        options.wrapper_name = "Wrapper".into();
    }
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
    let name_str = options.name.to_string();
    let mut iface_use = proc_macro2::TokenStream::new();
    let mut action_structs = proc_macro2::TokenStream::new();
    let mut action_callers = proc_macro2::TokenStream::new();
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
                let mut invoke_struct_args = quote! {};
                process_action_args(
                    psibase_mod,
                    f,
                    &mut action_structs,
                    &mut invoke_args,
                    &mut invoke_struct_args,
                );
                process_action_callers(psibase_mod, f, &mut action_callers, &invoke_args);
                process_dispatch_body(psibase_mod, f, &mut dispatch_body, invoke_struct_args);
                if let Some(i) = f.attrs.iter().position(is_action_attr) {
                    f.attrs.remove(i);
                }
            }
        }
        add_unknown_action_check_to_dispatch_body(psibase_mod, &mut dispatch_body);
        items.push(parse_quote! {
            pub const SERVICE: #psibase_mod::AccountNumber =
                #psibase_mod::AccountNumber::new(#psibase_mod::account_raw!(#name_str));
        });
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
    let actions_name = proc_macro2::TokenStream::from_str(&options.actions_name).unwrap();
    let wrapper_name = proc_macro2::TokenStream::from_str(&options.wrapper_name).unwrap();
    quote! {
        #impl_mod

        #[derive(Clone)]
        #[automatically_derived]
        pub struct #actions_name <T: #psibase_mod::Caller> {
            pub caller: T,
        }

        #[automatically_derived]
        #[allow(non_snake_case)]
        impl<T: #psibase_mod::Caller> #actions_name<T> {
            #action_callers
        }

        #[automatically_derived]
        impl<T: #psibase_mod::Caller> From<T> for #actions_name<T> {
            fn from(caller: T) -> Self {
                Self{caller}
            }
        }

        #[automatically_derived]
        #[derive(Copy, Clone)]
        pub struct #wrapper_name;

        #[automatically_derived]
        impl #wrapper_name {
            const SERVICE: #psibase_mod::AccountNumber =
                #psibase_mod::AccountNumber::new(#psibase_mod::account_raw!(#name_str));

            pub fn pack() -> #actions_name<#psibase_mod::ActionPacker> {
                #psibase_mod::ActionPacker {
                    sender: Self::SERVICE,
                    service: Self::SERVICE,
                }
                .into()
            }

            pub fn pack_to(service: #psibase_mod::AccountNumber)
            -> #actions_name<#psibase_mod::ActionPacker>
            {
                #psibase_mod::ActionPacker {
                    sender: Self::SERVICE,
                    service,
                }
                .into()
            }

            pub fn pack_from(sender: #psibase_mod::AccountNumber)
            -> #actions_name<#psibase_mod::ActionPacker>
            {
                #psibase_mod::ActionPacker {
                    sender,
                    service: Self::SERVICE,
                }
                .into()
            }

            pub fn pack_from_to(sender: #psibase_mod::AccountNumber, service: #psibase_mod::AccountNumber)
            -> #actions_name<#psibase_mod::ActionPacker>
            {
                #psibase_mod::ActionPacker { sender, service }.into()
            }
        }
    }
    .into()
} // process_mod

fn process_action_args(
    psibase_mod: &proc_macro2::TokenStream,
    f: &ItemFn,
    new_items: &mut proc_macro2::TokenStream,
    invoke_args: &mut proc_macro2::TokenStream,
    invoke_struct_args: &mut proc_macro2::TokenStream,
) {
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
                        #name,
                    };
                    *invoke_struct_args = quote! {
                        #invoke_struct_args
                        args.#name,
                    };
                }
                _ => abort!(*pat_type.pat, "expected identifier"),
            },
        };
    }
    let fn_name = &f.sig.ident;
    let fracpack_mod = psibase_mod.to_string() + "::fracpack";

    let outer_doc = f
        .attrs
        .iter()
        .filter(|attr| matches!(attr.style, AttrStyle::Outer) && attr.path.is_ident("doc"))
        .fold(quote! {}, |a, b| quote! {#a #b});

    *new_items = quote! {
        #new_items
        #[derive(#psibase_mod::Fracpack)]
        #[fracpack(fracpack_mod = #fracpack_mod)]
        #outer_doc
        pub struct #fn_name {
            #struct_members
        }
    };
}

fn process_action_callers(
    psibase_mod: &proc_macro2::TokenStream,
    f: &ItemFn,
    action_callers: &mut proc_macro2::TokenStream,
    invoke_args: &proc_macro2::TokenStream,
) {
    let name = &f.sig.ident;
    let name_str = name.to_string();
    let method_number =
        quote! {#psibase_mod::MethodNumber::new(#psibase_mod::method_raw!(#name_str))};
    let inputs = &f.sig.inputs;

    let inner_doc = f
        .attrs
        .iter()
        .filter(|attr| matches!(attr.style, AttrStyle::Inner(_)) && attr.path.is_ident("doc"))
        .fold(quote! {}, |a, b| quote! {#a #b});
    let outer_doc = f
        .attrs
        .iter()
        .filter(|attr| matches!(attr.style, AttrStyle::Outer) && attr.path.is_ident("doc"))
        .fold(quote! {}, |a, b| quote! {#a #b});

    #[allow(unused_variables)]
    let fn_ret = match &f.sig.output {
        ReturnType::Default => quote! {()},
        ReturnType::Type(_, ty) => ty.to_token_stream(),
    };

    let caller_ret;
    let call;
    if fn_ret.to_string() == "()" {
        caller_ret = quote! {T::ReturnsNothing};
        call = quote! {call_returns_nothing};
    } else {
        caller_ret = quote! {T::ReturnType::<#fn_ret>};
        call = quote! {call::<#fn_ret, _>};
    }

    *action_callers = quote! {
        #action_callers

        #outer_doc
        pub fn #name(&self, #inputs) -> #caller_ret {
            #inner_doc
            self.caller.#call(#method_number, (#invoke_args))
        }
    };
}

fn process_dispatch_body(
    psibase_mod: &proc_macro2::TokenStream,
    f: &ItemFn,
    dispatch_body: &mut proc_macro2::TokenStream,
    invoke_struct_args: proc_macro2::TokenStream,
) {
    let name = &f.sig.ident;
    let name_str = name.to_string();

    let args_unpacking = if !invoke_struct_args.is_empty() {
        quote! { let args = <super::action_structs::#name as #psibase_mod::fracpack::Packable>::unpack(&act.rawData, &mut 0)?; }
    } else {
        quote! {}
    };

    let action_invoking = if f.sig.output == ReturnType::Default {
        quote! {
            super::#name(#invoke_struct_args);
        }
    } else {
        quote! {
            let val = super::#name(#invoke_struct_args);
            #psibase_mod::set_retval(&val);
        }
    };

    let method_comparison = quote! { act.method == #psibase_mod::MethodNumber::new(#psibase_mod::method_raw!(#name_str)) };

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
