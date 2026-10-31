import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { getApplicationPrimaryContact, validateApplicationCategoryFields } from '../application-request';

const shared = {
  place: 'Vijayanagar',
  city: 'Davangere',
  qualification: 'B.Com',
};

test('validates Student category and normalizes parent contacts', () => {
  const result = validateApplicationCategoryFields({
    ...shared,
    qualification_category: 'Student',
    qualification: '10th Standard',
    parent_phone: '+91 98765 43210',
    parent_email: ' Parent@Example.com ',
    school_name: 'Example School',
  });
  assert.equal(result.valid, true);
  if (!result.valid) return;
  assert.deepEqual(result.value, {
    qualification_category: 'Student',
    qualification: '10th Standard',
    parent_phone: '9876543210',
    parent_email: 'parent@example.com',
    school_name: 'Example School',
    college_name: null,
    occupation: null,
    place: 'Vijayanagar',
    city: 'Davangere',
  });
});

test('uses validated parent contacts as the Student application primary contact', () => {
  const result = validateApplicationCategoryFields({
    ...shared,
    qualification_category: 'Student',
    parent_phone: '+91 98765 43210',
    parent_email: ' Parent@Example.com ',
    school_name: 'Example School',
  });
  assert.equal(result.valid, true);
  if (!result.valid) return;
  assert.deepEqual(
    getApplicationPrimaryContact(result.value, { mobile: '', email: '' }),
    { mobile: '9876543210', email: 'parent@example.com' },
  );
});

test('validates Graduate category and clears student/working-only values', () => {
  const result = validateApplicationCategoryFields({
    ...shared,
    qualification_category: 'Graduate',
    college_name: 'Example College',
    parent_phone: 'should be ignored',
    parent_email: 'should be ignored',
    school_name: 'should be ignored',
    occupation: 'should be ignored',
  });
  assert.equal(result.valid, true);
  if (!result.valid) return;
  assert.equal(result.value.college_name, 'Example College');
  assert.equal(result.value.parent_phone, null);
  assert.equal(result.value.parent_email, null);
  assert.equal(result.value.school_name, null);
  assert.equal(result.value.occupation, null);
});

test('validates Working category and clears student/graduate-only values', () => {
  const result = validateApplicationCategoryFields({
    ...shared,
    qualification_category: 'Working',
    occupation: 'Teacher',
    parent_phone: 'should be ignored',
    parent_email: 'should be ignored',
    school_name: 'should be ignored',
    college_name: 'should be ignored',
  });
  assert.equal(result.valid, true);
  if (!result.valid) return;
  assert.equal(result.value.occupation, 'Teacher');
  assert.equal(result.value.parent_phone, null);
  assert.equal(result.value.parent_email, null);
  assert.equal(result.value.school_name, null);
  assert.equal(result.value.college_name, null);
});

test('rejects unsupported non-empty qualification categories', () => {
  const result = validateApplicationCategoryFields({
    ...shared,
    qualification_category: 'Other',
  });
  assert.equal(result.valid, false);
  if (!result.valid) assert.match(result.error, /select a qualification category/i);
});

test('requires qualification for Student, Graduate, and Working categories', () => {
  const cases: Array<Record<string, unknown>> = [
    {
      ...shared,
      qualification: '',
      qualification_category: 'Student',
      parent_phone: '9876543210',
      parent_email: 'parent@example.com',
      school_name: 'Example School',
    },
    {
      ...shared,
      qualification: '',
      qualification_category: 'Graduate',
      college_name: 'Example College',
    },
    {
      ...shared,
      qualification: '',
      qualification_category: 'Working',
      occupation: 'Teacher',
    },
  ];

  for (const input of cases) {
    const result = validateApplicationCategoryFields(input);
    assert.equal(result.valid, false, String(input.qualification_category));
    if (!result.valid) assert.match(result.error, /qualification|class you are studying/i);
  }
});

test('rejects invalid Student parent phone and email values', () => {
  const student = {
    ...shared,
    qualification_category: 'Student',
    parent_phone: 'invalid',
    parent_email: 'parent@example.com',
    school_name: 'Example School',
  };
  const invalidPhone = validateApplicationCategoryFields(student);
  assert.equal(invalidPhone.valid, false);
  if (!invalidPhone.valid) assert.match(invalidPhone.error, /valid indian parent phone/i);

  const invalidEmail = validateApplicationCategoryFields({
    ...student,
    parent_phone: '9876543210',
    parent_email: 'not-an-email',
  });
  assert.equal(invalidEmail.valid, false);
  if (!invalidEmail.valid) assert.match(invalidEmail.error, /valid parent email/i);
});

test('requires category, place, city and the selected category fields', () => {
  const cases: Array<[Record<string, unknown>, RegExp]> = [
    [{ ...shared }, /qualification category/i],
    [{ qualification_category: 'Student', ...shared, parent_email: 'parent@example.com', school_name: 'School' }, /parent phone/i],
    [{ qualification_category: 'Student', ...shared, parent_phone: '9876543210', school_name: 'School' }, /parent email/i],
    [{ qualification_category: 'Student', ...shared, parent_phone: '9876543210', parent_email: 'parent@example.com' }, /school name/i],
    [{ qualification_category: 'Graduate', ...shared }, /college name/i],
    [{ qualification_category: 'Working', ...shared }, /occupation/i],
    [{ qualification_category: 'Working', ...shared, occupation: 'Teacher', place: '' }, /place is required/i],
    [{ qualification_category: 'Working', ...shared, occupation: 'Teacher', city: '  ' }, /city is required/i],
    [{ qualification_category: 'Student', ...shared, parent_phone: 'invalid', parent_email: 'parent@example.com', school_name: 'School' }, /valid indian parent phone/i],
    [{ qualification_category: 'Student', ...shared, parent_phone: '9876543210', parent_email: 'bad-email', school_name: 'School' }, /valid parent email/i],
  ];

  for (const [input, expectedError] of cases) {
    const result = validateApplicationCategoryFields(input);
    assert.equal(result.valid, false);
    if (!result.valid) assert.match(result.error, expectedError);
  }
});

test('returns field-specific errors for every invalid field without changing the first server error', () => {
  const result = validateApplicationCategoryFields({
    qualification_category: 'Student',
    parent_phone: 'invalid',
    parent_email: 'not-an-email',
    school_name: '',
    qualification: '',
    place: '',
    city: '',
  });

  assert.equal(result.valid, false);
  if (!result.valid) {
    assert.equal(result.error, 'Place is required.');
    assert.deepEqual(result.errors, {
      place: 'Place is required.',
      city: 'City is required.',
      qualification: 'Class you are studying is required.',
      parent_phone: 'Enter a valid Indian parent phone number.',
      parent_email: 'Enter a valid parent email address.',
      school_name: 'School name is required.',
    });
  }
});

test('application category migration preserves existing rows and adds legacy-safe constraints', async () => {
  const migration = await readFile(
    new URL('../supabase/migrations/20261031000003_application_qualification_category.sql', import.meta.url),
    'utf8',
  );
  assert.match(migration, /BEGIN;[\s\S]*COMMIT;/);
  for (const column of [
    'qualification_category', 'parent_phone', 'parent_email', 'school_name',
    'college_name', 'occupation', 'place', 'city',
  ]) {
    assert.match(migration, new RegExp(`ADD COLUMN IF NOT EXISTS ${column} TEXT`));
  }
  assert.match(migration, /qualification_category IS NULL OR/);
  assert.doesNotMatch(migration, /UPDATE\s+public\.applications|DELETE\s+FROM\s+public\.applications|DROP\s+TABLE/i);
});

test('Worker application reads and Admin Portal details include category-specific fields', async () => {
  const worker = await readFile(new URL('../worker-api.ts', import.meta.url), 'utf8');
  const adminPortal = await readFile(new URL('../src/pages/AdminPortal.tsx', import.meta.url), 'utf8');
  for (const column of ['qualification_category', 'parent_phone', 'parent_email', 'school_name', 'college_name', 'occupation', 'place', 'city']) {
    assert.match(worker, new RegExp(`applications: '[^']*${column}`));
  }
  assert.match(adminPortal, /selectedApp\.qualification_category/);
  assert.match(adminPortal, /selectedApp\.parent_phone/);
  assert.match(adminPortal, /selectedApp\.parent_email/);
  assert.match(adminPortal, /selectedApp\.school_name/);
  assert.match(adminPortal, /selectedApp\.college_name/);
  assert.match(adminPortal, /selectedApp\.occupation/);
  assert.match(adminPortal, /selectedApp\.place/);
  assert.match(adminPortal, /selectedApp\.city/);
});