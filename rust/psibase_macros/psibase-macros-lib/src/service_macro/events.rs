use darling::{util::Flag, FromMeta};
use proc_macro_error::emit_error;
use quote::quote;
use std::fmt::Display;
use syn::{AttrStyle, Attribute, ItemFn};

#[derive(Copy, Clone, PartialEq, Eq, Hash)]
pub enum EventType {
    History,
    Merkle,
}

pub enum EventAccess {
    Private,
    Public,
}

impl Display for EventAccess {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(
            f,
            "{}",
            match self {
                Self::Private => "private",
                Self::Public => "public",
            }
        )
    }
}

pub struct EventOptions {
    pub db: EventType,
    pub access: EventAccess,
}

#[derive(Debug, FromMeta)]
struct RawEventOptions {
    history: Flag,
    merkle: Flag,
    public: Flag,
    private: Flag,
}

impl RawEventOptions {
    fn to_options(&self, location: &impl quote::ToTokens) -> EventOptions {
        let mut db = None;
        if self.history.is_present() {
            db = Some(EventType::History);
        }
        if self.merkle.is_present() {
            if db.is_some() {
                emit_error!(self.merkle.span(), "duplicate event specifier");
            } else {
                db = Some(EventType::Merkle);
            }
        }
        if db.is_none() {
            emit_error!(location, "expected history or merkle");
        }
        if self.public.is_present() && self.private.is_present() {
            emit_error!(self.public.span(), "duplicate access specifier");
        }
        let access = if self.public.is_present() {
            EventAccess::Public
        } else {
            EventAccess::Private
        };
        EventOptions {
            db: db.unwrap_or(EventType::History),
            access,
        }
    }
}

pub fn process_event_callers(
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
        .filter(|attr| {
            matches!(attr.style, AttrStyle::Inner(_)) && attr.meta.path().is_ident("doc")
        })
        .fold(quote! {}, |a, b| quote! {#a #b});
    let outer_doc = f
        .attrs
        .iter()
        .filter(|attr| matches!(attr.style, AttrStyle::Outer) && attr.meta.path().is_ident("doc"))
        .fold(quote! {}, |a, b| quote! {#a #b});

    *event_callers = quote! {
        #event_callers

        #outer_doc
        pub fn #name(&self, #inputs) -> u64 {
            #inner_doc
            <#psibase_mod::services::events::Wrapper as #psibase_mod::ServiceWrapper>::call().event(self.event_log, #method_number, #psibase_mod::fracpack::Pack::packed(&(#invoke_args)))
        }
    };
}

pub fn process_event_name(
    psibase_mod: &proc_macro2::TokenStream,
    f: &ItemFn,
    structs: &mut proc_macro2::TokenStream,
) {
    let name = &f.sig.ident;
    let name_str = name.to_string();
    let method_number =
        quote! {#psibase_mod::MethodNumber::new(#psibase_mod::method_raw!(#name_str))};

    *structs = quote! {
        #structs

        impl #psibase_mod::NamedEvent for #name {
            fn name() -> #psibase_mod::MethodNumber { #method_number }
        }
    }
}

pub fn process_event_schema(
    psibase_mod: &proc_macro2::TokenStream,
    event_mod: &proc_macro2::TokenStream,
    f: &ItemFn,
    options: &EventOptions,
    insertions: &mut proc_macro2::TokenStream,
) {
    let name = &f.sig.ident;
    let name_str = name.to_string();
    let access = options.access.to_string();

    *insertions = quote! {
        #insertions
        events.insert(#psibase_mod::MethodString(#name_str.to_string()), #psibase_mod::EventType{ type_: builder.insert::<#event_mod::#name>(), access: #access.to_string() });
    }
}

pub fn parse_event_attr(attr: &Attribute) -> Option<EventOptions> {
    if let AttrStyle::Outer = attr.style {
        if attr.meta.path().is_ident("event") {
            match RawEventOptions::from_meta(&attr.meta) {
                Ok(opt) => return Some(opt.to_options(&attr.meta)),
                Err(err) => {
                    emit_error!(attr, "{}", err);
                    return None;
                }
            }
        }
    }
    None
}
