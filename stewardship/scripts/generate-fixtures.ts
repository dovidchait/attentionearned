/**
 * Generates synthetic Charidy export fixtures for testing.
 * Run: npm run generate:fixtures
 *
 * Produces:
 *   test/fixtures/charidy-sample.xlsx     — 43 normal rows
 *   test/fixtures/charidy-edge-cases.xlsx — 20 edge-case rows
 *
 * All data is synthetic (faker-generated). No real donor data.
 */
import * as XLSX from 'xlsx';
import { faker } from '@faker-js/faker';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURES_DIR = join(__dirname, '../test/fixtures');

// Excel epoch: days since 1899-12-30
function dateToExcelSerial(date: Date): number {
  const EXCEL_EPOCH = new Date(1899, 11, 30).getTime();
  return (date.getTime() - EXCEL_EPOCH) / (86400 * 1000);
}

function makeNormalRow(index: number): Record<string, unknown> {
  const area = faker.string.numeric(3);
  const local = faker.string.numeric(7);
  const countryPrefix = 1;

  return {
    'Donation ID': `${80000000 + index}`,
    'Donation Date and Time': dateToExcelSerial(faker.date.recent({ days: 90 })),
    'Billing First Name': faker.person.firstName(),
    'Billing Last Name': faker.person.lastName(),
    'Email': faker.internet.email().toLowerCase(),
    'Phone': `+${countryPrefix} ${area}-${local.slice(0,3)}-${local.slice(3)}`,
    'phone_number': local,
    'area_phone_prefix': area,
    'country_phone_prefix': countryPrefix,
    'Charge Amount': faker.number.float({ min: 18, max: 500, fractionDigits: 2 }),
    'Matched/Total Amount': faker.number.float({ min: 200, max: 6000, fractionDigits: 2 }),
    'Charge Amount Total': faker.number.float({ min: 200, max: 6000, fractionDigits: 2 }),
    'Currency': 'USD',
    'gateway': `[46365]stripe`,
    'Invoice No.': `20260${faker.string.numeric(9)}`,
    'Status': 'Processed',
    'Dedication': index % 4 === 0 ? faker.lorem.sentence() : null,
    'Billing Address Line 1': faker.location.streetAddress(),
    'Billing Address Line 2': null,
    'Billing Address City': faker.location.city(),
    'Billing Address Zip / Postal Code': faker.location.zipCode('#####'),
    'Billing Address State / Area': faker.location.state({ abbreviated: true }),
    'Billing Address Country': 'United States',
    'Transaction ID': `ch_3${faker.string.alphanumeric(24)}`,
    'offline_donation_received': null,
  };
}

function makeTeamRow(donationId: string, index: number): Record<string, unknown> {
  return {
    'Campaign ID': '47618',
    'Donation ID': donationId,
    'Donor First Name': faker.person.firstName(),
    'Donor Last Name': faker.person.lastName(),
    'Donor Display Name': faker.person.fullName(),
    'Team ID': `${1000 + index}`,
    'Team Name': `${faker.word.adjective()} Team`,
    'team_leader_name': faker.person.fullName(),
    'Team Link': faker.word.noun(),
    'Amount to Team': faker.number.float({ min: 18, max: 200, fractionDigits: 2 }),
    'Dedication': null,
    'Matched Total Donation Amount': faker.number.float({ min: 200, max: 2400, fractionDigits: 2 }),
    'Donation Charge Amount': faker.number.float({ min: 18, max: 200, fractionDigits: 2 }),
    'donation_status': 'Processed',
  };
}

function generateSampleFile(): void {
  const processed: Record<string, unknown>[] = [];
  const teamDonations: Record<string, unknown>[] = [];

  for (let i = 0; i < 43; i++) {
    const row = makeNormalRow(i);
    processed.push(row);
    // About half get a team attribution
    if (i % 2 === 0) {
      teamDonations.push(makeTeamRow(String(row['Donation ID']), i));
    }
  }

  const failedRow = makeNormalRow(9999);
  failedRow['Status'] = 'Failed';
  failedRow['Transaction ID'] = null;

  const recurringRows = Array.from({ length: 13 }, (_, i) => ({
    year: 2026 + Math.floor(i / 12),
    month: (i % 12) + 1,
    Amount: faker.number.float({ min: 100, max: 5000, fractionDigits: 2 }),
  }));

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(processed), 'processed');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet([failedRow]), 'failed');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(teamDonations), 'team_donations');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(recurringRows), 'recurring_donations_estimate');

  XLSX.writeFile(wb, `${FIXTURES_DIR}/charidy-sample.xlsx`);
  console.log('Generated: test/fixtures/charidy-sample.xlsx (43 rows)');
}

function generateEdgeCasesFile(): void {
  const rows: Record<string, unknown>[] = [];

  const base = (override: Partial<Record<string, unknown>>, idx: number): Record<string, unknown> => ({
    ...makeNormalRow(idx + 1000),
    ...override,
  });

  // 1. Missing phone entirely
  rows.push(base({
    'Donation ID': '90000001',
    'Phone': null,
    'phone_number': null,
    'area_phone_prefix': null,
    'country_phone_prefix': null,
  }, 1));

  // 2. Phone with country_phone_prefix = 0
  rows.push(base({
    'Donation ID': '90000002',
    'country_phone_prefix': 0,
    'area_phone_prefix': '212',
    'phone_number': '5551234',
    'Phone': '+1 212-555-1234',
  }, 2));

  // 3. Non-US number (UK: +44)
  rows.push(base({
    'Donation ID': '90000003',
    'country_phone_prefix': 44,
    'area_phone_prefix': '7911',
    'phone_number': '123456',
    'Phone': '+44 7911 123456',
  }, 3));

  // 4. Non-US number (IL: +972)
  rows.push(base({
    'Donation ID': '90000004',
    'country_phone_prefix': 972,
    'area_phone_prefix': '54',
    'phone_number': '7654321',
    'Phone': '+972 54-765-4321',
  }, 4));

  // 5. Married-couple name
  rows.push(base({
    'Donation ID': '90000005',
    'Billing First Name': 'Moshe & Leah',
    'Billing Last Name': 'Cohen',
  }, 5));

  // 6. Dedication with emoji
  rows.push(base({
    'Donation ID': '90000006',
    'Dedication': 'In honor of 🎂 birthday celebration! 🙏',
  }, 6));

  // 7. Dedication with newline
  rows.push(base({
    'Donation ID': '90000007',
    'Dedication': 'In memory of\nmy beloved father',
  }, 7));

  // 8. Missing email
  rows.push(base({
    'Donation ID': '90000008',
    'Email': null,
  }, 8));

  // 9. Both email and phone missing (name+zip fallback)
  rows.push(base({
    'Donation ID': '90000009',
    'Email': null,
    'Phone': null,
    'phone_number': null,
    'area_phone_prefix': null,
    'country_phone_prefix': null,
    'Billing First Name': 'Avraham',
    'Billing Last Name': 'Goldstein',
    'Billing Address Zip / Postal Code': '10001',
  }, 9));

  // 10. Duplicate row within the file (same Donation ID as row 1)
  rows.push(base({
    'Donation ID': '90000001', // duplicate of row 1
    'Billing First Name': 'Duplicate',
  }, 10));

  // 11. Honorific in name
  rows.push(base({
    'Donation ID': '90000011',
    'Billing First Name': 'Rabbi David',
    'Billing Last Name': 'Levy',
  }, 11));

  // 12. Address with special chars
  rows.push(base({
    'Donation ID': '90000012',
    'Billing Address Line 1': '123 Main St, Apt #4B',
  }, 12));

  // 13. Non-USD currency
  rows.push(base({
    'Donation ID': '90000013',
    'Currency': 'ILS',
    'Charge Amount': 200,
  }, 13));

  // 14. Gateway without [ID] prefix
  rows.push(base({
    'Donation ID': '90000014',
    'gateway': 'stripe',
  }, 14));

  // 15. Charge Amount = 0 → hard quarantine
  rows.push(base({
    'Donation ID': '90000015',
    'Charge Amount': 0,
  }, 15));

  // 16. Charge Amount negative → hard quarantine
  rows.push(base({
    'Donation ID': '90000016',
    'Charge Amount': -36,
  }, 16));

  // 17. Missing Donation ID → hard quarantine
  rows.push(base({
    'Donation ID': null,
  }, 17));

  // 18. Status = "refunded" (non-standard but not quarantined)
  rows.push(base({
    'Donation ID': '90000018',
    'Status': 'refunded',
  }, 18));

  // 19. Decimal amount with rounding ($36.999 → 3700 cents)
  rows.push(base({
    'Donation ID': '90000019',
    'Charge Amount': 36.999,
  }, 19));

  // 20. ZIP+4 postal code → normalized to 5 digits
  rows.push(base({
    'Donation ID': '90000020',
    'Billing Address Zip / Postal Code': '10001-1234',
  }, 20));

  const teamDonations: Record<string, unknown>[] = [];
  // Add a few team rows for the normal-ish edge case rows
  teamDonations.push(makeTeamRow('90000005', 5));
  teamDonations.push(makeTeamRow('90000011', 11));

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), 'processed');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet([]), 'failed');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(teamDonations), 'team_donations');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet([]), 'recurring_donations_estimate');

  XLSX.writeFile(wb, `${FIXTURES_DIR}/charidy-edge-cases.xlsx`);
  console.log('Generated: test/fixtures/charidy-edge-cases.xlsx (20 edge-case rows)');
}

generateSampleFile();
generateEdgeCasesFile();
console.log('All fixtures generated.');
