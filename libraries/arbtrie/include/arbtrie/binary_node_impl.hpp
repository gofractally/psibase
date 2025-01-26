#pragma once
#include <arbtrie/debug.hpp>

namespace arbtrie
{
   constexpr void lower_bound_idx_pos(int n, int key, uint16_t* table)
   {
      int left  = -1;
      int right = n;
      while (right - left > 1)
      {
         int middle = (left + right) >> 1;
         table[middle] += 256;
         if (middle < key)
            left = middle;
         else
            right = middle;
      }
   }

   constexpr std::array<uint8_t, (256 * 255) / 2> create_table()
   {
      std::array<uint8_t, (256 * 255) / 2> sequence_table;
      uint16_t                             table[256];
      for (int i = 1; i < 256; ++i)
      {
         auto* tbl_pos = sequence_table.data() + (i * (i - 1)) / 2;
         for (int x = 0; x < i; ++x)
            table[x] = x;
         for (int x = 0; x < i; ++x)
            lower_bound_idx_pos(i, x, table);

         std::stable_sort(table, table + i, [](auto a, auto b) { return (a >> 8) > (b >> 8); });
         std::reverse( table, table+ i );
         for (int x = 0; x < i; ++x)
            tbl_pos[x] = table[x] & 0xff;
      }
      return sequence_table;
   }

   static const auto search_seq_table = create_table();

   /**
     * Always a multiple of 64, aka the typical cache line size
     */
   inline int binary_node::alloc_size(const clone_config& cfg)
   {
      return alloc_size( cfg.branch_cap, cfg.data_cap );
   }

   inline int binary_node::alloc_size(const binary_node* src, const clone_config& cfg)
   {
      auto bcap = std::max<int>(cfg.branch_cap, src->num_branches());
      auto dcap = std::max<int>(cfg.data_cap, src->key_val_section_size()-src->_dead_space);
      return alloc_size( bcap, dcap );
   }

   inline int binary_node::alloc_size(const clone_config& cfg, id_region,
                                key_view k1, const value_type& v1,
                                key_view k2, const value_type& v2 ) {
      auto bcap = std::max<int>(cfg.branch_cap, 2);
      auto dcap = cfg.data_cap + 
                  calc_key_val_pair_size( k1,v1 ) +
                  calc_key_val_pair_size( k2,v2 );
      return alloc_size( bcap, dcap );
   }


   inline int binary_node::alloc_size(const binary_node*  src,
                                      const clone_config& cfg,
                                      const clone_insert& ins)
   {
      auto bcap = std::max<int>(cfg.branch_cap, src->num_branches() + 1);
      auto dcap = std::max<int>(cfg.data_cap, src->key_val_section_size()-src->_dead_space);
      dcap += calc_key_val_pair_size(ins.key, ins.val);
      return alloc_size( bcap, dcap );
   }
   inline int binary_node::alloc_size(const binary_node*  src,
                                      const clone_config& cfg,
                                      const clone_update& ins)
   {
      auto bcap = std::max<int>(cfg.branch_cap, src->_branch_cap);
      auto dcap = std::max<int>(cfg.data_cap, src->key_val_section_size()-src->_dead_space);
      auto keyval = src->get_key_val_ptr(ins.idx);
      dcap += ins.val.size() - keyval->value_size();

      return alloc_size( bcap, dcap );
   }

   inline int binary_node::alloc_size(const binary_node*  src,
                                      const clone_config& cfg,
                                      const clone_remove& rem)
   {
      auto v    = src->get_key_val_ptr(rem.idx);
      auto bcap = std::max<int>(cfg.branch_cap, src->num_branches() - 1);
      auto dcap = std::max<int>(cfg.data_cap, src->key_val_section_size() - v->total_size()-src->_dead_space);

      return alloc_size( bcap, dcap );
   }

   inline binary_node::binary_node(int_fast16_t        asize,
                                   fast_meta_address   nid,
                                   const clone_config& cfg)
       : node_header(asize, nid, node_type::binary), _alloc_pos(0)
   {
      assert(asize <= binary_node_max_size);
      _branch_cap = cfg.branch_cap;
   }
   inline binary_node::binary_node(int_fast16_t        asize,
                                   fast_meta_address   nid,
                                   const clone_config& cfg,
                                   id_region           branch_reg, 
                                   key_view k1, const value_type& v1,
                                   key_view k2, const value_type& v2 )
       : node_header(asize, nid, node_type::binary, 0), _alloc_pos(0)
   {
      _branch_id_region = branch_reg.region;
      _branch_cap = min_branch_cap(2);
      if( k1 < k2 )
      {
         insert( 0, k1, v1 );
         insert( 1, k2, v2 );
      }
      else 
      {
         insert( 0, k2, v2 );
         insert( 1, k1, v1 );
      }
      assert( num_branches() == 2 );
   }

   inline binary_node::binary_node(int_fast16_t        asize,
                                   fast_meta_address   nid,
                                   const binary_node*  src,
                                   const clone_config& cfg)
       : node_header(asize, nid, node_type::binary, src->num_branches()),
         _alloc_pos(src->_alloc_pos)
   {
      assert(asize <= binary_node_max_size);
      assert(not cfg.set_prefix);
      assert(alloc_size(src, cfg) <= asize);

      _branch_id_region = src->_branch_id_region;

      TRIEDENT_WARN("clone binary node");
      _branch_cap = min_branch_cap(0);

      memcpy(key_hashes(), src->key_hashes(), num_branches());
      memcpy(key_offsets(), src->key_offsets(), sizeof(key_index) * num_branches());
      memcpy(value_hashes(), src->value_hashes(), num_branches());

      auto kvs = key_val_section_size();
      memcpy(tail() - kvs, src->tail() - kvs, kvs);

      assert(get_type() == node_type::binary);
   }

   /**
    *  Called to update a particular key with a new value that is of
    *  a different size or type that required growth and/or we needed
    *  to clone a shared state to make it unique anyway.
    *
    *  Rather than copying the data from src as quickly as possible,
    *  which would copy dead space, we will copy it in-order creating
    *  a new compact node that has the updated value in the right spot.
    */
   inline binary_node::binary_node(int_fast16_t        asize,
                                   fast_meta_address   nid,
                                   const binary_node*  src,
                                   const clone_config& cfg,
                                   const clone_update& up)
       : node_header(asize, nid, node_type::binary, src->num_branches()), _alloc_pos(0)
   {
      assert(asize <= binary_node_max_size);
      assert(alloc_size(src, cfg, up) <= asize);
      _branch_cap = min_branch_cap(src->num_branches());
      _dead_space = 0;
      _branch_id_region = src->_branch_id_region;

      auto kh  = key_hashes();
      auto ko  = key_offsets();
      auto vh  = value_hashes();
      auto skh = src->key_hashes();
      auto sko = src->key_offsets();
      auto svh = src->value_hashes();

      memcpy(kh, skh, num_branches());

      const auto nb = src->num_branches();
      const uint8_t* seq = search_seq_table.data() + ((nb - 1) * nb) / 2;
      for (int x = 0; x < nb; ++x)
      {
         auto idx = seq[x];
         auto kvp = src->get_key_val_ptr(idx);
         if (idx != up.idx) [[likely]]
         {
            auto ts = kvp->total_size();
            _alloc_pos += ts;
            auto nkvp = get_key_val_ptr_offset(_alloc_pos);
            memcpy(nkvp, kvp, ts);
            ko[idx].type = sko[idx].type;
            ko[idx].pos  = _alloc_pos;
            vh[idx]      = svh[idx];
         }
         else
         {
            auto vs = up.val.size();
            _alloc_pos += 2 + kvp->key_size() + vs;
            auto nkvp = get_key_val_ptr_offset(_alloc_pos);
            nkvp->set_key(kvp->key());
            nkvp->_val_size = vs;
            up.val.place_into(nkvp->val_ptr(), vs);
            vh[idx]      = value_header_hash(value_hash(nkvp->value()));
            ko[idx].pos  = _alloc_pos;
            ko[idx].type = up.val.is_object_id();
         }
      }
      assert(spare_capacity() >= 0);
      // TODO:  make sure all code that updates inline value() also
      // updates the value_hash field
   }

   /**
    *  Called to update a particular key with a new value that is of
    *  a different size or type that required growth and/or we needed
    *  to clone a shared state to make it unique anyway.
    *
    *  Rather than copying the data from src as quickly as possible,
    *  which would copy dead space, we will copy it in-order creating
    *  a new compact node that has the updated value in the right spot.
    */
   inline binary_node::binary_node(int_fast16_t        asize,
                                   fast_meta_address   nid,
                                   const binary_node*  src,
                                   const clone_config& cfg,
                                   const clone_remove& rem)
       : node_header(asize, nid, node_type::binary, src->num_branches() - 1), _alloc_pos(0)
   {
      assert(asize <= binary_node_max_size);
      assert(alloc_size(src, cfg, rem) <= asize);
      _branch_cap = min_branch_cap(src->num_branches()-1); //round_up_multiple<64>(bcap * 4) / 4;
      _branch_id_region = src->_branch_id_region;

      auto kh  = key_hashes();
      auto ko  = key_offsets();
      auto vh  = value_hashes();
      auto skh = src->key_hashes();
      auto sko = src->key_offsets();
      auto svh = src->value_hashes();

      memcpy(kh, skh, num_branches());

      const auto nb = src->num_branches();

      int ci = 0;  // clone index
      int i  = 0;  // src index

      auto copy_key = [&]()
      {
         auto kvp = src->get_key_val_ptr(i);
         auto ts  = kvp->total_size();
         _alloc_pos += ts;
         auto nkvp = get_key_val_ptr_offset(_alloc_pos);
         memcpy(nkvp, kvp, ts);
         kh[ci]      = skh[i];
         ko[ci].type = sko[i].type;
         ko[ci].pos  = _alloc_pos;
         vh[ci]      = svh[i];
         ++ci;
      };

      for (; i < rem.idx; ++i)
         copy_key();

      for (++i; i < nb; ++i)
         copy_key();

      assert(spare_capacity() >= 0);

      if constexpr ( debug_memory ) {
         for( int i = 0; i < src->num_branches(); ++i ) {
            if( i != rem.idx ) {
               auto k = src->get_key_val_ptr(i)->key();
               assert( get_key_val_ptr( find_key_idx(k) )->key() == k );
            }
         }
      }
   }

   /**
    *  Used by compactor to optimize the order keys are searched in memory
    *  so that the top of the binary search tree comes before the bottom 
    *  and the top is close to header.
    */
   inline void copy_binary_node( binary_node* ptr, const binary_node* src) {
      memcpy( ptr, src, sizeof(binary_node) );
      memcpy( ptr->key_hashes(), src->key_hashes(), ptr->_num_branches );
      memcpy( ptr->value_hashes(), src->value_hashes(), ptr->_num_branches );
      ptr->_alloc_pos = 0;
      ptr->_dead_space = 0;
      auto sko = src->key_offsets();
      auto ko  = ptr->key_offsets();
      auto nb = src->_num_branches;

      const uint8_t* seq = search_seq_table.data() + ((nb - 1) * nb) / 2;
      for( int i = 0; i < nb; ++i ) {
         int idx  = seq[i];
         auto kvp = src->get_key_val_ptr(idx);
         auto ts  = kvp->total_size();
         ptr->_alloc_pos += ts;
         auto nkvp = ptr->get_key_val_ptr_offset(ptr->_alloc_pos);
         memcpy(nkvp, kvp, ts);

         ko[idx].type = sko[idx].type;
         ko[idx].pos  = ptr->_alloc_pos;
      }
      assert(src->validate());
      assert(ptr->validate());
      if( src->has_checksum() )
         ptr->update_checksum();
   }
   /**
    *  Called to allcoate a new binary node while adding
    *  an new key/value pair and removing any dead space
    */
   inline binary_node::binary_node(int_fast16_t        asize,
                                   fast_meta_address   nid,
                                   const binary_node*  src,
                                   const clone_config& cfg,
                                   const clone_insert& ins)
       : node_header(asize, nid, node_type::binary, src->num_branches()), 
         _alloc_pos(0),_dead_space(0)
   {
      assert(not cfg.set_prefix);
      assert(alloc_size(src, cfg, ins) <= asize);
      _branch_id_region = src->_branch_id_region;

      _branch_cap = min_branch_cap( std::max<int>(cfg.branch_cap, src->num_branches() + 1) );
      assert( _nsize >= alloc_size( _branch_cap, src->key_val_section_size() + calc_key_val_pair_size( ins.key, ins.val) ) );

      const auto lb     = ins.lb_idx;
      const auto lb1    = lb + 1;
      const auto remain = src->num_branches() - lb;

      memcpy(key_hashes(), src->key_hashes(), lb);
      memcpy(value_hashes(), src->value_hashes(), lb);

      memcpy(key_hashes() + lb1, src->key_hashes() + lb, remain);
      memcpy(value_hashes() + lb1, src->value_hashes() + lb, remain);

      auto sko = src->key_offsets();
      auto ko  = key_offsets();
      auto nb = src->_num_branches + 1;

      /**
       *  Copy the keys so they are sorted in the order of binary
       *  search which should cause searches to traverse the data
       *  in a linear manner.
       */
      const uint8_t* seq = search_seq_table.data() + ((nb - 1) * nb) / 2;
      for( int i = 0; i < nb; ++i ) {
         int idx  = seq[i];
         if( idx == lb ) [[unlikely]] {
            auto ts = calc_key_val_pair_size(ins.key, ins.val);
            auto* kvp = get_key_val_ptr_offset(_alloc_pos += ts);
            kvp->set_key(ins.key);

            key_hashes()[lb]   = key_header_hash(key_hash(ins.key));

            ko[idx].pos  = _alloc_pos;
            if ( ins.val.is_object_id() )
            {
               ko[idx].type = key_index::obj_id;
               kvp->_val_size  = sizeof(id_address);
               kvp->value_id() = ins.val.id().to_address();
               value_hashes()[lb] = value_header_hash(value_hash(ins.val.id()));
            }
            else
            {
               ko[idx].type = key_index::inline_data;
               const auto& vv = ins.val.view();
               kvp->_val_size = vv.size();
               memcpy(kvp->val_ptr(), vv.data(), vv.size());
               value_hashes()[lb] = value_header_hash(value_hash(vv));
            }
         }
         else 
         {
            auto sidx = idx - (idx > lb);
            const auto* skvp = src->get_key_val_ptr(sidx);
            ko[idx].type = sko[sidx].type;

            auto ts  = skvp->total_size();
            auto* kvp = get_key_val_ptr_offset(_alloc_pos += ts);
            memcpy(kvp, skvp, ts);
            ko[idx].pos  = _alloc_pos;
         }
      }

      ++_num_branches; 

      if constexpr ( debug_memory ) {
         assert( get_key_val_ptr( find_key_idx(ins.key) )->key() == ins.key );
         for( int i = 0; i < src->num_branches(); ++i ) {
            auto k = src->get_key_val_ptr(i)->key();
            assert( get_key_val_ptr( find_key_idx(k) )->key() == k );
         }
      }
      assert(validate());
   }

   // used by clone_binary_range to insert key/val pairs
   inline void binary_node::append(const binary_node::key_val_pair* kvp,
                                   int                              minus_prefix,
                                   uint8_t                          khash,
                                   uint8_t                          vhash,
                                   key_index::value_type            t)
   {
      auto kvps = kvp->total_size() - minus_prefix;
      assert(spare_capacity() >= kvps);
      assert(_branch_cap - _num_branches >= 0);

      _alloc_pos += kvps;

      key_index kidx;
      kidx.pos  = _alloc_pos;
      kidx.type = t;

      auto nkvp       = (key_val_pair*)(tail() - _alloc_pos);
      nkvp->_key_size = kvp->key_size() - minus_prefix;
      nkvp->_val_size = kvp->_val_size;

      memcpy(nkvp->key_ptr(), kvp->key_ptr() + minus_prefix, kvps - sizeof(key_val_pair));
      assert(nkvp->key_ptr() + (kvps - sizeof(key_val_pair)) <= (uint8_t*)tail());
      auto b = _num_branches;

      key_offsets()[b]  = kidx;
      key_hashes()[b]   = khash;
      value_hashes()[b] = vhash;
      ++_num_branches;
   }

   inline void binary_node::reserve_branch_cap(short min_children)
   {
      assert( min_children >= num_branches() );
      if( min_children <= _branch_cap ) 
         return;
      auto new_cap = min_branch_cap( min_children );

      assert( new_cap > _branch_cap and
              new_cap >= min_children );

      auto old_kh = key_hashes();
      auto old_ko = key_offsets();
      auto old_vh = value_hashes();
      _branch_cap = new_cap;
      auto new_kh = key_hashes();
      auto new_ko = key_offsets();
      auto new_vh = value_hashes();

      memmove(new_vh, old_vh, num_branches());
      memmove(new_ko, old_ko, sizeof(key_index) * num_branches());
      //memmove(new_kh, old_kh, num_branches());

      assert( new_kh == old_kh );
      assert((char*)new_ko + sizeof(key_index) * num_branches() <= tail());
      assert((char*)new_vh + num_branches() <= tail());
      assert((char*)new_kh + num_branches() <= tail());
   }

   inline bool binary_node::can_reinsert( const key_view& key, const value_type& val )const {
      auto kvs = calc_key_val_pair_size(key, val);
      return kvs <= spare_capacity();
   }

   inline void binary_node::reinsert( int lbx, key_view key, const value_type& val )
   {
      assert( get_key_val_ptr(lbx)->key() == key );
      assert( can_reinsert( key, val ) );
      auto kvs = calc_key_val_pair_size(key, val);

      assert( kvs <= spare_capacity() );

      _alloc_pos += kvs;
      auto ko = key_offsets();
      ko[lbx].pos = _alloc_pos;
      auto kvp = get_key_val_ptr(lbx);
      kvp->set_key(key);
      if( val.is_object_id() ) {
         kvp->_val_size  = sizeof(id_address);
         kvp->value_id() = val.id().to_address();
         ko[lbx].type= key_index::obj_id;
      }
      else {
         auto vv = val.view();
         kvp->_val_size = vv.size();
         memcpy(kvp->val_ptr(), vv.data(), vv.size());
         ko[lbx].type= key_index::inline_data;
      }
      assert( validate() );
   }

   inline void binary_node::insert(int lbx, key_view key, const value_type& val)
   {
      assert(get_type() == node_type::binary);
      assert(can_insert(key, val));

      auto kvs = calc_key_val_pair_size(key, val);

      reserve_branch_cap( num_branches() + 1 );

     // TRIEDENT_DEBUG( "spare cap: ", spare_capacity(), " bcap: ", _branch_cap, " kvs: ", kvs,
      //                " sai: ", size_after_insert(kvs), "  nsize: ", _nsize, 
       //               " asize: ", _alloc_pos, " data_cap: ", data_capacity() );

      assert( kvs <= spare_capacity() );

      _alloc_pos += kvs;
      auto kvp       = get_key_val_ptr_offset(_alloc_pos);
      kvp->set_key( key );

      key_index kidx;
      kidx.pos  = _alloc_pos;
      kidx.type = (key_index::value_type)val.is_object_id();

      if (kidx.type )
      {
         kvp->_val_size  = sizeof(id_address);
         kvp->value_id() = val.id().to_address();
      }
      else
      {
         auto vv = val.view();
         kvp->_val_size = vv.size();
         memcpy(kvp->val_ptr(), vv.data(), vv.size());
      }
      assert( kvp->total_size() == kvs );

      const auto kh = key_hash(key);
      const auto vh = value_hash(kvp->value());

      const auto lb     = lbx;  
      const auto lb1    = lb + 1;
      const auto remain = num_branches() - lb;

      auto vhp = value_hashes();
      auto kop = key_offsets();
      auto khp = key_hashes();

      memmove(vhp + lb1, vhp + lb, remain);
      memmove(kop + lb1, kop + lb, remain * sizeof(key_index));
      memmove(khp + lb1, khp + lb, remain);

      key_hashes()[lb]   = key_header_hash(kh);
      key_offsets()[lb]  = kidx;
      value_hashes()[lb] = value_header_hash(vh);

      ++_num_branches;

      assert( find_key_idx( key, key_hash(key) ) >= 0 );
      assert(get_key_val_ptr(lb)->key() == key);
      assert(tail() - _alloc_pos >= (char*)end_value_hashes());
      assert(khp + lb1 + remain <= (uint8_t*)tail());
      assert(((char*)kop) + lb1 + (sizeof(key_index) * remain) <= tail());
      assert(vhp + lb1 + remain <= (uint8_t*)tail());
      assert( spare_capacity() >= 0 );
      assert( validate() );
   }

}  // namespace arbtrie
