#include "psibase/src/missing.hpp"

// TODO: fix warnings
#pragma GCC diagnostic ignored "-Wambiguous-reversed-operator"
#pragma GCC diagnostic ignored "-Wchar-subscripts"
#pragma GCC diagnostic ignored "-Wignored-qualifiers"
#pragma GCC diagnostic ignored "-Wlogical-op-parentheses"
#pragma GCC diagnostic ignored "-Wunused-local-typedef"
#pragma GCC diagnostic ignored "-Wunused-parameter"
#pragma GCC diagnostic push
#include <eosio/from_json.hpp>
#include <psibase/block.hpp>
#include <psio/bytes.hpp>
#include <psio/fracpack.hpp>
#pragma GCC diagnostic pop

struct NewAccount
{
   psibase::AccountNumber account;
   psibase::AccountNumber auth_contract;
   bool                   allow_sudo;
};
PSIO_REFLECT(NewAccount, account, auth_contract, allow_sudo)
EOSIO_REFLECT(NewAccount, account, auth_contract, allow_sudo)

struct SetCode
{
   psibase::AccountNumber contract;
   int8_t                 vm_type;
   int8_t                 vm_version;
   std::vector<char>      code;
};
PSIO_REFLECT(SetCode, contract, vm_type, vm_version, code)
EOSIO_REFLECT(SetCode, contract, vm_type, vm_version, code)

struct Startup
{
   std::vector<psibase::AccountNumber> existing_accounts;
};
PSIO_REFLECT(Startup, existing_accounts)
EOSIO_REFLECT(Startup, existing_accounts)

struct RegisterServer
{
   psibase::AccountNumber contract;
   psibase::AccountNumber rpc_contract;
};
PSIO_REFLECT(RegisterServer, contract, rpc_contract);
EOSIO_REFLECT(RegisterServer, contract, rpc_contract);

struct UploadSys
{
   std::string       path;
   std::string       contentType;
   std::vector<char> content;
};
PSIO_REFLECT(UploadSys, path, contentType, content)
EOSIO_REFLECT(UploadSys, path, contentType, content)

template <typename T>
std::unique_ptr<std::vector<uint8_t>> pack(const rust::Str& json)
{
   std::vector<char> v(json.data(), json.data() + json.size());
   v.push_back(0);
   eosio::json_token_stream jstream{v.data()};
   T                        obj;
   eosio::from_json(obj, jstream);
   auto packed = psio::convert_to_frac(obj);
   auto result = std::make_unique<std::vector<uint8_t>>(packed.size());
   memcpy(result->data(), packed.data(), packed.size());
   return result;
}

std::unique_ptr<std::vector<uint8_t>> pack_new_account(rust::Str json)
{
   return pack<NewAccount>(json);
}

std::unique_ptr<std::vector<uint8_t>> pack_set_code(rust::Str json)
{
   return pack<SetCode>(json);
}

std::unique_ptr<std::vector<uint8_t>> pack_signed_transaction(rust::Str json)
{
   return pack<psibase::signed_transaction>(json);
}

std::unique_ptr<std::vector<uint8_t>> pack_signed_transactions(rust::Str json)
{
   return pack<std::vector<psibase::signed_transaction>>(json);
}

std::unique_ptr<std::vector<uint8_t>> pack_genesis_action_data(rust::Str json)
{
   return pack<psibase::genesis_action_data>(json);
}

std::unique_ptr<std::vector<uint8_t>> pack_startup(rust::Str json)
{
   return pack<Startup>(json);
}

std::unique_ptr<std::vector<uint8_t>> pack_register_server(rust::Str json)
{
   return pack<RegisterServer>(json);
}

std::unique_ptr<std::vector<uint8_t>> pack_upload_sys(rust::Str json)
{
   return pack<UploadSys>(json);
}
