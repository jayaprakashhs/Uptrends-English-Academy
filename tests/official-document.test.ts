import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { inflateSync } from 'node:zlib';
import { PDFDocument } from 'pdf-lib';
import {
  DEFAULT_OFFICIAL_DOCUMENT_SETTINGS,
  generateOfficialPdf,
  summarizeOfficialPayments,
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
  });
  const pdf = await PDFDocument.load(bytes);
  assert.equal(pdf.getPageCount(), 1);
  assert.equal(pdf.getPages()[0].getWidth(), 595.28);
  const text = decodePdfText(bytes);
  assert.match(text, /ADMISSION CONFIRMATION/);
  assert.match(text, /IELTS Preparation/);
  assert.match(text, /UEA-STU-2026-0001/);
  assert.match(text, /UEA-APP-2026-0001/);
  assert.match(text, /PAYMENT PENDING/);
  assert.match(text, /INR 0\.00/);
  assert.doesNotMatch(text, /Spoken English|Business English|Other Course/);
});

test('graduate and working PDFs use applicant contacts and never parent contacts', async () => {
  for (const qualificationCategory of ['Graduate', 'Working'] as const) {
    const bytes = await generateOfficialPdf({
      settings: DEFAULT_OFFICIAL_DOCUMENT_SETTINGS,
      student: {
        ...student,
        qualificationCategory,
        email: `${qualificationCategory.toLowerCase()}@example.com`,
        mobile: '+919876500001',
        parentEmail: 'hidden-parent@example.com',
        parentPhone: 'HIDDEN-PARENT-PHONE',
      },
      course: selectedCourse,
    });
    const text = decodePdfText(bytes);
    assert.match(text, /Mobile Number/);
    assert.match(text, /Email ID/);
    assert.match(text, /\+919876500001/);
    assert.match(text, new RegExp(`${qualificationCategory.toLowerCase()}@example\\.com`));
    assert.doesNotMatch(text, /Parent Phone Number|Parent Email ID|hidden-parent|HIDDEN-PARENT/);
  }
});

test('missing photo and long document content produce a readable multipage PDF', async () => {
  const longTerm = `Attendance terms ${'with detailed conditions '.repeat(28)}`;
  const longStudent = `${'Long Applicant Name '.repeat(10)}End`;
  const bytes = await generateOfficialPdf({
    settings: {
      ...DEFAULT_OFFICIAL_DOCUMENT_SETTINGS,
      joiningInstructions: [`${'Joining instruction '.repeat(25)}Last instruction detail`],
      terms: [longTerm],
    },
    student: { ...student, fullName: longStudent },
    course: selectedCourse,
  });
  const pdf = await PDFDocument.load(bytes);
  const text = decodePdfText(bytes);
  assert.ok(pdf.getPageCount() > 1);
  assert.match(text, /End/);
  assert.match(text, /Last instruction/);
  assert.match(text, /Attendance terms/);
});

test('payment summary handles pending, partial, fully paid, and multiple records', () => {
  assert.deepEqual(summarizeOfficialPayments(1500, []), {
    totalPayable: 1500,
    totalPaid: 0,
    outstandingBalance: 1500,
    status: 'pending',
    payments: [],
  });

  const payments = [
    { id: 'payment-1', amount: 400, paymentMethod: 'upi', paymentStage: 'first_fee', recordedAt: '2026-10-30T10:00:00Z', referenceNumber: 'REF-1' },
    { id: 'payment-2', amount: 300, paymentMethod: 'cash', paymentStage: 'installment', recordedAt: '2026-10-31T10:00:00Z', referenceNumber: null },
  ];
  assert.deepEqual(summarizeOfficialPayments(1500, payments), {
    totalPayable: 1500,
    totalPaid: 700,
    outstandingBalance: 800,
    status: 'partially_paid',
    payments,
  });
  assert.equal(summarizeOfficialPayments(700, payments).status, 'fully_paid');
  assert.equal(summarizeOfficialPayments(650, payments).outstandingBalance, 0);
});

test('official preview uses marked placeholder data without reading student records or photos', async () => {
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
    throw new Error(`Unexpected Supabase request: ${url.pathname}`);
  }, async () => {
    const response = await handleApiRequest(
      authorizedRequest('/api/admin/official-document/preview', 'POST', {}),
      env,
    );
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('Content-Type'), 'application/pdf');
    assert.equal(response.headers.get('Cache-Control'), 'private, no-store');
    const bytes = new Uint8Array(await response.arrayBuffer());
    assert.equal(new TextDecoder().decode(bytes.slice(0, 5)), '%PDF-');
    assert.equal((await PDFDocument.load(bytes)).getPageCount(), 1);
    const text = decodePdfText(bytes);
    assert.match(text, /PREVIEW ONLY - NOT AN OFFICIAL STUDENT DOCUMENT/);
    assert.match(text, /PREVIEW APPLICANT/);
    assert.match(text, /Selected program \(preview\)/);
    assert.doesNotMatch(text, /Test Learner|IELTS Preparation|UEA-STU-2026-0001/);
  });
  assert.deepEqual(photoReads, []);
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
  assert.equal(uploaded[0].key, `official-documents/${applicationId}/v1-eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee.pdf`);
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
  assert.match(attachedText, /PAYMENT PENDING/);
  assert.match(attachedText, /INR 0\.00/);
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
        const versionedPdfKey = `official-documents/${applicationId}/v1-${issuance.id}.pdf`;
        const bytes = key === photoKey ? pngBytes : key === versionedPdfKey ? storedPdf : null;
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
  assert.deepEqual(uploadedPdfs, [`official-documents/${applicationId}/v1-${issuance.id}.pdf`]);
  assert.equal(deliveryStatus, 'Sent');
  assert.ok(storedPdf);
  const savedPdfText = decodePdfText(storedPdf);
  assert.match(savedPdfText, /IELTS Preparation/);
  assert.match(savedPdfText, /UEA-STU-2026-0001/);
  assert.doesNotMatch(savedPdfText, /Current Editable Course|Other Course/);
});

test('recorded payment creates and emails an immutable PDF version using snapshot data', async () => {
  const issuanceId = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
  const paymentId = '99999999-9999-4999-8999-999999999999';
  const idempotencyKey = '88888888-8888-4888-8888-888888888888';
  const versionKey = `official-documents/${applicationId}/v2-${issuanceId}.pdf`;
  const logoKey = 'official-document-assets/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.png';
  const storedObjects = new Map<string, Uint8Array>();
  const uploads: string[] = [];
  const assetReads: string[] = [];
  const paymentEmails: Record<string, unknown>[] = [];
  let paymentCreateCalls = 0;
  const snapshot = {
    application: {
      id: applicationId,
      application_reference: student.applicationNumber,
      student_id: student.studentId,
      student_name: 'Student Category Learner',
      qualification_category: 'Student',
      qualification: '10th Standard',
      program_name: 'Spoken English',
      email: 'parent@example.com',
      mobile: 'HIDDEN-APPLICANT-MOBILE',
      parent_phone: '+919876500001',
      parent_email: 'parent@example.com',
      photo_object_key: photoKey,
    },
    program: { id: programId, name: 'Spoken English', duration: '3 months', mode: 'Regular classroom' },
    fee: {
      tuition_fee: 12000,
      registration_fee: 500,
      study_material_fee: 0,
      other_charges: 0,
      discount_type: 'amount',
      discount_value: 500,
      discount_amount: 500,
      final_payable: 12000,
      agreed_total: 10000,
    },
    payments: [
      { id: 'payment-earlier', amount: 1500, payment_method: 'upi', payment_stage: 'first_fee', recorded_at: '2026-10-29T10:00:00Z', reference_number: 'UPI-7788' },
      { id: paymentId, amount: 2500, payment_method: 'bank_transfer', payment_stage: 'installment', recorded_at: '2026-10-31T10:00:00Z', reference_number: 'BANK-REF-22' },
    ],
    document_settings: {
      ...DEFAULT_OFFICIAL_DOCUMENT_SETTINGS,
      logoObjectKey: logoKey,
      joiningInstructions: ['Bring the admission confirmation slip.'],
      terms: ['Saved attendance terms.'],
    },
    joining_information: {
      joiningDate: '2026-11-02',
      classSchedule: 'Monday to Saturday',
      classTimings: '10:00 AM',
      venue: 'Davangere',
    },
    payment_summary: { total_payable: 10000, total_paid: 4000, outstanding_balance: 6000, status: 'partially_paid' },
  };
  const issuance: Record<string, any> = {
    id: issuanceId,
    application_id: applicationId,
    application_reference: student.applicationNumber,
    student_id: student.studentId,
    version_number: 2,
    issuance_type: 'payment_update',
    snapshot,
    pdf_object_key: null,
    status: 'pending',
  };
  const notification = {
    id: '77777777-7777-4777-8777-777777777777',
    recipient_email: 'parent@example.com',
    status: 'Pending',
  };
  const env = makeWorkerEnv({
    APPLICATION_MEDIA: {
      get: async (key: string) => {
        assetReads.push(key);
        const bytes = key === photoKey || key === logoKey ? pngBytes : storedObjects.get(key);
        if (!bytes) return null;
        return {
          body: new ReadableStream<Uint8Array>({
            start(controller) {
              controller.enqueue(bytes);
              controller.close();
            },
          }),
          httpMetadata: { contentType: key === photoKey || key === logoKey ? 'image/png' : 'application/pdf' },
        };
      },
      put: async (key: string, value: ArrayBuffer | ArrayBufferView) => {
        const bytes = value instanceof ArrayBuffer
          ? new Uint8Array(value)
          : new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
        storedObjects.set(key, bytes.slice());
        uploads.push(key);
      },
      delete: async () => undefined,
      list: async () => ({ objects: [] }),
    },
  });

  await withAdminFetch('admin', async (request, url) => {
    if (url.hostname === 'api.resend.com' && url.pathname === '/emails') {
      assert.equal(request.headers.get('Idempotency-Key'), `student-payment-update-${issuanceId}`);
      paymentEmails.push(await request.json() as Record<string, unknown>);
      return Response.json({ id: 'payment-update-message-id' });
    }
    if (url.pathname.endsWith('/rpc/create_application_payment_idempotent')) {
      paymentCreateCalls += 1;
      const body = await request.json() as Record<string, unknown>;
      assert.equal(body.p_application_id, applicationId);
      assert.equal(body.p_idempotency_key, idempotencyKey);
      return Response.json({ ...body, id: paymentId, application_id: applicationId, recorded_at: '2026-10-31T10:00:00Z' });
    }
    if (url.pathname.endsWith('/rpc/enqueue_official_document_payment_version')) {
      const body = await request.json() as Record<string, unknown>;
      assert.equal(body.p_application_id, applicationId);
      assert.match(String(body.p_event_key), /^payment:/);
      return Response.json(issuanceId);
    }
    if (url.pathname.endsWith('/official_document_issuances')) {
      if (url.searchParams.has('id')) return Response.json([issuance]);
      return Response.json(issuance.status === 'ready' ? [] : [{ id: issuanceId, version_number: 2, status: 'pending' }]);
    }
    if (url.pathname.endsWith('/rpc/claim_official_document_issuance')) {
      return Response.json([{ claimed: true, status: 'processing' }]);
    }
    if (url.pathname.endsWith('/rpc/complete_official_document_issuance')) {
      const body = await request.json() as Record<string, unknown>;
      assert.equal(body.p_success, true);
      issuance.pdf_object_key = String(body.p_pdf_object_key);
      issuance.status = 'ready';
      return new Response(null, { status: 204 });
    }
    if (url.pathname.endsWith('/application_notifications')) return Response.json([notification]);
    if (url.pathname.endsWith('/rpc/claim_official_document_notification')) {
      return Response.json([{ claimed: true, status: 'Pending', attempt_count: 1 }]);
    }
    if (url.pathname.endsWith('/rpc/complete_official_document_notification')) {
      const body = await request.json() as Record<string, unknown>;
      assert.equal(body.p_success, true);
      notification.status = 'Sent';
      return new Response(null, { status: 204 });
    }
    throw new Error(`Unexpected Supabase request: ${url.pathname}`);
  }, async () => {
    const makePaymentRequest = () => new Request(`https://academy.example/api/admin/applications/${applicationId}/payments`, {
        method: 'POST',
        headers: {
          Authorization: 'Bearer test-admin-token',
          'Content-Type': 'application/json',
          'Idempotency-Key': idempotencyKey,
        },
        body: JSON.stringify({
          amount: 2500,
          payment_method: 'bank_transfer',
          payment_stage: 'installment',
          reference_number: 'BANK-REF-22',
        }),
      });
    const response = await handleApiRequest(makePaymentRequest(), env);
    assert.equal(response.status, 201);
    const body = await response.json() as { document_update: { success: boolean; versions: Array<{ status: string; version_number?: number }> } };
    assert.equal(body.document_update.success, true);
    assert.equal(body.document_update.versions[0]?.status, 'Sent');
    assert.equal(body.document_update.versions[0]?.version_number, 2);

    const duplicateResponse = await handleApiRequest(makePaymentRequest(), env);
    assert.equal(duplicateResponse.status, 201);
    const duplicateBody = await duplicateResponse.json() as { document_update: { success: boolean; versions: unknown[] } };
    assert.equal(duplicateBody.document_update.success, true);
    assert.equal(duplicateBody.document_update.versions.length, 0);
  });

  assert.equal(paymentCreateCalls, 2);
  assert.deepEqual(uploads, [versionKey]);
  assert.ok(assetReads.includes(photoKey));
  assert.ok(assetReads.includes(logoKey));
  assert.equal(paymentEmails.length, 1);
  assert.equal(paymentEmails[0]?.to, 'parent@example.com');
  assert.match(String(paymentEmails[0]?.subject), /Payment update/);
  assert.doesNotMatch(String(paymentEmails[0]?.subject), /Congratulations|approved/i);
  const attachments = paymentEmails[0]?.attachments as Array<{ content: string }>;
  assert.equal(attachments.length, 1);
  const pdfText = decodePdfText(new Uint8Array(Buffer.from(attachments[0].content, 'base64')));
  assert.match(pdfText, /Version 2/);
  assert.match(pdfText, /Parent Phone Number/);
  assert.match(pdfText, /\+919876500001/);
  assert.match(pdfText, /parent@example.com/);
  assert.doesNotMatch(pdfText, /HIDDEN-APPLICANT-MOBILE/);
  assert.match(pdfText, /Regular classroom/);
  assert.match(pdfText, /UPI-7788/);
  assert.match(pdfText, /BANK-REF-22/);
  assert.match(pdfText, /PARTIALLY PAID/);
  assert.match(pdfText, /INR 6,000.00/);
  assert.match(pdfText, /Bring the admission confirmation slip/);
  assert.match(pdfText, /Saved attendance terms/);
});

test('failed payment email retry reuses the saved PDF version without uploading another copy', async () => {
  const issuanceId = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
  const notificationId = '77777777-7777-4777-8777-777777777777';
  const paymentId = '99999999-9999-4999-8999-999999999999';
  const idempotencyKey = '88888888-8888-4888-8888-888888888888';
  const versionKey = `official-documents/${applicationId}/v2-${issuanceId}.pdf`;
  const storedObjects = new Map<string, Uint8Array>();
  const uploads: string[] = [];
  const resendPayloads: Record<string, unknown>[] = [];
  let emailStatus = 'Pending';
  let emailAttempts = 0;
  const issuance: Record<string, any> = {
    id: issuanceId,
    application_id: applicationId,
    application_reference: student.applicationNumber,
    student_id: student.studentId,
    version_number: 2,
    issuance_type: 'payment_update',
    snapshot: {
      application: {
        id: applicationId,
        application_reference: student.applicationNumber,
        student_id: student.studentId,
        student_name: student.fullName,
        qualification_category: 'Graduate',
        qualification: student.qualification,
        program_name: student.programName,
        email: student.email,
        mobile: student.mobile,
      },
      program: { name: student.programName, duration: '12 weeks' },
      fee: { tuition_fee: 12000, final_payable: 12000, agreed_total: 12000 },
      payments: [],
      payment_summary: { total_payable: 12000, total_paid: 1000, outstanding_balance: 11000, status: 'partially_paid' },
      document_settings: DEFAULT_OFFICIAL_DOCUMENT_SETTINGS,
      joining_information: {},
    },
    pdf_object_key: null,
    status: 'pending',
  };
  const notification: Record<string, unknown> = {
    id: notificationId,
    application_id: applicationId,
    official_document_issuance_id: issuanceId,
    notification_type: 'student_payment_update',
    recipient_email: student.email,
    status: 'Pending',
    attempt_count: 0,
  };
  const env = makeWorkerEnv({
    APPLICATION_MEDIA: {
      get: async (key: string) => {
        const bytes = storedObjects.get(key);
        if (!bytes) return null;
        return {
          body: new ReadableStream<Uint8Array>({
            start(controller) {
              controller.enqueue(bytes);
              controller.close();
            },
          }),
          httpMetadata: { contentType: 'application/pdf' },
        };
      },
      put: async (key: string, value: ArrayBuffer | ArrayBufferView) => {
        const bytes = value instanceof ArrayBuffer
          ? new Uint8Array(value)
          : new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
        storedObjects.set(key, bytes.slice());
        uploads.push(key);
      },
      delete: async () => undefined,
      list: async () => ({ objects: [] }),
    },
  });

  await withAdminFetch('super_admin', async (request, url) => {
    if (url.hostname === 'api.resend.com' && url.pathname === '/emails') {
      emailAttempts += 1;
      assert.equal(request.headers.get('Idempotency-Key'), `student-payment-update-${issuanceId}`);
      resendPayloads.push(await request.json() as Record<string, unknown>);
      return emailAttempts === 1
        ? Response.json({ message: 'Temporary provider failure.' }, { status: 503 })
        : Response.json({ id: 'payment-update-message-id' });
    }
    if (url.pathname.endsWith('/rpc/create_application_payment_idempotent')) {
      const body = await request.json() as Record<string, unknown>;
      assert.equal(body.p_idempotency_key, idempotencyKey);
      return Response.json({ id: paymentId, application_id: applicationId });
    }
    if (url.pathname.endsWith('/rpc/enqueue_official_document_payment_version')) {
      const body = await request.json() as Record<string, unknown>;
      assert.equal(body.p_application_id, applicationId);
      assert.match(String(body.p_event_key), /^payment:/);
      return Response.json(issuanceId);
    }
    if (url.pathname.endsWith('/official_document_issuances')) {
      if (url.searchParams.has('id')) return Response.json([issuance]);
      return Response.json(issuance.status === 'ready' ? [] : [{ id: issuanceId, version_number: 2, status: issuance.status }]);
    }
    if (url.pathname.endsWith('/application_notifications')) return Response.json([notification]);
    if (url.pathname.endsWith('/applications')) {
      return Response.json([{ application_reference: student.applicationNumber, student_id: student.studentId }]);
    }
    if (url.pathname.endsWith('/rpc/claim_official_document_issuance')) {
      return Response.json([{ claimed: true, status: 'processing' }]);
    }
    if (url.pathname.endsWith('/rpc/complete_official_document_issuance')) {
      const body = await request.json() as Record<string, unknown>;
      issuance.status = body.p_success ? 'ready' : 'failed';
      issuance.pdf_object_key = body.p_pdf_object_key;
      return new Response(null, { status: 204 });
    }
    if (url.pathname.endsWith('/rpc/claim_official_document_notification')) {
      emailStatus = 'Pending';
      return Response.json([{ claimed: true, status: emailStatus, attempt_count: emailAttempts + 1 }]);
    }
    if (url.pathname.endsWith('/rpc/complete_official_document_notification')) {
      const body = await request.json() as Record<string, unknown>;
      emailStatus = body.p_success ? 'Sent' : 'Failed';
      notification.status = emailStatus;
      return new Response(null, { status: 204 });
    }
    throw new Error(`Unexpected Supabase request: ${url.pathname}`);
  }, async () => {
    const paymentRequest = () => new Request(`https://academy.example/api/admin/applications/${applicationId}/payments`, {
      method: 'POST',
      headers: {
        Authorization: 'Bearer test-admin-token',
        'Content-Type': 'application/json',
        'Idempotency-Key': idempotencyKey,
      },
      body: JSON.stringify({ amount: 1000, payment_method: 'upi', payment_stage: 'first_fee' }),
    });
    const savedPayment = await handleApiRequest(paymentRequest(), env);
    assert.equal(savedPayment.status, 201);
    const savedBody = await savedPayment.json() as { document_update: { success: boolean } };
    assert.equal(savedBody.document_update.success, false);
    assert.equal(issuance.status, 'ready');
    assert.equal(emailStatus, 'Failed');

    const retry = await handleApiRequest(
      authorizedRequest('/api/retry-notification', 'POST', { notification_id: notificationId }),
      env,
    );
    assert.equal(retry.status, 200);
    const retryBody = await retry.json() as { success: boolean; status: string };
    assert.equal(retryBody.success, true);
    assert.equal(retryBody.status, 'Sent');
  });

  assert.deepEqual(uploads, [versionKey]);
  assert.equal(emailAttempts, 2);
  assert.equal(emailStatus, 'Sent');
  assert.equal(resendPayloads[0]?.to, resendPayloads[1]?.to);
  assert.deepEqual(resendPayloads[0]?.attachments, resendPayloads[1]?.attachments);
});

test('a PDF generation failure leaves the recorded payment saved and its version retryable', async () => {
  const issuanceId = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
  const paymentId = '99999999-9999-4999-8999-999999999999';
  const idempotencyKey = '88888888-8888-4888-8888-888888888888';
  let paymentSaved = false;
  let generationFailureRecorded = false;
  const issuance = {
    id: issuanceId,
    application_id: applicationId,
    application_reference: student.applicationNumber,
    student_id: student.studentId,
    version_number: 2,
    issuance_type: 'payment_update',
    snapshot: {
      application: {
        id: applicationId,
        application_reference: student.applicationNumber,
        student_id: student.studentId,
        student_name: student.fullName,
        email: student.email,
        qualification: student.qualification,
        qualification_category: 'Graduate',
        program_name: student.programName,
        photo_object_key: photoKey,
      },
      program: { name: student.programName, duration: '12 weeks' },
      fee: { tuition_fee: 12000, final_payable: 12000, agreed_total: 12000 },
      payments: [],
      document_settings: DEFAULT_OFFICIAL_DOCUMENT_SETTINGS,
      joining_information: {},
    },
    pdf_object_key: null,
    status: 'pending',
  };
  const env = makeWorkerEnv({
    APPLICATION_MEDIA: {
      get: async () => null,
      put: async () => { throw new Error('PDF generation should fail before upload.'); },
      delete: async () => undefined,
      list: async () => ({ objects: [] }),
    },
  });

  await withAdminFetch('admin', async (request, url) => {
    if (url.pathname.endsWith('/rpc/create_application_payment_idempotent')) {
      paymentSaved = true;
      return Response.json({ id: paymentId, application_id: applicationId });
    }
    if (url.pathname.endsWith('/rpc/enqueue_official_document_payment_version')) {
      const body = await request.json() as Record<string, unknown>;
      assert.equal(body.p_application_id, applicationId);
      assert.match(String(body.p_event_key), /^payment:/);
      return Response.json(issuanceId);
    }
    if (url.pathname.endsWith('/official_document_issuances')) {
      return Response.json(url.searchParams.has('id') ? [issuance] : [{ id: issuanceId, version_number: 2, status: 'pending' }]);
    }
    if (url.pathname.endsWith('/rpc/claim_official_document_issuance')) {
      return Response.json([{ claimed: true, status: 'processing' }]);
    }
    if (url.pathname.endsWith('/rpc/complete_official_document_issuance')) {
      const body = await request.json() as Record<string, unknown>;
      assert.equal(body.p_success, false);
      generationFailureRecorded = true;
      return new Response(null, { status: 204 });
    }
    throw new Error(`Unexpected Supabase request: ${url.pathname}`);
  }, async () => {
    const response = await handleApiRequest(
      new Request(`https://academy.example/api/admin/applications/${applicationId}/payments`, {
        method: 'POST',
        headers: {
          Authorization: 'Bearer test-admin-token',
          'Content-Type': 'application/json',
          'Idempotency-Key': idempotencyKey,
        },
        body: JSON.stringify({ amount: 1000, payment_method: 'upi', payment_stage: 'first_fee' }),
      }),
      env,
    );
    assert.equal(response.status, 201);
    const body = await response.json() as { payment: { id: string }; document_update: { success: boolean } };
    assert.equal(body.payment.id, paymentId);
    assert.equal(body.document_update.success, false);
  });

  assert.equal(paymentSaved, true);
  assert.equal(generationFailureRecorded, true);
});

test('authorized admins can list sanitized history and download an older PDF version', async () => {
  const firstVersionKey = `official-documents/${applicationId}/v1-eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee.pdf`;
  const secondVersionKey = `official-documents/${applicationId}/v2-ffffffff-ffff-4fff-8fff-ffffffffffff.pdf`;
  const pdfBytes = await generateOfficialPdf({ settings: DEFAULT_OFFICIAL_DOCUMENT_SETTINGS, student, course: selectedCourse });
  const versions = [
    {
      id: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
      application_id: applicationId,
      application_reference: student.applicationNumber,
      student_id: student.studentId,
      version_number: 1,
      issuance_type: 'approval',
      status: 'ready',
      email_status: 'Sent',
      generated_at: '2026-10-30T10:00:00Z',
      created_at: '2026-10-30T09:00:00Z',
      pdf_object_key: firstVersionKey,
      snapshot: { payment_summary: { status: 'pending', total_paid: 0, outstanding_balance: 13000 } },
    },
    {
      id: 'ffffffff-ffff-4fff-8fff-ffffffffffff',
      application_id: applicationId,
      application_reference: student.applicationNumber,
      student_id: student.studentId,
      version_number: 2,
      issuance_type: 'payment_update',
      status: 'ready',
      email_status: 'Sent',
      generated_at: '2026-10-31T10:00:00Z',
      created_at: '2026-10-31T09:00:00Z',
      pdf_object_key: secondVersionKey,
      snapshot: { payment_summary: { status: 'partially_paid', total_paid: 4000, outstanding_balance: 9000 } },
    },
  ];
  let retrievedKey = '';
  const env = makeWorkerEnv({
    APPLICATION_MEDIA: {
      get: async (key: string) => {
        retrievedKey = key;
        return {
          body: new ReadableStream<Uint8Array>({
            start(controller) {
              controller.enqueue(pdfBytes);
              controller.close();
            },
          }),
          httpMetadata: { contentType: 'application/pdf' },
        };
      },
      put: async () => undefined,
      delete: async () => undefined,
      list: async () => ({ objects: [] }),
    },
  });

  await withAdminFetch('admin', async (_request, url) => {
    if (!url.pathname.endsWith('/official_document_issuances')) throw new Error(`Unexpected request: ${url.pathname}`);
    if (url.searchParams.has('version_number')) return Response.json([versions[0]]);
    return Response.json(versions);
  }, async () => {
    const historyResponse = await handleApiRequest(
      authorizedRequest(`/api/admin/official-document/versions?application_id=${applicationId}`),
      env,
    );
    assert.equal(historyResponse.status, 200);
    const history = await historyResponse.json() as Array<Record<string, unknown>>;
    assert.equal(history.length, 2);
    assert.equal(history[0]?.version_number, 1);
    assert.equal(history[1]?.version_number, 2);
    assert.equal('pdf_object_key' in history[0]!, false);

    const downloadResponse = await handleApiRequest(
      authorizedRequest(`/api/admin/official-document/issued?application_id=${applicationId}&version=1`),
      env,
    );
    assert.equal(downloadResponse.status, 200);
    assert.match(downloadResponse.headers.get('Content-Disposition') || '', /Issued_V1_/);
    assert.deepEqual(new Uint8Array(await downloadResponse.arrayBuffer()), pdfBytes);
  });

  assert.equal(retrievedKey, firstVersionKey);
  assert.notEqual(firstVersionKey, secondVersionKey);
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
      joiningInstructions: ['Bring the admission confirmation slip.'],
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
    assert.deepEqual(body.settings.joiningInstructions, ['Bring the admission confirmation slip.']);
    assert.deepEqual(body.settings.terms, ['Attendance is required.']);
    assert.match(String(body.settings.logoObjectKey), /^official-document-assets\/[0-9a-f-]+\.png$/i);
  });
  assert.equal(savedSettings[0]?.heading, 'Updated Admission Confirmation');
  assert.deepEqual(savedSettings[0]?.joiningInstructions, ['Bring the admission confirmation slip.']);
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

test('program course mode is saved as a nullable admin-editable program field', async () => {
  let savedCourseMode: unknown = null;
  await withAdminFetch('admin', async (request, url) => {
    if (!url.pathname.endsWith('/programs')) throw new Error(`Unexpected request: ${url.pathname}`);
    if (request.method === 'GET') {
      return Response.json([{ id: programId, image_url: null, image_object_key: null }]);
    }
    assert.equal(request.method, 'PATCH');
    const body = await request.json() as Record<string, unknown>;
    savedCourseMode = body.course_mode;
    return Response.json({ id: programId, ...body });
  }, async () => {
    const response = await handleApiRequest(
      authorizedRequest(`/api/admin/programs/${programId}`, 'PUT', { course_mode: 'Regular classroom' }),
      makeWorkerEnv(),
    );
    assert.equal(response.status, 200);
    const body = await response.json() as { course_mode: string };
    assert.equal(body.course_mode, 'Regular classroom');
  });
  assert.equal(savedCourseMode, 'Regular classroom');
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

test('payment PDF version migration reuses existing ledgers, issuance, and notification tables', async () => {
  const migration = await readFile(
    new URL('../supabase/migrations/20261031000004_official_document_payment_versions.sql', import.meta.url),
    'utf8',
  );
  assert.match(migration, /ADD COLUMN IF NOT EXISTS course_mode text/);
  assert.match(migration, /ADD COLUMN IF NOT EXISTS idempotency_key uuid/);
  assert.match(migration, /idx_application_payments_idempotency/);
  assert.match(migration, /DROP CONSTRAINT IF EXISTS official_document_issuances_application_id_key/);
  assert.match(migration, /WHEN application_id IS NULL THEN 'historical:' \|\| id::text/);
  assert.match(migration, /idx_official_document_issuances_application_version/);
  assert.match(migration, /build_official_document_snapshot/);
  assert.match(migration, /'qualification_category', v_application\.qualification_category/);
  assert.match(migration, /'parent_phone', v_application\.parent_phone/);
  assert.match(migration, /'parent_email', v_application\.parent_email/);
  assert.match(migration, /'mode', v_program\.course_mode/);
  assert.match(migration, /'payment_summary'/);
  assert.match(migration, /CREATE OR REPLACE FUNCTION public\.enqueue_official_document_payment_version/);
  assert.match(migration, /RETURNS uuid/);
  assert.doesNotMatch(migration, /CREATE TRIGGER trg_application_payments_official_document_version/);
  assert.match(migration, /FOR UPDATE/);
  assert.match(migration, /'student_payment_update'/);
  assert.match(migration, /claim_official_document_issuance/);
  assert.match(migration, /complete_official_document_issuance/);
  assert.match(migration, /claim_official_document_notification/);
  assert.match(migration, /complete_official_document_notification/);
  assert.match(migration, /earlier\.email_status <> 'Sent'/);
  assert.match(migration, /REVOKE ALL ON TABLE public\.application_notifications[\s\S]+TO service_role/);
  assert.doesNotMatch(migration, /CREATE TABLE IF NOT EXISTS public\.(application_payments|application_fee_agreements|official_document_issuances)/);
  assert.doesNotMatch(migration, /DELETE FROM public\.(application_payments|application_fee_agreements|official_document_issuances)/);
});
