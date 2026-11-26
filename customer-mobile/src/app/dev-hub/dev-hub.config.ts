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
  role: 'customer' as 'customer' | 'driver',
  title: 'DreamCabs Carpool (rider)',
  tokenKey: 'dreamcabs_customer_token',
  userKey: 'dreamcabs_customer_user',
  screens: [
    { match: /\/carpool\/search/, name: 'Find a carpool', keys: ['r-search', 'r-full'] },
    { match: /\/carpool\/results/, name: 'Search results', keys: ['r-search', 'r-full', 'r-overlap'] },
    { match: /\/carpool\/ride\/\d+\/driver/, name: 'Driver profile', keys: ['r-accepted'] },
    { match: /\/carpool\/ride/, name: 'Carpool page', keys: ['r-waiting', 'r-accepted', 'r-soon', 'r-onroad-waiting', 'r-onroad', 'r-picked', 'r-rate', 'r-declined', 'r-removed', 'r-cancel-driver', 'r-cancel-admin'] },
    { match: /\/carpool\/chat\/\d+\/pickup/, name: 'Pickup', keys: ['r-onroad', 'r-picked'] },
    { match: /\/carpool\/(messages|chat)/, name: 'Messages and chat', keys: ['r-accepted', 'r-chat-masked', 'r-chat-deleted'] },
    { match: /\/carpool\/trips|my-trips|\/tabs\/trips/, name: 'My trips', keys: ['r-accepted', 'r-rate', 'r-cancel-driver', 'r-chat-deleted'] },
    { match: /customer-tabs|\/home|\/go/, name: 'Home', keys: ['r-search', 'r-accepted', 'r-overlap'] },
    { match: /\/welcome|\/auth|\/intro/, name: 'Welcome and sign-in', keys: [] },
  ] as DevScreen[],
};
