use darling::FromMeta;
use proc_macro_error::abort;
use quote::{quote, ToTokens};
use syn::{AttrStyle, FnArg, ItemFn, Pat, ReturnType};

#[derive(Debug, FromMeta)]
#[darling(default)]
pub struct Options {
    pub name: String,
    pub recursive: bool,
    pub constant: String,
    pub actions: String,
    pub wrapper: String,
    pub structs: String,
    pub history_events: String,
    pub ui_events: String,
    pub merkle_events: String,
    pub event_structs: String,
    pub dispatch: Option<bool>,
    pub pub_constant: bool,
    pub psibase_mod: String,
    pub gql: bool,
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
            gql: true,
        }
    }
}

pub fn process_action_args(
    options: &Options,
    gql: bool,
    event_db: Option<&proc_macro2::TokenStream>,
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
    let psibase_mod_str = psibase_mod.to_string();
    let fracpack_mod = psibase_mod_str.clone() + "::fracpack";

    let doc = format!(
        "This structure has the same JSON and Fracpack format as the arguments to [{actions}::{fn_name}]({actions}::{fn_name}).",
        actions=options.actions, fn_name=fn_name.to_string());

    let gql_object_attr = if gql && !f.sig.inputs.is_empty() {
        quote! { , async_graphql::SimpleObject }
    } else {
        quote! {}
    };

    *new_items = quote! {
        #new_items
        #[derive(Debug, Clone, #psibase_mod::Pack, #psibase_mod::Unpack, #psibase_mod::fracpack::ToSchema, serde::Deserialize, serde::Serialize #gql_object_attr)]
        #[fracpack(fracpack_mod = #fracpack_mod)]
        #[doc = #doc]
        pub struct #fn_name {
            #struct_members
        }

        impl #fn_name {
            pub const ACTION_NAME: &'static str = stringify!(#fn_name);
        }
    };

    if let Some(db) = event_db {
        *new_items = quote! {
            #new_items
            impl #psibase_mod::EventDb for #fn_name {
                fn db() -> #psibase_mod::DbId {
                    #psibase_mod::DbId::#db
                }
            }
        }
    }
}

pub fn process_action_callers(
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
        .filter(|attr| {
            matches!(attr.style, AttrStyle::Inner(_)) && attr.meta.path().is_ident("doc")
        })
        .fold(quote! {}, |a, b| quote! {#a #b});
    let outer_doc = f
        .attrs
        .iter()
        .filter(|attr| matches!(attr.style, AttrStyle::Outer) && attr.meta.path().is_ident("doc"))
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

pub fn process_action_schema(
    psibase_mod: &proc_macro2::TokenStream,
    action_mod: &proc_macro2::TokenStream,
    f: &ItemFn,
    insertions: &mut proc_macro2::TokenStream,
) {
    let name = &f.sig.ident;
    let name_str = name.to_string();
    let method_number =
        quote! {#psibase_mod::MethodNumber::new(#psibase_mod::method_raw!(#name_str))};

    let ret = match &f.sig.output {
        ReturnType::Default => quote! { None },
        ReturnType::Type(_, ty) => {
            quote! { Some(builder.insert::<#ty>() ) }
        }
    };

    *insertions = quote! {
        #insertions
        actions.insert(#method_number, #psibase_mod::fracpack::FunctionType{ params: builder.insert::<#action_mod::#name>(), result: #ret });
    }
}
