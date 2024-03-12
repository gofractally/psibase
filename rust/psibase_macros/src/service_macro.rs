use darling::FromMeta;
use proc_macro::TokenStream;
use proc_macro2::{Ident, Span};
use proc_macro_error::{abort, emit_error};
use quote::{quote, ToTokens};
use std::{collections::HashMap, str::FromStr};
use syn::{
    parse_macro_input, parse_quote, AttrStyle, Attribute, Field, FnArg, ImplItem, Item, ItemFn,
    ItemImpl, ItemMod, ItemStruct, Meta, NestedMeta, Pat, ReturnType, Type,
};

#[derive(Debug, FromMeta)]
#[darling(default)]
pub struct TableOptions {
    name: String,
    record: Option<String>,
    index: u16,
}

impl Default for TableOptions {
    fn default() -> Self {
        TableOptions {
            name: "".into(),
            record: None,
            index: 0,
        }
    }
}

#[derive(Debug, FromMeta)]
#[darling(default)]
pub struct Options {
    name: String,
    recursive: bool,
    constant: String,
    actions: String,
    wrapper: String,
    structs: String,
    history_events: String,
    ui_events: String,
    merkle_events: String,
    event_structs: String,
    dispatch: Option<bool>,
    pub_constant: bool,
    psibase_mod: String,
}

impl Default for Options {
    fn default() -> Self {
        Options {
            name: "".into(),
            recursive: false,
            constant: "SERVICE".into(),
            actions: "Actions".into(),
            wrapper: "Wrapper".into(),
            structs: "action_structs".into(),
            history_events: "HistoryEvents".into(),
            ui_events: "UiEvents".into(),
            merkle_events: "MerkleEvents".into(),
            event_structs: "event_structs".into(),
            dispatch: None,
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
    if options.dispatch.is_none() {
        options.dispatch = Some(std::env::var_os("CARGO_PRIMARY_PACKAGE").is_some());
    }
    if std::env::var_os("CARGO_PSIBASE_TEST").is_some() {
        options.dispatch = Some(false);
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

fn is_table_attr(attr: &Attribute) -> bool {
    if let AttrStyle::Outer = attr.style {
        if attr.path.is_ident("table") {
            return true;
        }
    }
    false
}

#[derive(PartialEq, Eq, Hash)]
enum EventType {
    History,
    Ui,
    Merkle,
}

fn parse_event_attr(attr: &Attribute) -> Option<EventType> {
    if let AttrStyle::Outer = attr.style {
        if attr.path.is_ident("event") {
            match attr.parse_meta() {
                Ok(Meta::List(list)) => {
                    if list.nested.len() == 1 {
                        if let Some(NestedMeta::Meta(Meta::Path(inner))) = list.nested.first() {
                            if inner.is_ident("history") {
                                return Some(EventType::History);
                            } else if inner.is_ident("ui") {
                                return Some(EventType::Ui);
                            } else if inner.is_ident("merkle") {
                                return Some(EventType::Merkle);
                            } else {
                                emit_error!(inner, "expected history, ui, or merkle");
                                return None;
                            }
                        }
                    }
                }
                _ => {}
            }
            emit_error!(attr, "invalid event attribute");
        }
    }
    None
}

fn is_event_attr(attr: &Attribute) -> bool {
    matches!(attr.style, AttrStyle::Outer) && attr.path.is_ident("event")
}

fn process_mod(
    options: &Options,
    psibase_mod: &proc_macro2::TokenStream,
    mut impl_mod: ItemMod,
) -> TokenStream {
    let mod_name = &impl_mod.ident;
    let service_account = &options.name;
    let service_account_str = service_account.to_string();
    let constant = proc_macro2::TokenStream::from_str(&options.constant).unwrap();
    let actions = proc_macro2::TokenStream::from_str(&options.actions).unwrap();
    let history_events = proc_macro2::TokenStream::from_str(&options.history_events).unwrap();
    let ui_events = proc_macro2::TokenStream::from_str(&options.ui_events).unwrap();
    let merkle_events = proc_macro2::TokenStream::from_str(&options.merkle_events).unwrap();
    let event_structs_mod = proc_macro2::TokenStream::from_str(&options.event_structs).unwrap();
    let wrapper = proc_macro2::TokenStream::from_str(&options.wrapper).unwrap();
    let structs = proc_macro2::TokenStream::from_str(&options.structs).unwrap();
    let psibase_mod_str = psibase_mod.to_string();

    if let Some((_, items)) = &mut impl_mod.content {
        let mut table_structs: HashMap<Ident, Vec<usize>> = HashMap::new();
        let mut action_fns: Vec<usize> = Vec::new();
        let mut event_fns: HashMap<EventType, Vec<usize>> = HashMap::new();
        for (item_index, item) in items.iter_mut().enumerate() {
            if let Item::Struct(s) = item {
                if s.attrs.iter().any(is_table_attr) {
                    table_structs.insert(s.ident.clone(), vec![item_index]);
                }
            }

            if let Item::Fn(f) = item {
                if f.attrs.iter().any(is_action_attr) {
                    f.attrs.push(parse_quote! {#[allow(dead_code)]});
                    action_fns.push(item_index);
                }
                for attr in &f.attrs {
                    if let Some(kind) = parse_event_attr(attr) {
                        event_fns.entry(kind).or_insert(Vec::new()).push(item_index);
                    }
                }
            }
        }

        // A second loop is needed in case the code has `impl` for a relevant table above the struct definition
        for (item_index, item) in items.iter().enumerate() {
            if let Item::Impl(i) = item {
                if let Type::Path(type_path) = &*i.self_ty {
                    if let Some(tpps) = type_path.path.segments.first() {
                        table_structs.entry(tpps.ident.clone()).and_modify(|refs| {
                            refs.push(item_index);
                        });
                    }
                }
            }
        }

        let mut processed_tables = Vec::new();
        for (tb_name, items_idxs) in table_structs.iter() {
            let table_idx = process_service_tables(psibase_mod, tb_name, items, items_idxs);
            processed_tables.push((tb_name, table_idx));
        }

        // Validates table indexes
        processed_tables.sort_by_key(|t| t.1);
        for (expected_idx, (table_struct, tb_index)) in processed_tables.iter().enumerate() {
            if *tb_index as usize != expected_idx {
                abort!(
                    table_struct,
                    format!("Missing expected table index {}; tables may not have gaps and may not be removed or reordered.", expected_idx)
                );
            }
        }

        let mut action_structs = proc_macro2::TokenStream::new();
        let mut action_callers = proc_macro2::TokenStream::new();
        let mut dispatch_body = proc_macro2::TokenStream::new();
        let mut reflect_methods = proc_macro2::TokenStream::new();
        let mut with_action_struct = proc_macro2::TokenStream::new();
        for fn_index in action_fns.iter() {
            if let Item::Fn(f) = &mut items[*fn_index] {
                let mut invoke_args = quote! {};
                let mut invoke_struct_args = quote! {};
                let mut reflect_args = quote! {};
                process_action_args(
                    options,
                    psibase_mod,
                    f,
                    &mut action_structs,
                    &mut invoke_args,
                    &mut invoke_struct_args,
                    &mut reflect_args,
                );
                process_action_callers(psibase_mod, f, &mut action_callers, &invoke_args);
                process_dispatch_body(psibase_mod, f, &mut dispatch_body, invoke_struct_args);
                let name = &f.sig.ident;
                let name_str = name.to_string();
                let num_args = f.sig.inputs.len();
                let output = match &f.sig.output {
                    ReturnType::Default => quote! {()},
                    ReturnType::Type(_, t) => quote! {#t},
                };
                reflect_methods = quote! {
                    #reflect_methods
                    .method::<#output>(#name_str.into(), #num_args)
                    #reflect_args
                    .end()
                };
                with_action_struct = quote! {
                    #with_action_struct
                    if action == #name_str {
                        return Some(process.process::<#output, #structs::#name>());
                    }
                };
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
        let static_type = quote! {#psibase_mod::JustSchema}.to_string();
        items.push(parse_quote! {
            #[derive(Debug, Clone, #psibase_mod::Reflect)]
            #[reflect(psibase_mod = #psibase_mod_str, static_type=#static_type)]
            #[automatically_derived]
            #doc
            pub struct #actions <T: #psibase_mod::Caller> {
                #[reflect(skip)]
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

        let call_from_to_doc = format!(
            "
            Call another service.

            This method returns an object which has [methods]({actions}#implementations)
            (one per action) which call another service and return the result from the call.
            This method is only usable by services.

            ",
            actions = options.actions
        );
        let call_doc = format!(
            "{} This method defaults `sender` to [`{psibase}::get_sender`] and `service` to \"{}\".",
            call_from_to_doc, options.name,            psibase = options.psibase_mod,
        );
        let call_to_doc = format!(
            "{} This method defaults `sender` to [`{psibase}::get_sender`].",
            call_from_to_doc,
            psibase = options.psibase_mod,
        );
        let call_from_doc = format!(
            "{} This method defaults `service` to \"{}\".",
            call_from_to_doc, options.name
        );

        let push_from_to_doc = format!(
            "
            push transactions to [psibase::Chain]({psibase}::Chain).

            This method returns an object which has [methods]({actions}#implementations)
            (one per action) which push transactions to a test chain and return a
            [psibase::ChainResult]({psibase}::ChainResult) or
            [psibase::ChainEmptyResult]({psibase}::ChainEmptyResult). This final object
            can verify success or failure and can retrieve the return value, if any.

            ",
            psibase = options.psibase_mod,
            actions = options.actions
        );
        let push_doc = format!(
            "{} This method defaults both `sender` and `service` to \"{}\".",
            push_from_to_doc, options.name
        );
        let push_to_doc = format!(
            "{} This method defaults `sender` to \"{}\".",
            push_from_to_doc, options.name
        );
        let push_from_doc = format!(
            "{} This method defaults `service` to \"{}\".",
            push_from_to_doc, options.name
        );

        let pack_from_to_doc = format!(
            "
            Pack actions into [psibase::Action]({psibase}::Action).

            This method returns an object which has [methods]({actions}#implementations)
            (one per action) which pack the action's arguments using [fracpack] and
            return a [psibase::Action]({psibase}::Action). The `pack_*` series of
            functions is mainly useful to applications which push transactions
            to blockchains.

            ",
            psibase = options.psibase_mod,
            actions = options.actions
        );
        let pack_doc = format!(
            "{} This method defaults both `sender` and `service` to \"{}\".",
            pack_from_to_doc, options.name
        );
        let pack_to_doc = format!(
            "{} This method defaults `sender` to \"{}\".",
            pack_from_to_doc, options.name
        );
        let pack_from_doc = format!(
            "{} This method defaults `service` to \"{}\".",
            pack_from_to_doc, options.name
        );
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

                #[doc = #call_doc]
                pub fn call() -> #actions<#psibase_mod::ServiceCaller> {
                    #psibase_mod::ServiceCaller {
                        sender: #psibase_mod::get_service(),
                        service: Self::#constant,
                    }
                    .into()
                }

                #[doc = #call_to_doc]
                pub fn call_to(service: #psibase_mod::AccountNumber)
                -> #actions<#psibase_mod::ServiceCaller>
                {
                    #psibase_mod::ServiceCaller {
                        sender: #psibase_mod::get_service(),
                        service,
                    }
                    .into()
                }

                #[doc = #call_from_doc]
                pub fn call_from(sender: #psibase_mod::AccountNumber)
                -> #actions<#psibase_mod::ServiceCaller>
                {
                    #psibase_mod::ServiceCaller {
                        sender,
                        service: Self::#constant,
                    }
                    .into()
                }

                #[doc = #call_from_to_doc]
                pub fn call_from_to(
                    sender: #psibase_mod::AccountNumber,
                    service: #psibase_mod::AccountNumber)
                -> #actions<#psibase_mod::ServiceCaller>
                {
                    #psibase_mod::ServiceCaller { sender, service }.into()
                }

                #[doc = #push_doc]
                pub fn push(chain: &#psibase_mod::Chain) -> #actions<#psibase_mod::ChainPusher> {
                    #psibase_mod::ChainPusher {
                        chain,
                        sender: Self::#constant,
                        service: Self::#constant,
                    }
                    .into()
                }

                #[doc = #push_to_doc]
                pub fn push_to(chain: &#psibase_mod::Chain, service: #psibase_mod::AccountNumber)
                -> #actions<#psibase_mod::ChainPusher>
                {
                    #psibase_mod::ChainPusher {
                        chain,
                        sender: Self::#constant,
                        service,
                    }
                    .into()
                }

                #[doc = #push_from_doc]
                pub fn push_from(chain: &#psibase_mod::Chain, sender: #psibase_mod::AccountNumber)
                -> #actions<#psibase_mod::ChainPusher>
                {
                    #psibase_mod::ChainPusher {
                        chain,
                        sender,
                        service: Self::#constant,
                    }
                    .into()
                }

                #[doc = #push_from_to_doc]
                pub fn push_from_to(
                    chain: &#psibase_mod::Chain,
                    sender: #psibase_mod::AccountNumber,
                    service: #psibase_mod::AccountNumber)
                -> #actions<#psibase_mod::ChainPusher>
                {
                    #psibase_mod::ChainPusher { chain, sender, service }.into()
                }

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

                #[doc = #emit_from_doc]
                pub fn emit() -> EmitEvent {
                    EmitEvent { sender: Self::#constant }
                }

                #[doc = #emit_doc]
                pub fn emit_from(sender: #psibase_mod::AccountNumber) -> EmitEvent {
                    EmitEvent { sender }
                }
            }
        });

        items.push(parse_quote! {
            #[automatically_derived]
            pub struct #history_events {
                event_log: #psibase_mod::DbId,
                sender: #psibase_mod::AccountNumber,
            }
        });

        items.push(parse_quote! {
            #[automatically_derived]
            pub struct #ui_events {
                event_log: #psibase_mod::DbId,
                sender: #psibase_mod::AccountNumber,
            }
        });

        items.push(parse_quote! {
            #[automatically_derived]
            pub struct #merkle_events {
                event_log: #psibase_mod::DbId,
                sender: #psibase_mod::AccountNumber,
            }
        });

        items.push(parse_quote! {
            pub struct EmitEvent {
                sender: #psibase_mod::AccountNumber,
            }
        });

        items.push(parse_quote! {
            impl EmitEvent {
                pub fn history(&self) -> #history_events {
                    #history_events { event_log: #psibase_mod::DbId::HistoryEvent, sender: self.sender }
                }
                pub fn ui(&self) -> #ui_events {
                    #ui_events { event_log: #psibase_mod::DbId::UiEvent, sender: self.sender }
                }
                pub fn merkle(&self) -> #merkle_events {
                    #merkle_events { event_log: #psibase_mod::DbId::MerkleEvent, sender: self.sender }
                }
            }
        });

        for (kind, fns) in event_fns {
            let mut event_callers = proc_macro2::TokenStream::new();
            let mut event_structs = quote! {};
            for fn_index in fns {
                if let Item::Fn(f) = &items[fn_index] {
                    let mut invoke_args = quote! {};
                    let mut invoke_struct_args = quote! {};
                    let mut reflect_args = quote! {};
                    process_action_args(
                        options,
                        psibase_mod,
                        f,
                        &mut event_structs,
                        &mut invoke_args,
                        &mut invoke_struct_args,
                        &mut reflect_args,
                    );
                    process_event_callers(psibase_mod, f, &mut event_callers, &invoke_args);
                }
            }
            let event_name = match kind {
                EventType::History => &history_events,
                EventType::Ui => &ui_events,
                EventType::Merkle => &merkle_events,
            };
            items.push(parse_quote! {
                #[automatically_derived]
                #[allow(non_snake_case)]
                #[allow(non_camel_case_types)]
                #[allow(non_upper_case_globals)]
                impl #event_name {
                    #event_callers
                }
            });
            let event_module_name = match kind {
                EventType::History => quote!(history),
                EventType::Ui => quote!(ui),
                EventType::Merkle => quote!(merkle),
            };
            items.push(parse_quote! {
                #[automatically_derived]
                #[allow(non_snake_case)]
                #[allow(non_camel_case_types)]
                #[allow(non_upper_case_globals)]
                mod #event_structs_mod {
                    mod #event_module_name {
                        use super::super::*;
                        #event_structs
                    }
                }
            });
        }

        let num_actions = action_fns.len();
        items.push(parse_quote! {
            #[automatically_derived]
            impl #psibase_mod::reflect::Reflect for #wrapper {
                type StaticType = #wrapper;
                fn reflect<V: #psibase_mod::reflect::Visitor>(visitor: V) -> V::Return {
                    use #psibase_mod::reflect::StructVisitor;
                    use #psibase_mod::reflect::MethodsVisitor;
                    use #psibase_mod::reflect::ArgVisitor;
                    visitor
                        .struct_named::<#wrapper>(#service_account_str.into(), 0)
                        .with_methods(#num_actions)
                        #reflect_methods
                        .end()
                }
            }
        });
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
                #[automatically_derived]
                #[cfg(target_family = "wasm")]
                mod service_wasm_interface {
                    fn dispatch(act: #psibase_mod::SharedAction) -> #psibase_mod::fracpack::Result<()> {
                        #dispatch_body
                        Ok(())
                    }

                    #[no_mangle]
                    pub unsafe extern "C" fn called(_this_service: u64, sender: u64) {
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

                    extern "C" {
                        fn __wasm_call_ctors();
                    }

                    #[no_mangle]
                    pub unsafe extern "C" fn start(this_service: u64) {
                        __wasm_call_ctors();
                        #psibase_mod::set_service(#psibase_mod::AccountNumber::new(this_service));
                    }
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
    }
    .into()
} // process_mod

struct PkIdentData {
    ident: Ident,
    ty: proc_macro2::TokenStream,
    call_ident: proc_macro2::TokenStream,
}

impl PkIdentData {
    fn new(
        ident: Ident,
        ty: proc_macro2::TokenStream,
        call_ident: proc_macro2::TokenStream,
    ) -> Self {
        Self {
            ident,
            ty,
            call_ident,
        }
    }
}

struct SkIdentData {
    ident: Ident,
    idx: u8,
    ty: proc_macro2::TokenStream,
}

impl SkIdentData {
    fn new(ident: Ident, idx: u8, ty: proc_macro2::TokenStream) -> Self {
        Self { ident, idx, ty }
    }
}

fn process_service_tables(
    psibase_mod: &proc_macro2::TokenStream,
    table_record_struct_name: &Ident,
    items: &mut Vec<Item>,
    table_idxs: &Vec<usize>,
) -> u16 {
    let mut pk_data: Option<PkIdentData> = None;
    let mut secondary_keys = Vec::new();
    let mut table_options: Option<TableOptions> = None;
    let mut table_vis = None;
    let mut preset_table_record: Option<String> = None;

    for idx in table_idxs {
        match &mut items[*idx] {
            Item::Struct(s) => {
                process_table_attrs(s, &mut table_options);
                preset_table_record = table_options
                    .as_ref()
                    .and_then(|opts| opts.record.to_owned());
                if preset_table_record.is_none() {
                    process_table_fields(s, &mut pk_data);
                } else {
                    let fields_named: syn::FieldsNamed =
                        parse_quote! {{ db_id: #psibase_mod::DbId, prefix: Vec<u8> }};
                    s.fields = syn::Fields::Named(fields_named);
                }
                table_vis = Some(s.vis.clone());
            }
            Item::Impl(i) => process_table_impls(i, &mut pk_data, &mut secondary_keys),
            item => abort!(item, "Unknown table item to be processed"),
        }
    }

    if table_options.is_none() {
        abort!(table_record_struct_name, "Table name and index not defined");
    }
    let table_options = table_options.unwrap();

    if pk_data.is_none() && preset_table_record.is_none() {
        abort!(
            table_record_struct_name,
            "Table record has not defined a primary key"
        );
    }

    secondary_keys.sort_by_key(|sk| sk.idx);
    let mut sks_fns = quote! {};
    let mut sks = quote! {};
    let sks_len = secondary_keys.len() as u8;
    for (idx, secondary_key) in secondary_keys.iter().enumerate() {
        let sk_ident = &secondary_key.ident;
        let sk_idx = secondary_key.idx;
        let sk_ty = &secondary_key.ty;

        let expected_idx = idx + 1;
        if sk_idx as usize != expected_idx {
            abort!(sk_ident, format!("Missing expected secondary index {}; indexes may not have gaps and may not be removed or reordered", expected_idx));
        }

        sks = quote! { #sks #psibase_mod::RawKey::new(self.#sk_ident().to_key()), };

        let sk_fn_name = Ident::new(&format!("get_index_{}", sk_ident), Span::call_site());

        sks_fns = quote! {
            #sks_fns
            fn #sk_fn_name(&self) -> #psibase_mod::TableIndex<#sk_ty, #table_record_struct_name> {
                use #psibase_mod::Table;
                self.get_index(#sk_idx)
            }
        }
    }

    if preset_table_record.is_none() {
        let pk_data = pk_data.unwrap();
        let pk_ty = pk_data.ty;
        let pk_call_ident = pk_data.call_ident;

        let table_record_impl = quote! {
            impl #psibase_mod::TableRecord for #table_record_struct_name {
                type PrimaryKey = #pk_ty;
                const SECONDARY_KEYS: u8 = #sks_len;

                fn get_primary_key(&self) -> Self::PrimaryKey {
                    self.#pk_call_ident
                }

                fn get_secondary_keys(&self) -> Vec<#psibase_mod::RawKey> {
                    vec![#sks]
                }
            }
        };
        items.push(parse_quote! {#table_record_impl});
    }

    let table_index = table_options.index;
    let table_index = quote! { #table_index };

    let (table_name_id, record_name_id) = if let Some(preset_table_record) = preset_table_record {
        (
            table_record_struct_name.clone(),
            Ident::new(
                preset_table_record.as_str(),
                table_record_struct_name.span(),
            ),
        )
    } else {
        let table_name = Ident::new(table_options.name.as_str(), table_record_struct_name.span());
        let table_struct = quote! {
            #table_vis struct #table_name {
                db_id: #psibase_mod::DbId,
                prefix: Vec<u8>,
            }
        };
        items.push(parse_quote! {#table_struct});
        (table_name, table_record_struct_name.clone())
    };

    // TODO: This specific naming convention is a bit of a hack. Figure out a way of using an associated type
    let table_record_type_id = Ident::new(
        format!("{}Record", table_name_id).as_str(),
        table_record_struct_name.span(),
    );

    let table_record_type_impl = quote! {
        type #table_record_type_id = #record_name_id;
    };
    items.push(parse_quote! {#table_record_type_impl});

    let table_impl = quote! {
        impl #psibase_mod::Table<#record_name_id> for #table_name_id {
            const TABLE_INDEX: u16 = #table_index;

            fn with_prefix(db_id: #psibase_mod::DbId, prefix: Vec<u8>) -> Self {
                #table_name_id{db_id, prefix}
            }

            fn prefix(&self) -> &[u8] {
                &self.prefix
            }

            fn db_id(&self) -> #psibase_mod::DbId {
                self.db_id
            }
        }
    };
    items.push(parse_quote! {#table_impl});

    let table_struct_impl = quote! {
        impl #table_name_id {
            #sks_fns
        }
    };
    items.push(parse_quote! {#table_struct_impl});

    table_options.index
}

fn process_table_attrs(table_struct: &mut ItemStruct, table_options: &mut Option<TableOptions>) {
    // Parse table name and remove #[table]
    if let Some(i) = table_struct.attrs.iter().position(is_table_attr) {
        let attr = &table_struct.attrs[i];

        match TableOptions::from_meta(&attr.parse_meta().unwrap()) {
            Ok(options) => {
                *table_options = Some(options);
            }
            Err(err) => {
                abort!(attr, format!("Invalid service table attribute, expected `#[table(name = \"TableName\", index = N)]\n{}`", err));
            }
        };

        // TODO: Think about this sugar attribute #[table(TableName, 1)]
        // *table_name = syn::parse2::<Group>(attr.tokens.clone())
        //     .and_then(|group| syn::parse2::<Ident>(group.stream()))
        //     .map(|ident| quote! {#ident})
        //     .unwrap_or_else(|_| {
        //         abort!(
        //             attr,
        //             "Invalid service table attribute, expected is `#[table(TableName)]`"
        //         )
        //     });

        table_struct.attrs.remove(i);
    }
}

fn process_table_fields(table_record_struct: &mut ItemStruct, pk_data: &mut Option<PkIdentData>) {
    for field in table_record_struct.fields.iter_mut() {
        let mut removable_attr_idxs = Vec::new();

        for (field_attr_idx, field_attr) in field.attrs.iter().enumerate() {
            if field_attr.style == AttrStyle::Outer && field_attr.path.is_ident("primary_key") {
                process_table_pk_field(pk_data, field);
                removable_attr_idxs.push(field_attr_idx);
            }
        }

        for i in removable_attr_idxs {
            field.attrs.remove(i);
        }
    }
}

fn process_table_impls(
    table_impl: &mut ItemImpl,
    pk_data: &mut Option<PkIdentData>,
    secondary_keys: &mut Vec<SkIdentData>,
) {
    for impl_item in table_impl.items.iter_mut() {
        if let ImplItem::Method(method) = impl_item {
            let mut removable_attr_idxs = Vec::new();

            for (attr_idx, attr) in method.attrs.iter().enumerate() {
                if attr.style == AttrStyle::Outer {
                    if attr.path.is_ident("primary_key") {
                        let pk_method = &method.sig.ident;
                        check_unique_pk(pk_data, pk_method);

                        if let ReturnType::Type(_, return_type) = &method.sig.output {
                            let pk_type = quote! {#return_type};
                            let pk_call = quote! {#pk_method()};
                            *pk_data = Some(PkIdentData::new(pk_method.clone(), pk_type, pk_call));
                        } else {
                            let pk_type = quote! {()};
                            let pk_call = quote! {#pk_method()};
                            *pk_data = Some(PkIdentData::new(pk_method.clone(), pk_type, pk_call));
                        }

                        removable_attr_idxs.push(attr_idx);
                    } else if attr.path.is_ident("secondary_key") {
                        if let Ok(lit) = attr.parse_args::<syn::LitInt>() {
                            if let Ok(idx) = lit.base10_parse::<u8>() {
                                if idx == 0 {
                                    abort!(method, "Index 0 is reserved for Primary Key, secondary keys needs to be at least 1");
                                }

                                if let ReturnType::Type(_, return_type) = &method.sig.output {
                                    let sk_method = &method.sig.ident;
                                    let sk_type = quote! {#return_type};
                                    secondary_keys.push(SkIdentData::new(
                                        sk_method.clone(),
                                        idx,
                                        sk_type,
                                    ));
                                } else {
                                    abort!(impl_item, "Invalid secondary key return type, make sure it is a valid ToKey.");
                                }
                            } else {
                                abort!(
                                    method,
                                    "Invalid secondary key index number it needs to be a valid u8."
                                );
                            }
                        } else {
                            abort!(method, "Unable to parse secondary key index number.");
                        }

                        removable_attr_idxs.push(attr_idx);
                    }
                }
            }

            for i in removable_attr_idxs {
                method.attrs.remove(i);
            }
        }
    }
}

fn check_unique_pk(pk_data: &Option<PkIdentData>, item_ident: &Ident) {
    if pk_data.is_some() {
        abort!(
            item_ident,
            format!(
                "Primary key already set on {}.",
                pk_data.as_ref().unwrap().ident
            )
        )
    }
}

fn process_table_pk_field(pk_data: &mut Option<PkIdentData>, field: &Field) {
    let pk_field_ident = field
        .ident
        .as_ref()
        .expect("Attempt to add a Primary key field with no ident");
    check_unique_pk(pk_data, pk_field_ident);

    let pk_fn_name = quote! {#pk_field_ident};
    let pk_type = &field.ty;
    let pk_type = quote! {#pk_type};

    *pk_data = Some(PkIdentData::new(
        pk_field_ident.clone(),
        pk_type,
        pk_fn_name,
    ));
}

fn process_action_args(
    options: &Options,
    psibase_mod: &proc_macro2::TokenStream,
    f: &ItemFn,
    new_items: &mut proc_macro2::TokenStream,
    invoke_args: &mut proc_macro2::TokenStream,
    invoke_struct_args: &mut proc_macro2::TokenStream,
    reflect_args: &mut proc_macro2::TokenStream,
) {
    let mut struct_members = proc_macro2::TokenStream::new();
    for input in f.sig.inputs.iter() {
        match input {
            FnArg::Receiver(_) => (), // Compiler generates errors on self args
            FnArg::Typed(pat_type) => match &*pat_type.pat {
                Pat::Ident(name) => {
                    let name_str = name.ident.to_string();
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
                    *reflect_args = quote! {
                        #reflect_args
                        .arg::<#ty>(#name_str.into())
                    };
                }
                _ => abort!(*pat_type.pat, "expected identifier"),
            },
        };
    }
    let fn_name = &f.sig.ident;
    let psibase_mod_str = psibase_mod.to_string();
    let fracpack_mod = psibase_mod_str.clone() + "::fracpack";

    let doc = format!(
        "This structure has the same JSON and Fracpack format as the arguments to [{actions}::{fn_name}]({actions}::{fn_name}).",
        actions=options.actions, fn_name=fn_name.to_string());

    *new_items = quote! {
        #new_items
        #[derive(Debug, Clone, #psibase_mod::Pack, #psibase_mod::Unpack, #psibase_mod::Reflect, serde::Deserialize, serde::Serialize)]
        #[fracpack(fracpack_mod = #fracpack_mod)]
        #[reflect(psibase_mod = #psibase_mod_str)]
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
        quote! { let args = <super::action_structs::#name as #psibase_mod::fracpack::Unpack>::unpack(&act.rawData, &mut 0)?; }
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

fn process_event_callers(
    psibase_mod: &proc_macro2::TokenStream,
    f: &ItemFn,
    event_callers: &mut proc_macro2::TokenStream,
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

    *event_callers = quote! {
        #event_callers

        #outer_doc
        pub fn #name(&self, #inputs) -> u64 {
            #inner_doc
            #psibase_mod::put_sequential(self.event_log, self.sender, &#method_number, &(#invoke_args))
        }
    };
}
