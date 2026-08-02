/**
 * Platform-wide scope catalog: scope key -> stable camelCase identifier.
 *
 * The identifier is what each service stores per-route (see its
 * `route-scope.map.ts`); the scope key itself is resolved at request time via
 * Redis (seeded from this map) with a gRPC fallback to the authentication
 * service, so the actual scope string can change centrally without redeploying
 * every service.
 *
 * This lives here rather than in each service because it is genuinely
 * platform-wide: every service must agree on it for a token issued by one to
 * be checked correctly by another. It was previously copied byte-for-byte into
 * 7 services, which meant adding a scope required 7 identical edits and any
 * missed copy produced a service that silently could not resolve it.
 */
export const SCOPE_IDENTIFIERS: Record<string, string> = {
  'customer:create': 'customerCreate',
  'customer:read': 'customerRead',
  'customer:add-official': 'customerAddOfficial',
  'customer:read-document-checklist': 'customerReadDocumentChecklist',
  'customer:upload-document': 'customerUploadDocument',
  'customer:submit': 'customerSubmit',
  'onboarding-consent:create': 'onboardingConsentCreate',
  'customer:eligibility-check': 'customerEligibilityCheck',
  'account:list': 'accountList',
  'account:create': 'accountCreate',
  'account:read': 'accountRead',
  'statement:list': 'statementList',
  'statement:download': 'statementDownload',
  'balance:read': 'balanceRead',
  'transaction:list': 'transactionList',
  'beneficiary:list': 'beneficiaryList',
  'beneficiary:create': 'beneficiaryCreate',
  'beneficiary:read': 'beneficiaryRead',
  'beneficiary:update': 'beneficiaryUpdate',
  'beneficiary:delete': 'beneficiaryDelete',
  'bank-lookup:read': 'bankLookupRead',
  'iban-beneficiary:list': 'ibanBeneficiaryList',
  'purpose-code:read': 'purposeCodeRead',
  'payment:create': 'paymentCreate',
  'payment:list': 'paymentList',
  'payment:read': 'paymentRead',
  'payment:delete': 'paymentDelete',
  'cheque-order:create': 'chequeOrderCreate',
  'cheque-order:list': 'chequeOrderList',
};

/** Redis key holding the identifier -> scope-key catalog. */
export const SCOPE_CATALOG_KEY = 'baas-api-scope';

/** Default messages for scope-resolution failures (overridable per service). */
export const SCOPE_MESSAGES = {
  SCOPE_RESOLUTION_UNAVAILABLE:
    'Unable to resolve the required scope for this route at this time',
  UNKNOWN_SCOPE_IDENTIFIER: 'No scope is registered for this identifier',
} as const;
