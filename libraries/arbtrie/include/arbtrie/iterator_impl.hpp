#pragma once
namespace arbtrie
{
   int32_t iterator::read_value(auto& buffer)
   {
      if (0 == _path.size())
      {
         buffer.resize(0);
         return -1;
      }

      auto state = _rs._segas.lock();
      auto rr    = state.get(_path.back().first);

      switch (rr.type())
      {
         case node_type::binary:
         {
            auto kvp = rr.as<binary_node>()->get_key_val_ptr(_path.back().second);
            auto s   = kvp->value_size();
            buffer.resize(s);
            memcpy(buffer.data(), kvp->val_ptr(), s);
            return s;
         }
         case node_type::full:
         {
            auto b0 = rr.as<full_node>()->get_eof_value();
            assert(b0);
            auto v = state.get(b0).as<value_node>()->value();
            auto s = v.size();
            buffer.resize(s);
            memcpy(buffer.data(), v.data(), s);
            return s;
         }
         case node_type::setlist:
         {
            auto b0 = rr.as<setlist_node>()->get_eof_value();
            assert(b0);
            auto v = state.get(b0).as<value_node>()->value();
            auto s = v.size();
            buffer.resize(s);
            memcpy(buffer.data(), v.data(), s);
            return s;
         }
         case node_type::value:
         {
            auto b0 = rr.as<value_node>();
            buffer.resize(b0->value_size());
            memcpy(buffer.data(), b0->body(), b0->value_size());
            return b0->value_size();
         }

         default:
            TRIEDENT_WARN("UNHANDLED  TYPE");
            throw;
      }
      return -1;
   }
}  // namespace arbtrie
