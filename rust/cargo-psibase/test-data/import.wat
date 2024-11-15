(module
  (type (;0;) (func (param i32)))
  (import "wasi_snapshot_preview1" "fd_close" (func (;0;) (type 0)))
  (func (;1;) (type 0) (param i32)  
    local.get 0
    call 0
  )
  (export "internal_fd_close" (func 1))
)
