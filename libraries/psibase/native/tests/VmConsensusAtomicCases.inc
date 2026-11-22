// Included after Matrix in VmConsensusTests.cpp, once private atomics are
// enabled in the actual node policy. Verification only, never performance.
TEST_CASE("VM private atomics preserve full-width values bounds and trap state")
{
   REQUIRE(psibase::NativeVMOptions::enable_atomics);
   Matrix m(PSIBASE_VM_CONSENSUS_PRIVATE_ATOMICS_WASM);
   constexpr uint64_t sentinel = 0x5a5a5a5a5a5a5a5aull;
   for (unsigned width : {1u, 2u, 4u, 8u})
   {
      INFO("atomic access width=" << width);
      auto suffix = "-" + std::to_string(width);
      const uint64_t mask = ~uint64_t{0} >> ((8 - width) * 8);
      auto reset = [&](uint64_t value)
      {
         m.call("store-8", 16u, sentinel);
         m.call("store-8", 24u, sentinel);
         m.call("store-8", 32u, sentinel);
         m.call("store" + suffix, 24u, value);
      };
      for (auto op : {"add", "sub", "and", "or", "xor", "xchg"})
      {
         INFO("atomic operation=" << op);
         reset(mask);
         auto out = m.call(std::string(op) + suffix, 24u, uint64_t{3});
         CHECK(out.result.low == mask);
         uint64_t expected = 0;
         if (std::string_view(op) == "add") expected = mask + 3;
         if (std::string_view(op) == "sub") expected = mask - 3;
         if (std::string_view(op) == "and") expected = mask & 3;
         if (std::string_view(op) == "or") expected = mask | 3;
         if (std::string_view(op) == "xor") expected = mask ^ 3;
         if (std::string_view(op) == "xchg") expected = 3;
         CHECK(m.call("load" + suffix, 24u).result.low == (expected & mask));
         CHECK(out.memory.at(23) == 0x5a);
         CHECK(out.memory.at(24 + width) == 0x5a);
      }
      reset(mask);
      CHECK(m.call("cmpxchg" + suffix, 24u, mask - 1, uint64_t{7}).result.low == mask);
      CHECK(m.call("load" + suffix, 24u).result.low == mask);
      constexpr uint64_t replacement = 0x1122334455667788ull;
      CHECK(m.call("cmpxchg" + suffix, 24u, mask, replacement).result.low == mask);
      CHECK(m.call("load" + suffix, 24u).result.low == (replacement & mask));
      if (width < 8)
      {
         reset(mask);
         // Narrow cmpxchg compares the low access-width bits of a full i64
         // argument, then truncates the replacement to that access width.
         auto expected = mask | (uint64_t{1} << (width * 8));
         CHECK(m.call("cmpxchg" + suffix, 24u, expected, replacement).result.low == mask);
         CHECK(m.call("load" + suffix, 24u).result.low == (replacement & mask));
      }
      auto before = m.call("load" + suffix, 24u).memory;
      if (width > 1)
      {
         CHECK(m.trap("load" + suffix, "memory", 25u).memory == before);
         CHECK(m.trap("store" + suffix, "memory", 25u, uint64_t{1}).memory == before);
         CHECK(m.trap("add" + suffix, "memory", 25u, uint64_t{1}).memory == before);
      }
      CHECK(m.trap("load" + suffix, "memory", 65536u).memory == before);
      CHECK(m.trap("store" + suffix, "memory", 65536u, uint64_t{1}).memory == before);
      CHECK(m.trap("add" + suffix, "memory", 65536u, uint64_t{1}).memory == before);
   }
   CHECK(m.call("fence").result.low == 7);
   CHECK(m.call("notify", 0u, 9u).result.low == 0);
   m.trap("notify", "memory", 1u, 0u);
   m.trap("notify", "memory", 65536u, 0u);
   m.trap("wait", "private-wait", 0u, uint64_t{0}, uint64_t{0});
   m.trap("wait", "private-wait", 0u, uint64_t{1}, uint64_t{0});
   // The effective address is 0x100000000, not wrapped uint32 zero.
   m.trap("overflow", "memory");
   m.trap("unused-load", "memory", 65536u);
   m.trap("unused-load", "memory", 25u);
   CHECK(m.call("grow", 1u).result.low == 1);
   m.call("store-8", 65536u, uint64_t{42});
   CHECK(m.call("load-8", 65536u).result.low == 42);
   CHECK(m.call("grow", 1u).result.low == 0xffffffffu);
}
