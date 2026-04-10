import http from 'k6/http';

const BASE_URL = String(__ENV.BASE_URL || 'http://localhost:5000').replace(/\/+$/, '');
const AUTH_TOKEN = String(__ENV.AUTH_TOKEN || '').trim();

export const options = {
  vus: 1,
  iterations: 1,
};

export default function () {
  const response = http.get(`${BASE_URL}/api/auth/me`, {
    headers: {
      Accept: 'application/json',
      'x-auth-token': AUTH_TOKEN,
    },
  });

  console.log(JSON.stringify({
    status: response.status,
    body: response.body,
    headers: response.headers,
  }, null, 2));
}