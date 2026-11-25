;; Correctness-only: observe side effects before each distinct trap.
(module
  (import "consensus" "record" (func $record (param i32 i64)))
  (import "consensus" "fail" (func $fail))
  (memory 1)
  (global $marker (mut i32) (i32.const 0))
  (func $touch (param i32)
    local.get 0 global.set $marker
    i32.const 9 local.get 0 i32.store align=1
    local.get 0 i64.const 0x1122334455667788 call $record)
  (func (export "unreachable") i32.const 1 call $touch unreachable)
  (func (export "divide_zero") (result i32) i32.const 2 call $touch i32.const 7 i32.const 0 i32.div_s)
  (func (export "integer_overflow") (result i32) i32.const 3 call $touch i32.const -2147483648 i32.const -1 i32.div_s)
  (func (export "invalid_conversion") (result i32) i32.const 4 call $touch f32.const nan:0x412345 i32.trunc_f32_s)
  (func (export "memory_oob") (result i32) i32.const 5 call $touch i32.const 65535 i32.load)
  (func (export "host_error") i32.const 6 call $touch call $fail)
  (func $recurse (param i32) (result i32)
    local.get 0 i32.eqz
    if (result i32) i32.const 1
    else local.get 0 i32.const 1 i32.sub call $recurse i32.const 1 i32.add end)
  (func (export "bounded_recursion") (param i32) (result i32) local.get 0 call $recurse)
  (func (export "stack_overflow") (result i32) i32.const 7 call $touch i32.const 100000 call $recurse)
  (func (export "value") (result i32) i32.const 42))
