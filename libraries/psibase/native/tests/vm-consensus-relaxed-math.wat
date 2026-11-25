;; Correctness only. The selected deterministic profile defines madd/nmadd
;; as separately rounded multiply+add, signed dot operands and modular sums.
(module
  (func (export "relaxed_f32_madd") (param v128 v128 v128) (result v128)
    local.get 0 local.get 1 local.get 2 f32x4.relaxed_madd)
  (func (export "relaxed_f32_nmadd") (param v128 v128 v128) (result v128)
    local.get 0 local.get 1 local.get 2 f32x4.relaxed_nmadd)
  (func (export "relaxed_f64_madd") (param v128 v128 v128) (result v128)
    local.get 0 local.get 1 local.get 2 f64x2.relaxed_madd)
  (func (export "relaxed_f64_nmadd") (param v128 v128 v128) (result v128)
    local.get 0 local.get 1 local.get 2 f64x2.relaxed_nmadd)
  (func (export "relaxed_dot16") (param v128 v128) (result v128)
    local.get 0 local.get 1 i16x8.relaxed_dot_i8x16_i7x16_s)
  (func (export "relaxed_dot32_add") (param v128 v128 v128) (result v128)
    local.get 0 local.get 1 local.get 2 i32x4.relaxed_dot_i8x16_i7x16_add_s)
)
