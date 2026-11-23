use darling::{ast::NestedMeta, util::PathList, FromMeta};
use indexmap::IndexMap;
use proc_macro2::TokenStream;
use proc_macro_error::abort;
use quote::{quote, ToTokens};
use syn::{
    parse_quote, spanned::Spanned, AttrStyle, Attribute, FnArg, Ident, Item, ItemFn, Meta, Pat,
    ReturnType, Stmt,
};

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
    pub merkle_events: String,
    pub event_structs: String,
    pub dispatch: Option<bool>,
    pub pub_constant: bool,
    pub psibase_mod: String,
    pub gql: bool,
    pub tables: Option<String>,
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
            merkle_events: "MerkleEvents".into(),
            event_structs: "event_structs".into(),
            dispatch: None,
            pub_constant: true,
            psibase_mod: "psibase".into(),
            gql: true,
            tables: None,
        }
    }
}

/// The parameter names of an action or event, as the members of its
/// argument record (`a, b,`) and as read from a decoded record
/// (`args.a, args.b,`).
pub fn process_action_args(
    f: &ItemFn,
    invoke_args: &mut proc_macro2::TokenStream,
    invoke_struct_args: &mut proc_macro2::TokenStream,
) {
    for input in f.sig.inputs.iter() {
        match input {
            FnArg::Receiver(_) => (), // Compiler generates errors on self args
            FnArg::Typed(pat_type) => match &*pat_type.pat {
                Pat::Ident(name) => {
                    let name = &name.ident;
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
}

/// The parameters of an action as its caller declares them: without `mut`.
fn caller_inputs(f: &ItemFn) -> proc_macro2::TokenStream {
    let params = f.sig.inputs.iter().filter_map(|input| match input {
        FnArg::Receiver(_) => None,
        FnArg::Typed(pat_type) => match &*pat_type.pat {
            Pat::Ident(param) => {
                let ident = &param.ident;
                let ty = &pat_type.ty;
                Some(quote! { #ident: #ty })
            }
            _ => abort!(*pat_type.pat, "expected identifier"),
        },
    });
    quote! { #(#params),* }
}

pub fn process_action_callers(
    psibase_mod: &proc_macro2::TokenStream,
    args_mod: &proc_macro2::TokenStream,
    f: &ItemFn,
    action_callers: &mut proc_macro2::TokenStream,
    invoke_args: &proc_macro2::TokenStream,
) {
    let name = &f.sig.ident;
    let name_str = name.to_string();
    let method_number =
        quote! {#psibase_mod::MethodNumber::new(#psibase_mod::method_raw!(#name_str))};
    let inputs = caller_inputs(f);

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

    // The arguments of a call are the action's argument record.
    *action_callers = quote! {
        #action_callers

        #outer_doc
        pub fn #name(&self, #inputs) -> #caller_ret {
            #inner_doc
            self.caller.#call(#method_number, #args_mod::#name { #invoke_args })
        }
    };
}

pub fn process_action_schema(
    psibase_mod: &proc_macro2::TokenStream,
    args_mod: &proc_macro2::TokenStream,
    f: &ItemFn,
    insertions: &mut proc_macro2::TokenStream,
) {
    let name = &f.sig.ident;
    let name_str = name.to_string();

    *insertions = quote! {
        #insertions
        actions.insert(#name_str.to_string(), #psibase_mod::function_type::<#args_mod::#name>(builder));
    }
}

/// An action as a function of the trait the service's PSIO interface is
/// declared with: its documentation, name, parameters and result.
pub fn psio_interface_fn(f: &ItemFn) -> proc_macro2::TokenStream {
    let name = &f.sig.ident;
    let docs = f
        .attrs
        .iter()
        .filter(|attr| matches!(attr.style, AttrStyle::Outer) && attr.meta.path().is_ident("doc"));
    let params = f.sig.inputs.iter().map(|input| match input {
        FnArg::Receiver(receiver) => abort!(receiver, "an action takes no self"),
        FnArg::Typed(pat_type) => match &*pat_type.pat {
            Pat::Ident(param) => {
                let ident = &param.ident;
                let ty = &pat_type.ty;
                quote! { #ident: #ty }
            }
            _ => abort!(*pat_type.pat, "expected identifier"),
        },
    });
    let output = &f.sig.output;
    quote! {
        #(#docs)*
        fn #name(#(#params),*) #output;
    }
}

/// Two actions of one service may not share a method number: the
/// dispatcher could reach only one of them.
///
/// `method_number` is PSIO's method-name coder
/// (`psio::compress_name::method_to_number`), handed in by the proc-macro
/// crate; it is the one `MethodNumber` and `method_raw!` use.
pub fn check_method_number(
    method_number: &dyn Fn(&str) -> u64,
    f: &ItemFn,
    seen: &mut IndexMap<u64, Ident>,
) {
    let name = &f.sig.ident;
    let number = method_number(&name.to_string());
    if let Some(first) = seen.get(&number) {
        abort!(
            name,
            "actions `{}` and `{}` have the same method number; rename one of them",
            first,
            name
        );
    }
    seen.insert(number, name.clone());
}

pub struct PreAction {
    pub fn_name: Option<Ident>,
    pub exclude: PathList,
}

impl PreAction {
    pub fn has_pre_action(&self) -> bool {
        self.fn_name.is_some()
    }
}

impl Default for PreAction {
    fn default() -> Self {
        PreAction {
            fn_name: None,
            exclude: PathList::from(vec![]),
        }
    }
}

fn is_pre_action_attr(attr: &Attribute) -> bool {
    AttrStyle::Outer == attr.style && attr.meta.path().is_ident("pre_action")
}

#[derive(Debug, FromMeta)]
struct PreActionOptions {
    exclude: PathList,
}

pub fn check_for_pre_action(
    pre_action_info: &mut PreAction,
    items: &mut Vec<Item>,
) -> Result<(), TokenStream> {
    let mut num_pre_action_fns = 0;
    let mut sp: Option<Attribute> = None;
    for item in items.iter_mut() {
        if let Item::Fn(f) = item {
            let pre_action_attrs = f
                .attrs
                .clone()
                .into_iter()
                .filter(|attr| is_pre_action_attr(attr))
                .collect::<Vec<Attribute>>();
            let num_pa_attrs_on_fn = pre_action_attrs.len();
            if num_pa_attrs_on_fn == 0 {
                continue;
            }
            if num_pa_attrs_on_fn > 1 {
                return Err(
                    syn::Error::new(f.span(), "More than one pre_action attribute found.")
                        .to_compile_error(),
                );
            }
            num_pre_action_fns += 1;

            let pre_action_attr = pre_action_attrs.get(0).unwrap().clone();
            sp = Some(pre_action_attr.clone());

            pre_action_info.fn_name = Some(f.sig.ident.clone());

            pre_action_info.exclude = match pre_action_attr.meta.clone() {
                Meta::List(args) => {
                    let attr_args = NestedMeta::parse_meta_list(args.tokens.clone())
                        .unwrap_or_else(|err| {
                            abort!(
                                args.tokens,
                                format!("Invalid pre_action arguments: {}", err.to_string())
                            )
                        });

                    let options: PreActionOptions = PreActionOptions::from_list(&attr_args.clone())
                        .unwrap_or_else(|err| {
                            abort!(
                                args.tokens,
                                format!("Invalid pre_action arguments: {}", err.to_string())
                            );
                        });

                    options.exclude
                }
                Meta::Path(_) => PathList::new::<syn::Path>(vec![]),
                Meta::NameValue(args) => abort!(
                    args,
                    "Invalid pre_action attributes: expected list; got key-value pair."
                ),
            };

            if let Some(pre_action_pos) = f.attrs.iter().position(is_pre_action_attr) {
                f.attrs.remove(pre_action_pos);
            }
        }
    }
    if num_pre_action_fns > 1 {
        return Err(
            syn::Error::new(sp.span(), "Only 1 pre_action fn permitted.").to_compile_error(),
        );
    }
    Ok(())
}

pub fn add_pre_action_call_if_not_excluded(pre_action_info: &PreAction, f: &mut ItemFn) {
    if pre_action_info
        .exclude
        .to_strings()
        .contains(&f.sig.ident.to_string())
    {
        return;
    }
    let fn_name = pre_action_info.fn_name.clone().unwrap();
    let pre_action_line: Stmt = parse_quote! {
        self::#fn_name();
    };
    f.block.stmts.insert(0, pre_action_line);
}
