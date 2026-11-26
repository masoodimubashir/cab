/** The only part of the developer hub that differs between the customer app and the driver app. */
export interface DevScreen {
  /** Matched against the address, first match wins. */
  match: RegExp;
  /** Plain name, with the mockup screen number. */
  name: string;
  /** Scenarios that set this screen up. */
  keys: string[];
}

export const DEV_HUB_CONFIG = {
  role: 'driver' as 'customer' | 'driver',
  title: 'Cabbies Carpool (driver)',
  tokenKey: 'dreamcabs_driver_token',
  userKey: 'dreamcabs_driver_user',
  screens: [
    { match: /\/carpool-signup\/status/, name: 'Sign-up status (1f, 1g)', keys: ['d-docs-sent', 'd-docs-fix', 'd-approve-me', 'd-no-plan', 'd-plan-30'] },
    { match: /\/carpool-signup\/documents/, name: 'Fix documents', keys: ['d-docs-fix'] },
    { match: /\/carpool-signup\/plans/, name: 'Plans (1h, 1i)', keys: ['d-no-plan', 'd-plan-30', 'd-plan-ending', 'd-plan-waiting'] },
    { match: /\/carpool-signup\/details/, name: 'Sign-up steps 2 to 5 (1b to 1e)', keys: [] },
    { match: /\/carpool-signup\/?$/, name: 'Sign-up step 1: driver type (1)', keys: [] },
    { match: /\/carpool\/listing\/\d+\/pickup/, name: 'Pickup with code', keys: ['d-onroad'] },
    { match: /\/carpool\/listing/, name: 'Carpool page (8)', keys: ['d-published', 'd-start', 'd-onroad', 'd-finished', 'd-cancelled', 'd-full'] },
    { match: /\/carpool\/publish/, name: 'Publish (3 to 6)', keys: ['d-published', 'd-plan-30', 'd-plan-ended'] },
    { match: /\/carpool\/inbox|\/carpool\/chat/, name: 'Inbox and chats (7)', keys: ['d-requests', 'd-onroad', 'd-report'] },
    { match: /\/carpool\/carpools/, name: 'Carpools tab (2b)', keys: ['d-published', 'd-finished', 'd-cancelled'] },
    { match: /\/carpool\/profile/, name: 'Profile tab', keys: ['d-plan-30', 'd-plan-ending', 'd-no-plan'] },
    { match: /\/carpool\/documents/, name: 'My documents (renewals)', keys: [] },
    { match: /\/carpool\/home|\/carpool\/?$/, name: 'Home (2)', keys: ['d-published', 'd-requests', 'd-start', 'd-plan-ended', 'd-plan-ending'] },
    { match: /\/tabs\/dashboard/, name: 'Commercial dashboard', keys: [] },
    { match: /\/welcome|\/auth/, name: 'Welcome and sign-in', keys: [] },
  ] as DevScreen[],
};
