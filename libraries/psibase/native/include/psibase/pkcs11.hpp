#pragma once

#include <cstdint>
#include <iosfwd>
#include <memory>
#include <optional>
#include <span>
#include <string>
#include <system_error>
#include <vector>

namespace psibase::pkcs11
{
   enum error : unsigned long
   {
      ok                         = 0,
      host_memory                = 2,
      function_failed            = 6,
      arguments_bad              = 0x7,
      attribute_type_invalid     = 0x12,
      device_error               = 0x30,
      key_function_not_permitted = 0x68,
      pin_incorrect              = 0xa0,
      signature_invalid          = 0xc0,
      signature_len_range        = 0xc1,
      template_inconsistent      = 0xd1,
      user_already_logged_in     = 0x100,
      user_not_logged_in         = 0x101,
      buffer_too_small           = 0x150
      // ...
   };

   const std::error_category& pkcs11_category();
   std::error_code            make_error_code(error e);

   void handle_error(error err);
}  // namespace psibase::pkcs11

namespace std
{
   template <>
   struct is_error_code_enum<::psibase::pkcs11::error>
   {
      static constexpr bool value = true;
   };
}  // namespace std

namespace psibase::pkcs11
{

   enum class flags_t : unsigned long
   {
      os_locking_ok = 2
   };

   using slot_id_t = unsigned long;

   static constexpr unsigned long unavailable_information = ~0ul;
   static constexpr unsigned long effectively_infinite    = 0;

   enum session_flags : unsigned long
   {
      rw_session     = 2,
      serial_session = 4,
   };
   std::ostream& operator<<(std::ostream& os, session_flags flags);

   enum class state_t : unsigned long
   {
      ro_public_session = 0,
      ro_user_functions = 1,
      rw_public_session = 2,
      rw_user_functions = 3,
      rw_so_functions   = 4,
   };
   std::ostream& operator<<(std::ostream& os, state_t state);

   struct session_info
   {
      slot_id_t     slotID;
      state_t       state;
      session_flags flags;
      unsigned long deviceError;
   };
   std::ostream& operator<<(std::ostream& os, const session_info& sinfo);

   enum slot_flags : unsigned long
   {
      token_present    = 1,
      removable_device = 2,
      hw_slot          = 4,
   };
   std::ostream& operator<<(std::ostream& os, slot_flags flags);

   struct version_t
   {
      std::uint8_t major;
      std::uint8_t minor;
   };

   struct info
   {
      version_t     cryptokiVersion;
      char8_t       manufacturerID[32];
      unsigned long flags;
      char8_t       libraryDescription[32];
      version_t     libraryVersion;
   };
   std::ostream& operator<<(std::ostream& os, const info& info_);

   struct slot_info
   {
      char8_t    slotDescription[64];
      char8_t    manufacturerID[32];
      slot_flags flags;
      version_t  hardwareVersion;
      version_t  firmwareVersion;
   };
   std::ostream& operator<<(std::ostream& os, const slot_info& sinfo);

   enum token_flags : unsigned long
   {
      rng                           = 0x1,
      write_protected               = 0x2,
      login_required                = 0x4,
      user_pin_initialized          = 0x8,
      restore_key_not_needed        = 0x20,
      clock_on_token                = 0x40,
      protected_authentication_path = 0x100,
      dual_crypto_operations        = 0x200,
      token_initialized             = 0x400,
      secondary_authentication      = 0x800,
      user_pin_count_low            = 0x10000,
      user_pin_final_try            = 0x20000,
      user_pin_locked               = 0x40000,
      user_pin_to_be_changed        = 0x80000,
      so_pin_count_low              = 0x100000,
      so_pin_final_try              = 0x200000,
      so_pin_locked                 = 0x400000,
      so_pin_to_be_changed          = 0x800000,
      error_state                   = 0x1000000,
   };
   std::ostream& operator<<(std::ostream& os, token_flags flags);

   struct token_info
   {
      char8_t       label[32];
      char8_t       manufacturerID[32];
      char8_t       model[16];
      char          serialNumber[16];
      token_flags   flags;
      unsigned long maxSessionCount;
      unsigned long sessionCount;
      unsigned long maxRwSessionCount;
      unsigned long rwSessionCount;
      unsigned long maxPinLen;
      unsigned long minPinLen;
      unsigned long totalPublicMemory;
      unsigned long freePublicMemory;
      unsigned long totalPrivateMemory;
      unsigned long freePrivateMemory;
      version_t     hardwareVersion;
      version_t     firmwareVersion;
      char          utcTime[16];
   };
   std::ostream& operator<<(std::ostream& os, const token_info& tinfo);

   enum class mechanism_type : unsigned long
   {
      rsa_pkcs_key_pair_gen = 0x0,
      rsa_pkcs              = 0x1,
      rsa_9796              = 0x2,
      rsa_x_509             = 0x3,
      dsa                   = 0x11,
      dh_pkcs_key_pair_gen  = 0x20,
      ec_key_pair_gen       = 0x1040,
      ecdsa                 = 0x1041,
      ecdsa_sha1            = 0x1042,
      ecdsa_sha224          = 0x1043,
      ecdsa_sha256          = 0x1044,
      ecdsa_sha384          = 0x1045,
      ecdsa_sha512          = 0x1046,
      //...
   };
   std::ostream& operator<<(std::ostream& os, mechanism_type mechanism);

   enum mechanism_flags : unsigned long
   {
      hw                = 0x1,
      encrypt           = 0x100,
      decrypt           = 0x200,
      digest            = 0x400,
      sign              = 0x800,
      sign_recover      = 0x1000,
      verify            = 0x2000,
      verify_recover    = 0x4000,
      generate          = 0x8000,
      generate_key_pair = 0x10000,
      wrap              = 0x20000,
      unwrap            = 0x40000,
      derive            = 0x80000,
      extension         = 0x80000000,
   };
   std::ostream& operator<<(std::ostream& os, mechanism_flags flags);

   struct mechanism
   {
      mechanism_type mechanism;
      void*          parameter   = nullptr;
      unsigned long  paramterLen = 0;
   };

   struct mechanism_info
   {
      unsigned long   minKeySize;
      unsigned long   maxKeySize;
      mechanism_flags flags;
   };
   std::ostream& operator<<(std::ostream& os, const mechanism_info& minfo);

   enum class session_handle : unsigned long
   {
      invalid = 0
   };

   enum class user_type : unsigned long
   {
      so               = 0,
      user             = 1,
      context_specific = 2,
   };

   struct initialize_args
   {
      error (*CreateMutex)(void**) = nullptr;
      error (*DestroyMutex)(void*) = nullptr;
      error (*LockMutex)(void*)    = nullptr;
      error (*UnlockMutex)(void*)  = nullptr;
      flags_t flags                = flags_t::os_locking_ok;
      void*   pReserved            = nullptr;
   };

   enum class object_handle : unsigned long
   {
   };

   enum class object_class : unsigned long
   {
      data              = 0x0,
      certificate       = 0x1,
      public_key        = 0x2,
      private_key       = 0x3,
      secret_key        = 0x4,
      hw_feature        = 0x5,
      domain_parameters = 0x6,
      mechanism         = 0x7,
      vendor_defined    = 0x8000000,
      // gnome keyring
      g_collection = 0xc74e4db3,
      g_search     = 0xc74e4db4,
      g_credential = 0xc74e4da9,
   };
   std::ostream& operator<<(std::ostream& os, object_class c);

   enum class key_type : unsigned long
   {
      rsa             = 0x0,
      dsa             = 0x1,
      dh              = 0x2,
      ecdsa           = 0x3,
      ec              = 0x3,
      x9_42_dh        = 0x4,
      kea             = 0x5,
      generic_secret  = 0x10,
      rc2             = 0x11,
      rc4             = 0x12,
      des             = 0x13,
      des2            = 0x14,
      des3            = 0x15,
      cast            = 0x16,
      cast3           = 0x17,
      cast5           = 0x18,
      cast128         = 0x18,
      rc5             = 0x19,
      idea            = 0x1a,
      skipjack        = 0x1b,
      baton           = 0x1c,
      juniper         = 0x1d,
      cdmf            = 0x1e,
      aes             = 0x1f,
      blowfish        = 0x20,
      twofish         = 0x21,
      securid         = 0x22,
      hotp            = 0x23,
      acti            = 24,
      camellia        = 0x25,
      aria            = 0x26,
      sha512_224_hmac = 0x27,
      sha512_256_hmac = 0x28,
      sha512_t_hmac   = 0x29,
      vendor_defined  = 0x80000000,
      // gnome keyring
      g_secret_item = 0xc74e4daa,
   };
   std::ostream& operator<<(std::ostream& os, key_type t);

   enum class attribute_type : unsigned long
   {
      class_                     = 0,
      token                      = 1,
      private_                   = 2,
      label                      = 3,
      application                = 0x10,
      value                      = 0x11,
      object_id                  = 0x12,
      certificate_type           = 0x80,
      issuer                     = 0x81,
      serial_number              = 0x82,
      ac_issuer                  = 0x83,
      owner                      = 0x84,
      attr_types                 = 0x85,
      trusted                    = 0x86,
      certificate_category       = 0x87,
      java_midp_security_domain  = 0x88,
      url                        = 0x89,
      hash_of_subject_public_key = 0x8a,
      hash_of_issuer_public_key  = 0x8b,
      name_hash_algorithm        = 0x8c,
      check_value                = 0x90,
      key_type                   = 0x100,
      subject                    = 0x101,
      id                         = 0x102,
      sensitive                  = 0x103,
      encrypt                    = 0x104,
      decrypt                    = 0x105,
      wrap                       = 0x106,
      unwrap                     = 0x107,
      sign                       = 0x108,
      sign_recover               = 0x109,
      verify                     = 0x10a,
      verify_recover             = 0x10b,
      derive                     = 0x10c,
      start_date                 = 0x110,
      end_date                   = 0x111,
      modulus                    = 0x120,
      modulus_bits               = 0x121,
      public_exponent            = 0x122,
      private_exponent           = 0x123,
      prime_1                    = 0x124,
      prime_2                    = 0x125,
      exponent_1                 = 0x126,
      exponent_2                 = 0x127,
      coefficient                = 0x128,
      prime                      = 0x130,
      subprime                   = 0x131,
      base                       = 0x132,
      prime_bits                 = 0x133,
      subprime_bits              = 0x134,
      value_bits                 = 0x160,
      value_len                  = 0x161,
      extractable                = 0x162,
      local                      = 0x163,
      never_extractable          = 0x162,
      always_sensitive           = 0x165,
      key_gen_mechanism          = 0x166,
      modifiable                 = 0x170,
      copyable                   = 0x171,
      destroyable                = 0x172,
      ecdsa_params               = 0x180,
      ec_params                  = 0x180,
      ec_point                   = 0x181,
      secondary_auth             = 0x200,
      auth_pin_flags             = 0x201,
      always_authenticate        = 0x202,
      wrap_with_trusted          = 0x210,
      wrap_template              = 0x40000211,
      unwrap_template            = 0x40000212,
      hw_feature_type            = 0x300,
      reset_on_init              = 0x301,
      has_reset                  = 0x302,
      pixel_x                    = 0x400,
      pixel_y                    = 0x401,
      resolution                 = 0x402,
      char_rows                  = 0x403,
      char_columns               = 0x404,
      color                      = 0x405,
      bits_per_pixel             = 0x406,
      char_sets                  = 0x480,
      encoding_methods           = 0x481,
      mime_types                 = 0x482,
      mechanism_type             = 0x500,
      required_cms_attributes    = 0x501,
      default_cms_attributes     = 0x502,
      supported_cms_attributes   = 0x503,
      allowed_mechanisms         = 0x40000600,
      vendor_defined             = 0x80000000,
      // gnome keyring
      g_locked     = 0xc74e4e17,
      g_created    = 0xc74e4e18,
      g_modified   = 0xc74e4e19,
      g_fields     = 0xc74e4e1a,
      g_collection = 0xc74e4e1b,
      g_schema     = 0xc74e4e1d,
   };

   struct attribute
   {
      attribute_type type;
      void*          value;
      unsigned long  valueLen;
   };

   template <attribute_type N, typename T>
   struct basic_attribute
   {
      static constexpr attribute_type type = N;
      T                               value;
   };

   template <attribute_type N>
   struct basic_attribute<N, std::string>
   {
      static constexpr attribute_type type = N;
      std::string                     value;
   };

   template <attribute_type N, typename T>
   attribute make_attribute(basic_attribute<N, T>* attr)
   {
      return {N, &attr->value, sizeof(attr->value)};
   }

   template <attribute_type N>
   attribute make_attribute(basic_attribute<N, std::string>* attr)
   {
      return {N, attr->value.data(), attr->value.size()};
   }
   template <attribute_type N>
   attribute make_attribute(basic_attribute<N, std::string>* attr, unsigned long size)
   {
      attr->value.resize(size);
      return {N, attr->value.data(), size};
   }

   template <attribute_type N>
   attribute make_attribute(basic_attribute<N, std::vector<unsigned char>>* attr)
   {
      return {N, attr->value.data(), attr->value.size()};
   }
   template <attribute_type N>
   attribute make_attribute(basic_attribute<N, std::vector<unsigned char>>* attr,
                            unsigned long                                   size)
   {
      attr->value.resize(size);
      return {N, attr->value.data(), size};
   }

   template <attribute_type N>
   attribute make_attribute(basic_attribute<N, std::vector<mechanism_type>>* attr)
   {
      return {N, attr->value.data(), attr->value.size() * sizeof(mechanism_type)};
   }
   template <attribute_type N>
   attribute make_attribute(basic_attribute<N, std::vector<mechanism_type>>* attr,
                            unsigned long                                    size)
   {
      // TODO: validate %==0
      attr->value.resize(size / sizeof(mechanism_type));
      return {N, attr->value.data(), size};
   }

   template <typename T>
   concept variable_size_attribute =
       requires(T* attr, unsigned long size) { make_attribute(attr, size); };

   namespace attributes
   {
      using class_    = basic_attribute<attribute_type::class_, object_class>;
      using label     = basic_attribute<attribute_type::label, std::string>;
      using id        = basic_attribute<attribute_type::id, std::string>;
      using key_type  = basic_attribute<attribute_type::key_type, key_type>;
      using token     = basic_attribute<attribute_type::token, bool>;
      using ec_params = basic_attribute<attribute_type::ec_params, std::vector<unsigned char>>;
      using ec_point  = basic_attribute<attribute_type::ec_point, std::vector<unsigned char>>;
      using value     = basic_attribute<attribute_type::value, std::vector<unsigned char>>;
      using allowed_mechanisms =
          basic_attribute<attribute_type::allowed_mechanisms, std::vector<mechanism_type>>;
      // gnome keyring
      using g_collection = basic_attribute<attribute_type::g_collection, std::string>;
      using g_locked     = basic_attribute<attribute_type::g_locked, bool>;
      // TODO: This is actually a series of null terminated strings, alternating keys and values
      using g_fields = basic_attribute<attribute_type::g_fields, std::string>;
      using g_schema = basic_attribute<attribute_type::g_schema, std::string>;
   }  // namespace attributes

   using unused_func_t = void (*)(void);

   struct function_list
   {
      version_t version;
      error (*C_Initialize)(const initialize_args*);
      error (*C_Finalize)(void*);
      error (*C_GetInfo)(info*);
      error (*C_GetFunctionList)(function_list**);
      error (*C_GetSlotList)(bool tokenPresent, slot_id_t* slots, unsigned long* count);
      error (*C_GetSlotInfo)(slot_id_t, slot_info*);
      error (*C_GetTokenInfo)(slot_id_t, token_info*);
      error (*C_GetMechanismList)(slot_id_t, mechanism_type*, unsigned long* count);
      error (*C_GetMechanismInfo)(slot_id_t, mechanism_type, mechanism_info*);
      unused_func_t C_InitToken;
      unused_func_t C_InitPIN;
      unused_func_t C_SetPIN;
      error (*C_OpenSession)(slot_id_t,
                             session_flags,
                             void*,
                             error (*notify)(session_handle, unsigned long, void*),
                             session_handle*);
      error (*C_CloseSession)(session_handle);
      unused_func_t C_CloseAllSessions;
      error (*C_GetSessionInfo)(session_handle, session_info*);
      unused_func_t C_GetOperationState;
      unused_func_t C_SetOperationState;
      error (*C_Login)(session_handle, user_type, char8_t* pin, unsigned long pinLen);
      unused_func_t C_Logout;
      error (*C_CreateObject)(session_handle, attribute*, unsigned long, object_handle*);
      unused_func_t C_CopyObject;
      unused_func_t C_DestroyObject;
      unused_func_t C_GetObjectSize;
      error (*C_GetAttributeValue)(session_handle, object_handle, attribute*, unsigned long);
      unused_func_t C_SetAttributeValue;
      error (*C_FindObjectsInit)(session_handle, const attribute*, unsigned long);
      error (*C_FindObjects)(session_handle, object_handle*, unsigned long, unsigned long*);
      error (*C_FindObjectsFinal)(session_handle);
      unused_func_t C_EncryptInit;
      unused_func_t C_Encrypt;
      unused_func_t C_EncryptUpdate;
      unused_func_t C_EncryptFinal;
      unused_func_t C_DecryptInit;
      unused_func_t C_Decrypt;
      unused_func_t C_DecryptUpdate;
      unused_func_t C_DecryptFinal;
      unused_func_t C_DigestInit;
      unused_func_t C_Digest;
      unused_func_t C_DigestUpdate;
      unused_func_t C_DigestKey;
      unused_func_t C_DigestFinal;
      error (*C_SignInit)(session_handle, mechanism*, object_handle);
      error (*C_Sign)(session_handle,
                      const unsigned char*,
                      unsigned long,
                      unsigned char*,
                      unsigned long*);
      unused_func_t C_SignUpdate;
      unused_func_t C_SignFinal;
      unused_func_t C_SignRecoverInit;
      unused_func_t C_SignRecover;
      error (*C_VerifyInit)(session_handle, mechanism*, object_handle);
      error (*C_Verify)(session_handle,
                        const unsigned char*,
                        unsigned long,
                        const unsigned char*,
                        unsigned long);
      unused_func_t C_VerifyUpdate;
      unused_func_t C_VerifyFinal;
      unused_func_t C_VerifyRecoverInit;
      unused_func_t C_VerifyRecover;
      unused_func_t C_DigestEncryptUpdate;
      unused_func_t C_DecryptDigestUpdate;
      unused_func_t C_SignEncryptUpdate;
      unused_func_t C_DecryptVerifyUpdate;
      unused_func_t C_GenerateKey;
      unused_func_t C_GenerateKeyPair;
      unused_func_t C_WrapKey;
      unused_func_t C_UnwrapKey;
      unused_func_t C_DeriveKey;
      unused_func_t C_SeedRandom;
      unused_func_t C_GenerateRandom;
      unused_func_t C_GetFunctionStatus;
      unused_func_t C_CancelFunction;
      unused_func_t C_WaitForSlotEvent;
   };

   struct shared_library
   {
      explicit shared_library(const char* filename);
      ~shared_library();
      void* handle;
   };

   struct pkcs11_library
   {
      explicit pkcs11_library(const char* filename);
      info                        GetInfo();
      std::vector<slot_id_t>      GetSlotList(bool tokenPresent);
      slot_info                   GetSlotInfo(slot_id_t slot);
      token_info                  GetTokenInfo(slot_id_t slot);
      std::vector<mechanism_type> GetMechanismList(slot_id_t slot);
      mechanism_info              GetMechanismInfo(slot_id_t slot, mechanism_type mechanism);
      ~pkcs11_library();
      shared_library lib;
      function_list* functions;
   };

   struct session
   {
      session(std::shared_ptr<pkcs11_library> lib,
              slot_id_t                       slot,
              session_flags                   flags = session_flags::serial_session);
      session_info GetSessionInfo();
      void         Login();
      template <typename... Attrs>
      object_handle CreateObject(const Attrs&... attrs)
      {
         object_handle result;
         attribute     template_[] = {make_attribute(&const_cast<Attrs&>(attrs))...};
         handle_error(lib->functions->C_CreateObject(handle, template_, sizeof...(attrs), &result));
         return result;
      }
      struct finder
      {
         finder(session* self, attribute* attrs, unsigned long count) : self(self)
         {
            if (auto err = self->lib->functions->C_FindObjectsInit(self->handle, attrs, count))
            {
               throw std::system_error(make_error_code(err));
            }
         }
         ~finder() { self->lib->functions->C_FindObjectsFinal(self->handle); }
         session* self;
      };
      template <typename... Attrs>
      std::vector<object_handle> FindObjects(const Attrs&... attrs)
      {
         attribute                  template_[] = {make_attribute(&const_cast<Attrs&>(attrs))...};
         finder                     cleanup(this, template_, sizeof...(attrs));
         std::vector<object_handle> result;
         while (true)
         {
            object_handle obj;
            unsigned long count;
            if (auto err = lib->functions->C_FindObjects(handle, &obj, 1, &count))
            {
               throw std::system_error(make_error_code(err));
            }
            if (count == 0)
            {
               break;
            }
            result.push_back(obj);
         }
         return result;
      }
      template <typename T>
      T GetAttributeValue(object_handle obj)
      {
         T         result;
         attribute template_[1];
         if constexpr (variable_size_attribute<T>)
         {
            template_[0] = {T::type, nullptr, 0};
            handle_error(lib->functions->C_GetAttributeValue(handle, obj, template_, 1));
            template_[0] = make_attribute(&result, template_[0].valueLen);
         }
         else
         {
            template_[0] = make_attribute(&result);
         }
         handle_error(lib->functions->C_GetAttributeValue(handle, obj, template_, 1));
         return result;
      };
      template <typename... T>
      std::tuple<T...> GetAttributeValues(object_handle obj)
      {
         // TODO: combine attributes into a single call
         return {GetAttributeValue<T>(obj)...};
      }
      std::vector<char> Sign(const mechanism&               m,
                             object_handle                  obj,
                             std::span<const unsigned char> data);
      void              Verify(const mechanism&               m,
                               object_handle                  key,
                               std::span<const unsigned char> data,
                               std::span<const unsigned char> sig);
      ~session();
      std::shared_ptr<pkcs11_library> lib;
      session_handle                  handle;
   };

   struct URI
   {
      URI() = default;
      explicit URI(std::string_view uri);
      bool                       matches(const slot_info&);
      bool                       matches(const token_info&);
      std::optional<std::string> modulePath;
      std::optional<std::string> token;
      std::optional<std::string> serial;
      //...
   };
}  // namespace psibase::pkcs11
