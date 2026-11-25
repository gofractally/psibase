#pragma once

// Native storage boundary. Payloads remain opaque legacy bytes in this stage.
// Engine types, allocator pointers and sessions never escape this interface.
#include <cstdint>
#include <filesystem>
#include <memory>
#include <optional>
#include <span>
#include <utility>
#include <vector>

namespace psibase::storage
{
   struct root;
   using shared_root = std::shared_ptr<const root>;
   // What a publication of the top root waits for. Durability is opt-in: the
   // default survives a process crash (the engine recovers on the next open) but
   // not a power loss or kernel crash, and never waits on the disk.
   enum class durability
   {
      none,   // never flush
      flush,  // fsync each top-root publication
      full    // also flush the drive cache (F_FULLFSYNC where it differs)
   };
   struct database_config
   {
      // Validated legacy tester ABI sizing hints. They do not reserve memory,
      // configure independent psitri tiers, or control an aggregate cache budget.
      std::uint64_t hot_bytes;
      std::uint64_t warm_bytes;
      std::uint64_t cool_bytes;
      std::uint64_t cold_bytes;
      durability    sync = durability::none;
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

   // Changes to one tree, kept aside in key order until they are applied.
   // Reading a tree "through" a delta shows the tree with the changes made.
   // Nothing here touches the store: writing, marking and rolling back cost no
   // lock and no copy of the tree, so a caller that throws its changes away
   // never becomes a writer at all. One thread at a time.
   class delta
   {
     public:
      delta();
      delta(delta&&) noexcept;
      delta& operator=(delta&&) noexcept;
      ~delta();
      void put(std::span<const char> key, std::span<const char> value);
      void erase(std::span<const char> key);
      bool empty() const noexcept;
      // Bytes held. Rolling back does not lower it; clear() does.
      std::uint64_t bytes() const noexcept;
      // A point the changes can be rolled back to. Marks nest.
      struct mark
      {
         std::uint32_t root = 0xffffffffu;
         std::uint32_t size = 0;
      };
      mark save();
      void restore(const mark&);
      void clear() noexcept;

     private:
      struct impl;
      std::unique_ptr<impl> self;
      friend class read_session;
      friend class write_session;
   };

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
      // The same reads through changes kept aside. A null root is an empty tree.
      bool get(const shared_root&, const delta&, std::span<const char>, std::vector<char>* value);
      bool get_greater_equal(const shared_root&,
                             const delta&,
                             std::span<const char>,
                             std::vector<char>*,
                             std::vector<char>*);
      bool get_less_than(const shared_root&,
                         const delta&,
                         std::span<const char>,
                         std::vector<char>*,
                         std::vector<char>*);
      bool get_max(const shared_root&,
                   const delta&,
                   std::span<const char>,
                   std::vector<char>*,
                   std::vector<char>*);
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
      // A second published root for node-local state. Publishing it never
      // flushes and never touches the top root, so it does not wait behind (or
      // delay) top-root publications beyond the engine's single-writer step.
      // After a power loss it is the newest version that reached the disk
      // whole, which may be older than the top root.
      shared_root get_local_root();
      void        set_local_root(shared_root);
      void        upsert(shared_root&, std::span<const char>, std::span<const char>);
      void        upsert(shared_root&, std::span<const char>, std::span<const shared_root>);
      void        remove(shared_root&, std::span<const char>);
      // Apply changes kept aside to a tree, in key order, as one edit. With a
      // mark: the changes as they were at that mark. The delta keeps them.
      void        apply(shared_root&, delta&, const delta::mark* at = nullptr);
      // Throws on a read-only database.
      void        require_writable() const;
      void        splice(shared_root&,
                         const shared_root&,
                         std::span<const char> lower,
                         std::span<const char> upper);
   };

   struct database_state;
   // A flat key/value tree on an engine root of its own (root 2), for data
   // that can be rebuilt: the node's compiled service modules.
   //
   // It is no part of the chain. The chain's state is reached from the top
   // root (root 0: head, revisions, saved snapshots) and the node's
   // persistent subjective state from the local root (root 1). Nothing under
   // either refers to this root, so it is in no revision, fork, state hash or
   // snapshot; publishing, reverting or pruning a revision does not touch it,
   // and a clone of the database sees the same one. clear() empties it.
   //
   // Writers. The engine has one writer per root, and writers of different
   // roots do not wait for each other. This root has a write session of its
   // own, which the chain's writer never uses, and a mutex of its own, which
   // the chain's writer never takes: a write here holds that mutex for one
   // insert and does not enter the gate chain publication goes through.
   // (An engine session may be used by one thread at a time, not only by the
   // thread that made it; the mutex is what makes that so. A session per
   // writing thread would spend one of the engine's 64 session slots, and
   // an allocation segment, on every thread that ever compiled a module.)
   //
   // Readers use the calling thread's engine reader, as every read of the
   // database does, and take a snapshot of the root: they wait for no writer.
   //
   // Durability. Like the local root, this root is published without a
   // flush, whatever the database's sync level, and after a power loss it is
   // whatever version reached the disk whole. Callers must check what they
   // read (NativeAotCache does, by digest). With the default sync level
   // nothing is flushed at all. With flushing on, the data written here is in
   // the same file as the chain's, so the chain's next flushed publication
   // also writes it out: about half a millisecond per megabyte stored since
   // the last flush, measured on an SSD (NativeAotDatabaseTests).
   class cache_root
   {
      std::shared_ptr<database_state> state;
      explicit cache_root(std::shared_ptr<database_state>);
      friend class database;

     public:
      // False for a read-only database: reads work, writes do nothing.
      bool                             writable() const noexcept;
      std::optional<std::vector<char>> get(std::span<const char> key);
      void put(std::span<const char> key, std::span<const char> value);
      void erase(std::span<const char> key);
      void clear();
      // Every key with the size of its value, in key order.
      std::vector<std::pair<std::vector<char>, std::uint64_t>> sizes();
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
      // The root beside the chain's two. Every handle is the same root.
      cache_root            get_cache_root() const;
   };
}  // namespace psibase::storage
