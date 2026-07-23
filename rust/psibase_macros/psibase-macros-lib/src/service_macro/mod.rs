mod actions;
mod dispatch;
mod events;
mod graphql;

use actions::{
    add_pre_action_call_if_not_excluded, check_for_pre_action, process_action_args,
    process_action_callers, process_action_schema, Options, PreAction,
};
use darling::ast::NestedMeta;
use darling::{Error, FromMeta};
use dispatch::{add_unknown_action_check_to_dispatch_body, process_dispatch_body};
use events::{
    parse_event_attr, process_event_callers, process_event_name, process_event_schema, EventType,
};
use graphql::{process_gql_union, process_gql_union_member};
use proc_macro2::TokenStream;
use proc_macro_error::abort;
use quote::quote;
use std::{collections::HashMap, str::FromStr};
use syn::{parse_quote, AttrStyle, Attribute, Item, ItemMod, ReturnType};

pub fn service_macro_impl(attr: TokenStream, item: TokenStream) -> TokenStream {
    let attr_args = match NestedMeta::parse_meta_list(attr) {
        Ok(v) => v,
        Err(e) => {
            return TokenStream::from(Error::from(e).write_errors());
        }
    };

    let mut options: Options = match Options::from_list(&attr_args) {
        Ok(val) => val,
        Err(err) => {
            return err.write_errors().into();
        }
    };

    if options.name.is_empty() {
        options.name = std::env::var("CARGO_PKG_NAME").unwrap().replace('_', "-");
    }
    if options.dispatch.is_none() {
        options.dispatch = Some(true);
    }

    let psibase_mod = proc_macro2::TokenStream::from_str(&options.psibase_mod).unwrap();
    let item = syn::parse2::<syn::Item>(item).unwrap();
    match item {
        Item::Mod(impl_mod) => process_mod(&options, &psibase_mod, impl_mod),
        _ => {
            abort!(item, "service attribute may only be used on a module")
        }
    }
}

fn is_event_attr(attr: &Attribute) -> bool {
    matches!(attr.style, AttrStyle::Outer) && attr.meta.path().is_ident("event")
}

fn is_action_attr(attr: &Attribute) -> bool {
    if let AttrStyle::Outer = attr.style {
        if attr.meta.path().is_ident("action") {
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
    let service_account = &options.name;
    let constant = proc_macro2::TokenStream::from_str(&options.constant).unwrap();
    let actions = proc_macro2::TokenStream::from_str(&options.actions).unwrap();
    let history_events = proc_macro2::TokenStream::from_str(&options.history_events).unwrap();
    let ui_events = proc_macro2::TokenStream::from_str(&options.ui_events).unwrap();
    let merkle_events = proc_macro2::TokenStream::from_str(&options.merkle_events).unwrap();
    let event_structs_mod = proc_macro2::TokenStream::from_str(&options.event_structs).unwrap();
    let wrapper = proc_macro2::TokenStream::from_str(&options.wrapper).unwrap();
    let structs = proc_macro2::TokenStream::from_str(&options.structs).unwrap();
    let mut tables = options
        .tables
        .as_ref()
        .map(|tables| proc_macro2::TokenStream::from_str(tables.as_str()).unwrap());
    if tables.is_none() {
        crate::service_tables_macro::process_mod(psibase_mod, &mut impl_mod);
        let name = &impl_mod.ident;
        tables = Some(quote! { #name })
    }

    let mod_name = &impl_mod.ident;

    let mut pre_action_info: PreAction = PreAction::default();

    if let Some((_, items)) = &mut impl_mod.content {
        let mut action_fns: Vec<usize> = Vec::new();
        let mut non_action_fns: Vec<usize> = Vec::new();
        let mut event_fns: HashMap<EventType, Vec<usize>> = HashMap::new();
        let pa_ret = check_for_pre_action(&mut pre_action_info, items);
        if pa_ret.is_err() {
            return pa_ret.err().unwrap();
        }
        for (item_index, item) in items.iter_mut().enumerate() {
            if let Item::Fn(f) = item {
                if f.attrs.iter().any(is_action_attr) {
                    f.attrs.push(parse_quote! {#[allow(dead_code)]});
                    action_fns.push(item_index);
                } else {
                    non_action_fns.push(item_index);
                }
                for attr in &f.attrs {
                    if let Some(kind) = parse_event_attr(attr) {
                        event_fns.entry(kind).or_insert(Vec::new()).push(item_index);
                    }
                }
            }
        }

        let mut action_structs = proc_macro2::TokenStream::new();
        let mut action_schema_init = quote! {};
        let mut action_callers = proc_macro2::TokenStream::new();
        let mut dispatch_body = proc_macro2::TokenStream::new();
        let mut with_action_struct = proc_macro2::TokenStream::new();
        for fn_index in action_fns.iter() {
            if let Item::Fn(f) = &mut items[*fn_index] {
                let mut invoke_args = quote! {};
                let mut invoke_struct_args = quote! {};
                if pre_action_info.has_pre_action() {
                    add_pre_action_call_if_not_excluded(&pre_action_info, f);
                }
                process_action_args(
                    options,
                    false,
                    None,
                    psibase_mod,
                    f,
                    &mut action_structs,
                    &mut invoke_args,
                    &mut invoke_struct_args,
                );
                process_action_schema(psibase_mod, &structs, f, &mut action_schema_init);
                process_action_callers(psibase_mod, f, &mut action_callers, &invoke_args);
                process_dispatch_body(psibase_mod, f, &mut dispatch_body, invoke_struct_args);
                let name = &f.sig.ident;
                let name_str = name.to_string();
                let output = match &f.sig.output {
                    ReturnType::Default => quote! {()},
                    ReturnType::Type(_, t) => quote! {#t},
                };
                with_action_struct = quote! {
                    #with_action_struct
                    if action == #name_str {
                        return Some(process.process::<#output, #structs::#name>());
                    }
                };
                if let Some(i) = f.attrs.iter().position(is_action_attr) {
                    // If this is an action, remove the action attribute
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
            .filter(|attr| {
                matches!(attr.style, AttrStyle::Outer) && attr.meta.path().is_ident("doc")
            })
            .fold(quote! {}, |a, b| quote! {#a #b});
        items.push(parse_quote! {
            #[derive(Debug, Clone)]
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
            impl<T: #psibase_mod::Caller> #psibase_mod::ToActionsSchema for #actions<T> {
                fn to_schema(builder: &mut #psibase_mod::fracpack::SchemaBuilder) -> #psibase_mod::fracpack::indexmap::IndexMap<#psibase_mod::MethodString, #psibase_mod::fracpack::FunctionType> {
                    let mut actions = #psibase_mod::fracpack::indexmap::IndexMap::new();
                    #action_schema_init
                    actions
                }
            }
        });
        items.push(parse_quote! {
            #[automatically_derived]
            #[derive(Copy, Clone)]
            /// Simplifies calling into the service
            pub struct #wrapper;
        });

        let emit_from_doc = format!(
            "
            Emit events from a service.

            "
        );
        let emit_doc = format!(
            "{} This method defaults `service` to \"{}\".",
            emit_from_doc, options.name
        );

        items.push(parse_quote! {
            #[automatically_derived]
            impl #wrapper {
                #[doc = #constant_doc]
                pub const SERVICE: #psibase_mod::AccountNumber =
                    #psibase_mod::AccountNumber::new(#psibase_mod::account_raw!(#service_account));

                #[doc = #emit_doc]
                pub fn emit() -> EmitEvent {
                    EmitEvent { sender: Self::#constant }
                }

                #[doc = #emit_from_doc]
                pub fn emit_from(sender: #psibase_mod::AccountNumber) -> EmitEvent {
                    EmitEvent { sender }
                }
            }
        });

        let database_wrapper = tables.as_ref().map_or(
            quote! { #psibase_mod::EmptyDatabase },
            |tables| quote! { super::#tables::TablesWrapper },
        );

        items.push(parse_quote! {
            impl #psibase_mod::ToServiceSchema for #wrapper {
                type Actions = #actions<#psibase_mod::JustSchema>;
                type UiEvents = #ui_events;
                type HistoryEvents = #history_events;
                type MerkleEvents = #merkle_events;
                type Database = #database_wrapper;
                const SERVICE: #psibase_mod::AccountNumber = Self::#constant;
            }
        });

        items.push(parse_quote! {
            #[automatically_derived]
            impl #psibase_mod::ServiceWrapper for #wrapper {
                const SERVICE: #psibase_mod::AccountNumber = Self::SERVICE;
                type Actions<T: #psibase_mod::Caller> = #actions<T>;
                fn with_caller<T: #psibase_mod::Caller>(caller: T) -> #actions<T> {
                    caller.into()
                }
            }
        });

        items.push(parse_quote! {
            #[automatically_derived]
            pub struct #history_events {
                event_log: #psibase_mod::EventDb,
                sender: #psibase_mod::AccountNumber,
            }
        });

        items.push(parse_quote! {
            #[automatically_derived]
            pub struct #ui_events {
                event_log: #psibase_mod::EventDb,
                sender: #psibase_mod::AccountNumber,
            }
        });

        items.push(parse_quote! {
            #[automatically_derived]
            pub struct #merkle_events {
                event_log: #psibase_mod::EventDb,
                sender: #psibase_mod::AccountNumber,
            }
        });

        items.push(parse_quote! {
            pub struct EmitEvent {
                sender: #psibase_mod::AccountNumber,
            }
        });

        for (id, event_name) in [
            (EventType::History, &history_events),
            (EventType::Ui, &ui_events),
            (EventType::Merkle, &merkle_events),
        ] {
            if !event_fns.contains_key(&id) {
                items.push( parse_quote! {
                    impl #psibase_mod::ToEventsSchema for #event_name {
                        fn to_schema(_builder: &mut #psibase_mod::fracpack::SchemaBuilder) -> #psibase_mod::fracpack::indexmap::IndexMap<#psibase_mod::MethodString, #psibase_mod::fracpack::AnyType> {
                            Default::default()
                        }
                    }
                });
            }
        }

        items.push(parse_quote! {
            impl EmitEvent {
                pub fn history(&self) -> #history_events {
                    #history_events { event_log: #psibase_mod::EventDb::HistoryEvent, sender: self.sender }
                }
                pub fn merkle(&self) -> #merkle_events {
                    #merkle_events { event_log: #psibase_mod::EventDb::MerkleEvent, sender: self.sender }
                }
            }
        });

        let mut event_structs_decls = Vec::new();

        for (kind, fns) in event_fns {
            let event_name = match kind {
                EventType::History => &history_events,
                EventType::Ui => &ui_events,
                EventType::Merkle => &merkle_events,
            };
            let db = match kind {
                EventType::History => quote! {HistoryEvent},
                EventType::Ui => quote! {UiEvent},
                EventType::Merkle => quote! {MerkleEvent},
            };
            let event_module_name = match kind {
                EventType::History => quote!(history),
                EventType::Ui => quote!(ui),
                EventType::Merkle => quote!(merkle),
            };
            let mut event_callers = proc_macro2::TokenStream::new();
            let mut event_structs = quote! {};
            let mut event_schema_init = quote! {};
            let mut gql_members = proc_macro2::TokenStream::new();
            let mut gql_dispatch = proc_macro2::TokenStream::new();
            for fn_index in fns {
                if let Item::Fn(f) = &items[fn_index] {
                    let mut invoke_args = quote! {};
                    let mut invoke_struct_args = quote! {};
                    process_action_args(
                        options,
                        options.gql,
                        Some(&db),
                        psibase_mod,
                        f,
                        &mut event_structs,
                        &mut invoke_args,
                        &mut invoke_struct_args,
                    );
                    process_event_callers(psibase_mod, f, &mut event_callers, &invoke_args);
                    process_event_name(psibase_mod, f, &mut event_structs);
                    process_event_schema(
                        psibase_mod,
                        &quote! { #event_structs_mod::#event_module_name},
                        f,
                        &mut event_schema_init,
                    );
                    if options.gql {
                        process_gql_union_member(
                            psibase_mod,
                            event_name,
                            f,
                            &mut gql_members,
                            &mut gql_dispatch,
                        );
                    }
                }
            }
            items.push(parse_quote! {
                #[automatically_derived]
                #[allow(non_snake_case)]
                #[allow(non_camel_case_types)]
                #[allow(non_upper_case_globals)]
                impl #event_name {
                    #event_callers
                }
            });
            items.push(parse_quote! {
                #[automatically_derived]
                impl #psibase_mod::ToEventsSchema for #event_name {
                    fn to_schema(builder: &mut #psibase_mod::fracpack::SchemaBuilder) -> #psibase_mod::fracpack::indexmap::IndexMap<#psibase_mod::MethodString, #psibase_mod::fracpack::AnyType> {
                        let mut events = #psibase_mod::fracpack::indexmap::IndexMap::new();
                        #event_schema_init
                        events
                    }
                }
            });
            if options.gql {
                process_gql_union(
                    psibase_mod,
                    event_name,
                    &gql_members,
                    &gql_dispatch,
                    &db,
                    &mut event_structs,
                )
            }
            event_structs_decls.push(quote! {
                pub mod #event_module_name {
                    use super::super::*;
                    #event_structs
                }
                pub use #event_module_name::#event_name;
            });
        }

        if !event_structs_decls.is_empty() {
            items.push(parse_quote! {
                #[automatically_derived]
                #[allow(non_snake_case)]
                #[allow(non_camel_case_types)]
                #[allow(non_upper_case_globals)]
                pub mod #event_structs_mod {
                    #(#event_structs_decls)*
                }
            });
        }

        items.push(parse_quote! {
            #[automatically_derived]
            impl #psibase_mod::WithActionStruct for #wrapper {
                // TODO: macro doc for this
                fn with_action_struct<P: #psibase_mod::ProcessActionStruct>(action: &str, process: P) -> Option<P::Output> {
                    #with_action_struct
                    None
                }
            }
        });
        let begin_protection = if options.recursive {
            quote! {}
        } else {
            quote! {
                static mut executing: bool = false;
                if executing {
                    #psibase_mod::abort_message_bytes(b"Service is not recursive");
                }
                executing = true;
            }
        };
        let end_protection = if options.recursive {
            quote! {}
        } else {
            quote! {
                executing = false;
            }
        };
        if options.dispatch.unwrap() {
            items.push(parse_quote! {
                #[cfg(not(test))]
                #[automatically_derived]
                #[cfg(target_family = "wasm")]
                pub mod service_wasm_interface {
                    use super::super::*;
                    pub use #psibase_mod as psibase;
                    pub use psibase_service;
                    pub use super::#wrapper as Wrapper;
                    fn dispatch(act: #psibase_mod::SharedAction) -> #psibase_mod::fracpack::Result<()> {
                        #dispatch_body
                        Ok(())
                    }

                    pub unsafe fn called(_this_service: u64, sender: u64) {
                        #begin_protection
                        let prev = #psibase_mod::get_sender();
                        #psibase_mod::set_sender(#psibase_mod::AccountNumber::new(sender));
                        #psibase_mod::with_current_action(|act| {
                            dispatch(act)
                                    .unwrap_or_else(|_| #psibase_mod::abort_message("unpack action data failed"));
                        });
                        #psibase_mod::set_sender(prev);
                        #end_protection
                    }

                    pub unsafe fn start(this_service: u64) {
                        #psibase_mod::set_service(#psibase_mod::AccountNumber::new(this_service));
                        #psibase_mod::service_start();
                    }
                }
            });
        }
        if let Some(tables) = tables {
            items.push(parse_quote! {
                impl #psibase_mod::ServiceTablesWrapper for super::#tables::TablesWrapper {
                    const SERVICE: #psibase_mod::AccountNumber = #constant;
                }
            });
        }
        // Remove all event functions
        items.retain(|item| {
            if let Item::Fn(f) = item {
                return !f.attrs.iter().any(|attr| is_event_attr(attr));
            }
            return true;
        });
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
    let silence = if options.dispatch.unwrap() {
        quote! {}
    } else {
        quote! {#[allow(dead_code)]}
    };
    let polyfill = gen_polyfill(psibase_mod);
    let export_wasm_interface = if options.dispatch.unwrap() {
        quote! {
            #[cfg(not(test))]
            #[automatically_derived]
            #[cfg(target_family = "wasm")]
            pub use #mod_name::service_wasm_interface;
        }
    } else {
        quote! {}
    };

    quote! {
        #silence
        #impl_mod
        #reexport_constant

        #[automatically_derived]
        pub use #mod_name::#actions;

        #[automatically_derived]
        pub use #mod_name::#wrapper;

        #[automatically_derived]
        pub use #mod_name::#structs;

        #export_wasm_interface
        #polyfill
    }
    .into()
} // process_mod

fn gen_polyfill(psibase_mod: &proc_macro2::TokenStream) -> proc_macro2::TokenStream {
    quote! {
        #[cfg(all(test, target_family="wasm"))]
        mod psibase_tester_polyfill {
            #![allow(non_snake_case)]
            use #psibase_mod::tester_raw;
            use #psibase_mod::tester;
            use #psibase_mod::{DbId, KvMode};
            use #psibase_mod::native_raw::KvHandle;
            use tester_raw::get_selected_chain;

            #[no_mangle]
            pub unsafe extern "C" fn getResult(dest: *mut u8, dest_size: u32, offset: u32) -> u32 {
                tester_raw::getResult(dest, dest_size, offset)
            }

            #[no_mangle]
            pub unsafe extern "C" fn getKey(dest: *mut u8, dest_size: u32) -> u32 {
                tester::polyfill::getKey(dest, dest_size)
            }

            #[no_mangle]
            pub unsafe extern "C" fn writeConsole(message: *const u8, len: u32) {
                print!("{}", std::str::from_utf8(std::slice::from_raw_parts(message, len as usize)).unwrap());
            }

            #[no_mangle]
            pub unsafe extern "C" fn abortMessage(message: *const u8, len: u32) -> ! {
                tester_raw::abortMessage(message, len)
            }

            #[no_mangle]
            pub unsafe extern "C" fn kvOpen(db: DbId, key: *const u8, key_len: u32, mode: KvMode) -> KvHandle {
                tester::polyfill::kvOpen(db, key, key_len, mode)
            }

            #[no_mangle]
            pub unsafe extern "C" fn psibase_proxy_kv_open(db: DbId, key: *const u8, key_len: u32, mode: KvMode) -> KvHandle {
                tester::polyfill::kvOpen(db, key, key_len, mode)
            }

            #[no_mangle]
            pub unsafe extern "C" fn kvOpenAt(db: KvHandle, key: *const u8, key_len: u32, mode: KvMode) -> KvHandle {
                tester::polyfill::kvOpenAt(db, key, key_len, mode)
            }

            #[no_mangle]
            pub unsafe extern "C" fn kvClose(handle: KvHandle) {
                tester::polyfill::kvClose(handle)
            }

            #[no_mangle]
            pub unsafe extern "C" fn kvGet(db: KvHandle, key: *const u8, key_len: u32) -> u32 {
                tester::polyfill::kvGet(db, key, key_len)
            }

            #[no_mangle]
            pub unsafe extern "C" fn kvGreaterEqual(
                db: KvHandle,
                key: *const u8,
                key_len: u32,
                match_key_size: u32,
            ) -> u32 {
                tester::polyfill::kvGreaterEqual(db, key, key_len, match_key_size)
            }

            #[no_mangle]
            pub unsafe extern "C" fn kvLessThan(db: KvHandle, key: *const u8, key_len: u32, match_key_size: u32) -> u32 {
                tester::polyfill::kvLessThan(db, key, key_len, match_key_size)
            }

            #[no_mangle]
            pub unsafe extern "C" fn kvMax(db: KvHandle, key: *const u8, key_len: u32) -> u32 {
                tester::polyfill::kvMax(db, key, key_len)
            }

            #[no_mangle]
            pub unsafe extern "C" fn kvPut(db: KvHandle, key: *const u8, key_len: u32, value: *const u8, value_len: u32) {
                tester::polyfill::kvPut(db, key, key_len, value, value_len)
            }

            #[no_mangle]
            pub unsafe extern "C" fn kvRemove(db: KvHandle, key: *const u8, key_len: u32) {
                tester::polyfill::kvRemove(db, key, key_len)
            }

            #[no_mangle]
            pub unsafe extern "C" fn setRetval(_retval: *const u8, _len: u32) -> u32 {
                panic!("setRetval not supported in tester");
            }
            #[no_mangle]
            pub unsafe extern "C" fn call(action: *const u8, len: u32, flags: u64) -> u32 {
                panic!("call not supported in tester");
            }
            #[no_mangle]
            pub unsafe extern "C" fn getCurrentAction() -> u32 {
                panic!("getCurrentAction not supported in tester");
            }
        }
    }
}
