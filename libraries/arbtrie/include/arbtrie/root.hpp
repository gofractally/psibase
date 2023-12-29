#pragma once
#include <arbtrie/debug.hpp>
#include <arbtrie/node_meta.hpp>

namespace arbtrie
{
   class database;
   class root;
   class read_session;
   using root_ptr = std::shared_ptr<root>;

   class root_data
   {
      friend class root;

     private:
      // If db == nullptr, then the other fields don't matter. There are 3
      // ways to represent an empty tree:
      //    shared_ptr<root>  == nullptr ||     // Default-initialized shared_ptr
      //    root::db          == nullptr ||     // Moved-from or default-initialized root
      //    root::id          == {}             // Result of removing from an almost-empty tree
      //
      // If ancestor == nullptr, then id (if not 0) has a refcount on it which will be
      // decremented within ~root(). If this fails to happen (SIGKILL), then the refcount
      // will leak; mermaid can clean this up. If id is referenced within a leaf, or there
      // are any other root instances pointing at it, then its refcount will be greater
      // than 1, preventing its node from being dropped or edited in place. If
      // shared_ptr<root>::use_count is greater than 1, then it also won't be dropped or
      // edited in place. This limits edit-in-place to nodes which aren't reachable by
      // other threads.
      //
      // If ancestor != nullptr, then id doesn't have a refcount on it. ancestor
      // keeps ancestor's id alive. ancestor's id keeps this id alive. If ancestor is
      // held anywhere else, then either its shared_ptr::use_count or its storage
      // refcount will be greater than 1, preventing it from being dropped or edited
      // in place, which in turn keeps this id and the node it references safe.

      read_session*              session = nullptr;
      std::shared_ptr<root_data> ancestor;
      object_id                  id;


     public:
      root_data(read_session* ses, std::shared_ptr<root_data> ancestor = {}, object_id id = {})
          : session(ses), ancestor(std::move(ancestor)), id(id)
      {
         if constexpr (debug_roots)
            std::cout << id.id << ": root(): ancestor=" << (ancestor ? ancestor->id.id : 0)
                      << std::endl;
      }


      root_data(const root_data&) = delete;
      root_data(root_data&&)      = default;
      ~root_data();

      root_data& operator=(const root_data&) = delete;
      root_data& operator=(root_data&&)      = default;
   };  // root_data

   class root
   {
     public:
      friend class read_session;
      friend class write_session;
      bool is_unique() const { return _data and _data.use_count() == 1 and not _data->ancestor; }
      object_id id()const { return _data->id; }

      root(root&& mv)      = default;
      root(const root& cp) = default;
      ~root()              = default;

     private:
      root(read_session& rs) { _data = std::make_shared<root_data>(&rs, nullptr, object_id()); }
      root(read_session& rs, object_id id)
      {
         _data = std::make_shared<root_data>(&rs, nullptr, id);
      }

      friend class database;

      void set_id(object_id rid);

      std::shared_ptr<root_data> _data;
   };

}  // namespace arbtrie
