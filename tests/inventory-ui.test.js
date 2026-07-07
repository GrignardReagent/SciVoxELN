import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const source = fs.readFileSync(new URL('../public/js/views/inventory.js', import.meta.url), 'utf8');
const styles = fs.readFileSync(new URL('../public/css/styles.css', import.meta.url), 'utf8');

test('inventory view renders broad viewer accounts as read-only', () => {
  assert.match(source, /canWriteInventory/);
  assert.match(source, /Read-only account role/);
  assert.match(source, /data-new-disabled/);
  assert.match(source, /disabled title="Inventory edits require scientist access"/);
  assert.match(source, /if \(canWrite\)/);
});

test('stock adjustment modal warns before consuming more than available', () => {
  assert.match(source, /stockDeltaMessage/);
  assert.match(source, /Insufficient stock/);
  assert.match(source, /available/);
  assert.match(source, /aErr/);
  assert.match(source, /delta < 0 && Math\.abs\(delta\) > Number\(it\.quantity\)/);
});

test('inventory item modal rejects negative stock fields before saving', () => {
  assert.match(source, /inventoryFieldMessage/);
  assert.match(source, /Quantity cannot be negative/);
  assert.match(source, /Reorder level cannot be negative/);
  assert.match(source, /id="iErr"/);
  assert.match(source, /min="0"/);
});

test('inventory view has a mobile card layout with visible status and actions', () => {
  assert.match(source, /inventoryMobileCardHTML/);
  assert.match(source, /data-inventory-mobile-card/);
  assert.match(source, /inventory-mobile-actions/);
  assert.match(source, /inventory-table-card/);
  assert.match(styles, /\.inventory-mobile-list/);
  assert.match(styles, /\.inventory-mobile-card/);
  assert.match(styles, /@media\(max-width:560px\)[\s\S]*\.inventory-table-card\{display:none\}/);
  assert.match(styles, /@media\(max-width:560px\)[\s\S]*\.inventory-mobile-list\{display:grid;/);
});

test('inventory view exposes equipment reservation controls and booking status', () => {
  assert.match(source, /data-reserve/);
  assert.match(source, /reserveModal/);
  assert.match(source, /api\.reserveItem/);
  assert.match(source, /api\.cancelItemReservation/);
  assert.match(source, /Next booking/);
  assert.match(source, /inventoryReservationHTML/);
  assert.match(source, /Reserved by/);
  assert.match(source, /Reserve resource/);
  assert.match(source, /booking requires scientist access/);
});

test('inventory view exposes equipment availability calendar export and sync controls', () => {
  assert.match(source, /data-calendar/);
  assert.match(source, /calendarModal/);
  assert.match(source, /api\.inventoryAvailability/);
  assert.match(source, /api\.inventoryCalendarToken/);
  assert.match(source, /calendar\.ics/);
  assert.match(source, /Show availability/);
  assert.match(source, /Export \.ics/);
  assert.match(source, /Subscribe URL/);
  assert.match(source, /Copy subscribe URL/);
  assert.match(styles, /\.equipment-calendar/);
  assert.match(styles, /\.equipment-calendar-slot/);
  assert.match(styles, /\.calendar-subscribe/);
});
