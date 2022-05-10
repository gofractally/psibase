#pragma once
#include <iostream>

namespace trie
{
   /**
    * T must impliment retain() and release() which will be called
    * every time this is copied, assigned or its destructor is called. 
    *
    * Use std::move to minimize this
    */
   template <typename T>
   struct shared_offset_ptr
   {
      /* an offset of 1 points at this and is invalid so we can
       * repurpose its meaning
       */
      explicit shared_offset_ptr(bool empty_leaf) : offset(empty_leaf){};
      bool is_empty_leaf() const { return offset == 1; }

      shared_offset_ptr() : offset(0) {}
      shared_offset_ptr(T* v) : offset(0) {set(v); }

      template <typename O>
      shared_offset_ptr(O* v) : offset(0)
      {
         static_assert(std::is_base_of<T, O>::value, "not a base class");
         set(v);
      }

      //shared_offset_ptr(const shared_offset_ptr& cpy) : offset(0) { set(cpy.get()); }

      shared_offset_ptr(shared_offset_ptr&& cpy)
          : offset((const char*)cpy.get() - (const char*)this)
      {
         cpy.offset = 0;
      }

      // TODO: enforce is_base?
      template <typename O>
      shared_offset_ptr(shared_offset_ptr<O>& cpy) : offset(0)
      {
         static_assert(std::is_base_of<T, O>::value, "not a base class");
         set(cpy.get());
      }

      template <typename O>
      shared_offset_ptr(shared_offset_ptr<O>&& cpy)
          : offset((const char*)cpy.get() - (const char*)this)
      {
         static_assert(std::is_base_of<T, O>::value, "not a base class");
         cpy.offset = 0;
      }

      ~shared_offset_ptr()
      {
         if (valid())
            get()->release();
      }

      bool is_null() const { return offset == 0; }
      bool valid() const { return offset != 0; }

      operator bool() const { return valid(); }

      shared_offset_ptr& operator=(T* p) { return set(p); }
      shared_offset_ptr& operator=(shared_offset_ptr& p)
      {
         if (p.get() != get())
            return set(p.get());
         return *this;
      }

      shared_offset_ptr& operator=(shared_offset_ptr&& p)
      {
         if (&p == this)
            return *this;
         if (valid())
            get()->release();
         offset   = (const char*)p.get() - (const char*)this;
         p.offset = 0;
         return *this;
      }

      const T& operator*() const
      {
         assert(offset != 1 and offset != 0);
         return *reinterpret_cast<const T*>((char*)this + offset);
      }
      const T* operator->() const
      {
         assert(offset != 1 and offset != 0);
         return reinterpret_cast<const T*>((char*)this + offset);
      }

      T& operator*()
      {
         assert(offset != 1 and offset != 0);
         return *get();
      }
      T* operator->()
      {
         assert(offset != 1 and offset != 0);
         return get();
      }

      const T* get() const { return reinterpret_cast<const T*>(((char*)this) + offset); }
      T*       get() { return reinterpret_cast<T*>(((char*)this) + offset); }


     private:
      template<typename U>
      friend class shared_offset_ptr;

      int64_t offset : 48;

      template <typename O>
      shared_offset_ptr& set(O* p)
      {
         if (offset)
         {
            get()->release();
            offset = 0;
         }
         if (p)
         {
            offset = (char*)p - (char*)this;
            p->retain();
         }
         return *this;
      }
   } __attribute__((packed));

   static_assert(sizeof(shared_offset_ptr<char>) == 6, "unexpeced padding");
}  // namespace trie
