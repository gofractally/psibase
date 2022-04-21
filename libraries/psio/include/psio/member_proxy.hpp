#pragma once

namespace psio
{

   template <uint32_t I, uint64_t Name, auto mptr, typename ProxyObject>
   struct member_proxy
   {
     private:
      ProxyObject& _proxy;

     public:
      member_proxy(ProxyObject& o) : _proxy(o) {}
      constexpr auto& get_proxy()const{ return _proxy; }

      template <typename... Args>
      auto call( Args&&... args )const {
         return _proxy.template call<I, Name, mptr, Args...>( std::forward<Args>(args)... ); 
      }

      constexpr const auto get() const { return _proxy.template get<I, Name, mptr>(); }
      constexpr auto       get() { return _proxy.template get<I, Name, mptr>(); }

      constexpr auto       operator->() { return (_proxy.template get<I, Name, mptr>()); }
      constexpr const auto operator->() const { return (_proxy.template get<I, Name, mptr>()); }

      constexpr auto       operator*() { return get(); }
      constexpr const auto operator*() const { return get(); }

      /*
      template <typename T>
      constexpr auto operator[](T&& k)
      {
         return get()[std::forward<T>(k)];
      }

      template <typename T>
      constexpr auto operator[](T&& k) const
      {
         return get()[std::forward<T>(k)];
      }
      */

      template <typename T>
      constexpr auto       operator[](T&& k) { return (_proxy.template operator[]<I, Name, mptr>(std::forward<T>(k))); }
      template <typename T>
      constexpr const auto operator[](T&& k) const { return (_proxy.template operator[]<I, Name, mptr>(std::forward<T>(k))); }

      template <typename S>
      friend S& operator<<(S& stream, const member_proxy& member)
      {
         return stream << member.get();
      }

      template <typename R>
      auto operator=(R&& r)
      {
         get() = std::forward<R>(r);
         return *this;
      }

      template <typename R>
      operator R() const
      {
         return get();
      }

      template <typename R>
      friend bool operator==(const member_proxy& a, const R& r)
      {
         return (R)a == r;
      }

      bool valid() { return get().valid(); }
   };

}  // namespace psio
