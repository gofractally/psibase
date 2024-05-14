#include <psibase/pkcs11.hpp>

#include <psibase/check.hpp>

#include <algorithm>
#include <charconv>
#include <cstdint>
#include <ostream>
#include <span>
#include <system_error>
#include <vector>

#include <dlfcn.h>

namespace psibase::pkcs11
{

   class pkcs11_error_category : public std::error_category
   {
      virtual std::string message(int condition) const override
      {
         switch (error(condition))
         {
            case error::ok:
               return "ok";
            case error::cancel:
               return "cancel";
            case error::host_memory:
               return "host memory";
            case error::slot_id_invalid:
               return "slot id invalid";
            case error::general_error:
               return "general error";
            case error::function_failed:
               return "function failed";
            case error::arguments_bad:
               return "arguments bad";
            case error::no_event:
               return "no event";
            case error::need_to_create_threads:
               return "need to create threads";
            case error::cant_lock:
               return "cant lock";
            case error::attribute_read_only:
               return "attribute read only";
            case error::attribute_sensitive:
               return "attribute sensitive";
            case error::attribute_type_invalid:
               return "attribute type invalid";
            case error::attribute_value_invalid:
               return "attribute value invalid";
            case error::copy_prohibited:
               return "copy prohibited";
            case error::action_prohibited:
               return "action prohibited";
            case error::data_invalid:
               return "data invalid";
            case error::data_len_range:
               return "data len range";
            case error::device_error:
               return "device error";
            case error::device_memory:
               return "device memory";
            case error::device_removed:
               return "device removed";
            case error::encrypted_data_invalid:
               return "encrypted data invalid";
            case error::encrypted_data_len_range:
               return "encrypted data len range";
            case error::function_canceled:
               return "function canceled";
            case error::function_not_parallel:
               return "function not parallel";
            case error::function_not_supported:
               return "function not supported";
            case error::key_handle_invalid:
               return "key handle invalid";
            case error::key_size_range:
               return "key size range";
            case error::key_type_inconsistent:
               return "key type inconsistent";
            case error::key_not_needed:
               return "key not needed";
            case error::key_changes:
               return "key changes";
            case error::key_needed:
               return "key needed";
            case error::key_indigestible:
               return "key indigestible";
            case error::key_function_not_permitted:
               return "key function not permitted";
            case error::key_not_wrappable:
               return "key not wrappable";
            case error::key_unextractable:
               return "key unextractable";
            case error::mechanism_invalid:
               return "mechanism invalid";
            case error::mechanism_param_invalid:
               return "mechanism param invalid";
            case error::object_handle_invalid:
               return "object handle invalid";
            case error::operation_active:
               return "operation active";
            case error::operation_not_initialized:
               return "operation not initialized";
            case error::pin_incorrect:
               return "pin incorrect";
            case error::pin_invalid:
               return "pin invalid";
            case error::pin_len_range:
               return "pin len range";
            case error::pin_expired:
               return "pin expired";
            case error::pin_locked:
               return "pin locked";
            case error::session_closed:
               return "session closed";
            case error::session_count:
               return "session count";
            case error::session_handle_invalid:
               return "session handle invalid";
            case error::session_parallel_not_supported:
               return "session parallel not supported";
            case error::session_read_only:
               return "session read only";
            case error::session_exists:
               return "session exists";
            case error::session_read_only_exists:
               return "session read only exists";
            case error::session_read_write_so_exists:
               return "session read write so exists";
            case error::signature_invalid:
               return "signature invalid";
            case error::signature_len_range:
               return "signature len range";
            case error::template_incomplete:
               return "template incomplete";
            case error::template_inconsistent:
               return "template inconsistent";
            case error::token_not_present:
               return "token not present";
            case error::token_not_recognized:
               return "token not recognized";
            case error::token_write_protected:
               return "token write protected";
            case error::unwrapping_key_handle_invalid:
               return "unwrapping key handle invalid";
            case error::unwrapping_key_size_range:
               return "unwrapping key size range";
            case error::unwrapping_key_type_inconsistent:
               return "unwrapping key type inconsistent";
            case error::user_already_logged_in:
               return "user already logged in";
            case error::user_not_logged_in:
               return "user not logged in";
            case error::user_pin_not_initialized:
               return "user pin not initialized";
            case error::user_type_invalid:
               return "user type invalid";
            case error::user_another_already_logged_in:
               return "user another already logged in";
            case error::user_too_many_types:
               return "user too many types";
            case error::wrapped_key_invalid:
               return "wrapped key invalid";
            case error::wrapped_key_len_range:
               return "wrapped key len range";
            case error::wrapping_key_handle_invalid:
               return "wrapping key handle invalid";
            case error::wrapping_key_size_range:
               return "wrapping key size range";
            case error::wrapping_key_type_inconsistent:
               return "wrapping key type inconsistent";
            case error::random_seed_not_supported:
               return "random seed not supported";
            case error::random_no_rng:
               return "random no rng";
            case error::domain_params_invalid:
               return "domain params invalid";
            case error::curve_not_supported:
               return "curve not supported";
            case error::buffer_too_small:
               return "buffer too small";
            case error::saved_state_invalid:
               return "saved state invalid";
            case error::information_sensitive:
               return "information sensitive";
            case error::state_unsaveable:
               return "state unsaveable";
            case error::cryptoki_not_initialized:
               return "cryptoki not initialized";
            case error::cryptoki_already_initialized:
               return "cryptoki already initialized";
            case error::mutex_bad:
               return "mutex bad";
            case error::mutex_not_locked:
               return "mutex not locked";
            case error::function_rejected:
               return "function rejected";
            default:
               return "Unknown PKCS #11 error: " + std::to_string(condition);
         }
      }
      virtual const char* name() const noexcept override { return "pkcs11"; }
   };

   const std::error_category& pkcs11_category()
   {
      static const pkcs11_error_category result;
      return result;
   }

   std::error_code make_error_code(error e)
   {
      return std::error_code(static_cast<int>(e), pkcs11_category());
   }

   std::ostream& operator<<(std::ostream& os, session_flags flags)
   {
      bool start       = true;
      auto maybe_space = [&]
      {
         if (start)
         {
            start = false;
         }
         else
         {
            os << ' ';
         }
      };
      if (flags & session_flags::rw_session)
      {
         maybe_space();
         os << "CKF_RW_SESSION";
      }
      if (flags & session_flags::serial_session)
      {
         maybe_space();
         os << "CKF_SERIAL_SESSION";
      }
      return os;
   }

   std::ostream& operator<<(std::ostream& os, state_t state)
   {
      switch (state)
      {
         case state_t::ro_public_session:
            os << "CKS_RO_PUBLIC_SESSION";
            break;
         case state_t::ro_user_functions:
            os << "CKS_RO_USER_FUNCTIONS";
            break;
         case state_t::rw_public_session:
            os << "CKS_RW_PUBLIC_SESSION";
            break;
         case state_t::rw_user_functions:
            os << "CKS_RW_USER_FUNCTIONS";
            break;
         case state_t::rw_so_functions:
            os << "CKS_RW_SO_FUNCTIONS";
            break;
         default:
            os << "unknown state";
            break;
      }
      return os;
   }

   std::ostream& operator<<(std::ostream& os, slot_flags flags)
   {
      bool start       = true;
      auto maybe_space = [&]
      {
         if (start)
         {
            start = false;
         }
         else
         {
            os << ' ';
         }
      };
      if (flags & slot_flags::token_present)
      {
         maybe_space();
         os << "CKF_TOKEN_PRESENT";
      }
      if (flags & slot_flags::removable_device)
      {
         maybe_space();
         os << "CKF_REMOVABLE_DEVICE";
      }
      if (flags & slot_flags::hw_slot)
      {
         maybe_space();
         os << "CKF_HW_SLOT";
      }
      return os;
   }

   std::ostream& operator<<(std::ostream& os, token_flags flags)
   {
      bool start       = true;
      auto maybe_space = [&]
      {
         if (start)
         {
            start = false;
         }
         else
         {
            os << ' ';
         }
      };
      if (flags & token_flags::rng)
      {
         maybe_space();
         os << "CKF_RNG";
      }
      if (flags & token_flags::write_protected)
      {
         maybe_space();
         os << "CKF_WRITE_PROTECTED";
      }
      if (flags & token_flags::login_required)
      {
         maybe_space();
         os << "CKF_LOGIN_REQUIRED";
      }
      if (flags & token_flags::user_pin_initialized)
      {
         maybe_space();
         os << "CKF_USER_PIN_INITIALIZED";
      }
      if (flags & token_flags::restore_key_not_needed)
      {
         maybe_space();
         os << "CKF_RESTORE_KEY_NOT_NEEDED";
      }
      if (flags & token_flags::clock_on_token)
      {
         maybe_space();
         os << "CKF_CLOCK_ON_TOKEN";
      }
      if (flags & token_flags::protected_authentication_path)
      {
         maybe_space();
         os << "CKF_PROTECTED_AUTHENTICATION_PATH";
      }
      if (flags & token_flags::dual_crypto_operations)
      {
         maybe_space();
         os << "CKF_DUAL_CRYPTO_OPERATIONS";
      }
      if (flags & token_flags::token_initialized)
      {
         maybe_space();
         os << "CKF_TOKEN_INITIALIZED";
      }
      if (flags & token_flags::secondary_authentication)
      {
         maybe_space();
         os << "CKF_SECONDARY_AUTHENTICATION";
      }
      if (flags & token_flags::user_pin_count_low)
      {
         maybe_space();
         os << "CKF_USER_PIN_COUNT_LOW";
      }
      if (flags & token_flags::user_pin_final_try)
      {
         maybe_space();
         os << "CKF_USER_PIN_FINAL_TRY";
      }
      if (flags & token_flags::user_pin_locked)
      {
         maybe_space();
         os << "CKF_USER_PIN_LOCKED";
      }
      if (flags & token_flags::user_pin_to_be_changed)
      {
         maybe_space();
         os << "CKF_USER_PIN_TO_BE_CHANGED";
      }
      if (flags & token_flags::so_pin_count_low)
      {
         maybe_space();
         os << "CKF_SO_PIN_COUNT_LOW";
      }
      if (flags & token_flags::so_pin_final_try)
      {
         maybe_space();
         os << "CKF_SO_PIN_FINAL_TRY";
      }
      if (flags & token_flags::so_pin_locked)
      {
         maybe_space();
         os << "CKF_SO_PIN_LOCKED";
      }
      if (flags & token_flags::so_pin_to_be_changed)
      {
         maybe_space();
         os << "CKF_SO_PIN_TO_BE_CHANGED";
      }
      if (flags & token_flags::error_state)
      {
         maybe_space();
         os << "CKF_ERROR_STATE";
      }
      return os;
   }

   std::ostream& operator<<(std::ostream& os, mechanism_type mechanism)
   {
      switch (mechanism)
      {
         case mechanism_type::rsa_pkcs_key_pair_gen:
            os << "CKM_RSA_PKCS_KEY_PAIR_GEN";
            break;
         case mechanism_type::rsa_pkcs:
            os << "CKM_RSA_PKCS";
            break;
         case mechanism_type::rsa_9796:
            os << "CKM_RSA_9796";
            break;
         case mechanism_type::rsa_x_509:
            os << "CKM_RSA_X_509";
            break;
         case mechanism_type::dsa:
            os << "CKM_DSA";
            break;
         case mechanism_type::dh_pkcs_key_pair_gen:
            os << "CKM_DH_PKCS_KEY_PAIR_GEN";
            break;
         case mechanism_type::ecdsa:
            os << "CKM_ECDSA";
            break;
         default:
            os << static_cast<unsigned long>(mechanism);
            break;
      }
      return os;
   }

   std::ostream& operator<<(std::ostream& os, mechanism_flags flags)
   {
      bool start       = true;
      auto maybe_space = [&]
      {
         if (start)
         {
            start = false;
         }
         else
         {
            os << ' ';
         }
      };
      if (flags & mechanism_flags::hw)
      {
         maybe_space();
         os << "CKF_HW";
      }
      if (flags & mechanism_flags::encrypt)
      {
         maybe_space();
         os << "CKF_ENCRYPT";
      }
      if (flags & mechanism_flags::decrypt)
      {
         maybe_space();
         os << "CKF_DECRYPT";
      }
      if (flags & mechanism_flags::digest)
      {
         maybe_space();
         os << "CKF_DIGEST";
      }
      if (flags & mechanism_flags::sign)
      {
         maybe_space();
         os << "CKF_SIGN";
      }
      if (flags & mechanism_flags::sign_recover)
      {
         maybe_space();
         os << "CKF_SIGN_RECOVER";
      }
      if (flags & mechanism_flags::verify)
      {
         maybe_space();
         os << "CKF_VERIFY";
      }
      if (flags & mechanism_flags::verify_recover)
      {
         maybe_space();
         os << "CKF_VERIFY_RECOVER";
      }
      if (flags & mechanism_flags::generate)
      {
         maybe_space();
         os << "CKF_GENERATE";
      }
      if (flags & mechanism_flags::generate_key_pair)
      {
         maybe_space();
         os << "CKF_GENERATE_KEY_PAIR";
      }
      if (flags & mechanism_flags::wrap)
      {
         maybe_space();
         os << "CKF_WRAP";
      }
      if (flags & mechanism_flags::unwrap)
      {
         maybe_space();
         os << "CKF_UNWRAP";
      }
      if (flags & mechanism_flags::derive)
      {
         maybe_space();
         os << "CKF_DERIVE";
      }
      if (flags & mechanism_flags::extension)
      {
         maybe_space();
         os << "CKF_EXTENSION";
      }
      return os;
   }

   std::ostream& operator<<(std::ostream& os, object_class c)
   {
      switch (c)
      {
         case object_class::data:
            os << "CKO_DATA";
            break;
         case object_class::certificate:
            os << "CKO_CERTIFICATE";
            break;
         case object_class::public_key:
            os << "CKO_PUBLIC_KEY";
            break;
         case object_class::private_key:
            os << "CKO_PRIVATE_KEY";
            break;
         case object_class::secret_key:
            os << "CKO_SECRET_KEY";
            break;
         case object_class::hw_feature:
            os << "CKO_HW_FEATURE";
            break;
         case object_class::domain_parameters:
            os << "CKO_DOMAIN_PARAMETERS";
            break;
         case object_class::mechanism:
            os << "CKO_MECHANISM";
            break;
         case object_class::g_collection:
            os << "CKO_G_COLLECTION";
            break;
         case object_class::g_search:
            os << "CKO_G_SEARCH";
            break;
         case object_class::g_credential:
            os << "CKO_G_CREDENTIAL";
            break;
         default:
            os << static_cast<unsigned long>(c);
            break;
      }
      return os;
   }

   std::ostream& operator<<(std::ostream& os, key_type t)
   {
      switch (t)
      {
         case key_type::rsa:
            os << "CKK_RSA";
            break;
         case key_type::g_secret_item:
            os << "CKK_G_SECRET_ITEM";
            break;
         default:
            os << "unknown key type: " << static_cast<unsigned long>(t);
            break;
      }
      return os;
   }

   shared_library::shared_library(const char* filename)
   {
      handle = ::dlopen(filename, RTLD_NOW | RTLD_LOCAL);
      if (handle == nullptr)
      {
         throw std::runtime_error(::dlerror());
      }
   }
   shared_library::~shared_library()
   {
      if (handle)
      {
         ::dlclose(handle);
      }
   }

   pkcs11_library::pkcs11_library(const char* filename) : lib(filename)
   {
      auto get_function_list =
          reinterpret_cast<error (*)(function_list**)>(::dlsym(lib.handle, "C_GetFunctionList"));
      if (!get_function_list)
      {
         throw std::runtime_error(::dlerror());
      }
      handle_error(get_function_list(&functions));
      initialize_args args;
      handle_error(functions->C_Initialize(&args));
   }
   info pkcs11_library::GetInfo()
   {
      info result;
      functions->C_GetInfo(&result);
      return result;
   }
   template <typename T, typename F>
   std::vector<T> read_vector(F&& f)
   {
      unsigned long n;
      f(nullptr, &n);
      std::vector<T> result(n);
      while (true)
      {
         auto err = f(result.data(), &n);
         if (err == error::ok)
         {
            result.resize(n);
            return result;
         }
         else if (err == error::buffer_too_small)
         {
            result.resize(n);
         }
         else
         {
            throw std::system_error(err);
         }
      }
   }
   std::vector<slot_id_t> pkcs11_library::GetSlotList(bool tokenPresent)
   {
      unsigned long n;
      functions->C_GetSlotList(tokenPresent, nullptr, &n);
      std::vector<slot_id_t> result(n);
      while (true)
      {
         auto err = functions->C_GetSlotList(tokenPresent, result.data(), &n);
         if (err == error::ok)
         {
            result.resize(n);
            return result;
         }
         else if (err = error::buffer_too_small)
         {
            result.resize(n);
         }
         else
         {
            throw std::system_error(err);
         }
      }
   }
   slot_info pkcs11_library::GetSlotInfo(slot_id_t slot)
   {
      slot_info result;
      functions->C_GetSlotInfo(slot, &result);
      return result;
   }
   token_info pkcs11_library::GetTokenInfo(slot_id_t slot)
   {
      token_info result;
      functions->C_GetTokenInfo(slot, &result);
      return result;
   }
   std::vector<mechanism_type> pkcs11_library::GetMechanismList(slot_id_t slot)
   {
      return read_vector<mechanism_type>([&](mechanism_type* v, unsigned long* n)
                                         { return functions->C_GetMechanismList(slot, v, n); });
   }
   mechanism_info pkcs11_library::GetMechanismInfo(slot_id_t slot, mechanism_type mechanism)
   {
      mechanism_info result;
      handle_error(functions->C_GetMechanismInfo(slot, mechanism, &result));
      return result;
   }
   pkcs11_library::~pkcs11_library()
   {
      functions->C_Finalize(nullptr);
   }

   void handle_error(error err)
   {
      if (err != error::ok)
      {
         throw std::system_error(err);
      }
   }

   session::session(std::shared_ptr<pkcs11_library> lib, slot_id_t slot, session_flags flags)
       : lib(std::move(lib))
   {
      flags = static_cast<session_flags>(flags | session_flags::rw_session);
      handle_error(this->lib->functions->C_OpenSession(slot, flags, nullptr, nullptr, &handle));
   }
   session_info session::GetSessionInfo()
   {
      session_info result;
      handle_error(lib->functions->C_GetSessionInfo(handle, &result));
      return result;
   }
   std::vector<mechanism_type> session::GetMechanismList()
   {
      return lib->GetMechanismList(GetSessionInfo().slotID);
   }

   token_info session::GetTokenInfo()
   {
      return lib->GetTokenInfo(GetSessionInfo().slotID);
   }
   void session::Login()
   {
      if (lib->GetTokenInfo(GetSessionInfo().slotID).flags &
          token_flags::protected_authentication_path)
      {
         handle_error(lib->functions->C_Login(handle, user_type::user, nullptr, 0));
      }
      else
      {
         throw std::runtime_error("pin required");
      }
   }
   void session::Login(std::string_view pin)
   {
      handle_error(lib->functions->C_Login(
          handle, user_type::user, reinterpret_cast<const char8_t*>(pin.data()), pin.size()));
   }
   void session::Logout()
   {
      handle_error(lib->functions->C_Logout(handle));
   }
   std::vector<char> session::Sign(const mechanism&               m,
                                   object_handle                  obj,
                                   std::span<const unsigned char> data)
   {
      handle_error(lib->functions->C_SignInit(handle, const_cast<mechanism*>(&m), obj));
      unsigned long n;
      handle_error(lib->functions->C_Sign(handle, data.data(), data.size(), nullptr, &n));
      std::vector<char> result(n);
      handle_error(lib->functions->C_Sign(handle, data.data(), data.size(),
                                          reinterpret_cast<unsigned char*>(result.data()), &n));
      result.resize(n);
      return result;
   }
   void session::Verify(const mechanism&               m,
                        object_handle                  key,
                        std::span<const unsigned char> data,
                        std::span<const unsigned char> sig)
   {
      handle_error(lib->functions->C_VerifyInit(handle, const_cast<mechanism*>(&m), key));
      handle_error(
          lib->functions->C_Verify(handle, data.data(), data.size(), sig.data(), sig.size()));
   }
   session::~session()
   {
      lib->functions->C_CloseSession(handle);
   }

   template <std::size_t N>
   std::string convert_string(const char8_t (&s)[N])
   {
      return std::string(reinterpret_cast<const char*>(s), N);
   }

   template <std::size_t N>
   std::string convert_string(const char (&s)[N])
   {
      return std::string(s, N);
   }

   std::ostream& operator<<(std::ostream& os, version_t version)
   {
      return os << (int)version.major << '.' << (int)version.minor;
   }

   struct maybe_infinite
   {
      unsigned long value;
   };

   std::ostream& operator<<(std::ostream& os, maybe_infinite value)
   {
      if (value.value == unavailable_information)
      {
         os << "unavailable";
      }
      else if (value.value == effectively_infinite)
      {
         os << "infinite";
      }
      else
      {
         os << value.value;
      }
      return os;
   }

   struct maybe_unavailable
   {
      unsigned long value;
   };

   std::ostream& operator<<(std::ostream& os, maybe_unavailable value)
   {
      if (value.value == unavailable_information)
      {
         os << "unavailable";
      }
      else
      {
         os << value.value;
      }
      return os;
   }

   std::ostream& operator<<(std::ostream& os, const info& info_)
   {
      os << "cryptoki version: " << (int)info_.cryptokiVersion.major << '.'
         << (int)info_.cryptokiVersion.minor << std::endl;
      os << "manufacturer: "
         << std::string((char*)info_.manufacturerID, sizeof(info_.manufacturerID)) << std::endl;
      os << "description: "
         << std::string((char*)info_.libraryDescription, sizeof(info_.libraryDescription))
         << std::endl;
      os << "library version: " << (int)info_.libraryVersion.major << '.'
         << (int)info_.libraryVersion.minor << std::endl;
      return os;
   }

   std::ostream& operator<<(std::ostream& os, const slot_info& sinfo)
   {
      os << "description: "
         << std::string((char*)sinfo.slotDescription, sizeof(sinfo.slotDescription)) << std::endl;
      os << "manufacturer: "
         << std::string((char*)sinfo.manufacturerID, sizeof(sinfo.manufacturerID)) << std::endl;
      os << "flags: " << sinfo.flags << std::endl;
      os << "hardware version: " << (int)sinfo.hardwareVersion.major << '.'
         << (int)sinfo.hardwareVersion.minor << std::endl;
      os << "firmware version: " << (int)sinfo.firmwareVersion.major << '.'
         << (int)sinfo.firmwareVersion.minor << std::endl;
      return os;
   }

   std::ostream& operator<<(std::ostream& os, const token_info& tinfo)
   {
      os << "label: " << convert_string(tinfo.label) << std::endl;
      os << "manufacturer: " << convert_string(tinfo.manufacturerID) << std::endl;
      os << "model: " << convert_string(tinfo.model) << std::endl;
      os << "serial number: " << convert_string(tinfo.serialNumber) << std::endl;
      os << "flags: " << tinfo.flags << std::endl;
      os << "max session count: " << maybe_infinite{tinfo.maxSessionCount} << std::endl;
      os << "session count: " << maybe_unavailable{tinfo.sessionCount} << std::endl;
      os << "max R/W session count: " << maybe_infinite{tinfo.maxRwSessionCount} << std::endl;
      os << "R/W session count: " << maybe_unavailable{tinfo.rwSessionCount} << std::endl;
      os << "max pin length: " << tinfo.maxPinLen << std::endl;
      os << "min pin length: " << tinfo.minPinLen << std::endl;
      os << "total public memory: " << maybe_unavailable{tinfo.totalPublicMemory} << std::endl;
      os << "free public memory: " << maybe_unavailable{tinfo.freePublicMemory} << std::endl;
      os << "total private memory: " << maybe_unavailable{tinfo.totalPrivateMemory} << std::endl;
      os << "free private memory: " << maybe_unavailable{tinfo.freePrivateMemory} << std::endl;
      os << "hardware version: " << tinfo.hardwareVersion << std::endl;
      os << "firmware version: " << tinfo.firmwareVersion << std::endl;
      if (tinfo.flags & token_flags::clock_on_token)
      {
         os << "UTC time: " << convert_string(tinfo.utcTime) << std::endl;
      }
      return os;
   }

   std::ostream& operator<<(std::ostream& os, const mechanism_info& minfo)
   {
      os << "key size: " << minfo.minKeySize << '-' << minfo.maxKeySize << std::endl;
      os << "flags: " << minfo.flags << std::endl;
      return os;
   }

   std::ostream& operator<<(std::ostream& os, const session_info& sinfo)
   {
      os << "slot: " << sinfo.slotID << std::endl;
      os << "state: " << sinfo.state << std::endl;
      os << "flags: " << sinfo.flags << std::endl;
      os << "device error: " << sinfo.deviceError << std::endl;
      return os;
   }

   constexpr bool unreserved(char ch)
   {
      if ('a' <= ch && ch <= 'z')
         return true;
      if ('A' <= ch && ch <= 'Z')
         return true;
      if ('0' <= ch && ch <= '9')
         return true;
      if (ch == '-' || ch == '.' || ch == '_' || ch == '~')
         return true;
      return false;
   }

   constexpr bool pchar(char ch)
   {
      return unreserved(ch) || ch == ':' || ch == '[' || ch == ']' || ch == '@' || ch == '!' ||
             ch == '$' || ch == '\'' || ch == '(' || ch == ')' || ch == '*' || ch == '+' ||
             ch == ',' || ch == '=';
   }

   constexpr int unhexChar(char ch)
   {
      if (ch >= '0' && ch <= '9')
         return ch - '0';
      else if (ch >= 'a' && ch <= 'f')
         return ch - 'a' + 10;
      else if (ch >= 'A' && ch <= 'F')
         return ch - 'A' + 10;
      else
         check(false, "Expected hex digit");
      __builtin_unreachable();
   }

   char parseHexChar(std::string_view& uri)
   {
      check(uri.size() >= 2, "Expected hex digit");
      auto result = static_cast<char>((unhexChar(uri[0]) << 4) | unhexChar(uri[1]));
      uri         = uri.substr(2);
      return result;
   }

   std::string parsePStr(std::string_view& uri)
   {
      std::string result;
      while (!uri.empty())
      {
         char ch = uri.front();
         if (ch == '%')
         {
            uri = uri.substr(1);
            result.push_back(parseHexChar(uri));
         }
         else if (pchar(ch) || ch == '&')
         {
            uri = uri.substr(1);
            result.push_back(ch);
         }
         else
         {
            break;
         }
      }
      return result;
   }

   std::string parseQStr(std::string_view& uri)
   {
      std::string result;
      while (!uri.empty())
      {
         char ch = uri.front();
         if (ch == '%')
         {
            uri = uri.substr(1);
            result.push_back(parseHexChar(uri));
         }
         else if (pchar(ch) || ch == '/' || ch == '?' || ch == '|')
         {
            uri = uri.substr(1);
            result.push_back(ch);
         }
         else
         {
            break;
         }
      }
      return result;
   }

   bool parseLiteral(std::string_view& uri, std::string_view prefix)
   {
      if (uri.starts_with(prefix))
      {
         uri = uri.substr(prefix.size());
         return true;
      }
      else
      {
         return false;
      }
   }

   template <typename T>
   T parseInt(std::string_view& uri)
   {
      T    result = 0;
      auto err    = std::from_chars(uri.data(), uri.data() + uri.size(), result);
      if (err.ec == std::errc{})
      {
         uri = uri.substr(err.ptr - uri.data());
         return result;
      }
      else
      {
         check(false, "Expected integer");
      }
      return result;
   }

   version_t parseVersion(std::string_view& uri)
   {
      version_t result;
      result.major = parseInt<std::uint8_t>(uri);
      if (parseLiteral(uri, "."))
      {
         result.minor = parseInt<std::uint8_t>(uri);
      }
      else
      {
         result.minor = 0;
      }
      return result;
   }

   void parsePAttr(std::string_view& uri, URI& out)
   {
      if (parseLiteral(uri, "library-manufacturer="))
      {
         check(!out.libraryDescription, "Duplicate library-manufacturer attribute");
         out.libraryManufacturer = parsePStr(uri);
      }
      else if (parseLiteral(uri, "library-description="))
      {
         check(!out.libraryDescription, "Duplicate library-description attribute");
         out.libraryDescription = parsePStr(uri);
      }
      else if (parseLiteral(uri, "library-version="))
      {
         check(!out.libraryVersion, "Duplicate library-version attribute");
         out.libraryVersion = parseVersion(uri);
      }
      else if (parseLiteral(uri, "slot-manufacturer="))
      {
         check(!out.slotManufacturer, "Duplicate slot-manufacturer attribute");
         out.slotManufacturer = parsePStr(uri);
      }
      else if (parseLiteral(uri, "slot-description="))
      {
         check(!out.slotDescription, "Duplicate slot-description attribute");
         out.slotDescription = parsePStr(uri);
      }
      else if (parseLiteral(uri, "slot-id="))
      {
         check(!out.slotId, "Duplicate slot-id attribute");
         out.slotId = parseInt<slot_id_t>(uri);
      }
      else if (parseLiteral(uri, "token="))
      {
         check(!out.token, "Duplicate token attribute");
         out.token = parsePStr(uri);
      }
      else if (parseLiteral(uri, "serial="))
      {
         check(!out.serial, "Duplicate serial attribute");
         out.serial = parsePStr(uri);
      }
      else if (parseLiteral(uri, "manufacturer="))
      {
         check(!out.manufacturer, "Duplicate manufacturer attribute");
         out.manufacturer = parsePStr(uri);
      }
      else if (parseLiteral(uri, "model="))
      {
         check(!out.model, "Duplicate model attribute");
         out.model = parsePStr(uri);
      }
      else if (parseLiteral(uri, "id="))
      {
         check(!out.id, "Duplicate id attribute");
         auto s = parsePStr(uri);
         auto p = reinterpret_cast<const unsigned char*>(s.data());
         out.id = std::vector(p, p + s.size());
      }
      else if (parseLiteral(uri, "object="))
      {
         check(!out.object, "Duplicate object attribute");
         out.object = parsePStr(uri);
      }
      else if (parseLiteral(uri, "type="))
      {
         check(!out.type, "Duplicate type attribute");
         if (parseLiteral(uri, "public"))
         {
            out.type = object_class::public_key;
         }
         else if (parseLiteral(uri, "private"))
         {
            out.type = object_class::private_key;
         }
         else if (parseLiteral(uri, "cert"))
         {
            out.type = object_class::certificate;
         }
         else if (parseLiteral(uri, "secret-key"))
         {
            out.type = object_class::secret_key;
         }
         else if (parseLiteral(uri, "data"))
         {
            out.type = object_class::data;
         }
         else
         {
            check(false, "invalid type");
         }
      }
      else
      {
         auto pos = uri.find('=');
         if (pos == std::string_view::npos)
         {
            check(false, "Expected attribute");
         }
         else
         {
            check(false, "Unknown attribute: " + std::string(uri.substr(0, pos)));
         }
      }
   }

   void parseQAttr(std::string_view& uri, URI& out)
   {
      if (parseLiteral(uri, "module-path="))
      {
         check(!out.modulePath, "Duplicate module-path attribute");
         out.modulePath = parseQStr(uri);
      }
      else if (parseLiteral(uri, "pin-value="))
      {
         check(!out.pinValue, "Duplicate pin-value attribute");
         out.pinValue = parseQStr(uri);
      }
      else
      {
         auto pos = uri.find('=');
         if (pos == std::string_view::npos)
         {
            check(false, "Expected attribute");
         }
         else
         {
            check(false, "Unknown attribute: " + std::string(uri.substr(0, pos)));
         }
      }
   }

   URI::URI(std::string_view uri)
   {
      check(parseLiteral(uri, "pkcs11:"),
            "Invalid PKCS #11 URI, expected 'pkcs11:...', got: '" + std::string(uri) + "'");
      // path
      if (!uri.empty() && !uri.starts_with('?'))
      {
         do
         {
            parsePAttr(uri, *this);
         } while (parseLiteral(uri, ";"));
      }
      // query
      if (parseLiteral(uri, "?") && !uri.empty())
      {
         do
         {
            parseQAttr(uri, *this);
         } while (parseLiteral(uri, "&"));
      }
      check(uri == "", "Expected end of URI");
   }

   std::string_view getString(const char* s, std::size_t n)
   {
      std::string_view result{s, n};
      auto             pos = result.find_last_not_of(' ');
      if (pos == std::string::npos)
      {
         return {};
      }
      return result.substr(0, pos + 1);
   }

   bool URI::matches(const info& linfo)
   {
      if (libraryDescription && *libraryDescription != getString(linfo.libraryDescription))
      {
         return false;
      }
      if (libraryManufacturer && *libraryManufacturer != getString(linfo.manufacturerID))
      {
         return false;
      }
      if (libraryVersion && *libraryVersion != linfo.libraryVersion)
      {
         return false;
      }
      return true;
   }

   bool URI::matches(slot_id_t slot, const slot_info& sinfo)
   {
      if (slotId && *slotId != slot)
      {
         return false;
      }
      if (slotManufacturer && *slotManufacturer != getString(sinfo.manufacturerID))
      {
         return false;
      }
      if (slotDescription && *slotDescription != getString(sinfo.slotDescription))
      {
         return false;
      }
      return true;
   }

   bool URI::matches(const token_info& tinfo)
   {
      if (token && *token != getString(tinfo.label))
      {
         return false;
      }
      if (serial && *serial != getString(tinfo.serialNumber))
      {
         return false;
      }
      if (manufacturer && *manufacturer != getString(tinfo.manufacturerID))
      {
         return false;
      }
      if (model && *model != getString(tinfo.model))
      {
         return false;
      }
      return true;
   }

   std::string makePStr(std::string_view s)
   {
      constexpr const char* xdigits = "0123456789ABCDEF";
      std::string           result;
      for (char ch : s)
      {
         if (pchar(ch) || ch == '&')
         {
            result.push_back(ch);
         }
         else
         {
            result.push_back('%');
            result.push_back(xdigits[(ch >> 4) & 0x0F]);
            result.push_back(xdigits[ch & 0x0F]);
         }
      }
      return result;
   }

   std::string makeURI(const token_info& tinfo)
   {
      std::string result;
      result += "pkcs11:";
      result += "token=";
      result += makePStr(getString(tinfo.label));
      result += ";manufacturer=";
      result += makePStr(getString(tinfo.manufacturerID));
      result += ";model=";
      result += makePStr(getString(tinfo.model));
      result += ";serial=";
      result += makePStr(getString(tinfo.serialNumber));
      return result;
   }
}  // namespace psibase::pkcs11
