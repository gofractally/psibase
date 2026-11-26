;; A test module with an import psitest does not provide. psitest must fail
;; with wasmtime's reason; it has no other engine to try.
(module
  (import "env" "notATesterFunction" (func $missing))
  (memory (export "memory") 1)
  (func (export "_start") call $missing))
