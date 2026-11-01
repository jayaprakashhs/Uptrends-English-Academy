import assert from 'node:assert/strict';
import test from 'node:test';
import { renderBrandedEmail } from '../email-template';

test('renders the saved public logo centered with a fixed width and preserved ratio', () => {
  const email = renderBrandedEmail(
    { title: 'Application Received' },
    {
      logoUrl: 'branding/main-logo.png',
      publicAssetBaseUrl: 'https://assets.example',
    },
  );

  assert.match(email.html, /src="https:\/\/assets\.example\/branding\/main-logo\.png"/);
  assert.match(email.html, /alt="Uptrend's English Academy"/);
  assert.match(email.html, /align="center"/);
  assert.match(email.html, /width="180"[^>]+height:auto/);
  assert.match(email.text, /Application Received/);
  assert.match(email.text, /Davangere, Karnataka, India/);
});

test('includes the academy email signature without changing the plain-text alternative', () => {
  const email = renderBrandedEmail({ title: 'Application Received' });

  assert.match(email.html, /src="https:\/\/media\.uptrendsenglishacademy\.in\/bimi\/bimi-logo\.svg" width="100" alt="Uptrend's English Academy" style="[^"]*height:auto/);
  assert.match(email.html, /Uptrend&#39;s English Academy<\/strong>/);
  assert.match(email.html, /Spoken English \| Grammar \| Kids English/);
  assert.match(email.html, /Davangere, Karnataka/);
  assert.match(email.html, /href="https:\/\/uptrendsenglishacademy\.in"/);
  assert.doesNotMatch(email.text, /Spoken English|uptrendsenglishacademy\.in/);
});

test('falls back to the academy name when the logo is missing or unsafe', () => {
  for (const logoUrl of [null, 'http://assets.example/logo.png', 'https://private.r2.cloudflarestorage.com/logo.png']) {
    const email = renderBrandedEmail(
      { title: 'New Request' },
      { academyName: "Uptrend's English Academy", logoUrl },
    );

    assert.match(email.html, /Uptrend&#39;s English Academy/);
    assert.doesNotMatch(email.html, /src="http:\/\/assets\.example\/logo\.png"/);
    assert.match(email.html, /src="https:\/\/media\.uptrendsenglishacademy\.in\/bimi\/bimi-logo\.svg"/);
  }
});

test('escapes dynamic email content and emits a plain-text alternative', () => {
  const email = renderBrandedEmail({
    title: '<script>alert(1)</script>',
    greeting: 'A <Student> & "Friend"',
    paragraphs: ['Please review <b>this</b> application.'],
    details: [{ label: 'Name', value: '<img src=x onerror=alert(1)>' }],
  });

  assert.doesNotMatch(email.html, /<script>|<img src=x/);
  assert.match(email.html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.match(email.html, /A &lt;Student&gt; &amp; &quot;Friend&quot;/);
  assert.match(email.html, /&lt;img src=x onerror=alert\(1\)&gt;/);
  assert.match(email.text, /Name: <img src=x onerror=alert\(1\)>/);
});

test('does not expose credentials or signed query strings in logo URLs', () => {
  for (const logoUrl of [
    'https://user:password@assets.example/logo.png',
    'https://assets.example/logo.png?token=private',
  ]) {
    const email = renderBrandedEmail(
      { title: 'New Request' },
      { logoUrl },
    );
    assert.doesNotMatch(email.html, /src="[^"]*(?:assets\.example\/logo\.png|token=private)/);
    assert.match(email.html, /src="https:\/\/media\.uptrendsenglishacademy\.in\/bimi\/bimi-logo\.svg"/);
  }
});
