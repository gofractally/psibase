// What psibase derives from the data members of a reflected record: the
// flattened key type of a table index, a key read through a view of a packed
// row, the "does it have a member named block" check and the GraphQL names
// of connections and edges. All of it reads psio::reflect<T>.
#include <psibase/psibase.hpp>

#include <catch2/catch_all.hpp>
#include <psio/to_hex.hpp>

#include <string>
#include <string_view>
#include <tuple>
#include <vector>

namespace tables_test
{
   struct Inner
   {
      std::uint32_t a = 0;
      std::string   b;
      PSIO_REFLECT(Inner, a, b)
   };
   struct Row
   {
      std::uint32_t          id = 0;
      psibase::AccountNumber owner;
      Inner                  inner;
      std::string            note;
      std::uint32_t          other = 0;
      PSIO_REFLECT(Row, id, owner, inner, note, other)
   };
   struct Blocked
   {
      std::uint32_t block = 0;
      PSIO_REFLECT(Blocked, block)
   };
   struct Empty
   {
      PSIO_REFLECT(Empty)
   };
}  // namespace tables_test

using namespace tables_test;

// A reflected record in a key is its members, flattened.
static_assert(std::is_same_v<psibase::flatten_key_t<Inner>, std::tuple<std::uint32_t, std::string>>);
static_assert(std::is_same_v<psibase::flatten_key_t<const Inner&>,
                             std::tuple<std::uint32_t, std::string>>);
static_assert(std::is_same_v<psibase::flatten_key_t<psibase::AccountNumber>,
                             std::tuple<std::uint64_t>>);
static_assert(std::is_same_v<psibase::flatten_key_t<std::tuple<psibase::AccountNumber&, Inner>>,
                             std::tuple<std::uint64_t, std::uint32_t, std::string>>);
static_assert(std::is_same_v<psibase::flatten_key_t<Empty>, std::tuple<>>);
static_assert(std::is_same_v<psibase::flatten_key_t<std::uint16_t>, std::tuple<std::uint16_t>>);

static_assert(psibase::detail::has_block_member<Blocked>());
static_assert(!psibase::detail::has_block_member<Row>());
static_assert(!psibase::detail::has_block_member<Empty>());

TEST_CASE("tables: a key is read through a view of the packed row", "[tables]")
{
   const Row  row{7, psibase::AccountNumber{"alice"}, {3, "x"}, "n", 9};
   const auto bytes = psio1::convert_to_frac(row);
   const psio1::view<const Row> view{psio1::prevalidated{bytes}};

   CHECK(psibase::detail::invoke(&Row::id, view).unpack() == 7);
   // `other` has the type of `id`: the member is found by its pointer.
   CHECK(psibase::detail::invoke(&Row::other, view).unpack() == 9);
   CHECK(psibase::detail::invoke(&Row::owner, view).unpack() == psibase::AccountNumber{"alice"});
   CHECK(std::string_view{psibase::detail::invoke(&Row::note, view)} == "n");
   CHECK(psibase::detail::invoke(&Row::inner, view).a().unpack() == 3);
   // and from the row itself
   CHECK(psibase::detail::invoke(&Row::other, row) == 9);
}

// The keys Table.hpp writes: tablePrefix(service, table), the index number,
// then the psio::key encoding of the index's key.
TEST_CASE("tables: the bytes of a primary and of a composite secondary key", "[tables]")
{
   using Secondary = psibase::CompositeKey<&Row::owner, &Row::note>;
   const psibase::AccountNumber service{0x0102030405060708ull};
   const psibase::AccountNumber owner{0x1112131415161718ull};
   const Row                    row{7, owner, {3, "x"}, std::string("n\0m", 3), 9};

   auto hex = [](const std::vector<char>& v) { return psio::to_hex(std::span<const char>{v}); };
   auto key = [&](std::uint8_t index, const auto& k)
   {
      auto result = psibase::tablePrefix(service, 2);
      result.push_back(static_cast<char>(index));
      psibase::detail::appendKey(k, result);
      return result;
   };

   // service, big-endian; table number, big-endian
   CHECK(hex(psibase::tablePrefix(service, 2)) == "01020304050607080002");

   const auto primary = key(0, psibase::detail::invoke(&Row::id, row));
   CHECK(hex(primary) ==
         "01020304050607080002"
         "00"
         "00000007");

   // owner, big-endian; note, with 00 escaped as 00 01 and terminated by 00 00
   const auto secondary = key(1, psibase::detail::invoke(Secondary{}, row));
   CHECK(hex(secondary) ==
         "01020304050607080002"
         "01"
         "1112131415161718"
         "6E00016D0000");

   // A key read through a view of the packed row is the same key.
   const auto                   bytes = psio1::convert_to_frac(row);
   const psio1::view<const Row> view{psio1::prevalidated{bytes}};
   CHECK(key(0, psibase::detail::invoke(&Row::id, view)) == primary);
   CHECK(key(1, psibase::detail::invoke(Secondary{}, view)) == secondary);

   // The key of the first component is a prefix of the full key, ...
   using SecondaryKey = std::tuple<psibase::AccountNumber, std::string>;
   const auto prefix  = key(1, psibase::KeyView{psio::key_prefix<SecondaryKey>(owner)});
   CHECK(hex(prefix) ==
         "01020304050607080002"
         "01"
         "1112131415161718");
   REQUIRE(prefix.size() < secondary.size());
   CHECK(std::equal(prefix.begin(), prefix.end(), secondary.begin()));
   // ... which is what lower_bound(owner) and subindex(owner) search with,
   CHECK(key(1, owner) == prefix);
   // and every key with that prefix is below its upper bound.
   const auto bound = psio::key_prefix_upper_bound(prefix);
   REQUIRE(bound.has_value());
   CHECK(hex(*bound) ==
         "01020304050607080002"
         "01"
         "1112131415161719");
   CHECK(psibase::compare_wknd(secondary, *bound) == std::weak_ordering::less);
}

TEST_CASE("tables: GraphQL connection and edge names", "[tables]")
{
   using Conn = psibase::Connection<Row, psio::reflect<Row>::fixed_name + "Connection",
                                    psio::reflect<Row>::fixed_name + "Edge">;
   CHECK(std::string_view{get_type_name((const Conn*)nullptr)} == "RowConnection");
   CHECK(std::string_view{get_type_name((const Conn::Edge*)nullptr)} == "RowEdge");
   CHECK(std::string_view{get_type_name((const psibase::WithBlockContext<Row>*)nullptr)} ==
         "RowWithBlockContext");
}
