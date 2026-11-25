(module
  (import "consensus" "reenter" (func $reenter (param i32) (result i32)))
  (memory 1 2)
  (func (export "reentry_leaf") (param i32) (result i32)
    local.get 0 i32.const 1 i32.add)
  (func (export "repeat_reentry") (param $count i32) (result i32)
    (local $i i32)
    block $done
      loop $next
        local.get $i local.get $count i32.ge_u br_if $done
        local.get $i call $reenter drop
        local.get $i i32.const 1 i32.add local.set $i
        br $next
      end
    end
    local.get $i)
)
