/** The only part of the developer hub that differs between the customer app and the driver app. */
export const DEV_HUB_CONFIG = {
  role: 'customer' as 'customer' | 'driver',
  title: 'DreamCabs Carpool (rider)',
  tokenKey: 'dreamcabs_customer_token',
  userKey: 'dreamcabs_customer_user',
  /** [route pattern, scenario keys that make sense on it] */
  suggest: [
    [/\/carpool\/search/, ['r-search', 'r-full']],
    [/\/carpool\/ride|\/carpool\/trips|my-trips/, ['r-waiting', 'r-accepted', 'r-soon', 'r-onroad', 'r-picked', 'r-rate', 'r-declined', 'r-removed']],
    [/\/carpool\/(messages|chat)/, ['r-accepted', 'r-chat-masked', 'r-chat-deleted']],
    [/customer-tabs|home|go/, ['r-search', 'r-accepted', 'r-overlap']],
  ] as [RegExp, string[]][],
};
