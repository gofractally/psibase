// Included after Matrix in VmConsensusTests.cpp. These are verification-only
// input/state cases, never a throughput or compute benchmark.
TEST_CASE("VM dynamic table references preserve types host imports and null traps")
{
   Matrix m(PSIBASE_VM_CONSENSUS_DYNAMIC_TABLE_WASM);
   auto expectInteger = [&](uint32_t index)
   {
      CHECK(m.call("call_integer", 42u, index).result.low == (42u ^ 0x13579bdfu));
   };
   CHECK(m.call("size").result.low == 1);
   expectInteger(0);
   CHECK(m.call("grow_identity", 1u).result.low == 1);
   expectInteger(1);
   CHECK(m.call("grow_record", 1u).result.low == 2);
   auto out = m.call("call_record", 2u, 7u, uint64_t{0xfedcba9876543210ull});
   REQUIRE(out.effects.size() == 1);
   CHECK(out.effects.back() == std::pair<uint32_t, uint64_t>{7, 0xfedcba9876543210ull});
   CHECK(m.call("grow_null", 1u).result.low == 0xffffffffu);
   CHECK(m.call("size").result.low == 3);
   m.call("set_record", 0u);
   out = m.call("call_record", 0u, 8u, uint64_t{0x1122334455667788ull});
   CHECK(out.effects.back() == std::pair<uint32_t, uint64_t>{8, 0x1122334455667788ull});
   m.call("fill_record", 1u, 2u);
   m.call("call_record", 1u, 9u, uint64_t{0x8000000000000001ull});
   out = m.call("call_record", 2u, 10u, uint64_t{0x7fffffffffffffffull});
   REQUIRE(out.effects.size() == 4);
   CHECK(out.effects[2] == std::pair<uint32_t, uint64_t>{9, 0x8000000000000001ull});
   CHECK(out.effects[3] == std::pair<uint32_t, uint64_t>{10, 0x7fffffffffffffffull});

   m.call("set_wide", 0u);
   CHECK(m.call("call_wide", uint64_t{0x1122334455667788ull}, 0u).result.low == 0x1122334455667789ull);
   m.trap("call_integer", "indirect", 42u, 0u); // valid nonnull reference, wrong signature
   m.call("fill_wide", 1u, 2u);
   CHECK(m.call("call_wide", uint64_t{0xffffffffffffffffull}, 2u).result.low == 0);
   m.trap("call_integer", "indirect", 42u, 2u);
   m.call("set_null", 0u);
   m.trap("call_wide", "indirect", uint64_t{1}, 0u);
   m.call("fill_null", 1u, 2u);
   m.trap("call_record", "indirect", 1u, 11u, uint64_t{12});
   m.trap("call_integer", "indirect", 42u, 2u);
   m.trap("call_integer", "indirect", 42u, 3u); // out of bounds
   m.call("fill_identity", 0u, 3u);
   expectInteger(0);
   expectInteger(1);
   expectInteger(2);
   m.call("set_fail", 0u);
   m.trap("call_fail", "host", 0u); // imported host exception unwinds cleanly
   m.call("set_identity", 0u);
   expectInteger(0);
}

namespace
{
   template <class Profile>
   void secondaryTableRejected(const psizam::wasm_code& code)
   {
      const psibase::NativeVMOptions options(psibase::VMOptions{1024, 2, 3, 65536});
      CHECK_THROWS_WITH(Runtime<Profile>(code, options), Catch::Matchers::ContainsSubstring("one table"));
   }
}

TEST_CASE("VM valid secondary table control obeys current node policy")
{
   auto code = psizam::read_wasm(PSIBASE_VM_CONSENSUS_SECONDARY_TABLE_WASM);
   using Validator = psizam::backend<std::nullptr_t, psizam::null_backend>;
   REQUIRE_NOTHROW(Validator(code, nullptr));
   secondaryTableRejected<psizam::jit_profile>(code);
   secondaryTableRejected<Jit2Profile>(code);
   secondaryTableRejected<psizam::aot_profile>(code);
   secondaryTableRejected<vm_consensus::SavedFileProfile>(code);
}
