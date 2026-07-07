import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

test('scientists can reserve inventory resources without overlapping bookings', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'scivox-inventory-reserve-'));
  Object.assign(process.env, {
    DATA_DIR: tmp,
    SEED: 'false',
    SESSION_SECRET: 'test-secret-for-inventory-reserve',
    COOKIE_SECURE: 'false',
    SCIVOX_NO_LISTEN: 'true',
    NODE_NO_WARNINGS: '1'
  });
  const { app } = await import(`../src/index.js?inventoryReserve=${Date.now()}`);
  const server = await listen(app);
  const base = `http://127.0.0.1:${server.address().port}`;

  try {
    const admin = jar();
    const scientist = jar();
    const viewer = jar();

    await admin.req(base, 'POST', '/api/auth/register', {
      email: 'inventory-reserve-admin@scivox.test',
      name: 'Inventory Reserve Admin',
      password: 'inventory-reserve-admin-pass'
    });
    await scientist.req(base, 'POST', '/api/auth/register', {
      email: 'inventory-reserve-scientist@scivox.test',
      name: 'Inventory Reserve Scientist',
      password: 'inventory-reserve-scientist-pass'
    });
    const viewerUser = await viewer.req(base, 'POST', '/api/auth/register', {
      email: 'inventory-reserve-viewer@scivox.test',
      name: 'Inventory Reserve Viewer',
      password: 'inventory-reserve-viewer-pass'
    });
    await admin.req(base, 'PATCH', `/api/users/${viewerUser.id}/role`, { role: 'viewer' });

    const microscope = await scientist.req(base, 'POST', '/api/inventory', {
      name: 'Confocal microscope',
      category: 'Equipment',
      quantity: 1,
      unit: 'instrument',
      location: 'Imaging room'
    });

    const reservation = await scientist.req(base, 'POST', `/api/inventory/${microscope.id}/reservations`, {
      starts_at: '2099-03-18T09:00:00.000Z',
      ends_at: '2099-03-18T10:30:00.000Z',
      purpose: 'D4 endpoint imaging'
    });
    assert.equal(reservation.item_id, microscope.id);
    assert.equal(reservation.reserved_by, 'Inventory Reserve Scientist');
    assert.equal(reservation.purpose, 'D4 endpoint imaging');

    await assert.rejects(
      () => scientist.req(base, 'POST', `/api/inventory/${microscope.id}/reservations`, {
        starts_at: '2099-03-18T10:00:00.000Z',
        ends_at: '2099-03-18T11:00:00.000Z',
        purpose: 'overlap attempt'
      }),
      /409 Resource already reserved for that time/
    );
    await assert.rejects(
      () => viewer.req(base, 'POST', `/api/inventory/${microscope.id}/reservations`, {
        starts_at: '2099-03-18T12:00:00.000Z',
        ends_at: '2099-03-18T13:00:00.000Z',
        purpose: 'viewer attempt'
      }),
      /403/
    );

    const listed = await scientist.req(base, 'GET', '/api/inventory');
    const listedMicroscope = listed.find(item => item.id === microscope.id);
    assert.ok(listedMicroscope);
    assert.equal(listedMicroscope.reservations.length, 1);
    assert.equal(listedMicroscope.next_reservation.purpose, 'D4 endpoint imaging');
    assert.equal(listedMicroscope.next_reservation.reserved_by, 'Inventory Reserve Scientist');

    const availability = await scientist.req(
      base,
      'GET',
      `/api/inventory/${microscope.id}/availability?from=2099-03-18T00:00:00.000Z&to=2099-03-19T00:00:00.000Z`
    );
    assert.equal(availability.item.id, microscope.id);
    assert.equal(availability.from, '2099-03-18T00:00:00.000Z');
    assert.equal(availability.to, '2099-03-19T00:00:00.000Z');
    assert.equal(availability.reservations.length, 1);
    assert.equal(availability.reservations[0].purpose, 'D4 endpoint imaging');
    assert.equal(availability.reservations[0].reserved_by, 'Inventory Reserve Scientist');
    assert.equal(availability.reservations[0].starts_at, '2099-03-18T09:00:00.000Z');

    const ics = await scientist.raw(base, 'GET', `/api/inventory/${microscope.id}/calendar.ics`);
    assert.equal(ics.status, 200);
    assert.match(ics.headers.get('content-type'), /text\/calendar/);
    assert.match(ics.text, /BEGIN:VCALENDAR/);
    assert.match(ics.text, /VERSION:2\.0/);
    assert.match(ics.text, /BEGIN:VEVENT/);
    assert.match(ics.text, new RegExp(`UID:${reservation.id}@scivox-eln`));
    assert.match(ics.text, /SUMMARY:Confocal microscope - D4 endpoint imaging/);
    assert.match(ics.text, /DTSTART:20990318T090000Z/);
    assert.match(ics.text, /DTEND:20990318T103000Z/);

    const feed = await scientist.req(base, 'POST', `/api/inventory/${microscope.id}/calendar-token`);
    assert.match(feed.feed_url, /\/api\/calendar\/inventory\/[A-Za-z0-9_-]+\.ics$/);
    assert.equal(feed.item_id, microscope.id);
    const publicFeed = await rawAbsolute(feed.feed_url);
    assert.equal(publicFeed.status, 200);
    assert.match(publicFeed.headers.get('content-type'), /text\/calendar/);
    assert.match(publicFeed.text, /BEGIN:VCALENDAR/);
    assert.match(publicFeed.text, /SUMMARY:Confocal microscope - D4 endpoint imaging/);

    const cancelled = await scientist.req(base, 'DELETE', `/api/inventory/${microscope.id}/reservations/${reservation.id}`);
    assert.equal(cancelled.ok, true);
    const afterCancel = await scientist.req(base, 'GET', `/api/inventory/${microscope.id}`);
    assert.equal(afterCancel.reservations.length, 0);
    assert.equal(afterCancel.next_reservation, null);

    const audit = await admin.req(base, 'GET', '/api/audit');
    assert.ok(audit.some(row => row.action === 'RESERVE_INVENTORY' && row.detail.includes('Confocal microscope')));
    assert.ok(audit.some(row => row.action === 'CANCEL_INVENTORY_RESERVATION' && row.detail.includes('Confocal microscope')));
    assert.ok(audit.some(row => row.action === 'CREATE_INVENTORY_CALENDAR_FEED' && row.detail.includes('Confocal microscope')));
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
});

function jar() {
  let cookie = '';
  return {
    async req(base, method, url, body) {
      const headers = {};
      if (cookie) headers.cookie = cookie;
      if (body !== undefined) headers['content-type'] = 'application/json';
      const res = await fetch(base + url, {
        method,
        headers,
        body: body !== undefined ? JSON.stringify(body) : undefined
      });
      const setCookie = res.headers.get('set-cookie');
      if (setCookie) cookie = setCookie.split(';')[0];
      const text = await res.text();
      const data = text && (res.headers.get('content-type') || '').includes('json') ? JSON.parse(text) : text;
      if (!res.ok) throw new Error(`${res.status} ${typeof data === 'string' ? data : data.error || res.statusText}`);
      return data;
    },
    async raw(base, method, url, body) {
      const headers = {};
      if (cookie) headers.cookie = cookie;
      if (body !== undefined) headers['content-type'] = 'application/json';
      const res = await fetch(base + url, {
        method,
        headers,
        body: body !== undefined ? JSON.stringify(body) : undefined
      });
      const setCookie = res.headers.get('set-cookie');
      if (setCookie) cookie = setCookie.split(';')[0];
      const text = await res.text();
      return { status: res.status, headers: res.headers, text };
    }
  };
}

async function rawAbsolute(url) {
  const res = await fetch(url);
  const text = await res.text();
  return { status: res.status, headers: res.headers, text };
}

function listen(app) {
  return new Promise((resolve, reject) => {
    const server = app.listen(0, '0.0.0.0', () => resolve(server));
    server.on('error', reject);
  });
}
