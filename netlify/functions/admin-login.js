const { sign, safeEq, json } = require('../lib/core');
exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return json(405, { error: 'POST only' });
  const U = process.env.ADMIN_USER, P = process.env.ADMIN_PASSWORD;
  if (!U || !P) return json(500, { error: 'Admin login is not set up yet: add ADMIN_USER and ADMIN_PASSWORD in Netlify environment variables, then redeploy.' });
  const { user = '', pass = '' } = JSON.parse(event.body || '{}');
  await new Promise(r => setTimeout(r, 400)); // slow down guessing
  if (!(safeEq(user, U) & safeEq(pass, P))) return json(401, { error: 'Wrong username or password' });
  return json(200, { token: sign({ u: U, exp: Date.now() + 12 * 3600 * 1000 }) });
};
