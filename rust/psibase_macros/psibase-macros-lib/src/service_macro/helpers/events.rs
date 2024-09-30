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

fn process_event_name(
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

fn process_event_schema(
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
