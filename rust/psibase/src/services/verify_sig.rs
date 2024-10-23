#[crate::service(name = "verify-sig", dispatch = false, psibase_mod = "crate")]
#[allow(non_snake_case, unused_variables)]
mod service {
    const SERVICE_FLAGS: u64 = crate::CodeRow::IS_AUTH_SERVICE;
}
