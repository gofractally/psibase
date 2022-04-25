#include <string_view>
#include <cassert>
#include <cstdint>
#include <cstring>

#include <psidb/node_ptr.hpp>
#include <psidb/page_types/internal_node.hpp>
#include <sys/mman.h>

using namespace psidb;

struct leaf_ptr {
   leaf_ptr() = default;
   leaf_ptr(page_header* parent, void* loc) : parent(parent), loc(loc) {}
   page_header* parent;
   void* loc;
   template<typename Page>
   Page* get_parent() const { return static_cast<Page*>(parent); }
};

static_assert(sizeof(page_internal_node) == page_size);
static_assert(sizeof(page_internal_node::_buf) % 16 == 0);

struct key_value {
   std::string_view key;
   std::string_view value;
};

// A leaf holds key-value pairs
struct page_leaf : page_header {
   static constexpr std::size_t capacity = (page_size - sizeof(page_header) - 2) / 36;
   // each kv pair is at least 32-bytes
   std::uint8_t size;
   std::uint8_t total_words;
   struct kv_storage {
      std::uint8_t offset;
      std::uint8_t key_size;
      std::uint8_t value_size;
      std::uint8_t flags; // ignored for now
      constexpr std::size_t size() {
         return (key_size + value_size) * 16;
      }
   };
   char padding[16 - (sizeof(page_header) + 2 + capacity*sizeof(kv_storage)) % 16];
   kv_storage key_values[capacity];
   char buf[page_size - sizeof(page_header) - capacity*sizeof(kv_storage) - sizeof(padding) - 2];
   void clear() {
      size = 0;
      total_words = 0;
   }
   static std::string_view unpad(std::string_view data) {
      return {data.data(), data.data() + data.size() - 16 + data.back()};
   }
   std::string_view get_key(kv_storage kv) const {
      return {
          buf + kv.offset*16,
          buf + kv.offset*16 + kv.key_size*16
      };
   }
   std::string_view get_value(kv_storage kv) const {
      return {
          buf + kv.offset*16 + kv.key_size*16,
          buf + kv.offset*16 + kv.key_size*16 + kv.value_size*16
      };
   }
   std::string_view get_key(uint16_t idx) const {
      return get_key(key_values[idx]);
   }
   std::string_view get_value(uint16_t idx) const {
      return get_value(key_values[idx]);
   }

   std::uint32_t get_offset(leaf_ptr pos) const {
      return static_cast<kv_storage*>(pos.loc) - key_values;
   }
   // Pads the string to a multiple of 16-bytes and appends it to buf.
   void append_padded(std::string_view data) {
      std::memcpy(buf + total_words * 16, data.data(), data.size());
      std::memset(buf + total_words * 16 + data.size(), 0, 15 - data.size() % 16);
      buf[total_words * 16 + (data.size() | 0xF)] = data.size() % 16;
      total_words += data.size()/16 + 1;
   }
   void append_to_buf(std::string_view data) {
      assert(data.size() > 0);
      assert(data.size() % 16 == 0);
      std::memcpy(buf + total_words * 16, data.data(), data.size());
      total_words += data.size()/16;
   }
   // \pre the key must be greater than any key currently in the node
   // \pre key and value must be correctly padded
   void append_internal(std::string_view key, std::string_view value) {
      assert(size < capacity);
      key_values[size] = {
          total_words,
          static_cast<std::uint8_t>(key.size()/16),
          static_cast<std::uint8_t>(value.size()/16),
          0
      };
      ++size;
      append_to_buf(key);
      append_to_buf(value);
   }
   std::string_view split(page_leaf* other, std::uint16_t idx, key_type key, std::string_view value) {
      std::uint32_t total_kv_size = 0;
      other->size = 0;
      other->total_words = 0;
      other->type = page_type::leaf;
      auto copy_some = [&](std::uint32_t start, std::uint32_t end) {
         for(; start != end; ++start) {
            other->append_internal(get_key(start), get_value(start));
         }
      };
      for(std::uint32_t i = 0; i < idx; ++i) {
         total_kv_size += key_values[i].size();
         if(total_kv_size > sizeof(buf)/2) {
            copy_some(i, idx);
            other->insert_unchecked(other->size, key, value);
            copy_some(idx, size);
            truncate(i);
            return other->get_key(0);
         }
      }
      {
         total_kv_size += key.size() + value.size();
         if(total_kv_size > sizeof(buf)/2) {
            other->append_internal(key, value);
            copy_some(idx, size);
            truncate(idx);
            return other->get_key(0);
         }
      }
      for(std::uint32_t i = idx; i < size; ++i) {
         total_kv_size += key_values[i].size();
         if(total_kv_size > sizeof(buf)/2) {
            copy_some(i, size);
            // OPT: truncate and insert can be merged
            truncate(i);
            insert_unchecked(idx, key, value);
            return other->get_key(0);
         }
      }
      // unreachable, because split should only be called
      // when total_kv_size > sizeof(buf)
      __builtin_unreachable();
   }
   // Removes keys at pos and above
   // \post size == pos
   void truncate(std::uint16_t pos) {
      char tmp[sizeof(buf)];
      std::uint32_t offset = 0;
      auto append_string = [&](std::string_view data) {
         std::memcpy(tmp + offset, data.data(), data.size());
         offset += data.size();
      };
      for(std::uint32_t i = 0; i < pos; ++i) {
         auto& kv = key_values[i];
         auto prev_offset = offset;
         append_string(get_key(kv));
         append_string(get_value(kv));
         kv.offset = prev_offset/16;
      }
      std::memcpy(buf, tmp, offset);
      size = pos;
      total_words = offset/16;
   }
   bool insert_unchecked(std::uint16_t pos, key_type key, std::string_view value) {
      assert(size < capacity);
      shift_array(key_values + pos, key_values + size);
      ++size;
      key_values[pos] = {
          total_words,
          static_cast<std::uint8_t>(key.size()/16 + 1),
          static_cast<std::uint8_t>(value.size()/16 + 1),
          0
      };
      append_padded(key);
      append_padded(value);
      return true;
   }
   bool insert(leaf_ptr pos, key_type key, std::string_view value) {
      if(total_words*16 + ((key.size()/16) + (value.size()/16) + 2)*16 > sizeof(buf)) {
         return false;
      }
      insert_unchecked(get_offset(pos), key, value);
      return true;
   }
   leaf_ptr lower_bound(std::string_view key) {
      // TODO: binary search
      std::uint16_t i = 0;
      for(; i < size; ++i) {
         if(key <= unpad(get_key(i))) {
            break;
         }
      }
      return {this, key_values + i};
   }
};

static_assert(sizeof(page_leaf) == page_size);

union page {
   page_internal_node node;
   page_leaf leaf;
};

template<typename F>
decltype(auto) visit(page_header* root, F&& f) {
   switch(root->type) {
   case page_type::leaf: return f(static_cast<page_leaf*>(root));
   case page_type::node: return f(static_cast<page_internal_node*>(root));
   }
   __builtin_unreachable();
}

class database {
public:
   database() {
      // HACK:
      num_pages = 16384;
      pages = ::mmap(nullptr, page_size * num_pages, PROT_READ | PROT_WRITE, MAP_PRIVATE | MAP_ANONYMOUS, -1, 0);
      // initialize the root
      auto [page, id] = new_page();
      page->type = page_type::leaf;
      page->version = 0;
      static_cast<page_leaf*>(page)->clear();
   }
   ~database() {
      ::munmap(pages, num_pages * page_size);
   }

   page_header* get_page(page_id id) {
      return reinterpret_cast<page_header*>((char*)pages + id * page_size);
   }
   page_header* get_page(page_id id, version_type version) {
      page* result;
      while(true) {
         page_header* p = get_page(id);
         if(p->version <= version) {
            return p;
         } else {
            id = p->prev;
         }
      }
   }
   std::pair<page_header*, page_id> new_page() {
      auto id = next_page++;
      // FIXME: create objects
      return { get_page(id), id };
   }
   void set_root(page_id new_root) { root_id = new_root; }
   page_header* root() { return get_page(root_id); }
   page_id get_root_id() { return root_id;  }
   version_type get_version() { return root()->version; }
   void write_back(page_id page) {
      // assign page number on disk
      // queue write
      // mark page as being written
      // fixup all pointers to the page
      //
      // on write completion: queue gc
      // issue barrier and wait for all active threads to pass it
      // make page available for reuse
   }
private:
   database(const database&) = delete;
   std::size_t num_pages;
   std::size_t next_page = 0;
   page_id root_id = 0;
   void* pages;
};

class cursor {
public:
   explicit cursor(database* db) : db(db) {
      version = db->get_version();
   }
   // FIXME: figure out actual bound.  64 is definitely safe
   static constexpr std::size_t max_depth = 64;
   void lower_bound(std::string_view key) {
      page_header* p = db->root();
      depth = 0;
      while(node_ptr node = lower_bound(p, key)) {
         stack[depth++] = node;
         p = get_page(node);
      }
   }
   // \pre must already point to the lower_bound of \c key
   void insert(std::string_view key, std::string_view value) {
      std::uint32_t child;
      // Insert into the leaf
      {
         auto p = leaf.get_parent<page_leaf>();
         if(p->insert(leaf, key, value)) {
            return;
         }
         auto [new_page,new_page_id] = db->new_page();
         key = p->split(static_cast<page_leaf*>(new_page), p->get_offset(leaf), key, value);
         child = new_page_id;
      }
      // Insert into internal nodes
      for(std::size_t i = depth; i > 0; --i) {
         auto p = stack[i-1].get_parent<page_internal_node>();
         auto pos = stack[i-1];
         if(p->insert(pos, key, child)) {
            return;
         }
         // FIXME: Handle allocation failure
         auto [new_page,new_page_id] = db->new_page();
         key = p->split(static_cast<page_internal_node*>(new_page), p->get_offset(pos), key, child);
         child = new_page_id;
      }
      // Create a new root, increasing the depth of the tree
      {
         auto [new_page,new_page_id] = db->new_page();
         static_cast<page_internal_node*>(new_page)->set(db->get_root_id(), key, child);
         db->set_root(new_page_id);
      }
   }
   std::string_view get_key() const {
      auto p = leaf.get_parent<page_leaf>();
      return page_leaf::unpad(p->get_key(p->get_offset(leaf)));
   }
   std::string_view get_value() const {
      auto p = leaf.get_parent<page_leaf>();
      return page_leaf::unpad(p->get_value(p->get_offset(leaf)));
   }
private:
   page_header* get_page(page_id id) {
      return db->get_page(id, version);
   }
   page_header* get_page(node_ptr p) {
      return get_page(*p);
   }
   node_ptr lower_bound(page_header* p, key_type key) {
      return visit(p, [&](auto* p){ return lower_bound(p, key); });
   }
   node_ptr lower_bound(page_leaf* p, key_type key) {
      leaf = p->lower_bound(key);
      return nullptr;
   }
   node_ptr lower_bound(page_internal_node* p, key_type key) {
      return p->lower_bound(key);
   }
   database* db;
   std::size_t depth = 0;
   node_ptr stack[max_depth];
   leaf_ptr leaf;
   version_type version = 0;
};


#include <iostream>

auto make_kv(int i) {
   return std::pair{std::to_string(i), std::to_string(i * 1024)};
}

int main() {
   database db;
   cursor c(&db);

   for(int i = 0; i < 256*256; ++i) {
      auto [k,v] = make_kv(i);
      c.lower_bound(k);
      c.insert(k,v);
   }
   for(int i = 0; i < 256; ++i) {
      auto [k,v] = make_kv(i);
      c.lower_bound(k);
      std::cout << c.get_key() << ": " << c.get_value() << std::endl;
   }
}
