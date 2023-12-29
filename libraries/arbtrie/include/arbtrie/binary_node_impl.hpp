#pragma once

namespace arbtrie {

   /*
   binary_node* binary_node::clone() {
      binary_node* copy = (binary_node*)node_header::clone();
    //  copy->retain_values();
      return copy;
   }
   */
   /*
   void binary_node::retain_branches(){
      auto* pos   = values();
      const auto* end   = pos + num_branches();
      while( pos != end ) {
         retain( *pos++ );
      }
   }

   void binary_node::release() {
      auto* pos   = values();
      const auto* end   = pos + num_branches();
      while( pos != end ) {
         release( *pos++ );
      }
   }
   */

   /*
   inline binary_node* binary_node::make( key_view key, id_type val ) {
      auto asize = sizeof(node_header) + sizeof(val) + key.size() + 1 + sizeof(uint16_t);
      auto bn = node_header::make<binary_node>(asize,1);

      auto p = bn->start_keys();
      bn->key_offset(0) = bn->tail() - p;
      bn->values()[0] = val;
      *p++ = key.size();
      memcpy( p, key.data(), key.size());
      return bn;
   }

   binary_node* binary_node::clone_range(key_view minus_prefix, int from, int to)const {
      const auto nbranch = to - from;
      auto key_data_size = nbranch; // init with the size field of the keys
      for( int k = from; k < to; ++k ) 
         key_data_size +=  *get_key_ptr(k);
      key_data_size -= minus_prefix.size()*nbranch;
      const auto asize = sizeof(node_header) + nbranch*(sizeof(uint16_t)+sizeof(id_type)) + key_data_size;
      auto nn = node_header::make<binary_node>( asize, nbranch );

      memcpy( nn->values(), &value(from), nbranch * sizeof(id_type) );
      auto nv = nn->values(); // grap ptr to values so we can retain them in following loop

      auto nntail = nn->tail();
      char* key_pos = nn->start_keys();
      for( int i = 0; i < nbranch; ++i ) {
         // TODO retain( *nv++ ); 

         nn->key_offset(i) = nntail - key_pos;
         auto fk = get_key( from+i );
         auto nks = fk.size() - minus_prefix.size();
         *key_pos++ = nks;
//         std::cerr << "clone_range " << from << " -> " << to 
//                   << " i: " << i <<" '"<<fk<<"'" 
//                   << " prefix: '" << minus_prefix << "'\n";
         memcpy( key_pos, fk.data() + minus_prefix.size(), nks );
         key_pos += nks;
      }
      return nn;
   }
   */

   /**
    * Creates a copy of this node with key inserted in order into the
    * index. Val will be stored as the value of the key and no reference
    * incrementing will be done on val. 
    */
   /*
   binary_node* binary_node::clone_add(key_view key, id_type val)const {
      assert( find_key_idx(key) == -1 );

      // The new node will be larger by 1 id_type for the value, 1 index, 1 byte to
      // store the length of the key and length of the key
      auto asize = _nsize + sizeof(id_type) + sizeof(uint16_t) + 1 + key.size();
      auto t = node_header::make<binary_node>( asize, num_branches()+1 );
      auto lb = lower_bound_idx(key);


      // insert the new offset
      memcpy( t->key_offsets(), key_offsets(), lb * sizeof(uint16_t) );
      t->key_offset(lb) = t->key_section_size();
      memcpy( &t->key_offset(lb+1), &key_offset(lb), sizeof(uint16_t)*(num_branches() - lb) );

      // insert the new value
      memcpy( t->values(), values(), lb * sizeof(id_type) );
      t->values()[lb] = val;
      // TODO: retain(val) should we increment ref of val here?
      memcpy( t->values()+lb+1, values()+lb, sizeof(id_type)*(num_branches() - lb) );
      
       
      // insert the new key
      auto start_key = t->start_keys();
      *start_key++ = key.size();
      memcpy( start_key, key.data(), key.size() );
      start_key += key.size();

      // copy keys from this to new 
      auto key_data_len = key_section_size();
      memcpy( start_key, start_keys(), key_data_len );
      return t;
   }
   */
}
