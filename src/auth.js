const DELETE_PASSWORD = process.env.DELETE_PASSWORD || 'changeme';

export function verifyPassword(input) {
  return input === DELETE_PASSWORD;
}
