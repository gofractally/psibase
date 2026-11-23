// What psibase derives from the data members of a reflected record: the
// flattened key type of a table index, a key read through a view of a packed
// row, the "does it have a member named block" check and the GraphQL names
// of connections and edges. All of it reads psio::reflect<T>.
#include <psibase/psibase.hpp>

#include <catch2/catch_all.hpp>
#include <psio/to_hex.hpp>

#include <algorithm>
#include <cstring>
#include <map>
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
   // Refers to its members; packs as a Row.
   struct RowRef
   {
      std::uint32_t          id;
      psibase::AccountNumber owner;
      psio::pssz_view<Inner> inner;
      std::string_view       note;
      std::uint32_t          other;
      PSIO_REFLECT(RowRef, id, owner, inner, note, other)
   };
   // Another record: the note is missing.
   struct RowWrong
   {
      std::uint32_t          id;
      psibase::AccountNumber owner;
      psio::pssz_view<Inner> inner;
      std::uint32_t          other;
      PSIO_REFLECT(RowWrong, id, owner, inner, other)
   };
   // The members of a Row with another integer size.
   struct RowWide
   {
      std::uint64_t          id;
      psibase::AccountNumber owner;
      psio::pssz_view<Inner> inner;
      std::string_view       note;
      std::uint32_t          other;
      PSIO_REFLECT(RowWide, id, owner, inner, note, other)
   };
   using RowTable = psibase::Table<Row, &Row::id>;
   template <typename U>
   concept CanPut = requires(RowTable& table, const U& value) { table.put(value); };
}  // namespace tables_test

using namespace tables_test;

// What Table<Row>::put accepts is decided when the call is compiled: the
// row, what packs as one (psio::packs_as), what converts to one.
static_assert(psio::packs_as<RowRef, Row>);
static_assert(!psio::packs_as<RowWrong, Row>);
static_assert(!psio::packs_as<RowWide, Row>);
static_assert(CanPut<Row>);
static_assert(CanPut<RowRef>);
static_assert(CanPut<psio::pssz_view<Row>>);
static_assert(CanPut<psio::shared_pssz<Row>>);
static_assert(CanPut<psio::pssz_buffer<Row>>);
static_assert(!CanPut<RowWrong>);
static_assert(!CanPut<RowWide>);
static_assert(!CanPut<Inner>);

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
   const auto bytes = psio::to_pssz(row);
   const psio::pssz_view<Row> view{bytes};

   CHECK(psibase::detail::invoke(&Row::id, view) == 7);
   // `other` has the type of `id`: the member is found by its pointer.
   CHECK(psibase::detail::invoke(&Row::other, view) == 9);
   CHECK(psibase::detail::invoke(&Row::owner, view) == psibase::AccountNumber{"alice"});
   CHECK(psibase::detail::invoke(&Row::note, view) == "n");
   CHECK(psibase::detail::invoke(&Row::inner, view).a == 3);
   // and from the row itself
   CHECK(psibase::detail::invoke(&Row::other, row) == 9);
}

#ifndef COMPILING_WASM
// A key-value store in place of the host, for the native test. A handle is
// a key prefix; handle 0 is the whole store.
namespace
{
   std::map<std::vector<char>, std::vector<char>> store;
   std::vector<std::vector<char>>                 handles{{}};
   std::vector<char>                              lastResult;
   std::vector<char> storeKey(psibase::KvHandle db, const char* key, std::uint32_t len)
   {
      auto result = handles.at(static_cast<std::uint32_t>(db));
      result.insert(result.end(), key, key + len);
      return result;
   }
}  // namespace
namespace psibase::raw
{
   KvHandle kvOpenAt(KvHandle db, const char* prefix, uint32_t len, KvMode)
   {
      handles.push_back(storeKey(db, prefix, len));
      return static_cast<KvHandle>(handles.size() - 1);
   }
   void     kvClose(KvHandle) {}
   uint32_t getResult(const char* dest, uint32_t destSize, uint32_t offset)
   {
      if (offset < lastResult.size())
         std::memcpy(const_cast<char*>(dest), lastResult.data() + offset,
                     std::min<std::size_t>(destSize, lastResult.size() - offset));
      return lastResult.size();
   }
   uint32_t kvGet(KvHandle db, const char* key, uint32_t keyLen)
   {
      auto pos = store.find(storeKey(db, key, keyLen));
      if (pos == store.end())
         return -1;
      lastResult = pos->second;
      return lastResult.size();
   }
   void kvPut(KvHandle db, const char* key, uint32_t keyLen, const char* value, uint32_t valueLen)
   {
      store[storeKey(db, key, keyLen)].assign(value, value + valueLen);
   }
   void kvRemove(KvHandle db, const char* key, uint32_t keyLen)
   {
      store.erase(storeKey(db, key, keyLen));
   }
}  // namespace psibase::raw

TEST_CASE("tables: a row is stored packed and read back, by value and by view", "[tables]")
{
   using Secondary = psibase::CompositeKey<&Row::owner, &Row::note>;
   using RowTable  = psibase::Table<Row, &Row::id, Secondary{}>;
   const psibase::AccountNumber service{0x0102030405060708ull};
   store.clear();
   RowTable table{psibase::KvHandle{0}, psibase::tablePrefix(service, 2),
                  psibase::KvMode::readWrite};

   const Row  row{7, psibase::AccountNumber{"alice"}, {3, "x"}, "n", 9};
   const auto packed = psio::to_pssz(row);
   table.put(row);

   // What is stored: the PSSZ of the row under the primary key, and the
   // primary key under the secondary key.
   auto primary = psibase::tablePrefix(service, 2);
   primary.push_back(0);
   psio::to_key(std::uint32_t{7}, primary);
   auto secondary = psibase::tablePrefix(service, 2);
   secondary.push_back(1);
   psio::to_key(std::tuple{psibase::AccountNumber{"alice"}, std::string{"n"}}, secondary);
   REQUIRE(store.size() == 2);
   CHECK(store.at(primary) == packed);
   // (the handle supplies the table prefix)
   CHECK(store.at(secondary) == std::vector<char>{0, 0, 0, 0, 7});

   // By value and by view, through either index
   auto value = table.get(std::uint32_t{7});
   REQUIRE(value.has_value());
   CHECK(value->note == "n");
   CHECK(value->inner.b == "x");
   auto view = table.getView(std::uint32_t{7});
   REQUIRE(view.has_value());
   CHECK(std::ranges::equal(view->bytes(), packed));
   CHECK((*view)->owner() == psibase::AccountNumber{"alice"});
   CHECK((*view)->inner().b() == "x");
   CHECK((*view)->other() == 9);
   CHECK(!table.getView(std::uint32_t{8}).has_value());
   auto bySecondary =
       table.getIndex<1>().getView(std::tuple{psibase::AccountNumber{"alice"}, std::string{"n"}});
   REQUIRE(bySecondary.has_value());
   CHECK(*bySecondary == *view);

   // A packed row is stored as it is; its keys are read through its view.
   Row other{8, psibase::AccountNumber{"bob"}, {4, "y"}, "m", 1};
   table.put(psio::shared_pssz<Row>{other});
   CHECK(store.size() == 4);
   CHECK(table.get(std::uint32_t{8})->owner == psibase::AccountNumber{"bob"});
   CHECK(table.getIndex<1>().get(std::tuple{psibase::AccountNumber{"bob"}, std::string{"m"}})->id ==
         8);

   // Replacing a row through a view moves its secondary key.
   other.note        = "moved";
   const auto bytes2 = psio::to_pssz(other);
   table.put(psio::pssz_view<Row>{bytes2});
   CHECK(store.size() == 4);
   CHECK(!table.getIndex<1>().get(std::tuple{psibase::AccountNumber{"bob"}, std::string{"m"}}));
   CHECK(table.getIndex<1>()
             .get(std::tuple{psibase::AccountNumber{"bob"}, std::string{"moved"}})
             ->id == 8);

   // A record that refers to its members packs as the row.
   const auto innerBytes = psio::to_pssz(Inner{5, "z"});
   table.put(RowRef{9, psibase::AccountNumber{"carol"}, psio::pssz_view<Inner>{innerBytes}, "ref", 2});
   CHECK(table.get(std::uint32_t{9})->inner.b == "z");
   CHECK(table.get(std::uint32_t{9})->note == "ref");

   // Removing through a view of the stored row erases every key.
   table.remove(**view);
   CHECK(!table.get(std::uint32_t{7}));
   CHECK(store.size() == 4);
   table.erase(std::uint32_t{8});
   table.erase(std::uint32_t{9});
   CHECK(store.empty());
}
#endif

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
   const auto                   bytes = psio::to_pssz(row);
   const psio::pssz_view<Row> view{bytes};
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
