#pragma once
namespace arbtrie
{


   inline bool iterator::is_subtree()const {
      if( not valid() )  [[unlikely]]
         return false;

      auto state = _rs._segas.lock();
      auto rr    = state.get(_path.back().first);
      switch( rr.type() ) {
         case node_type::binary:
            return rr.as<binary_node>()->is_subtree(_path.back().second);
         case node_type::full:
            return rr.as<full_node>()->is_eof_subtree();
         case node_type::setlist:
            return rr.as<setlist_node>()->is_eof_subtree();
         case node_type::value:
            return rr.as<value_node>()->is_subtree();
         default:
            throw std::runtime_error( "iterator::is_subtree unhandled type" );
      }
   }

   inline node_handle iterator::subtree()const {
      if( not is_subtree() ) [[unlikely]]
         throw std::runtime_error( "iterator::subtree: not a subtree" );

      auto state = _rs._segas.lock();
      auto rr    = state.get(_path.back().first);
      switch( rr.type() ) {
         case node_type::binary:
         {
            auto bn = rr.as<binary_node>();
            auto idx = _path.back().second;
            auto kvp = bn->get_key_val_ptr(idx);
            return _rs.create_handle(kvp->value_id());
         }
         case node_type::full:
            return _rs.create_handle( rr.as<full_node>()->get_eof_value() );
         case node_type::setlist:
            return _rs.create_handle( rr.as<setlist_node>()->get_eof_value() );
         case node_type::value:
            return _rs.create_handle(  rr.as<value_node>()->subtree() );
         default:
            throw std::runtime_error( "iterator::subtree unhandled type" );
      }
   }

   inline int32_t iterator::read_value(auto& buffer)
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
            memcpy(buffer.data(), b0->value().data(), b0->value_size());
            return b0->value_size();
         }

         default:
            throw std::runtime_error( "iterator::read_value unhandled type" );
      }
      return -1;
   }
}  // namespace arbtrie
