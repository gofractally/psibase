use quote::quote;
use syn::{ItemFn, ReturnType};

pub fn process_dispatch_body(
    psibase_mod: &proc_macro2::TokenStream,
    f: &ItemFn,
    dispatch_body: &mut proc_macro2::TokenStream,
    invoke_struct_args: proc_macro2::TokenStream,
) {
    let name = &f.sig.ident;
    let name_str = name.to_string();

    let args_unpacking = if !invoke_struct_args.is_empty() {
        quote! { let args = <super::action_structs::#name as #psibase_mod::fracpack::Unpack>::unpacked(&act.rawData)?; }
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

pub fn add_unknown_action_check_to_dispatch_body(
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
