use proc_macro_error::{abort, emit_error};
use quote::quote;
use syn::{AttrStyle, Attribute, ItemFn};

#[derive(PartialEq, Eq, Hash)]
pub enum EventType {
    History,
    Ui,
    Merkle,
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
            #psibase_mod::put_sequential(self.event_log, self.sender, &#method_number, &(#invoke_args))
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
    insertions: &mut proc_macro2::TokenStream,
) {
    let name = &f.sig.ident;
    let name_str = name.to_string();
    let method_number =
        quote! {#psibase_mod::MethodNumber::new(#psibase_mod::method_raw!(#name_str))};

    *insertions = quote! {
        #insertions
        events.insert(#method_number, builder.insert::<#event_mod::#name>());
    }
}

pub fn parse_event_attr(attr: &Attribute) -> Option<EventType> {
    if let AttrStyle::Outer = attr.style {
        if attr.meta.path().is_ident("event") {
            // FOR DEMO
            // let mut num_event_types: u8 = 0;
            // let _ = attr.parse_nested_meta(|_meta| {
            //     num_event_types += 1;
            //     Ok(())
            // });
            // if num_event_types > 1 {
            //     abort!(attr, "Invalid number of events types; expected: 1.");
            // }
            // DEMO
            let mut event_type = None;
            let _ = attr.parse_nested_meta(|meta| {
                if meta.path.is_ident("history") {
                    event_type = Some(EventType::History);
                    return Ok(());
                }
                if meta.path.is_ident("ui") {
                    event_type = Some(EventType::Ui);
                    return Ok(());
                }
                if meta.path.is_ident("merkle") {
                    event_type = Some(EventType::Merkle);
                    return Ok(());
                }
                emit_error!(attr.meta, "expected history, ui, or merkle");
                return Err(meta.error("expected history, ui, or merkle"));
            });
            return event_type;
        }
    }
    None
}
