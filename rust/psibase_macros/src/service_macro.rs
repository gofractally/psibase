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
    constant: String,
    actions: String,
    wrapper: String,
    structs: String,
    dispatch: bool,
    pub_constant: bool,
    psibase_mod: String,
}

impl Default for Options {
    fn default() -> Self {
        Options {
            name: "".into(),
            constant: "SERVICE".into(),
            actions: "Actions".into(),
            wrapper: "Wrapper".into(),
            structs: "action_structs".into(),
            dispatch: true,
            pub_constant: true,
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
    let mod_name = &impl_mod.ident;
    let service_account = &options.name;
    let mut action_structs = proc_macro2::TokenStream::new();
    let mut action_callers = proc_macro2::TokenStream::new();
    let mut dispatch_body = proc_macro2::TokenStream::new();
    let constant = proc_macro2::TokenStream::from_str(&options.constant).unwrap();
    let actions = proc_macro2::TokenStream::from_str(&options.actions).unwrap();
    let wrapper = proc_macro2::TokenStream::from_str(&options.wrapper).unwrap();
    let structs = proc_macro2::TokenStream::from_str(&options.structs).unwrap();

    if let Some((_, items)) = &mut impl_mod.content {
        let mut action_fns: Vec<usize> = Vec::new();
        for (item_index, item) in items.iter_mut().enumerate() {
            if let Item::Fn(f) = item {
                if f.attrs.iter().any(is_action_attr) {
                    action_fns.push(item_index);
                }
            }
        }
        for fn_index in action_fns.iter() {
            if let Item::Fn(f) = &mut items[*fn_index] {
                let mut invoke_args = quote! {};
                let mut invoke_struct_args = quote! {};
                process_action_args(
                    options,
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
        let const_pub = if options.pub_constant {
            quote! {pub}
        } else {
            quote! {}
        };
        let constant_doc = format!(
            "The account this service normally runs on, \"{}\"",
            options.name
        );
        items.push(parse_quote! {
            #[doc = #constant_doc]
            #const_pub const #constant: #psibase_mod::AccountNumber =
                #psibase_mod::AccountNumber::new(#psibase_mod::account_raw!(#service_account));
        });
        items.push(parse_quote! {
            #[automatically_derived]
            #[allow(non_snake_case)]
            #[allow(non_camel_case_types)]
            #[allow(non_upper_case_globals)]
            /// These structs produce the same JSON and fracpack formats
            /// that the actions do.
            pub mod #structs {
                use super::*;
                #action_structs
            }
        });
        let doc = impl_mod
            .attrs
            .iter()
            .filter(|attr| matches!(attr.style, AttrStyle::Outer) && attr.path.is_ident("doc"))
            .fold(quote! {}, |a, b| quote! {#a #b});
        items.push(parse_quote! {
            #[derive(Clone)]
            #[automatically_derived]
            #doc
            pub struct #actions <T: #psibase_mod::Caller> {
                pub caller: T,
            }
        });
        items.push(parse_quote! {
            #[automatically_derived]
            #[allow(non_snake_case)]
            #[allow(non_camel_case_types)]
            #[allow(non_upper_case_globals)]
            impl<T: #psibase_mod::Caller> #actions<T> {
                #action_callers
            }
        });
        items.push(parse_quote! {
            #[automatically_derived]
            impl<T: #psibase_mod::Caller> From<T> for #actions<T> {
                fn from(caller: T) -> Self {
                    Self{caller}
                }
            }
        });
        items.push(parse_quote! {
            #[automatically_derived]
            #[derive(Copy, Clone)]
            /// Simplifies calling into the service
            pub struct #wrapper;
        });
        let pack_from_to_doc = format!(
            "
            Pack actions into [psibase::Action]({psibase}::Action).

            `pack` returns an object which has [methods]({actions}#implementations)
            (one per action) which pack the action's arguments using [fracpack] and
            return a [psibase::Action]({psibase}::Action). The `pack_*` series of
            functions is mainly useful to applications which push transactions
            to blockchains.

            ",
            psibase = options.psibase_mod,
            actions = options.actions
        );
        let pack_doc = format!(
            "{} This function defaults both `sender` and `service` to \"{}\".",
            pack_from_to_doc, options.name
        );
        let pack_to_doc = format!(
            "{} This function defaults `sender` to \"{}\".",
            pack_from_to_doc, options.name
        );
        let pack_from_doc = format!(
            "{} This function defaults `service` to \"{}\".",
            pack_from_to_doc, options.name
        );
        items.push(parse_quote! {
            #[automatically_derived]
            impl #wrapper {
                #[doc = #constant_doc]
                pub const SERVICE: #psibase_mod::AccountNumber =
                    #psibase_mod::AccountNumber::new(#psibase_mod::account_raw!(#service_account));

                #[doc = #pack_doc]
                pub fn pack() -> #actions<#psibase_mod::ActionPacker> {
                    #psibase_mod::ActionPacker {
                        sender: Self::#constant,
                        service: Self::#constant,
                    }
                    .into()
                }

                #[doc = #pack_to_doc]
                pub fn pack_to(service: #psibase_mod::AccountNumber)
                -> #actions<#psibase_mod::ActionPacker>
                {
                    #psibase_mod::ActionPacker {
                        sender: Self::#constant,
                        service,
                    }
                    .into()
                }

                #[doc = #pack_from_doc]
                pub fn pack_from(sender: #psibase_mod::AccountNumber)
                -> #actions<#psibase_mod::ActionPacker>
                {
                    #psibase_mod::ActionPacker {
                        sender,
                        service: Self::#constant,
                    }
                    .into()
                }

                #[doc = #pack_from_to_doc]
                pub fn pack_from_to(sender: #psibase_mod::AccountNumber, service: #psibase_mod::AccountNumber)
                -> #actions<#psibase_mod::ActionPacker>
                {
                    #psibase_mod::ActionPacker { sender, service }.into()
                }
            }
        });
        if options.dispatch {
            items.push(parse_quote! {
                #[automatically_derived]
                mod service_wasm_interface {
                    fn dispatch(act: #psibase_mod::SharedAction) -> #psibase_mod::fracpack::Result<()> {
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
    let reexport_constant = if options.pub_constant {
        quote! {
            #[automatically_derived]
            pub use #mod_name::#constant;
        }
    } else {
        quote! {}
    };
    quote! {
        #impl_mod
        #reexport_constant

        #[automatically_derived]
        pub use #mod_name::#actions;

        #[automatically_derived]
        pub use #mod_name::#wrapper;

        #[automatically_derived]
        pub use #mod_name::#structs;
    }
    .into()
} // process_mod

fn process_action_args(
    options: &Options,
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

    let doc = format!(
        "This structure has the same JSON and Fracpack format as the arguments to [{actions}::{fn_name}]({actions}::{fn_name}).",
        actions=options.actions, fn_name=fn_name.to_string());

    *new_items = quote! {
        #new_items
        #[derive(#psibase_mod::Fracpack)]
        #[fracpack(fracpack_mod = #fracpack_mod)]
        #[doc = #doc]
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
