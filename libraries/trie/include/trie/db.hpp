#pragma once
#include <filesystem>
#include <optional>
#include <string>
#include <vector>

namespace trie
{
   namespace detail
   {
      struct database_impl;
   }  // namespace detail
   struct inner;
   struct node_ptr;

   class database
   {
     public:
      using string_view = std::string_view;

      database(std::filesystem::path file, uint64_t size, bool write_mode);
      ~database();

      class session
      {
        public:
         class const_iterator
         {
           public:
            bool            valid() const;
            const_iterator& operator++();
            const_iterator& operator--();

            std::vector<char> key() const;
            string_view       value() const;

           private:
            friend class session;
            using tree_path = std::vector<std::pair<const inner*, int> >;
            const_iterator(const session& s) : _session(s){};

            friend class session;
            const session& _session;
            tree_path      _path;
         };

         class iterator
         {
           public:
            bool      valid() const { return _path.size() > 0; }
            iterator& operator++();
            iterator& operator--();

            void set_value(string_view val);
            void remove();

            std::vector<char> key() const;
            string_view       value() const;

            iterator(const iterator& i) = default;
            iterator(iterator&& i)      = default;
            iterator& operator=(const iterator& i) = default;
            iterator& operator=(iterator&& i) = default;

           private:
            friend class session;
            using tree_path = std::vector<std::pair<inner*, int> >;
            iterator(session& s) : _session(&s) {}

            session*  _session;
            tree_path _path;
         };

         const_iterator first() const;
         const_iterator last() const;
         const_iterator find(const string_view prefix) const;
         const_iterator lower_bound(const string_view prefix) const;
         const_iterator upper_bound(const string_view prefix) const;

         iterator first();
         iterator last();
         iterator find(const string_view prefix);
         iterator lower_bound(const string_view prefix);
         iterator upper_bound(const string_view prefix);

         std::optional<string_view> get(string_view key) const;

         // invalidates all iterator on this revision because the nodes may
         // have to be replaced
         bool upsert(const string_view key, const string_view val);
         bool remove(const string_view key);

         ~session() { _db.unlock_revision(_version); };

         void dump();

        private:
         node_ptr set_branch2(const node_ptr& in, uint8_t branch, node_ptr&& val);
         bool     set_branch(node_ptr& in, const string_view branch, node_ptr&& val);
         std::pair<node_ptr, bool> set_branch2(const node_ptr&   in,
                                               const string_view branch,
                                               node_ptr&&        val);
         bool                      add_child(node_ptr& n, const string_view key, node_ptr&& val);

         std::pair<node_ptr, bool> add_child2(const node_ptr&   in,
                                              const string_view key,
                                              node_ptr&&        val);

         bool                      remove(node_ptr& n, const string_view key);
         std::pair<node_ptr, bool> remove2(const node_ptr& n, const string_view key);
         inline node_ptr           clone(const node_ptr& from, uint64_t branches = -1);

         inline node_ptr make_inner(const inner&      from,
                                    const string_view prefix,
                                    uint8_t           num_branch);
         inline node_ptr make_inner(const string_view prefix, uint8_t num_branch);
         inline node_ptr make_value(const string_view val);

         friend class database;
         session(database& db, uint32_t version) : _db(db), _version(version) {}

         database& _db;
         uint32_t  _version;
      };

      /*
       * Every block has a unique time slot and exactly one producer who
       * can produce at that slot, so we can use the slot (which coresponds to
       * the timestamp with 1 second blocks) as the version and allow us to
       * maintain all versions in memory for rapid changing. 
       *
       * There can be at most 2^16-1 versions and when starting a new version
       * the old version must be discarded. This will throw if the slot is
       * already in use.
       */
      session       start_revision(uint32_t new_version, uint32_t prev_version);
      const session read_revision(uint32_t version);
      void          free_revision(uint32_t version);

     private:
      friend class session;
      void                                   unlock_revision(uint32_t version);
      std::unique_ptr<detail::database_impl> _impl;
   };

};  // namespace trie
