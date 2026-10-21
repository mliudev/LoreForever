import test from 'node:test';
import assert from 'node:assert/strict';
import { migratedAdminLocation } from '../lib/admin-location.js';

test('admin page cutover is explicit, preserves report filters, and never forwards credentials', () => {
  const request = new Request('https://loreforeverwow.com/admin/edits?locale=frFR&status=all&user=player-id&key=do-not-forward');
  assert.equal(migratedAdminLocation(request, {}), null);
  assert.equal(migratedAdminLocation(request, { ADMIN_DASHBOARD_MIGRATED: '1' }),
    'https://dashboard.loreforeverwow.com/product/edits?locale=frFR&status=all&user=player-id');
  assert.equal(migratedAdminLocation(new Request('https://loreforeverwow.com/admin'), { ADMIN_DASHBOARD_MIGRATED: '1' }),
    'https://dashboard.loreforeverwow.com/product/');
  for (const path of ['/api/admin', '/api/admin/creators', '/admin-shell.js', '/admin/unknown']) {
    assert.equal(migratedAdminLocation(new Request('https://loreforeverwow.com' + path), { ADMIN_DASHBOARD_MIGRATED: '1' }), null, path);
  }
  assert.equal(migratedAdminLocation(new Request('https://loreforeverwow.com/admin', { method: 'POST' }), { ADMIN_DASHBOARD_MIGRATED: '1' }), null);
});
