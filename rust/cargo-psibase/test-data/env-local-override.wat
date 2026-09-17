(module
  (type $t (func (param i32) (result i32)))
  (import "env" "kvOpenAt" (func $imported (type $t)))
  (import "psibase" "other" (func $keep (type $t)))
  (func $local (type $t) (param i32) (result i32)
    local.get 0
  )
  (export "kvOpenAt" (func $local))
  (func (export "user") (param i32) (result i32)
    local.get 0
    call $imported
    call $keep
  )
)
