;; A test module that exits with a status through WASI and writes a line
;; first: the smallest use of the tester's host functions and linear memory.
(module
  (import "wasi_snapshot_preview1" "fd_write" (func $fd_write (param i32 i32 i32 i32) (result i32)))
  (import "wasi_snapshot_preview1" "proc_exit" (func $proc_exit (param i32)))
  (memory (export "memory") 1)
  (data (i32.const 16) "hello from the test module\n")
  ;; One iovec at 5, deliberately not 4-aligned: (buf = 16, len = 27).
  (data (i32.const 5) "\10\00\00\00\1b\00\00\00")
  (func (export "_start")
    (drop (call $fd_write (i32.const 1) (i32.const 5) (i32.const 1) (i32.const 0)))
    (call $proc_exit (i32.const 0))))
