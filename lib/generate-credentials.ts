const PASSWORD_CHARS = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ23456789';

function randomString(charset: string, length: number) {
  let result = '';
  for (let i = 0; i < length; i++) {
    result += charset[Math.floor(Math.random() * charset.length)];
  }
  return result;
}

export function generateUsername(firstName: string, lastName: string) {
  const base = `${firstName}${lastName.charAt(0)}`
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '')
    .slice(0, 12);
  const suffix = randomString('0123456789', 3);
  return `${base || 'employee'}${suffix}`;
}

export function generatePassword() {
  return randomString(PASSWORD_CHARS, 8);
}
