use proc_macro::TokenStream;
use quote::quote;

pub fn component_name_macro_impl() -> TokenStream {
    let manifest_dir = std::env::var_os("CARGO_MANIFEST_DIR").unwrap();
    let manifest_path = std::path::PathBuf::from(manifest_dir).join("Cargo.toml");
    let manifest_text = std::fs::read_to_string(manifest_path).unwrap();
    let manifest = toml::from_str::<toml::Table>(&manifest_text).unwrap();
    let name = manifest["package"]["metadata"]["component"]["package"].as_str();
    quote! { #name }.into()
}
