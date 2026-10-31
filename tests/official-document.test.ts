import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { inflateSync } from 'node:zlib';
import { PDFDocument } from 'pdf-lib';
import {
  DEFAULT_OFFICIAL_DOCUMENT_SETTINGS,
  generateOfficialPdf,
  type OfficialCourse,
  type OfficialStudent,
} from '../official-document';
import { handleApiRequest } from '../worker-api';

const userId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const applicationId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const programId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const photoKey = 'applications/dddddddd-dddd-4ddd-8ddd-dddddddddddd.png';
const pngBytes = Uint8Array.from(
  Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j0XQAAAAASUVORK5CYII=', 'base64'),
);

const student: OfficialStudent = {
  fullName: 'Test Learner',
  studentId: 'UEA-STU-2026-0001',
  applicationNumber: 'UEA-APP-2026-0001',
  qualification: 'Graduate',
  programName: 'IELTS Preparation',
  email: 'learner@example.com',
  mobile: '+919876543210',
  dateOfBirth: '2000-01-01',
  address: 'Davangere',
};

const selectedCourse: OfficialCourse = {
  name: 'IELTS Preparation',
  duration: '12 weeks',
  level: 'Intermediate',
  tuitionFee: 12000,
  registrationFee: 500,
  studyMaterialFee: 750,
  otherCharges: 250,
  discountType: 'amount',
  discountValue: 500,
  discountAmount: 500,
  finalPayable: 13000,
  agreedTotal: null,
};

const decodePdfText = (bytes: Uint8Array): string => {
  const source = Buffer.from(bytes).toString('latin1');
  const decodedStreams: string[] = [];
  for (const match of source.matchAll(/stream\r?\n([\s\S]*?)\r?\nendstream/g)) {
    try {
      const stream = inflateSync(Buffer.from(match[1], 'latin1')).toString('latin1');
      for (const text of stream.matchAll(/<([0-9a-f]+)> Tj/gi)) {
        decodedStreams.push(Buffer.from(text[1], 'hex').toString('latin1'));
      }
    } catch {
      // Non-Flate streams do not contain the generated page text.
    }
  }
  return decodedStreams.join('\n');
};

const makeWorkerEnv = (overrides: Record<string, unknown> = {}) => ({
  SUPABASE_URL: 'https://project.example',
  SUPABASE_SERVICE_ROLE_KEY: 'test-service-role-key',
  RESEND_API_KEY: 'test-resend-key',
  APPLICATION_MEDIA: {
    get: async (key: string) => {
      if (key !== photoKey) return null;
      return {
        body: new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(pngBytes);
            controller.close();
          },
        }),
        httpMetadata: { contentType: 'image/png' },
      };
    },
    put: async () => undefined,
    delete: async () => undefined,
    list: async () => ({ objects: [] }),
  },
  ...overrides,
});

const withAdminFetch = async (
  role: 'staff' | 'admin' | 'super_admin',
  handleRestRequest: (request: Request, url: URL) => Promise<Response>,
  run: () => Promise<void>,
) => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    const request = input instanceof Request ? input : new Request(input, init);
    const url = new URL(request.url);
    if (url.hostname === 'project.example' && url.pathname === '/auth/v1/user') {
      return Response.json({ id: userId });
    }
    if (url.hostname === 'project.example' && url.pathname === '/rest/v1/admin_profiles') {
      return Response.json([{
        id: userId,
        full_name: 'Test Admin',
        role,
        is_active: true,
      }]);
    }
    return handleRestRequest(request, url);
  };
  try {
    await run();
  } finally {
    globalThis.fetch = originalFetch;
  }
};

const authorizedRequest = (path: string, method = 'GET', body?: unknown) =>
  new Request(`https://academy.example${path}`, {
    method,
    headers: {
      Authorization: 'Bearer test-admin-token',
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });

test('official PDF contains the approved student and only the selected course', async () => {
  const bytes = await generateOfficialPdf({
    settings: DEFAULT_OFFICIAL_DOCUMENT_SETTINGS,
    student,
    course: selectedCourse,
    assets: { studentPhoto: { bytes: pngBytes, mime: 'image/png' } },
  });
  const pdf = await PDFDocument.load(bytes);
  assert.ok(pdf.getPageCount() >= 1);
  assert.equal(pdf.getPages()[0].getWidth(), 595.28);
  const text = decodePdfText(bytes);
  assert.match(text, /IELTS Preparation/);
  assert.match(text, /UEA-STU-2026-0001/);
  assert.match(text, /UEA-APP-2026-0001/);
  assert.doesNotMatch(text, /Spoken English|Business English|Other Course/);
});

test('official preview reads the selected approved student photo from private R2', async () => {
  const photoReads: string[] = [];
  const application = {
    id: applicationId,
    application_reference: student.applicationNumber,
    student_id: student.studentId,
    student_name: student.fullName,
    email: student.email,
    mobile: student.mobile,
    qualification: student.qualification,
    program_id: programId,
    program_name: student.programName,
    date_of_birth: student.dateOfBirth,
    address: student.address,
    photo_object_key: photoKey,
    approved_at: '2026-01-01T10:00:00Z',
    status: 'Accepted',
  };
  const env = makeWorkerEnv({
    APPLICATION_MEDIA: {
      get: async (key: string) => {
        photoReads.push(key);
        if (key !== photoKey) return null;
        return {
          body: new ReadableStream<Uint8Array>({
            start(controller) {
              controller.enqueue(pngBytes);
              controller.close();
            },
          }),
          httpMetadata: { contentType: 'image/png' },
        };
      },
      list: async () => ({ objects: [] }),
    },
  });

  await withAdminFetch('admin', async (_request, url) => {
    if (url.pathname.endsWith('/official_document_settings')) return Response.json([]);
    if (url.pathname.endsWith('/applications')) return Response.json([application]);
    if (url.pathname.endsWith('/programs')) {
      return Response.json([{ id: programId, title: selectedCourse.name, duration: selectedCourse.duration, level: selectedCourse.level }]);
    }
    if (url.pathname.endsWith('/program_fee_configurations')) {
      return Response.json([{
        program_id: programId,
        tuition_fee: selectedCourse.tuitionFee,
        registration_fee: selectedCourse.registrationFee,
        study_material_fee: selectedCourse.studyMaterialFee,
        other_charges: selectedCourse.otherCharges,
        discount_type: selectedCourse.discountType,
        discount_value: selectedCourse.discountValue,
        final_payable: selectedCourse.finalPayable,
      }]);
    }
    if (url.pathname.endsWith('/application_fee_agreements')) return Response.json([]);
    throw new Error(`Unexpected Supabase request: ${url.pathname}`);
  }, async () => {
    const response = await handleApiRequest(
      authorizedRequest('/api/admin/official-document/preview', 'POST', { application_id: applicationId }),
      env,
    );
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('Content-Type'), 'application/pdf');
    assert.equal(response.headers.get('Cache-Control'), 'private, no-store');
    const bytes = new Uint8Array(await response.arrayBuffer());
    assert.equal(new TextDecoder().decode(bytes.slice(0, 5)), '%PDF-');
    const text = decodePdfText(bytes);
    assert.match(text, /IELTS Preparation/);
    assert.doesNotMatch(text, /Other Course|Spoken English|Business English/);
  });
  assert.deepEqual(photoReads, [photoKey]);
});

test('approval attaches and stores the PDF generated from the immutable issuance snapshot', async () => {
  const uploaded: Array<{ key: string; bytes: Uint8Array; contentType?: string }> = [];
  const emailPayloads: Record<string, unknown>[] = [];
  const completedDeliveries: Record<string, unknown>[] = [];
  const snapshot = {
    application: {
      id: applicationId,
      application_reference: student.applicationNumber,
      student_id: student.studentId,
      student_name: student.fullName,
      email: student.email,
      mobile: student.mobile,
      qualification: student.qualification,
      date_of_birth: student.dateOfBirth,
      address: student.address,
      photo_object_key: photoKey,
      program_id: programId,
      program_name: student.programName,
    },
    program: {
      id: programId,
      name: selectedCourse.name,
      duration: selectedCourse.duration,
      level: selectedCourse.level,
    },
    fee: {
      tuition_fee: selectedCourse.tuitionFee,
      registration_fee: selectedCourse.registrationFee,
      study_material_fee: selectedCourse.studyMaterialFee,
      other_charges: selectedCourse.otherCharges,
      discount_type: selectedCourse.discountType,
      discount_value: selectedCourse.discountValue,
      discount_amount: selectedCourse.discountAmount,
      final_payable: selectedCourse.finalPayable,
      agreed_total: null,
    },
    document_settings: DEFAULT_OFFICIAL_DOCUMENT_SETTINGS,
    joining_information: {
      joiningDate: '2026-02-01',
      classSchedule: 'Monday to Saturday',
      classTimings: '10:00 AM',
      venue: 'Davangere',
    },
  };
  const approvalResult = {
    application: {
      id: applicationId,
      application_reference: student.applicationNumber,
      student_id: student.studentId,
      student_name: student.fullName,
      email: student.email,
      mobile: student.mobile,
      qualification: student.qualification,
      program_name: student.programName,
    },
    issuance: {
      id: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
      application_id: applicationId,
      application_reference: student.applicationNumber,
      snapshot,
      pdf_object_key: null,
      status: 'pending',
    },
  };
  const env = makeWorkerEnv({
    APPLICATION_MEDIA: {
      get: async (key: string) => key === photoKey
        ? {
          body: new ReadableStream<Uint8Array>({
            start(controller) {
              controller.enqueue(pngBytes);
              controller.close();
            },
          }),
          httpMetadata: { contentType: 'image/png' },
        }
        : null,
      put: async (key: string, value: ArrayBuffer | ArrayBufferView, options?: { httpMetadata?: { contentType?: string } }) => {
        const bytes = value instanceof ArrayBuffer
          ? new Uint8Array(value)
          : new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
        uploaded.push({ key, bytes, contentType: options?.httpMetadata?.contentType });
      },
      delete: async () => undefined,
      list: async () => ({ objects: [] }),
    },
  });

  await withAdminFetch('admin', async (request, url) => {
    if (url.hostname === 'api.resend.com' && url.pathname === '/emails') {
      assert.equal(request.headers.get('Idempotency-Key'), `student-approval-${applicationId}`);
      emailPayloads.push(await request.json() as Record<string, unknown>);
      return Response.json({ id: 'resend-message-id' });
    }
    if (url.pathname.endsWith('/rpc/approve_application_with_official_snapshot')) {
      const rpcPayload = await request.json() as Record<string, unknown>;
      assert.equal(rpcPayload.p_application_id, applicationId);
      assert.equal(rpcPayload.p_approver_id, userId);
      assert.equal(rpcPayload.p_approver_name, 'Test Admin');
      assert.deepEqual(rpcPayload.p_joining_information, snapshot.joining_information);
      return Response.json(approvalResult);
    }
    if (url.pathname.endsWith('/rpc/claim_student_approval_notification')) {
      return Response.json([{
        notification_id: 'ffffffff-ffff-4fff-8fff-ffffffffffff',
        claimed: true,
        status: 'Pending',
        attempt_count: 1,
      }]);
    }
    if (url.pathname.endsWith('/rpc/complete_student_approval_notification')) {
      completedDeliveries.push(await request.json() as Record<string, unknown>);
      return new Response(null, { status: 204 });
    }
    if (url.pathname.endsWith('/official_document_issuances')) {
      assert.equal(request.method, 'PATCH');
      return new Response(null, { status: 204 });
    }
    throw new Error(`Unexpected request: ${url.hostname}${url.pathname}`);
  }, async () => {
    const response = await handleApiRequest(
      authorizedRequest('/api/approve-application', 'POST', {
        application_id: applicationId,
        approved_by_name: 'Test Admin',
        joining_information: snapshot.joining_information,
      }),
      env,
    );
    assert.equal(response.status, 200);
    const body = await response.json() as { student_id: string; pdf_attached: boolean };
    assert.equal(body.student_id, student.studentId);
    assert.equal(body.pdf_attached, true);
  });

  assert.equal(uploaded.length, 1);
  assert.equal(uploaded[0].key, `official-documents/${applicationId}.pdf`);
  assert.equal(uploaded[0].contentType, 'application/pdf');
  assert.equal(new TextDecoder().decode(uploaded[0].bytes.slice(0, 5)), '%PDF-');
  assert.equal(completedDeliveries.length, 1);
  assert.equal(completedDeliveries[0].p_success, true);
  const emailPayload = emailPayloads[0];
  assert.ok(emailPayload);
  const attachments = emailPayload.attachments as Array<{ filename: string; content: string }>;
  assert.equal(attachments.length, 1);
  assert.match(attachments[0].filename, /UEA-APP-2026-0001/);
  const attachedPdf = new Uint8Array(Buffer.from(attachments[0].content, 'base64'));
  const attachedText = decodePdfText(attachedPdf);
  assert.match(attachedText, /IELTS Preparation/);
  assert.match(attachedText, /UEA-STU-2026-0001/);
  assert.doesNotMatch(attachedText, /Other Course|Spoken English|Business English/);
});

test('approval retries failed delivery once and reuses the saved issuance on repeated approvals', async () => {
  const uploadedPdfs: string[] = [];
  let storedPdf: Uint8Array | null = null;
  let notificationCount = 0;
  let deliveryStatus: 'Pending' | 'Failed' | 'Sent' | null = null;
  let attemptCount = 0;
  let emailAttempts = 0;
  let approvalCalls = 0;
  const resendPayloads: Record<string, unknown>[] = [];
  const snapshot = {
    application: {
      id: applicationId,
      application_reference: student.applicationNumber,
      student_id: student.studentId,
      student_name: student.fullName,
      email: student.email,
      mobile: student.mobile,
      qualification: student.qualification,
      date_of_birth: student.dateOfBirth,
      address: student.address,
      photo_object_key: photoKey,
      program_id: programId,
      program_name: student.programName,
    },
    program: {
      id: programId,
      name: selectedCourse.name,
      duration: selectedCourse.duration,
      level: selectedCourse.level,
    },
    fee: {
      tuition_fee: selectedCourse.tuitionFee,
      registration_fee: selectedCourse.registrationFee,
      study_material_fee: selectedCourse.studyMaterialFee,
      other_charges: selectedCourse.otherCharges,
      discount_type: selectedCourse.discountType,
      discount_value: selectedCourse.discountValue,
      discount_amount: selectedCourse.discountAmount,
      final_payable: selectedCourse.finalPayable,
      agreed_total: null,
    },
    document_settings: DEFAULT_OFFICIAL_DOCUMENT_SETTINGS,
    joining_information: {
      joiningDate: '2026-02-01',
      classSchedule: 'Monday to Saturday',
      classTimings: '10:00 AM',
      venue: 'Davangere',
    },
  };
  const application = {
    id: applicationId,
    application_reference: student.applicationNumber,
    student_id: student.studentId,
    student_name: 'Editable Current Name',
    email: 'current-record@example.com',
    mobile: student.mobile,
    qualification: student.qualification,
    program_name: 'Current Editable Course',
  };
  const issuance = {
    id: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
    application_id: applicationId,
    application_reference: student.applicationNumber,
    snapshot,
    pdf_object_key: null as string | null,
    status: 'pending',
  };
  const env = makeWorkerEnv({
    APPLICATION_MEDIA: {
      get: async (key: string) => {
        const bytes = key === photoKey ? pngBytes : key === `official-documents/${applicationId}.pdf` ? storedPdf : null;
        if (!bytes) return null;
        return {
          body: new ReadableStream<Uint8Array>({
            start(controller) {
              controller.enqueue(bytes);
              controller.close();
            },
          }),
          httpMetadata: { contentType: key === photoKey ? 'image/png' : 'application/pdf' },
        };
      },
      put: async (key: string, value: ArrayBuffer | ArrayBufferView) => {
        if (!key.startsWith('official-documents/')) throw new Error(`Unexpected R2 write: ${key}`);
        const bytes = value instanceof ArrayBuffer
          ? new Uint8Array(value)
          : new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
        storedPdf = bytes.slice();
        uploadedPdfs.push(key);
        issuance.pdf_object_key = key;
        issuance.status = 'ready';
      },
      delete: async () => undefined,
      list: async () => ({ objects: [] }),
    },
  });

  await withAdminFetch('super_admin', async (request, url) => {
    if (url.hostname === 'api.resend.com' && url.pathname === '/emails') {
      emailAttempts += 1;
      assert.equal(request.headers.get('Idempotency-Key'), `student-approval-${applicationId}`);
      resendPayloads.push(await request.json() as Record<string, unknown>);
      if (emailAttempts === 1) return Response.json({ message: 'Temporary provider failure.' }, { status: 503 });
      return Response.json({ id: 'resend-message-id' });
    }
    if (url.pathname.endsWith('/rpc/approve_application_with_official_snapshot')) {
      approvalCalls += 1;
      const requestBody = await request.json() as Record<string, unknown>;
      assert.equal(requestBody.p_application_id, applicationId);
      assert.equal(requestBody.p_approver_id, userId);
      assert.equal(requestBody.p_approver_name, 'Test Admin');
      assert.deepEqual(requestBody.p_joining_information, snapshot.joining_information);
      return Response.json({ application, issuance });
    }
    if (url.pathname.endsWith('/rpc/claim_student_approval_notification')) {
      const requestBody = await request.json() as Record<string, unknown>;
      assert.equal(requestBody.p_application_id, applicationId);
      if (deliveryStatus === 'Sent' || deliveryStatus === 'Pending') {
        return Response.json([{
          notification_id: 'ffffffff-ffff-4fff-8fff-ffffffffffff',
          claimed: false,
          status: deliveryStatus,
          attempt_count: attemptCount,
        }]);
      }
      if (deliveryStatus === null) notificationCount += 1;
      deliveryStatus = 'Pending';
      attemptCount += 1;
      return Response.json([{
        notification_id: 'ffffffff-ffff-4fff-8fff-ffffffffffff',
        claimed: true,
        status: 'Pending',
        attempt_count: attemptCount,
      }]);
    }
    if (url.pathname.endsWith('/rpc/complete_student_approval_notification')) {
      const requestBody = await request.json() as Record<string, unknown>;
      deliveryStatus = requestBody.p_success ? 'Sent' : 'Failed';
      return new Response(null, { status: 204 });
    }
    if (url.pathname.endsWith('/application_notifications')) {
      return Response.json([{
        id: 'ffffffff-ffff-4fff-8fff-ffffffffffff',
        application_id: applicationId,
        notification_type: 'student_approval',
        recipient_email: 'stale-notification@example.com',
        attempt_count: attemptCount,
      }]);
    }
    if (url.pathname.endsWith('/applications')) return Response.json([application]);
    if (url.pathname.endsWith('/official_document_issuances')) return Response.json([issuance]);
    throw new Error(`Unexpected request: ${url.hostname}${url.pathname}`);
  }, async () => {
    const approvalRequest = () => handleApiRequest(
      authorizedRequest('/api/approve-application', 'POST', {
        application_id: applicationId,
        approved_by_name: 'Test Admin',
        joining_information: snapshot.joining_information,
      }),
      env,
    );

    const firstApproval = await approvalRequest();
    assert.equal(firstApproval.status, 200);
    const firstBody = await firstApproval.json() as { email_status: string; student_id: string };
    assert.match(firstBody.email_status, /^Failed:/);
    assert.equal(firstBody.student_id, student.studentId);
    assert.equal(deliveryStatus, 'Failed');

    const retry = await handleApiRequest(
      authorizedRequest('/api/retry-notification', 'POST', {
        notification_id: 'ffffffff-ffff-4fff-8fff-ffffffffffff',
      }),
      env,
    );
    assert.equal(retry.status, 200);
    assert.deepEqual(await retry.json(), {
      success: true,
      status: 'Sent',
      message: 'Notification sent successfully on retry.',
    });

    const repeatedApproval = await approvalRequest();
    assert.equal(repeatedApproval.status, 200);
    const repeatedBody = await repeatedApproval.json() as { email_status: string; student_id: string };
    assert.equal(repeatedBody.email_status, 'Already sent');
    assert.equal(repeatedBody.student_id, student.studentId);
  });

  assert.equal(approvalCalls, 2);
  assert.equal(emailAttempts, 2);
  assert.deepEqual(resendPayloads[1], resendPayloads[0]);
  assert.equal(resendPayloads[0].to, student.email);
  assert.match(String(resendPayloads[0].html), /Test Learner/);
  assert.match(String(resendPayloads[0].html), /IELTS Preparation/);
  assert.doesNotMatch(String(resendPayloads[0].html), /Editable Current Name|Current Editable Course|stale-notification/);
  assert.equal(notificationCount, 1);
  assert.equal(attemptCount, 2);
  assert.deepEqual(uploadedPdfs, [`official-documents/${applicationId}.pdf`]);
  assert.equal(deliveryStatus, 'Sent');
  assert.ok(storedPdf);
  const savedPdfText = decodePdfText(storedPdf);
  assert.match(savedPdfText, /IELTS Preparation/);
  assert.match(savedPdfText, /UEA-STU-2026-0001/);
  assert.doesNotMatch(savedPdfText, /Current Editable Course|Other Course/);
});

test('official PDF settings require super-admin and store uploaded assets privately', async () => {
  const savedSettings: Record<string, unknown>[] = [];
  const uploadedKeys: string[] = [];
  const env = makeWorkerEnv({
    APPLICATION_MEDIA: {
      put: async (key: string) => { uploadedKeys.push(key); },
      delete: async () => undefined,
      list: async () => ({ objects: [] }),
    },
  });
  const requestBody = {
    settings: {
      ...DEFAULT_OFFICIAL_DOCUMENT_SETTINGS,
      heading: 'Updated Admission Confirmation',
      terms: ['Attendance is required.'],
    },
    logo_file_base64: `data:image/png;base64,${Buffer.from(pngBytes).toString('base64')}`,
  };

  await withAdminFetch('admin', async () => Response.json([]), async () => {
    const response = await handleApiRequest(
      authorizedRequest('/api/admin/official-document', 'PUT', requestBody),
      env,
    );
    assert.equal(response.status, 403);
  });

  await withAdminFetch('super_admin', async (request, url) => {
    if (!url.pathname.endsWith('/official_document_settings')) {
      throw new Error(`Unexpected Supabase request: ${url.pathname}`);
    }
    if (request.method === 'GET') return Response.json([]);
    const body = await request.json() as { document_data: Record<string, unknown> } | Array<{ document_data: Record<string, unknown> }>;
    const row = Array.isArray(body) ? body[0] : body;
    savedSettings.push(row.document_data);
    return Response.json(row);
  }, async () => {
    const response = await handleApiRequest(
      authorizedRequest('/api/admin/official-document', 'PUT', requestBody),
      env,
    );
    assert.equal(response.status, 200);
    const body = await response.json() as { settings: Record<string, unknown> };
    assert.equal(body.settings.heading, 'Updated Admission Confirmation');
    assert.deepEqual(body.settings.terms, ['Attendance is required.']);
    assert.match(String(body.settings.logoObjectKey), /^official-document-assets\/[0-9a-f-]+\.png$/i);
  });
  assert.equal(savedSettings[0]?.heading, 'Updated Admission Confirmation');
  assert.equal(uploadedKeys.length, 1);
  assert.match(uploadedKeys[0], /^official-document-assets\/[0-9a-f-]+\.png$/i);
});

test('enrollment PDF loads the configured private logo through the authenticated asset endpoint', async () => {
  const logoKey = 'official-document-assets/eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee.png';
  let fetchedKey = '';
  const configuredSettings = { ...DEFAULT_OFFICIAL_DOCUMENT_SETTINGS, logoObjectKey: logoKey };
  const env = makeWorkerEnv({
    APPLICATION_MEDIA: {
      get: async (key: string) => {
        fetchedKey = key;
        return {
          body: new ReadableStream<Uint8Array>({
            start(controller) {
              controller.enqueue(pngBytes);
              controller.close();
            },
          }),
          httpMetadata: { contentType: 'image/png' },
        };
      },
      put: async () => undefined,
      delete: async () => undefined,
      list: async () => ({ objects: [] }),
    },
  });

  await withAdminFetch('staff', async (request, url) => {
    if (!url.pathname.endsWith('/official_document_settings')) {
      throw new Error(`Unexpected Supabase request: ${url.pathname}`);
    }
    return Response.json([{ setting_key: 'official_fee_structure', document_data: configuredSettings }]);
  }, async () => {
    const response = await handleApiRequest(
      authorizedRequest('/api/admin/official-document/assets?type=logo'),
      env,
    );
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('content-type'), 'image/png');
    assert.deepEqual(new Uint8Array(await response.arrayBuffer()), pngBytes);
  });

  assert.equal(fetchedKey, logoKey);
  const adminPortal = await readFile(new URL('../src/pages/AdminPortal.tsx', import.meta.url), 'utf8');
  assert.match(adminPortal, /fetchAdmin\('\/api\/admin\/official-document\/assets\?type=logo'/);
  assert.doesNotMatch(adminPortal, /const logoUrl = "https:\/\/gpnfznwqwaokfzmozpxo\.supabase\.co/);
});

test('course fee endpoint persists editable fee components for an admin', async () => {
  const submittedRows: Record<string, unknown>[] = [];
  await withAdminFetch('admin', async (request, url) => {
    assert.ok(url.pathname.endsWith('/program_fee_configurations'));
    assert.equal(request.method, 'POST');
    const payload = await request.json() as Record<string, unknown> | Array<Record<string, unknown>>;
    const body = Array.isArray(payload) ? payload[0] : payload;
    submittedRows.push(body);
    return Response.json({
      ...body,
      final_payable: 13000,
      updated_at: '2026-01-01T00:00:00Z',
    });
  }, async () => {
    const response = await handleApiRequest(
      authorizedRequest(`/api/admin/programs/${programId}/fee`, 'PUT', {
        tuition_fee: 12000,
        registration_fee: 500,
        study_material_fee: 750,
        other_charges: 250,
        discount_type: 'amount',
        discount_value: 500,
      }),
      makeWorkerEnv(),
    );
    assert.equal(response.status, 200);
    const body = await response.json() as { final_payable: number };
    assert.equal(body.final_payable, 13000);
  });
  assert.deepEqual(submittedRows[0], {
    program_id: programId,
    tuition_fee: 12000,
    registration_fee: 500,
    study_material_fee: 750,
    other_charges: 250,
    discount_type: 'amount',
    discount_value: 500,
    updated_by: userId,
  });
});

test('database migration uses independent yearly sequences and atomic immutable fee snapshots', async () => {
  const migration = await readFile(
    new URL('../supabase/migrations/20261030000007_dynamic_official_documents_and_course_fees.sql', import.meta.url),
    'utf8',
  );
  assert.match(migration, /v_prefix := 'application_number'/);
  assert.match(migration, /v_prefix := 'student_number'/);
  assert.match(migration, /CREATE SEQUENCE IF NOT EXISTS public\.%I/);
  assert.match(migration, /nextval\(%L::regclass\)/);
  assert.match(migration, /RETURN format\('UEA-%s-%s-%s'/);
  assert.match(migration, /pg_advisory_xact_lock\(\s*pg_catalog\.hashtextextended\(v_sequence_name, 0\)/);
  assert.match(migration, /v_last_value > 9999 OR \(v_is_called AND v_last_value >= 9999\)/);
  assert.match(migration, /exhausted at 9999/);
  assert.match(migration, /v_number > 9999/);
  assert.match(migration, /regexp_match\(\s*application_reference,\s*'\^UEA-APP-/);
  assert.match(migration, /regexp_match\(\s*student_id,\s*'\^UEA-STU-/);
  assert.match(migration, /pg_catalog\.setval/);
  assert.match(migration, /NEW\.application_reference := OLD\.application_reference/);
  assert.match(migration, /NEW\.student_id := OLD\.student_id/);
  assert.match(migration, /IF NEW\.status <> 'Pending' THEN\s+RAISE EXCEPTION 'Applications must be submitted as pending\.'/);
  assert.match(migration, /CREATE POLICY "Public can submit applications" ON public\.applications\s+FOR INSERT WITH CHECK \(status = 'Pending'\)/);
  assert.match(migration, /NEW\.status = 'Accepted' AND NEW\.student_id IS NULL/);
  assert.match(migration, /CREATE UNIQUE INDEX IF NOT EXISTS idx_applications_student_id_unique/);
  assert.match(migration, /FROM public\.applications\s+WHERE id = p_application_id\s+FOR UPDATE/);
  assert.match(migration, /'document_settings', COALESCE\(v_settings/);
  assert.match(migration, /'agreed_total', v_agreement\.agreed_total/);
  assert.match(migration, /ON CONFLICT \(application_id\) DO NOTHING/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS public\.official_approval_email_state/);
  assert.match(migration, /claim_student_approval_notification/);
  assert.match(migration, /complete_student_approval_notification/);
  assert.match(migration, /FROM public\.application_notifications\s+WHERE notification_type = 'student_approval'/);
  assert.match(migration, /GRANT EXECUTE ON FUNCTION public\.claim_student_approval_notification[\s\S]+TO service_role/);
  assert.match(migration, /ALTER TABLE public\.official_document_issuances ENABLE ROW LEVEL SECURITY/);
});
