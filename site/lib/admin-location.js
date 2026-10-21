// Enabled only after the private dashboard's reports and permissions have been
// verified. Legacy programmatic /api/admin routes are deliberately unaffected.
export function migratedAdminLocation(request, env) {
  if (env.ADMIN_DASHBOARD_MIGRATED !== '1' || !['GET', 'HEAD'].includes(request.method)) return null;
  const url = new URL(request.url);
  const paths = {
    '/admin': '/product/', '/admin/': '/product/', '/admin.html': '/product/',
    '/admin/voices': '/product/voices', '/admin/voices/': '/product/voices', '/admin/voices.html': '/product/voices',
    '/admin/edits': '/product/edits', '/admin/edits/': '/product/edits', '/admin/edits.html': '/product/edits',
  };
  if (!Object.hasOwn(paths, url.pathname)) return null;
  const target = new URL(paths[url.pathname], 'https://dashboard.loreforeverwow.com');
  for (const field of ['locale', 'status', 'user', 'q', 'offset', 'limit']) {
    if (url.searchParams.has(field)) target.searchParams.set(field, url.searchParams.get(field));
  }
  // No Location fragment is set: browsers retain the source URL's section hash.
  return target.href;
}
