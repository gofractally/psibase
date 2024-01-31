#pragma once
#include <arbtrie/debug.hpp>
#undef NDEBUG
#include <assert.h>

namespace arbtrie
{

   /**
     * Always a multiple of 64, aka the typical cache line size
     */
   inline int binary_node::alloc_size(const clone_config& cfg)
   {
      return round_up_multiple<64>(sizeof(binary_node)) +
             round_up_multiple<64>(cfg.branch_cap * 4) + round_up_multiple<64>(cfg.data_cap);
   }

   inline int binary_node::alloc_size(const binary_node* src, const clone_config& cfg)
   {
      auto bcap = std::max<int>( cfg.branch_cap, src->num_branches() );
      auto dcap = std::max<int>( cfg.data_cap, src->key_val_section_size() );
      return round_up_multiple<64>(sizeof(binary_node)) +
             round_up_multiple<64>(bcap * 4) + round_up_multiple<64>(dcap);
   }

   inline int binary_node::alloc_size(const binary_node*  src,
                                      const clone_config& cfg,
                                      const clone_insert& ins)
   {
      auto bcap = std::max<int>( cfg.branch_cap, src->num_branches()+1 );
      auto dcap = std::max<int>( cfg.data_cap, src->key_val_section_size() );
      dcap += calc_key_val_pair_size( ins.key, ins.val );

      return round_up_multiple<64>(sizeof(binary_node) +
             round_up_multiple<64>(bcap * 4) + dcap);
   }
   inline int binary_node::alloc_size(const binary_node*  src,
                                      const clone_config& cfg,
                                      const clone_update& ins)
   {
      auto bcap = std::max<int>( cfg.branch_cap, src->num_branches() );
      auto dcap = std::max<int>( cfg.data_cap, src->key_val_section_size() );
      dcap += ins.val.size();

      return round_up_multiple<64>(sizeof(binary_node)) +
             round_up_multiple<64>(bcap * 4) + round_up_multiple<64>(dcap);
   }
   inline int binary_node::alloc_size(const binary_node*  src,
                                      const clone_config& cfg,
                                      const clone_remove& rem)
   {
      auto v = src->get_key_val_ptr(rem.idx);
      auto bcap = std::max<int>( cfg.branch_cap, src->num_branches() - 1);
      auto dcap = std::max<int>( cfg.data_cap, src->key_val_section_size() - v->total_size() );

      return round_up_multiple<64>(sizeof(binary_node)) +
             round_up_multiple<64>(bcap * 4) + round_up_multiple<64>(dcap);
   }

   inline binary_node::binary_node(int_fast16_t        asize,
                                   fast_meta_address   nid,
                                   const clone_config& cfg)
       : node_header(asize, nid, node_type::binary), _alloc_pos(0)
   {
      assert(asize <= 4096 );
      _branch_cap = round_up_multiple<64>(4*cfg.branch_cap)/4;
   }

   inline binary_node::binary_node(int_fast16_t        asize,
                                   fast_meta_address   nid,
                                   const binary_node*  src,
                                   const clone_config& cfg)
       : node_header(asize, nid, node_type::binary, src->num_branches()),
         _alloc_pos(src->_alloc_pos)
   {
      assert(asize <= 4096 );
      assert(not cfg.set_prefix);
      assert(alloc_size(src, cfg) <= asize);

      auto bcap = std::max<int>( cfg.branch_cap, src->num_branches() );
      _branch_cap = round_up_multiple<64>(bcap*4)/4;

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
      assert(asize <= 4096 );
      assert(alloc_size(src, cfg, up) <= asize);
      _branch_cap = src->_branch_cap;

      auto kh  = key_hashes();
      auto ko  = key_offsets();
      auto vh  = value_hashes();
      auto skh = src->key_hashes();
      auto sko = src->key_offsets();
      auto svh = src->value_hashes();

      memcpy(kh, skh, num_branches());

      const auto nb = src->num_branches();
      for (int i = 0; i < nb; ++i)
      {
         auto kvp = src->get_key_val_ptr(i);
         if (i != up.idx)
         {
            auto ts = kvp->total_size();
            _alloc_pos += ts;
            auto nkvp = get_key_val_ptr_offset(_alloc_pos);
            memcpy(nkvp, kvp, ts);
            ko[i].type = sko[i].type;
            ko[i].pos  = _alloc_pos;
            vh[i]      = svh[i];
         }
         else
         {
            auto vs = up.val.size();
            _alloc_pos += 2 + kvp->key_size() + vs;
            auto nkvp = get_key_val_ptr_offset(_alloc_pos);
            nkvp->set_key(kvp->key());
            nkvp->_val_size = vs;
            up.val.place_into(nkvp->val_ptr(), vs);
            vh[i]      = value_header_hash(value_hash(nkvp->value()));
            ko[i].pos  = _alloc_pos;
            ko[i].type = up.val.is_object_id();
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
       : node_header(asize, nid, node_type::binary, src->num_branches()-1), _alloc_pos(0)
   {
      assert(asize <= 4096 );
      assert(alloc_size(src, cfg, rem) <= asize);
      _branch_cap = src->_branch_cap;

      auto kh  = key_hashes();
      auto ko  = key_offsets();
      auto vh  = value_hashes();
      auto skh = src->key_hashes();
      auto sko = src->key_offsets();
      auto svh = src->value_hashes();

      memcpy(kh, skh, num_branches());

      const auto nb = src->num_branches();

      int ci = 0; // clone index
      int i  = 0; // src index

      auto copy_key = [&](){
         auto kvp = src->get_key_val_ptr(i);
         auto ts = kvp->total_size();
         _alloc_pos += ts;
         auto nkvp = get_key_val_ptr_offset(_alloc_pos);
         memcpy(nkvp, kvp, ts);
         ko[ci].type = sko[i].type;
         ko[ci].pos  = _alloc_pos;
         vh[ci]      = svh[i];
         ++ci;
      };

      for (; i < rem.idx; ++i)
         copy_key();

      for( ++i; i < nb; ++i ) 
         copy_key();

      assert(spare_capacity() >= 0);
   }

   /**
    *  Called to allcoate a new binary node while adding
    *  an new key/value pair
    */
   inline binary_node::binary_node(int_fast16_t        asize,
                                   fast_meta_address   nid,
                                   const binary_node*  src,
                                   const clone_config& cfg,
                                   const clone_insert& ins)
       : node_header(asize, nid, node_type::binary, src->num_branches()),
         _alloc_pos(src->_alloc_pos)
   {
      assert(not cfg.set_prefix );
      assert(alloc_size(src, cfg, ins) <= asize);

      // copy existing key/values
      auto kvss = key_val_section_size();
      memcpy(tail() - kvss, src->tail() - kvss, kvss);

      auto bcap = std::max<int>( cfg.branch_cap, src->num_branches()+1 );
      _branch_cap = round_up_multiple<16>(bcap);
      //_branch_cap = round_up_multiple<32>(src->num_branches() + cfg.branch_cap);
      //     TRIEDENT_WARN("CLONE ADD!!! src kv section size ", src->key_val_section_size(),
      //                  " cfg.spareb: ", cfg.branch_cap, " nbranch: ", src->num_branches(),
      //                 " nbc: ", int(_branch_cap) );

      auto kvs = calc_key_val_pair_size(ins.key, ins.val);
      // allocate new key/value
      _alloc_pos += kvs;
      assert(_alloc_pos <= 4096);
      assert(spare_capacity() >= 0);
      auto kvp       = get_key_val_ptr_offset(_alloc_pos);
      kvp->_key_size = ins.key.size();
      memcpy(kvp->key_ptr(), ins.key.data(), ins.key.size());

      key_index kidx;
      kidx.pos = _alloc_pos;

      if (ins.val.is_object_id())
      {
         kidx.type       = key_index::obj_id;
         kvp->_val_size  = sizeof(object_id);
         kvp->value_id() = ins.val.id().to_address();
      }
      else
      {
         const auto& vv = ins.val.view();
         kvp->_val_size = vv.size();
         memcpy(kvp->val_ptr(), vv.data(), vv.size());
      }

      // locate where to insert the new key
      auto kh = key_hash(ins.key);
      auto vh = ins.val.visit([](auto&& v) { return value_hash(v); });  //ins.val);

      const auto lb     = ins.lb_idx;
      const auto lb1    = lb + 1;
      const auto remain = src->num_branches() - lb;

      memcpy(key_hashes(), src->key_hashes(), lb);
      memcpy(key_offsets(), src->key_offsets(), lb * sizeof(key_index));
      memcpy(value_hashes(), src->value_hashes(), lb);

      memcpy(key_hashes() + lb1, src->key_hashes() + lb, remain);
      memcpy(key_offsets() + lb1, src->key_offsets() + lb, remain * sizeof(key_index));
      memcpy(value_hashes() + lb1, src->value_hashes() + lb, remain);

      //     TRIEDENT_DEBUG( "CA KH: ", int(key_header_hash(kh)) );
      key_hashes()[lb]   = key_header_hash(kh);
      key_offsets()[lb]  = kidx;
      value_hashes()[lb] = value_header_hash(vh);

      ++_num_branches;  // key_hashes(), key_offsets(), etc depend upon this
      assert(get_type() == node_type::binary);
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
      assert(_branch_cap - _num_branches > 0);

      _alloc_pos += kvps;

      key_index kidx;
      kidx.pos  = _alloc_pos;
      kidx.type = t;

      auto nkvp       = (key_val_pair*)(tail() - _alloc_pos);
      nkvp->_key_size = kvp->key_size() - minus_prefix;
      nkvp->_val_size = kvp->_val_size;

      memcpy(nkvp->key_ptr(), kvp->key_ptr() + minus_prefix, kvps - sizeof(key_val_pair));
      assert( nkvp->key_ptr() + (kvps-sizeof(key_val_pair)) <= (uint8_t*)tail() );
      auto b = _num_branches;

      key_offsets()[b]  = kidx;
      key_hashes()[b]   = khash;
      value_hashes()[b] = vhash;
      ++_num_branches;
   }

   inline void binary_node::raise_branch_cap(short new_cap)
   {
      assert(new_cap > _branch_cap);

      auto old_kh = key_hashes();
      auto old_ko = key_offsets();
      auto old_vh = value_hashes();
      _branch_cap = new_cap;
      auto new_kh = key_hashes();
      auto new_ko = key_offsets();
      auto new_vh = value_hashes();

      memmove(new_vh, old_vh, num_branches());
      memmove(new_ko, old_ko, sizeof(key_index) * num_branches());
      memmove(new_kh, old_kh, num_branches());

      assert( (char*)new_ko + sizeof(key_index) * num_branches() <= tail() );
      assert( (char*)new_vh + num_branches() <= tail() );
      assert( (char*)new_kh + num_branches() <= tail() );
   }

   inline void binary_node::insert(int lbx, key_view key, const value_type& val)
   {
      assert(get_type() == node_type::binary);

      //assert(num_branches() < _branch_cap);

      assert(can_insert(key, val));
      // TODO:
      //   the data we need to prefetch includes:
      //   the key idx used for lower-bound search
      //   the key/value header hashes that we have to move
      //   once the lower bound is found....

      auto kvs = calc_key_val_pair_size(key, val);

      if (num_branches() == _branch_cap)
         raise_branch_cap(_branch_cap + 8);
      //  if( num_branches() >= _branch_cap )
      //     _branch_cap= num_branches() + 2;

      _alloc_pos += kvs;
      auto kvp       = get_key_val_ptr_offset(_alloc_pos);
      kvp->_key_size = key.size();
      memcpy(kvp->key_ptr(), key.data(), key.size());

      key_index kidx;
      kidx.pos = _alloc_pos;

      if (val.is_object_id())
      {
         kvp->_val_size  = sizeof(object_id);
         kvp->value_id() = val.id().to_address();
         kidx.type       = key_index::obj_id;
      }
      else
      {
         auto vv = val.view();
         assert(vv.size() < max_inline_value_size);
         kvp->_val_size = vv.size();
         memcpy(kvp->val_ptr(), vv.data(), vv.size());
      }

      const auto kh = key_hash(key);
      const auto vh = value_hash(kvp->value());

      const auto lb     = lbx;  //, lower_bound_idx(key);
      const auto lb1    = lb + 1;
      const auto remain = num_branches() - lb;

      auto vhp = value_hashes();
      auto kop = key_offsets();
      auto khp = key_hashes();

      memmove(vhp + lb1, vhp + lb, remain);
      memmove(kop + lb1, kop + lb, remain * sizeof(key_index));
      memmove(khp + lb1, khp + lb, remain);

      //   TRIEDENT_DEBUG( "INSERT KH: ", int(key_header_hash(kh)) );
      key_hashes()[lb]   = key_header_hash(kh);
      key_offsets()[lb]  = kidx;
      value_hashes()[lb] = value_header_hash(vh);

      ++_num_branches;

      assert(get_key_val_ptr(lb)->key() == key);
      assert(tail() - _alloc_pos >= (char*)end_value_hashes());
      assert( khp + lb1 + remain <= (uint8_t*)tail() );
      assert( ((char*)kop) + lb1 + (sizeof(key_index)*remain) <= tail() );
      assert( vhp + lb1 + remain <= (uint8_t*)tail() );
   }



}  // namespace arbtrie
