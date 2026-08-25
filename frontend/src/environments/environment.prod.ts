const SERVER_HOST = 'dreamcabs.in';
const USE_HTTPS = true;

const wsScheme: 'http' | 'https' = USE_HTTPS ? 'https' : 'http';

export const environment = {
  production: true,
  apiUrl: 'https://dreamcabs.in/api',
  reverbAppKey: '4jsb8ggrbvcriyaskojh',
  reverbHost: SERVER_HOST,
  reverbPort: USE_HTTPS ? 443 : 8080,
  reverbScheme: wsScheme,
  googleMapsApiKey: 'AIzaSyDlGsZl3dalGOAKXG5nspcI5fduHQjk3-Q',
};
