const DEFAULT_CALENDAR_DAYS = 36525;

export function defaultCalendarWindow(query = {}) {
  const fromDate = query.from ? new Date(query.from) : new Date();
  if (!Number.isFinite(fromDate.getTime())) return { error: 'From date is invalid' };
  const toDate = query.to ? new Date(query.to) : new Date(fromDate.getTime() + DEFAULT_CALENDAR_DAYS * 86400000);
  if (!Number.isFinite(toDate.getTime())) return { error: 'To date is invalid' };
  if (toDate <= fromDate) return { error: 'To date must be after from date' };
  return { from: fromDate.toISOString(), to: toDate.toISOString() };
}

export function inventoryCalendarFilename(item) {
  const slug = String(item?.name || 'equipment')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60) || 'equipment';
  return `${slug}-calendar.ics`;
}

export function renderInventoryCalendar({ item, reservations, calendarName = '' }) {
  const stamp = icsDate(new Date());
  const name = calendarName || `${item.name} availability`;
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//SciVox ELN//Equipment Calendar//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    `X-WR-CALNAME:${icsEscape(name)}`,
    `X-WR-CALDESC:${icsEscape(`SciVox ELN bookings for ${item.name}`)}`
  ];

  for (const reservation of reservations) {
    const purpose = reservation.purpose || 'Reserved';
    const summary = `${item.name} - ${purpose}`;
    const description = [
      `Reserved by: ${reservation.reserved_by || 'Unknown'}`,
      `Purpose: ${purpose}`,
      item.location ? `Location: ${item.location}` : ''
    ].filter(Boolean).join('\\n');
    lines.push(
      'BEGIN:VEVENT',
      `UID:${reservation.id}@scivox-eln`,
      `DTSTAMP:${stamp}`,
      `DTSTART:${icsDate(reservation.starts_at)}`,
      `DTEND:${icsDate(reservation.ends_at)}`,
      `SUMMARY:${icsEscape(summary)}`,
      item.location ? `LOCATION:${icsEscape(item.location)}` : '',
      `DESCRIPTION:${icsEscape(description)}`,
      'END:VEVENT'
    );
  }

  lines.push('END:VCALENDAR');
  return lines.filter(Boolean).map(foldIcsLine).join('\r\n') + '\r\n';
}

function icsDate(value) {
  const d = new Date(value);
  return d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
}

function icsEscape(value) {
  return String(value ?? '')
    .replace(/\\/g, '\\\\')
    .replace(/\r\n|\r|\n/g, '\\n')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,');
}

function foldIcsLine(line) {
  const text = String(line);
  if (text.length <= 74) return text;
  const chunks = [];
  let rest = text;
  while (rest.length > 74) {
    chunks.push(rest.slice(0, 74));
    rest = rest.slice(74);
  }
  chunks.push(rest);
  return chunks.join('\r\n ');
}
