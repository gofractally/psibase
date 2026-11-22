;; Valid engine control. The current psibase node policy admits only one
;; table, so this module must fail node preflight consistently.
(module
  (type $integer (func (param i32) (result i32)))
  (table 1 funcref)
  (table $secondary 1 funcref)
  (func $identity (type $integer) (param i32) (result i32) local.get 0)
  (elem (table $secondary) (i32.const 0) $identity)
  (func (export "valid") (param i32) (result i32)
    local.get 0 i32.const 0 call_indirect $secondary (type $integer))
)
