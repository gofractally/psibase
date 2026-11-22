// What psibase derives from the data members of a reflected record: the
// flattened key type of a table index, a key read through a view of a packed
// row, the "does it have a member named block" check and the GraphQL names
// of connections and edges. All of it reads psio::reflect<T>.
#include <psibase/psibase.hpp>

#include <catch2/catch_all.hpp>

#include <string>
#include <string_view>
#include <tuple>

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

TEST_CASE("tables: GraphQL connection and edge names", "[tables]")
{
   using Conn = psibase::Connection<Row, psio1::reflected_name<Row> + "Connection",
                                    psio1::reflected_name<Row> + "Edge">;
   CHECK(std::string_view{get_type_name((const Conn*)nullptr)} == "RowConnection");
   CHECK(std::string_view{get_type_name((const Conn::Edge*)nullptr)} == "RowEdge");
   CHECK(std::string_view{get_type_name((const psibase::WithBlockContext<Row>*)nullptr)} ==
         "RowWithBlockContext");
}
