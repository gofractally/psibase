#pragma once

namespace triedent
{

   struct node_header
   {  // aka object_header
      uint32_t checksum;
      uint32_t type : 4;
      uint32_t size : 28;  // up to 256MB
      // size might not be a multiple of 8, next object is at data() + (size+7)&-8
      uint64_t prelen : 16;  // bytes of data, not including header
      uint64_t unused : 8;   // bytes of data, not including header
      uint64_t id : 40;
   } static_assert(sizeof(node_header) == 16);

   struct inner_node_present
   {
      uint16_t prefix_len;
      uint8_t  has_value : 1;
      uint8_t  num_branches;

      // calculate positions of data
      inline uint8_t*   key_ptr() { return (uint8_t*)(this + 1); }
      inline uint8_t*   key_end_ptr() { return key_ptr() + prefix_len; }
      inline uint8_t*   branches_ptr() { return key_end_ptr(); }
      inline uint8_t*   branches_end_ptr() { return key_end_ptr() + num_branches; }
      inline object_id* branches_ids_ptr() { return (object_id*)branches_ids_end_ptr(); }
      inline object_id* branches_ids_end_ptr() { return branches_ids_ptr() + num_branches; }
      inline object_id* value_id() { return branches_ids_end_ptr(); }

      uint8_t* branches_ids_end_ptr() { return key_end_ptr() + num_branches; }

      std::string_view     prefix() { return {key_ptr(), prefix_len}; }
      std::string_view     branches() { return {branches_ptr(), num_branches}; }
      std::span<object_id> branch_ptrs() { return {branches_ids_ptr(), num_branches}; }

      // return null if branch not present
      inline object_id* branch(uint8_t b)
      {
         auto pos = branches().find(b);
         return pos >= 0 ? branch_ids_ptr + pos : nullptr;
      }

      // return null if branch not present, or object_id 0 if the branch ptr
      // has space reserved but nothing is present
      inline const object_id* branch(uint8_t b) const
      {
         auto pos = branches().find(b);
         return pos >= 0 ? branch_ids_ptr + pos : nullptr;
      }

      // return the key, oid_index or 256,-1 if end
      std::pair<uint8_t, int16_t> lower_bound(uint8_t b)
      {
         const auto start = branches_ptr();
         const auto end   = start + num_branches;
         for (auto p = start; p != end; ++p)
         {
            // TODO: keys may be present with null objs, they should be skipped
            if (*p >= b)
               return std::pair<uint8_t, uint16_t>(*p, p - start);
         }
         return std::pair<uint8_t, int16_t>(256, -1);
      }

      // return the key, oid_index or (0,-1) if end
      int8_t reverse_lower_bound(uint8_t b)
      {
         const auto end   = branches_ptr() - 1;
         const auto start = end + num_branches;
         for (auto p = start; p != end; --p)
         {
            // TODO: keys may be present with null objs, they should be skipped
            if (*p <= b)
               return std::pair<uint8_t, uint16_t>(*p, end - p);
         }
         return std::pair<uint8_t, int16_t>(0, -1);
      }

      // the first branch greater than b, if b == 255 then this will return 256
      uint8_t upper_bound(uint8_t b)
      {
         const auto start = branches_ptr();
         const auto end   = start + num_branches;
         for (auto p = start; p != end; ++p)
         {
            // TODO: keys may be present with null objs, they should be skipped
            if (*p > b)
               return std::pair<uint8_t, uint16_t>(*(p), p - start);
         }
         return std::pair<uint8_t, int16_t>(256, -1);
      }

      // return null if no value present
      inline const object_id* value() const { has_value ? value_id() : nullptr; }
      inline object_id*       value() { has_value ? value_id() : nullptr; }

      //char        prefix[prefix_len]
      //char        branch_keys[num_children];
      //object_id   branch_ptrs[num_children];
   } __attribute__((packed));

   struct inner_node128
   {
   }

   // all branches are present, null branches are represented as
   // empty objid.
   struct inner_node256
   {
      object_id children[256];
   };



   /**
    * This structure is meant to be fast to insert into without
    * having to allocate a bunch of tree nodes to resolve collisions
    * in the key space. It should be refactored into tree nodes
    * before it gets larger than a single page to minimize page 
    * misses. 
    */
   struct inner_leafs
   {
      node_header*             header() { return ((node_header*)this) - 1; }
      uint16_t                 num_keys() { return header()->prefix_len; }
      void                     set_num_keys(uint16_t v) { header()->prefix_len = v; }

      offset_ptr<flat_string>* keys() { return (offset_ptr<flat_string>*)(this); }
      char*                    end_keys() { return (char*)keys() + num_keys(); }

      // could use end of object - num_keys()*sizeof(object_id) which is key indepdnent method that
      // works even if keys() are not yet initialized
      object_id* values() { return (object_id*)keys()[num_keys - 1]->str().end(); }

      static inline uint32_t alloc_size(std::string_view key)
      {
         return sizeof(offset_ptr<flat_string>) +
                flat_string::alloc_size(key) + sizeof(object_id);
      }

      inner_leafs* make(session_rlock& state, std::string_view key, object_id val)
      {
         inner_leaf* obj = state.alloc( alloc_size(key) );
         obj->set_num_keys(1);
         obj->keys()[0].offset = end_keys() - obj->keys();
         new (&obj->keys()[0]) flat_string( key );
         obj->values()[0] = val;
         return obj;
      }

      inner_leafs* clone_add(session_rlock& state, inner_leafs* in, std::string_view key, object_id val)
      {
         auto new_size = in->data_size() + sizeof(offset_ptr<flat_string>) +
                         flat_string::alloc_size(key) + sizeof(val);

         inner_leaf* obj = state.alloc( new_size );
         obj->set_num_keys( in->num_keys() + 1 );

         // new index = in.lower_bound(key);
         for( int i = 0; i < index; ++i ) 
            keys()[i].offest = in->keys()[i].offset + 2;

         keys()[index].offset = // TBD
         char* start = (char*)(in->keys()+index);
         memcpy( keys()+index+1, start, (char*)in->values() - start );

         new (keys()[index].get()) flat_string(key);
         memcpy( values(), in->values(), sizeof(object_id)*index );
         values[index] = val;
         memcpy( values()+index+1, in->values()+index, in->num_keys() - index );

         // TODO: retain each value 

         return (inner_leaf*)a;
      }

      inner_leafs* clone_rm( session_rlock& state, inner_leafs* in, uint16_t rm_index ) {
      }
   };


