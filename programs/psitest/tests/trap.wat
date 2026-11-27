;; A test module that traps. psitest must say so and fail.
(module
  (memory (export "memory") 1)
  (func $inner unreachable)
  (func (export "_start") call $inner))
