/** The only part of the developer hub that differs between the customer app and the driver app. */
export const DEV_HUB_CONFIG = {
  role: 'driver' as 'customer' | 'driver',
  title: 'Cabbies Carpool (driver)',
  tokenKey: 'dreamcabs_driver_token',
  userKey: 'dreamcabs_driver_user',
  /** [route pattern, scenario keys that make sense on it] */
  suggest: [
    [/\/carpool\/listing\/\d+\/pickup/, ['d-onroad']],
    [/\/carpool\/listing|\/carpool\/publish/, ['d-published', 'd-start', 'd-onroad', 'd-finished', 'd-cancelled', 'd-full']],
    [/\/carpool\/inbox|\/carpool\/chat/, ['d-requests', 'd-onroad', 'd-report']],
    [/\/carpool|\/tabs\/dashboard/, ['d-published', 'd-requests', 'd-start', 'd-plan-ended']],
  ] as [RegExp, string[]][],
};
