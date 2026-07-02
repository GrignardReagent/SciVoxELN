/** Seed a fresh database with a small demo dataset (idempotent-ish: only seeds when empty). */
import { migrate, isEmpty, Experiments, Entries, Inventory, Plans, Audit } from './db.js';

export function seedIfEmpty() {
  migrate();
  if (!isEmpty()) return false;

  const exp = Experiments.create({
    title: 'Compound X-427 solubility screen',
    project: 'Formulation',
    objective: 'Determine aqueous solubility of X-427 across pH 2–9 at 25 °C.'
  });
  Entries.create(exp.id, {
    type: 'note', author: 'Demo User', role: 'Scientist',
    text: 'Prepared pH 2.0 buffer (50 mM). Weighed 5.1 mg X-427 into vial A1.'
  });

  Inventory.create({ name: 'Sodium phosphate (mono)', category: 'Buffer', catalog_number: 'S9638',
    lot_number: 'BCBK1234', location: 'Cabinet B / Shelf 2', quantity: 480, unit: 'g', reorder_level: 100,
    expiry_date: '2027-01-31', notes: 'ACS grade' });
  Inventory.create({ name: 'X-427 API', category: 'Compound', catalog_number: 'INT-0427',
    lot_number: 'X427-003', location: 'Freezer -20 / Box 4', quantity: 42, unit: 'mg', reorder_level: 50,
    expiry_date: '2026-09-01', notes: 'Light-sensitive; amber vial' });
  Inventory.create({ name: 'Acetonitrile (HPLC)', category: 'Solvent', catalog_number: '34851',
    lot_number: 'ACN-2291', location: 'Flammables cabinet', quantity: 2.5, unit: 'L', reorder_level: 2,
    expiry_date: '2028-05-01', notes: '' });

  Plans.create({
    title: 'pH-solubility profile of X-427',
    experiment_id: exp.id,
    hypothesis: 'Solubility increases below the compound pKa (~4.5) due to protonation.',
    variables: [
      { name: 'pH', type: 'independent', values: '2, 3, 4, 5, 6, 7, 8, 9' },
      { name: 'Aqueous solubility', type: 'dependent', values: 'mg/mL by HPLC' },
      { name: 'Temperature', type: 'controlled', values: '25 °C' }
    ],
    steps: [
      { text: 'Prepare 50 mM buffers at each target pH', done: true },
      { text: 'Add excess X-427; equilibrate 24 h at 25 °C with shaking', done: false },
      { text: 'Filter (0.45 µm) and dilute for HPLC', done: false },
      { text: 'Quantify against standard curve', done: false }
    ],
    materials: [
      { name: 'X-427 API', amount: 5, unit: 'mg' },
      { name: 'Sodium phosphate (mono)', amount: 50, unit: 'g' },
      { name: 'Acetonitrile (HPLC)', amount: 0.2, unit: 'L' }
    ],
    expected_outcome: 'A monotonic solubility decrease from pH 2 to pH 9.',
    status: 'ready'
  });

  Audit.log('System', '—', 'SEED', 'Demo dataset created');
  return true;
}

// Allow running directly: `npm run seed`
if (import.meta.url === `file://${process.argv[1]}`) {
  const seeded = seedIfEmpty();
  console.log(seeded ? 'Seeded demo data.' : 'Database not empty — no seed applied.');
}
