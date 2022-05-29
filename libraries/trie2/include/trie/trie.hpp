#pragma once
#include <trie/node.hpp>
//#include <trie/object_arena.hpp>
#include <trie/ring_alloc.hpp>

namespace trie
{
   class database
   {
     public:
      struct config
      {
         uint64_t max_objects = 1000 * 1000ull;
         uint64_t hot_pages   = 1000 * 1000ull;
         uint64_t cold_pages  = 4000 * 1000ull;
         uint64_t big_hot_pages   = 1* 1000ull;
         uint64_t big_cold_pages  = 4* 1000ull;
      };

      enum access_mode
      {
         read_only  = 0,
         read_write = 1
      };

      using string_view = std::string_view;
      using id          = object_id;
      database(std::filesystem::path dir, config, access_mode allow_write);
      ~database();

      inline void release(id);

      void swap();

      template <typename T = node>
      struct deref
      {
         deref() = default;
         deref(std::pair<id, char*> p) : _id(p.first), ptr(p.second) {}
         deref(std::pair<id, value_node*> p) : _id(p.first), ptr((char*)p.second) {}
         deref(std::pair<id, inner_node*> p) : _id(p.first), ptr((char*)p.second) {}

         template <typename Other>
         deref(deref<Other> p) : _id(p._id), ptr((char*)p.ptr)
         {
         }

         deref(id i, char* p) : _id(i), ptr(p) {}
         explicit inline operator bool() const { return bool(_id); }
         inline          operator id() const { return _id; }

         template <typename V>
         inline V& as()
         {
            return *reinterpret_cast<V*>(ptr);
         }

         inline T*       operator->() { return reinterpret_cast<T*>(ptr); }
         inline const T* operator->() const { return reinterpret_cast<const T*>(ptr); }
         inline T&       operator*() { return *reinterpret_cast<T*>(ptr); }
         inline const T& operator*() const { return *reinterpret_cast<const T*>(ptr); }

         int64_t as_id()const { return _id.id; }

        private:
         template <typename Other>
         friend class deref;

         id    _id;
         char* ptr;
      };

      class session
      {
        public:
         bool upsert(string_view key, string_view val);
         bool remove(string_view key);
         std::optional<string_view> get( string_view key )const;

         void print();
         ~session();

         void clear();
        private:
         void               print(id n, string_view prefix = "");
         inline deref<node> get(ring_allocator::id i)const;
         std::optional<string_view> get( id root, string_view key )const;
         inline id          set_value(deref<node> n, string_view key, string_view val);
         inline id          set_inner_value(deref<inner_node> n, string_view val);
         inline id          combine_value_nodes(string_view k1,
                                                string_view v1,
                                                string_view k2,
                                                string_view v2);

         inline id add_child(id root, string_view key, string_view val, bool& inserted);
         inline id remove_child(id root, string_view key, bool& removed);
         inline deref<value_node> make_value(string_view k, string_view v);
         inline deref<inner_node> make_inner(string_view pre, id val, uint64_t branches);
         inline deref<inner_node> make_inner(const inner_node& cpy,
                                             string_view       pre,
                                             id                val,
                                             uint64_t          branches);
         inline void              assign(id& to, id from);
         inline void              release(id);
         inline id                retain(id);

         friend class database;
         session(database& db, uint32_t version) : _db(db), _version(version) {}
         database& _db;
         uint32_t  _version;
      };

      session start_revision(uint32_t new_rev, uint32_t prev_rev);

      void    print_stats();

     private:
      std::unique_ptr<struct database_impl> my;
   };

}  // namespace trie
