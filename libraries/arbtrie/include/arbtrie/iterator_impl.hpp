#pragma once
namespace arbtrie
{
   int32_t iterator::read_value(auto& buffer)
   {
      if (0 == _path.size()) {
         buffer.resize(0);
         return -1;
      }

      auto state = _rs._segas.lock();
      auto rr    = state.get(_path.back());

      switch (rr.type())
      {
         case node_type::binary:
         {
            auto kvp = rr.as<binary_node>()->get_key_val_ptr(_binary_index);
            auto s   = kvp->value_size();
            buffer.resize(s);
            memcpy(buffer.data(), kvp->val_ptr(), s);
            return s;
         }
         case node_type::full:
         {
            TRIEDENT_WARN("read vlaue full");
            return -1;
         }
         case node_type::setlist:
         {
            auto b0 = rr.as<setlist_node>()->get_branch(0);
            auto v  = state.get(b0).as<value_node>()->value();
            auto s  = v.size();
            buffer.resize(s);
            memcpy(buffer.data(), v.data(), s);
            return s;
         }
      }
      return -1;
   }
}  // namespace arbtrie
