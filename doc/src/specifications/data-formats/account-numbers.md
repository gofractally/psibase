# Account numbers

Account names are strings encoded as 64-bit numbers. Every primary account has 255 associated subaccounts. The base account name is stored in the high 56 bits. If the low 8 bits are 0, then the account is a primary account. If they are non-zero, they indicate the subaccount.

The following rules for account names must be adhered to:
* Name length is between 0 and 10 characters
* Names may only include the following character: a-z, 0-9, and - (hyphen)
* Names may not begin or end with a hypen
* Names may not contain two consecutive hyphens

All primary account names are mapped to sequential integers. The numeric ordering of account numbers is the same as the string ordering. Values above the representation of `zzzzzzzzzz` are not valid account numbers.

> Note: For more details, see the code for the account number encoding C++ [reference implementation](../../development/services/cpp-service/reference/magic-numbers.md#psibaseaccountnumber).

## Custom rules

Account names will frequently appear in subdomains of psibase network nodes. Therefore, the usage of the `AccountNumber` type for network accounts imposes the additional restriction that a hyphen may not be the first character in an account name. This is to comply with standard DNS rules. 

Furthermore, an account may not begin with the subsequence "x-" because it would have a subdomain which overshadows the subdomains reserved for use by infrastructure providers.
