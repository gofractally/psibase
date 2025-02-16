
namespace arbtrie
{

   /*
   template <typename T>
   inline T* node_header::make(uint32_t size, uint16_t num_branch, uint8_t prefix_len)
   {
      assert(size > (sizeof(T)+prefix_len) );
      return (T*)new (malloc(size)) node_header(size, T::type, num_branch, prefix_len);
   }

   inline node_header* node_header::clone()
   {
      node_header* n = (node_header*)malloc(_nsize);
      memcpy(n, this, _nsize);
      return n;
   }

   inline static full_node* full_node::make(key_view prefix) {}

   inline static uint16_t index_node::alloc_size(uint16_t num_branches, key_view prefix)
   {
      return prefix.size() + 257 + sizeof(id_type) * num_branches + sizeof(node_header);
   }

   inline void index_node::set_branch(uint16_t br, id_type v)
   {
      assert(offsets()[br] != 0xff);
      assert(v.valid());
      branches()[offsets()[br]] = v;
   }

   inline id_type index_node::get_branch(uint16_t br) const
   {
      assert(offsets()[br] != 0xff);
      return branches()[offsets()[br]];
   }

   inline void index_node::add_branch(uint16_t br, id_type v)
   {
      assert(_used_branches < _num_branches);
      assert(v.valid());
      branches()[offsets[br] = _used_branches] = v;
      _used_branches++;
   }

   // removing a branch doesn't allow another branch to be
   // used instead, doing so would require keeping track of
   // unused slots in branches() and finding the first one,
   // that would be O(N) in compleixty and reserving a
   // id_type value to signal not present.
   inline void index_node::remove_branch(uint16_t br)
   {
      assert(offsets()[br] != 0xff);
      branches()[offsets[br]] = id_type();
      offsets[br]             = 0xff;
   }

   inline key_view setlist_node::get_prefix() const
   {
      return key_view(prefix, prefix_size());
   }
   inline bool setlist_node::has_value() const
   {
      return has_value;
   }
   inline std::string_view setlist_node::get_setlist() const
   {
      return std::string_view(prefix + prefix_size(), num_branches);
   }
   id_type[] setlist_node::branches()
   {
      return (id_type*)(prefix + prefix_size() + num_branches);
   }
   const id_type[] setlist_node::branches() const
   {
      return (id_type*)(prefix + prefix_size() + num_branches);
   }

   inline void setlist_node::set_branch(uint16_t br, id_type b)
   {
      if (br)
      {
         auto pos = get_setlist().find(char(br - 1));
         if (pos != key_view::npos)
            branches()[pos + has_value()] = b;
      }
      else if (has_value())
      {
         branches()[0] = b;
      }
      assert(!"attempt to set a branch that isn't in the setlist");
   }
   inline id_type setlist_node::get_branch(uint16_t br) const
   {
      if (br)
      {
         auto pos = get_setlist().find(char(br - 1));
         if (pos != key_view::npos)
            return branches()[pos + has_value()];
      }
      else if (has_value())
      {
         return branches()[0];
      }
      assert(!"attempt to get a branch that isn't in the setlist");
   }
   */

}  // namespace arbtrie
