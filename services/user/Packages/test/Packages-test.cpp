#include <services/user/Packages.hpp>

#include <psibase/Service.hpp>
#include <psibase/schema.hpp>

#define CATCH_CONFIG_MAIN
#include <catch2/catch.hpp>
#include <psibase/DefaultTestChain.hpp>

using namespace psibase;
using namespace UserService;

namespace
{
   struct TableKey
   {
      std::uint32_t value;
   };
   PSIO_REFLECT(TableKey, value)

   struct TableKeyExtended
   {
      std::uint32_t                value;
      std::optional<std::uint32_t> o;
   };
   PSIO_REFLECT(TableKeyExtended, value, o)

   struct TableRowV1
   {
      TableKey k1;
      TableKey k2;
      TableKey k3;
   };
   PSIO_REFLECT(TableRowV1, k1, k2, k3);
   using TableV1 = Table<TableRowV1, &TableRowV1::k1, &TableRowV1::k2>;
   PSIO_REFLECT_TYPENAME(TableV1)

   struct ServiceV1 : Service
   {
      static constexpr AccountNumber service{"alice"};
      using Tables = psibase::ServiceTables<TableV1>;
   };
   PSIO_REFLECT(ServiceV1)
   PSIBASE_REFLECT_TABLES(ServiceV1, ServiceV1::Tables)

   // Valid extension
   struct TableRowV2
   {
      TableKey                     k1;
      TableKey                     k2;
      TableKeyExtended             k3;
      std::optional<std::uint32_t> o;
   };
   PSIO_REFLECT(TableRowV2, k1, k2, k3, o);
   using TableV2 = Table<TableRowV2, &TableRowV2::k1, &TableRowV2::k2>;
   PSIO_REFLECT_TYPENAME(TableV2)

   struct ServiceV2 : Service
   {
      static constexpr AccountNumber service{"alice"};
      using Tables = psibase::ServiceTables<TableV2, TableV1>;
   };
   PSIO_REFLECT(ServiceV2)
   PSIBASE_REFLECT_TABLES(ServiceV2, ServiceV2::Tables)

   // Add non-optional field
   struct TableRowV3
   {
      TableKey      k1;
      TableKey      k2;
      TableKey      k3;
      std::uint32_t o;
   };
   PSIO_REFLECT(TableRowV3, k1, k2, k3, o);
   using TableV3 = Table<TableRowV3, &TableRowV3::k1, &TableRowV3::k2>;
   PSIO_REFLECT_TYPENAME(TableV3)

   struct ServiceV3 : Service
   {
      static constexpr AccountNumber service{"alice"};
      using Tables = psibase::ServiceTables<TableV3>;
   };
   PSIO_REFLECT(ServiceV3)
   PSIBASE_REFLECT_TABLES(ServiceV3, ServiceV3::Tables)

   // Add index
   using TableRowV4 = TableRowV1;
   using TableV4    = Table<TableRowV4, &TableRowV4::k1, &TableRowV4::k2, &TableRowV4::k3>;
   PSIO_REFLECT_TYPENAME(TableV4)

   struct ServiceV4 : Service
   {
      static constexpr AccountNumber service{"alice"};
      using Tables = psibase::ServiceTables<TableV4>;
   };
   PSIO_REFLECT(ServiceV4)
   PSIBASE_REFLECT_TABLES(ServiceV4, ServiceV4::Tables)

   // Remove index
   using TableRowV5 = TableRowV1;
   using TableV5    = Table<TableRowV5, &TableRowV5::k1>;
   PSIO_REFLECT_TYPENAME(TableV5)

   struct ServiceV5 : Service
   {
      static constexpr AccountNumber service{"alice"};
      using Tables = psibase::ServiceTables<TableV5>;
   };
   PSIO_REFLECT(ServiceV5)
   PSIBASE_REFLECT_TABLES(ServiceV5, ServiceV5::Tables)

   // Change index
   using TableRowV6 = TableRowV1;
   using TableV6    = Table<TableRowV6, &TableRowV6::k1, &TableRowV6::k3>;
   PSIO_REFLECT_TYPENAME(TableV6)

   struct ServiceV6 : Service
   {
      static constexpr AccountNumber service{"alice"};
      using Tables = psibase::ServiceTables<TableV6>;
   };
   PSIO_REFLECT(ServiceV6)
   PSIBASE_REFLECT_TABLES(ServiceV6, ServiceV6::Tables)

   // Change key type
   struct TableRowV7
   {
      TableKey         k1;
      TableKeyExtended k2;
      TableKey         k3;
   };
   PSIO_REFLECT(TableRowV7, k1, k2, k3);
   using TableV7 = Table<TableRowV7, &TableRowV7::k1, &TableRowV7::k2>;
   PSIO_REFLECT_TYPENAME(TableV7)

   struct ServiceV7 : Service
   {
      static constexpr AccountNumber service{"alice"};
      using Tables = psibase::ServiceTables<TableV7>;
   };
   PSIO_REFLECT(ServiceV7)
   PSIBASE_REFLECT_TABLES(ServiceV7, ServiceV7::Tables)
}  // namespace

TEST_CASE("test schema compatibility")
{
   DefaultTestChain t;
   auto             alice = t.from(t.addAccount("alice"_a));

   REQUIRE(alice.to<Packages>().setSchema(ServiceSchema::make<ServiceV1>()).succeeded());

   SECTION("valid upgrade")
   {
      CHECK(alice.to<Packages>().setSchema(ServiceSchema::make<ServiceV2>()).succeeded());
   }
   SECTION("Invalid row upgrade")
   {
      CHECK(alice.to<Packages>()
                .setSchema(ServiceSchema::make<ServiceV3>())
                .failed("Incompatible tables"));
   }
   SECTION("Add index")
   {
      CHECK(alice.to<Packages>()
                .setSchema(ServiceSchema::make<ServiceV4>())
                .failed("Cannot change indexes"));
   }
   SECTION("Remove index")
   {
      CHECK(alice.to<Packages>()
                .setSchema(ServiceSchema::make<ServiceV5>())
                .failed("Cannot change indexes"));
   }
   SECTION("Change index")
   {
      CHECK(alice.to<Packages>()
                .setSchema(ServiceSchema::make<ServiceV6>())
                .failed("Cannot change indexes"));
   }
   SECTION("Change key type")
   {
      CHECK(alice.to<Packages>()
                .setSchema(ServiceSchema::make<ServiceV7>())
                .failed("Incompatible table indexes"));
   }
}
