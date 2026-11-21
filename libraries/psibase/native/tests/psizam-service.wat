(module
  (import "env" "setRetval" (func $retval (param i32 i32)))
  (memory 1)
  (global $counter (mut i32) (i32.const 7))
  (func (export "start") (param i64))
  (func (export "called") (param $service i64) (param $sender i64)
    local.get $sender i64.const 1 i64.eq
    if unreachable end
    local.get $sender i64.const 2 i64.eq
    if (loop $forever br $forever) end
    local.get $sender i64.const 3 i64.eq
    if i32.const 65535 i32.const 2 call $retval return end
    global.get $counter i32.const 1 i32.add global.set $counter
    i32.const 0 global.get $counter i32.store
    i32.const 0 i32.const 4 call $retval))
