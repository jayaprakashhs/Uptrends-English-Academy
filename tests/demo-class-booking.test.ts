import assert from 'node:assert/strict';
import test from 'node:test';
import { isValidIndianMobileNumber, validateDemoClassRequest } from '../demo-class-request';
import { handleApiRequest } from '../worker-api';

const requestBase = {
  full_name: 'Test Applicant',
  mobile: '+91 90000 00000',
  email: 'applicant@example.com',
  qualification_category: 'Student',
  parent_name: 'Parent Name',
  school_or_college_name: 'Test College',
  educational_qualification: 'B.Com',
  date_of_birth: '2000-01-01',
  address: '1 Test Street',
  city: 'Davangere',
  additional_information: '',
};

test('validates Indian mobile number formats', () => {
  assert.equal(isValidIndianMobileNumber('+91 90000 00000'), true);
  assert.equal(isValidIndianMobileNumber('09000000000'), true);
  assert.equal(isValidIndianMobileNumber('5000000000'), false);
  assert.equal(isValidIndianMobileNumber('900000000'), false);
});

test('accepts student demo requests with student-specific fields', () => {
  const result = validateDemoClassRequest(requestBase);
  assert.equal(result.valid, true);
  if (result.valid) {
    assert.equal(result.value.qualification_category, 'Student');
    assert.equal(result.value.parent_name, 'Parent Name');
    assert.equal(result.value.school_or_college_name, 'Test College');
  }
});

test('requires only qualification-category-specific fields', () => {
  const graduate = validateDemoClassRequest({
    ...requestBase,
    qualification_category: 'Graduate',
    college_name: 'Graduate College',
  });
  assert.equal(graduate.valid, true);
  if (graduate.valid) {
    assert.equal(graduate.value.college_name, 'Graduate College');
    assert.equal(graduate.value.parent_name, null);
    assert.equal(graduate.value.school_or_college_name, null);
  }

  const working = validateDemoClassRequest({
    ...requestBase,
    qualification_category: 'Working',
    profession: 'Teacher',
  });
  assert.equal(working.valid, true);
  if (working.valid) {
    assert.equal(working.value.profession, 'Teacher');
    assert.equal(working.value.parent_name, null);
  }
});

test('rejects missing conditional data, invalid email, and future dates', () => {
  const missingStudentDetails = validateDemoClassRequest({
    ...requestBase,
    parent_name: '',
  });
  assert.equal(missingStudentDetails.valid, false);

  const invalidEmail = validateDemoClassRequest({
    ...requestBase,
    email: 'invalid-email',
  });
  assert.equal(invalidEmail.valid, false);

  const futureDate = validateDemoClassRequest({
    ...requestBase,
    date_of_birth: '2999-01-01',
  });
  assert.equal(futureDate.valid, false);
});

test('demo request API validates data before touching storage or database', async () => {
  const response = await handleApiRequest(new Request('https://academy.example/api/demo-class-requests', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...requestBase, mobile: '12345' }),
  }), {});
  assert.equal(response.status, 400);
  assert.match((await response.json() as { error: string }).error, /Indian mobile number/);
});

test('demo request admin endpoint remains protected when server credentials are missing', async () => {
  const response = await handleApiRequest(new Request('https://academy.example/api/admin/demo-class-requests'), {});
  assert.equal(response.status, 503);
});

test('stores demo requests separately and sends independent applicant and academy emails', async () => {
  const previousFetch = globalThis.fetch;
  const databaseRequests: Array<{ url: string; body: Record<string, unknown> }> = [];
  const emailMessages: Array<{ to: string | string[]; subject: string }> = [];

  globalThis.fetch = async (input, init) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    if (url.startsWith('https://supabase.example/')) {
      if (url.includes('/rpc/check_application_contact_duplicate')) return Response.json(false);
      databaseRequests.push({
        url,
        body: JSON.parse(String(init?.body)) as Record<string, unknown>,
      });
      return Response.json({ id: '550e8400-e29b-41d4-a716-446655440000' }, { status: 201 });
    }
    if (url === 'https://api.resend.com/emails') {
      const email = JSON.parse(String(init?.body)) as { to: string | string[]; subject: string };
      emailMessages.push(email);
      return Response.json({ id: `email-${emailMessages.length}` });
    }
    throw new Error(`Unexpected external request: ${url}`);
  };

  try {
    const response = await handleApiRequest(new Request('https://academy.example/api/demo-class-requests', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(requestBase),
    }), {
      SUPABASE_URL: 'https://supabase.example',
      SUPABASE_SERVICE_ROLE_KEY: 'test-service-role-key',
      RESEND_API_KEY: 'test-resend-key',
      APPLICATION_NOTIFICATION_EMAIL: 'academy@example.com',
    });

    assert.equal(response.status, 202);
    assert.deepEqual(await response.json(), {
      success: true,
      message: 'We received your request. If it can be processed, the academy will contact you.',
    });
    assert.equal(databaseRequests.length, 1);
    assert.match(databaseRequests[0].url, /\/rest\/v1\/demo_class_requests\?/);
    assert.equal(databaseRequests[0].body.status, 'Pending');
    assert.equal('photo_object_key' in databaseRequests[0].body, false);
    assert.equal(emailMessages.length, 2);
    assert.equal(emailMessages[0].to, 'applicant@example.com');
    assert.equal(emailMessages[1].to, 'academy@example.com');
    assert.equal(databaseRequests.some(({ url }) => /\/(?:applications|application_notifications)\b/.test(url)), false);
  } finally {
    globalThis.fetch = previousFetch;
  }
});