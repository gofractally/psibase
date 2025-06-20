#include <services/user/Packages.hpp>

#include <psibase/Service.hpp>
#include <psibase/schema.hpp>

#include <catch2/catch_all.hpp>
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

TEST_CASE("test table compatibility")
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
      CHECK(
          alice.to<Packages>().setSchema(ServiceSchema::make<ServiceV3>()).failed("Incompatible"));
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
                .failed("Cannot change indexes"));
   }
}

namespace
{
   // A transformed
   struct TableRowXForm
   {
      TableKey k;
      auto     inner() const { return k.value; }
      auto     outer() const { return k; }
      auto     rev() const { return ~k.value; }
   };
   PSIO_REFLECT(TableRowXForm, k)
   PSIBASE_REFLECT_KEY_TRANSFORM(&TableRowXForm::inner, "inner")
   PSIBASE_REFLECT_KEY_TRANSFORM(&TableRowXForm::outer, "outer")
   PSIBASE_REFLECT_KEY_TRANSFORM(&TableRowXForm::rev, "rev")
   struct TableRowXFormExtended
   {
      TableKeyExtended k;
      auto             inner() const { return k.value; }
      auto             outer() const { return k; }
   };
   PSIO_REFLECT(TableRowXFormExtended, k)
   PSIBASE_REFLECT_KEY_TRANSFORM(&TableRowXFormExtended::inner, "inner")
   PSIBASE_REFLECT_KEY_TRANSFORM(&TableRowXFormExtended::outer, "outer")

   using TableXFormIV1 = Table<TableRowXForm, &TableRowXForm::inner>;
   PSIO_REFLECT_TYPENAME(TableXFormIV1)
   struct ServiceXFormIV1
   {
      static constexpr AccountNumber service{"alice"};
      using Tables = psibase::ServiceTables<TableXFormIV1>;
   };
   PSIO_REFLECT(ServiceXFormIV1)
   PSIBASE_REFLECT_TABLES(ServiceXFormIV1, ServiceXFormIV1::Tables)

   // Upgrade without affecting the key
   using TableXFormIV2 = Table<TableRowXFormExtended, &TableRowXFormExtended::inner>;
   PSIO_REFLECT_TYPENAME(TableXFormIV2)
   struct ServiceXFormIV2
   {
      static constexpr AccountNumber service{"alice"};
      using Tables = psibase::ServiceTables<TableXFormIV2>;
   };
   PSIO_REFLECT(ServiceXFormIV2)
   PSIBASE_REFLECT_TABLES(ServiceXFormIV2, ServiceXFormIV2::Tables)

   // Change transform
   using TableXFormIV3 = Table<TableRowXForm, &TableRowXForm::rev>;
   PSIO_REFLECT_TYPENAME(TableXFormIV3)
   struct ServiceXFormIV3
   {
      static constexpr AccountNumber service{"alice"};
      using Tables = psibase::ServiceTables<TableXFormIV3>;
   };
   PSIO_REFLECT(ServiceXFormIV3)
   PSIBASE_REFLECT_TABLES(ServiceXFormIV3, ServiceXFormIV3::Tables)

   // Upgrade that changes the key
   using TableXFormOV1 = Table<TableRowXForm, &TableRowXForm::outer>;
   PSIO_REFLECT_TYPENAME(TableXFormOV1)
   struct ServiceXFormOV1
   {
      static constexpr AccountNumber service{"alice"};
      using Tables = psibase::ServiceTables<TableXFormOV1>;
   };
   PSIO_REFLECT(ServiceXFormOV1)
   PSIBASE_REFLECT_TABLES(ServiceXFormOV1, ServiceXFormOV1::Tables)
   using TableXFormOV2 = Table<TableRowXFormExtended, &TableRowXFormExtended::outer>;
   PSIO_REFLECT_TYPENAME(TableXFormOV2)
   struct ServiceXFormOV2
   {
      static constexpr AccountNumber service{"alice"};
      using Tables = psibase::ServiceTables<TableXFormOV2>;
   };
   PSIO_REFLECT(ServiceXFormOV2)
   PSIBASE_REFLECT_TABLES(ServiceXFormOV2, ServiceXFormOV2::Tables)
}  // namespace

TEST_CASE("test key transform compatibility")
{
   DefaultTestChain t;
   auto             alice = t.from(t.addAccount("alice"_a));

   SECTION("key base upgrade")
   {
      REQUIRE(alice.to<Packages>().setSchema(ServiceSchema::make<ServiceXFormIV1>()).succeeded());
      CHECK(alice.to<Packages>().setSchema(ServiceSchema::make<ServiceXFormIV2>()).succeeded());
   }
   SECTION("change transform")
   {
      REQUIRE(alice.to<Packages>().setSchema(ServiceSchema::make<ServiceXFormIV1>()).succeeded());
      CHECK(alice.to<Packages>()
                .setSchema(ServiceSchema::make<ServiceXFormIV3>())
                .failed("Cannot change indexes"));
   }
   SECTION("actual key upgrade")
   {
      REQUIRE(alice.to<Packages>().setSchema(ServiceSchema::make<ServiceXFormOV1>()).succeeded());
      CHECK(alice.to<Packages>()
                .setSchema(ServiceSchema::make<ServiceXFormOV2>())
                .failed("Cannot change indexes"));
   }
}

namespace
{
   struct EventsV1 : Service
   {
      static constexpr AccountNumber service{"alice"};
      struct Events
      {
         struct History
         {
            void e1() {}
         };
      };
   };
   PSIO_REFLECT(EventsV1)
   PSIBASE_REFLECT_HISTORY_EVENTS(EventsV1, method(e1))
   PSIBASE_REFLECT_TABLES(EventsV1)

   // Valid upgrade
   struct EventsV2 : Service
   {
      static constexpr AccountNumber service{"alice"};
      struct Events
      {
         struct History
         {
            void e1(std::optional<std::uint32_t> o) {}
            void e2(std::uint32_t i) {}
         };
      };
   };
   PSIO_REFLECT(EventsV2)
   PSIBASE_REFLECT_HISTORY_EVENTS(EventsV2, method(e1, o), method(e2, i))
   PSIBASE_REFLECT_TABLES(EventsV2)

   // Invalid upgrade
   struct EventsV3 : Service
   {
      static constexpr AccountNumber service{"alice"};
      struct Events
      {
         struct History
         {
            void e1(std::uint32_t i) {}
         };
      };
   };
   PSIO_REFLECT(EventsV3)
   PSIBASE_REFLECT_HISTORY_EVENTS(EventsV3, method(e1, i))
   PSIBASE_REFLECT_TABLES(EventsV3)

   // Remove event
   struct EventsV4 : Service
   {
      static constexpr AccountNumber service{"alice"};
   };
   PSIO_REFLECT(EventsV4)
   PSIBASE_REFLECT_TABLES(EventsV4)

}  // namespace

TEST_CASE("test event compatibility")
{
   DefaultTestChain t;
   auto             alice = t.from(t.addAccount("alice"_a));

   REQUIRE(alice.to<Packages>().setSchema(ServiceSchema::make<EventsV1>()).succeeded());

   SECTION("Valid upgrade")
   {
      CHECK(alice.to<Packages>().setSchema(ServiceSchema::make<EventsV2>()).succeeded());
   }
   SECTION("Invalid upgrade")
   {
      CHECK(alice.to<Packages>().setSchema(ServiceSchema::make<EventsV3>()).failed("Incompatible"));
   }
   SECTION("Remove event")
   {
      CHECK(alice.to<Packages>()
                .setSchema(ServiceSchema::make<EventsV4>())
                .failed("Cannot remove event"));
   }
}
