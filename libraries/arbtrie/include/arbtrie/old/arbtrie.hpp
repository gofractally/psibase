#pragma once
#include <cassert>
#include <string_view>

namespace triedent
{

   struct node_header;

   struct id_type
   {
      static const uint64_t tombstone = (1ull << 40) - 1;
      static const uint64_t null_id   = 0;
      //uint64_t              value : 40;
      node_header* value;

      //      id_type(uint64_t v) : value((node_header*)v) {}
      id_type(node_header* v) : value(v) {}

      operator const node_header*() const { return value; }
      operator node_header*() const { return value; }
      explicit     operator bool() const { return valid(); }
      node_header* operator->() const { return value; }

      bool valid() const { return !is_null() and !is_tombstone(); }
      bool is_tombstone() const { return (uint64_t)value == tombstone; }
      bool is_null() const { return (uint64_t)value == null_id; }

      id_type& operator=(node_header* n)
      {
         value = n;
         return *this;
      }
   } __attribute((packed)) __attribute((aligned(1)));

   struct node_location
   {
     private:
      uint64_t offset;
   };

   enum node_type
   {
      unknown,  // not initialized/invalid
      binary,   // binary search
      setlist,  // list of branches
      index,    // 256 index buffer to id_type
      radix,    // 256 full id_type
      value,    // just the data, no key
      merge     // delta applied to existing node
   };

   struct node_meta
   {
      static const uint32_t ref_count_bits = 15;
      uint64_t              _ref : 16;
      uint64_t              _type : 4;
      uint64_t              _location : 44;  // * 16 = 256 TB addressable
   };

   struct node_header
   {  // aka object_header
      uint32_t checksum;
      uint32_t type : 4;   // node_type
      uint32_t size : 28;  // up to 256MB
      // size might not be a multiple of 8, next object is at data() + (size+7)&-8
      uint64_t branches : 9;      // number of id_nodes that link from this one
      uint64_t has_value : 1;     // whether this node has a value node linked to it
      uint64_t cprefix_len : 14;  // common prefix length all keys share
      uint64_t id : 40;

      template <typename T>
      T& as()
      {
         assert(type == T::type);
         return *((T*)(this + 1));
      }
      template <typename T>
      const T& as() const
      {
         assert(type == T::type);
         return *((const T*)(this + 1));
      }
      char*       data() { return ((char*)(this + 1)); }
      char*       end() { return data() + size; }
      const char* data() const { return ((const char*)(this + 1)); }
      const char* end() const { return data() + size; }

      node_type get_type() const { return node_type(type); }
      void      set_prefix_size(uint16_t s) { cprefix_len = s; }
      uint16_t  get_prefix_size() const { return cprefix_len; }
      uint32_t  node_size() const { return size + sizeof(node_header); }
      node_header(uint32_t s, node_type t) : size(s), type(t) {}
   } __attribute((packed));
   static_assert(sizeof(node_header) == 16);

   void print(const node_header* nh, int depth = 0);

   struct flat_string
   {
      uint16_t    size() const { return len; }
      char*       data() { return ((char*)(this)) + sizeof(*this); }
      const char* data() const { return ((const char*)(this)) + sizeof(*this); }

      std::string_view str() const { return std::string_view(data(), len); }
      operator std::string_view() const { return str(); }

      flat_string* next() { return (flat_string*)(data() + len); }

      static uint32_t alloc_size(std::string_view src) { return sizeof(flat_string) + src.size(); }

      // assumes in place construction with alloc_size(d) bytes
      flat_string(std::string_view d) : len(d.size()) { memcpy(data(), d.data(), len); }
      uint8_t len;
   } __attribute__((packed)) __attribute((aligned(1)));

   template <typename T>
   struct offset_ptr
   {
      T*       get() { return (T*)((char*)this + _offset); }
      const T* get() const { return (const T*)((const char*)this + _offset); }
      const T* operator->() { return get(); }
      const T* operator->() const { return get(); }
      T&       operator*() { return *get(); }
      const T& operator*() const { return *get(); }

      auto& operator=(T* v)
      {
         _offset = (char*)v - (char*)this;
         return *this;
      }
      uint16_t _offset = 0;
   };

   struct value_node
   {
      static const node_type type = node_type::value;
      node_header*           header() { return ((node_header*)this) - 1; }
      const node_header*     header() const { return ((const node_header*)this) - 1; }
      char*                  data() { return header()->data(); }
      const char*            data() const { return header()->data(); }
      uint32_t               size() const { return header()->size; }
      std::string_view       value() const { return std::string_view(data(), size()); }

      inline static value_node* make(std::string_view v)
      {
         auto nh = new (malloc(sizeof(node_header) + v.size())) node_header(v.size(), type);
         memcpy(nh->data(), v.data(), v.size());
         return (value_node*)nh->data();
      }

      operator const node_header*() const { return header(); }
      operator node_header*() { return header(); }
   };

   struct art_node
   {
      node_header*       header() { return ((node_header*)this) - 1; }
      const node_header* header() const { return ((const node_header*)this) - 1; }
      uint16_t           num_keys() const { return header()->branches; }
      void               set_num_keys(uint16_t v) { header()->branches = v; }
      uint16_t           get_prefix_size() const { return header()->get_prefix_size(); }
      bool               has_value()const{ return header()->has_value; }

      operator const node_header*() const { return header(); }
      operator node_header*() { return header(); }
   };

   /**
    * The setlist_node has the following layout:
    *
    * Layout:
    *   header
    *   char prefix[get_prefix_size()]
    *   char setlist[num_keys()]
    *   id_type ids[num_keys()]
    *   id_type value (if has_value() )
    */
   struct setlist_node : public art_node
   {
      static const node_type type = node_type::setlist;
      operator const node_header*() const { return header(); }
      operator node_header*() { return header(); }

      char*            get_prefix_ptr() { return (char*)(this); }
      const char*      get_prefix_ptr() const { return (char*)(this); }
      std::string_view get_prefix() const
      {
         return std::string_view(get_prefix_ptr(), get_prefix_size());
      }
      std::string_view get_setlist() const { return std::string_view(keys(), num_keys()); }

      id_type* find(char v)
      {
         auto pos = get_setlist().find(v);
         if (pos != std::string::npos)
            return ids() + pos;
         return nullptr;
      }

      char*       keys() { return ((char*)(this)) + get_prefix_size(); }
      const char* keys() const { return ((const char*)(this)) + get_prefix_size(); }

      id_type* ids() { return (id_type*)(((char*)(this)) + get_prefix_size() + num_keys()); }

      const id_type* ids() const
      {
         return (const id_type*)(((const char*)(this)) + get_prefix_size() + num_keys());
      }

      id_type* value()
      {
         if (header()->has_value)
            return ids() + num_keys();
         return nullptr;
      }
      const id_type* value() const
      {
         if (header()->has_value)
            return ids() + num_keys();
         return nullptr;
      }

      inline static setlist_node* make(uint32_t         num_branch,
                                       std::string_view prefix,
                                       bool             has_val = false)
      {
         uint32_t asize = sizeof(node_header) + prefix.size() + num_branch +
                          (num_branch + has_val) * sizeof(id_type);
         auto header = new (malloc(asize)) node_header(asize - sizeof(node_header), type);
         return new (header->data()) setlist_node(num_branch, prefix, has_val);
      }
      inline static node_header* clone_add(setlist_node&    in,
                                        char             br,
                                        std::string_view key,
                                        std::string_view val);

      setlist_node(uint32_t num_branch, std::string_view prefix, bool has_val)
      {
         set_num_keys(num_branch);
         header()->set_prefix_size(prefix.size());
         header()->has_value = has_val;
         memcpy(get_prefix_ptr(), prefix.data(), prefix.size());
      }
   };

   /**
    * The following layout was chosen to provide
    *   constant time index into keys for rapid binary search
    *   keep the branch pointers at the end to minimize cpu cache misses,
    *   the first 11 keys (assuming single byte) fit in the first 64 bytes
    *
    *
    * Layout:
    *   header
    *   uint16_t    ids_offset;
    *   char        prefix[header.cprefix_len] 
    *   offsets     off[header.prelen + header.has_value] 
    *   flat_string keys[header.prelen]
    *   id_type     branches[header.prelen + header.has_value]
    *   char        unused[free_space]
    */
   struct binary_node : public art_node
   {
      static const node_type type = node_type::binary;

      uint16_t ids_offset;

      std::string_view get_key(int i) { return keys()[i]->str(); }
      id_type          get_val(int i) { return ids()[i]; }
      std::string_view get_key(int i) const { return keys()[i]->str(); }
      id_type          get_val(int i) const { return ids()[i]; }

      char*            get_prefix_ptr() { return (char*)(this + 1); }
      const char*      get_prefix_ptr() const { return (char*)(this + 1); }
      std::string_view get_prefix() const
      {
         return std::string_view(get_prefix_ptr(), get_prefix_size());
      }
      offset_ptr<flat_string>* keys()
      {
         return (offset_ptr<flat_string>*)(get_prefix_ptr() + get_prefix_size());
      }
      const offset_ptr<flat_string>* keys() const
      {
         return (const offset_ptr<flat_string>*)(get_prefix_ptr() + get_prefix_size());
      }
      flat_string*   start_keys() { return (flat_string*)(keys() + num_keys()); }
      id_type*       ids() { return (id_type*)(((char*)(this + 1)) + ids_offset); }
      const id_type* ids() const { return (id_type*)(((const char*)(this + 1)) + ids_offset); }
      /*
      id_type*       value()
      {
         if (not header()->has_value)
            return nullptr;
         return ids() + num_keys();
      }
      const id_type* value() const
      {
         if (not header()->has_value)
            return nullptr;
         return ids() + num_keys();
      }
      */

      static uint32_t alloc_size(std::string_view                        cpre,
                                 std::initializer_list<std::string_view> list )
      {
         uint32_t s = sizeof(node_header) + sizeof(binary_node) + cpre.size() +
                      list.size() * (sizeof(id_type) + sizeof(offset_ptr<flat_string>));
         for (auto elm : list)
            s += flat_string::alloc_size(elm);
         return s;
      }

      // make a new binary node that has val assiged to cpre and key/value as members
      static binary_node* make(std::string_view cpre, std::string_view key, id_type key_val)
      {
         //std::cerr << "binary make: cpre: " <<cpre <<"  key: " << key << " \n";
         auto asize = alloc_size(cpre, {key});
         auto ptr   = malloc(asize);
         auto nh    = new (ptr) node_header(asize - sizeof(node_header), type);
         auto bn = new (nh->data()) binary_node(cpre, key, key_val);
         return bn;
      }

      static binary_node* clone_add(binary_node& in, std::string_view key, id_type val)
      {
         auto asize = in.header()->node_size() + flat_string::alloc_size(key) + sizeof(val) +
                      sizeof(offset_ptr<flat_string>);
         auto ptr = malloc(asize);
         auto nh  = new (ptr) node_header(asize - sizeof(node_header), type);
         return new (nh->data()) binary_node(in, key, val, true);
      }

      /**
       *  Creates a new binary_node with keys [from,to) minus the cpre
       *  assumes the first character of the cpre is also known by the
       *  parent.
       */
      static binary_node* clone_range(binary_node& in, std::string_view cpre, int from, int to)
      {
         int  num_keys = to - from;
         bool has_val  = in.get_key(from) == cpre;
         num_keys -= has_val;

         auto asize = sizeof(node_header) + sizeof(binary_node) + cpre.size() - 1 +
                      num_keys * (sizeof(id_type) + sizeof(offset_ptr<flat_string>)) +
                      sizeof(id_type) * has_val;

         auto key_alloc_size = 0;
         for (auto i = from + has_val; i < to; ++i)
         {
            key_alloc_size += flat_string::alloc_size(in.get_key(i));
         }
         key_alloc_size -= num_keys * cpre.size();
         asize += key_alloc_size;

         auto ptr = malloc(asize);
         auto nh  = new (ptr) node_header(asize - sizeof(node_header), type);

         return new (nh->data()) binary_node(in, cpre, from, to, has_val, key_alloc_size);
      }

      binary_node(binary_node&     in,
                  std::string_view cpre,
                  int              from,
                  int              to,
                  bool             has_val,
                  int              key_alloc_size)
      {
         header()->set_prefix_size(cpre.size() - 1);
         header()->has_value = has_val;
         set_num_keys(to - from - has_val);
         memcpy(get_prefix_ptr(), cpre.data() + 1, cpre.size() - 1);

         ids_offset =
             cpre.size() - 1 + num_keys() * sizeof(offset_ptr<flat_string>) + key_alloc_size;

         auto     kp      = start_keys();
         auto     op      = keys();
         id_type* vp      = ids();
         int      num_key = num_keys();

         for (int i = from + has_val; i < to; ++i)
         {
            *op = kp;
            ++op;
            kp  = (new (kp) flat_string(in.get_key(i).substr(cpre.size())))->next();
            *vp = in.ids()[i];
            ++vp;
         }
         if (has_val)
         {
            *vp = in.ids()[from];
            ++vp;
         }
         assert((char*)kp == (char*)ids());
      }

      binary_node(std::string_view cpre, std::string_view key, id_type val)
      {
         set_num_keys(1);
         header()->set_prefix_size(cpre.size());
         ids_offset = cpre.size() + num_keys() * sizeof(offset_ptr<flat_string>) +
                      flat_string::alloc_size(key);
         memcpy(get_prefix_ptr(), cpre.data(), cpre.size());
         keys()[0] = start_keys();
         ids()[0]  = val;
         new (start_keys()) flat_string(key);
      }

      /**
       *   offset[0] += 2
       *   offset[1] += 2
       *   offset[2] += 2
       *   .. new node 3 offset to the very end
       *   offset[4] start memcpy
       *   offset[5] 
       *   key[0] 
       *   key[1]
       *   key[2]
       *   key[4]
       *   key[5] end memcpy
       *   key[3] *new key inserted here*
       *   val[0] start memcpy
       *   val[1]
       *   val[2] end memcpy
       *   .. new val 3 insert here 
       *   val[4] start memcpy
       *   val[5] end memcpy
       */
      binary_node(binary_node& in, std::string_view key, id_type val, bool)
      {
         // binary search to find insert index
         int left  = -1;
         int right = in.num_keys();
         while (right - left > 1)
         {
            int middle = (left + right) >> 1;
            if (in.get_key(middle) < key)
               left = middle;
            else
               right = middle;
         }
         auto index = right;
         header()->set_prefix_size(in.get_prefix_size());
         memcpy(get_prefix_ptr(), in.get_prefix_ptr(), in.get_prefix_size());
         set_num_keys(in.num_keys() + 1);
         ids_offset =
             in.ids_offset + sizeof(offset_ptr<flat_string>) + flat_string::alloc_size(key);

         auto kitr    = keys();
         auto ikitr   = in.keys();
         auto kinsert = kitr + index;
         while (kitr != kinsert)
         {
            kitr->_offset = ikitr->_offset + 2;
            ++kitr;
            ++ikitr;
         }
         char* kpos = ((char*)(this + 1)) + in.ids_offset + 2;
         *kitr      = new (kpos) flat_string(key);

         ++kitr;
         memcpy(kitr, ikitr, (char*)in.ids() - (char*)ikitr);

         memcpy(ids(), in.ids(), index * sizeof(id_type));
         ids()[index] = val;
         memcpy(ids() + index + 1, in.ids() + index, (in.num_keys() - index) * sizeof(id_type));
      }

      // linear reconstruction, 50% slower than otherwise
      binary_node(binary_node& in, std::string_view key, id_type val)
      {
         set_num_keys(in.num_keys() + 1);
         ids_offset =
             in.ids_offset + sizeof(offset_ptr<flat_string>) + flat_string::alloc_size(key);

         auto      kp      = start_keys();
         auto      op      = keys();
         id_type*  vp      = ids();
         const int num_key = in.num_keys();
         for (int i = 0; i < num_key; ++i)
         {
            auto test = in.get_key(i);
            assert(test != key);
            if (test > key)
            {
               *op = kp;
               ++op;
               kp  = (new (kp) flat_string(key))->next();
               *vp = val;
               ++vp;
               for (; i < num_key; ++i)
               {
                  *op = kp;
                  ++op;
                  kp  = (new (kp) flat_string(in.get_key(i)))->next();
                  *vp = in.ids()[i];
                  ++vp;
               }
               return;
            }
            *op = kp;
            ++op;
            kp  = (new (kp) flat_string(test))->next();
            *vp = in.ids()[i];
            ++vp;
         }
         *op = kp;
         kp  = (new (kp) flat_string(key))->next();
         *vp = val;
      }
      /*
      static uint32_t alloc_size(const binary_node&                      in,
                                 std::initializer_list<std::string_view> list,
                                 bool                                    has_val = false)
                                 */
   };
   static_assert(sizeof(binary_node) == sizeof(uint16_t));

   inline int32_t binary_search(binary_node& in, char k)
   {
      int left  = -1;
      int right = in.num_keys();
      while (right - left > 1)
      {
         int middle = (left + right) >> 1;
         if (in.get_key(middle).front() < k)
            left = middle;
         else
            right = middle;
      }
      return right;
   }

   struct bnode_status
   {
      uint8_t  most_common       = 0;
      uint16_t most_common_count = 0;
      uint8_t  unique            = 0;
      uint8_t  freq_table[256];
      uint8_t  most_common_idx[256];
   };

   void calc_node_stats(binary_node& bn, bnode_status& stat)
   {
      memset(stat.freq_table, 0, sizeof(stat.freq_table));
      for (int i = 0; i < bn.num_keys(); ++i)
      {
         char first = bn.get_key(i).front();
         stat.unique += stat.freq_table[first] == 0;
         stat.freq_table[first]++;
      }
      for (uint32_t i = 0; i < sizeof(stat.freq_table); ++i)
      {
         if (stat.most_common_count < stat.freq_table[i])
         {
            stat.most_common_count = stat.freq_table[i];
            stat.most_common       = i;
         }
         stat.most_common_idx[i] = i;
      }
      std::sort(stat.most_common_idx, stat.most_common_idx + 256,
                [&](uint8_t a, uint8_t b) { return stat.freq_table[a] > stat.freq_table[b]; });
   }


   /**
    *  convert binary node into ART node by moving
    *  each range of child into a new binary node under
    *  the radix node
    */
   auto refactor(binary_node& root)
   {
      bnode_status stat;
      calc_node_stats(root, stat);

      auto clone_subrange = [&](uint8_t c)
      {
         auto from     = binary_search(root, c);
         auto num_keys = stat.freq_table[c];
         auto to       = from + num_keys;
         auto cpre     = root.get_key(from).substr(0,1);//common_prefix(root.get_key(from), root.get_key(to - 1));
         return binary_node::clone_range(root, cpre, from, to);
      };

      //  std::cout << "from: " << root.get_key(from) << " to " << root.get_key(to) << "\n";
      //  std::cout << "common prefix: '" << cpre << "'\n";

      auto  sl = setlist_node::make(stat.unique, root.get_prefix(), root.value());
      auto* kp = sl->keys();
      auto* ip = sl->ids();
      for (auto ft = stat.freq_table; ft != (stat.freq_table + 256); ++ft)
      {
         if (*ft)
         {
            auto idx = ft - stat.freq_table;
            *kp      = idx;
            ++kp;
            *ip = clone_subrange(idx)->header();
            ++ip;
         }
      }
      if (root.value())
         *sl->value() = *root.value();

      return sl->header();
   }

   node_header* insert(node_header* n, std::string_view key, std::string_view val);

   /**
    *  When inserting a value *into* another value a binary_node must be created that
    *  has the current value as the key, no prefix, and the new value as its only
    *  child.
    */
   node_header* insert(value_node& n, std::string_view key, std::string_view val) {
      return binary_node::make( "", key, value_node::make(val)->header(), n.header() )->header();
   }
   node_header* insert(binary_node& n, std::string_view key, std::string_view val)
   {
      if (n.header()->node_size() > 2000)
      {
         return insert(refactor(n), key, val);
      }
      return binary_node::clone_add(n, key, value_node::make(val)->header())->header();
   }

   /**
    *   header                       start_memcpy  { head range
    *   char prefix[get_prfix_size]  
    *   char setlist[...br-1]        end memcpy }
    *   char br
    *   char setlist[br+1...]        start memcpy { mid_range 
    *   id_type ids[...br-1]         end memcpy   }
    *   id_type new_node_id
    *   char ids[br+1...]            start memcpy { tail_range
    *   id_type value                end memcpy   }
    */
   inline node_header* setlist_node::clone_add(setlist_node&    in,
                                        char             br,
                                        std::string_view key,
                                        std::string_view val)
   {
      std::cerr << "setlist: " << in.get_setlist() <<" size: " << in.get_setlist().size() << "\n";
      std::cerr << "add br: " << br <<"  key: " << key <<"  =  " << val <<"\n";
      auto  head  = in.header();
      auto  asize = head->node_size() + 1 + sizeof(id_type);
      char* buf = (char*)malloc(asize);


      auto  sl          = in.get_setlist();
      const char* s     = sl.data();
      const char* p     = s;
      const char* e     = s + sl.size();
      while (p != e and *p < br)// linear search is faster than binary for N < 150
         ++p;


      auto insert_idx = p - s;
      std::cerr <<"insert before: " << *p <<" at index: " << insert_idx <<"\n";

      auto  head_range = sizeof(node_header) + head->get_prefix_size() + insert_idx;
      memcpy(buf, in.header(), head_range);
      ((node_header*)buf)->size = asize - sizeof(node_header);
      setlist_node* new_sln = (setlist_node*)(buf  + sizeof(node_header));
      new_sln->set_num_keys(sl.size()+1);


      char* bp                  = buf + head_range;
      *bp++                     = br;

      auto mid_range = (e - p) + insert_idx * sizeof(id_type);
      memcpy(bp, p, mid_range);
      bp += mid_range;

      auto vnh = value_node::make(val)->header();
      if (key.size()==0)
         ((id_type*)bp)->value = vnh;
      else
         ((id_type*)bp)->value = binary_node::make({}, key, vnh)->header();

      bp += sizeof(id_type);
      auto tail_range = (e - p + in.has_value()) * sizeof(id_type);
      memcpy(bp, p + mid_range, tail_range);

      return (node_header*)buf;
   }

   /**
    *   prefix + next_byte -> node to insert value on
    *   if prefix == key then value is on this node
    *   if prefix.size() > key
    *      
    *      initial condition
    *        bobby = null 
    *            a -> "BOBBYA"
    *            b -> "BOBBYB"
    *      insert bonie = "BONIE"
    *        bo = null
    *            b -> by = null
    *                a -> "BOBBYA"
    *                b -> "BOBBYB"
    *            n -> ie = "BONIE"
    *
    *
    *
    *        create new setlist with common prefix
    *        change the prfix on this to the postfix - branch
    *
    *
    */
   node_header* insert(setlist_node& n, std::string_view key, std::string_view val)
   {
      auto cpre = common_prefix(n.get_prefix(), key);
      if( cpre == key ) {
         if (n.value())
         {
            free(n.value()->value);
            n.value()->value = *value_node::make(val);
            return n;
         } else {
            std::cerr << "TODO: realloc setlist node with space for value on node\n";
            return n.header();
         }
      }
      if( cpre.size() < n.get_prefix().size() ) {
         print( n.header() );
         std::cerr << "insert " << key << " = " << val <<" not impl\n";//setlist node: ut-oh... we haven't implemented this yet\n";
         return n.header();
         // we need a new radix with 2 children that splits on the
         // byte that makes a difference... once in radix land always
         // in radix land, never go back to binary
      }

      if (cpre == n.get_prefix())
      {
         auto nid = n.find(key[cpre.size()]);
         if (nid)
         {
            *nid = insert(*nid, key.substr(cpre.size() + 1), val);
            return n.header();  // in place update
         }
         std::cerr << "CLONE ADD\n";
         return setlist_node::clone_add(n, key[cpre.size()], key.substr(cpre.size() + 1), val);
      }
      std::cerr <<"                     RETURN NULL!!?\n";
      return nullptr;
   }

   node_header* insert(node_header* n, std::string_view key, std::string_view val)
   {
      if (not n)
      {
         return binary_node::make("", key, value_node::make(val)->header())->header();
      }
      switch (n->get_type())
      {
         case node_type::binary:
            return insert(n->as<binary_node>(), key, val);
         case node_type::setlist:
            return insert(n->as<setlist_node>(), key, val);
         case node_type::value:
            return insert(n->as<value_node>(), key, val);
         default:
            std::cerr << "unknown node type passed to insert";
      }
      return nullptr;
   }

}  // namespace triedent
