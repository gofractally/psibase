;; A test module that never returns. psitest --timeout must stop it.
(module
  (memory (export "memory") 1)
  (func (export "_start")
    (loop $forever
      br $forever)))
