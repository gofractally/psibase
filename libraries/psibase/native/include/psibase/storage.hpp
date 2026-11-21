#pragma once

// Native storage boundary. Payloads remain opaque legacy bytes in this stage.
// Engine types, allocator pointers and sessions never escape this interface.
#include <cstdint>
#include <filesystem>
#include <memory>
#include <optional>
#include <span>
#include <vector>

namespace psibase::storage
{
   struct root;
   using shared_root = std::shared_ptr<const root>;
   struct database_config
   {
      // Validated legacy tester ABI sizing hints. They do not reserve memory,
      // configure independent psitri tiers, or control an aggregate cache budget.
      std::uint64_t hot_bytes;
      std::uint64_t warm_bytes;
      std::uint64_t cool_bytes;
      std::uint64_t cold_bytes;
   };
   enum class open_mode
   {
      create,
      create_new,
      read_write,
      read_only,
      temporary,
      trunc,
      resize
   };
   struct database_view;
   class database;

   class read_session
   {
     protected:
      std::shared_ptr<database_view> view;
      explicit read_session(std::shared_ptr<database_view> v);
      friend class database;

     public:
      virtual ~read_session();
      bool                             get(const shared_root&,
                                           std::span<const char>,
                                           std::vector<char>*        value,
                                           std::vector<shared_root>* roots = nullptr);
      std::optional<std::vector<char>> get(const shared_root&, std::span<const char>);
      bool                             get_greater_equal(const shared_root&,
                                                         std::span<const char>,
                                                         std::vector<char>*,
                                                         std::vector<char>*,
                                                         std::vector<shared_root>* = nullptr);
      bool                             get_less_than(const shared_root&,
                                                     std::span<const char>,
                                                     std::vector<char>*,
                                                     std::vector<char>*,
                                                     std::vector<shared_root>* = nullptr);
      bool                             get_max(const shared_root&,
                                               std::span<const char>,
                                               std::vector<char>*,
                                               std::vector<char>*,
                                               std::vector<shared_root>* = nullptr);
      bool is_empty(const shared_root&, std::span<const char> lower, std::span<const char> upper);
      bool is_equal_weak(const shared_root&,
                         const shared_root&,
                         std::span<const char> lower,
                         std::span<const char> upper);
   };

   class write_session : public read_session
   {
      explicit write_session(std::shared_ptr<database_view> v);
      friend class database;

     public:
      shared_root get_top_root();
      void        set_top_root(shared_root);
      void        upsert(shared_root&, std::span<const char>, std::span<const char>);
      void        upsert(shared_root&, std::span<const char>, std::span<const shared_root>);
      void        remove(shared_root&, std::span<const char>);
      void        splice(shared_root&,
                         const shared_root&,
                         std::span<const char> lower,
                         std::span<const char> upper);
   };

   class database
   {
      std::shared_ptr<database_view> view;
      explicit database(std::shared_ptr<database_view>);

     public:
      database(const std::filesystem::path&, const database_config&, open_mode);
      std::shared_ptr<database>      clone() const;
      std::shared_ptr<write_session> start_write_session();
      std::shared_ptr<read_session>  start_read_session();
      std::optional<bool>   is_slow() const;  // unknown: generic API has no pressure signal
      std::filesystem::path directory() const;
      bool                  read_only() const;
      bool                  owns(const write_session&) const;
   };
}  // namespace psibase::storage
