use crate::tables::tables::*;
use psibase::*;

impl NetworkVariables {
    pub fn get() -> Self {
        NetworkVariablesTable::read()
            .get_index_pk()
            .get(&())
            .unwrap_or_default()
    }
    pub fn set(new_vars: &Self) {
        let current = Self::get();

        check(
            new_vars.obj_storage_bytes >= current.obj_storage_bytes,
            "Objective storage allocation cannot decrease",
        );
        check(
            new_vars.subj_storage_bytes >= current.subj_storage_bytes,
            "Subjective storage allocation cannot decrease",
        );

        check(
            new_vars.obj_storage_bytes >= NetworkSpecs::obj_storage_offset(),
            "obj_storage_bytes must be >= reserved offset",
        );

        check(
            new_vars.obj_storage_bytes + new_vars.subj_storage_bytes
                <= ServerSpecs::get().unwrap_or_default().storage_bytes,
            "Total storage allocation must not exceed available server storage",
        );

        NetworkVariablesTable::read_write().put(new_vars).unwrap();
    }
}
