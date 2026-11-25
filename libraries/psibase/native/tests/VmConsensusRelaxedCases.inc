// Included after the shared Matrix implementation in VmConsensusTests.cpp.
// Verification only; these are not performance workloads.
namespace
{
   constexpr psizam::v128_t repeated32(uint32_t bits)
   {
      uint64_t pair = uint64_t(bits) | (uint64_t(bits) << 32);
      return {pair, pair};
   }
   constexpr psizam::v128_t repeated8(uint8_t bits)
   {
      uint64_t bytes = uint64_t(bits) * 0x0101010101010101ull;
      return {bytes, bytes};
   }
   void vectorEquals(const Observation& actual, psizam::v128_t expected)
   {
      CHECK(actual.result.type == psizam::v128);
      CHECK(actual.result.low == expected.low);
      CHECK(actual.result.high == expected.high);
   }
}

TEST_CASE("VM deterministic relaxed SIMD preserves rounding signed dots and modular sums")
{
   REQUIRE(psibase::NativeVMOptions::enable_relaxed_simd);
   Matrix m(PSIBASE_VM_CONSENSUS_RELAXED_MATH_WASM);

   // The exact product is 1+2ulp+ulp^2. Separate multiply/add returns zero;
   // a fused multiply-add returns ulp^2. Code version 0 is the strict profile:
   // it must not fuse, whatever the hardware or LLVM contraction would do.
   vectorEquals(m.call("relaxed_f32_madd", repeated32(0x3f800001), repeated32(0x3f800001),
                        repeated32(0xbf800002)), repeated32(0));
   vectorEquals(m.call("relaxed_f32_nmadd", repeated32(0x3f800001), repeated32(0x3f800001),
                        repeated32(0x3f800002)), repeated32(0));
   psizam::v128_t onePlus{0x3ff0000000000001ull, 0x3ff0000000000001ull};
   vectorEquals(m.call("relaxed_f64_madd", onePlus, onePlus,
                        psizam::v128_t{0xbff0000000000002ull, 0xbff0000000000002ull}), {0, 0});
   vectorEquals(m.call("relaxed_f64_nmadd", onePlus, onePlus,
                        psizam::v128_t{0x3ff0000000000002ull, 0x3ff0000000000002ull}), {0, 0});

   vectorEquals(m.call("relaxed_dot16", repeated8(0xff), repeated8(0x80)),
                {0x0100010001000100ull, 0x0100010001000100ull});
   vectorEquals(m.call("relaxed_dot16", repeated8(0xff), repeated8(2)),
                {0xfffcfffcfffcfffcull, 0xfffcfffcfffcfffcull});
   vectorEquals(m.call("relaxed_dot32_add", repeated8(0xff), repeated8(0x80),
                        psizam::v128_t{0xffffffffffffffffull, 0x7fffffff7fffffffull}),
                {0x000001ff000001ffull, 0x800001ff800001ffull});
   vectorEquals(m.call("relaxed_dot32_add", repeated8(0x7f), repeated8(0x80), psizam::v128_t{0, 0}),
                {0xffff0200ffff0200ull, 0xffff0200ffff0200ull});

   // These vectors include +0/-0, infinities, subnormals, qNaN and sNaN with
   // distinct payload/signs. Compare every result bit and all state for every
   // backend; WASM's permissive arithmetic-NaN matcher is never used here.
   for (size_t i = 0; i < f32Seeds.size(); ++i)
   {
      auto a32 = repeated32(f32Seeds[i]);
      auto b32 = repeated32(f32Seeds[(i + 1) % f32Seeds.size()]);
      auto c32 = repeated32(f32Seeds[(i + 7) % f32Seeds.size()]);
      m.call("relaxed_f32_madd", a32, b32, c32);
      m.call("relaxed_f32_nmadd", a32, b32, c32);
      psizam::v128_t a64{f64Seeds[i], f64Seeds[(i + 3) % f64Seeds.size()]};
      psizam::v128_t b64{f64Seeds[(i + 1) % f64Seeds.size()], f64Seeds[(i + 9) % f64Seeds.size()]};
      psizam::v128_t c64{f64Seeds[(i + 7) % f64Seeds.size()], f64Seeds[(i + 5) % f64Seeds.size()]};
      m.call("relaxed_f64_madd", a64, b64, c64);
      m.call("relaxed_f64_nmadd", a64, b64, c64);
   }
}

TEST_CASE("VM code version 1 fuses relaxed multiply-add on every engine")
{
   REQUIRE(psibase::nativeFloatProfile(0) == psizam::float_profile::strict);
   REQUIRE(psibase::nativeFloatProfile(1) == psizam::float_profile::performance);
   REQUIRE(!psibase::nativeFloatProfile(2));
   Matrix m(PSIBASE_VM_CONSENSUS_RELAXED_MATH_WASM, 1);

   // One rounding keeps the ulp^2 term: 2^-46 in f32 and 2^-104 in f64.
   vectorEquals(m.call("relaxed_f32_madd", repeated32(0x3f800001), repeated32(0x3f800001),
                        repeated32(0xbf800002)), repeated32(0x28800000));
   vectorEquals(m.call("relaxed_f32_nmadd", repeated32(0x3f800001), repeated32(0x3f800001),
                        repeated32(0x3f800002)), repeated32(0xa8800000));
   psizam::v128_t onePlus{0x3ff0000000000001ull, 0x3ff0000000000001ull};
   vectorEquals(m.call("relaxed_f64_madd", onePlus, onePlus,
                        psizam::v128_t{0xbff0000000000002ull, 0xbff0000000000002ull}),
                {0x3970000000000000ull, 0x3970000000000000ull});
   vectorEquals(m.call("relaxed_f64_nmadd", onePlus, onePlus,
                        psizam::v128_t{0x3ff0000000000002ull, 0x3ff0000000000002ull}),
                {0xb970000000000000ull, 0xb970000000000000ull});
}
