/* Insurance / Direct moved from cr301_accounttype to cr603_accountcategory, which
 * now has its own global option set ("Account Category G"), so the values differ
 * from the old Account Type ones. cr301_accounttype is now free to carry the
 * other business types. */

export const CATEGORY_INSURANCE = 999740002;
export const CATEGORY_DIRECT = 999740001;

/** Insurance / Direct as they still appear on older accounts' cr301_accounttype. */
export const LEGACY_TYPE_INSURANCE = 983080002;
export const LEGACY_TYPE_DIRECT = 766340001;

export const COLLECTION_ACCOUNTS_FILTER =
  `cr603_accountcategory eq ${CATEGORY_INSURANCE} or cr603_accountcategory eq ${CATEGORY_DIRECT}`;
