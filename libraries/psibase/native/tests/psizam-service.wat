(module
  (import "env" "setRetval" (func $retval (param i32 i32)))
  (import "env" "getResult" (func $result (param i32 i32 i32) (result i32)))
  (import "env" "call" (func $call (param i32 i32 i64) (result i32)))
  (memory 1)
  (data (i32.const 128) "PSIZAM_NESTED_ACTION\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00")
  (global $counter (mut i32) (i32.const 7))
  (func (export "start") (param i64))
  (func (export "called") (param $service i64) (param $sender i64)
    local.get $sender i64.const 1 i64.eq
    if unreachable end
    local.get $sender i64.const 2 i64.eq
    if (loop $forever br $forever) end
    local.get $sender i64.const 3 i64.eq
    if i32.const 65535 i32.const 2 call $retval return end
    local.get $sender i64.const 4 i64.eq
    if
      i32.const 132 i32.const 128 i32.load i64.const 0 call $call drop
      i32.const 0 i32.const 4 i32.const 0 call $result drop
      i32.const 0 i32.const 4 call $retval return
    end
    global.get $counter i32.const 1 i32.add global.set $counter
    i32.const 0 global.get $counter i32.store
    i32.const 0 i32.const 4 call $retval))
